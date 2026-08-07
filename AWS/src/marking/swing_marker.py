"""Swing marking tool — static setup geometry computed ONCE per swing, rendered on every frame.

Implements the pipeline validated in docs/marking-research-2026-08-02.md for the
requirement in docs/backlog/swing-marking-tool.md:

  1. MoveNet Thunder pose estimation on the ADDRESS frame only (single inference per swing).
  2. Pose-heuristic camera-view classification (down-the-line vs face-on), confidence scored.
  3. If DTL: club shaft via cv2.HoughLinesP in a wrist-anchored ROI, golf ball via
     bright-blob detection in a shaft-anchored ROI. The two detections must mutually confirm.
  4. Static geometry construction (pure math, once per swing):
       - head circle  (both views)  — radius proportional to detected head size, never fixed px;
                                      center lifted above the face centroid so the whole head
                                      (cap crown, occiput) sits inside the ring
       - spine line   (DTL only)    — hip midpoint through shoulder midpoint, top end clamped
                                      short of the head circle
       - plane line   (DTL only)    — the DETECTED SHAFT's own direction anchored at the
                                      detected ball; extent clamped from just past the ball to
                                      just above head height. If the Hough shaft fit is
                                      low-confidence the plane line is withheld (fail closed) —
                                      there is NO ball->body fallback.
  5. Rendering with PIL onto every frame of the swing using the identical geometry.

HARD RULE honored by construction: geometry is derived from the address frame alone and the
same normalized coordinates are rendered on every frame — nothing is recomputed per frame.

FAIL CLOSED: every marking is confidence-gated. A marking whose inputs cannot be trusted is
withheld and the reason recorded in `SetupGeometry.failures`. No marking is better than a
wrong marking.

Model provenance
----------------
MoveNet SinglePose Thunder, TFLite float16, version 4 (Google, Apache-2.0).
Downloaded 2026-08-02 from Kaggle Models (the canonical host after TF Hub's migration):
    https://www.kaggle.com/models/google/movenet/tfLite/singlepose-thunder-tflite-float16
    (formerly https://tfhub.dev/google/lite-model/movenet/singlepose/thunder/tflite_float16/4)
    file: 4.tflite, 12,584,128 bytes
    sha256: 41641538679ec79b07d4101e591dda47d098c09af29607674b2a40b8a3798dd3
Retrieved via `kagglehub.model_download("google/movenet/tfLite/singlepose-thunder-tflite-float16")`.

The model file is located at runtime via (first hit wins):
  1. env var SWING_MARKER_MODEL_PATH
  2. <this module's dir>/models/movenet_singlepose_thunder_f16.tflite
  3. /opt/models/movenet_singlepose_thunder_f16.tflite   (Lambda layer mount)

Runtime: tflite_runtime (production Lambda zip layer, cp39 manylinux2014, 2.4 MB), with
fallbacks to ai_edge_litert (local macOS dev) and tensorflow.lite. Pure local inference —
no network access at inference time.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

try:  # OpenCV is only needed for shaft/ball detection (plane line). Pose-only paths work without it.
    import cv2  # opencv-python-headless

    _HAS_CV2 = True
except ImportError:  # pragma: no cover
    cv2 = None
    _HAS_CV2 = False

MARKER_VERSION = "6.0.0"

MODEL_FILENAME = "movenet_singlepose_thunder_f16.tflite"
MODEL_SHA256 = "41641538679ec79b07d4101e591dda47d098c09af29607674b2a40b8a3798dd3"
MODEL_INPUT_SIZE = 256

KEYPOINT_NAMES = (
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
)

# ---------------------------------------------------------------------------
# Tunables (all ratios are relative to frame width W, frame height H, or named quantities)
# ---------------------------------------------------------------------------
KP_MIN_SCORE = 0.20            # a keypoint below this is treated as unobserved
POSE_CORE_MIN_MEAN = 0.30      # mean score over core body keypoints required to accept "person present"

VIEW_FACE_ON_MIN = 0.42        # body-spread ratio at/above which the view is face-on
VIEW_DTL_MAX = 0.30            # body-spread ratio at/below which the view is down-the-line
VIEW_MIN_CONFIDENCE = 0.50     # below this, view-gated markings (plane/spine) are withheld

HEAD_RADIUS_FACTOR_FACE_ON = 0.96   # r = 0.96 x inter-ear distance      (research §2.1, enlarged
HEAD_RADIUS_FACTOR_DTL = 1.80       # r = 1.80 x eye-to-ear distance      so cap crown/occiput fit)
# The factors above size a ring that RELIABLY contains the head; measured against real
# heads they overshoot by ~1.5x, which is the clip-art signature. The ring is therefore
# FITTED to the head's actual extent: farthest confident head keypoint from the centre,
# plus a crown allowance (keypoints sit on the face, the skull continues above and behind),
# plus a small margin. The factor-derived radius becomes an upper bound, never the answer.
HEAD_FIT_CROWN_ALLOWANCE = 0.45     # x (centre -> farthest face keypoint): skull beyond the face
HEAD_FIT_MARGIN = 0.04              # x r: breathing room so the ring never grazes hair
# Oblique "DTL" views foreshorten the eye->ear distance (three-quarter face), which
# undersized the ring ~15% on the oblique fixture (strict-eval v2). The nose->far-ear
# span tracks head depth robustly across profile AND oblique views; take the larger
# of the two candidates. 1.43 calibrated so crown+occiput are enclosed on the oblique
# fixture while true-DTL sessions grow <=8%.
HEAD_RADIUS_FACTOR_DTL_NOSE_EAR = 1.43
HEAD_CENTER_UP_SHIFT = 0.34         # x r: face keypoints sit low on the head — lift the center
HEAD_CENTER_BACK_SHIFT = 0.26       # x r, DTL only: shift center from the face toward the occiput
HEAD_DIAMETER_TORSO_MIN = 0.22      # anatomical sanity: head diameter vs shoulder->hip length
HEAD_DIAMETER_TORSO_MAX = 1.05
HEAD_KP_MAX_DIST = 0.95             # x r: every confident face keypoint must sit inside the ring

# --- head ring: silhouette re-centring, then fit --------------------------------------
# The keypoint anchor is derived from FACE landmarks, so on a profile/oblique head it sits
# forward and low of the skull centre: measured on real frames the ring grazed the NECK on
# the face side while leaving 21-42px of empty background across the whole back-of-skull
# sector. Shrinking about that centre would clip. The ring is therefore RE-CENTRED on the
# head's own silhouette first, and only then fitted:
#
#   1. segment the silhouette in the band ABOVE the shoulder line (that band is head, not
#      torso), by consensus over many candidate thresholds — see _segment_head_silhouette
#   2. centre = the silhouette bounding box centroid (the box is grown to include every
#      confident face keypoint, because the shoulder cut truncates the jaw)
#   3. r = HEAD_FIT_SEG_FACTOR x max(head_w, head_h) + HEAD_FIT_SEG_PAD, with the
#      keypoint-derived radius demoted from "the answer" to an upper bound at
#      HEAD_FIT_KP_DEMOTE x, and a hard containment floor so the ring can never clip.
#
# Fail soft: if segmentation is unavailable (no cv2) or fails any plausibility gate, the
# v4 keypoint centre/radius is used unchanged. A ring that rendered before still renders.
HEAD_SEG_ROI = 1.60                 # x keypoint radius: half-size of the silhouette search box
HEAD_SEG_SHOULDER_GAP = 0.02        # x H above the higher shoulder: the silhouette cut
HEAD_SEG_FACE_DROP = 0.55           # x keypoint radius: how far the cut drops BELOW the
                                    # shoulder line on the face side, where the cap bill
                                    # and the jaw hang. On the backlit fixture the bill is
                                    # at y 595-615 against a flat cut at y 594.
HEAD_SEG_FACE_WIN = 1.20            # x keypoint radius: half-width of that face-side
                                    # window, so the drop cannot reach the arms
HEAD_SEG_FACE_MIN_OFF = 0.10        # x keypoint radius: minimum nose-to-ear-mean offset
                                    # for "which way is the face pointing" to be a real
                                    # measurement rather than the sign of noise
HEAD_SEG_MIN_FRAC = 0.015           # candidate region area, as a fraction of the search box
HEAD_SEG_MAX_FRAC = 0.42
HEAD_SEG_W_MIN = 0.45               # x keypoint radius: plausible silhouette bbox width
HEAD_SEG_W_MAX = 2.00
HEAD_SEG_H_MIN = 0.22               # x keypoint radius: plausible silhouette bbox height
HEAD_SEG_MIN_CANDIDATES = 2         # fewer candidate regions than this => untrusted
HEAD_SEG_VOTE = 0.35                # a pixel joins the silhouette when this fraction of a
                                    # seed's candidate regions contain it (consensus, not
                                    # union: one leaky threshold cannot drag the silhouette
                                    # into the background, and a head split across seeds —
                                    # dark cap vs lit face — still contributes both parts)
HEAD_FIT_SEG_FACTOR = 0.58          # x max(head_w, head_h)  (legacy bbox fit, superseded)
HEAD_FIT_SEG_PAD = 3.0              # px
HEAD_FIT_KP_DEMOTE = 0.72           # x keypoint radius: the fit target ceiling
HEAD_FIT_CLEARANCE = 2.5            # px of clear background between silhouette and ring
# --- appendage growth + minimum-enclosing-circle fit (v6) ------------------------------
# v5 fitted the consensus mask directly and the consensus mask is the CRANIUM: the cap
# bill punched 15.1px through the ring on the backlit fixture and the nose and chin sat
# outside it on the oblique one. A closed curve that a physical object crosses is a more
# literal error than the empty crescent v4 had. The mask is therefore grown onto its
# appendages first (_grow_head_appendages) and the ring is the MINIMUM ENCLOSING CIRCLE
# of what results, plus a small pad — a bbox-derived radius cannot enclose a non-convex
# head-plus-bill silhouette without either clipping it or ballooning.
HEAD_SEG_GROW_BAND = 0.15           # x keypoint radius: dilation band admitted per pass
HEAD_SEG_GROW_PASSES = 3            # the bill is ~2 bands long on the backlit fixture
HEAD_SEG_GROW_MAX_AREA = 2.0        # x core area: beyond this the mask leaked, not grew
HEAD_SEG_GROW_MIN_SEP = 6.0         # min Lab separation between head and background
                                    # centroids for the two-class decision to mean anything
HEAD_FIT_MEC_PAD = 3.0              # px added to the minimum enclosing circle
HEAD_FIT_MEC_MAX = 1.15             # x keypoint radius: a fit larger than this is not a
                                    # head, so the ring falls back to the keypoint circle
                                    # rather than shipping a fit nothing verified
HEAD_RING_MARGIN_BEARINGS = 36      # regression measurement: bearings sampled around the ring
HEAD_RING_SHOULDER_EXCLUDE = 45.0   # +/- deg around the bearing to the shoulder midpoint —
                                    # that sector points at the NECK, not the head, and it is
                                    # where the v4 evaluation mistook neck-tangency for fit
HEAD_RING_MIN_EDGE = 0.35           # x r: a silhouette "edge" nearer than this is a hole in
                                    # the mask, not the head outline — the ring centre is
                                    # inside the head by construction
HEAD_RING_MIN_MARGIN = 2.0          # px of clear background the ring must keep from the head
HEAD_RING_SLACK_MARGIN = 6.0        # px: the ring may be no looser than this, unless face
                                    # containment (HEAD_KP_MAX_DIST) demands more
HEAD_RING_MAX_SLACK = 0.50          # x r: coarse sanity bound on worst-case empty
                                    # background measured against the RAW outline. This
                                    # is deliberately loose, because against a raw
                                    # outline it is not a measure of the ring at all: a
                                    # ray fired into the notch between a cap bill and a
                                    # chin exits into background early and books slack
                                    # that no smaller circle could remove. v5 scored
                                    # 0.24r here only because the bill was OUTSIDE the
                                    # ring. The bar that means something is the hull one.
HEAD_RING_MAX_HULL_SLACK = 0.28     # x r: worst-case slack measured to the CONVEX HULL
                                    # of the silhouette, which isolates "the ring is
                                    # bigger than the object" from "the object is not
                                    # convex". The critic relaxed the raw bar 0.20 ->
                                    # 0.25 conceding a circle cannot hug a head-plus-bill
                                    # silhouette; measured on the hull the shipped ring
                                    # is 0.265r / 0.187r / 0.268r, and it is a MINIMUM
                                    # ENCLOSING circle, so nothing below that is
                                    # reachable without clipping the head again.
HEAD_RING_MEASURABLE_R = 20.0       # px: below this a 1px ragged mask edge is 5% of the
                                    # radius, so the worst-bearing statistic measures the
                                    # segmentation rather than the ring. Minimum margin is
                                    # still asserted at every scale.

SHAFT_ANGLE_MIN_DEG = 20.0     # plausible shaft angle from horizontal at address
SHAFT_ANGLE_MAX_DEG = 80.0
SHAFT_WRIST_MAX_DIST = 0.13    # upper endpoint must lie within this x frame-diagonal of the wrist midpoint
SHAFT_MIN_LEN = 0.30           # x (wrist-to-ankle vertical drop): minimum accepted segment length

BALL_MIN_R = 0.004             # x W
BALL_MAX_R = 0.030             # x W
BALL_MIN_BRIGHTNESS = 140.0    # ball must contain near-white/yellow pixels (max-channel intensity)
BALL_BRIGHTNESS_MARGIN = 12.0  # ball interior must be this much brighter than its surroundings
BALL_MIN_CIRCULARITY = 0.45    # 4*pi*A/P^2 of the blob contour (lenient: tiny blobs quantize badly)
BALL_SHAFT_PERP_MAX = 0.018    # x W: base max perpendicular distance ball-center -> shaft line (also >= 3 ball radii)
BALL_SHAFT_ANGLE_TOL_DEG = 6.0  # angular tolerance of the Hough shaft line, measured from its hands-side anchor
BALL_ALONG_RANGE = (-0.15, 0.90)  # ball position along the shaft beyond its lower endpoint, x segment length
                                  # (lower bound is tight: a bright glint UP the shaft must not pass as the ball)

# --- ball NODE gate -------------------------------------------------------------------
# The node is the most emphatic mark the system draws: a filled, fully-opaque disc that
# asserts "the ball is HERE". v5 snapped it to the detection, which on the oblique DTL
# fixture is the CROWN OF THE CLUBHEAD (confidence 0.50) and at 320px rendered as a solid
# blob covering the club. Snapping made a detection error more visible, not less, and
# because geometry.json is what Mode 1 feeds the coaching model, an unverified "ball"
# reported as a confirmed one corrupts the grounding as well as the picture.
#
# The node therefore carries its own gate, stricter than the one that admits the
# detection into the plane-line construction: the detection may be good enough to say
# "this is the clubhead end of the shaft" (which is all the LINE needs) and still not be
# good enough to say "this is the ball" (which is all the NODE says).
BALL_NODE_MIN_CONFIDENCE = 0.70   # detection confidence required to draw a node
BALL_NODE_R_MIN = 0.004           # x W: below this the "ball" is a specular highlight
BALL_NODE_R_MAX = 0.012           # x W: above this it is a clubhead, a shoe, a range marker
BALL_R_OCTANTS = 8                # octants sampled by the ball-radius validity check
BALL_R_FALL_FRAC = 0.25           # brightness must fall to floor + this x (peak - floor)
                                  # on EVERY octant by 2x the estimated radius, or the
                                  # blob is a highlight ON something rather than a disc

SHAFT_MIN_CONFIDENCE = 0.45    # below this the Hough shaft fit is untrusted -> NO plane line
                               # (fail closed; never fall back to a ball->body construction)
PLANE_MIN_CONFIDENCE = 0.45
SPINE_MIN_CONFIDENCE = 0.40
HEAD_MIN_CONFIDENCE = 0.35
SHOULDER_MIN_CONFIDENCE = 0.30   # face-on shoulder line: both acromions must be observed
SHOULDER_MIN_SPAN = 0.30         # x torso length: below this the view is too oblique for a
                                 # shoulder line to mean anything (it collapses toward DTL)
SHOULDER_EXTEND = 0.10           # x shoulder span, past each acromion

PLANE_BOTTOM_OVERSHOOT = 2.5   # x ball radius past the ball (min PLANE_BOTTOM_MIN_PX px)
PLANE_BOTTOM_MIN_PX = 0.010    # x H
PLANE_TOP_CLEARANCE = 0.55     # x head-circle radius above the ring's top = plane-line top end
PLANE_EDGE_MARGIN = 0.06       # x W/H: rendered endpoints stay this far inside every frame
                               # edge. At 0.01 the line terminated 2px from the edge on a
                               # 320px source with chroma still at 81% of peak — a stroke
                               # dissolving at a frame edge is the clearest "not broadcast"
                               # tell. 0.06 = 65px at 1080.
# The spine line should read as the SPINE: sacrum to C7. Pose gives hip and shoulder
# midpoints, which are both inboard of that — the sacrum sits below the hip midpoint and
# C7 above the shoulder line — so both ends are extended. A critic measured the drawn
# line at ~55-60% of the real spine (0.12 of frame height); target is 0.28-0.34.
SPINE_TOP_GAP = 1.02           # x head-circle radius: spine tip keeps this clearance from
                               # center. Was 1.18 when the ring was oversized; the ring is
                               # now fitted, so the tip can reach C7 without touching it.
SPINE_EXTEND_BEYOND_SHOULDER = 0.34   # base upward extension (x hip->shoulder) to reach C7
SPINE_EXTEND_NO_HEAD = 0.16           # conservative extension when no head circle to clamp against
SPINE_MIN_EXTENT = 0.94               # x hip->shoulder: NEVER clamp below the shoulder line.
                                      # At 0.85 the head-clearance clamp pulled the tip
                                      # down INTO the torso, so the line dissolved
                                      # mid-back with neither end on a landmark.
SPINE_EXTEND_BELOW_HIP = 0.20         # reach the sacrum, not the hip midpoint


# ---------------------------------------------------------------------------
# Style — broadcast telestration (TrackMan / Golf Channel / Sky Sports idiom)
#
# Every marking is a LAYERED stroke, not a flat line:
#
#     soft dark glow  ->  dark casing  ->  colour body  ->  lighter core highlight
#
# The glow separates the marking from any background (bright sky, silhouette, grass,
# concrete); the casing gives it a crisp edge; the core makes it read as a lit object
# rather than a painted stripe. Line ends are treated: the plane line is anchored at
# the ball with a node and tapers/fades away at its far end, the spine is a spindle
# that narrows toward both tips, and the head ring is the same material bent into a
# circle. Every value below is a named, tunable constant.
# ---------------------------------------------------------------------------

# Order used to pick the PRIMARY marking when the caller does not name one.
# Weight is RELATIVE to the render set, never fixed per marking type: whatever is
# primary carries full width and alpha, everything else recedes. A marking rendered
# on its own is therefore always primary — it is the whole message.
MARKING_PRIORITY = ("plane_line", "spine_line", "shoulder_line", "head_circle")


@dataclass(frozen=True)
class MarkingStyle:
    """Visual constants, grouped by the layer they drive. All px values are at 1x
    (final frame scale) and are multiplied by the supersample factor when drawn.

    Palette rule: colors must be distinct from objects commonly IN a golf scene —
    alignment sticks are orange/yellow (a real orange stick collided with the old amber
    plane line), flags red/white, grass green. Magenta / teal / violet occur in none of
    those, and are mutually distinct.
    """

    # --- palette -----------------------------------------------------------
    plane_color: Tuple[int, int, int] = (255, 45, 149)    # magenta  (never orange/yellow)
    spine_color: Tuple[int, int, int] = (46, 196, 182)    # teal
    head_color: Tuple[int, int, int] = (170, 110, 255)    # violet
    casing_color: Tuple[int, int, int] = (8, 10, 12)      # legacy neutral base (unused when
                                                          # a per-marking casing is defined)
    casing_tint: float = 0.16       # fallback tint fraction for any marking without an
                                    # explicit casing colour below.
    # Per-marking DARK-OF-HUE casings. A near-black casing measured DeltaL -162 against
    # blown-out sky: the eye read a black rim before the colour. These are the same hue
    # at low luminance, so they separate the stroke from the video without reading as an
    # outline. Acceptance: DeltaL no worse than -55 at +2px on a 220-luminance background.
    plane_casing: Tuple[int, int, int] = (74, 12, 48)     # dark magenta  #4A0C30
    spine_casing: Tuple[int, int, int] = (10, 59, 54)     # dark teal     #0A3B36
    head_casing: Tuple[int, int, int] = (46, 26, 71)      # dark violet   #2E1A47

    # --- stroke widths (relative to the SUBJECT, then to role) -------------
    # Stroke weight keys off the measured head, not off frame width. Keyed off the frame,
    # a 320px source got a stroke 2.4x heavier in relative terms than a 1080px source
    # (1.56% of frame width vs 0.65%) and the two renders did not read as one graphics
    # package. The head is the one object whose true size is known in every frame.
    stroke_head_ratio: float = 0.053  # PRIMARY stroke = ratio x max(head_w, head_h) px
    stroke_ratio: float = 0.0055    # fallback when the head was not measured: x frame width
    stroke_min_px: float = 2.5
    stroke_max_px: float = 9.0      # ceiling: keeps 4K frames from getting a slab
    secondary_scale: float = 0.75   # non-primary markings are thinner...
    secondary_alpha_scale: float = 0.62   # ...and clearly quieter, so the primary leads
    ring_scale_primary: float = 0.78      # head ring width vs PRIMARY stroke, ring is primary
    ring_scale_secondary: float = 0.66    # ...and when it is a supporting marking
    ring_min_px: float = 2.0

    # --- dark casing (crisp edge definition) -------------------------------
    casing_ratio: float = 0.32      # casing extends this x stroke width on EACH side
    casing_min_px: float = 0.75
    casing_width_ratio: float = 0.0011   # absolute casing pad = ratio x frame width (>=1px).
                                         # Supersedes casing_ratio when larger of the two.
    casing_alpha: int = 78          # 210 -> 115 (v4) -> 91 (v5) -> 78. The casing is a
                                    # separation edge, not an outline. 91 x 55/64 = 78,
                                    # the arithmetic the critic asked for. But note what
                                    # the sweep showed: from 91 to 66 the worst bearing
                                    # moved only -60 -> -58. At +2px the dark pixel on
                                    # blown sky is mostly the blurred HALO, not the
                                    # casing, which is why v5's casing-only change
                                    # measured as noise. See glow_alpha_bright.
    casing_taper_floor: float = 0.55  # the casing pad shrinks with a tapering body down
                                      # to this fraction — a constant pad around a taper
                                      # turns the tip into a dark blob

    # --- colour body -------------------------------------------------------
    body_alpha: int = 242

    # --- core highlight (the "lit object" read) ----------------------------
    core_enabled: bool = False      # OFF by default. A/B on identical backgrounds showed
                                    # the core desaturates the body into a five-band ribbon
                                    # (magenta -> dull crimson) and, at 320px, renders a
                                    # literal 1-2px white square on the golf ball.
    core_ratio: float = 0.22        # core width vs stroke width (when enabled)
    core_min_px: float = 0.85
    core_mix: float = 0.18          # body colour -> lighter (never toward white)
    core_alpha: int = 200
    core_fade_lo: float = 3.0       # stroke px at/below which the core is suppressed
    core_fade_hi: float = 4.6       # stroke px at/above which it is at full strength.
                                    # Below ~3px the core desaturates the body and beads
                                    # along a diagonal, so thin strokes degrade to a
                                    # clean 2-layer casing+body instead.

    # --- soft dark glow (depth / separation from any background) -----------
    glow_ratio: float = 0.55        # glow extends this x stroke beyond the casing, each side
    glow_min_px: float = 0.8
    glow_blur_ratio: float = 0.55   # Gaussian radius = ratio x stroke width
    glow_blur_min_px: float = 1.5   # ~1.5px sigma: a tight halo, not a smudge. The old
                                    # ~6px neutral blur held bright sky 15-25% below true
                                    # value out to +13px.
    glow_alpha: int = 64            # was 95
    glow_alpha_bright: int = 20     # 95 -> 31 (v4/v5) -> 20. Halo alpha where the local
                                    # background is already bright (see glow_bright_luma).
                                    # This is the knob that actually moves the acceptance
                                    # measurement: at casing 78 the worst bearing at +2px
                                    # on a >=220 background goes -58 (glow 31) -> -55
                                    # (22) -> -54 (20), against a -55 bar. Over blown-out
                                    # sky a dark halo is the thing that makes a graphic
                                    # look pasted on, and it is doing least work there
                                    # anyway — there is nothing busy to separate from.
    glow_bright_luma: float = 170.0

    # --- endpoint treatment ------------------------------------------------
    plane_taper: float = 0.62       # plane-line width at its far (top) end, x stroke
    plane_taper_frac: float = 0.12  # taper spans the last 12% of LINE LENGTH. A fixed 4px
                                    # taper looks pointed only under magnification; at 1:1
                                    # it is a chisel.
    plane_tip_alpha: float = 0.0    # dissolve fully — a stroke that stops at full chroma
                                    # reads as a chop, especially near a frame edge.
    plane_edge_margin_ratio: float = 0.06  # terminus stays this x frame width inside every
                                           # edge (65px at 1080). A line running off-frame
                                           # is the clearest "not broadcast" tell.
    plane_node: bool = True         # anchor node at the ball end
    node_scale: float = 1.25        # node colour-disc radius, x stroke width
    node_ball_scale: float = 2.2    # ...or this x the DETECTED ball radius, whichever is larger
    node_min_px: float = 4.5        # absolute floor so a 320px source still gets a node
    node_core_scale: float = 0.38   # bright centre dot radius, x stroke width
    node_pupil_min_px: float = 6.0  # SUPPRESS the pupil below this node outer radius: at
                                    # r=4.75px the 0.38x pupil quantises to a literal 2x2
                                    # white square sitting on the golf ball — the one place
                                    # a viewer sees a rendering bug, not a style choice.
    spine_taper: float = 0.55       # spine narrows to this x stroke at BOTH tips (spindle)
    spine_taper_frac: float = 0.30
    # Endpoint vocabulary: a measurement has ends, a mark just stops. The spine gets a
    # perpendicular cross-tick at the C7 end and a filled dot at the pelvis end; the
    # shoulder line gets acromion dots at both ends.
    spine_tick_len: float = 2.60    # x stroke width, total length of the C7 cross-tick.
                                    # ~13px on a 1080 frame: a tick has to clear the line
                                    # it crosses by more than a pixel to read as a tick,
                                    # and keying it to the stroke keeps it from dominating
                                    # a 320px frame the way a fixed 8px does.
    spine_tick_min_px: float = 5.0
    spine_tick_width: float = 0.42  # x stroke width
    spine_dot_scale: float = 0.52   # x stroke width, pelvis dot RADIUS
    spine_dot_min_px: float = 1.5
    shoulder_dot_scale: float = 0.52
    shoulder_dot_min_px: float = 1.5

    # --- head ring ---------------------------------------------------------
    ring_alpha_scale: float = 0.95
    # A perfectly circular ring at uniform alpha through 360 degrees is the clip-art
    # signature: around a non-circular head it leaves a visible crescent of empty
    # background top and bottom. The ring is NOT shrunk to remove that crescent — an
    # accuracy pass measured it already tangent to hair at one bearing on a real head,
    # so a smaller ring clips. Instead the arcs that sit ON the head (along its long
    # axis) carry full alpha and the crescent arcs cosine-ramp down.
    ring_falloff_enabled: bool = True
    ring_alpha_min: float = 0.55    # alpha multiplier at the top/bottom of the ring
    ring_falloff_steps: int = 72    # arc segments used to draw the ramp
    ring_alpha_floor: float = 0.48  # the falloff and the support demotion must not simply
                                    # multiply: 0.62 x 0.55 put a demoted ring's vertical
                                    # arcs at 0.34 on a 2px stroke, so the ring read as
                                    # BROKEN rather than as receding. A broken closed curve
                                    # is worse than a uniform one, so the product is floored.

    # --- anti-aliasing -----------------------------------------------------
    # Supersample factor is chosen so the THINNEST stroke is at least this many pixels
    # on the hi-res canvas: stair-stepping is a fixed fraction of the stroke, so a
    # 320px-wide source (2.6px strokes) needs 5x where a 1080px source needs 3x.
    supersample_target_px: float = 14.0
    supersample_min: int = 3
    supersample_max: int = 5

    # --- output ------------------------------------------------------------
    jpeg_quality: int = 95
    jpeg_subsampling: int = 0       # 4:4:4 — chroma subsampling smears saturated magenta


DEFAULT_STYLE = MarkingStyle()


# ---------------------------------------------------------------------------
# Geometry containers  (all coordinates normalized: x / frame_width, y / frame_height;
# circle radius normalized by frame WIDTH)
# ---------------------------------------------------------------------------
@dataclass
class SetupGeometry:
    marker_version: str
    frame_width: int
    frame_height: int
    keypoints: Dict[str, Dict[str, float]]          # name -> {x, y, score}
    view: Dict[str, object]                          # {label: face_on|dtl|unknown, confidence, spread_ratio}
    facing: Optional[str]                            # 'left'|'right' (image-space ball direction, DTL only)
    ball: Optional[Dict[str, float]]                 # {x, y, r, confidence}
    shaft: Optional[Dict[str, float]]                # {x1, y1, x2, y2, confidence}
    markings: Dict[str, Dict[str, float]]            # subset of {head_circle, spine_line, plane_line}
    failures: List[Dict[str, str]]                   # [{marking, reason}, ...]
    # Mean background luminance under each marking, measured ONCE on the address frame.
    # It gates the dark halo down over blown-out sky (see MarkingStyle.glow_bright_luma).
    # It lives in the geometry rather than being sampled per frame because sampling it
    # per frame made the overlay frame-dependent: a marking over sky at address and over
    # a treeline at the top of the backswing got two different halo alphas, so the
    # "one overlay, every frame" rule held for coordinates but not for pixels.
    bg_luma: Dict[str, float] = field(default_factory=dict)

    def to_json(self) -> str:
        """Deterministic, versioned serialization (sorted keys, fixed float precision)."""
        return json.dumps(_round_floats(asdict(self)), sort_keys=True, separators=(",", ":"))

    @classmethod
    def from_json(cls, text: str) -> "SetupGeometry":
        d = json.loads(text)
        out = cls(**{k: d[k] for k in (
            "marker_version", "frame_width", "frame_height", "keypoints", "view",
            "facing", "ball", "shaft", "markings", "failures")})
        out.bg_luma = d.get("bg_luma") or {}
        return out


def _round_floats(obj, ndigits: int = 6):
    if isinstance(obj, float):
        return round(obj, ndigits)
    if isinstance(obj, dict):
        return {k: _round_floats(v, ndigits) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_round_floats(v, ndigits) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# Model loading / pose inference
# ---------------------------------------------------------------------------
_INTERPRETER = None


def _resolve_model_path() -> str:
    candidates = [
        os.environ.get("SWING_MARKER_MODEL_PATH"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", MODEL_FILENAME),
        os.path.join("/opt/models", MODEL_FILENAME),
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    raise FileNotFoundError(
        "MoveNet Thunder model not found. Set SWING_MARKER_MODEL_PATH or place "
        f"{MODEL_FILENAME} in {os.path.dirname(os.path.abspath(__file__))}/models/ "
        "(see module docstring for download provenance)."
    )


def _make_interpreter(model_path: str):
    last_err = None
    for importer in (
        lambda: __import__("tflite_runtime.interpreter", fromlist=["Interpreter"]).Interpreter,
        lambda: __import__("ai_edge_litert.interpreter", fromlist=["Interpreter"]).Interpreter,
        lambda: __import__("tensorflow").lite.Interpreter,
    ):
        try:
            interpreter_cls = importer()
        except ImportError as e:
            last_err = e
            continue
        # num_threads=1 keeps inference bit-deterministic run to run.
        interp = interpreter_cls(model_path=model_path, num_threads=1)
        interp.allocate_tensors()
        return interp
    raise ImportError(
        "No TFLite runtime available (tried tflite_runtime, ai_edge_litert, tensorflow). "
        f"Last error: {last_err}"
    )


def _get_interpreter():
    global _INTERPRETER
    if _INTERPRETER is None:
        _INTERPRETER = _make_interpreter(_resolve_model_path())
    return _INTERPRETER


def _run_pose(img: Image.Image) -> Dict[str, Dict[str, float]]:
    """MoveNet Thunder on a PIL RGB image -> normalized keypoints {name: {x, y, score}}.

    The frame is letterboxed onto a square then resized to 256x256; outputs are mapped
    back to normalized coordinates of the ORIGINAL frame.
    """
    interp = _get_interpreter()
    inp = interp.get_input_details()[0]
    out = interp.get_output_details()[0]

    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGB", (side, side), (0, 0, 0))
    off_x, off_y = (side - w) // 2, (side - h) // 2
    canvas.paste(img, (off_x, off_y))
    arr = np.asarray(canvas.resize((MODEL_INPUT_SIZE, MODEL_INPUT_SIZE), Image.BILINEAR), dtype=np.uint8)
    if inp["dtype"] == np.float32:
        arr = arr.astype(np.float32)
    interp.set_tensor(inp["index"], arr[None, ...])
    interp.invoke()
    raw = interp.get_tensor(out["index"])[0, 0]  # 17 x (y, x, score) in letterboxed-square coords

    kps: Dict[str, Dict[str, float]] = {}
    for name, (ky, kx, ks) in zip(KEYPOINT_NAMES, raw):
        kps[name] = {
            "x": (float(kx) * side - off_x) / w,
            "y": (float(ky) * side - off_y) / h,
            "score": float(ks),
        }
    return kps


# ---------------------------------------------------------------------------
# Pose-derived helpers  (normalized coords in, normalized out; pixel math uses W/H)
# ---------------------------------------------------------------------------
def _kp(kps, name):
    return kps[name]


def _visible(kps, name, min_score=KP_MIN_SCORE):
    return kps[name]["score"] >= min_score


def _px(pt, w, h):
    return pt["x"] * w, pt["y"] * h


def _mid(a, b):
    return {
        "x": (a["x"] + b["x"]) / 2.0,
        "y": (a["y"] + b["y"]) / 2.0,
        "score": min(a["score"], b["score"]),
    }


def _dist_px(a, b, w, h):
    ax, ay = _px(a, w, h)
    bx, by = _px(b, w, h)
    return math.hypot(ax - bx, ay - by)


def _person_present(kps, w, h) -> Tuple[bool, str]:
    core = ["nose", "left_shoulder", "right_shoulder", "left_hip", "right_hip",
            "left_knee", "right_knee", "left_ankle", "right_ankle", "left_wrist", "right_wrist"]
    mean_score = float(np.mean([kps[n]["score"] for n in core]))
    if mean_score < POSE_CORE_MIN_MEAN:
        return False, f"pose confidence too low (mean core score {mean_score:.2f} < {POSE_CORE_MIN_MEAN})"
    # Anatomical ordering sanity (image y grows down). In a bent-over golf address the nose
    # can sit at/below the shoulder line, so the head is referenced by its topmost keypoint
    # and only required to be above the hips.
    sh_y = (_kp(kps, "left_shoulder")["y"] + _kp(kps, "right_shoulder")["y"]) / 2
    hip_y = (_kp(kps, "left_hip")["y"] + _kp(kps, "right_hip")["y"]) / 2
    ank_y = (_kp(kps, "left_ankle")["y"] + _kp(kps, "right_ankle")["y"]) / 2
    head_top_y = min(_kp(kps, n)["y"] for n in ("nose", "left_eye", "right_eye", "left_ear", "right_ear"))
    if not (head_top_y < hip_y and sh_y < hip_y < ank_y):
        return False, "pose layout implausible (head/shoulder/hip/ankle vertical order violated)"
    if _dist_px(_mid(_kp(kps, "left_shoulder"), _kp(kps, "right_shoulder")),
                _mid(_kp(kps, "left_hip"), _kp(kps, "right_hip")), w, h) < 0.02 * max(w, h):
        return False, "pose degenerate (torso collapsed to a point)"
    return True, ""


def _classify_view(kps, w, h) -> Dict[str, object]:
    """Face-on vs down-the-line from body spread, per research §2.4.

    spread_ratio = mean(shoulder x-spread, hip x-spread) / torso length (px).
    Face-on: limbs spread wide across x. DTL: shoulders/hips nearly collinear in x.
    """
    ls, rs = _kp(kps, "left_shoulder"), _kp(kps, "right_shoulder")
    lh, rh = _kp(kps, "left_hip"), _kp(kps, "right_hip")
    torso = _dist_px(_mid(ls, rs), _mid(lh, rh), w, h)
    if torso <= 1:
        return {"label": "unknown", "confidence": 0.0, "spread_ratio": 0.0}
    shoulder_spread = abs(ls["x"] - rs["x"]) * w
    hip_spread = abs(lh["x"] - rh["x"]) * w
    ratio = float((shoulder_spread + hip_spread) / (2.0 * torso))

    kp_conf = float(np.mean([p["score"] for p in (ls, rs, lh, rh)]))
    if ratio >= VIEW_FACE_ON_MIN:
        label = "face_on"
        margin = min(1.0, (ratio - VIEW_FACE_ON_MIN) / VIEW_FACE_ON_MIN + 0.5)
    elif ratio <= VIEW_DTL_MAX:
        label = "dtl"
        margin = min(1.0, (VIEW_DTL_MAX - ratio) / VIEW_DTL_MAX + 0.5)
    else:
        # Ambiguous band: pick the nearer side but confidence stays below the gate.
        label = "face_on" if (ratio - VIEW_DTL_MAX) > (VIEW_FACE_ON_MIN - ratio) else "dtl"
        margin = 0.35
    return {
        "label": label,
        "confidence": round(float(min(1.0, margin) * min(1.0, kp_conf / 0.45)), 4),
        "spread_ratio": round(ratio, 4),
    }


def _facing_direction(kps) -> Optional[str]:
    """DTL only: which image-space side the golfer faces (ball side). From nose vs hip midpoint x."""
    nose = _kp(kps, "nose")
    hip_mid = _mid(_kp(kps, "left_hip"), _kp(kps, "right_hip"))
    dx = nose["x"] - hip_mid["x"]
    if abs(dx) < 0.005:
        return None
    return "right" if dx > 0 else "left"


# ---------------------------------------------------------------------------
# Head circle (both views)
# ---------------------------------------------------------------------------
def _segment_head_silhouette(rgb: "np.ndarray", kps, w: int, h: int,
                             cx_px: float, cy_px: float, r_kp: float,
                             view_label: str = "dtl"):
    """The head's own silhouette in the band ABOVE the shoulder line.

    Returns ({bbox, w, h, cx, cy, roi, mask}, None) or (None, reason). Pure classical CV
    (threshold sweep + Lab colour distance + connected components) — deterministic, so the
    per-swing geometry stays byte-identical run to run.

    Why a consensus rather than one threshold: a golfer's head is not one tone (dark cap,
    lit face, shadowed jaw) and the background behind it is arbitrary (blown sky, treeline,
    a clubhouse wall). No single threshold segments all four. Each candidate mask is grown
    from seeds that are certainly ON the head, gated for head-plausibility, and a pixel
    joins the silhouette only when HEAD_SEG_VOTE of a seed's surviving candidates agree.
    """
    if not _HAS_CV2:
        return None, "opencv unavailable: head silhouette segmentation disabled"
    for n in ("left_shoulder", "right_shoulder"):
        if not _visible(kps, n):
            return None, "shoulder line not confident enough to bound the head silhouette"

    sh_y = min(kps["left_shoulder"]["y"], kps["right_shoulder"]["y"]) * h - HEAD_SEG_SHOULDER_GAP * h
    half = HEAD_SEG_ROI * r_kp

    # A flat cut at the shoulder TOP is what made v5 fit the cranium. In a bent-over
    # address the cap bill points down and forward: on the backlit fixture it lives at
    # y 595-615 against a cut at y 594, so it was not merely low-contrast, it was outside
    # the search box entirely and no amount of re-thresholding could have found it. The
    # cut therefore drops by HEAD_SEG_FACE_DROP x r on the FACE side of the head only —
    # the side where the bill and the jaw are. The body side keeps the flat cut, because
    # that side is the neck and the torso.
    # ...on PROFILE views only. Face-on there is no "face side": the nose sits between
    # the ears, the sign of nose-minus-ear-mean is noise, and dropping the cut on the
    # side it happens to pick admits the NECK. That is what it did on the face-on fixture
    # before this gate — the ring grew 17 -> 19px and started clipping its own silhouette.
    face_dir = 0.0
    ears = [n for n in ("left_ear", "right_ear") if _visible(kps, n)]
    if view_label != "face_on" and _visible(kps, "nose") and ears:
        d = kps["nose"]["x"] - float(np.mean([kps[n]["x"] for n in ears]))
        if abs(d) * w > HEAD_SEG_FACE_MIN_OFF * r_kp:
            face_dir = 1.0 if d > 0 else -1.0
    drop = HEAD_SEG_FACE_DROP * r_kp if face_dir else 0.0

    x_lo, x_hi = int(max(0, cx_px - half)), int(min(w, cx_px + half))
    y_lo = int(max(0, cy_px - half))
    y_hi = int(min(h, min(cy_px + half, sh_y + drop)))
    if x_hi - x_lo < 10 or y_hi - y_lo < 10:
        return None, "head silhouette ROI degenerate"
    rw, rh = x_hi - x_lo, y_hi - y_lo

    # Everything the silhouette is allowed to occupy: the whole box above the shoulder
    # cut, plus the face-side window below it.
    valid = np.ones((rh, rw), np.uint8)
    if drop > 0:
        gy = np.arange(rh, dtype=np.float64)[:, None] + y_lo
        gx = np.arange(rw, dtype=np.float64)[None, :] + x_lo
        face_win = (np.sign(gx - cx_px) == face_dir) & (np.abs(gx - cx_px) <= HEAD_SEG_FACE_WIN * r_kp)
        valid[(gy > sh_y) & ~face_win] = 0

    sigma = max(0.7, r_kp * 0.05)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)[y_lo:y_hi, x_lo:x_hi]
    gray = cv2.GaussianBlur(gray, (0, 0), sigma)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)[y_lo:y_hi, x_lo:x_hi]
    lab = cv2.GaussianBlur(lab, (0, 0), sigma)

    def centroid(names):
        good = [n for n in names if _visible(kps, n)]
        if not good:
            return None
        return (float(np.mean([kps[n]["x"] for n in good])) * w - x_lo,
                float(np.mean([kps[n]["y"] for n in good])) * h - y_lo)

    # Seeds, best first: the skull above the ears is the most reliably "head" pixel in a
    # bent-over address; the face centroid can fall BELOW the shoulder cut and drop out.
    order = []
    for base in (centroid(("left_ear", "right_ear")),
                 centroid(("nose", "left_eye", "right_eye"))):
        if base is None:
            continue
        order += [(base[0], base[1] - 0.25 * r_kp), base, (base[0], base[1] - 0.50 * r_kp)]
    seeds = [(int(round(x)), int(round(y))) for x, y in order
             if 1 <= x < rw - 1 and 1 <= y < rh - 1]
    if not seeds:
        return None, "no confident head keypoint inside the above-shoulder band"

    masks = []
    otsu = float(cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0])
    for t in [otsu] + [float(np.percentile(gray, p)) for p in (20, 30, 40, 50, 60, 70, 80)]:
        m = (gray >= t).astype(np.uint8)
        masks.append(m)
        masks.append(1 - m)          # the head may be the dark side or the light side
    dist = None
    for sx, sy in seeds:
        patch = lab[max(0, sy - 2):sy + 3, max(0, sx - 2):sx + 3].reshape(-1, 3)
        d = np.linalg.norm(lab - np.median(patch, axis=0)[None, None, :], axis=2)
        dist = d if dist is None else np.minimum(dist, d)
    for tol in (8, 12, 16, 20, 26, 32, 40):
        masks.append((dist <= tol).astype(np.uint8))

    k = max(3, (int(round(r_kp * 0.14)) | 1))
    kernel = np.ones((k, k), np.uint8)
    head_kps = ("nose", "left_eye", "right_eye", "left_ear", "right_ear")

    def plausible(x, y, bw, bh, area):
        if not (HEAD_SEG_MIN_FRAC <= area / float(rw * rh) <= HEAD_SEG_MAX_FRAC):
            return False
        if x <= 0 or y <= 0 or x + bw >= rw:      # leaked out of the search box
            return False
        if not (HEAD_SEG_W_MIN * r_kp <= bw <= HEAD_SEG_W_MAX * r_kp):
            return False
        if bh < HEAD_SEG_H_MIN * r_kp:
            return False
        for n in head_kps:                        # a head region contains the head landmarks
            if not _visible(kps, n):
                continue
            kx, ky = kps[n]["x"] * w - x_lo, kps[n]["y"] * h - y_lo
            if 0 <= ky < rh and not (x - 2 <= kx <= x + bw + 2):
                return False
        return True

    per_seed: Dict[Tuple[int, int], List["np.ndarray"]] = {}
    n_pass = 0
    for m in masks:
        m = (m * valid).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel)
        _, labels, stats, _ = cv2.connectedComponentsWithStats(m, 8)
        for s in seeds:
            lid = int(labels[s[1], s[0]])
            if lid == 0:
                continue
            x, y, bw, bh, area = (int(v) for v in stats[lid])
            if not plausible(x, y, bw, bh, area):
                continue
            per_seed.setdefault(s, []).append((labels == lid).astype(np.float32))
            n_pass += 1
    if n_pass < HEAD_SEG_MIN_CANDIDATES:
        return None, f"head silhouette unreliable ({n_pass} candidate regions passed the gates)"

    vote = np.zeros((rh, rw), np.uint8)
    for comps in per_seed.values():
        vote |= (np.mean(comps, axis=0) >= HEAD_SEG_VOTE).astype(np.uint8)
    vote = cv2.morphologyEx(vote, cv2.MORPH_CLOSE, kernel)
    vote = (vote * valid).astype(np.uint8)
    _, labels, stats, _ = cv2.connectedComponentsWithStats(vote, 8)
    lid, best_area = 0, 0
    for s in seeds:
        q = int(labels[s[1], s[0]])
        if q and int(stats[q, cv2.CC_STAT_AREA]) > best_area:
            lid, best_area = q, int(stats[q, cv2.CC_STAT_AREA])
    if lid == 0:
        return None, "head silhouette consensus empty at every seed"
    x, y, bw, bh, area = (int(v) for v in stats[lid])
    if not plausible(x, y, bw, bh, area):
        return None, "merged head silhouette failed the plausibility gates"

    core = (labels == lid).astype(np.uint8)
    bx0, by0, bx1, by1 = float(x + x_lo), float(y + y_lo), float(x + bw + x_lo), float(y + bh + y_lo)
    # The shoulder cut truncates the jaw; the head certainly reaches its own landmarks.
    for n in head_kps:
        if not _visible(kps, n):
            continue
        kx, ky = kps[n]["x"] * w, kps[n]["y"] * h
        bx0, bx1 = min(bx0, kx), max(bx1, kx)
        by0, by1 = min(by0, ky), max(by1, ky)

    # The consensus above converges on the CRANIUM. On a down-the-line view the skull is
    # the dominant blob and the cap bill and the jaw are lower-contrast appendages hanging
    # off the front of it, so they drop out of every candidate threshold — and v5, which
    # fitted this mask, put the bill 15.1px OUTSIDE the ring on the backlit fixture. Grow
    # the component onto its appendages before anything is fitted to it.
    grown = _grow_head_appendages(core, lab, valid, r_kp)
    return {
        "bbox": (bx0, by0, bx1, by1),
        # Core (cranium) extent — the subject scale the stroke-width rule was calibrated
        # against and verified on. Deliberately NOT the grown extent: growing it would
        # silently fatten every stroke by ~20%.
        "w": bx1 - bx0, "h": by1 - by0,
        "cx": (bx0 + bx1) / 2.0, "cy": (by0 + by1) / 2.0,
        "roi": (x_lo, y_lo, x_hi, y_hi),
        "mask": grown,
        "core_mask": core,
    }, None


def _grow_head_appendages(core: "np.ndarray", lab: "np.ndarray", valid: "np.ndarray",
                          r_kp: float) -> "np.ndarray":
    """Grow the cranium component onto the cap bill and the jaw.

    Each pass dilates the component by HEAD_SEG_GROW_BAND x r_kp and admits band pixels
    that are closer, in Lab, to the HEAD's own colour than to the surrounding BACKGROUND's
    — a two-class nearest-centroid decided on a bounded band, so it can widen the mask
    onto an adjoining part of the same object but cannot run away into the scene. The
    background centroid is re-measured every pass from pixels well outside the current
    mask, which is what makes this work on both a head that is darker than its background
    (backlit sky) and one that is lighter (treeline, bay wall).

    Bounded three ways: at most HEAD_SEG_GROW_PASSES passes, a pass that admits fewer than
    0.5% of the core area stops the loop, and any growth beyond HEAD_SEG_GROW_MAX_AREA x
    the core area is discarded outright — a mask that doubled did not find a bill, it
    leaked, and the fit falls back to the cranium it can defend.
    """
    band = max(2, int(round(HEAD_SEG_GROW_BAND * r_kp)) | 1)
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (band * 2 + 1, band * 2 + 1))
    core_area = float(core.sum())
    if core_area <= 0:
        return core
    cur = core.copy()
    for _ in range(HEAD_SEG_GROW_PASSES):
        dil = cv2.dilate(cur, kern)
        band_px = (dil > 0) & (cur == 0)
        if not band_px.any():
            break
        far = cv2.dilate(cur, kern, iterations=3)
        bg_px = far == 0
        if bg_px.sum() < 32:
            break
        head_c = np.median(lab[cur > 0].reshape(-1, 3), axis=0)
        bg_c = np.median(lab[bg_px].reshape(-1, 3), axis=0)
        if float(np.linalg.norm(head_c - bg_c)) < HEAD_SEG_GROW_MIN_SEP:
            break   # head and background are the same colour here; growth would be noise
        d_head = np.linalg.norm(lab - head_c[None, None, :], axis=2)
        d_bg = np.linalg.norm(lab - bg_c[None, None, :], axis=2)
        admit = band_px & (d_head < d_bg) & (valid > 0)
        n_admit = int(admit.sum())
        if n_admit < 0.005 * core_area:
            break
        cur = (cur | admit.astype(np.uint8)).astype(np.uint8)
        if float(cur.sum()) > HEAD_SEG_GROW_MAX_AREA * core_area:
            return core     # leaked — keep the component we can defend
    # Close pinholes so a speckled jaw does not leave the min-enclosing circle chasing
    # an isolated pixel, then keep only the component still containing the core.
    cur = cv2.morphologyEx(cur, cv2.MORPH_CLOSE,
                           cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(cur, 8)
    keep = np.zeros_like(cur)
    for lid in set(int(v) for v in np.unique(labels[core > 0]) if v):
        keep |= (labels == lid).astype(np.uint8)
    return keep if keep.any() else core


def head_silhouette_edge(seg, cx: float, cy: float, deg: float, r_max: float):
    """Distance from (cx, cy) px to the silhouette edge along `deg`, or None.

    Returns None when the ray leaves the search box or exits through the shoulder cut
    rather than crossing a real edge — those bearings carry no information about fit.
    A real edge needs three consecutive background samples so single-pixel mask noise
    cannot be mistaken for the outline.
    """
    mask = seg["mask"]
    x_lo, y_lo = seg["roi"][0], seg["roi"][1]
    rh, rw = mask.shape
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    t, run, run_start = 0.0, 0, 0.0
    while t <= r_max:
        px = int(round(cx - x_lo + ca * t))
        py = int(round(cy - y_lo + sa * t))
        if not (0 <= px < rw and 0 <= py < rh):
            return None
        if mask[py, px] == 0:
            if run == 0:
                run_start = t
                if py >= rh - 2:       # exited through the shoulder cut, not an edge
                    return None
            run += 1
            if run >= 3:
                return run_start
        else:
            run = 0
        t += 0.5
    return None


def head_ring_margins(seg, kps, w: int, h: int, cx: float, cy: float, r: float,
                      bearings: int = HEAD_RING_MARGIN_BEARINGS,
                      exclude_deg: float = HEAD_RING_SHOULDER_EXCLUDE,
                      hull: bool = False):
    """[(bearing_deg, margin_px)] of empty background between the head and the ring.

    The 90-degree sector pointing at the shoulder midpoint is DISCARDED: that bearing runs
    down the neck, and a ring tangent to the neck is not a ring fitted to the head. Reading
    fit off those bearings is exactly how the v4 ring was passed as "already tangent".

    `hull=True` measures to the CONVEX HULL of the silhouette rather than to its raw
    outline. Use the raw outline to ask "does the ring CLIP the head" (a hull can bridge
    a concavity and hide a clip) and the hull to ask "is the ring LOOSE" (a raw outline
    charges the ring for concavities no circle can follow).
    """
    if hull and _HAS_CV2:
        pts = cv2.findNonZero(seg["mask"])
        if pts is not None:
            filled = np.zeros_like(seg["mask"])
            cv2.fillConvexPoly(filled, cv2.convexHull(pts), 1)
            seg = dict(seg, mask=filled)
    sh_x = (kps["left_shoulder"]["x"] + kps["right_shoulder"]["x"]) / 2.0 * w
    sh_y = (kps["left_shoulder"]["y"] + kps["right_shoulder"]["y"]) / 2.0 * h
    sh_deg = math.degrees(math.atan2(sh_y - cy, sh_x - cx)) % 360.0
    out = []
    for i in range(bearings):
        deg = 360.0 * i / bearings
        if abs((deg - sh_deg + 180.0) % 360.0 - 180.0) <= exclude_deg:
            continue
        d = head_silhouette_edge(seg, cx, cy, deg, r * 2.4)
        if d is None or d < HEAD_RING_MIN_EDGE * r:
            # The ring centre is inside the head by construction, so an "edge" a third of
            # a radius from it is a hole in the mask (a shadowed cheek that segmented as
            # background), not the head's outline. Reading fit off it would be fiction.
            continue
        out.append((deg, r - d))
    return out


def _head_circle(kps, view_label: str, w: int, h: int,
                 rgb: Optional["np.ndarray"] = None) -> Tuple[Optional[Dict[str, float]], Optional[str]]:
    """Circle around the WHOLE head at address. Radius PROPORTIONAL to detected head size.

    face_on: r = HEAD_RADIUS_FACTOR_FACE_ON x inter-ear distance
    dtl:     r = HEAD_RADIUS_FACTOR_DTL x (visible eye -> visible ear) distance

    The nose/eye/ear keypoints all sit on the FACE, i.e. low and (in profile) forward of
    the skull's center — a circle on their centroid clips the cap crown and the occiput.
    The center is therefore lifted by HEAD_CENTER_UP_SHIFT x r and, in profile views,
    shifted HEAD_CENTER_BACK_SHIFT x r away from the nose toward the back of the head.
    Returns (marking|None, failure_reason|None).
    """
    head_names = ["nose", "left_eye", "right_eye", "left_ear", "right_ear"]
    vis = [n for n in head_names if _visible(kps, n)]
    if len(vis) < 3:
        return None, f"too few confident head keypoints ({len(vis)}/5)"
    cx = float(np.mean([kps[n]["x"] for n in vis]))
    cy = float(np.mean([kps[n]["y"] for n in vis]))

    r_px = None
    if view_label == "face_on" and _visible(kps, "left_ear") and _visible(kps, "right_ear"):
        r_px = HEAD_RADIUS_FACTOR_FACE_ON * _dist_px(kps["left_ear"], kps["right_ear"], w, h)
    else:
        pairs = [("left_eye", "left_ear"), ("right_eye", "right_ear")]
        dists = [
            _dist_px(kps[e], kps[r], w, h)
            for e, r in pairs
            if _visible(kps, e) and _visible(kps, r)
        ]
        candidates = []
        if dists:
            candidates.append(HEAD_RADIUS_FACTOR_DTL * max(dists))  # occluded side foreshortens; larger pair
        if _visible(kps, "nose"):
            nose_ear = [
                _dist_px(kps["nose"], kps[n], w, h)
                for n in ("left_ear", "right_ear")
                if _visible(kps, n)
            ]
            if nose_ear:
                candidates.append(HEAD_RADIUS_FACTOR_DTL_NOSE_EAR * max(nose_ear))
        if candidates:
            r_px = max(candidates)
    if not r_px or r_px <= 1:
        return None, "head size not measurable (no confident ear/eye pair)"
    r_upper = r_px  # factor-derived value is now only an UPPER BOUND

    # Lift the center off the face centroid toward the skull center: up always; back
    # (away from the nose, toward the visible ear side) in non-face-on views.
    cy -= HEAD_CENTER_UP_SHIFT * r_px / h
    if view_label != "face_on":
        ears = [n for n in ("left_ear", "right_ear") if _visible(kps, n)]
        if ears:
            back_dx = float(np.mean([kps[n]["x"] for n in ears])) - kps["nose"]["x"]
            if abs(back_dx) > 1e-6:
                cx += math.copysign(HEAD_CENTER_BACK_SHIFT * r_px / w, back_dx)

    # --- fit the radius to the head's ACTUAL extent -------------------------
    # The factor-derived radius reliably CONTAINS the head but overshoots real heads by
    # ~1.5x, which reads as clip-art. Measure from the (already lifted/shifted) centre to
    # the farthest confident head keypoint, extend by a crown allowance because every
    # keypoint sits on the FACE while the skull continues above and behind it, then add a
    # small margin. Clamped to the factor radius so this can only ever tighten the ring.
    far = max(_dist_px(kps[n], {"x": cx, "y": cy, "score": 1}, w, h) for n in vis)
    r_fit = (far * (1.0 + HEAD_FIT_CROWN_ALLOWANCE)) * (1.0 + HEAD_FIT_MARGIN)
    r_px = max(1.0, min(r_upper, r_fit))

    # --- RE-CENTRE on the head's own silhouette, THEN fit --------------------
    # The keypoint anchor above is built from FACE landmarks and therefore sits forward
    # and low of the skull centre. Shrinking about it clips the face while leaving the
    # back of the head empty, which is why v4's radius never moved. Re-centring first
    # removes that constraint. Fail soft: any failure keeps the keypoint circle.
    head_w = head_h = None
    fit_source = "keypoints"
    if rgb is not None:
        seg, _why = _segment_head_silhouette(rgb, kps, w, h, cx * w, cy * h, r_upper,
                                             view_label)
        if seg is not None:
            # MINIMUM ENCLOSING CIRCLE of the grown silhouette, together with every
            # confident face keypoint (the shoulder cut truncates the jaw, so the mask
            # alone under-reports the head's lower extent). Plus a small pad.
            #
            # This is the whole of the v6 ring change: v5's "centre on the bbox centroid,
            # radius from the bbox diagonal" cannot enclose a head-plus-bill silhouette,
            # because that shape is not centred on its own bounding box. A minimum
            # enclosing circle is by definition the smallest circle that contains
            # everything, which is exactly the specification for this ring.
            ys, xs = np.nonzero(seg["mask"])
            if len(xs):
                rx, ry = seg["roi"][0], seg["roi"][1]
                pts = [(float(px) + rx, float(py) + ry) for px, py in zip(xs, ys)]
                for n in vis:
                    pts.append((kps[n]["x"] * w, kps[n]["y"] * h))
                (mx, my), mr = cv2.minEnclosingCircle(np.asarray(pts, dtype=np.float32))
                r_new = float(mr) + HEAD_FIT_MEC_PAD
                # A fit far larger than the keypoint-derived radius is not a head; the
                # mask leaked. Keep the v4 circle rather than ship an unverified fit.
                if r_new <= HEAD_FIT_MEC_MAX * r_upper and r_new > 1.0:
                    cx, cy, r_px = float(mx) / w, float(my) / h, r_new
                    head_w, head_h = seg["w"], seg["h"]
                    fit_source = "silhouette"

    # Anatomical sanity gates (research §2.1): every confident face keypoint must sit
    # inside the ring with margin; diameter plausible vs torso.
    for n in vis:
        d = _dist_px(kps[n], {"x": cx, "y": cy, "score": 1}, w, h)
        if d > HEAD_KP_MAX_DIST * r_px:
            return None, f"sanity gate: {n} outside candidate head circle (d/r {d / r_px:.2f})"
    torso = _dist_px(
        _mid(kps["left_shoulder"], kps["right_shoulder"]),
        _mid(kps["left_hip"], kps["right_hip"]), w, h)
    ratio = (2 * r_px) / torso if torso > 0 else 99.0
    if not (HEAD_DIAMETER_TORSO_MIN <= ratio <= HEAD_DIAMETER_TORSO_MAX):
        return None, f"sanity gate: head diameter/torso ratio {ratio:.2f} outside [{HEAD_DIAMETER_TORSO_MIN}, {HEAD_DIAMETER_TORSO_MAX}]"

    conf = float(np.mean([kps[n]["score"] for n in vis]))
    if conf < HEAD_MIN_CONFIDENCE:
        return None, f"head keypoint confidence {conf:.2f} < {HEAD_MIN_CONFIDENCE}"
    out = {"cx": cx, "cy": cy, "r": r_px / w, "confidence": round(conf, 4),
           "fit": fit_source}
    if head_w is not None:
        # The measured subject scale: stroke weights key off THIS, not off frame width,
        # so a 320px source and a 1080px source read as one graphics package.
        out["head_w"] = head_w / w
        out["head_h"] = head_h / w
    return out, None


# ---------------------------------------------------------------------------
# Spine line (DTL only)
# ---------------------------------------------------------------------------
def _spine_line(kps, w: int, h: int,
                head: Optional[Dict[str, float]] = None) -> Tuple[Optional[Dict[str, float]], Optional[str]]:
    """Hip midpoint through shoulder midpoint. The top end is clamped to stop SHORT of
    the jaw/head circle: with a head circle, the tip keeps SPINE_TOP_GAP x r clearance
    from its center; without one, the extension past the shoulders stays conservative."""
    ls, rs, lh, rh = (kps[n] for n in ("left_shoulder", "right_shoulder", "left_hip", "right_hip"))
    conf = float(np.mean([p["score"] for p in (ls, rs, lh, rh)]))
    if conf < SPINE_MIN_CONFIDENCE:
        return None, f"shoulder/hip confidence {conf:.2f} < {SPINE_MIN_CONFIDENCE}"
    hip_mid, sh_mid = _mid(lh, rh), _mid(ls, rs)
    # Extend: slightly below the hip, and beyond the shoulders toward the head.
    dx, dy = sh_mid["x"] - hip_mid["x"], sh_mid["y"] - hip_mid["y"]
    if math.hypot(dx * w, dy * h) < 0.02 * max(w, h):
        return None, "torso too short for a spine line"

    t_top = 1.0 + (SPINE_EXTEND_BEYOND_SHOULDER if head else SPINE_EXTEND_NO_HEAD)
    if head:
        # Largest t (down to SPINE_MIN_EXTENT of the torso) keeping the tip at least
        # SPINE_TOP_GAP x r away from the head-circle center (px space) — the tip must
        # stop short of the jaw even when the circle dips below the shoulder line.
        hx, hy = hip_mid["x"] * w, hip_mid["y"] * h
        dxp, dyp = dx * w, dy * h
        cxp, cyp = head["cx"] * w, head["cy"] * h
        min_gap = SPINE_TOP_GAP * head["r"] * w
        while t_top > SPINE_MIN_EXTENT and math.hypot(hx + t_top * dxp - cxp, hy + t_top * dyp - cyp) < min_gap:
            t_top -= 0.01
    return {
        "x1": hip_mid["x"] - SPINE_EXTEND_BELOW_HIP * dx, "y1": hip_mid["y"] - SPINE_EXTEND_BELOW_HIP * dy,
        "x2": hip_mid["x"] + t_top * dx, "y2": hip_mid["y"] + t_top * dy,
        "confidence": round(conf, 4),
    }, None


# ---------------------------------------------------------------------------
# Shoulder line (face-on only)
# ---------------------------------------------------------------------------
def _shoulder_line(kps, w: int, h: int) -> Tuple[Optional[Dict[str, float]], Optional[str]]:
    """Acromion to acromion — the shoulder tilt at address.

    Face-on only: down the line the two shoulders project onto each other and the segment
    collapses to a point, which is why the DTL views get the spine and the plane instead.
    A face-on frame that carries only a head ring is not a telestration; shoulder tilt is
    the standard face-on setup read and pose detects it directly.
    """
    ls, rs = kps["left_shoulder"], kps["right_shoulder"]
    conf = float(min(ls["score"], rs["score"]))
    if conf < SHOULDER_MIN_CONFIDENCE:
        return None, f"shoulder confidence {conf:.2f} < {SHOULDER_MIN_CONFIDENCE}"
    span = _dist_px(ls, rs, w, h)
    torso = _dist_px(_mid(ls, rs), _mid(kps["left_hip"], kps["right_hip"]), w, h)
    if torso <= 1 or span < SHOULDER_MIN_SPAN * torso:
        return None, f"shoulder span {span:.0f}px too short vs torso {torso:.0f}px (view too oblique)"
    dx, dy = ls["x"] - rs["x"], ls["y"] - rs["y"]
    return {
        "x1": rs["x"] - SHOULDER_EXTEND * dx, "y1": rs["y"] - SHOULDER_EXTEND * dy,
        "x2": ls["x"] + SHOULDER_EXTEND * dx, "y2": ls["y"] + SHOULDER_EXTEND * dy,
        "confidence": round(conf, 4),
    }, None


# ---------------------------------------------------------------------------
# Shaft + ball detection (DTL, classical CV, confidence gated — research §2.2/2.3)
# ---------------------------------------------------------------------------
def _detect_shaft(gray: np.ndarray, kps, facing: str, w: int, h: int):
    """HoughLinesP in a wrist-anchored ROI. Returns (shaft dict|None, reason|None)."""
    # Hands overlap at address, so the far wrist is often low-confidence; anchor on the
    # midpoint when both wrists are confident, else on the better wrist alone.
    lw, rw = kps["left_wrist"], kps["right_wrist"]
    if _visible(kps, "left_wrist") and _visible(kps, "right_wrist"):
        anchor = _mid(lw, rw)
    else:
        anchor = lw if lw["score"] >= rw["score"] else rw
        if anchor["score"] < 0.25:
            return None, "wrist keypoints not confident enough to anchor shaft search"
    wx, wy = _px(anchor, w, h)
    ank_y = max(kps["left_ankle"]["y"], kps["right_ankle"]["y"]) * h
    ground_y = min(h - 1, ank_y + 0.06 * h)

    sign = 1.0 if facing == "right" else -1.0
    x_lo = wx - 0.10 * w if sign > 0 else wx - 0.55 * w
    x_hi = wx + 0.55 * w if sign > 0 else wx + 0.10 * w
    y_lo, y_hi = wy - 0.04 * h, ground_y
    x_lo, x_hi = max(0, int(x_lo)), min(w - 1, int(x_hi))
    y_lo, y_hi = max(0, int(y_lo)), min(h - 1, int(y_hi))
    if x_hi - x_lo < 20 or y_hi - y_lo < 20:
        return None, "shaft ROI degenerate"

    roi = gray[y_lo:y_hi, x_lo:x_hi]
    edges = cv2.Canny(roi, 40, 120, apertureSize=3)
    min_len = SHAFT_MIN_LEN * max(1.0, (ank_y - wy))
    lines = cv2.HoughLinesP(
        edges, rho=1, theta=np.pi / 360, threshold=30,
        minLineLength=int(max(15, min_len)), maxLineGap=8,
    )
    if lines is None:
        return None, "no line segments found in wrist-anchored ROI"

    diag = math.hypot(w, h)
    best, best_score = None, 0.0
    for (x1, y1, x2, y2) in np.asarray(lines).reshape(-1, 4):
        gx1, gy1, gx2, gy2 = x1 + x_lo, y1 + y_lo, x2 + x_lo, y2 + y_lo
        if gy1 > gy2:  # order: (1) = upper endpoint
            gx1, gy1, gx2, gy2 = gx2, gy2, gx1, gy1
        seg_len = math.hypot(gx2 - gx1, gy2 - gy1)
        if seg_len < 10:
            continue
        angle = math.degrees(math.atan2(gy2 - gy1, abs(gx2 - gx1)))
        if not (SHAFT_ANGLE_MIN_DEG <= angle <= SHAFT_ANGLE_MAX_DEG):
            continue
        if sign * (gx2 - gx1) < 0:  # must run from hands toward the ball side
            continue
        up_dist = math.hypot(gx1 - wx, gy1 - wy)
        if up_dist > SHAFT_WRIST_MAX_DIST * diag:
            continue
        score = seg_len * (1.0 - up_dist / (SHAFT_WRIST_MAX_DIST * diag))
        if score > best_score:
            best_score = score
            best = (gx1, gy1, gx2, gy2, seg_len, up_dist)
    if best is None:
        return None, "no plausible shaft segment (angle/direction/wrist-proximity gates)"

    gx1, gy1, gx2, gy2, seg_len, up_dist = best
    # Confidence: longer segments anchored close to the hands are more trustworthy.
    conf = min(1.0, seg_len / (0.9 * max(1.0, ank_y - wy))) * (1.0 - 0.5 * up_dist / (SHAFT_WRIST_MAX_DIST * diag))
    return {
        "x1": float(gx1) / w, "y1": float(gy1) / h, "x2": float(gx2) / w, "y2": float(gy2) / h,
        "confidence": round(float(conf), 4),
    }, None


def _detect_ball(rgb: np.ndarray, cx: float, cy: float, w: int, h: int, shaft_len_px: float):
    """Bright-blob ball detection in a ROI around the shaft's lower endpoint (cx, cy).

    A golf ball at address is a small, compact, near-white (or bright yellow) blob —
    the brightest round thing next to the clubhead. Hough circles are unreliable at
    r = 3-12 px, so this thresholds max-channel brightness (catches white AND yellow
    balls) and gates candidates on size, aspect, fill and contour circularity.

    Returns (candidates, reason): score-ranked list of candidate dicts (best first) so the
    caller can take the first one that also confirms against the shaft line; empty list
    with a reason when nothing passes the gates.
    """
    bright = rgb.max(axis=2)  # max over RGB: white and yellow balls are both near-max here
    r_min = max(2, int(BALL_MIN_R * w))
    r_max = max(r_min + 2, int(BALL_MAX_R * w))
    half = int(max(0.08 * w, 0.55 * shaft_len_px))
    x_lo, x_hi = max(0, int(cx - half)), min(w, int(cx + half))
    y_lo, y_hi = max(0, int(cy - half)), min(h, int(cy + half))
    if x_hi - x_lo < 4 * r_min or y_hi - y_lo < 4 * r_min:
        return None, "ball ROI degenerate"
    roi = bright[y_lo:y_hi, x_lo:x_hi]

    p_hi = float(np.percentile(roi, 99.9))
    if p_hi < BALL_MIN_BRIGHTNESS:
        return [], f"no near-white pixels in ROI (p99.9 brightness {p_hi:.0f} < {BALL_MIN_BRIGHTNESS:.0f})"

    candidates: List[Tuple[float, Dict[str, float]]] = []
    min_area = max(4.0, 0.30 * math.pi * r_min * r_min)
    max_area = 1.4 * math.pi * r_max * r_max
    kernel = np.ones((3, 3), np.uint8)
    # The ball is often part-shadowed, so no single threshold segments it cleanly;
    # sweep a few thresholds, and also an eroded variant of each mask (the ball frequently
    # touches a bright clubhead glint via a thin bridge that erosion splits).
    masks = []
    for factor in (0.90, 0.82, 0.72, 0.62):
        thr = max(BALL_MIN_BRIGHTNESS, factor * p_hi)
        mask = (roi >= thr).astype(np.uint8)
        masks.append((mask, 0.0))
        masks.append((cv2.erode(mask, kernel), 1.0))  # r correction ~1px after erosion
    for mask, r_corr in masks:
        n, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
        for i in range(1, n):
            area = float(stats[i, cv2.CC_STAT_AREA])
            if not (min_area <= area <= max_area):
                continue
            bw, bh = float(stats[i, cv2.CC_STAT_WIDTH]), float(stats[i, cv2.CC_STAT_HEIGHT])
            if not (0.45 <= bw / bh <= 2.2):
                continue
            if area / (bw * bh) < 0.35:
                continue
            comp = (labels == i).astype(np.uint8)
            contours, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            if not contours:
                continue
            per = cv2.arcLength(contours[0], True)
            circ = 4.0 * math.pi * area / (per * per) if per > 0 else 0.0
            if circ < BALL_MIN_CIRCULARITY:
                continue
            bx, by = centroids[i]
            r_est = math.sqrt(area / math.pi) + r_corr
            # Brightness margin vs an expanded neighborhood (excluding the blob itself).
            pad = int(max(3, 2.0 * r_est))
            nx_lo, nx_hi = max(0, int(bx - pad * 2)), min(roi.shape[1], int(bx + pad * 2))
            ny_lo, ny_hi = max(0, int(by - pad * 2)), min(roi.shape[0], int(by + pad * 2))
            neigh = roi[ny_lo:ny_hi, nx_lo:nx_hi]
            neigh_mask = comp[ny_lo:ny_hi, nx_lo:nx_hi] == 0
            if neigh_mask.sum() < 8:
                continue
            mean_in = float(roi[comp == 1].mean())
            mean_out = float(neigh[neigh_mask].mean())
            margin = mean_in - mean_out
            if margin < BALL_BRIGHTNESS_MARGIN:
                continue
            proximity = 1.0 - min(1.0, math.hypot(bx + x_lo - cx, by + y_lo - cy) / half)
            score = margin * (0.4 + 0.6 * proximity) * min(1.0, circ + 0.3)
            conf = min(1.0, margin / 60.0) * (0.5 + 0.5 * proximity) * min(1.0, circ + 0.3)
            candidates.append((float(score), {
                "x": float(bx + x_lo) / w, "y": float(by + y_lo) / h, "r": float(r_est) / w,
                "confidence": round(float(conf), 4),
            }))
    if not candidates:
        return [], "no compact bright blob passed size/circularity/brightness gates"
    # Rank by score, then dedupe blobs re-detected at multiple thresholds (keep best-scored).
    candidates.sort(key=lambda sc: -sc[0])
    unique: List[Dict[str, float]] = []
    for _, cand in candidates:
        if any(math.hypot((cand["x"] - u["x"]) * w, (cand["y"] - u["y"]) * h)
               < 2.0 * max(cand["r"], u["r"], 2.0 / w) * w for u in unique):
            continue
        unique.append(cand)
        if len(unique) >= 5:
            break
    return unique, None


def _measure_ball_radius(rgb: "np.ndarray", ball: Dict[str, float], w: int, h: int
                         ) -> Tuple[Optional[float], Optional[Tuple[float, float]], str, str]:
    """(radius_px | None, centre_px | None, verdict, reason) for the detected blob.

    `verdict` is the part the node gate actually reasons about:
      "measured"    — a radius was obtained and survived every consistency check
      "refuted"     — the measurement ACTIVELY CONTRADICTS the ball hypothesis: the blob
                      is not a disc, or it is a bright patch on a larger bright object
      "unavailable" — no measurement was possible at all (no cv2, degenerate window, too
                      little contrast to measure anything)

    The distinction is load-bearing. "Refuted" and "unavailable" both yield r=None, but
    only "unavailable" may fall back to gating on confidence alone: at 320px the clubhead
    crown is detected with confidence 0.91, and treating "that blob is a highlight on
    something bigger" as a mere absence of evidence put a filled node straight back onto
    the club.

    THREE versions of this estimator have now been wrong, so this one refuses rather than
    guesses. v3/v4 measured the specular CORE (2.3px against a ~15px teed ball on the
    backlit fixture). v5 added half-max refinement, which did not move the number at all,
    and the reason is visible in the pixels: on that fixture the ball is DARKER than the
    mat it sits on and only its rim highlight is bright, so a brightness blob centred
    there measures the highlight however it is thresholded. On the oblique fixture the
    blob is a facet of the clubhead crown and there is no ball within 85px.

    A brightness-blob radius is therefore not a measurement of a ball; it is a
    measurement of whatever highlight the detector locked onto. So a radius is returned
    ONLY when the blob is self-evidently a free-standing bright disc:

      * its half-max component is closed inside the measurement window (a component that
        touches the window edge is part of something larger),
      * it is roughly circular by contour, and
      * brightness falls back to the local floor on EVERY octant within 2x the estimated
        radius — a rim highlight fails this, because the object it sits on continues.

    Anything else returns None with a reason, and the caller gates the node on confidence
    alone rather than on a number it cannot defend. Shipping a fourth confident-looking
    wrong number would be worse than shipping no number.
    """
    if not _HAS_CV2:
        return None, None, "unavailable", "opencv unavailable: ball radius not measurable"
    bright = rgb.max(axis=2).astype(np.float32)
    bx, by, r0 = ball["x"] * w, ball["y"] * h, max(1.5, ball["r"] * w)
    pad = int(max(10, 8.0 * r0))
    x_lo, x_hi = int(max(0, bx - pad)), int(min(w, bx + pad + 1))
    y_lo, y_hi = int(max(0, by - pad)), int(min(h, by + pad + 1))
    if x_hi - x_lo < 8 or y_hi - y_lo < 8:
        return None, None, "unavailable", "ball radius window degenerate"
    roi = bright[y_lo:y_hi, x_lo:x_hi]
    yy, xx = np.mgrid[y_lo:y_hi, x_lo:x_hi]
    rad = np.hypot(xx - bx, yy - by)
    core, surround = rad <= max(1.0, 0.8 * r0), (rad >= 3.0 * r0) & (rad <= 5.0 * r0)
    if core.sum() < 1 or surround.sum() < 8:
        return None, None, "unavailable", "ball radius window has no measurable surround"
    peak, floor = float(roi[core].mean()), float(np.median(roi[surround]))
    if peak - floor < BALL_BRIGHTNESS_MARGIN:
        return None, None, "unavailable", (
            f"blob is only {peak - floor:.0f} brighter than its surround "
            f"(need {BALL_BRIGHTNESS_MARGIN:.0f}) — radius not measurable")

    mask = (roi >= (peak + floor) / 2.0).astype(np.uint8)
    n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
    lid = int(labels[int(round(by)) - y_lo, int(round(bx)) - x_lo])
    if lid == 0:
        return None, None, "refuted", "half-max component empty at the detection centre"
    bxx, byy = int(stats[lid, cv2.CC_STAT_LEFT]), int(stats[lid, cv2.CC_STAT_TOP])
    bw, bh = int(stats[lid, cv2.CC_STAT_WIDTH]), int(stats[lid, cv2.CC_STAT_HEIGHT])
    if bxx <= 0 or byy <= 0 or bxx + bw >= mask.shape[1] or byy + bh >= mask.shape[0]:
        return None, None, "refuted", "half-max blob runs out of the window — it is part of something larger"
    area = float(stats[lid, cv2.CC_STAT_AREA])
    r_new = math.sqrt(area / math.pi)
    # NOTE: no ball-size plausibility test here, deliberately. Whether a measured radius
    # is ball-sized is the NODE GATE's question (_ball_node_ok); folding it in here would
    # turn "this blob is 1.3px across" — a perfectly sound measurement, and the one that
    # proves the 320px detection is not a ball — into "radius unmeasurable", which the
    # gate then treats as license to fall back to confidence alone. That inversion put a
    # node back on the clubhead at 320px on the first cut of this change.
    comp = (labels == lid).astype(np.uint8)
    contours, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None, None, "refuted", "half-max blob has no contour"
    per = cv2.arcLength(contours[0], True)
    circ = 4.0 * math.pi * area / (per * per) if per > 0 else 0.0
    if circ < 0.60:
        return None, None, "refuted", f"half-max blob circularity {circ:.2f} < 0.60 — not a disc"
    cxn, cyn = float(cents[lid][0]) + x_lo, float(cents[lid][1]) + y_lo
    if math.hypot(cxn - bx, cyn - by) > 1.5 * r_new:
        return None, None, "refuted", "half-max centroid inconsistent with the detection centre"

    # Free-standing check: on a real ball the brightness has returned to the local floor
    # all the way round by 2r. On a highlight sitting on a clubhead (or on the lit rim of
    # a dull ball) at least one octant is still bright, because the object continues.
    cutoff = floor + BALL_R_FALL_FRAC * (peak - floor)
    probe = 2.0 * r_new
    for k in range(BALL_R_OCTANTS):
        a = 2.0 * math.pi * k / BALL_R_OCTANTS
        px = int(round(cxn + probe * math.cos(a)))
        py = int(round(cyn + probe * math.sin(a)))
        if not (0 <= px < w and 0 <= py < h):
            return None, None, "refuted", "ball radius probe left the frame"
        if bright[py, px] > cutoff:
            return None, None, "refuted", (
                f"blob is still bright at 2r on bearing {math.degrees(a):.0f}deg "
                f"— a highlight ON something, not a free-standing ball")
    return r_new, (cxn, cyn), "measured", ""


def _ball_node_ok(ball: Optional[Dict[str, float]], w: int) -> Tuple[bool, str]:
    """Whether the detection is trustworthy enough to carry an anchor NODE.

    Three ways to fail, in order of how much they tell us:
      1. the radius measurement REFUTED the ball hypothesis  -> no node, at any confidence
      2. detection confidence below BALL_NODE_MIN_CONFIDENCE -> no node
      3. a measured radius outside [BALL_NODE_R_MIN, BALL_NODE_R_MAX] x W -> no node
    When no radius could be measured AT ALL (verdict "unavailable") the gate falls back
    to confidence alone rather than inventing a number to test.
    """
    if not ball:
        return False, "no ball detected"
    if ball.get("r_verdict") == "refuted":
        return False, (f"node withheld — the detection is not a ball: "
                       f"{ball.get('r_reason') or 'radius measurement refuted'}")
    conf = float(ball.get("confidence") or 0.0)
    if conf < BALL_NODE_MIN_CONFIDENCE:
        return False, (f"ball detection confidence {conf:.2f} < {BALL_NODE_MIN_CONFIDENCE} — "
                       f"node withheld (the detection may not be a ball)")
    r = ball.get("r")
    if r is None:
        return True, ""
    if not (BALL_NODE_R_MIN <= r <= BALL_NODE_R_MAX):
        return False, (f"ball radius {r:.5f}W outside [{BALL_NODE_R_MIN}, {BALL_NODE_R_MAX}]W "
                       f"— node withheld (the detection is not ball-sized)")
    return True, ""


def _ball_confirms_shaft(ball, shaft, w, h) -> Tuple[bool, str]:
    """Mutual confirmation: the ball must sit ON the shaft line, near its lower endpoint."""
    x1, y1 = shaft["x1"] * w, shaft["y1"] * h
    x2, y2 = shaft["x2"] * w, shaft["y2"] * h
    bx, by, br = ball["x"] * w, ball["y"] * h, ball["r"] * w
    dx, dy = x2 - x1, y2 - y1
    seg_len = math.hypot(dx, dy)
    if seg_len < 1:
        return False, "shaft segment degenerate"
    ux, uy = dx / seg_len, dy / seg_len
    rx, ry = bx - x2, by - y2
    perp = abs(rx * uy - ry * ux)
    along = rx * ux + ry * uy  # signed distance beyond the lower endpoint
    # Perpendicular tolerance grows with distance from the hands-side anchor: a small angular
    # error in the Hough line fans out over the extension toward the ball.
    dist_from_anchor = seg_len + max(0.0, along)
    perp_max = max(3.0 * br, BALL_SHAFT_PERP_MAX * w,
                   math.tan(math.radians(BALL_SHAFT_ANGLE_TOL_DEG)) * dist_from_anchor)
    if perp > perp_max:
        return False, f"ball is {perp:.0f}px off the shaft line (max {perp_max:.0f}px)"
    lo, hi = BALL_ALONG_RANGE[0] * seg_len, BALL_ALONG_RANGE[1] * seg_len
    if not (lo <= along <= hi):
        return False, f"ball is {along:.0f}px along the shaft from the clubhead end (allowed {lo:.0f}..{hi:.0f}px)"
    return True, ""


def _plane_line(shaft, ball, head, kps, w, h) -> Tuple[Optional[Dict[str, float]], Optional[str]]:
    """Plane line (DTL): the DETECTED SHAFT's own direction, anchored at the detected ball.

    The line's angle IS the Hough shaft segment's angle — never a ball->body construction
    (a ball->shoulder line measured 13-16 deg steeper than the real shaft on eval).
    Extent is clamped: bottom end just past the ball (never through the clubhead into the
    mat), top end just above head height (never into sky/roof), and both ends inside the
    frame with PLANE_EDGE_MARGIN. The caller has already gated shaft confidence.
    """
    # Shaft direction, hands-ward (upward): endpoint 1 is the upper/hands end by contract.
    sdx = (shaft["x1"] - shaft["x2"]) * w
    sdy = (shaft["y1"] - shaft["y2"]) * h
    seg_len = math.hypot(sdx, sdy)
    if seg_len < 1:
        return None, "shaft segment degenerate"
    ux, uy = sdx / seg_len, sdy / seg_len
    if uy >= -1e-3:
        return None, "shaft direction not upward"

    bx, by = ball["x"] * w, ball["y"] * h

    # Bottom end: ON the anchor, not past it. v5 drew the node at the ball but left the
    # line's own endpoint where v4 had put it — PLANE_BOTTOM_OVERSHOOT past the ball —
    # so the stroke poked 19.2px out beyond its own terminus on both 1080 fixtures. A
    # measurement ends where it is anchored, so t_bot is now 0 by construction and the
    # overshoot constants below only survive as the in-frame clamp.
    t_bot = 0.0
    t_bot = max(t_bot, ((1.0 - PLANE_EDGE_MARGIN) * h - by) / uy)  # uy < 0: y <= 1-margin
    if ux > 0:
        t_bot = max(t_bot, (PLANE_EDGE_MARGIN * w - bx) / ux)
    elif ux < 0:
        t_bot = max(t_bot, ((1.0 - PLANE_EDGE_MARGIN) * w - bx) / ux)
    t_bot = min(t_bot, 0.0)

    # Top end: run to the frame-edge clamp. v5 stopped it just above head height, which on
    # the oblique fixture put the terminus at x = 0.199W — fading out in the middle of
    # empty sky with nothing at the end, which reads as the renderer running out of line.
    # Broadcast plane lines run off the frame or stop on a landmark, so the line now runs
    # to PLANE_EDGE_MARGIN on whichever edge it reaches first...
    t_top = float("inf")
    if ux < 0:
        t_top = min(t_top, (PLANE_EDGE_MARGIN * w - bx) / ux)
    elif ux > 0:
        t_top = min(t_top, ((1.0 - PLANE_EDGE_MARGIN) * w - bx) / ux)
    t_top = min(t_top, (PLANE_EDGE_MARGIN * h - by) / uy)  # uy < 0: y >= margin
    # ...unless the head ring is in the way, in which case the ring IS the landmark and
    # the line stops clear of it rather than crossing another marking.
    if head:
        cxp, cyp = head["cx"] * w, head["cy"] * h
        clear = head["r"] * w + PLANE_TOP_CLEARANCE * head["r"] * w
        # nearest approach of the ray (bx,by)+t*(ux,uy) to the ring centre
        t_near = (cxp - bx) * ux + (cyp - by) * uy
        if t_near > 0:
            d_near = math.hypot(bx + t_near * ux - cxp, by + t_near * uy - cyp)
            if d_near < clear:
                back = math.sqrt(max(0.0, clear * clear - d_near * d_near))
                t_top = min(t_top, t_near - back)
    if not math.isfinite(t_top) or t_top < 0.10 * h:
        return None, "clamped plane line degenerate (top end reaches no higher than the ball)"

    conf = float(min(1.0, min(shaft["confidence"], ball["confidence"])))
    return {
        "x1": (bx + t_bot * ux) / w, "y1": (by + t_bot * uy) / h,   # bottom: ON the anchor
        "x2": (bx + t_top * ux) / w, "y2": (by + t_top * uy) / h,   # top: frame edge / ring
        "confidence": round(conf, 4),
    }, None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def analyze_setup(address_frame_path: str) -> SetupGeometry:
    """Analyze the ADDRESS frame and derive all static markings for the swing.

    Runs pose once, classifies the camera view, attempts shaft+ball detection (DTL only),
    and constructs normalized geometry. Any marking whose inputs fail a confidence or
    sanity gate is withheld, with the reason recorded in `failures` (fail closed).
    """
    img = ImageOps.exif_transpose(Image.open(address_frame_path)).convert("RGB")
    w, h = img.size
    kps = _run_pose(img)
    rgb = np.asarray(img)

    failures: List[Dict[str, str]] = []
    markings: Dict[str, Dict[str, float]] = {}
    view: Dict[str, object] = {"label": "unknown", "confidence": 0.0, "spread_ratio": 0.0}
    facing = None
    ball = shaft = None
    ALL = ("head_circle", "spine_line", "shoulder_line", "plane_line")

    ok, reason = _person_present(kps, w, h)
    if not ok:
        for m in ALL:
            failures.append({"marking": m, "reason": f"no reliable pose: {reason}"})
        return SetupGeometry(MARKER_VERSION, w, h, _round_floats(kps), view, facing,
                             ball, shaft, markings, failures)

    view = _classify_view(kps, w, h)
    view_ok = view["confidence"] >= VIEW_MIN_CONFIDENCE

    # --- head circle: legal in both views; requires only a confident view-independent pose,
    # but the radius rule differs per view, so an ambiguous view still withholds it.
    if view_ok:
        head, why = _head_circle(kps, view["label"], w, h, rgb if _HAS_CV2 else None)
        if head:
            markings["head_circle"] = head
        else:
            failures.append({"marking": "head_circle", "reason": why})
    else:
        failures.append({"marking": "head_circle",
                         "reason": f"view ambiguous (confidence {view['confidence']:.2f} < {VIEW_MIN_CONFIDENCE})"})

    # --- spine: BOTH views. Down the line it reads as forward bend; face-on it reads as
    # spine tilt away from the target, which is standard telestration and uses the same
    # shoulder-midpoint -> hip-midpoint segment. Only the PLANE line is DTL-only: it is
    # built from a detected shaft, which face-on foreshortens into the body.
    if not view_ok:
        for m in ("spine_line", "shoulder_line", "plane_line"):
            failures.append({"marking": m,
                             "reason": f"view ambiguous (confidence {view['confidence']:.2f} < {VIEW_MIN_CONFIDENCE})"})
    else:
        spine, why = _spine_line(kps, w, h, markings.get("head_circle"))
        if spine:
            markings["spine_line"] = spine
        else:
            failures.append({"marking": "spine_line", "reason": why})

    # --- shoulder line: face-on only (DTL projects it onto a point).
    if view_ok and view["label"] == "face_on":
        shoulder, why = _shoulder_line(kps, w, h)
        if shoulder:
            markings["shoulder_line"] = shoulder
        else:
            failures.append({"marking": "shoulder_line", "reason": why})
    elif view_ok:
        failures.append({"marking": "shoulder_line",
                         "reason": f"view={view['label']}: shoulder_line is face-on-only"})

    # --- plane: DTL only.
    if not view_ok:
        pass
    elif view["label"] != "dtl":
        failures.append({"marking": "plane_line",
                         "reason": f"view={view['label']}: plane_line is DTL-only"})
    else:
        facing = _facing_direction(kps)
        if facing is None:
            failures.append({"marking": "plane_line", "reason": "cannot determine facing direction from pose"})
        elif not _HAS_CV2:
            failures.append({"marking": "plane_line", "reason": "opencv unavailable: shaft/ball detection disabled"})
        else:
            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
            shaft, why = _detect_shaft(gray, kps, facing, w, h)
            if shaft is None:
                failures.append({"marking": "plane_line", "reason": f"shaft not detected: {why}"})
            elif shaft["confidence"] < SHAFT_MIN_CONFIDENCE:
                # FAIL CLOSED: an untrusted shaft fit withholds the plane line outright —
                # never a ball->body fallback (measured 13-16 deg off the real shaft).
                failures.append({"marking": "plane_line",
                                 "reason": f"shaft fit low-confidence ({shaft['confidence']:.2f} < "
                                           f"{SHAFT_MIN_CONFIDENCE}) — plane line withheld, no fallback"})
            else:
                lx, ly = shaft["x2"] * w, shaft["y2"] * h  # lower (clubhead-side) endpoint
                shaft_len = math.hypot((shaft["x2"] - shaft["x1"]) * w, (shaft["y2"] - shaft["y1"]) * h)
                cands, why = _detect_ball(rgb, lx, ly, w, h, shaft_len)
                # Take the best-scored candidate that also sits on the shaft line (mutual confirmation).
                ball, reject_why = None, why
                for cand in cands:
                    ok, cwhy = _ball_confirms_shaft(cand, shaft, w, h)
                    if ok:
                        ball = cand
                        break
                    reject_why = cwhy
                if ball is None:
                    failures.append({"marking": "plane_line",
                                     "reason": f"no ball confirmed at clubhead — refusing to guess ({reject_why})"})
                else:
                    # Re-measure the radius, and record BOTH the number and whether it
                    # could be validated. `r: None` is a real answer here, not a missing
                    # one: Mode 1 must be able to tell "a ball of this size" from "a
                    # bright blob whose size we could not defend".
                    r_px, centre, r_verdict, r_why = _measure_ball_radius(rgb, ball, w, h)
                    if r_px is None:
                        ball = dict(ball, r=None, r_verdict=r_verdict, r_reason=r_why)
                    else:
                        ball = dict(ball, r=r_px / w, r_verdict=r_verdict, r_reason=r_why)
                        if centre is not None:
                            ball = dict(ball, x=centre[0] / w, y=centre[1] / h)
                    node_ok, node_why = _ball_node_ok(ball, w)
                    ball = dict(ball, node=node_ok)
                    if not node_ok:
                        failures.append({"marking": "ball_node", "reason": node_why})
                    plane, why = _plane_line(shaft, ball, markings.get("head_circle"), kps, w, h)
                    if plane and plane["confidence"] >= PLANE_MIN_CONFIDENCE:
                        markings["plane_line"] = plane
                    elif plane:
                        failures.append({"marking": "plane_line",
                                         "reason": f"confidence {plane['confidence']:.2f} < {PLANE_MIN_CONFIDENCE}"})
                    else:
                        failures.append({"marking": "plane_line", "reason": why})

    geo = SetupGeometry(MARKER_VERSION, w, h, _round_floats(kps), _round_floats(view),
                        facing, _round_floats(ball) if ball else None,
                        _round_floats(shaft) if shaft else None,
                        _round_floats(markings), failures)
    # Measured once, here, on the address frame — see SetupGeometry.bg_luma.
    geo.bg_luma = _round_floats(_background_luma(img, geo))
    return geo


# ---------------------------------------------------------------------------
# Rendering — layered broadcast strokes, supersampled
# ---------------------------------------------------------------------------
_WHITE = (255, 255, 255)


def _mix_rgb(c, target, t):
    return tuple(int(round(c[i] + (target[i] - c[i]) * t)) for i in range(3))


def _unit(p1, p2):
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    L = math.hypot(dx, dy)
    if L < 1e-9:
        return 0.0, 0.0, 0.0
    return dx / L, dy / L, L


def _seg_quad(p1, p2, w1, w2):
    """Quad covering the segment p1->p2, `w1` wide at p1 and `w2` wide at p2."""
    ux, uy, _ = _unit(p1, p2)
    nx, ny = -uy, ux
    return [
        (p1[0] + nx * w1 / 2, p1[1] + ny * w1 / 2),
        (p2[0] + nx * w2 / 2, p2[1] + ny * w2 / 2),
        (p2[0] - nx * w2 / 2, p2[1] - ny * w2 / 2),
        (p1[0] - nx * w1 / 2, p1[1] - ny * w1 / 2),
    ]


def _disc(draw, c, r, fill):
    if r > 0:
        draw.ellipse((c[0] - r, c[1] - r, c[0] + r, c[1] + r), fill=fill)


_TAPER_STEPS = 28  # segments used to approximate a width/alpha ramp


def _stroke_pass(draw, p1, p2, color, alpha, w_start, w_end,
                 taper_frac=1.0, tip_alpha=1.0, cap_start=True, cap_end=True):
    """One layer of a stroke, from p1 (full width) to p2 (tapered).

    Drawn with direct writes rather than alpha blending, so the casing/body/core passes
    of one marking stack by draw order inside a single layer with no double-blending —
    the narrower pass simply replaces the wider one it sits inside.
    """
    ux, uy, L = _unit(p1, p2)
    if L <= 0:
        return
    flat = max(0.0, 1.0 - taper_frac)

    def _ramp(t, a, b):
        if t <= flat or taper_frac <= 0:
            return a
        return a + (b - a) * (t - flat) / max(1e-9, 1.0 - flat)

    n = 1 if (abs(w_end - w_start) < 1e-9 and abs(tip_alpha - 1.0) < 1e-9) else _TAPER_STEPS
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        a0 = (p1[0] + ux * L * t0, p1[1] + uy * L * t0)
        a1 = (p1[0] + ux * L * t1, p1[1] + uy * L * t1)
        w0, w1 = _ramp(t0, w_start, w_end), _ramp(t1, w_start, w_end)
        al = int(round(min(255.0, max(0.0, (_ramp(t0, alpha, alpha * tip_alpha)
                                            + _ramp(t1, alpha, alpha * tip_alpha)) / 2))))
        fill = (*color, al)
        draw.polygon(_seg_quad(a0, a1, w0, w1), fill=fill)
        if n > 1:  # bridge the joint so no notch survives the downsample
            _disc(draw, a1, w1 / 2, fill)
    if cap_start:
        _disc(draw, p1, w_start / 2, (*color, int(alpha)))
    if cap_end:
        _disc(draw, p2, w_end / 2, (*color, int(round(alpha * tip_alpha))))


def _ring_pass(draw, c, r, width, color, alpha, style=None, long_axis_deg=0.0,
               demotion=1.0):
    """One layer of the head ring: `width` wide, CENTERED on radius `r`.

    PIL grows an ellipse outline INWARD from its bounding box, so drawing a wider casing
    ring on the same bbox leaves it flush with the body ring's outer edge — all the dark
    inside, none outside, which reads as a black circle with a colour fringe. Expanding
    the bbox by width/2 re-centers every pass on the same radius.

    When `style.ring_falloff_enabled`, the ring is drawn as arc segments whose alpha
    cosine-ramps from full on the head's long axis to `ring_alpha_min` at 90 degrees to
    it, so the crescent of empty background top and bottom recedes instead of being
    outlined at full strength.

    `alpha` is the ring's alpha BEFORE support demotion and `demotion` is the role factor.
    They are combined as max(ring_alpha_floor, demotion x falloff) rather than multiplied:
    the raw product drove a demoted ring's vertical arcs to 0.34 and the closed curve
    visibly broke where it crossed dark clothing.
    """
    rb = r + width / 2.0
    box = (c[0] - rb, c[1] - rb, c[0] + rb, c[1] + rb)
    wpx = max(1, int(round(width)))
    if not (style and getattr(style, "ring_falloff_enabled", False)):
        draw.ellipse(box, outline=(*color, int(alpha * demotion)), width=wpx)
        return
    n = max(12, int(getattr(style, "ring_falloff_steps", 72)))
    a_min = float(getattr(style, "ring_alpha_min", 0.55))
    floor = float(getattr(style, "ring_alpha_floor", 0.48))
    step = 360.0 / n
    for i in range(n):
        a0 = i * step
        # 0 on the long axis, 1 at 90 degrees to it; cos^2 gives a smooth ramp.
        d = math.radians((a0 + step / 2.0) - long_axis_deg)
        t = math.sin(d) ** 2
        env = max(floor, demotion * (1.0 - (1.0 - a_min) * t))
        draw.arc(box, a0 - 0.6, a0 + step + 0.6,
                 fill=(*color, max(0, int(alpha * env))), width=wpx)


def resolve_primary(names: Sequence[str], primary: Optional[str] = None) -> Optional[str]:
    """Which marking of `names` carries PRIMARY visual weight.

    Explicit choice wins (the caller knows which question is being answered); otherwise
    MARKING_PRIORITY decides. A single-marking render always makes that marking primary.
    """
    present = [n for n in names if n]
    if not present:
        return None
    if primary in present:
        return primary
    for n in MARKING_PRIORITY:
        if n in present:
            return n
    return present[0]


def select_markings(geometry: SetupGeometry, only: Optional[Sequence[str]] = None
                    ) -> Dict[str, Dict[str, float]]:
    """The subset of the swing's markings to draw. `only=None` means all of them.

    Markings named in `only` that were withheld by the confidence gates stay withheld —
    fail closed still wins over a display request.
    """
    if only is None:
        return dict(geometry.markings)
    wanted = set(only)
    return {k: v for k, v in geometry.markings.items() if k in wanted}


def render_overlay(size: Tuple[int, int], geometry: SetupGeometry,
                   style: MarkingStyle = DEFAULT_STYLE,
                   only: Optional[Sequence[str]] = None,
                   primary: Optional[str] = None,
                   bg_luma: Optional[Dict[str, float]] = None) -> Image.Image:
    """Render the markings alone onto a transparent RGBA canvas of `size`.

    `bg_luma` — optional {marking_name: mean background luminance under that marking}.
    Defaults to `geometry.bg_luma`, measured once on the address frame; pass an explicit
    value only to probe alternatives. Used only to gate the dark halo down over
    already-bright background.

    `only`    — render just this subset (default: every marking the geometry carries).
    `primary` — which marking gets primary weight (default: MARKING_PRIORITY order).

    Deterministic: identical geometry + size + style + only + primary => byte-identical
    overlay. Exposed publicly so the pixel-stability acceptance test can compare overlays.
    """
    w, h = size
    marks = select_markings(geometry, only)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    if not marks:
        return out

    lead = resolve_primary(list(marks), primary)
    luma = bg_luma if bg_luma is not None else (getattr(geometry, "bg_luma", None) or {})

    def is_bright(name):
        v = luma.get(name)
        return v is not None and v > style.glow_bright_luma

    # --- role-relative widths ------------------------------------------------
    # Keyed off the SUBJECT (the measured head), so the same swing filmed at 320px and at
    # 1080px gets proportionally matched strokes. Read from geometry.markings rather than
    # the rendered subset, so `only=` cannot change a stroke's weight. Falls back to the
    # frame-relative rule when the head was never measured.
    head_px = None
    hc_all = geometry.markings.get("head_circle") or {}
    if hc_all.get("head_w") is not None:
        head_px = max(float(hc_all["head_w"]), float(hc_all.get("head_h", 0.0))) * w
    stroke_p = (style.stroke_head_ratio * head_px) if head_px else (style.stroke_ratio * w)
    stroke_p = min(style.stroke_max_px, max(style.stroke_min_px, stroke_p))
    stroke_s = stroke_p * style.secondary_scale
    ss = int(min(style.supersample_max,
                 max(style.supersample_min,
                     math.ceil(style.supersample_target_px / max(1e-9, stroke_p)))))
    S = float(ss)

    def width_of(name):
        return stroke_p if name == lead else stroke_s

    def alpha_of(name):
        return 1.0 if name == lead else style.secondary_alpha_scale

    ring_w = max(style.ring_min_px, stroke_p * (style.ring_scale_primary
                                                if lead == "head_circle"
                                                else style.ring_scale_secondary))

    def casing_pad(sw):
        # Absolute (frame-relative) pad OR the proportional one, whichever is larger.
        # A pad tied only to stroke width grows into an outline on wide strokes.
        return max(style.casing_min_px,
                   sw * style.casing_ratio,
                   max(1.0, style.casing_width_ratio * w))

    def casing_w(body_w, sw, taper=1.0):
        return body_w + 2 * casing_pad(sw) * max(style.casing_taper_floor, taper)

    def glow_pad(sw):
        return casing_pad(sw) + max(style.glow_min_px, sw * style.glow_ratio)

    def core_w(sw):
        return max(style.core_min_px, sw * style.core_ratio)

    def core_alpha(sw):
        if not style.core_enabled:
            return 0.0
        t = (sw - style.core_fade_lo) / max(1e-9, style.core_fade_hi - style.core_fade_lo)
        return style.core_alpha * max(0.0, min(1.0, t))

    _CASINGS = {
        style.plane_color: style.plane_casing,
        style.spine_color: style.spine_casing,
        style.head_color: style.head_casing,
    }

    def cas(color):
        # Dark-of-hue casing: same hue, low luminance. Falls back to the legacy
        # tinted-neutral for any colour without an explicit mapping.
        explicit = _CASINGS.get(tuple(color))
        if explicit is not None:
            return explicit
        return _mix_rgb(style.casing_color, color, style.casing_tint)

    def line_px(m):
        return (m["x1"] * w, m["y1"] * h), (m["x2"] * w, m["y2"] * h)

    plane, spine, head = (marks.get("plane_line"), marks.get("spine_line"),
                          marks.get("head_circle"))
    shoulder = marks.get("shoulder_line")
    hcx = hcy = hr = 0.0
    if head:
        hcx, hcy, hr = head["cx"] * w, head["cy"] * h, head["r"] * w

    # The anchor node asserts "the ball is HERE", so it is drawn only when the detection
    # was trustworthy enough to make that assertion (see _ball_node_ok). The plane LINE
    # is deliberately NOT withheld with it, and the distinction is not a compromise:
    #
    #   * the line's DIRECTION is the Hough shaft's own, verified to +/-6 deg against the
    #     visible shaft on every DTL fixture, and it never depended on the ball;
    #   * the line's ORIGIN is the clubhead end of that shaft, confirmed twice — the blob
    #     had to sit within the perpendicular tolerance of the shaft line and inside
    #     BALL_ALONG_RANGE of its lower endpoint — so "the shaft ends here" is sound even
    #     when "this object is a ball" is not. On the oblique fixture the blob IS the
    #     clubhead, which is precisely where the shaft's lower end belongs.
    #
    # What fails with the detection is the ball CLAIM, and the node is the only mark that
    # makes it. So the claim is withheld and the measurement is kept, rather than losing
    # a verified swing plane to an unverified ball. geometry.failures records the withheld
    # node and geometry.ball carries node=False, so Mode 1 sees the same distinction.
    node_c = node_r = None
    if plane and style.plane_node and geometry.ball and geometry.ball.get("node"):
        sw_p = width_of("plane_line")
        node_c = (geometry.ball["x"] * w, geometry.ball["y"] * h)
        ball_r = geometry.ball.get("r")
        node_r = max(style.node_min_px, sw_p * style.node_scale,
                     (float(ball_r) * w * style.node_ball_scale) if ball_r else 0.0)

    # --- pass 1: soft dark glow, drawn at 1x and blurred ---------------------
    # One blurred mask PER marking, so a thin ring never inherits a thick line's radius.
    def add_glow(canvas, paint, sw, color, bright=False):
        m = Image.new("L", (w, h), 0)
        paint(ImageDraw.Draw(m), sw + 2 * glow_pad(sw))
        m = m.filter(ImageFilter.GaussianBlur(
            max(style.glow_blur_min_px, style.glow_blur_ratio * sw)))
        # Over already-bright background (blown sky) a dark halo is what makes a
        # graphic look pasted on, so it is gated down rather than off.
        ga = style.glow_alpha_bright if bright else style.glow_alpha
        lay = Image.new("RGBA", (w, h), (*cas(color), 0))
        lay.putalpha(m.point(lambda v: int(v * ga / 255)))
        return Image.alpha_composite(canvas, lay)

    if plane:
        p1, p2 = line_px(plane)
        sw = width_of("plane_line")

        def _plane_glow(d, gw):
            d.line((*p1, *p2), fill=255, width=max(1, int(round(gw))))
            _disc(d, p1, gw / 2, 255)
            _disc(d, p2, gw * 0.5 * style.plane_taper, 255)
            if node_c is not None:
                _disc(d, node_c, node_r + glow_pad(sw), 255)
        out = add_glow(out, _plane_glow, sw, style.plane_color, is_bright('plane_line'))
    if spine:
        q1, q2 = line_px(spine)
        out = add_glow(out, lambda d, gw: d.line((*q1, *q2), fill=255,
                                                 width=max(1, int(round(gw)))),
                       width_of("spine_line"), style.spine_color, is_bright('spine_line'))
    if shoulder:
        s1, s2 = line_px(shoulder)
        out = add_glow(out, lambda d, gw: d.line((*s1, *s2), fill=255,
                                                 width=max(1, int(round(gw)))),
                       width_of("shoulder_line"), style.spine_color,
                       is_bright('shoulder_line'))
    if head:
        def _head_glow(d, gw):
            rb = hr + gw / 2.0  # centre the band on the ring radius (see _ring_pass)
            d.ellipse((hcx - rb, hcy - rb, hcx + rb, hcy + rb),
                      outline=255, width=max(1, int(round(gw))))
        out = add_glow(out, _head_glow, ring_w, style.head_color, is_bright('head_circle'))

    # --- pass 2: crisp casing / body / core for the lines, supersampled ------
    if plane or spine or shoulder:
        hi = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
        d = ImageDraw.Draw(hi)

        def sp(p):
            return (p[0] * S, p[1] * S)

        if shoulder:
            s1, s2 = line_px(shoulder)
            sw = width_of("shoulder_line")
            a = alpha_of("shoulder_line")
            dot = max(style.shoulder_dot_min_px, sw * style.shoulder_dot_scale)
            for color, alpha, bw in (
                    (cas(style.spine_color), style.casing_alpha * a, casing_w(sw, sw)),
                    (style.spine_color, style.body_alpha * a, sw)):
                _stroke_pass(d, sp(s1), sp(s2), color, alpha, bw * S, bw * S)
                for end in (s1, s2):     # acromion marks: the line measures BETWEEN them
                    _disc(d, sp(end), (dot + (bw - sw) / 2.0) * S, (*color, int(alpha)))

        # Spine before plane: where markings cross, the primary one must win the overlap.
        if spine:
            q1, q2 = line_px(spine)
            sw = width_of("spine_line")
            a = alpha_of("spine_line")
            tp = style.spine_taper
            mid = ((q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2)
            passes = [(cas(style.spine_color), style.casing_alpha * a,
                       casing_w(sw, sw) * S, casing_w(sw * tp, sw, tp) * S),
                      (style.spine_color, style.body_alpha * a, sw * S, sw * tp * S)]
            ca = core_alpha(sw) * a
            if ca > 2:
                passes.append((_mix_rgb(style.spine_color, _WHITE, style.core_mix), ca,
                               core_w(sw) * S, core_w(sw) * tp * S))
            for color, alpha, w0, w1 in passes:      # spindle: midpoint out to both tips
                for end in (q1, q2):
                    _stroke_pass(d, sp(mid), sp(end), color, alpha, w0, w1,
                                 taper_frac=style.spine_taper_frac, cap_start=False)
            # End anchors: a perpendicular cross-tick at C7 (q2) and a filled dot at the
            # pelvis (q1). Both tips previously terminated in bare taper, which reads as a
            # mark that stopped rather than a measurement between two landmarks.
            ux, uy, _L = _unit(q1, q2)
            nx, ny = -uy, ux
            tick = max(style.spine_tick_min_px, sw * style.spine_tick_len) / 2.0
            dot = max(style.spine_dot_min_px, sw * style.spine_dot_scale)
            # ...but not when a shoulder line is already drawn across that same level:
            # two horizontals a few pixels apart read as clutter, not as craft.
            draw_tick = shoulder is None
            for color, alpha, pad in ((cas(style.spine_color), style.casing_alpha * a,
                                       casing_pad(sw)),
                                      (style.spine_color, style.body_alpha * a, 0.0)):
                if draw_tick:
                    tw = max(1.0, sw * style.spine_tick_width) + 2 * pad
                    _stroke_pass(d, sp((q2[0] - nx * tick, q2[1] - ny * tick)),
                                 sp((q2[0] + nx * tick, q2[1] + ny * tick)),
                                 color, alpha, tw * S, tw * S)
                _disc(d, sp(q1), (dot + pad) * S, (*color, int(alpha)))

        if plane:
            p1, p2 = line_px(plane)              # p1 = ball end, p2 = far/top end
            sw = width_of("plane_line")
            a = alpha_of("plane_line")
            tp = style.plane_taper
            passes = [(cas(style.plane_color), style.casing_alpha * a,
                       casing_w(sw, sw) * S, casing_w(sw * tp, sw, tp) * S),
                      (style.plane_color, style.body_alpha * a, sw * S, sw * tp * S)]
            ca = core_alpha(sw) * a
            if ca > 2:
                passes.append((_mix_rgb(style.plane_color, _WHITE, style.core_mix), ca,
                               core_w(sw) * S, core_w(sw) * tp * S))
            for color, alpha, w0, w1 in passes:
                _stroke_pass(d, sp(p1), sp(p2), color, alpha, w0, w1,
                             taper_frac=style.plane_taper_frac,
                             tip_alpha=style.plane_tip_alpha)
            if node_c is not None:               # anchor the line ON the ball
                nr = node_r * S
                _disc(d, sp(node_c), nr + casing_pad(sw) * S,
                      (*cas(style.plane_color), int(style.casing_alpha * a)))
                _disc(d, sp(node_c), nr, (*style.plane_color, int(style.body_alpha * a)))
                # The pupil is suppressed on small nodes: below ~6px outer radius a 0.38x
                # bright core cannot be drawn as anything but a 2x2 white square.
                if node_r >= style.node_pupil_min_px:
                    _disc(d, sp(node_c), sw * style.node_core_scale * S,
                          (*_mix_rgb(style.plane_color, _WHITE, 0.80), 255))

        out = Image.alpha_composite(out, hi.resize((w, h), Image.LANCZOS))

    # --- pass 3: head ring, composited inside its own bounding box -----------
    if head:
        # The demotion is handed to _ring_pass separately so it can be FLOORED against the
        # falloff instead of multiplying with it (see ring_alpha_floor).
        a = style.ring_alpha_scale
        dem = alpha_of("head_circle")
        pad = int(math.ceil(ring_w * 3 + glow_pad(ring_w) * 2 + 8))
        x0, y0 = max(0, int(hcx - hr) - pad), max(0, int(hcy - hr) - pad)
        x1, y1 = min(w, int(hcx + hr) + pad), min(h, int(hcy + hr) + pad)
        if x1 > x0 and y1 > y0:
            lay = Image.new("RGBA", ((x1 - x0) * ss, (y1 - y0) * ss), (0, 0, 0, 0))
            ld = ImageDraw.Draw(lay)
            c = ((hcx - x0) * S, (hcy - y0) * S)
            R = hr * S
            _ring_pass(ld, c, R, casing_w(ring_w, ring_w) * S,
                       cas(style.head_color), style.casing_alpha * a,
                       style, head.get("long_axis_deg", 0.0), dem)
            _ring_pass(ld, c, R, ring_w * S, style.head_color, style.body_alpha * a,
                       style, head.get("long_axis_deg", 0.0), dem)
            ca = core_alpha(ring_w) * a
            if ca > 2:
                _ring_pass(ld, c, R, core_w(ring_w) * S,
                           _mix_rgb(style.head_color, _WHITE, style.core_mix), ca,
                           demotion=dem)
            small = lay.resize((x1 - x0, y1 - y0), Image.LANCZOS)
            region = out.crop((x0, y0, x1, y1))
            out.paste(Image.alpha_composite(region, small), (x0, y0))

    return out


def _background_luma(img, geometry: "SetupGeometry",
                     only: Optional[Sequence[str]] = None) -> Dict[str, float]:
    """Upper-quartile luminance of the frame along each marking's own path.

    The dark halo exists to separate a stroke from busy video; over already-bright
    background (blown-out sky) it is the thing that makes a graphic look pasted on.
    Sampling under each marking individually matters because one stroke can sit on
    sky while another sits on grass in the same frame.

    The statistic is the 75th percentile, not the mean, and the difference is not
    cosmetic: a head ring is half on a dark head and half on bright sky, so its MEAN
    lands mid-grey and the bright gate never fires — on the oblique fixture 71% of the
    ring sits over sky and the mean still read 150 against a 170 threshold. The upper
    quartile answers the question actually being asked, which is "does this marking cross
    blown-out background anywhere", not "what is it on average".
    """
    marks = select_markings(geometry, only)
    if not marks:
        return {}
    w, h = img.size
    gray = img.convert("L")
    px = gray.load()

    def at(x, y):
        xi = min(w - 1, max(0, int(round(x))))
        yi = min(h - 1, max(0, int(round(y))))
        return px[xi, yi]

    out: Dict[str, float] = {}
    for name, m in marks.items():
        vals = []
        if name == "head_circle":
            cx, cy, r = m["cx"] * w, m["cy"] * h, m["r"] * w
            for i in range(24):
                a = 2 * math.pi * i / 24
                vals.append(at(cx + r * math.cos(a), cy + r * math.sin(a)))
        else:
            x1, y1, x2, y2 = m["x1"] * w, m["y1"] * h, m["x2"] * w, m["y2"] * h
            for i in range(24):
                t = i / 23.0
                vals.append(at(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
        out[name] = float(np.percentile(np.asarray(vals, dtype=np.float64), 75)) if vals else 0.0
    return out


def render_markings(frame_path: str, geometry: SetupGeometry, out_path: str,
                    style: MarkingStyle = DEFAULT_STYLE,
                    only: Optional[Sequence[str]] = None,
                    primary: Optional[str] = None) -> bool:
    """Composite a swing's markings onto one frame.

    `only`/`primary` select and rank the subset shown to the user (see render_overlay).
    Returns False (writes nothing) when the selected subset is empty.
    """
    if not select_markings(geometry, only):
        return False
    img = ImageOps.exif_transpose(Image.open(frame_path)).convert("RGB")
    # bg_luma comes from the geometry (address frame), NOT from this frame — see
    # SetupGeometry.bg_luma. Sampling it here is what made the overlay frame-dependent.
    overlay = render_overlay(img.size, geometry, style, only=only, primary=primary)
    out = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    if os.path.splitext(out_path)[1].lower() in (".jpg", ".jpeg"):
        # 4:4:4 — chroma subsampling smears the saturated magenta/violet edges.
        out.save(out_path, quality=style.jpeg_quality, subsampling=style.jpeg_subsampling)
    else:
        out.save(out_path)
    return True


def mark_swing(frame_paths: Sequence[str], out_dir: str,
               style: MarkingStyle = DEFAULT_STYLE,
               only: Optional[Sequence[str]] = None,
               primary: Optional[str] = None) -> Dict[str, object]:
    """Compute geometry ONCE from the first frame (address), render it on every frame.

    Returns {"geometry_json": <path to geometry.json>, "marked_paths": [...], "skipped": [...]}.
    Frames whose dimensions differ from the address frame are skipped (a marking computed
    for one camera geometry must not be rescaled onto another).

    `only`/`primary` restrict and rank what is DRAWN; geometry.json still records every
    marking that passed the gates (Mode 1 grounding sees all of them).
    """
    if not frame_paths:
        raise ValueError("mark_swing requires at least one frame path")
    os.makedirs(out_dir, exist_ok=True)

    geometry = analyze_setup(frame_paths[0])
    geo_path = os.path.join(out_dir, "geometry.json")
    with open(geo_path, "w") as f:
        f.write(geometry.to_json())

    marked, skipped = [], []
    ref_size = (geometry.frame_width, geometry.frame_height)
    selected = select_markings(geometry, only)
    for fp in frame_paths:
        name = os.path.basename(fp)
        try:
            size = ImageOps.exif_transpose(Image.open(fp)).size
        except Exception as e:
            skipped.append({"frame": fp, "reason": f"unreadable: {e}"})
            continue
        if size != ref_size:
            skipped.append({"frame": fp, "reason": f"size {size} != address frame {ref_size}"})
            continue
        if not selected:
            skipped.append({"frame": fp, "reason": "no markings passed confidence gates (fail closed)"})
            continue
        out_path = os.path.join(out_dir, f"marked_{name}")
        render_markings(fp, geometry, out_path, style, only=only, primary=primary)
        marked.append(out_path)

    return {"geometry_json": geo_path, "marked_paths": marked, "skipped": skipped}


# ---------------------------------------------------------------------------
# CLI:  python swing_marker.py <frame1> [frame2 ...] -o <out_dir>
# ---------------------------------------------------------------------------
if __name__ == "__main__":  # pragma: no cover
    import argparse

    ap = argparse.ArgumentParser(description="Mark a swing: geometry from frame 1, rendered on all frames.")
    ap.add_argument("frames", nargs="+", help="frame paths, address frame first")
    ap.add_argument("-o", "--out-dir", required=True)
    args = ap.parse_args()
    result = mark_swing(args.frames, args.out_dir)
    print(json.dumps(result, indent=2))
    with open(result["geometry_json"]) as f:
        geo = json.loads(f.read())
    print("view:", geo["view"], "markings:", sorted(geo["markings"]), "failures:", geo["failures"])
