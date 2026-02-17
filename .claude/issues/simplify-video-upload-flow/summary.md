# Simplify Video Upload Flow

**Type:** improvement
**Priority:** high
**Effort:** medium
**Status:** completed

## TL;DR

Stripped the video upload back to a single path through ChatScreen. Removed 12 dead files and 1 unused package. Users now tap attachment → native gallery picker → reject if >5s → upload.

## What Changed

- **ChatScreen.js** — attachment button now launches gallery picker directly (no Alert menu)
- **AppNavigator.js** — removed VideoRecord and Camera routes
- **Removed `expo-camera` package** — no longer needed

## Files Removed (12)

- `src/screens/VideoRecordScreen.js` — redundant upload screen
- `src/screens/CameraScreen.js` — in-app recording (users record with normal camera)
- `src/screens/ChatScreen.backup.js` — dead backup
- `src/components/VideoTrimmer.js` — custom trimmer (replaced by hard reject >5s)
- `src/components/UploadOptionsModal.js` — dead code
- `src/components/CoachingDashboard.js` — outdated dashboard
- `src/components/CoachingDashboardSkeleton.js` — skeleton for above
- `src/components/WelcomeFlow.js` — outdated onboarding
- `src/components/CoachingStatusCard.js` — only used by CoachingDashboard
- `src/components/RecentAnalysisCard.js` — only used by CoachingDashboard
- `src/components/ContinueCoachingButton.js` — only used by CoachingDashboard
- `src/services/enhancedVideoService.js` — dead duplicate service

## What Stayed

- `videoService.js` — active upload service with backend trim param support
- ChatScreen's gallery picker, duration validation (Audio.Sound API), 5s hard reject, thumbnail generation, upload flow
