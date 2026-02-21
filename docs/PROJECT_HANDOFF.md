# GolfCoachExpoFixed - Engineering Handoff

## Overview

**Golf Coach AI** is a mobile coaching app that provides AI-powered golf swing analysis. Users upload swing videos, which are processed through an AWS serverless pipeline using FFmpeg for frame extraction and OpenAI GPT-5 vision for analysis. The app supports both authenticated users (Google OAuth via Cognito) and guest mode.

### Technology Stack
- **Frontend:** React Native 0.81.4 / Expo 54.0.25, React Navigation 7.x
- **Backend:** AWS Lambda (Node.js 18.x + Python), API Gateway, DynamoDB, S3, Cognito
- **AI:** OpenAI GPT-5 vision for swing analysis + OpenAI chat/threads APIs for conversational coaching
- **Auth:** AWS Cognito with Google OAuth integration

## Local Development Stack

```bash
# Install dependencies
npm install

# Start Expo (clears cache to pick up asset/layout changes)
npx expo start -c
```

- iOS: press `i` (simulator)
- Android: press `a` (emulator)

### Key Configuration Files
- `src/config/amplifyConfig.js` - AWS Cognito/Amplify configuration
- `src/utils/theme.js` - Design system tokens (colors, typography, spacing)
- `app.json` - Expo configuration
- `package.json` - Dependencies and scripts

## Frontend Architecture

### Navigation Flow
```
SignInScreen (entry point)
  |-- [Authenticated] --> ChatScreen (main interface)
  |     |-- CoachingDashboard (recent analyses)
  |     |-- UploadOptionsModal --> VideoRecordScreen/CameraScreen
  |     |-- SettingsModal (navigation drawer)
  |-- [Guest] --> Chat with limitations
```

### Key Frontend Modules

| Area | Primary Files |
|------|---------------|
| App Entry | `App.js`, `src/navigation/AppNavigator.js` |
| Chat Experience | `src/screens/ChatScreen.js`, `src/components/ChatMessage.js` |
| Sign-In | `src/screens/SignInScreen.js` |
| Settings | `src/screens/SettingsModal.js` |
| Video Flows | `src/screens/VideoRecordScreen.js`, `src/screens/CameraScreen.js` |
| Services | `src/services/chatApiService.js`, `src/services/videoService.js` |
| Auth Context | `src/context/AuthContext.js` (Cognito + guest mode) |

### Design System (src/utils/theme.js)
- **Colors:** Forest (#1E3A2A), Fern (#3C8D5A), Gold (#C9A654)
- **Typography:** Manrope (headings), Inter (body)
- **Spacing:** Tailwind-like 4px base scale
- **Shadows:** 4-tier shadow system for depth

## AWS Backend Architecture

### Lambda Functions (Production)

| Function | Trigger | Purpose |
|----------|---------|---------|
| `golf-video-upload-handler` | POST /api/video/analyze | Seeds analysis job, validates JWT, invokes frame extraction |
| `golf-frame-extractor-simple` | Lambda invoke | Downloads video, extracts frames via FFmpeg, uploads to S3 |
| `golf-ai-analysis-processor` | Lambda invoke | Batches frames through GPT-5 vision, persists coaching output |
| `golf-results-api-handler` | GET /api/video/results/{jobId} | Returns analysis status for polling |
| `golf-chat-api-handler` | POST /api/chat | Conversational endpoint with OpenAI Threads + tool-use |
| `golf-presigned-url-generator` | POST /api/video/presigned-url | Issues presigned S3 upload URLs |

### DynamoDB Tables

| Table | Primary Key | Purpose |
|-------|-------------|---------|
| `golf-coach-analyses` | `analysis_id` | Stores swing analysis jobs and results |
| `golf-user-threads` | `user_id` | OpenAI thread metadata per user |
| `golf-coach-swing-profiles` | `user_id` | Persistent golfer swing profile |

### Data Pipeline
```
Mobile App
    |
[1. Get Presigned URL] --> S3 signer
    |
[2. Upload Video] --> S3 (golf-coach-videos-*)
    |
[3. POST /api/video/analyze] --> golf-video-upload-handler
    |--> DynamoDB: status=STARTED
    |--> Invoke: golf-frame-extractor-simple
         |
    [Frame Extraction via FFmpeg]
    |--> DynamoDB: status=COMPLETED, analysis_results
         |
    Invoke: golf-ai-analysis-processor
         |
    [AI Analysis via GPT-5]
    |--> DynamoDB: ai_analysis, status=AI_COMPLETED
    |--> golf-coach-swing-profiles (update profile)
         |
[4. Poll GET /api/video/results/{jobId}]
    |
Mobile App displays analysis + coaching
```

### Chat Loop Features (AWS/src/chat/chatLoop.js)
When `CHAT_LOOP_ENABLED=true`, the chat handler supports tool-use:
- `get_last_swing(user_id, limit)` - Fetch recent analyses
- `get_swing_analysis(analysis_id)` - Get full swing details
- `compare_swings(current_id, baseline_id)` - Delta metrics
- `get_user_swing_profile(user_id)` - Golfer tendency snapshot

### SQS Queues (Provisioned but Not Active)
- `golf-coach-frame-extraction-queue-prod` + DLQ
- `golf-coach-ai-analysis-queue-prod` + DLQ
- Lambda event source mappings not yet configured
- See `infrastructure/golf-sqs-queues.yaml` and `infrastructure/README.md`

## Environment Variables (Lambda)

```
DYNAMODB_TABLE=golf-coach-analyses
USER_THREADS_TABLE=golf-user-threads
OPENAI_API_KEY=sk-...
CHAT_LOOP_ENABLED=true
COGNITO_REGION=us-east-1
COGNITO_USER_POOL_ID=us-east-1_s9LDheoFF
COGNITO_APP_CLIENT_ID=2ngu9n6gdcbab01r89qbjh88ns
```

## Current Status

### Working Features
- Google OAuth sign-in and guest mode
- Video upload and S3 presigned URLs
- Frame extraction via FFmpeg layer
- AI-powered swing analysis via GPT-5
- Chat interface with OpenAI Threads
- Swing profile persistence (swingProfileRepository.js)
- Recent analyses display and progress tracking

### Known Frontend Issues
1. **ChatScreen JSX error** - Helper functions around lines 680-780 may have malformed JSX or unmatched braces
2. **Bundler errors on metadata list** - Replace `{'\u2022'}` with plain string bullets
3. **Asset resolution** - Confirm `assets/videos/golf-background-{1,2,3}.mp4` exist for SignIn background

### Pending Backend Work
- [ ] Activate SQS queue-based processing (queues provisioned, mappings not configured)
- [ ] Add CloudWatch alarms for queue depth and error monitoring
- [ ] Implement automated regression tests in CI

## Key Documentation Files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Agent operating guidelines |
| `docs/current-arch.md` | Detailed backend architecture |
| `docs/acceptance-checklist.md` | QA checklist |
| `docs/backend-auth-config.md` | Authentication configuration |
| `infrastructure/README.md` | SQS deployment guide |

## Suggested Next Steps

1. **Fix ChatScreen helpers** - Rebuild `renderMessage` and `renderInputSection` cleanly
2. **Validate asset imports** - Run `ls assets/videos` to confirm video filenames
3. **Smoke test** - `expo start -c`, verify sign-in loops, chat displays, uploads work
4. **Activate SQS** - Create Lambda event source mappings per `infrastructure/README.md`
5. **Add monitoring** - CloudWatch alarms for error rates and latency

## Repository Notes

- The `Expo/src/` directory contains legacy copies that may be out of sync with `src/`
- `AWS/archive/` contains legacy code kept for reference
- Numerous AWS test artifacts exist in root; consider cleanup after stabilization
- Git status shows many untracked files; review before committing

## Contact/Follow-Up

- Designer assets: `UI redesign/Visual Redesign for Golf App/`
- Background videos: `assets/videos/`
- Lambda reference implementations: `AWS/lambda-deployment/production/`
