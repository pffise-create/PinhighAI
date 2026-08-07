# Swing Marking Tool — `AWS/src/marking/swing_marker.py`

**Version:** `marker_version 3.0.0` · **Built:** 2026-08-02 · **Wired into production:** 2026-08-03 (see § Production wiring) · Requirement: `docs/backlog/swing-marking-tool.md` · Research: `docs/marking-research-2026-08-02.md`

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
   - **Head circle** (both views) — radius ∝ detected head size (0.92×inter-ear face-on, 1.8×eye-ear DTL — never fixed pixels). The face keypoints sit low/forward on the skull, so the center is lifted 0.34×r above the face centroid and (DTL) shifted 0.26×r from the nose toward the occiput — the ring encloses the whole head including cap crown and back of head. Sanity gate: every confident face keypoint must sit inside 0.92×r.
   - **Spine line** (DTL) — hip-mid → shoulder-mid; the top end is clamped so the tip keeps ≥1.18×r clearance from the head-circle center (down to 0.85× torso extent) — it stops short of the jaw/ring.
   - **Plane line** (DTL) — the **detected shaft segment's own direction, anchored at the detected ball**. The angle IS the Hough fit's angle; the shoulder midpoint plays no part. Extent clamps: bottom end just past the ball (max(2.5×ball-r, 1% H) — never through the clubhead into the mat), top end just above head height (0.55×head-r above the ring's top — never into sky/roof), both ends ≥1% inside the frame. Shaft confidence < 0.45 ⇒ plane line withheld with a recorded reason — **no ball→body fallback exists**.

## Geometry JSON schema (deterministic: sorted keys, 6-decimal floats)

```jsonc
{
  "marker_version": "2.0.0",
  "frame_width": 1080, "frame_height": 1920,     // coords normalized by these (r by width)
  "keypoints": {"nose": {"x": 0.42, "y": 0.32, "score": 0.45}, ...},   // all 17
  "view": {"label": "dtl|face_on|unknown", "confidence": 0.9, "spread_ratio": 0.03},
  "facing": "right|left|null",                    // image-space ball side (DTL)
  "ball":  {"x":…, "y":…, "r":…, "confidence":…} | null,
  "shaft": {"x1":…, "y1":…, "x2":…, "y2":…, "confidence":…} | null,   // (x1,y1)=hands end
  "markings": {                                   // ONLY markings that passed every gate
    "head_circle": {"cx":…, "cy":…, "r":…, "confidence":…},
    "spine_line":  {"x1":…, "y1":…, "x2":…, "y2":…, "confidence":…},
    "plane_line":  {"x1":…, "y1":…, "x2":…, "y2":…, "confidence":…}
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
| `casing_color` / `casing_tint` | `#080A0C` @ alpha 210, **0.16 of the marking's own hue** | a pure-black casing on a bright sky reads as "black shape with a colour fringe"; the tint keeps colour identity while staying dark enough to separate |
| `glow_*` | extends 0.85× stroke past the casing, Gaussian blur 1.15× stroke, alpha 95 | depth / legibility on any background |
| `stroke_ratio` | 0.0056 × frame width, clamped to 2.6–9.0 px | PRIMARY weight; supporting markings are ×0.70 |
| `core_*` | 0.26× stroke, 50% toward white, **suppressed below 3.0 px** | below ~3 px the core desaturates the body and beads along a diagonal, so thin strokes degrade to a clean 2-layer casing+body |
| `plane_taper` / `plane_tip_alpha` | 0.50 width, 0.80 alpha at the far tip | the line dissolves rather than ending in a blunt cap |
| `node_scale` | 1.25× stroke, with a bright centre dot | anchors the plane line at the ball |
| `spine_taper` | 0.55 at both tips (spindle) | reads as an axis, not a segment |
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
  the default falls back to `MARKING_PRIORITY = (plane_line, spine_line, head_circle)`.

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
