# Chat Scroll-to-Latest Fix

**Overall Progress:** `100%` ✅

## TLDR
Fix ChatScreen so it shows the most recent messages on open. The original approach (`scrollToEnd` gated by `onLayout`) failed because `onLayout` fires when the FlatList *container* sizes itself — before content renders. Switched to the standard React Native chat pattern: **inverted FlatList**. This eliminates the scroll race condition entirely.

## Critical Decisions
- **Inverted FlatList** — The standard pattern for chat UIs in React Native. The list renders newest messages at the visual bottom (offset 0) natively. No `scrollToEnd` needed at all, eliminating the race condition.
- **No animation on initial view** — List starts at newest messages with no scroll animation, matching standard messaging apps.
- **Simplified mid-session scroll** — `useLayoutEffect` reduced to a single check: if a new message arrives and user is near bottom, nudge to offset 0.
- **Removed dead code** — `hasHydratedRef`, `initialScrollHandled`, `layoutReadyRef`, `pendingScrollRef`, `handleContentSizeChange` all removed.

## What Changed (v2 — inverted FlatList approach)

- [x] 🟩 **Inverted FlatList + reversed data**
  - [x] 🟩 Added `invertedMessages` memo that reverses the chronologically-sorted messages
  - [x] 🟩 Added `inverted` prop to FlatList, swapped `data` to `invertedMessages`
  - [x] 🟩 Swapped `ListFooterComponent` → `ListHeaderComponent` (inverted list flips header/footer)

- [x] 🟩 **Updated scroll logic for inverted coordinates**
  - [x] 🟩 `scrollToBottom` uses `scrollToOffset({ offset: 0 })` instead of `scrollToEnd`
  - [x] 🟩 `handleScroll` checks `contentOffset.y <= SCROLL_THRESHOLD` for near-bottom detection
  - [x] 🟩 `useLayoutEffect` simplified to only nudge offset 0 on new mid-session messages

- [x] 🟩 **Removed all scroll-on-mount workarounds**
  - [x] 🟩 Removed `initialScrollHandled`, `layoutReadyRef`, `pendingScrollRef` refs
  - [x] 🟩 Removed `handleContentSizeChange` handler
  - [x] 🟩 Removed `hasHydratedRef` (dead code)
  - [x] 🟩 Removed userId reset effect (no longer needed)

## Why the v1 approach failed
`onLayout` fires when the FlatList container gets sized by flexbox — immediately on mount, before AsyncStorage returns messages. `onContentSizeChange` fires on *any* content size change, including the initial empty footer spacer. Both events fire too early. The inverted FlatList avoids the problem entirely by not needing to scroll at all.