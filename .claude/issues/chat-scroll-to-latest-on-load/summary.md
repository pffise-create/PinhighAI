# [BUG] Chat screen does not scroll to most recent messages on open

**Type:** Bug | **Priority:** High | **Effort:** Small

---

## TL;DR
When ChatScreen mounts and hydrates saved history from AsyncStorage, the FlatList stays at the top of the conversation instead of scrolling to the most recent messages.

## Current vs Expected

| | Behavior |
|---|---|
| **Current** | Screen opens at the top (oldest messages visible) |
| **Expected** | Screen opens scrolled to the bottom (newest messages visible) |

## Root Cause (confirmed in code)

Two issues in `src/screens/ChatScreen.js`:

1. **Race condition on initial scroll** ([ChatScreen.js:213-242](src/screens/ChatScreen.js#L213-L242)) — `useLayoutEffect` calls `scrollToEnd()` when `messages` updates after hydration, but the FlatList hasn't finished laying out the new items yet, so the call is a no-op.

2. **No FlatList scroll hints** ([ChatScreen.js:634-646](src/screens/ChatScreen.js#L634-L646)) — The FlatList has no `initialNumToRender` or `initialScrollIndex` prop, so React Native has no signal to start rendering from the bottom.

The hydration itself is fine — `ChatHistoryManager.loadConversation()` returns messages sorted oldest-first, and `normalizeStoredMessages` preserves that order ([ChatScreen.js:115-130](src/screens/ChatScreen.js#L115-L130)). The data is correct; it's the scroll that doesn't fire.

## Files to touch
- `src/screens/ChatScreen.js` — FlatList props + initial scroll logic

## Verify during fix
- Does live mid-session scroll (new message arrives) also fail, or is it only the hydration scroll? The `useLayoutEffect` path is shared, so check both.

## Risk / Notes
- `scrollToEnd` on FlatList can be unreliable before layout is measured — consider `onLayout` or `ListHeaderComponent` height-based approaches as alternatives
- Don't break the existing "scroll to bottom" button (`showScrollToBottom` state) — that path works correctly today