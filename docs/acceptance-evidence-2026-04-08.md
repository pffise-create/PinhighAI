# Acceptance Evidence — 2026-04-08

Companion to `docs/acceptance-checklist.md` and `docs/backlog-execution-plan.md`. Captures the evidence collected on branch `claude/backlog-orchestration-plan-bfVtG` for items the agent could verify, and lists items that require a human bug bash on a real device or live AWS.

Agent runs: 2026-04-08T19:57Z (Phase 1 audit) and 2026-04-08T20:00Z (Phase 2 implementation).

---

## Automated evidence (pass/fail captured here)

### Frontend test suite — ✅ PASS
```
$ npm test -- --runInBand
Test Suites: 7 passed, 7 total
Tests:       54 todo, 25 passed, 79 total
Time:        1.93 s
```
Suites covered: `videoService`, `videoAttachmentFlow`, `chatApiService`, `integration/chatFlow`, `screens/ChatScreen`, `components/chat/ComposerBar`, `components/chat/MessageBubble`. (`54 todo` are intentional placeholders, not failures.)

### Web bundle export — ✅ PASS
```
$ npx expo export --platform web --clear
Exported successfully to dist/
```
No Metro/bundler errors. Bundle written to `dist/`. This satisfies the acceptance-checklist line "Run `npx expo start -c` and verify no bundler syntax errors" — `expo export` is a strict superset (it actually compiles, not just starts a dev server).

### AWS Lambda Node test suite — ✅ PASS (21/21)
```
$ npm run test:aws
> node --test AWS/test/*.test.js
# tests 21
# pass 21
# fail 0
# duration_ms 8101.010151
```
Runs all 6 test files in `AWS/test/` (`aiAnalysisProcessor`, `chatLoop`, `coachingSystemPrompt`, `resultsApiHandler`, `swingProfileRepository`, `swingRepository`) via shell glob, so new test files in that directory get picked up automatically. Tests mock `@aws-sdk/lib-dynamodb` and `requestOpenAi`, so they need no AWS credentials and no env vars — CI runs the same `npm run test:aws` script in the `aws-lambda-tests` job (`.github/workflows/ci-regression.yml`).

> **Phase 3 fix:** the original commit hardcoded only 4 of the 6 test files in CI, silently excluding `resultsApiHandler.test.js` and `swingProfileRepository.test.js`. The follow-up commit replaces the hardcoded list with the npm script so this can't recur.

### CloudFormation alarms template — ✅ PARSES
```
$ python3 -c "<CFN-aware loader>" infrastructure/golf-cloudwatch-alarms.yaml
Resources: 15
Outputs:   15
Parameters:15
All 15 alarms present.
```
Template now provisions Errors, Throttles, and Duration p95 alarms for all 5 Lambdas (15 alarms total) with per-Lambda p95 thresholds (chat=3s, results=2s, upload=10s, frame=20s, ai=45s) and an optional SNS topic ARN for notifications. Phase 3 fixes: function-name parameters dropped their defaults so deploys must pass real Lambda names (typo guard), and every alarm description now spells out impact + first investigation step. The notBreaching/dead-Lambda blind spot is documented in `docs/aws-cloudwatch-alarms-deploy-handoff.md` and `infrastructure/README.md`.

**Deploy is still pending** — agent has no AWS credentials. Use the runbook in `docs/aws-cloudwatch-alarms-deploy-handoff.md`.

### CI workflow — ✅ EXTENDED
- Removed dead `work` branch trigger.
- Added `aws-lambda-tests` job alongside `frontend-regression`, running `npm run test:aws` (auto-discovers all `AWS/test/*.test.js` files).
- Added a top-level `concurrency:` block (`ci-regression-${github.ref}`, `cancel-in-progress: true`) so superseded pushes on the same ref get cancelled instead of piling up.
- Both jobs run on `pull_request` and on `push` to `main`.
- Verified locally: `npm run test:aws` exits non-zero on failure; the existing Jest + Expo export jobs are unchanged.

### Playwright smoke — ⚠️ NOT RUN BY AGENT
`tests/smoke.spec.ts` exists and asserts the web app shell loads. It is **not wired into CI** because it requires `expo start --web` as a webServer step (heavy, slow startup). To run locally:
```
npm run test:e2e
```
Recommendation: leave Playwright out of CI for now. The Jest tests + Expo web export already gate the same surface area without the Playwright runtime cost.

---

## Items deferred to human bug bash

These checklist items need real Cognito / real S3 / real Lambda invocations / a real device, and cannot be reasonably mocked without losing the signal that the check is supposed to provide.

### Backend functional scenarios (need live AWS)
- [ ] CHAT_LOOP_ENABLED=false fallback test (`/api/chat` returns 200 with fallback when OpenAI errors)
- [ ] CHAT_LOOP_ENABLED=true with two seeded swings → "Was I OTT last swing?" returns numeric/path feedback
- [ ] Upload a new swing through the pipeline; final analysis references prior swings
- [ ] Swing profile is created/updated in `golf-coach-swing-profiles` after AI analysis completes
- [ ] `get_user_swing_profile` tool returns profile data when called from chat loop

### Performance & observability (need CloudWatch)
- [ ] One GSI query per analysis, developer context JSON block in logs
- [ ] Chat loop p95 ≤ 1s, video finalize duration unchanged

### Safety & feature flags (need Lambda config + log access)
- [ ] All changes behind `CHAT_LOOP_ENABLED`; toggle off and re-run chat to confirm legacy path
- [ ] No secrets / user identifiers in logs beyond safe metadata

### Frontend on a real device (needs simulator or TestFlight/Play Internal)
- [ ] SignInScreen background video loops correctly
- [ ] Google OAuth completes end-to-end against `golf-coach-users` Cognito pool
- [ ] ChatScreen renders, video upload modal opens, chat history persists across cold launches
- [ ] Settings notification toggle works; sign-out clears auth state

### Operational readiness (needs AWS credentials)
- [ ] Run `docs/aws-cloudwatch-alarms-deploy-handoff.md` runbook end-to-end
- [ ] Confirm SNS email subscription for `pffise@gmail.com`
- [ ] After deploy, paste `aws cloudwatch describe-alarms --alarm-name-prefix golf-coach-prod` output below this line:
```
<paste here>
```

---

## Backlog item status as of this evidence run

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Frontend stabilization | ✅ ready | Jest + web export green; ChatScreen audit found no helper-structure issues |
| 2 | Backend processing posture | ✅ done | Direct invoke confirmed in `backlog-execution-plan.md`; no SQS event source mappings |
| 3 | Operational readiness | 🟡 ready to deploy | Template covers 15 alarms; runbook in `aws-cloudwatch-alarms-deploy-handoff.md`; awaiting human deploy |
| 4 | Release safety net | ✅ ready | CI runs Jest + Expo export + AWS unit tests; needs branch protection set in repo settings |
| 5 | Launch validation | 🟡 partial | Automated items captured here; live/device items punted to bug bash above |

## Followups (post-launch, not blocking)
- Wire Playwright into CI behind a separate workflow (with browser deps + webServer startup) once the bug bash surfaces specific regression patterns worth automating.
- Move alarm thresholds into env-specific parameter files instead of CLI overrides if more environments are added.
- Branch protection on `main`: require both CI jobs (`frontend-regression`, `aws-lambda-tests`) before merge.
