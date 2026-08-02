# Memory Challenger: Longitudinal Coaching Ledger

**Module:** `AWS/src/memory/coachingLedger.js`
**Tests:** `AWS/test/coachingLedger.test.js` (`npm run test:aws`)
**Status:** additive challenger. The champion path (`buildDeveloperContext`, `chatLoop`, `ai-analysis-processor`) is untouched.

## The problem with the champion

`buildDeveloperContext()` hands the model a **snapshot**: the last 2-3 swing records with metrics, optional
visual observations, optional coaching summaries, plus a flat profile. It has no notion of *sequence*.
The model can see two swings but cannot see that early extension was the prescribed priority in all three,
that it has been getting steadily better, or that the alignment question was settled back in March.
And the one field that does carry history — `summary` — is raw prior coaching prose, which is exactly the
thing that caused template poisoning at analysis time in Feb 2026.

## How the ledger works

Four stages, all pure functions, all fed by data we already persist.

1. **Normalize.** Each swing record (`getLastAnalyzedSwings` shape, camel or snake case) becomes a
   `summarizeSwing()` fact bundle: date, analysis id, numeric metrics (pipeline metrics like
   `frames_extracted` / `video_duration` are dropped), per-tag severity, evidence markers, prescribed cues.
2. **Tag, don't quote.** Free text — observations, `priority_fix`, drill/practice recommendations, and for
   legacy records the coaching summary itself — is classified against a fixed 21-entry fault taxonomy
   (`early_extension`, `over_the_top`, `casting`, `face_control`, `low_point`, …). The text is used for
   classification and then **discarded**. What reaches the model is `"priority": "early_extension"`, never
   "your hips are drifting toward the ball." Severity per tag = observation confidence, scaled by impact
   (`negative` → confidence, `neutral` → confidence × 0.5, `positive` → 0).
3. **Diff.** `diffTag()` compares one tag's severity across two sessions (±0.15 threshold) and falls back to
   a directional metric when severity is flat. `diffMetrics()` classifies numeric deltas using a
   name-based direction heuristic (`*sway`, `*loss`, `*deviation` → lower is better; `*turn`, `*rotation`,
   `*speed`, `*lag` → higher is better) with per-metric overrides; anything it cannot type is reported as
   `unknown` rather than guessed. Each ledger entry carries a `carryover` field: *the previous session's
   prescribed priority, re-scored in this session* — `improved | unchanged | regressed | new | unknown`,
   always with a machine-checkable `basis` string such as `severity 0.85->0.7` or `hip_sway_inches 5.5->4.2`.
4. **Aggregate.** Recurring patterns (tag seen in ≥2 sessions, with `first_seen` session/date/swing and an
   `improving | flat | worsening` trend), the active `held_streak` (consecutive sessions on the same
   priority), `ruled_out` (tags only ever observed positively, plus profile strengths that never appear as
   faults), and `player_stated` facts mined from **user** chat turns only (misses, goals, constraints).

`renderLedgerContext()` serializes this to compact JSON with a status legend and four context rules, then
walks a degradation ladder until it fits the token budget: drop metric deltas → drop evidence markers →
drop prescriptions → drop pattern severity arrays → drop sessions. Session 1 is always retained when any
history is shown, so "the same pattern as your first video" is always answerable.

## What it enables that the champion cannot

| Coaching move | Champion | Ledger |
| --- | --- | --- |
| "You've held that fix for three sessions" | no — no notion of a prescribed priority, let alone a run of them | `held_streak: {tag, consecutive_sessions, since_date, since_swing}` |
| "Same early-extension pattern as your first video" | no — sees at most the last 2-3 swings, unlabeled | `patterns[].first_seen: {session, date, swing}` over up to 12 sessions |
| "That's better than last time, and here's the number" | only raw metric values, no direction, no verdict | `carryover.status` + `basis`, `metric_moves[].status` |
| "It's crept back" | no | `regressed` with the severity or metric pair that justifies it |
| "We already checked your alignment" | conflates strengths with focus areas | `ruled_out` |
| "You said you want to kill the slice" | chat turns expire after 12 | `player_stated.{goals,misses,constraints}` distilled to durable tags |
| Avoids parroting its own prior wording | only by *withholding* history (analysis path) | by *structuring* it — history is available and unquotable |

The last row is the point. Template poisoning was solved by deletion; the ledger solves it by
representation, so analysis-time context can regain history without regaining the failure mode.

## Token cost

Default render (`maxEntries: 6`, `maxTokens: 1200`), measured at 4 chars/token:

| Sessions in history | Rendered tokens |
| --- | --- |
| 0 | ~30 (a one-line "no prior sessions" stub) |
| 1 | ~265 |
| 3 | ~540 |
| 6 | ~915 |
| 10+ | ~930 (caps: 6 sessions rendered, rest summarized as `sessions_omitted`) |

Cost is bounded and asymptotic — a two-year-old account costs the same as a six-session one. It degrades
cleanly: at a 400-token budget it still returns valid JSON with the newest session, the priority tags, the
streak and the patterns; at 80 tokens it returns identity + newest priority. For comparison, the champion's
chat context (`includeSummaries: true`) runs 600-1500 tokens for 2 swings and grows with prose length,
so the ledger is roughly cost-neutral while covering an order of magnitude more history.

## Honest weaknesses

1. **Derived, not persisted.** The ledger is recomputed from the last N analyses on every call. That is
   deliberate (no new DynamoDB table, no migration, no write path to keep consistent) but it means: the
   ledger only knows what `getLastAnalyzedSwings` returns — today chat asks for 2-3 swings, so a caller
   must raise the limit (max 10) to get real history; and the "append-only" property is emulated, not
   enforced — if an old analysis record is edited or deleted, history silently rewrites itself.
   Persisting entries under the existing swing-profile item (a `ledger_entries` list, capped) would fix
   both and is a small, additive change if this challenger wins.
2. **The taxonomy is a lossy keyword classifier.** 21 tags, substring matching. A fault nobody wrote a
   keyword for lands in no bucket and disappears from the ledger entirely; ambiguous phrasing can land in
   the wrong one; a negated sentence ("no early extension here") will match `early_extension`. Impact and
   confidence from the vision stage partly compensate, but the classifier is the weakest link and should
   be evaluated against labelled analyses before this ships.
3. **Absence is treated as improvement.** If a tag was present last session and the current analysis has
   observations but doesn't mention it, `diffTag` returns `improved / not_observed_this_session`. The
   basis string is honest about it, but a camera-angle change can read as progress.
4. **Metric direction is a name heuristic.** Unrecognized metrics are correctly marked `unknown`, but a
   badly named metric can be typed wrongly. `metricDirections` overrides exist precisely so this becomes a
   config decision rather than a silent one.
5. **Severity is not calibrated across sessions.** It rides on model-produced `confidence`, which is not
   guaranteed stable between analyses or prompt versions. A confidence drift of 0.2 reads as improvement.
   Metric-backed comparisons are the trustworthy ones; severity is the fallback.
6. **Legacy records only get inferred tags.** Swings predating structured `visual_observations` are
   classified from coaching prose at a flat 0.6 severity, flagged `source: "inferred_from_prior_text"`.
   Their trend lines are indicative, not measured.
7. **Structured facts are not free of poisoning risk.** Tags are canonical labels; if the model starts
   saying "your early extension" every session, that is a phrasing problem the prompt must handle
   (`context_rules[1]` addresses it). `includeCueText` is off by default for exactly this reason — turning
   it on reintroduces verbatim prior coach wording, and should stay off on the analysis path.
8. **Chat mining is shallow.** Marker-phrase matching over the last 12 user turns. It will miss goals
   phrased unusually and can capture a fragment out of context. Goals that cannot be tagged are stored as
   a ≤6-word fragment of the *player's* words, never the coach's.

## Integration sketch (not wired up)

```js
const { buildLedger, renderLedgerContext } = require('../memory/coachingLedger');

const swings = await swingRepository.getLastAnalyzedSwings({ userId, limit: 8, client: dynamoClient });
const ledger = buildLedger({ swings, swingProfile, chatTurns: recentTurns });

messages.push({
  role: 'system',
  content: `Coaching ledger (structured facts, never quote): ${renderLedgerContext(ledger, { maxEntries: 6 })}`,
});
```

On the analysis path the same call is safe with defaults (`includeCueText: false`), because nothing in the
payload is prior coaching prose.

## Exports

| Export | Signature |
| --- | --- |
| `buildLedger` | `({ swings, swingProfile?, chatTurns?, maxSessions?=12, metricDirections?={} }) -> Ledger` |
| `renderLedgerContext` | `(ledger, { maxEntries?=6, maxTokens?=1200, includeCueText?=false, pretty?=false }) -> string` (JSON) |
| `buildLedgerContext` | `({ swings, swingProfile?, chatTurns?, metricDirections? }, renderOptions?) -> string` |
| `diffSwings` | `({ previous, current, metricDirections? }) -> { previous, current, tags[], metrics[] }` |
| `diffTag` | `(tag, previousSummary, currentSummary, { metricDirections? }) -> { tag, status, basis, from, to }` |
| `diffMetrics` | `(previousMetrics, currentMetrics, { metricDirections? }) -> [{ metric, from, to, delta, direction, status }]` |
| `metricDirection` | `(metricName, overrides?) -> 'lower_is_better' \| 'higher_is_better' \| 'unknown'` |
| `estimateTokens` | `(stringOrObject) -> number` |
| `LEDGER_VERSION`, `FAULT_TAGS`, `MISS_TAGS`, `DEFAULT_MAX_TOKENS` | constants |
| `__private` | `{ summarizeSwing, classifyText, classifyObservationTags, severityFromObservation, orderSwingsChronologically, extractStatedFacts, buildPatterns, buildHeldStreak, selectEntries }` |
