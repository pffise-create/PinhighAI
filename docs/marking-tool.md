# Swing Marking Tool — `AWS/src/marking/swing_marker.py`

**Version:** `marker_version 5.0.0` · **Built:** 2026-08-02 · **Wired into production:** 2026-08-03 (see § Production wiring) · Requirement: `docs/backlog/swing-marking-tool.md` · Research: `docs/marking-research-2026-08-02.md`

> v5.0.0 — the six items a strict critic measured against v4 (`design/critique-v4.json`, 7.5/10):
>
> 1. **Head ring: re-centre on the silhouette, THEN fit.** v4's ring was built on the FACE
>    keypoints, so on a profile head it sat forward and low of the skull: it grazed the
>    NECK on the face side while carrying 21–42 px of empty background across the entire
>    back-of-skull sector. Shrinking about that centre would have clipped — which is why
>    v4's radius never moved. The ring is now centred on the head's own silhouette
>    (`_segment_head_silhouette`: consensus over threshold + Lab-colour candidate masks in
>    the band above the shoulder line) and only then fitted to
>    `0.58 × max(head_w, head_h) + 3 px`, with the keypoint radius demoted to a `0.72×`
>    target ceiling and a hard containment floor so it can never clip. Measured diameters
>    165→127, 135→109, 77→62, 38→34 px; worst-bearing slack 0.46–0.63 r → 0.19–0.31 r.
>    Fails soft: no cv2, or any plausibility gate failing, keeps the v4 keypoint ring.
> 2. **Face-on scenes are no longer a lone circle.** The spine line is legal in BOTH views
>    (shoulder-mid → hip-mid is the same segment either way) and face-on adds a
>    **shoulder line**. Only the plane line stays DTL-only — it is built from a detected
>    shaft, which a face-on camera foreshortens into the body.
> 3. **320 px node pupil + demoted-ring dropout.** The bright node pupil is suppressed
>    below a 6 px node radius (at 4.75 px it quantised to a literal 2×2 white square on the
>    ball). The ring's cosine falloff and the support demotion are combined as
>    `max(0.48, demotion × falloff)` instead of multiplied — the raw product put a demoted
>    ring's vertical arcs at 0.34 and the closed curve visibly broke.
> 4. **Stroke weight keys off the SUBJECT, not the frame** — `0.053 × max(head_w, head_h)`,
>    clamped 2.5–9 px. Keyed to frame width a 320 px render was 2.4× proportionally fatter
>    than a 1080 px one.
> 5. **Casing alpha 115 → 91.** The head ring's worst dL at +2 px against a 220+ luma sky
>    goes −70 → −53, inside the −55 acceptance bar on every qualifying bearing.
> 6. **Endpoint craft.** Spine gets a perpendicular cross-tick at C7 and a filled dot at the
>    pelvis (the tick is suppressed when a shoulder line already crosses that level); the
>    anchor node is drawn ON the detected ball centre rather than on the plane line's
>    terminus 19 px past it; `_refine_ball` re-measures the ball at half maximum.
>
> Unchanged by design (the critic verified them as broadcast-grade): the casing/halo
> architecture, core-off, the constant-width plane and its terminal fade, the 0.06 W edge
> clamp, the ring falloff curve itself, and the three-hue palette — the shoulder line shares
> the spine's teal because they are one "body posture" system.

> v4.0.0 (**rendering**): dark-of-hue casings at alpha 115 (a near-black casing measured
> ΔL −162 on blown sky), a 1.5 px-sigma hue-tinted halo gated down over bright backgrounds,
> core highlight OFF by default, plane edge margin 0.06 W with a coupled width+opacity fade
> over the last 12% of line length, and a cosine alpha falloff around the head ring.

> v3.0.0 (**rendering only — no geometry change**): broadcast-telestration rendering.
> Every marking is now a layered stroke (soft dark glow → hue-tinted casing → colour body
> → lighter core highlight) with treated endpoints: the plane line is anchored at the ball
> with a node and tapers/dissolves at its far end, the spine is a spindle, the head ring is
> the same material bent into a circle. `render_overlay`/`render_markings`/`mark_swing`
> gained `only=` (render an arbitrary SUBSET of the markings) and `primary=` (which
> marking carries primary weight); visual weight is **relative to the render set**, so a
> marking shown alone is always primary. Fixed: PIL grows ellipse outlines inward, which
> had left the head ring's dark casing flush with its outer edge (it read as a black circle
> with a violet fringe).

> v2.1.0: oblique-DTL head circle sized from `max(eye→ear × 1.80, nose→far-ear × 1.43)` —
> eye→ear foreshortens on a three-quarter face and undersized the ring ~15%. Face-on
> factor 0.92 → 0.96.

> v2.0.0 (strict-eval fixes): the plane line now carries the **detected Hough shaft's own
> angle** anchored at the detected ball (v1's ball→shoulder construction measured 13–16°
> steeper than the real shaft on all three DTL eval sessions); a low-confidence shaft fit
> withholds the plane line outright — there is no ball→body fallback. Plane-line extent is
> clamped (just past the ball → just above head height, inside the frame). Head circle
> enlarged and re-centered to enclose the whole head (cap crown + occiput). Spine tip
> clamped short of the head circle. Plane color changed amber → magenta after a collision
> with a real orange alignment stick in-scene.

## How it works

All geometry is computed **once per swing** from the address frame (frame 1) and rendered with identical coordinates on every frame — the temporal-consistency rule holds by construction, and the test suite asserts pixel-identical overlays across a sequence.

1. **Pose** — MoveNet SinglePose Thunder (TFLite f16, Apache-2.0) on the address frame only. 17 COCO keypoints, letterboxed 256×256 input, `num_threads=1` for determinism. Model provenance (URL + sha256) is in the module docstring; loaded from `SWING_MARKER_MODEL_PATH`, `<module>/models/`, or `/opt/models/` — never the network.
2. **Person gate** — mean core-keypoint score ≥ 0.30 plus anatomical vertical-order sanity. Fails ⇒ all markings withheld.
3. **View classification** — `spread_ratio` = mean(shoulder, hip x-spread) / torso length. ≥ 0.42 ⇒ `face_on`, ≤ 0.30 ⇒ `dtl`, between ⇒ ambiguous (view-gated markings withheld below confidence 0.5). Fixture results: face-on 0.50, DTL 0.03 / 0.03 / 0.21 — the bands are wide.
4. **DTL only: shaft** — `cv2.HoughLinesP` in a wrist-anchored ROI on the facing side; segments gated on angle (20–80° from horizontal), direction, and upper-endpoint proximity to the hands.
5. **DTL only: ball** — bright-blob detection (max-RGB-channel, catches white and yellow balls) near the shaft's clubhead end; multi-threshold sweep + eroded-mask pass (splits ball⇄clubhead-glint bridges); blobs gated on area, aspect, fill, contour circularity, brightness margin. Candidates are score-ranked and the first that **mutually confirms** against the shaft line (on-line within an angular tolerance fanned from the hands anchor, and within `[-0.15, 0.90]`×segment-length of the clubhead end) becomes the plane-line origin. No confirmed ball ⇒ **no plane line**.
6. **Markings**
   - **Head circle** (both views) — the keypoint factors (0.96×inter-ear face-on, max(1.80×eye-ear, 1.43×nose-far-ear) DTL — never fixed pixels) give a circle that reliably *contains* the head, and that is now only the **upper bound**. The shipped ring is **re-centred on the head's own silhouette and then fitted**:
     1. `_segment_head_silhouette` searches a 1.6×r box, cut at `min(shoulder.y) − 0.02 H` (above that line is head, not torso). Candidate masks = Otsu + 7 percentile thresholds (both polarities) + 7 Lab colour-distance tolerances, each grown from seeds that are certainly on the head (the skull above the ear centroid first — a bent-over golfer's face centroid can fall below the cut). Every candidate must pass area/size/border/landmark gates; a pixel joins the silhouette when **35% of a seed's surviving candidates agree** (consensus, not union: one leaky threshold cannot drag the mask into the sky, and a head split across seeds — dark cap vs lit face — still contributes both parts). The bbox is then grown to include every confident face keypoint, because the shoulder cut truncates the jaw.
     2. centre = that bbox centroid; `r = 0.58 × max(head_w, head_h) + 3 px`, capped at `0.72 × r_keypoint`, floored at `max(silhouette_edge + 2.5 px, face_keypoint_far / 0.95)` so it can never clip, and never larger than `r_keypoint`.
     3. `markings.head_circle` records `fit: "silhouette" | "keypoints"` plus `head_w`/`head_h` (the measured subject scale that drives stroke weight). **Fails soft** — no cv2, a degenerate ROI, or any gate failing keeps the keypoint circle, so a ring that rendered before still renders.
     Sanity gate: every confident face keypoint inside 0.95×r; head-diameter/torso ratio in [0.22, 1.05].
   - **Spine line** (both views) — hip-mid → shoulder-mid, extended 0.20× below the hip toward the sacrum and 0.34× above the shoulders toward C7; the top end is clamped so the tip keeps ≥1.02×r clearance from the head-circle center (never below 0.94× torso extent). Face-on it reads as spine tilt, down the line as forward bend.
   - **Shoulder line** (face-on only) — acromion to acromion, extended 10% past each. Down the line the two acromions project onto each other, so it is withheld there. Gates: both shoulders ≥ 0.30 confidence, and span ≥ 0.30 × torso (below that the view is collapsing toward DTL).
   - **Plane line** (DTL) — the **detected shaft segment's own direction, anchored at the detected ball**. The angle IS the Hough fit's angle; the shoulder midpoint plays no part. Extent clamps: bottom end just past the ball (max(2.5×ball-r, 1% H) — never through the clubhead into the mat), top end just above head height (0.55×head-r above the ring's top — never into sky/roof), both ends ≥6% inside the frame. Shaft confidence < 0.45 ⇒ plane line withheld with a recorded reason — **no ball→body fallback exists**.

## Geometry JSON schema (deterministic: sorted keys, 6-decimal floats)

```jsonc
{
  "marker_version": "5.0.0",
  "frame_width": 1080, "frame_height": 1920,     // coords normalized by these (r by width)
  "keypoints": {"nose": {"x": 0.42, "y": 0.32, "score": 0.45}, ...},   // all 17
  "view": {"label": "dtl|face_on|unknown", "confidence": 0.9, "spread_ratio": 0.03},
  "facing": "right|left|null",                    // image-space ball side (DTL)
  "ball":  {"x":…, "y":…, "r":…, "confidence":…} | null,
  "shaft": {"x1":…, "y1":…, "x2":…, "y2":…, "confidence":…} | null,   // (x1,y1)=hands end
  "markings": {                                   // ONLY markings that passed every gate
    "head_circle": {"cx":…, "cy":…, "r":…, "confidence":…,
                    "fit": "silhouette|keypoints",         // how the ring was placed
                    "head_w":…, "head_h":…},               // silhouette fit only; ÷ width
    "spine_line":    {"x1":…, "y1":…, "x2":…, "y2":…, "confidence":…},  // (x2,y2)=C7 end
    "shoulder_line": {"x1":…, "y1":…, "x2":…, "y2":…, "confidence":…},  // face-on only
    "plane_line":    {"x1":…, "y1":…, "x2":…, "y2":…, "confidence":…}   // (x1,y1)=ball end
  },
  "failures": [{"marking": "plane_line", "reason": "…"}]   // every withheld marking, named
}
```

## Visual style (`MarkingStyle`)

Palette rule: colors must be distinct from objects commonly in a golf scene — alignment sticks are orange/yellow (a real orange stick collided with v1's amber plane line), flags red/white, grass green. Magenta/teal/violet occur in none of those and are mutually distinct. One color per marking type, everywhere.

Every marking is drawn as a **layered stroke**, not a flat line — the same idiom TrackMan /
Golf Channel / Sky Sports telestration uses:

```
soft dark glow  →  dark casing  →  colour body  →  lighter core highlight
```

The glow separates the marking from any background (bright sky, backlit silhouette, grass,
concrete); the casing gives it a crisp edge; the core makes it read as a lit object rather
than a painted stripe.

| Constant | Value | Purpose |
|---|---|---|
| `plane_color` | `#FF2D95` magenta | never orange/yellow (alignment-stick colors) |
| `spine_color` | `#2EC4B6` teal | |
| `head_color` | `#AA6EFF` violet, ring only | never a filled blob |
| `plane_casing` / `spine_casing` / `head_casing` | `#4A0C30` / `#0A3B36` / `#2E1A47` @ **alpha 91** | dark-of-hue, not near-black: a neutral casing measured ΔL −162 against blown sky, i.e. the eye read a black rim before the colour. 115 → 91 brings the head ring's worst bearing from ΔL −70 to −53 at +2 px, inside the −55 bar |
| `glow_*` | extends 0.55× stroke past the casing, Gaussian blur ≥1.5 px sigma, alpha 64 (**31** where the local background luma > 170) | a tight halo, not a smudge; over blown sky a dark halo is what makes graphics look pasted on |
| `stroke_head_ratio` | **0.053 × max(head_w, head_h)**, clamped 2.5–9.0 px | keyed to the SUBJECT, so a 320 px and a 1080 px render of the same swing read as one graphics package. Falls back to `stroke_ratio × frame width` when the head was never measured. Supporting markings are ×0.75 width, ×0.62 alpha |
| `core_enabled` | **False** | a core desaturated the body into a five-band ribbon and, at 320 px, drew a literal white square on the ball. Plane chroma is now a flat 197–210 along its whole length |
| `plane_taper` / `plane_tip_alpha` / `plane_taper_frac` | 0.62 width, alpha → 0, over the last 12% of **line length** | a real coupled fade; a fixed 4 px taper is a chisel at 1:1 |
| `plane_edge_margin_ratio` | 0.06 × frame width | a stroke dissolving at a frame edge is the clearest "not broadcast" tell; the fade absorbs the clamp so it is invisible |
| `node_*` | radius = max(1.25× stroke, 2.2× ball-r, 4.5 px), drawn **on the detected ball centre**; pupil suppressed below a 6 px node radius | the node marks the ball, so it goes on the ball — not on the line's terminus 19 px past it. Below ~6 px the pupil can only quantise to a 2×2 white square |
| `spine_taper` | 0.55 at both tips (spindle) | reads as an axis, not a segment |
| `spine_tick_*` / `spine_dot_*` | cross-tick 2.6× stroke long at the C7 end (suppressed when a shoulder line crosses that level), filled dot 0.52× stroke at the pelvis | a measurement has ends; bare taper reads as a mark that stopped |
| `ring_alpha_min` / `ring_alpha_floor` | falloff 1.0 → 0.55 on the short axis; combined with the support demotion as **max(0.48, demotion × falloff)** | the raw product put a demoted ring's vertical arcs at 0.34 on a 2 px stroke and the closed curve visibly broke — a broken circle is worse than a uniform one |
| `supersample_target_px` | 14 px → ss 3–5, LANCZOS downsample | ss scales with stroke thinness: a 320 px source gets 5×, a 1080 px source 3× |
| `jpeg_quality` / `jpeg_subsampling` | 95 / 4:4:4 | chroma subsampling smears saturated magenta edges |

### Which markings are shown, and how they rank

The user-facing render shows **only the markings relevant to the question** — a swing-plane
question shows the plane line alone. (Mode 1 grounding for the model still sees every
marking that passed the gates; this is display only.)

- `render_overlay(size, geo, style, only=[...], primary="...")` — `only=None` draws
  everything; a marking withheld by the confidence gates stays withheld even if requested.
- Visual weight is **relative to the render set**, never fixed per marking type. Whatever is
  primary gets full width and alpha; everything else is ×0.70 width and ×0.90 alpha, and the
  primary marking wins the overlap where two markings cross. A marking shown alone is
  therefore always primary — it is the whole message.
- `primary=` is the caller's explicit choice (it knows which question is being answered);
  the default falls back to
  `MARKING_PRIORITY = (plane_line, spine_line, shoulder_line, head_circle)`.

No text labels on frames. Rendering is deterministic (same geometry + size + style + `only`
+ `primary` ⇒ byte-identical overlay), so the pixel-stability rule holds for subsets too.

## What fails closed, and when

A wrong marking is worse than no marking; every gate below withholds rather than guesses, and records why in `failures`:

- **Everything** — no/garbage person (low pose confidence, implausible layout, degenerate torso); ambiguous camera view.
- **Plane + spine** — view is `face_on` (DTL-only markings).
- **Plane line** — facing direction undeterminable; OpenCV missing; no plausible shaft segment; **Hough shaft fit below confidence 0.45** (an untrusted fit is withheld — never replaced with a ball→body construction); no compact bright ball blob; shaft and ball disagree (off-line or a glint up the shaft); clamped line degenerate; no head reference to bound the top end. Known real case: cluttered/low-contrast lies (research §4.2).
- **Head circle** — <3 confident head keypoints; no measurable ear/eye pair; any confident face keypoint outside 0.92×r of the candidate circle; head-diameter/torso ratio outside [0.22, 1.05] (catches cap/visor keypoint displacement).
- **`mark_swing` skips frames** that are unreadable or whose dimensions differ from the address frame (geometry from one camera must not be rescaled onto another).

## Tests

`AWS/src/marking/test_swing_marker.py` (21 tests, plain `unittest`, run with the dev venv python + `SWING_MARKER_MODEL_PATH` / `SWING_MARKER_FIXTURES` env): pixel-stability (byte-identical overlay across frames + marked-frame recomposition equality + single-geometry assertion), fail-closed on noise **and on a low-confidence shaft fit (no fallback)**, plane-line accuracy (angle equals the detected shaft's angle within 0.75°; matches the eval-measured visible shaft angle per DTL fixture within 6°; line passes through the detected ball), plane-line clamped bounds (endpoints in-frame, bottom just past the ball, top at head height; line never crosses the head circle), head circle contains every confident face keypoint with margin, spine tip clears the head circle, head-radius proportionality (2× head ⇒ 2× radius; cross-session radii diverge >1.5×), view classification on all four real fixture sessions, determinism (byte-identical JSON on repeat), JSON roundtrip + versioning.

## Production packaging (per research §3)

- Lambda python3.9 zip layer: `tflite_runtime==2.14.0` (cp39 manylinux2014, 2.4 MB wheel) + `opencv-python-headless` + numpy + Pillow; model file (12.6 MB) shipped in the layer at `/opt/models/movenet_singlepose_thunder_f16.tflite`. The module tries `tflite_runtime` → `ai_edge_litert` (macOS dev) → `tensorflow.lite`.
- The model binary is **not** committed to the repo — download per the module docstring (URL + sha256 recorded there) and verify the hash.
- Cost: zero model-API calls; ~0.5–1.5 s CPU per swing.

---

# Production wiring (2026-08-03)

Both modes are wired end to end and **both ship off**. Mode 1 passed its ship
gate (`docs/marking-evals/coaching-eval-2026-08-02.md`, markings won 4/4,
78–68, 9 plane-referenced claims vs 0, zero contamination); Mode 2 is built and
dark pending a product call on the paid tier.

| Flag | Function(s) | Default | Turns on |
|---|---|---|---|
| `SWING_MARKING_ENABLED` | `golf-frame-extractor-simple-with-ai` + `golf-ai-analysis-processor` | **off** | Mode 1: generate marked frames, and analyse the swing on them |
| `SWING_MARKING_DISPLAY_ENABLED` | `golf-chat-api-handler` | **off** | Mode 2: show a marked frame to the player |

Only `1|true|yes|on` enable a flag. Everything below fails soft: any marking
error leaves `marking.generated: false` with a reason and the swing is coached
on plain frames, exactly as before the feature existed.

## Mode 1 — silent grounding

**Extractor** (`AWS/production/lambda_function.py` + mirrors): after the 10
frames are selected and before they are uploaded (the upload step deletes them),
`generate_marked_frames()` runs `swing_marker.mark_swing()` over them. Marked
variants are uploaded next to the plain ones:

```
golf-swings/<user>/<analysis>/frames/<analysis>/frame_003_Frame_at_1.20s.jpg          # plain
golf-swings/<user>/<analysis>/frames/<analysis>/marked/frame_003_Frame_at_1.20s.jpg   # marked
```

Each `analysis_results.frames[]` entry gains `marked_url` + `marked_key`, and
the record gains:

```jsonc
"marking": {
  "version": "2.1.0",
  "generated": true,
  "markings_rendered": ["head_circle", "plane_line"],   // sorted; only what passed every gate
  "failures": [{"marking": "spine_line", "reason": "shoulder/hip confidence 0.31 < 0.4"}],
  "geometry": { "frame_width": …, "frame_height": …, "view": {...}, "facing": …,
                "ball": …, "shaft": …, "markings": {...} },   // keypoints dropped: 50 floats no consumer reads
  "frames_marked": 10,
  "frames_skipped": [],
  "frames": [{"phase": "frame_003", "key": "…/marked/…jpg", "url": "https://…"}]
}
```

Failure modes, all of which leave `generated: false` **and a `reason`**: flag
off, no frames, marking module or its native deps missing from the zip/layer,
`mark_swing` raised, every marking withheld by its own confidence gate, or every
marked upload failed.

**Processor** (`AWS/src/ai-analysis/ai-analysis-processor.js`): when the flag is
on and `marking.generated` is true, it resolves marked URLs for the frames it
selected and sends **those instead of** the plain frames, appending
`MODE_1_MARKING_INSTRUCTION` to the vision prompt (both the fact-extraction pass
and the direct-render fallback). It is all-or-nothing: if any selected frame has
no marked variant, or any marked download fails, it discards them and downloads
the plain set — a fixed ruler on half a sequence is worse than none. Telemetry
carries `markedFramesUsed` / `markingEnabled`, and the result carries
`marked_frames_used`.

## Mode 2 — display decision layer

`AWS/src/marking/displayPolicy.js` — pure, no I/O:

```js
shouldShowMarking({ question, coachIntent, markingAvailable, comparison, entitlementActive })
// -> { show, kind: 'single'|'side_by_side'|null, reason, frames: [...], marking, topic, entitlement_active }
```

- Topic → marking is strict: plane question → `plane_line`, posture → `spine_line`, head → `head_circle`. A question the markings do not answer shows nothing.
- `coachIntent: { show: false }` is an absolute veto; `{ show: true, topic }` is an explicit request. The coach owns the call.
- A marking must be `generated`, actually rendered (not in `failures`), and clear a display confidence bar of **0.5** — deliberately above the generator's own gates (plane 0.45 / spine 0.40 / head 0.35), because showing a line to a human is a higher bar than feeding one to a model. A rendered marking with no recorded confidence fails closed.
- `side_by_side` = the SAME marking type on the prior and current swing, at the same phase, preferring impact (the flagship impact-vs-plane, now-vs-then case).
- **Refused side-by-side does not fall back to a single frame.** The player asked a then-vs-now question; one marked swing in reply reads as the comparison. Half a comparison is a wrong answer, not a partial one.
- Cross-session framing (the backlog's biggest Mode 2 risk) is checked with every signal available and the failing one is named in `reason`: view label match, facing match, aspect ratio (±2%), impact-anchored extraction on both sides, and apparent player scale (head-circle radius ratio within 1.5×).
- `entitlementActive` is echoed as `entitlement_active`, never enforced — the paid-tier question is open, so the caller applies that policy.

Two rules were tightened beyond the brief, both toward showing less:
1. A **comparative question about something no marking measures** (tempo, grip, distance…) shows nothing, rather than defaulting to the flagship plane comparison. The default only applies to a topic-free "how does this compare?".
2. The no-single-fallback rule above.

## Chat wiring and the `display_frames` payload

Two routes reach the policy, matching the two `kind`s:

- **`side_by_side`** — `loadComparisonFrames(plan, { swings, question })` builds the
policy input from the swing records, calls `shouldShowMarking`, and returns
`{ groups, display_frames, display_meta }`.
- **`single`** — `decideSingleMarkingDisplay({ swing, question })` inside
`answerVisualQuestionWithFrames` (the frame re-review route a plane / posture /
head question already takes). Only the frames that route actually loads are
candidates, so a frame that is shown is always a frame the model saw. Note that
those frames carry no phase hint, so the policy picks the middle of the loaded
set — with the event-anchored extractor that lands in the dense window around
impact, but it is not guaranteed to be the impact frame.
 When the policy says show, the marked
variant replaces the plain frames attached to the model for that turn (so the
coach's words match the picture the player sees) and chatLoop adds a system
message lifting the Mode 1 silence rule **for that turn only**. `chatLoop` still
accepts the legacy array return shape.

The chat response payload gains, only when something is actually being shown:

```jsonc
{
  "response": "…coach reply…",
  "display_frames": [
    {
      "role": "prior",                    // "prior" | "current"
      "kind": "side_by_side",             // "single" | "side_by_side" (same for every item)
      "label": "EARLIER SWING (2025-09-20) — impact",
      "s3_key": "golf-swings/u1/old1/frames/old1/marked/frame_002.jpg",   // the MARKED variant
      "url": "https://<bucket>.s3.amazonaws.com/<s3_key>",
      "plain_s3_key": "golf-swings/u1/old1/frames/old1/frame_002.jpg",    // unmarked original
      "plain_url": "https://<bucket>.s3.amazonaws.com/<plain_s3_key>",
      "analysis_id": "old1",
      "captured_at": "2025-09-20T10:00:00Z",
      "phase": "frame_002",
      "phase_hint": "impact",             // address | top | impact | finish | approximate
      "timestamp": 0.6,
      "markings": ["plane_line"]          // which marking types this frame is being shown for
    },
    { "role": "current", "...": "…" }
  ],
  "display_frames_meta": { "kind": "side_by_side", "marking": "plane_line", "reason": "…" }
}
```

Client contract (no React Native code was changed):
- Both fields are **absent** when nothing is shown. Treat absent and `[]` the same.
- `kind: "side_by_side"` always carries exactly two items, `prior` first then `current`; render them adjacent, labelled. `kind: "single"` carries one.
- Render from `url` (or fetch `s3_key`). `plain_s3_key` is there if the client wants a toggle; the server never requires it.
- Order is meaningful. Do not sort.
- The reply text stands alone: if the client cannot render the images, the coaching is still complete.

## Deployment notes

- The extractor zip must now include `marking/swing_marker.py` (+ `__init__.py`) — `deploy-frame-extractor.sh` does this. It also needs the marking layer described above; without it the extractor logs `swing_marker unavailable` and carries on.
- The chat handler zip must include `marking/displayPolicy.js` (pure JS, no extra deps).
- The AI processor needs **no** marking code — it only reads URLs.

## Tests

- `AWS/test/markingDisplayPolicy.test.js` (21) — show / no-show / side-by-side / incomparable framing (view, aspect, anchor, camera distance) / withheld / low-confidence / veto / entitlement echo.
- `AWS/test/markingChatWiring.test.js` (12) — marked frames fetched when the policy says show, plain otherwise, flag-off path, single-frame decision, payload carries `display_frames`, chatLoop passes swings+question and returns the frames, legacy loader shape.
- `AWS/test/test_frame_extractor_marking.py` (11, stdlib `unittest`) — flag parsing, module-missing / marker-raised / all-withheld fail-soft, marked S3 key layout, cross-link, upload failure, garbage input. Run: `python3 -m unittest discover -s AWS/test -p 'test_*.py'`.
