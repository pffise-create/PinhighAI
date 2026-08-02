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
