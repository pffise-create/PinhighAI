# ChatScreen Full Revamp

**Type:** Feature / Improvement
**Priority:** High
**Effort:** XL (multi-session)
**Created:** 2026-02-07

---

## TL;DR

Complete revamp of the ChatScreen — the app's primary interface. Upgrade UI to S-tier design standards (per `design-principles-example.md`), fix video upload/trimming to enforce 5s max with proper client-side trim, fully integrate with the AWS backend (including the unused `/api/chat/followup` endpoint), add fun progress messaging, video thumbnails in chat, settings access, and navigator/welcome screen integration. Include a validation & test strategy from day one.

---

## Current State

### What works (partially)
- Basic text chat via `POST /api/chat` with fallback responses
- Video upload pipeline: presigned URL -> S3 -> analyze -> poll results
- Inverted FlatList with scroll-to-bottom (correctly implemented)
- Chat history persistence via AsyncStorage (`chatHistoryManager.js`)
- Video thumbnail generation on selection (pre-send preview)
- Settings navigation (gear icon -> SettingsModal)
- Cognito auth via Google OAuth + guest mode

### What's broken or missing
1. **UI is mediocre** — doesn't follow design-principles-example.md (no skeleton loaders, no micro-interactions, insufficient white space, inconsistent card elevation, no purposeful animations)
2. **Video trimming is unreliable** — uses `expo-image-picker` with `allowsEditing: true`, which on iOS 14+ shows trim UI but **does NOT apply the trim** (known PHPickerViewController limitation). Need `react-native-image-crop-picker` instead.
3. **No 5-second max enforcement on client** — `videoMaxDuration` is set but not reliably enforced post-selection
4. **Follow-up chat endpoint unused** — Backend has `POST /api/chat/followup` for continuing OpenAI Assistant threads, but the app only calls `/api/chat` (new conversation every time). This means no conversation continuity on the server.
5. **`golf-coach-chat-sessions` DynamoDB table is empty** — Backend created this table but nothing writes to it. Chat session metadata isn't being tracked.
6. **Video thumbnails don't appear in sent messages** — Thumbnail is generated but the video message in the chat shows the thumbnail unreliably
7. **Progress messages are functional but not fun** — Current messages rotate but lack personality and stage-aware feedback from the actual pipeline status
8. **No welcome/onboarding state** — First-time users land on a bare chat screen with no guidance
9. **No loading skeletons** — Screen shows nothing while hydrating chat history

---

## Desired Outcome

### 1. S-Tier UI Overhaul
Per `design-principles-example.md`:
- **Strategic white space** and clear visual hierarchy
- **Skeleton loaders** while chat history hydrates
- **Micro-interactions** on send, receive, video attach (150-300ms, ease-in-out)
- **Card-based coach messages** with subtle elevation (`shadows.sm`)
- **User messages** with polished bubble styling, proper brandForest background
- **Consistent use of design tokens** from `theme.js` — eliminate all hardcoded values
- **Accessible touch targets** (44px minimum, already partially done)
- **Smooth transitions** for typing indicator, progress banner, video preview attachment
- **Empty state** with onboarding prompt for first-time users

### 2. Video Upload & Trimming (5s max, client-side)
- **Replace `expo-image-picker`** with `react-native-image-crop-picker` for video selection — it uses `UIImagePickerController` which properly applies trims
- **Enforce 5-second maximum** — validate duration after selection, show alert if over limit
- **Client saves the trimmed video** — the trimmed file is what gets uploaded (no server-side trim dependency)
- **Show video thumbnail** in the chat bubble after sending (reliably)
- **Display duration badge** on video thumbnail (e.g., "3.2s")
- **Remove `trimData` server-side trim params** from `videoService.triggerAnalysis()` since trimming is now client-side

### 3. Fun, Stage-Aware Progress Messaging
- Map progress messages to **actual pipeline stages** returned by `waitForAnalysisComplete()`:
  - `EXTRACTING_FRAMES` -> golf-themed frame extraction messages
  - `PROCESSING` -> position analysis messages
  - `UPLOADING_FRAMES` -> frame upload messages
  - `READY_FOR_AI` / `ANALYZING` -> AI analysis messages
- **Animated progress indicator** (not just a spinner — consider a golf-themed progress bar or animated dots)
- **Rotate fun phrases within each stage** rather than across all stages

### 4. Full AWS Backend Integration
**Critical — must get this right.**

#### Chat Endpoints
| Endpoint | Current Usage | Required Usage |
|----------|--------------|----------------|
| `POST /api/chat` | Used for every message | Use for **first message only** (creates OpenAI thread) |
| `POST /api/chat/followup` | **Not used at all** | Use for **all subsequent messages** (continues thread) |

- `chatApiService.js` needs a `sendFollowUp()` method hitting `/api/chat/followup`
- Track thread state: after first `/api/chat` response, switch to `/api/chat/followup` for the session
- The backend stores thread IDs in `golf-user-threads` DynamoDB table (keyed by `user_id`) — so thread continuity should work across app restarts if the user is authenticated

#### Video Pipeline
| Step | Endpoint/Service | Status |
|------|-----------------|--------|
| Get presigned URL | `POST /api/video/presigned-url` | Working |
| Upload to S3 | Direct PUT to presigned URL | Working |
| Trigger analysis | `POST /api/video/analyze` | Working |
| Poll results | `GET /api/video/results/{jobId}` | Working |
| SQS frame extraction | `golf-coach-frame-extraction-queue-prod` | Working |
| SQS AI analysis | `golf-coach-ai-analysis-queue-prod` | Working |
| Results in DynamoDB | `golf-coach-analyses` table | Working |

- Video pipeline is functional but **progress messages should reflect actual SQS stage** from the polling response
- After AI analysis completes, the result is also injected into `golf-user-threads` — meaning the assistant can reference past swing analyses in chat

#### Auth
- Cognito user pool: `golf-coach-users` (`us-east-1_s9LDheoFF`)
- App client: `golf-coach-mobile-app` (`2ngu9n6gdcbab01r89qbjh88ns`)
- Auth headers must be passed to all API calls (already done via `getAuthHeaders()`)
- Guest users get limited access (fallback responses only)

### 5. Navigator & Welcome Screen Integration
- **SignInScreen -> ChatScreen** transition is already wired (`navigation.replace('Chat')`)
- Add a **welcome/onboarding state** in ChatScreen for first-time users (show tips, explain video upload, etc.)
- Ensure **deep link handling** from auth callback (`golfcoach://`) still works
- Settings modal navigation is already in place

### 6. Settings Access
- Settings gear icon already exists in header
- Ensure it remains accessible and properly styled in the new design

---

## Files to Touch

| File | Changes |
|------|---------|
| `src/screens/ChatScreen.js` | Complete UI overhaul, backend integration, video trimming, progress messaging, welcome state |
| `src/services/chatApiService.js` | Add `sendFollowUp()` method for `/api/chat/followup`, thread state tracking |
| `src/services/videoService.js` | Remove server-side trim params, update progress stage mapping |
| `src/utils/theme.js` | May need new tokens for chat-specific styles (message bubbles, progress bars) |
| `src/navigation/AppNavigator.js` | Potential updates for welcome flow routing |
| `package.json` | Add `react-native-image-crop-picker` dependency, remove `expo-image-picker` if fully replaced |

---

## Validations & Test Strategy

### Unit Tests
- [ ] `chatApiService.sendMessage()` — correct payload, auth header forwarding, error handling
- [ ] `chatApiService.sendFollowUp()` — hits `/api/chat/followup`, passes thread context
- [ ] `chatApiService.getFallbackResponse()` — returns appropriate fallback text
- [ ] `videoService.generateFileName()` — correct format with userId
- [ ] `videoService.uploadAndAnalyze()` — full pipeline mock (presigned URL -> upload -> trigger)
- [ ] `videoService.waitForAnalysisComplete()` — polling logic, timeout, status mapping
- [ ] Video duration validation — rejects videos > 5s, accepts <= 5s
- [ ] Message normalization — `normalizeStoredMessages()` handles all edge cases
- [ ] Message merging — `mergeMessageLists()` deduplicates correctly

### Integration Tests
- [ ] Full chat flow: send message -> receive response -> send follow-up -> receive response
- [ ] Video upload flow: select video -> trim -> generate thumbnail -> upload -> poll -> receive analysis
- [ ] Auth flow: sign in -> get tokens -> chat with auth headers -> handle 401 gracefully
- [ ] Guest flow: skip sign-in -> chat with limited access -> get fallback responses
- [ ] Chat history: send messages -> kill app -> reopen -> history loads correctly

### UI/Component Tests
- [ ] ChatScreen renders without crash on empty state
- [ ] ChatScreen renders with pre-loaded messages
- [ ] Typing indicator appears/disappears correctly
- [ ] Progress banner shows during send/video processing
- [ ] Video thumbnail appears in chat bubble after send
- [ ] Scroll-to-bottom button appears when scrolled away, works on tap
- [ ] Settings button navigates to SettingsModal
- [ ] Input field handles multiline, placeholder states correctly
- [ ] Send button disabled state when empty, enabled when text/video present
- [ ] Video attachment preview shows with remove button

### Accessibility Tests
- [ ] All touch targets >= 44px
- [ ] All interactive elements have `accessibilityLabel` and `accessibilityRole`
- [ ] Color contrast meets WCAG AA (4.5:1 for text, 3:1 for large text)
- [ ] Screen reader can navigate full chat flow
- [ ] Keyboard avoidance works on iOS and Android

### E2E Tests (Playwright/Detox)
- [ ] Sign in -> land on chat -> send message -> receive response
- [ ] Upload video -> see thumbnail -> see analysis response
- [ ] Scroll through long conversation -> scroll-to-bottom works
- [ ] Open settings -> change setting -> return to chat

---

## Pre-Work: Archive Current ChatScreen

Before any changes, archive the current working files so we can revert cleanly if the revamp goes sideways.

### Archive Steps
1. Create `src/screens/_archive/` directory
2. Copy current files into it:
   - `src/screens/ChatScreen.js` -> `src/screens/_archive/ChatScreen.pre-revamp.js`
   - `src/services/chatApiService.js` -> `src/screens/_archive/chatApiService.pre-revamp.js`
   - `src/services/videoService.js` -> `src/screens/_archive/videoService.pre-revamp.js`
3. Add `src/screens/_archive/REVERT_INSTRUCTIONS.md` explaining how to swap back:
   - Copy archived files back to their original paths
   - Revert `package.json` changes (`react-native-image-crop-picker` -> `expo-image-picker`)
   - Run `npm install` to restore original dependencies
4. Git commit the archive as a standalone commit **before** starting the revamp — gives a clean revert point via `git revert` as well

### Revert Strategy (two options)
- **Quick:** Copy files from `src/screens/_archive/` back to original paths
- **Clean:** `git revert` the revamp commits back to the pre-revamp archive commit

---

## Risks & Notes

1. **`react-native-image-crop-picker` requires native module linking** — will need `npx pod-install` on iOS and potentially Expo config plugin if using managed workflow. Verify Expo compatibility.
2. **Thread continuity across sessions** — if the user's OpenAI thread is stored server-side in `golf-user-threads`, the app doesn't need to track it locally. But need to confirm the `/api/chat/followup` endpoint reads from that table.
3. **`golf-coach-chat-sessions` table is empty** — either the backend never implemented writes to it, or it's a planned feature. Don't rely on it yet; use `golf-user-threads` for thread tracking.
4. **Video pipeline timing** — full analysis can take 30-60+ seconds (frame extraction + AI). Progress UX must handle this gracefully without the user thinking the app is frozen.
5. **expo-image-picker trim limitation** — per project memory: iOS 14+ `PHPickerViewController` shows trim UI but doesn't apply it. This is the primary driver for switching to `react-native-image-crop-picker`.
6. **Guest users can't upload videos** — `videoService.uploadAndAnalyze()` throws `AUTHENTICATION_REQUIRED` if no auth headers. Make sure UI communicates this clearly to guests.

---

## AWS Backend Reference

```
API Gateway:  https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod
Cognito Pool: us-east-1_s9LDheoFF
App Client:   2ngu9n6gdcbab01r89qbjh88ns
S3 Bucket:    golf-coach-videos-1753203601
Region:       us-east-1

Endpoints:
  POST /api/chat              -> golf-chat-api-handler (60s timeout)
  POST /api/chat/followup     -> golf-chat-api-handler (60s timeout)
  POST /api/video/presigned-url -> golf-presigned-url-generator (30s timeout)
  POST /api/video/analyze     -> golf-video-upload-handler (30s timeout)
  GET  /api/video/results/{id} -> golf-results-api-handler (15s timeout)

DynamoDB Tables:
  golf-coach-analyses         (analysis_id) - 229 items
  golf-user-threads           (user_id) - thread mapping
  golf-coach-chat-sessions    (session_id) - EMPTY
  golf-coach-users            (user_id) - user profiles

SQS Queues:
  golf-coach-frame-extraction-queue-prod (+ DLQ)
  golf-coach-ai-analysis-queue-prod (+ DLQ)
```
