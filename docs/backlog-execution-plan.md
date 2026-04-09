# Backlog Execution Plan & Rules of Engagement

_Date: 2026-04-07_

## Rules of Engagement (agreed workflow)
1. **No major feature assumptions without approval.**
   - If implementation needs a product decision (UX, user entitlement, behavior changes, pricing/limits), pause and request your decision before coding.
2. **Production-ready standards only.**
   - No hardcoded environment values, secrets, queue URLs, table names, region IDs, or magic constants that should be config.
   - No throwaway shortcuts that would need immediate rework for production.
3. **Maintainability/performance review required on every change.**
   - Keep diffs scoped and modular.
   - Validate error handling, retries/timeouts for network calls, and avoid unnecessary repeated DB/API work.
4. **Test before recommending push.**
   - Run targeted/unit tests for touched modules.
   - Run broader regression checks when change scope crosses service boundaries.

## Working backlog (from current docs)
1. **Stabilize frontend launch blockers** 🟡 _In Progress_
   - Re-validate/fix ChatScreen helper structure and any bundling regressions.
2. **Finalize backend processing posture** ✅ _Decision made_
   - Decide and implement: full SQS event-source mapping vs documented direct-invoke deferment.
3. **Operational readiness** 🟡 _In Progress_
   - Add CloudWatch alarms and baseline monitoring.
4. **Release safety net** 🟡 _In Progress_
   - Add/enable automated regression tests in CI.
5. **Launch validation** 🟡 _In Progress_
   - Execute and record acceptance checklist evidence.

## Proposed execution order
- **Phase 1 (now):** Frontend stabilization + acceptance checklist evidence capture.
- **Phase 2:** Backend processing decision (SQS activation or explicit deferment doc).
- **Phase 3:** Observability alarms and CI regression wiring.

## Assumption gates (must confirm with you first)
Before implementing any item below, I will ask for explicit confirmation if needed:
- **Resolved (2026-04-07):** launch will keep **direct invocation** for now; SQS activation is deferred and will be revisited later.
- Alerting targets/channels (email/Slack/PagerDuty) and severity thresholds for CloudWatch alarms.
- CI required pass criteria for launch (must-pass suites and blocking policy).

## Ready-to-start item
- **Starting now:** Item 1 frontend stabilization pass (ChatScreen + bundler checks + tests).
- Next deliverable: concrete code PR with test output and any remaining risk callouts.

## Progress log
- ✅ **2026-04-07:** Direct-invoke launch posture confirmed; SQS activation deferred for later revisit.
- ✅ **2026-04-07:** Frontend unit/integration suite passed (`npm test -- --runInBand`).
- ✅ **2026-04-07:** Web bundle/export completed successfully (`npx expo export --platform web --clear`) to validate no bundler syntax breakages.
- ✅ **2026-04-07:** Added GitHub Actions workflow (`.github/workflows/ci-regression.yml`) to run Jest regression + Expo web export on push/PR.
- ✅ **2026-04-08:** Added CloudWatch alarm infrastructure template (`infrastructure/golf-cloudwatch-alarms.yaml`) + deployment instructions.
- ✅ **2026-04-08:** Frontend audit on `claude/backlog-orchestration-plan-bfVtG` confirmed no helper-structure regressions and inverted FlatList perf props apply correctly.
- ✅ **2026-04-08:** Expanded CloudWatch alarm template to full coverage (15 alarms = 5 Lambdas × Errors/Throttles/Duration p95) with per-Lambda p95 parameters; deploy runbook saved to `docs/aws-cloudwatch-alarms-deploy-handoff.md`.
- ✅ **2026-04-08:** Added `aws-lambda-tests` job to `ci-regression.yml` running the four AWS Lambda Node test files; removed dead `work` branch trigger; verified `node --test` exits non-zero on failure.
- ✅ **2026-04-08:** Captured automated acceptance evidence in `docs/acceptance-evidence-2026-04-08.md`; live-AWS / device items routed to bug bash.
- ✅ **2026-04-08 (review pass):** Applied subagent review fixes — CI now runs all 6 AWS test files via `npm run test:aws` (was silently excluding `resultsApiHandler.test.js` and `swingProfileRepository.test.js`); added `concurrency:` cancel-in-progress block; alarm template requires real Lambda names (no defaults) and every alarm description now includes impact + first investigation step; README and handoff doc document the `notBreaching` dead-Lambda blind spot. All 21 AWS tests + 25 Jest tests still green.
