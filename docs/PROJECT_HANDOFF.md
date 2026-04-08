# GolfCoachExpoFixed - Engineering Handoff

## Overview

**DivotLab AI** is a React Native / Expo mobile app for AI-powered golf swing coaching. Users authenticate, upload swing videos, receive AI analysis, and continue with conversational follow-up coaching.

Current product direction:
- `iOS first`
- `Google + Apple` auth at launch
- `7-day free trial`
- `monthly + annual` subscriptions
- teaser/locked analysis before purchase
- launch path: `TestFlight beta -> iOS soft launch`

Launch planning reference:
- See [`docs/launch-plan.md`](./launch-plan.md) for the current launch path and blockers.

## Technology Stack

- **Frontend:** React Native 0.81.5 / Expo 54 / React Navigation 7
- **Backend:** AWS Lambda, API Gateway, DynamoDB, S3, Cognito
- **AI:** OpenAI vision + chat/threads-based coaching
- **Auth:** Cognito hosted auth with Google live, Apple planned for launch completion
- **Subscriptions:** RevenueCat (`react-native-purchases`, `react-native-purchases-ui`)

## Local Development

```bash
npm install
npx expo start -c
```

Useful scripts:
- `npm test`
- `npm run check:hygiene`
- `npm run test:e2e`

## Current Frontend Shape

### Navigation

```text
SignInScreen
  -> ChatScreen
     -> SettingsModal
```

### Primary Frontend Files

| Area | Primary Files |
|------|---------------|
| App entry | `App.js`, `src/navigation/AppNavigator.js` |
| Auth | `src/context/AuthContext.js`, `src/config/amplifyConfig.js`, `src/config/runtimeEnv.js` |
| Subscriptions | `src/context/SubscriptionContext.js`, `src/config/subscriptions.js` |
| Sign-in | `src/screens/SignInScreen.js` |
| Chat | `src/screens/ChatScreen.js`, `src/components/chat/*` |
| Settings | `src/screens/SettingsModal.js` |
| Video upload / analysis client | `src/services/videoService.js`, `src/services/chatApiService.js` |

### Current User Experience Status

Working now:
- Google sign-in
- authenticated app navigation
- chat flow
- video upload + polling for analysis
- locked analysis handling in chat
- RevenueCat client wiring
- settings shell with subscription actions

Not finished for launch:
- Apple Sign In
- real legal/support destinations
- productionized paywall + store setup validation
- repeatable first-run QA tooling
- fully configured staging/prod envs

## Backend Architecture

### Main Lambda Functions

| Function | Purpose |
|----------|---------|
| `golf-video-upload-handler` | Starts a video analysis job |
| `golf-frame-extractor-simple` | Extracts frames with FFmpeg |
| `golf-ai-analysis-processor` | Produces coaching output from frames |
| `golf-results-api-handler` | Returns job status / results |
| `golf-chat-api-handler` | Handles conversational coaching |
| `golf-presigned-url-generator` | Generates S3 upload URLs |
| `golf-revenuecat-webhook-handler` | Syncs entitlement state into backend access records |

### Main Data Stores

| Table | Purpose |
|-------|---------|
| `golf-coach-analyses` | analysis jobs and results |
| `golf-user-threads` | chat thread metadata |
| `golf-coach-swing-profiles` | user swing profile persistence |
| `USER_ACCESS_TABLE` / access records | entitlement state for subscription gating |

## Environment Model

The app is structured for:
- `dev`
- `staging`
- `prod`

Reference docs:
- [`docs/environment-rollout.md`](./environment-rollout.md)
- [`docs/staging-auth-setup-checklist.md`](./staging-auth-setup-checklist.md)

Important behavior:
- `dev` may use fallback config for continuity
- `staging` and `prod` should use explicit `EXPO_PUBLIC_*` env values
- launch-critical auth/billing/settings changes should validate in staging before prod

## Known Launch Gaps

- Apple Sign In is not wired into the current UI flow
- Settings still contain placeholder support/legal actions
- Legal copy still needs to be written
- RevenueCat/store setup still needs end-to-end device validation
- business entity and payout setup are outside the repo and still pending

## Validation Status

Locally verified during current review:
- `npm test` passes
- `npm run check:hygiene` passes

Not yet verified in this review:
- full Expo runtime boot
- device sign-in flow
- Apple Sign In
- real purchase / restore flows
- TestFlight path

## Recommended Next References

- [`docs/launch-plan.md`](./launch-plan.md)
- [`docs/acceptance-checklist.md`](./acceptance-checklist.md)
- [`docs/revenuecat-react-native-setup.md`](./revenuecat-react-native-setup.md)
- [`docs/owner-sop-revenuecat-and-store-setup.md`](./owner-sop-revenuecat-and-store-setup.md)
- [`docs/DEPLOYMENT-TRACKER.md`](./DEPLOYMENT-TRACKER.md)
