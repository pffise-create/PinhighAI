# Directory Cleanup Plan

**Overall Progress:** `100%`

## TLDR
Clean up cluttered project directory by removing unused code, duplicate folders, test artifacts, and old deployment files. Update `.gitignore` to prevent future clutter.

## Critical Decisions
- **No backups**: Delete permanently (git history preserves everything if needed)
- **Expo/ folder**: Confirmed unused - imports are from `./src/` not `./Expo/src/`
- **AWS/archive/**: All old Lambda versions, not deployed - safe to delete
- **Orphaned screens**: Intentionally removed from navigation - delete them

## Tasks

- [x] 🟩 **Step 1: Remove Duplicate/Unused Source Code**
  - [x] 🟩 Delete `Expo/` directory (full duplicate of src/)
  - [x] 🟩 Delete orphaned screens from `src/screens/`:
    - `HomeScreen.js`
    - `ProfileScreen.js`
    - `VideosScreen.js`
    - `CoachingSummaryScreen.js`
    - `CinematicWelcomeScreen.js`
  - [x] 🟩 Delete orphaned top-level files:
    - `SimpleVideoRecorder.js`
    - `EnhancedVideoUpload.js`
    - `ChatScreen_part.js`

- [x] 🟩 **Step 2: Clean AWS Directory**
  - [x] 🟩 Delete `AWS/archive/` directory entirely
  - [x] 🟩 Delete all `.zip` files in `AWS/lambda-deployment/`
  - [x] 🟩 Delete `AWS/lambda-deployment/node_modules/`
  - [x] 🟩 Delete `.zip` file in `AWS/production/` (keep `.js` and `.py` only)

- [x] 🟩 **Step 3: Remove Test/Temp Artifacts**
  - [x] 🟩 Delete `testing/` directory
  - [x] 🟩 Delete `test/` directory
  - [x] 🟩 Delete all `test-*.json` files from root
  - [x] 🟩 Delete all `*-response.json`, `*-payload.json` files from root
  - [x] 🟩 Delete temp files: `temp.txt`, `temp_patch.diff`, `debug_layer.*`
  - [x] 🟩 Delete log files: `*.txt` logs, `ai-log.jsonl`, `frame-log.jsonl`

- [x] 🟩 **Step 4: Remove Build/Cache Directories**
  - [x] 🟩 Delete `.expo/` (build cache - regenerated automatically)
  - [x] 🟩 Delete `.tmp.driveupload/` (Google Drive temp files)
  - [x] 🟩 Delete `deployed-code/`, `deploy_artifacts/`
  - [x] 🟩 Delete `frame_extractor_deployment/` (superseded by AWS/src/)

- [x] 🟩 **Step 5: Remove Miscellaneous Clutter**
  - [x] 🟩 Delete `sprints/` directory (old sprint planning docs)
  - [x] 🟩 Delete `code/`, `background files/` (empty/unused)
  - [ ] 🟨 Delete `stock videos/` - skipped (device busy)
  - [x] 🟩 Delete `UI redesign/` (design mockups)
  - [x] 🟩 Delete `testingarchive/`
  - [x] 🟩 Delete stray root files: `checkDelims.js`, `update-script.js`, `update-video-limits.js`

- [x] 🟩 **Step 6: Update .gitignore**
  - [x] 🟩 Add patterns for test artifacts (`test-*.json`, `*-response.json`)
  - [x] 🟩 Add patterns for temp files (`temp*.txt`, `*.log`, `debug_*`)
  - [x] 🟩 Add patterns for build caches (`.expo/`, `deploy_artifacts/`)
  - [x] 🟩 Add patterns for IDE/OS files (`desktop.ini`, `.tmp.driveupload/`)

- [x] 🟩 **Step 7: Verify & Commit**
  - [x] 🟩 Expo CLI verified working
  - [x] 🟩 Git status reviewed (543 files affected)
  - [ ] 🟨 Commit cleanup changes (awaiting user approval)
