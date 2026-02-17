# Feature Implementation Plan

**Overall Progress:** `0%`

## TLDR
Migrate auth/session handling to Amplify-managed flows so app auth state only exists when a valid bearer token exists, remove guest pathways, and ensure both chat and video endpoints require authenticated users.

## Critical Decisions
Key architectural/implementation choices made during exploration:
- Decision 1: Use Amplify-managed auth/session APIs as source of truth - reduces custom token lifecycle bugs and aligns with native-app OAuth best practices.
- Decision 2: No guest workflows anywhere - chat and video both require valid auth and should return deterministic auth errors otherwise.
- Decision 3: Invalid session at launch routes directly to SignIn - avoids "looks logged in but unauthorized" UX desync.

## Tasks:

- [ ] 🟥 **Step 1: Migrate Sign-In flow to Amplify-managed redirect/session**
  - [ ] 🟥 Replace manual OAuth code exchange/token storage in `src/screens/SignInScreen.js` with Amplify redirect sign-in flow.
  - [ ] 🟥 Remove manual `AsyncStorage` auth-token writes from sign-in path.
  - [ ] 🟥 Confirm callback handling still resolves correctly for Expo deep link scheme (`golfcoach://`).

- [ ] 🟥 **Step 2: Refactor AuthContext to enforce token-backed auth only**
  - [ ] 🟥 Update `src/context/AuthContext.js` so authenticated state is set only when Amplify session returns valid tokens.
  - [ ] 🟥 Remove cache-only authenticated fallback from `userInfo` without token validation.
  - [ ] 🟥 Ensure `getAuthHeaders()` always derives bearer token from current Amplify session (with refresh behavior handled by Amplify).
  - [ ] 🟥 On session failure/expiry, clear stale local auth state and return `AUTHENTICATION_REQUIRED`.

- [ ] 🟥 **Step 3: Enforce no-guest behavior across client routing and UX**
  - [ ] 🟥 Ensure app launch routing (`src/navigation/AppNavigator.js`) sends invalid/no-session users to `SignIn` immediately.
  - [ ] 🟥 Ensure `src/screens/ChatScreen.js` does not operate in tokenless pseudo-auth state and surfaces re-auth prompt consistently.
  - [ ] 🟥 Keep protected service calls (`src/services/videoService.js`, `src/services/chatApiService.js`) strict and consistent on auth failures.

- [ ] 🟥 **Step 4: Enforce no-guest behavior in backend chat endpoint**
  - [ ] 🟥 Update `AWS/src/api-handlers/chat-api-handler.js` to reject missing/invalid auth tokens (401/403) instead of guest fallback.
  - [ ] 🟥 Keep `AWS/src/api-handlers/video-upload-handler.js` strict behavior aligned with chat handler behavior.
  - [ ] 🟥 Sync deploy mirrors (`AWS/production/`, `AWS/lambda-deployment/`) with the same backend auth logic.

- [ ] 🟥 **Step 5: Validation and regression checks**
  - [ ] 🟥 Verify fresh launch with valid session: chat + video both work with bearer auth.
  - [ ] 🟥 Verify expired/invalid session: app routes to SignIn and protected requests fail deterministically until re-auth.
  - [ ] 🟥 Verify no guest access remains for chat or video.
  - [ ] 🟥 Run/refresh relevant tests for auth, chat send, and video upload gating.
