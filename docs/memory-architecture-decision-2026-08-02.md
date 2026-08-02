# Coaching Memory: four-way evaluation and architecture decision

**Fixture:** one real user, **68 completed analyses, 2025-09-20 → 2026-06-03** · **Method:** 4 context strategies × 8 memory probes = 32 model runs (gpt-5.6-terra, production system prompt), blind-scored by a strict evaluator against ground truth computed directly from all 68 sessions.

## Scores

| Strategy | Grounding | Recall | Change | Honesty | Useful | **Total** | Fabrications | Degree claims | False premises refused |
|---|---|---|---|---|---|---|---|---|---|
| **Retrieval** | 16 | **26** | 18 | 20 | **24** | **104** | 5/8 | 1/8 | 1/2 |
| **Champion** (current) | **19** | 10 | 15 | **29** | 23 | 96 | **2/8** | **0/8** | 1/2 |
| **Ledger** | 15 | 21 | 13 | 17 | **24** | 90 | 5/8 | 4/8 | 1/2 |
| **Combined (C)** | 12 | 22 | 10 | 15 | 22 | **81** | **6/8** | **6/8** | **2/2** |

**18 of 32 replies fabricated.** This is not a ranking of good options.

The champion scores well on honesty for a bad reason: recall of 10/40 is barely above the floor of 8 that a reply making *no* historical claim would earn. It is honest because it remembers nothing.

## The combined design failed, and the failure is instructive

C was built to fuse retrieval's recall with the ledger's change-detection, plus a verification guard. Result: **worst total (81), most fabrications (6/8), most unsupported degree claims (6/8)** — while being the *only* arm to refuse both false premises (2/2).

Its guard works. Its change-detection layer poisons everything else.

### The decisive test

> *"Is my early extension better than it was in the video you just analyzed?"*

- **Champion / Ledger / Retrieval:** all correctly refused.
- **Combined:** *"**Yes—your early extension has improved**… it looks more like a small late-through-impact tendency now rather than the bigger movement it used to be."*

Entirely fabricated. The context contained:
```
"since_then": {"status":"improved", "basis":"severity 0.6->0"}
"trend":"improving"
"basis":"not_observed_this_session"
```
`0.6` is a **hardcoded default** for faults inferred from legacy prose. `0` means the fault was simply *not mentioned* in the newest session. The pipeline compared an invented constant against a silence and called it improvement.

## Why numeric severity cannot be the fix

The data cannot support it, and never will:

| | |
|---|---|
| Sessions mentioning early extension | 3 of 68 |
| Of those, sessions with structured observations | **0** |
| Numeric metrics across all 68 sessions | **NONE** |
| Sessions with any structured observations | 22 of 68 |

Even if we started emitting graded severity today, **the score is model-dependent**. gpt-5.2 and gpt-5.6-terra grade differently; every model change silently re-baselines the series. A longitudinal metric whose scale shifts under you is worse than no metric, because it looks comparable. Absence of a fault also cannot be distinguished from a camera angle that failed to show it.

## Decision: visual re-comparison, not scored memory

Retrieve the **prior swing's frames** and compare them against the current swing's frames **in a single model call**. One model, one moment, both images in view — no cross-time calibration, no stored score, no drift.

### Validated end-to-end (2026-08-02)

Oldest session (2025-09-20) vs newest (2026-06-03), 4 frames each, real S3 objects:

> "**Cannot tell from these images.** Early extension is best judged from a down-the-line view at/just after impact… **Earlier swing:** the view is essentially face-on, so it does not show hip depth relative to the ball well. **Current swing:** the camera is closer to down-the-line… but there is **no impact or early-follow-through frame** — only address, top of backswing, and finish… To compare it properly, provide matching down-the-line frames at address, lead-arm-parallel, impact, and just after impact."

It refused — but the refusal is **diagnostic and actionable**, citing the exact deficiency and the exact fix. Every memory architecture that refused this question gave a generic "send me a clip." This one explains what it saw and what it needs.

**This also compounds with the event-anchored extractor.** The reason the comparison failed is a missing impact frame — and the legacy uniform extractor captured impact only **27%** of the time versus **86%** for the event-anchored one now in production. Comparisons over swings captured from today forward will have the frames this needs.

### Feasibility (verified)
- Frames from **10.5 months ago still exist** in S3 (16 frames/session, ~35 KB each).
- **No lifecycle policy** on the bucket — nothing is being expired. Add one deliberately rather than discovering it later.
- Storage for the entire bucket (3.84 GB): **$0.09/month**. Per user with 68 sessions: **~$0.001/month**.
- Measured comparison cost: **8,009 input + 270 output tokens ≈ $0.019** at terra pricing — roughly 40% of a full analysis ($0.047).

### Design notes
- **Cap re-analysis at 1–2 prior swings.** Cost and cognitive load both scale linearly; the coaching value does not.
- **Enables a real feature:** show the old frame beside the new one. The user sees the evidence rather than trusting a number — the only form of progress claim that is self-verifying.
- Pair with **retrieval** to choose *which* prior swing to compare (it already surfaces the right session and won recall 26/40), and with **C's verification guard** (2/2 on false premises, zero false positives across the other six probes).

## Recommended architecture
1. **Retrieval** for finding relevant history — best recall, structurally avoids template poisoning.
2. **C's prescription-verification guard** for false premises — the only mechanism that survived the trap.
3. **Visual re-comparison** for change over time — replaces scored change-detection entirely.
4. **Discard** the ledger's severity scoring and C's `since_then`/`trend` fields. Do not ship numeric change-detection against this data.
5. **Widen `getLastAnalyzedSwings`** (currently capped at 10) with a `ProjectionExpression` excluding `analysis_results` — 66% of payload weight that memory never uses.

## Status
All three challenger branches pushed and additive; champion path untouched. **Nothing is wired into production.**
