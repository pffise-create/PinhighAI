# Context Prompts for the Coding Agent

## 1. Grounding and Surgical Mindset
- Read docs/current-arch.md and the goal brief before touching code; confirm understanding with a short, written plan.
- Inspect existing Lambdas and utilities before adding anything new; prefer extending current modules over creating siblings.
- Keep diffs minimal and logically grouped; annotate non-obvious logic with concise comments only when necessary.

## 2. Tooling Gap Check (Step 2)
- Inventory helper functions that already exist for swing retrieval, summaries, and user context; reuse them when available.
- Only implement missing helpers (get_last_swing, get_swing_analysis, compare_swings, get_user_swing_profile, optional journal appender) after confirming there is no equivalent in the repo.
- Co-locate new helpers with current data-access code, respect existing naming and error-handling patterns, and add lightweight unit tests for each new function.

## 3. Chat Loop Orchestrator (Step 3)
- Introduce or extend a chat handler behind a CHAT_LOOP_ENABLED feature flag without disrupting the current /api/chat contract.
- Persist user and assistant turns, hydrate the model call with the last 6 turn pairs plus 1-2 latest swing summaries, and surface the swing profile snapshot when available.
- Wire tool calls so the model can fetch swing data on demand; handle tool failures gracefully and return a supportive fallback message.

## 4. Video Finalization Context Injection (Step 4)
- Augment the swing finalization flow to pull the three most recent analyzed swings and the player profile before prompting the model.
- Inject a developer_context JSON blob that highlights improvements/regressions; ensure the existing pipeline shape is untouched aside from the additional context payload.
- Preserve latency by keeping queries efficient and avoiding redundant OpenAI calls.

## 5. System Prompt Alignment (Step 5)
- Centralize the golf-coach persona prompt so both chat and analysis share one authoritative definition.
- Use supportive, concise language that tracks progress without referencing frames or batches; include the brief diagnostic question behavior described in the goal document.

## 6. Quality Bar (Step 6)
- Add unit tests covering new helper logic, including happy path and failure cases (e.g., missing swing data).
- Create a smoke test (manual or automated) that simulates two analyzed swings and verifies responses for "Was I OTT?" and "Compare my last two swings." Document manual steps if automation is deferred.
- Perform a manual regression of the video finalize path to confirm no performance or behavioral regressions.

## 7. Acceptance Validation (Step 7)
- Confirm no duplicate data structures were introduced; reuse Dynamo fields and existing analysis outputs.
- Validate that OTT questions return numeric/path feedback without mentioning batching, and that new analyses note improvements/regressions.
- Check latency targets (chat <= 1 s typical, analysis unchanged) and ensure all new code is documented and gated appropriately.
- Capture remaining risks or trade-offs in the PR/notes so stakeholders know what to monitor next.
