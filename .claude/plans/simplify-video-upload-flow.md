# Simplify Video Upload Flow

**Overall Progress:** `100%`

## TLDR
Strip the video upload flow back to the single working path already in ChatScreen. Remove 12 unnecessary files (custom screens, components, services) that created a broken parallel upload system. The result: user taps attachment → native gallery picker → reject if >5s → upload.

## Critical Decisions
- **No in-app recording:** Users record with their normal camera app, no 5s cap on recording. They trim in Photos if needed before uploading.
- **No in-app trimmer:** Hard reject videos >5s with a message explaining how to trim in Photos. No custom trim UI.
- **Single upload path:** Everything flows through ChatScreen. No separate upload screen.
- **Gallery picker launches directly:** No intermediate Alert menu since there's only one option now (no Camera choice).

## Tasks:

- [x] 🟩 **Step 1: Modify ChatScreen.js**
  - [x] 🟩 Replace `handleAttachmentPress` — remove Alert, call `selectFromLibrary` directly
  - [x] 🟩 Remove `recordedVideo` route param handling

- [x] 🟩 **Step 2: Modify AppNavigator.js**
  - [x] 🟩 Remove `VideoRecordScreen` import and `VideoRecord` route
  - [x] 🟩 Remove `CameraScreen` import and `Camera` route

- [x] 🟩 **Step 3: Delete dead files**
  - [x] 🟩 `src/screens/VideoRecordScreen.js`
  - [x] 🟩 `src/screens/CameraScreen.js`
  - [x] 🟩 `src/screens/ChatScreen.backup.js`
  - [x] 🟩 `src/components/VideoTrimmer.js`
  - [x] 🟩 `src/components/UploadOptionsModal.js`
  - [x] 🟩 `src/components/CoachingDashboard.js`
  - [x] 🟩 `src/components/CoachingDashboardSkeleton.js`
  - [x] 🟩 `src/components/WelcomeFlow.js`
  - [x] 🟩 `src/components/CoachingStatusCard.js`
  - [x] 🟩 `src/components/RecentAnalysisCard.js`
  - [x] 🟩 `src/components/ContinueCoachingButton.js`
  - [x] 🟩 `src/services/enhancedVideoService.js`

- [x] 🟩 **Step 4: Clean up packages**
  - [x] 🟩 `@react-native-community/slider` — kept (still used by CoachingPreferences.js)
  - [x] 🟩 `expo-camera` — removed (no remaining imports)

- [x] 🟩 **Step 5: Update issue tracker**
  - [x] 🟩 Update `.claude/issues/simplify-video-upload-flow/summary.md` with final scope
