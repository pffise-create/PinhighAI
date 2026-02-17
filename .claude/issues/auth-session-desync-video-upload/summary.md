# [BUG] App auto-authenticates on launch, but video upload rejects user as unauthenticated

**Type:** Bug | **Priority:** High | **Effort:** Medium

---

## TL;DR
The app restores a "logged-in" UI state on startup, but when the user uploads a video, the request path fails with `AUTHENTICATION_REQUIRED`. Auth state and token availability are out of sync.

## Current vs Expected

| | Behavior |
|---|---|
| **Current** | On launch, user appears logged in and can reach Chat. Uploading a video then shows "Please sign in" / auth required. |
| **Expected** | If app shows authenticated state, video upload should proceed with valid auth headers and backend should accept it. |

## Root Cause Hypothesis (strong, code-backed)

### 1) Cached user fallback can mark authenticated without valid tokens
- In `src/context/AuthContext.js`, `checkAuthState()` falls back to cached `userInfo` and sets:
  - `setUser(userInfo)`
  - `setIsAuthenticated(true)`
- But this fallback does not guarantee `userInfo.tokens.idToken` exists or is valid/refreshable.

### 2) Upload path strictly requires bearer token
- `src/services/videoService.js` rejects upload when:
  - no `userId`
  - or no `authHeaders.Authorization`
- `getAuthHeaders()` in `AuthContext` throws `AUTHENTICATION_REQUIRED` when tokens are missing/invalid.

### 3) UI gate is based on user id presence, not token validity
- `src/screens/ChatScreen.js` currently gates rendering by `if (!userId) return null;`
- This can allow "authenticated-looking" state even when session headers cannot be produced for protected API calls.

## Files to touch
- `src/context/AuthContext.js` - tighten session restoration rules; do not set authenticated=true from cache-only user object without valid token state.
- `src/screens/ChatScreen.js` - gate by a reliable auth-ready signal (not just `userId`), and trigger re-auth flow when headers cannot be produced.
- `src/services/videoService.js` - keep strict auth checks, but improve surfaced error context for debugging/session recovery.

## Verify during fix
- Cold app launch after previously signing in:
  - user remains authenticated
  - `getAuthHeaders()` returns valid bearer token
  - video upload succeeds without auth alert.
- Expired/invalid token launch:
  - app should not silently present logged-in state
  - user is prompted to re-auth before protected actions.
- Chat and video flows should behave consistently (no split between "looks logged in" and "token unavailable").

## Risk / Notes
- Be careful not to regress OAuth happy-path startup latency.
- If token refresh is throttled/cooldown-based, make sure initial protected action still gets a refreshed token or a deterministic re-auth prompt.
- This issue likely affects other protected endpoints beyond video upload, so fix should be centralized in auth/session state.
