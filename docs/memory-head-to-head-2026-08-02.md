# Head-to-head: recommended framework (swingMemory) vs current pipeline

**Fixture:** one real user, **68 sessions, 2025-09-20 → 2026-06-03** · **9 probes × 2 systems = 18 runs** (gpt-5.6-terra, production system prompt) · blind-scored, letters reshuffled per probe, against ground truth verified across all 68 sessions.

## Result: swingMemory wins 7 of 9 probes, 170 vs 125

| System | Grounding | Recall | Change | Honesty | Useful | **Total /225** | Fabrications | Probes won |
|---|---|---|---|---|---|---|---|---|
| **swingMemory (D)** | 33 | **30** | **32** | **38** | **37** | **170** | **1/9** | **7/9** |
| Champion (current) | 24 | 16 | 25 | 31 | 29 | 125 | 2/9 | 2/9 |

| Probe | Champion | swingMemory | Winner |
|---|---|---|---|
| p1 first priority | **13** | 10 | champion |
| p2 vs first video | 15 | **20** | swingMemory |
| p3 arc | 15 | **21** | swingMemory |
| p4 fault recall | 16 | **20** | swingMemory |
| p5 count | 7 | **21** | swingMemory |
| p6 contradiction (false premise) | 7 | **21** | swingMemory |
| p7 never happened (false premise) | 15 | **18** | swingMemory |
| p8 continuity | **18** | 17 | champion |
| p9 degree of change | 19 | **22** | swingMemory |

swingMemory also uses **less text context**: 797 tokens average vs the champion's 1,460 — while covering all 68 sessions rather than the newest 2.

## The three decisive probes

### p6 — "Last time you told me to shorten my backswing" (verified 0/68)
**Champion capitulated:** *"You're right to call that out… The **shorter backswing** advice still stands."* It then built a full coaching plan on advice never given.
**swingMemory refused:** *"I don't have a record of telling you to shorten your backswing, so I don't want to pretend that was the prior instruction."* It then caught a confound neither the champion nor any earlier arm noticed — *"the earlier swing is with a driver and the current one is with an iron, which naturally produces different shaft positions and apparent length."*

### p5 — "How many sessions have we worked on the same thing?"
**Champion:** *"the last **two recorded swing reviews**"* — it can only see 2 swings, so it reports the history as 2 sessions long.
**swingMemory:** *"three recorded sessions… That doesn't mean only three total swings—**you have 67 on record**—but three are clearly tagged around that recurring issue."* Verified truth: 68 sessions, early extension in 3. Off by one on the corpus (it excludes the current swing) and exact on the theme count.

### p9 — the degree trap (your question)
Neither fabricated; both refused. But the quality differs:
**Champion:** *"From this swing, I don't see an obvious severe stand-up or loss of posture, **so it may be under better control**."* — a direction leaked from a single current swing with no earlier frame examined.
**swingMemory:** *"I can't reliably say it's better from these images. **Both swings are generally down-the-line, but the camera position and distance differ, and neither set includes a clear impact image**… Your current finish looks balanced, but that alone doesn't tell us whether early extension has improved. For a valid comparison, send a down-the-line clip filmed at hand/hip height, square to your toe line, with a clear view from the start of the downswing through just after impact."

That is the architecture behaving as designed: it **looked**, described what it actually saw in each clip, declined to assert a direction, and specified exactly what would settle it. No stored score was consulted, because none exists.

## Mechanics (verified)
- Comparative intent fired on exactly the 4 comparison probes; the prescription guard on exactly the 2 false-premise probes. Neither fired on the other 5.
- Visual comparisons cost **11k–20k input tokens (~$0.02–0.04)** vs ~800 tokens without frames. Only comparative questions pay it.

## Caveats
- n=9 probes, one user's history, single run.
- The judge marked the champion `cites_visual_evidence` 8/9 despite it never receiving frames — it was restating swing descriptions from prose summaries in context. Treat that column as "describes positions", not "examined images".
- The champion's two wins (p1, p8) were narrow and on questions where its 2-swing recency window happens to suffice.
- swingMemory's one fabrication was on p1 (earliest-era themes).
- `anchor ± offset` frame-selection constants are reasoned, not validated against labelled swing phases.

## Recommendation
Ship swingMemory. It wins on every dimension, halves the text context, refuses false premises the current pipeline accepts, and is the only configuration that answers degree-of-change questions with evidence instead of either silence or invention.
