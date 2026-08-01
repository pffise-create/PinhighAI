# Frame-Extraction Bake-off: Champion vs Event-Anchored Challenger

**Date:** 2026-08-01 · **Corpus:** 22 valid video pairs sampled from the production S3 bucket (2–11s clips; 4 corrupt test uploads excluded) · **Judge:** independent blind agent scoring anonymized A/B contact sheets (assignment randomized per video, unblinded only after scoring)

## Result: challenger wins 22–0

| Metric (mean, n=22) | Champion (4fps uniform + evenly-spaced 10) | Challenger (event-anchored) |
|---|---|---|
| Useful frames (of 10) | 5.50 | **8.64** |
| Phase coverage (of 6 phases) | 4.36 | **5.77** |
| Impact-zone frame present | 27% | **86%** |
| Head-to-head wins | 0 | **22** |

Judge's blind observation (before unblinding): the swing-locked pipeline "packs all 10 frames densely into the ~1.5–3s of the actual swing, reliably producing a full ladder (setup, top, transition, downswing, impact, release, finish) and is nearly the only source of true impact-zone frames"; the uniform pipeline "wastes 4–6 slots on near-identical address waggles and post-swing idling, routinely missing the top/downswing/impact window."

## Notes
- Anchor detection succeeded on 22/22 (15 audio+motion agreement, 7 audio-only, 0 fallbacks).
- The sample skews short (2–11s) — the champion's *best* terrain. On longer videos the champion's evenly-spaced selection degrades further (a 60s clip = one frame every 6s), so this result is a lower bound on the challenger's advantage.
- Harness: `AWS/tools/frame_bakeoff.py` (faithful port of production selection logic for the champion arm). Per-video judge scores: `docs/frame-bakeoff-judge-results-2026-08-01.json`.

## Recommended follow-on
1. Port the challenger's anchor + window logic into the frame-extractor lambda (`golf-frame-extractor-simple-with-ai`), keeping uniform extraction as the no-confident-anchor fallback.
2. Raise the client-side video limit 5s → 60s, force 1080p export, bump lambda ephemeral storage; "clearest swing wins" semantics for multi-swing clips (detector already surfaces candidate peaks for a future picker).
3. Re-run the coaching-AI eval afterward — impact visibility was its #1 diagnostic ceiling.
