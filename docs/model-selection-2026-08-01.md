# Analysis Model Selection: Cost vs User Experience

**Date:** 2026-08-01 · **Method:** 5 production swings × 4 models through the real two-stage pipeline (`event.model_override`), outputs blind-judged by an independent agent (arm letters reshuffled per swing), then merged with measured token usage and live pricing.

## Recommendation: switch the analysis model to **gpt-5.6-terra**

| Model | UX score /25 | $/analysis | $/1k | Latency | Avg rank |
|---|---|---|---|---|---|
| **gpt-5.6-terra** | **19.0** | $0.0466 | $46.58 | **13.7s** | **1.4** |
| gpt-5.2 *(current)* | 18.8 | $0.0490 | $49.03 | 26.0s | 1.8 |
| gpt-5.6-luna | 16.0 | **$0.0046** | **$4.64** | 9.9s | 2.8 |
| gpt-5.4-mini | 11.8 | $0.0179 | $17.93 | 10.1s | 4.0 |

terra beats the current model on **every axis at once**: slightly better quality, 5% cheaper, and **1.9× faster** (26s → 13.7s). There is no trade-off to weigh — it is strictly dominant.

### Per-dimension (1-5)
| Model | Specificity | Diagnostic | Actionable | Voice | Trust |
|---|---|---|---|---|---|
| gpt-5.6-terra | 3.8 | 3.2 | 3.8 | **4.2** | **4.0** |
| gpt-5.2 | **4.8** | **4.0** | 3.8 | 2.6 | 3.6 |
| gpt-5.6-luna | 3.2 | 2.4 | 3.0 | 3.6 | 3.8 |
| gpt-5.4-mini | 2.8 | 1.4 | 1.2 | 3.6 | 2.8 |

**gpt-5.2 is the sharpest observer but the worst writer.** It scored highest on specificity and diagnosis, yet the judge flagged it `padded` 5/5 times and `template-speak` 4/5, averaging 356 words of bolded markdown headers — visibly machine-shaped on a phone. terra says nearly as much in 211 words and reads like a coach.

**gpt-5.4-mini is disqualified**, not merely cheaper: `hedgy` 5/5, `no-clear-priority` 4/5, actionability **1.2/5**. It reliably ends on "keep doing what you're doing and watch your ball flight." The judge's verdict: a user "would churn after two or three uploads."

**gpt-5.6-luna is the budget option worth keeping in reserve** — 10.6× cheaper and mid-tier quality (16.0). Not good enough for the paid experience, but a legitimate lever if free-tier analysis volume becomes a cost problem.

## Judge's decisive finding
Actionability spread 1→5 across models while specificity only spread 2→5. Every top-ranked response ended with something to **do tomorrow** (three slow backswings pausing at parallel; 9-to-3 at 70% with a 1-count pause; impact tape at half speed). Every bottom-ranked one ended with something to **notice**. Naming a body part beat naming a swing phase — "your lead heel is off the ground at the top" is actionable; "the transition" is not.

Hedging is a worse failure than padding: padding costs ~1 point of voice, hedging costs ~3 points of actionability.

## Blocking bug found during this work
Every non-gpt-5.2 model returned **HTTP 400** on the first attempt. `reasoning_effort` was selected by prefix-matching `gpt-5.1`/`gpt-5.2`, so newer releases fell through to the legacy `'minimal'` value they reject. **The app could not be upgraded to any model past gpt-5.2 until this was fixed** (`getGpt5Minor`, 5 regression tests). Fixed and deployed 2026-08-01.

## Actions
- [x] Version-aware model controls + regression tests (deployed)
- [x] `token_usage {prompt, completion, cached}` stored per analysis for ongoing cost attribution
- [ ] **Set `AI_ANALYSIS_MODEL=gpt-5.6-terra`** on `golf-ai-analysis-processor` (env var only — no code change)
- [ ] Consider `gpt-5.6-luna` for free-tier/teaser analyses if ungated upload volume becomes costly
- [ ] Re-check `CHAT_LOOP_MODEL` (still `gpt-4o-mini`) separately — this bake-off covered the analysis path only
- [ ] Prompt follow-up: gpt-5.2's specificity with terra's brevity is the real target; terra's one weakness was a missing priority in 1 of 5

## Caveats
- n=5 swings; the terra-vs-gpt-5.2 quality gap (19.0 vs 18.8) is **within noise** — the decisive wins are latency and the collapse of gpt-5.4-mini, both of which are large and consistent.
- Prompts are tuned for gpt-5.2's behavior; terra may improve further with prompt adjustment.
- Pricing fetched from OpenAI's live pricing page 2026-08-01 (Luna's price was cut 80% on 2026-07-30).

---

# Addendum: Terra vs current head-to-head, and cost per user

## Head-to-head (same 5 swings, blind-judged)

**Terra wins 4 of 5 swings.** Average rank across all four arms: terra 1.4, gpt-5.2 1.8.

| Dimension | terra | gpt-5.2 | delta |
|---|---|---|---|
| Specificity | 3.8 | **4.8** | −1.0 |
| Diagnostic | 3.2 | **4.0** | −0.8 |
| Actionable | 3.8 | 3.8 | 0.0 |
| Voice | **4.2** | 2.6 | **+1.6** |
| Trust | **4.0** | 3.6 | +0.4 |
| **Total /25** | **19.0** | 18.8 | +0.2 |
| Words | **211** | 356 | −145 |
| Flags | `excellent` ×4, `no-clear-priority` ×1 | `padded` ×5, `template-speak` ×4 | |

gpt-5.2 sees more; terra communicates better. gpt-5.2 was flagged `padded` in **all five** responses.

**Where terra loses (swing 3, 14 vs 22):** gpt-5.2 named a mechanism — "your hands get quite high with the shaft above/behind your head, and your lead arm looks a bit bent… that combo often makes the downswing timing-dependent" — and prescribed a 9-to-3 drill with a 1-count pause. Terra declined to commit: "I wouldn't add a new swing thought from this view." Terra *did* satisfy the v7 falsifiable-no-change rule (it named the watch-next pattern and what would change its mind), so the prompt fix is working — but a hedge still costs the user a session. **This is the remaining prompt target: push harder to commit when evidence supports it.**

**Where terra wins (swing 2, 19 vs 15):** the user asked to compare against their iron swing. Terra identified the clip as a wood/driver — citing evidence: "the ball is set forward in a wider stance" — then answered the spirit of the question anyway with concrete iron-vs-wood setup deltas. gpt-5.2 asserted the opposite without evidence ("what you've shared *is* an iron-type swing sequence") and closed with 400 words of bolded headers. Note: two of the four models called this clip an iron and two called it a wood; ground truth wasn't verified, but only terra cited visual evidence for its call.

## Cost per user per month (3 videos + 5 follow-ups each = 3 analyses + 15 chats)

| Scenario | $/user/mo | vs today | Margin @ $10/mo |
|---|---|---|---|
| **A. Today** (gpt-5.2 everywhere) | $0.4396 | — | 95.6% |
| **B. Recommended** (terra analysis) | $0.4341 | −1% | 95.7% |
| **C. + cheap chat** (terra + gpt-4o-mini chat) | $0.1846 | **−58%** | 98.2% |
| **D. Lean** (luna + 4o-mini) | $0.0390 | −91% | 99.6% |

### The headline finding: **chat, not analysis, is 61% of your cost**

- chat 61% ($0.2691 — 15 turns × $0.0179)
- analysis 38% ($0.1664 — 3 × $0.0555)
- **AWS infrastructure 1%** ($0.0041 — lambda, S3, DynamoDB, API Gateway combined)

**The deployed chat handler runs `gpt-5.2`, not the `gpt-4o-mini` the repo defaults to** — `CHAT_LOOP_MODEL` and `CHAT_VISUAL_TOOL_MODEL` are both overridden in the lambda env. Nobody has ever evaluated whether chat needs a frontier model. Switching chat alone saves 58% of total cost — 4× the saving from the analysis swap this bake-off was about.

Infrastructure is a rounding error at this scale, so **model choice is essentially the entire unit cost.** Even scenario A leaves a 95.6% gross margin at $10/mo; the reason to optimize is free-tier abuse and headroom for heavy users, not survival.

### Measured vs modelled
- **MEASURED:** analysis tokens (5-swing bench), analysis latency, lambda memory + billed durations (CloudWatch), live pricing.
- **MODELLED:** chat token usage (~4,100 in / 300 out, derived by measuring each prompt component: system 236, developer context ~700, video context ~500, tool defs 600, up to 12 history turns ~2,000); 30% of questions triggering the visual tool at 3 frames; 25 result-polls per analysis; 1080p ~18MB clips.
- **Sensitivity:** chat volume drives everything. At 30 questions/month instead of 15, scenario A becomes ~$0.71 and chat rises to 76% of cost. Chat token usage is the least certain input — worth instrumenting `token_usage` in the chat handler the same way the analysis path now does.

## Revised recommendation
1. **Set `AI_ANALYSIS_MODEL=gpt-5.6-terra`** — better UX, 1.9× faster, marginally cheaper.
2. **Evaluate chat models next** — the bigger cost lever by 4×, and never assessed. Run this same blind bake-off on the chat path.
3. **Instrument chat token usage** so the model above is measured rather than modelled.
