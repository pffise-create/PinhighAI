# Swing Marking Tool — `AWS/src/marking/swing_marker.py`

**Version:** `marker_version 1.0.0` · **Built:** 2026-08-02 · Requirement: `docs/backlog/swing-marking-tool.md` · Research: `docs/marking-research-2026-08-02.md`

## How it works

All geometry is computed **once per swing** from the address frame (frame 1) and rendered with identical coordinates on every frame — the temporal-consistency rule holds by construction, and the test suite asserts pixel-identical overlays across a sequence.

1. **Pose** — MoveNet SinglePose Thunder (TFLite f16, Apache-2.0) on the address frame only. 17 COCO keypoints, letterboxed 256×256 input, `num_threads=1` for determinism. Model provenance (URL + sha256) is in the module docstring; loaded from `SWING_MARKER_MODEL_PATH`, `<module>/models/`, or `/opt/models/` — never the network.
2. **Person gate** — mean core-keypoint score ≥ 0.30 plus anatomical vertical-order sanity. Fails ⇒ all markings withheld.
3. **View classification** — `spread_ratio` = mean(shoulder, hip x-spread) / torso length. ≥ 0.42 ⇒ `face_on`, ≤ 0.30 ⇒ `dtl`, between ⇒ ambiguous (view-gated markings withheld below confidence 0.5). Fixture results: face-on 0.50, DTL 0.03 / 0.03 / 0.21 — the bands are wide.
4. **DTL only: shaft** — `cv2.HoughLinesP` in a wrist-anchored ROI on the facing side; segments gated on angle (20–80° from horizontal), direction, and upper-endpoint proximity to the hands.
5. **DTL only: ball** — bright-blob detection (max-RGB-channel, catches white and yellow balls) near the shaft's clubhead end; multi-threshold sweep + eroded-mask pass (splits ball⇄clubhead-glint bridges); blobs gated on area, aspect, fill, contour circularity, brightness margin. Candidates are score-ranked and the first that **mutually confirms** against the shaft line (on-line within an angular tolerance fanned from the hands anchor, and within `[-0.15, 0.90]`×segment-length of the clubhead end) becomes the plane-line origin. No confirmed ball ⇒ **no plane line**.
6. **Markings** — head circle (both views; radius ∝ detected head size: 0.75×inter-ear face-on, 1.4×eye-ear DTL — never fixed pixels), spine line (DTL; hip-mid → shoulder-mid, extended), plane line (DTL; ball → shoulder-mid, extended past the shoulders).

## Geometry JSON schema (deterministic: sorted keys, 6-decimal floats)

```jsonc
{
  "marker_version": "1.0.0",
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

| Constant | Value | Purpose |
|---|---|---|
| `plane_color` | `#FFAA33` amber | one color per marking type, everywhere |
| `spine_color` | `#2EC4B6` teal | |
| `head_color` | `#FF6B6B` coral, ring only | never a filled blob |
| `halo` | `#0A0C0E` @ alpha 110, 1.9× stroke width | reads on grass, sky, mats, concrete |
| `line_width_ratio` | 0.006 × frame width (min 2 px) | weight scales with resolution |
| `supersample` | 3× draw + LANCZOS downsample | anti-aliasing; round caps drawn explicitly |

No text labels on frames in v1. Rendering is deterministic (same geometry + size + style ⇒ byte-identical overlay).

## What fails closed, and when

A wrong marking is worse than no marking; every gate below withholds rather than guesses, and records why in `failures`:

- **Everything** — no/garbage person (low pose confidence, implausible layout, degenerate torso); ambiguous camera view.
- **Plane + spine** — view is `face_on` (DTL-only markings).
- **Plane line** — facing direction undeterminable; OpenCV missing; no plausible shaft segment; no compact bright ball blob; shaft and ball disagree (off-line or a glint up the shaft). Known real case: cluttered/low-contrast lies (research §4.2).
- **Head circle** — <3 confident head keypoints; no measurable ear/eye pair; nose outside candidate circle; head-diameter/torso ratio outside [0.22, 0.90] (catches cap/visor keypoint displacement).
- **`mark_swing` skips frames** that are unreadable or whose dimensions differ from the address frame (geometry from one camera must not be rescaled onto another).

## Tests

`AWS/src/marking/test_swing_marker.py` (13 tests, plain `unittest`, run with the dev venv python + `SWING_MARKER_MODEL_PATH` / `SWING_MARKER_FIXTURES` env): pixel-stability (byte-identical overlay across frames + marked-frame recomposition equality + single-geometry assertion), fail-closed on noise, head-radius proportionality (2× head ⇒ 2× radius; cross-session radii diverge >1.5×), view classification on all four real fixture sessions, determinism (byte-identical JSON on repeat), JSON roundtrip + versioning.

## Production packaging (per research §3)

- Lambda python3.9 zip layer: `tflite_runtime==2.14.0` (cp39 manylinux2014, 2.4 MB wheel) + `opencv-python-headless` + numpy + Pillow; model file (12.6 MB) shipped in the layer at `/opt/models/movenet_singlepose_thunder_f16.tflite`. The module tries `tflite_runtime` → `ai_edge_litert` (macOS dev) → `tensorflow.lite`.
- The model binary is **not** committed to the repo — download per the module docstring (URL + sha256 recorded there) and verify the hash.
- Cost: zero model-API calls; ~0.5–1.5 s CPU per swing. Not yet wired into any Lambda or the chat path (later phase; see backlog items 5–7 — coaching-quality eval is the ship gate).
