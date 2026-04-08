# Acceptance Validation Checklist

## Functional Scenarios
- Run /api/chat with CHAT_LOOP_ENABLED=false; confirm legacy responses still return 200 with fallback messaging when OpenAI errors.
- Enable CHAT_LOOP_ENABLED=true, seed two analyzed swings, and ask "Was I OTT last swing?" — verify numeric/path feedback with no batching references.
- Upload a new swing through the pipeline; confirm the final analysis mentions improvements/regressions based on prior swings.
- Verify swing profile is created/updated in `golf-coach-swing-profiles` table after AI analysis completes.
- Test `get_user_swing_profile` tool returns profile data when called from chat loop.

## Performance & Observability
- Review Lambda logs to confirm only one GSI query per analysis (user-timestamp-index) and note the developer context JSON block.
- Confirm chat loop latency remains near ~1 s in CloudWatch metrics and video finalize duration is unchanged.

## Safety & Feature Flags
- Ensure all changes are behind CHAT_LOOP_ENABLED; disable the flag and re-run a chat to confirm the old path still works.
- Validate no secrets or user identifiers are logged beyond safe metadata; adjust log level if necessary.

## Frontend Validation
- Run `npx expo start -c` and verify no bundler syntax errors.
- SignInScreen: Background video loops correctly, Google OAuth and guest mode work.
- ChatScreen: Messages render, video upload options modal opens, chat history persists.
- Settings: Notification toggle works, sign-out clears auth state.

## Test Suite
- Execute `npm run test:aws` (runs `node --test AWS/test/*.test.js`, all 6 AWS Lambda unit test files) and confirm all pass. CI runs the same script in the `aws-lambda-tests` job.
- Execute `npm test -- --runInBand` for the Jest frontend regression suite. CI runs the same in the `frontend-regression` job.
- If any test fails, address the regression before release.
