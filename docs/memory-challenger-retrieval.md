# Coaching Memory Challenger — "Relevance Retrieval"

Status: additive challenger, not wired into any production path.
Module: `AWS/src/memory/relevanceRetrieval.js` · Tests: `AWS/test/relevanceRetrieval.test.js` (16 tests, `npm run test:aws`)

## The champion, and why it loses

The champion (`buildDeveloperContext` fed by `getLastAnalyzedSwings({ limit: 2 | 3 })`) always injects the **most recent** 2–3 swings. Recency is its only selection signal. That is correct for "how did I look today?" and wrong for everything that makes coaching *coaching*:

- "Is this better than my first video?" → the relevant swing is the oldest one on record, which the champion never loads.
- "Did I ever fix my early extension?" → the answer lives in whichever swings mention early extension, at any point in the timeline.
- "How was I hitting it a month ago?" → a specific window, not the newest N.

The champion cannot answer these because the retrieval step throws the evidence away before the model ever sees it.

## How Relevance Retrieval works

Given the current question (or, when there is no question, the current swing's observations + profile focus areas), it scores **every** available past swing and chat turn and injects the most relevant ones. Recency becomes one signal among several rather than the only one.

**Signals** (each normalized 0–1; only *applicable* signals are used and their weights renormalized, so scores stay comparable):

| Signal | Weight | What it does |
|---|---|---|
| `fault` | 0.30 | Canonical golf-fault overlap between question and swing |
| `temporal` | 0.34 / 0 | Fit to an explicit temporal cue; zero when no cue is present |
| `recency` | 0.15 → 0.40 / 0.06 | Exponential decay, 45-day half-life. Rises to 0.40 with no temporal cue, drops to 0.06 when a cue exists |
| `lexical` | 0.13 | IDF-weighted term overlap, corpus built from the player's own history |
| `metric` | 0.10 | Numeric proximity of shared metrics to the current swing |
| `phase` | 0.09 | Swing-phase overlap (setup / takeaway / backswing / transition / downswing / impact / follow-through) |

**Fault vocabulary** — 25 canonical faults (`early_extension`, `casting`, `over_the_top`, `sway`, `slide`, `chicken_wing`, `reverse_pivot`, `hanging_back`, `stalled_rotation`, `steep_shaft`, `shallow_shaft`, `laid_off`, `across_the_line`, `cupped_wrist`, `bowed_wrist`, `over_swing`, `flat_shoulder_plane`, `grip`, `head_movement`, `tempo`, `setup_posture`, `alignment`, `face_control`, `contact`, `ball_flight`), each with player-language and coach-language surface forms. This is what makes *"am I still standing up through it?"* match a stored *"early extension"* observation with zero embedding calls.

**Temporal cues**, resolved in priority order:
- `window` — "in the last month", "3 weeks ago", "since March" → date range, in-window scores 1.0 and decays outside.
- `oldest` — "first", "earliest", "original", "when I started" → oldest-on-record scores 1.0.
- `span` — "ever", "since", "compared to", "progress", "still", "improved" → both ends of the timeline score high (you need the before *and* the after).
- `newest` — "latest", "most recent", "my last video".

**Chat turns** are scored the same way, with turns already inside the live 12-turn window (`chatRepository.MAX_CHAT_TURNS`) discounted ×0.35 — they are already in the prompt, so retrieving them again buys nothing. What this buys is turn #1 from six months ago.

**Packing**: candidates are ranked, capped (4 swings / 4 turns), then greedily packed against `budgetTokens` minus a fixed 214-token envelope reserve, so the *rendered string* honours the budget, not just the item list. The top-ranked swing is always kept so retrieval never returns empty-handed when history exists.

## What it enables that the champion cannot

1. **Cross-time comparison.** "Better than my first video?" retrieves `swing-oldest` with `timeline_position: "oldest_on_record"` and its actual observations, so the model can name what changed instead of guessing.
2. **Fault-history queries.** "Did I ever fix my early extension?" pulls the swings that actually discuss early extension, at whatever date, plus the oldest/newest anchors for a verdict.
3. **Player-language → coach-language matching.** No user says "early extension"; they say "I stand up." The vocabulary bridges that.
4. **Explainable retrieval.** Every injected item carries `retrieved_because` and a `relevance` score; `rationale.scoredSwings` exposes the full ranking with per-signal breakdown for offline eval.
5. **Anti-hallucination framing.** The rendered block leads with "selected by relevance, NOT recency — check `capturedAt`/`age_days` before calling anything 'your latest swing'", because a retrieval system that hands the model a 7-month-old swing without saying so will get it called "yesterday".
6. **Graceful degradation.** Generic questions with no cues fall back to recency-dominant ordering — i.e. it reproduces the champion's behaviour exactly where the champion was already right.

## Template-poisoning guarantee (Feb 2026 rule, preserved)

Analysis-time context deliberately excludes prior coaching summaries so the model stops parroting its own prior wording. This challenger **does not reintroduce that**:

- Coaching prose (`summary`, `ai_analysis.coaching_response`, assistant turns) is used for **matching only** — it never reaches the rendered output.
- Rendered swing entries contain only: `analysisId`, `capturedAt`, `age_days`, `timeline_position`, `faults_detected` (canonical labels, not model wording), up to 3 `observations` (raw visual facts, ≤170 chars), `metrics`, and `retrieved_because`.
- `renderRetrievedContext(selection, { mode: 'analysis' })` additionally drops all `conversation_excerpts`, leaving zero coach prose in the payload. This is asserted by a test.
- Chat mode may include short user/assistant excerpts (≤200 chars) — chat already carries summaries today — under an explicit "do not reuse or imitate prior coaching wording" rule.

## Token cost

| Scenario | Rendered tokens |
|---|---|
| Typical: 8-swing history, 4 selected, no chat turns | 770–840 |
| Full: 8 swings + 20 chat turns, 4 swings + 4 turns selected | ~1,050–1,200 (hard cap) |
| Empty history | ~230 (envelope only) |
| Champion `buildDeveloperContext` for comparison, 2–3 swings with summaries | ~600–1,400 (unbounded — grows with `coaching_response` length) |

Default `budgetTokens: 1200`, enforced end-to-end: `estimateTokens(renderRetrievedContext(selection)) <= budgetTokens` is asserted against a deliberately verbose 12-swing / 24-turn corpus. Compute cost is a few hundred regex tests per candidate — sub-millisecond for realistic histories (16 tests run in ~67 ms total), zero network calls, zero new dependencies, zero new tables.

## Honest weaknesses

1. **Lexical matching is brittle outside the vocabulary.** A fault phrased in a way not in `FAULT_VOCABULARY` (regional slang, a new coach phrasing, a typo) falls through to weak IDF token overlap. The vocabulary is hand-maintained and will drift behind how the analysis model actually writes. An embedding index would not have this failure mode.
2. **No negation handling.** "Your early extension is gone" and "you have early extension" both match `early_extension` identically. The model sees the observation text and can sort it out, but the *ranking* cannot distinguish "fault present" from "fault fixed" — which is exactly the question in "did I ever fix it?".
3. **Retrieval is bounded by what the caller passes in.** `getLastAnalyzedSwings` caps at `MAX_RECENT_LIMIT = 10`. To genuinely reach "your first video" from a 40-swing history, the caller needs a wider fetch (higher limit, or a cheap projection query returning only `analysis_id`/`captured_at`/observations). Without that, this module reranks a recency-truncated candidate set and the headline use case degrades quietly.
4. **Temporal regexes are English-only, present-tense-only, and greedy.** "still" always triggers a `span` cue even as filler; "last" is disambiguated only by a following time unit. Misclassification is soft (wrong weighting, not wrong data) but real.
5. **Metric proximity is a weak similarity proxy.** Current metrics are largely capture artifacts (`fps`, `video_duration`, `frames_extracted`) rather than swing mechanics, so the signal is closer to "filmed the same way" than "swung the same way". It carries only 0.10 weight for that reason.
6. **Fixed weights, no learning.** Weights are hand-tuned against the intended scenarios, not fit to judged relevance data. There is no click/eval feedback loop, so an eval harness scoring retrieval precision against labelled question→swing pairs is the obvious next step.
7. **No dedupe across near-identical swings.** Ten sessions with the same fault will happily fill all 4 slots with near-duplicates instead of spanning the timeline. Diversity/MMR-style reranking is not implemented.

## Export signatures

```js
const {
  selectRelevantHistory,   // ({ question, currentSwing, swings, chatTurns, swingProfile,
                           //    budgetTokens = 1200, maxSwings = 4, maxTurns = 4,
                           //    liveWindowTurns = 12, now = Date.now() })
                           //   -> { selectedSwings, selectedTurns, rationale }
  renderRetrievedContext,  // (selection, { mode = 'chat'|'analysis', format = 'json'|'text' }) -> string
  scoreRelevance,          // ({ query, candidate, currentSwing, corpusStats, now, ordinal, total, weights })
                           //   -> { score, signals, reasons, weights }
  analyzeQuery,            // ({ question, currentSwing, swingProfile, now }) -> query object
  detectTemporalCue,       // (question, now) -> { cue, window, matched }
  extractFaults,           // (text) -> canonical fault keys
  extractPhases,           // (text) -> canonical phase keys
  estimateTokens,          // (stringOrValue) -> number
  FAULT_VOCABULARY, PHASE_VOCABULARY, DEFAULT_BUDGET_TOKENS, ENVELOPE_TOKEN_RESERVE,
} = require('./AWS/src/memory/relevanceRetrieval');
```

`selectedSwings` / `selectedTurns` are the original records shallow-cloned with an added `relevance: { score, signals, reasons, timelinePosition }`, so existing accessors (`swing.analysisId`, `turn.content`) keep working.

## Drop-in wiring (not applied — champion path untouched)

```js
// chatLoop.js, alongside the existing developerContext
const retrieved = selectRelevantHistory({
  question: message,
  swings: allSwings,            // widen getLastAnalyzedSwings limit to feed this
  chatTurns: recentTurns,
  swingProfile,
  budgetTokens: 1200,
});
baseMessages.push({
  role: 'system',
  content: `Retrieved history: ${renderRetrievedContext(retrieved, { mode: 'chat' })}`,
});
```
For `ai-analysis-processor.gatherDeveloperContext`, use `{ mode: 'analysis' }` — it emits observations and metrics only, never prior coaching prose.
