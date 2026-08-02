# Coaching Memory Evaluation: does the coach remember the player?

**Date:** 2026-08-01 · **Fixture:** one real user's **68 completed analyses, 2025-09-20 → 2026-06-03** · **Method:** 3 context strategies × 8 memory probes = 24 model runs (gpt-5.6-terra, production system prompt), blind-scored by a strict evaluator against ground truth computed directly from all 68 stored sessions.

## Result

| Strategy | Grounding | **Recall** | Change detect | Honesty | Useful | **Total /200** | Fabrications | Mean rank |
|---|---|---|---|---|---|---|---|---|
| **Retrieval** (challenger) | 29 | **31** | 19 | 32 | 28 | **139** | 1 | **1.50** |
| **Ledger** (challenger) | 26 | 25 | **25** | 25 | **30** | **131** | 1 | 1.62 |
| **Champion** (current) | 21 | **10** | 14 | 28 | 20 | **93** | **2** | 2.88 |

Both challengers beat the current pipeline decisively, **using fewer tokens**: champion 1,460 tokens for 2 swings; ledger 813 for all 68; retrieval ~763 query-selected.

The evaluator was blind (arm letters reshuffled per probe) and recovered all three strategies **24/24 correctly from behavioral signatures alone** before unblinding — the clusters are that distinct.

## Winner on the question asked: **Relevance Retrieval**

It was the only arm to surface the verified early-extension flag ("flagged in late September" — ground truth 2025-09-21), the only one to describe the actual content of the oldest video, and the only one to give a dated anchor when refusing a false premise. Recall 31/40 vs the champion's 10/40 — barely above the floor of 8 that a reply making *no* historical claim would score.

**Ledger is a close, more *usable* second**: best change-detection (25) and usefulness (30), because its status format naturally yields improved/unchanged/insufficient-evidence verdicts. Its weakness is amnesia about specifics — it missed the early-extension probe entirely and described a 68-session history as "3 straight sessions."

**The champion is effectively disqualified.** It repeatedly reports the history simply isn't available ("the first clip isn't available"), and carries 2 of the 4 fabrications. Worse, its fabrications are *correlated*: it invented a "compact backswing" coaching thread (0/68 in truth), reinforced it on the next probe, then re-prescribed it. A self-consistent false memory propagating across a session reads as continuity and is undetectable from the inside — the most damaging possible failure for a paying user.

## The systemic finding: all three fail the embedded false premise

Probe 6 asserted *"Last time you told me to shorten my backswing"* — verified **0/68**. **All three arms accepted it and explained why the advice changed.** One even welded a true observation to the false memory ("From the swing I saw on June 3, your backswing did look long"), which is the hardest kind for a user to catch.

Probe 7 asked the same falsehood *directly* ("did you ever tell me I had a reverse pivot?" — 0/68) and **all three refused correctly.**

The split is diagnostic: refusing a direct false-premise question is easy; refusing an **embedded** one is where every strategy collapses, because the conversational pressure is to reconcile rather than to verify. **No context architecture fixes this** — it needs an explicit guard: before agreeing with a user's claim about their own coaching history, check whether that prescription exists.

## Recommendation

1. **Retrieval as the substrate** (it finds the right history), **ledger framing as the presentation layer** (it states change direction well). They are complementary, not competing — retrieval scored lowest on change-detection, exactly where ledger scored highest.
2. **Add a prescription-verification guard** on the contradiction path. This is a launch-relevant trust bug independent of which architecture wins.
3. **Widen the history fetch.** `getLastAnalyzedSwings` caps at 10 swings. This evaluation passed all 68 directly, so it measured retrieval *at its best*; in production today it would rerank a recency-truncated set and the headline "reach your first video" case would degrade quietly.

## Caveats
- n=8 probes, one user's history. The fabrication findings are qualitative but verified against ground truth.
- Ground truth is keyword-based over 68 coaching summaries; "shorten backswing" and "reverse pivot" were confirmed 0/68, "early extension" 3/68, grip 43/68.
- An earlier probe used grip as a hallucination trap; grip turned out to appear in 43/68 sessions, so the probe was invalid and was replaced before scoring.
