# [BUG] Chat message sends but user does not receive assistant response

**Type:** Bug | **Priority:** High | **Effort:** Medium

---

## TL;DR
User can submit chat messages, but does not reliably receive a coach response in the UI. No explicit auth error is shown.

## Current vs Expected

| | Behavior |
|---|---|
| **Current** | User sends chat message; request appears to run but no assistant response is shown back in chat. |
| **Expected** | Every successful chat request should append assistant response (or deterministic visible error) within expected latency window. |

## Scope for Investigation
- Validate whether backend is returning an empty response, delayed response, or error payload that the client does not surface.
- Confirm if this issue is tied to auth/session state desync or independent chat-loop runtime behavior.
- Verify client-side timeout/abort handling and UI append logic in all non-200 and partial-success paths.

## Likely Files
- `src/screens/ChatScreen.js` - request lifecycle + message append behavior.
- `src/services/chatApiService.js` - HTTP handling, timeout, payload parsing, auth error mapping.
- `AWS/src/api-handlers/chat-api-handler.js` - runtime response generation and fallback path behavior.
- `AWS/src/chat/chatLoop.js` - tool loop limits and final response extraction.

## Verify during fix
- Sending text yields visible assistant response in chat for authenticated users.
- Non-success responses surface deterministic user-visible errors (not silent failures).
- Logs include request/response correlation fields to trace missing-reply cases quickly.

## Notes
- Keep this tracked separately from auth-session-desync/video-upload issue, but cross-check for shared root cause.
