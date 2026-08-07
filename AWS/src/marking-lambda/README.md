# golf-swing-marker

Dedicated marking Lambda. **Working in production as of 2026-08-07** (marker v5.0.0).

## Why it is separate
opencv + numpy + ai-edge-litert (~236MB unzipped) plus the ffmpeg layer (~160MB)
exceeds Lambda's 250MB ceiling, so marking cannot live in the frame extractor.
It also serves on-demand subset renders for Mode 2 display.

## Config
- Runtime **python3.12** (Amazon Linux 2023). **NOT python3.9**: tflite_runtime
  requires GLIBC 2.27 and AL2 ships 2.26 — that mismatch silently blocked the whole
  feature. AL2023 has glibc 2.34 and `ai-edge-litert` loads cleanly.
- Layer `golf-marking-deps-py312:1` — ai-edge-litert, opencv-python-headless 4.10
  (5.0 is 144MB and blows the ceiling), numpy, Pillow, MoveNet Thunder at
  `/opt/models/`. Tests, headers and .pyi stripped to fit.
- Memory 2048MB, timeout 120s.
- IAM: `golf-marking-write` on role `golf-ai-analysis-role-jbfpg1ve`, scoped to
  `s3:PutObject` on `golf-swings/*/frames/*/marked/*` only.

## Event
```json
{"bucket":"...","frame_keys":["..."],"out_prefix":"golf-swings/<user>/<analysis>/frames/<analysis>/marked",
 "only":["plane_line"],"primary":"plane_line"}
```
`only`/`primary` are optional — omit for all markings (Mode 1 silent grounding),
supply for Mode 2 subset display.

## Rebuilding the layer
```
pip download --only-binary=:all: --platform manylinux_2_17_x86_64 \
  --python-version 312 --implementation cp --abi cp312 -d w \
  numpy pillow opencv-python-headless==4.10.0.84 ai-edge-litert
# unzip wheels into python/, model into models/, strip tests/headers/.pyi,
# publish via S3 (zip is ~99MB, over the 50MB direct-upload limit)
```
