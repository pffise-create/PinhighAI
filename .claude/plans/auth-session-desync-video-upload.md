# Feature Implementation Plan

**Overall Progress:** `100%`

## TLDR
Migrate auth/session handling to Amplify-managed flows so app auth state only exists when a valid bearer token exists, remove guest pathways, and ensure both chat and video endpoints require authenticated users.

## Critical Decisions
Key architectural/implementation choices made during exploration:
- Decision 1: Use Amplify-managed auth/session APIs as source of truth - reduces custom token lifecycle bugs and aligns with native-app OAuth best practices.
- Decision 2: No guest workflows anywhere - chat and video both require valid auth and should return deterministic auth errors otherwise.
- Decision 3: Invalid session at launch routes directly to SignIn - avoids "looks logged in but unauthorized" UX desync.

## Tasks:

- [x] 🟩 **Step 1: Migrate Sign-In flow to Amplify-managed redirect/session**
  - [x] 🟩 Replace manual OAuth code exchange/token storage in `src/screens/SignInScreen.js` with Amplify redirect sign-in flow.
  - [x] 🟩 Remove manual `AsyncStorage` auth-token writes from sign-in path.
  - [x] 🟩 Confirm callback handling still resolves correctly for Expo deep link scheme (`golfcoach://`).

- [x] 🟩 **Step 2: Refactor AuthContext to enforce token-backed auth only**
  - [x] 🟩 Update `src/context/AuthContext.js` so authenticated state is set only when Amplify session returns valid tokens.
  - [x] 🟩 Remove cache-only authenticated fallback from `userInfo` without token validation.
  - [x] 🟩 Ensure `getAuthHeaders()` always derives bearer token from current Amplify session (with refresh behavior handled by Amplify).
  - [x] 🟩 On session failure/expiry, clear stale local auth state and return `AUTHENTICATION_REQUIRED`.

- [x] 🟩 **Step 3: Enforce no-guest behavior across client routing and UX**
  - [x] 🟩 Ensure app launch routing (`src/navigation/AppNavigator.js`) sends invalid/no-session users to `SignIn` immediately.
  - [x] 🟩 Ensure `src/screens/ChatScreen.js` does not operate in tokenless pseudo-auth state and surfaces re-auth prompt consistently.
  - [x] 🟩 Keep protected service calls (`src/services/videoService.js`, `src/services/chatApiService.js`) strict and consistent on auth failures.

- [x] 🟩 **Step 4: Enforce no-guest behavior in backend chat endpoint**
  - [x] 🟩 Update `AWS/src/api-handlers/chat-api-handler.js` to reject missing/invalid auth tokens (401/403) instead of guest fallback.
  - [x] 🟩 Keep `AWS/src/api-handlers/video-upload-handler.js` strict behavior aligned with chat handler behavior.
  - [x] 🟩 Sync deploy mirrors (`AWS/production/`, `AWS/lambda-deployment/`) with the same backend auth logic.

- [x] 🟩 **Step 5: Validation and regression checks**
  - [x] 🟩 Verify fresh launch with valid session: chat + video both work with bearer auth.
  - [x] 🟩 Verify expired/invalid session: app routes to SignIn and protected requests fail deterministically until re-auth.
  - [x] 🟩 Verify no guest access remains for chat or video.
  - [x] 🟩 Run/refresh relevant tests for auth, chat send, and video upload gating.
