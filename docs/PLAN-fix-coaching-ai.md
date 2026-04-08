# Pin High AI — Coaching Quality Recovery Checklist

## North Star
- [ ] Every change must make interactions more natural and helpful for the player.

## Locked Decisions
- [x] Prioritize depth of coaching over broad casual chat.
- [x] Never return a blank/non-answer due to low visual confidence.
- [x] Duplicate uploads from the same video are acceptable during current testing.
- [x] Enforce cleanup on every PR via `/Users/patrickfise/Documents/ReactNativeProjects/GolfCoachExpoFixed/docs/cleanup-policy.md`, PR template checks, and CI hygiene gates.
- [x] Structured schema is internal for quality/storage, not forced user-facing format.

## Response Experience (Natural-First)
- [x] Implement response modes:
  - [x] `conversational` (default)
  - [x] `technical_breakdown` (on request)
  - [x] `visual_fact_check` (on request or visual-question detection)
- [ ] Add support for user-selectable default mode later (profile setting + runtime override).
- [x] Enforce “answer-first” for follow-ups (direct answer before extra coaching).
- [ ] Keep drills contextual; do not force drill blocks when user asks for simple feedback.

## Workstream A — Visual Grounding
### A1. Structured visual memory
- [x] Add `visual_observations` to `ai_analysis` in `/Users/patrickfise/Documents/ReactNativeProjects/GolfCoachExpoFixed/AWS/src/ai-analysis/ai-analysis-processor.js`.
- [x] Include: phase, observation, evidence, confidence, impact.
- [x] Persist compact top observations to profile in `/Users/patrickfise/Documents/ReactNativeProjects/GolfCoachExpoFixed/AWS/src/data/swingProfileRepository.js`.
- [x] Ensure retrieval support in `/Users/patrickfise/Documents/ReactNativeProjects/GolfCoachExpoFixed/AWS/src/data/swingRepository.js`.
- [x] Normalize `analysis_results` retrieval so chat visual frame re-pull can reliably access stored frames.
- [x] Stop passing prior analysis summaries/heuristic visual observations into chat developer context by default (use chat memory + metrics/profile facts).

### A2. On-demand visual follow-up tool
- [x] Add targeted `answer_visual_question` tool path in `/Users/patrickfise/Documents/ReactNativeProjects/GolfCoachExpoFixed/AWS/src/chat/chatLoop.js`.
- [x] Limit frame count/tokens/cost.
- [ ] Timeout fallback must still return useful “best estimate + uncertainty + next capture tip”.

## Workstream B — Prompt and Output Contract
### B1. Analysis contract (internal)
- [x] Split upload analysis generation into two stages: visual fact extraction (structured) -> coach response rendering.
- [x] Wire attached upload question through frontend -> upload handler -> analysis record -> analysis Lambda prompt.
- [x] Add constrained coach persona/tone support (`wry` allowed, not forced) in the rendering stage.
- [ ] Require internal fields for storage/eval:
  - [ ] `observations`
  - [ ] `root_causes`
  - [ ] `priority_fix`
  - [ ] `drill_plan`
  - [ ] `expected_ball_flight_change`
- [ ] `confidence_notes`
- [x] Ban evidence-free generic filler.
- [x] Keep user-facing output natural unless user asks for structure.

### B2. Chat contract (user-facing)
- [x] Follow response order:
  - [x] direct answer
  - [x] evidence/reference
  - [x] coaching implication
  - [x] optional next rep cue
- [x] Low-confidence hierarchy:
  - [x] best estimate
  - [x] what is uncertain
  - [x] what to capture next time
- [x] Hard rule: only say “cannot answer” when frames are unavailable/corrupt.

## Workstream C — Reliability and Idempotency
- [ ] Harden lock ownership/expiry in `/Users/patrickfise/Documents/ReactNativeProjects/GolfCoachExpoFixed/AWS/src/ai-analysis/ai-analysis-processor.js`.
- [ ] Enforce idempotent final write per `analysis_id`.
- [ ] Add retry classification for transient vs non-retryable failures.
- [ ] Add metrics/log fields:
  - [x] frames sent
  - [x] bytes sent
  - [x] prompt version
  - [x] model
  - [ ] timeout class
  - [x] generic score

## Workstream D — Quality Gates and Evals
### D1. Pre-save quality gate
- [ ] Add similarity check vs recent responses.
- [ ] Add required evidence count gate.
- [ ] Add specificity gate (phase/body-part/ball-flight linkage).
- [x] On failure: one stricter re-prompt before persistence. (Generic-response rewrite pass implemented; broader evidence/similarity gates still pending)
- [ ] Ensure gates do not penalize natural prose if evidence is present.

### D2. Golden dataset + scoring
- [ ] Build fixed swing + follow-up dataset in `/Users/patrickfise/Documents/ReactNativeProjects/GolfCoachExpoFixed/AWS/test/`.
- [ ] Score for:
  - [ ] specificity
  - [ ] correctness
  - [ ] coaching depth
  - [ ] conversational usefulness
  - [ ] naturalness (non-template phrasing)
- [ ] Add direct-answer-first test cases (e.g., “Was that better?”).

## Rollout Checklist
### Phase 0: Instrument + Guardrails
- [x] Add prompt versioning + monitor-only generic gate.
- [x] Deploy Phase 0 Lambda updates to AWS (`golf-ai-analysis-processor`, `golf-chat-api-handler` if touched).
- [x] Record deployment status and verification evidence in `/Users/patrickfise/Documents/ReactNativeProjects/GolfCoachExpoFixed/docs/DEPLOYMENT-TRACKER.md`.

### Phase 1: Visual memory + prompt contracts
- [x] Ship structured visual memory.
- [x] Ship natural-first prompt contracts. (Deployed to AWS; E2E signoff still pending)
- [x] Deploy Phase 1A changes to AWS and capture verification evidence.
- [x] Deploy Phase 1B changes to AWS and capture verification evidence. (Smoke + backend tests complete; E2E validation pending before final signoff)

### Phase 2: Chat visual tool
- [x] Ship targeted visual follow-up tool. (Deployed with persona/tone alignment and repo frame parsing fix; E2E validation/fallback polish still pending)
- [x] Deploy Phase 2 changes to AWS and capture verification evidence. (Smoke + backend tests complete; E2E validation pending before final signoff)

### Phase 3: Reliability hardening
- [ ] Ship lock/idempotency/retry fixes.
- [ ] Deploy Phase 3 changes to AWS and capture verification evidence.

### Phase 4: Eval + release
- [ ] Pass golden dataset thresholds.
- [ ] Pass end-to-end pipeline tests (upload -> analysis -> follow-up chat).
- [ ] Meet latency gates on test dataset:
  - [ ] P95 video analysis latency < 30s
  - [ ] P95 chat (metadata-only path) latency < 5s
  - [ ] P95 chat (frame re-pull path) latency < 30s
- [ ] Deploy behind flags.
- [ ] Canary release + observe metrics.
- [ ] Record final production rollout in deployment tracker with smoke test evidence.

## Feature Flags
- [ ] `COACHING_PROMPT_V2_ENABLED`
- [ ] `VISUAL_MEMORY_V1_ENABLED`
- [ ] `CHAT_VISUAL_TOOL_ENABLED`
- [ ] `GENERIC_GATE_ENFORCE_ENABLED`

## Acceptance Checklist (Release Gate)
- [ ] Responses are natural/helpful by default.
- [ ] Analysis includes at least 3 evidence-backed observations and 1 prioritized fix.
- [ ] Visual follow-up returns direct answer + evidence or uncertainty statement.
- [ ] No blank responses from low-confidence path.
- [ ] Distinct swings do not produce near-identical coaching copy.
- [ ] Chat still works when visual tool is disabled.
- [ ] All shipped changes are marked `DEPLOYED` in `/Users/patrickfise/Documents/ReactNativeProjects/GolfCoachExpoFixed/docs/DEPLOYMENT-TRACKER.md` with Lambda `LastModified` evidence.
- [ ] End-to-end flow works: upload video -> receive coaching -> ask follow-up -> receive answer.
- [ ] Latency SLOs met: video < 30s P95, chat metadata-only < 5s P95, chat frame re-pull < 30s P95.

## E2E and Latency Validation Checklist
- [ ] Add/maintain automated E2E test covering:
  - [ ] video upload submission
  - [ ] frame extraction + AI completion
  - [ ] results fetch returns `coaching_response`
  - [ ] results/profile store `visual_observations`
  - [ ] follow-up chat answered from stored context/metadata
  - [ ] follow-up chat answered when frame re-pull path is required
- [ ] Record timing telemetry for each stage:
  - [ ] upload accepted timestamp
  - [ ] frame extraction completed timestamp
  - [ ] AI analysis started/completed timestamps
  - [ ] chat request started/completed timestamps
  - [ ] flag whether frame re-pull path was used
- [ ] Run E2E validation after any Lambda behavior change before marking deploy `DEPLOYED`.

## Post-Project Hardening (Deferred)
- [ ] Create a dev-only Cognito app client for automated testing (enable password auth flow for CLI/automation; keep prod client unchanged).
- [ ] Build a terminal-driven E2E harness that can authenticate, submit/poll analysis, ask follow-up chat questions, and record latency metrics.
