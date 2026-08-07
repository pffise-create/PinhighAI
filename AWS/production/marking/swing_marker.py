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

MARKER_VERSION = "3.0.0"

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
HEAD_KP_MAX_DIST = 0.92             # x r: every confident face keypoint must sit inside the ring

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

SHAFT_MIN_CONFIDENCE = 0.45    # below this the Hough shaft fit is untrusted -> NO plane line
                               # (fail closed; never fall back to a ball->body construction)
PLANE_MIN_CONFIDENCE = 0.45
SPINE_MIN_CONFIDENCE = 0.40
HEAD_MIN_CONFIDENCE = 0.35

PLANE_BOTTOM_OVERSHOOT = 2.5   # x ball radius past the ball (min PLANE_BOTTOM_MIN_PX px)
PLANE_BOTTOM_MIN_PX = 0.010    # x H
PLANE_TOP_CLEARANCE = 0.55     # x head-circle radius above the ring's top = plane-line top end
PLANE_EDGE_MARGIN = 0.01       # x W/H: rendered endpoints stay inside the frame by this margin
SPINE_TOP_GAP = 1.18           # x head-circle radius: spine tip keeps this clearance from center
SPINE_EXTEND_BEYOND_SHOULDER = 0.30   # base upward extension (x hip->shoulder), pre-clamp
SPINE_EXTEND_NO_HEAD = 0.10           # conservative extension when no head circle to clamp against
SPINE_MIN_EXTENT = 0.85               # x hip->shoulder: never clamp the spine shorter than this
SPINE_EXTEND_BELOW_HIP = 0.08


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
MARKING_PRIORITY = ("plane_line", "spine_line", "head_circle")


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
    casing_color: Tuple[int, int, int] = (8, 10, 12)      # near-black casing/glow base
    casing_tint: float = 0.16       # fraction of the marking's OWN hue blended into its
                                    # casing+glow. A pure-black casing on a bright sky
                                    # reads as "black ring with a colour fringe"; a
                                    # hue-tinted casing stays dark enough to separate
                                    # while the marking still reads as its colour.

    # --- stroke widths (relative to frame width, then to role) -------------
    stroke_ratio: float = 0.0056    # PRIMARY stroke width = ratio x frame width
    stroke_min_px: float = 2.6      # floor: below this a layered stroke has no pixels to work with
    stroke_max_px: float = 9.0      # ceiling: keeps 4K frames from getting a slab
    secondary_scale: float = 0.70   # non-primary markings are thinner...
    secondary_alpha_scale: float = 0.90   # ...and very slightly quieter
    ring_scale_primary: float = 0.78      # head ring width vs PRIMARY stroke, ring is primary
    ring_scale_secondary: float = 0.66    # ...and when it is a supporting marking
    ring_min_px: float = 2.0

    # --- dark casing (crisp edge definition) -------------------------------
    casing_ratio: float = 0.32      # casing extends this x stroke width on EACH side
    casing_min_px: float = 0.75
    casing_alpha: int = 210
    casing_taper_floor: float = 0.55  # the casing pad shrinks with a tapering body down
                                      # to this fraction — a constant pad around a taper
                                      # turns the tip into a dark blob

    # --- colour body -------------------------------------------------------
    body_alpha: int = 242

    # --- core highlight (the "lit object" read) ----------------------------
    core_ratio: float = 0.26        # core width vs stroke width
    core_min_px: float = 0.85
    core_mix: float = 0.50          # body colour -> white
    core_alpha: int = 250
    core_fade_lo: float = 3.0       # stroke px at/below which the core is suppressed
    core_fade_hi: float = 4.6       # stroke px at/above which it is at full strength.
                                    # Below ~3px the core desaturates the body and beads
                                    # along a diagonal, so thin strokes degrade to a
                                    # clean 2-layer casing+body instead.

    # --- soft dark glow (depth / separation from any background) -----------
    glow_ratio: float = 0.85        # glow extends this x stroke beyond the casing, each side
    glow_min_px: float = 1.0
    glow_blur_ratio: float = 1.15   # Gaussian radius = ratio x stroke width
    glow_blur_min_px: float = 1.6
    glow_alpha: int = 95

    # --- endpoint treatment ------------------------------------------------
    plane_taper: float = 0.50       # plane-line width at its far (top) end, x stroke
    plane_taper_frac: float = 0.65  # taper spans this fraction of the run, from the far end
    plane_tip_alpha: float = 0.80   # alpha multiplier at the far tip (dissolve, not a blunt cap)
    plane_node: bool = True         # anchor node at the ball end
    node_scale: float = 1.25        # node colour-disc radius, x stroke width
    node_core_scale: float = 0.38   # bright centre dot radius, x stroke width
    spine_taper: float = 0.55       # spine narrows to this x stroke at BOTH tips (spindle)
    spine_taper_frac: float = 0.30

    # --- head ring ---------------------------------------------------------
    ring_alpha_scale: float = 0.95

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

    def to_json(self) -> str:
        """Deterministic, versioned serialization (sorted keys, fixed float precision)."""
        return json.dumps(_round_floats(asdict(self)), sort_keys=True, separators=(",", ":"))

    @classmethod
    def from_json(cls, text: str) -> "SetupGeometry":
        d = json.loads(text)
        return cls(**{k: d[k] for k in (
            "marker_version", "frame_width", "frame_height", "keypoints", "view",
            "facing", "ball", "shaft", "markings", "failures")})


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
def _head_circle(kps, view_label: str, w: int, h: int) -> Tuple[Optional[Dict[str, float]], Optional[str]]:
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

    # Lift the center off the face centroid toward the skull center: up always; back
    # (away from the nose, toward the visible ear side) in non-face-on views.
    cy -= HEAD_CENTER_UP_SHIFT * r_px / h
    if view_label != "face_on":
        ears = [n for n in ("left_ear", "right_ear") if _visible(kps, n)]
        if ears:
            back_dx = float(np.mean([kps[n]["x"] for n in ears])) - kps["nose"]["x"]
            if abs(back_dx) > 1e-6:
                cx += math.copysign(HEAD_CENTER_BACK_SHIFT * r_px / w, back_dx)

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
    return {"cx": cx, "cy": cy, "r": r_px / w, "confidence": round(conf, 4)}, None


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
    r_ball = ball["r"] * w

    # Bottom end: just past the ball, opposite the hands-ward direction (clamped in-frame).
    t_bot = -max(PLANE_BOTTOM_OVERSHOOT * r_ball, PLANE_BOTTOM_MIN_PX * h)
    t_bot = max(t_bot, ((1.0 - PLANE_EDGE_MARGIN) * h - by) / uy)  # uy < 0: y <= 1-margin
    if ux > 0:
        t_bot = max(t_bot, (PLANE_EDGE_MARGIN * w - bx) / ux)
    elif ux < 0:
        t_bot = max(t_bot, ((1.0 - PLANE_EDGE_MARGIN) * w - bx) / ux)

    # Top end: just above head height.
    if head:
        top_y = (head["cy"] * h - head["r"] * w) - PLANE_TOP_CLEARANCE * head["r"] * w
    else:
        vis_head = [n for n in ("nose", "left_eye", "right_eye", "left_ear", "right_ear")
                    if _visible(kps, n)]
        if not vis_head:
            return None, "no head reference to bound the plane line's top end"
        top_y = min(kps[n]["y"] for n in vis_head) * h - 0.05 * h
    t_top = (top_y - by) / uy  # uy < 0, top_y < by  =>  t_top > 0
    # Keep the top end inside the frame (with margin); the x-clamp trims a shallow line
    # that would exit the frame side before reaching head height.
    if ux < 0:
        t_top = min(t_top, (PLANE_EDGE_MARGIN * w - bx) / ux)
    elif ux > 0:
        t_top = min(t_top, ((1.0 - PLANE_EDGE_MARGIN) * w - bx) / ux)
    t_top = min(t_top, (PLANE_EDGE_MARGIN * h - by) / uy)  # uy < 0: y >= margin
    if t_top < 0.10 * h:
        return None, "clamped plane line degenerate (top end reaches no higher than the ball)"

    conf = float(min(1.0, min(shaft["confidence"], ball["confidence"])))
    return {
        "x1": (bx + t_bot * ux) / w, "y1": (by + t_bot * uy) / h,   # bottom: just past the ball
        "x2": (bx + t_top * ux) / w, "y2": (by + t_top * uy) / h,   # top: just above the head
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

    failures: List[Dict[str, str]] = []
    markings: Dict[str, Dict[str, float]] = {}
    view: Dict[str, object] = {"label": "unknown", "confidence": 0.0, "spread_ratio": 0.0}
    facing = None
    ball = shaft = None

    ok, reason = _person_present(kps, w, h)
    if not ok:
        for m in ("head_circle", "spine_line", "plane_line"):
            failures.append({"marking": m, "reason": f"no reliable pose: {reason}"})
        return SetupGeometry(MARKER_VERSION, w, h, _round_floats(kps), view, facing,
                             ball, shaft, markings, failures)

    view = _classify_view(kps, w, h)
    view_ok = view["confidence"] >= VIEW_MIN_CONFIDENCE

    # --- head circle: legal in both views; requires only a confident view-independent pose,
    # but the radius rule differs per view, so an ambiguous view still withholds it.
    if view_ok:
        head, why = _head_circle(kps, view["label"], w, h)
        if head:
            markings["head_circle"] = head
        else:
            failures.append({"marking": "head_circle", "reason": why})
    else:
        failures.append({"marking": "head_circle",
                         "reason": f"view ambiguous (confidence {view['confidence']:.2f} < {VIEW_MIN_CONFIDENCE})"})

    # --- spine + plane: DTL only.
    if not view_ok:
        for m in ("spine_line", "plane_line"):
            failures.append({"marking": m,
                             "reason": f"view ambiguous (confidence {view['confidence']:.2f} < {VIEW_MIN_CONFIDENCE})"})
    elif view["label"] != "dtl":
        for m in ("spine_line", "plane_line"):
            failures.append({"marking": m, "reason": f"view={view['label']}: {m} is DTL-only"})
    else:
        spine, why = _spine_line(kps, w, h, markings.get("head_circle"))
        if spine:
            markings["spine_line"] = spine
        else:
            failures.append({"marking": "spine_line", "reason": why})

        facing = _facing_direction(kps)
        if facing is None:
            failures.append({"marking": "plane_line", "reason": "cannot determine facing direction from pose"})
        elif not _HAS_CV2:
            failures.append({"marking": "plane_line", "reason": "opencv unavailable: shaft/ball detection disabled"})
        else:
            rgb = np.asarray(img)
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
                    plane, why = _plane_line(shaft, ball, markings.get("head_circle"), kps, w, h)
                    if plane and plane["confidence"] >= PLANE_MIN_CONFIDENCE:
                        markings["plane_line"] = plane
                    elif plane:
                        failures.append({"marking": "plane_line",
                                         "reason": f"confidence {plane['confidence']:.2f} < {PLANE_MIN_CONFIDENCE}"})
                    else:
                        failures.append({"marking": "plane_line", "reason": why})

    return SetupGeometry(MARKER_VERSION, w, h, _round_floats(kps), _round_floats(view),
                         facing, _round_floats(ball) if ball else None,
                         _round_floats(shaft) if shaft else None,
                         _round_floats(markings), failures)


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


def _ring_pass(draw, c, r, width, color, alpha):
    """One layer of the head ring: `width` wide, CENTERED on radius `r`.

    PIL grows an ellipse outline INWARD from its bounding box, so drawing a wider casing
    ring on the same bbox leaves it flush with the body ring's outer edge — all the dark
    inside, none outside, which reads as a black circle with a colour fringe. Expanding
    the bbox by width/2 re-centers every pass on the same radius.
    """
    rb = r + width / 2.0
    draw.ellipse((c[0] - rb, c[1] - rb, c[0] + rb, c[1] + rb),
                 outline=(*color, int(alpha)), width=max(1, int(round(width))))


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
                   primary: Optional[str] = None) -> Image.Image:
    """Render the markings alone onto a transparent RGBA canvas of `size`.

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

    # --- role-relative widths ------------------------------------------------
    stroke_p = min(style.stroke_max_px, max(style.stroke_min_px, style.stroke_ratio * w))
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
        return max(style.casing_min_px, sw * style.casing_ratio)

    def casing_w(body_w, sw, taper=1.0):
        return body_w + 2 * casing_pad(sw) * max(style.casing_taper_floor, taper)

    def glow_pad(sw):
        return casing_pad(sw) + max(style.glow_min_px, sw * style.glow_ratio)

    def core_w(sw):
        return max(style.core_min_px, sw * style.core_ratio)

    def core_alpha(sw):
        t = (sw - style.core_fade_lo) / max(1e-9, style.core_fade_hi - style.core_fade_lo)
        return style.core_alpha * max(0.0, min(1.0, t))

    def cas(color):
        return _mix_rgb(style.casing_color, color, style.casing_tint)

    def line_px(m):
        return (m["x1"] * w, m["y1"] * h), (m["x2"] * w, m["y2"] * h)

    plane, spine, head = (marks.get("plane_line"), marks.get("spine_line"),
                          marks.get("head_circle"))
    hcx = hcy = hr = 0.0
    if head:
        hcx, hcy, hr = head["cx"] * w, head["cy"] * h, head["r"] * w

    # --- pass 1: soft dark glow, drawn at 1x and blurred ---------------------
    # One blurred mask PER marking, so a thin ring never inherits a thick line's radius.
    def add_glow(canvas, paint, sw, color):
        m = Image.new("L", (w, h), 0)
        paint(ImageDraw.Draw(m), sw + 2 * glow_pad(sw))
        m = m.filter(ImageFilter.GaussianBlur(
            max(style.glow_blur_min_px, style.glow_blur_ratio * sw)))
        lay = Image.new("RGBA", (w, h), (*cas(color), 0))
        lay.putalpha(m.point(lambda v: int(v * style.glow_alpha / 255)))
        return Image.alpha_composite(canvas, lay)

    if plane:
        p1, p2 = line_px(plane)
        sw = width_of("plane_line")

        def _plane_glow(d, gw):
            d.line((*p1, *p2), fill=255, width=max(1, int(round(gw))))
            _disc(d, p1, gw / 2, 255)
            _disc(d, p2, gw * 0.5 * style.plane_taper, 255)
            if style.plane_node:
                _disc(d, p1, sw * style.node_scale + glow_pad(sw), 255)
        out = add_glow(out, _plane_glow, sw, style.plane_color)
    if spine:
        q1, q2 = line_px(spine)
        out = add_glow(out, lambda d, gw: d.line((*q1, *q2), fill=255,
                                                 width=max(1, int(round(gw)))),
                       width_of("spine_line"), style.spine_color)
    if head:
        def _head_glow(d, gw):
            rb = hr + gw / 2.0  # centre the band on the ring radius (see _ring_pass)
            d.ellipse((hcx - rb, hcy - rb, hcx + rb, hcy + rb),
                      outline=255, width=max(1, int(round(gw))))
        out = add_glow(out, _head_glow, ring_w, style.head_color)

    # --- pass 2: crisp casing / body / core for the lines, supersampled ------
    if plane or spine:
        hi = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
        d = ImageDraw.Draw(hi)

        def sp(p):
            return (p[0] * S, p[1] * S)

        # Spine first: where markings cross, the primary one must win the overlap.
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
            if style.plane_node:                 # anchor the line at the ball
                nr = sw * style.node_scale * S
                _disc(d, sp(p1), nr + casing_pad(sw) * S,
                      (*cas(style.plane_color), int(style.casing_alpha * a)))
                _disc(d, sp(p1), nr, (*style.plane_color, int(style.body_alpha * a)))
                _disc(d, sp(p1), sw * style.node_core_scale * S,
                      (*_mix_rgb(style.plane_color, _WHITE, 0.80), 255))

        out = Image.alpha_composite(out, hi.resize((w, h), Image.LANCZOS))

    # --- pass 3: head ring, composited inside its own bounding box -----------
    if head:
        a = style.ring_alpha_scale * alpha_of("head_circle")
        pad = int(math.ceil(ring_w * 3 + glow_pad(ring_w) * 2 + 8))
        x0, y0 = max(0, int(hcx - hr) - pad), max(0, int(hcy - hr) - pad)
        x1, y1 = min(w, int(hcx + hr) + pad), min(h, int(hcy + hr) + pad)
        if x1 > x0 and y1 > y0:
            lay = Image.new("RGBA", ((x1 - x0) * ss, (y1 - y0) * ss), (0, 0, 0, 0))
            ld = ImageDraw.Draw(lay)
            c = ((hcx - x0) * S, (hcy - y0) * S)
            R = hr * S
            _ring_pass(ld, c, R, casing_w(ring_w, ring_w) * S,
                       cas(style.head_color), style.casing_alpha * a)
            _ring_pass(ld, c, R, ring_w * S, style.head_color, style.body_alpha * a)
            ca = core_alpha(ring_w) * a
            if ca > 2:
                _ring_pass(ld, c, R, core_w(ring_w) * S,
                           _mix_rgb(style.head_color, _WHITE, style.core_mix), ca)
            small = lay.resize((x1 - x0, y1 - y0), Image.LANCZOS)
            region = out.crop((x0, y0, x1, y1))
            out.paste(Image.alpha_composite(region, small), (x0, y0))

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
