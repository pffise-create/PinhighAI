# Launch Environment Variables

Single source of truth for every `EXPO_PUBLIC_*` variable the app consumes,
where it lives, and who has to set it before launch.

All `EXPO_PUBLIC_*` values are baked into the JS bundle at build time. Treat
them as **public** — never put real secrets here. The only "key" that belongs
in this list is the RevenueCat public API key, which is designed to ship.

## Where values come from

| Source | Used by | Notes |
|---|---|---|
| `.env` file at repo root | `expo start` / local Metro | Not checked in. Copy `.env.staging.example` to `.env` for local dev. |
| `env` block in `eas.json` per profile | EAS cloud builds | Currently only sets `EXPO_PUBLIC_APP_ENV`. Everything else must come from EAS dashboard environment variables, or be added here before a full build. |
| EAS dashboard environment variables | EAS cloud builds | Can be scoped per profile (development / preview / production). **This is where staging + prod secrets should live.** |

## Variables by feature area

### App environment
| Var | Required? | Default | Notes |
|---|---|---|---|
| `EXPO_PUBLIC_APP_ENV` | yes | `"dev"` | One of `dev`, `staging`, `prod`. Drives fallback behavior in `src/config/amplifyConfig.js` and QA panel visibility in `src/screens/SettingsModal.js`. Set by each `eas.json` build profile. |

### Cognito / Amplify Auth (`src/config/runtimeEnv.js`, `src/config/amplifyConfig.js`)
In dev, missing values silently fall back to the hard-coded `fallbackConfig` in `amplifyConfig.js`. In staging/prod, `configureAmplify()` **throws** with the list of missing fields. All six below are required for staging/prod.

| Var | Required? | Example | Notes |
|---|---|---|---|
| `EXPO_PUBLIC_COGNITO_USER_POOL_ID` | yes (non-dev) | `us-east-1_xxxxxxxxx` | |
| `EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID` | yes (non-dev) | | The Cognito app client ID. |
| `EXPO_PUBLIC_COGNITO_IDENTITY_POOL_ID` | no | `us-east-1:uuid...` | Read into config but intentionally **not** wired into Amplify.Auth (see comment in `amplifyConfig.js` lines 99-101). Safe to leave empty. |
| `EXPO_PUBLIC_COGNITO_DOMAIN` | yes (non-dev) | `golf-coach-auth-*.auth.us-east-1.amazoncognito.com` | Hosted UI domain. Do **not** include `https://`. |
| `EXPO_PUBLIC_AUTH_REDIRECT_SIGN_IN` | yes (non-dev) | `golfcoach://` | App scheme used by Amplify `signInWithRedirect`. Must match what's configured in Cognito app client. |
| `EXPO_PUBLIC_AUTH_REDIRECT_SIGN_OUT` | yes (non-dev) | `golfcoach://logout` | |
| `EXPO_PUBLIC_AUTH_PROVIDERS` | yes | `"Google"` today, `"Google,Apple"` once Apple OIDC is configured | Comma-separated. Drives which buttons `SignInScreen.js` shows **and** which providers Amplify registers. `SignInScreen.js` and `amplifyConfig.js` both read this — keep them in sync via this single var. |

### API backend (`src/services/chatApiService.js`, `src/services/videoService.js`)
| Var | Required? | Default | Notes |
|---|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | yes (non-dev) | | API Gateway base URL. Same var consumed by `runtimeEnv.js`, `chatApiService.js`, `videoService.js`. |
| `EXPO_PUBLIC_API_URL` | no | | **Legacy alias** still read by `chatApiService.js` + `videoService.js` as a fallback. New deployments should set `EXPO_PUBLIC_API_BASE_URL` instead. |
| `EXPO_PUBLIC_CHAT_PATH` | no | `"/api/chat"` | |
| `EXPO_PUBLIC_VIDEO_BUCKET` | no | `"golf-coach-videos-1753203601"` | S3 bucket for swing uploads. |

### RevenueCat (`src/config/subscriptions.js`)
Missing `EXPO_PUBLIC_REVENUECAT_API_KEY` causes `SubscriptionContext` to warn + disable subscriptions (no crash). Required for real billing.

| Var | Required? | Default | Notes |
|---|---|---|---|
| `EXPO_PUBLIC_REVENUECAT_API_KEY` | yes (for billing) | | Public iOS key (`test_*` for sandbox, real key for prod). |
| `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID` | no | `"DivotLab Unlimited"` | Must match the entitlement configured in the RevenueCat dashboard. |
| `EXPO_PUBLIC_REVENUECAT_OFFERING_ID` | no | unset | When set, `SubscriptionContext` picks that specific offering instead of the RevenueCat `current` offering. |
| `EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID` | no | `"com.alkigolf.divotlab.monthly"` | Matches the verified App Store Connect product ID. |
| `EXPO_PUBLIC_REVENUECAT_YEARLY_PRODUCT_ID` | no | `"com.alkigolf.divotlab.yearly"` | Matches the verified App Store Connect product ID. |

### Legal / support (`src/screens/SettingsModal.js`)
Privacy and Terms are optional during beta. When unset, the corresponding Settings row shows the neutral "coming before public launch" alert. Support opens an in-app message composer and defaults to `support@divotlab.ai`; set `EXPO_PUBLIC_SUPPORT_EMAIL` only if the destination should change.

| Var | Required? | Notes |
|---|---|---|
| `EXPO_PUBLIC_PRIVACY_POLICY_URL` | no (required at public launch) | Full `https://` URL. |
| `EXPO_PUBLIC_TERMS_URL` | no (required at public launch) | Full `https://` URL. |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | no | Plain email address override. Defaults to `support@divotlab.ai`; the app wraps it in `mailto:`. |

## Backend (Lambda) environment variables — subscription gating

These are **Lambda** env vars, not `EXPO_PUBLIC_*`. Set them on
`golf-chat-api-handler` and `golf-results-api-handler` (the two gated
endpoints). The RevenueCat **secret** key must never appear in the app bundle.

| Var | Required? | Value at launch | Notes |
|---|---|---|---|
| `SUBSCRIPTION_GATING_ENABLED` | yes | `"true"` | Master switch. Off = everyone gets full results (current beta behavior). |
| `ONE_TIME_LOCKED_RESULT_ENABLED` | no | unset | Leave unset for launch: every non-entitled result is a teaser. Set `"true"` to switch to the stricter one-teaser-ever mode. |
| `REVENUECAT_SECRET_API_KEY` | yes (for unlock) | `sk_...` | RevenueCat secret API key. Enables server-side entitlement lookup so purchases unlock without webhook delivery. Without it, only DynamoDB access records grant access. |
| `SUBSCRIPTION_ENTITLEMENT_KEY` | no | `"DivotLab Unlimited"` | Must match the RevenueCat entitlement ID and the app's `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID`. |
| `USER_ACCESS_TABLE` | no | defaults to `DYNAMODB_TABLE` | Table holding `access#<userId>` entitlement records. |

## Backend (Lambda) environment variables — account deletion

`AWS/src/api-handlers/account-deletion-handler.js` is deployed behind the
authenticated API Gateway `DELETE /api/account` route. API Gateway uses both
DivotLab Cognito user pools, and the handler reads the user ID only from verified
authorizer claims.

| Var | Required? | Production value |
|---|---|---|
| `DYNAMODB_TABLE` | yes | `golf-coach-analyses` |
| `USER_RECORD_TABLES` | yes | `golf-user-threads,golf-coach-swing-profiles,golf-coach-swing-profiles-dev,golf-coach-swing-profiles-staging,golf-coach-users` |
| `VIDEO_BUCKET` | yes | `golf-coach-videos-1753203601` |

The Lambda role needs DynamoDB `Scan`, `BatchWriteItem`, and `DeleteItem` for
those tables plus S3 `ListBucket` and `DeleteObject` for the video bucket.

## Backend (Lambda) environment variables — swing markings

Lambda env vars for the swing marking tool (`docs/marking-tool.md`). **Both
default to off.** Nothing about coaching changes while they are unset.

| Var | Set on | Default | Notes |
|---|---|---|---|
| `SWING_MARKING_ENABLED` | `golf-frame-extractor-simple-with-ai` **and** `golf-ai-analysis-processor` | off | Mode 1 (silent grounding). On the extractor it generates marked frame variants and writes `analysis_results.marking`; on the processor it sends those marked frames to the vision model instead of the plain ones and appends the Mode 1 instruction. Set on both or the pair does nothing useful: extractor-only just burns ~1s of CPU per swing, processor-only finds no marked frames and runs exactly as before. The extractor also needs the marking Lambda layer (`tflite_runtime`, `opencv-python-headless`, numpy, Pillow, and the MoveNet model at `/opt/models/movenet_singlepose_thunder_f16.tflite`); without it the import fails and marking is skipped with a recorded reason. |
| `SWING_MARKING_DISPLAY_ENABLED` | `golf-chat-api-handler` | off | Mode 2 (showing a marked frame to the player). Ships dark. When off, `shouldShowMarking` is short-circuited, chat attaches plain frames and the response carries no `display_frames`. |

Values are parsed strictly: only `1`, `true`, `yes`, `on` (case-insensitive) enable a flag.

## Launch checklist: EAS dashboard environment variables

Before the first `eas build --profile preview` for staging QA, set these on the **preview** environment via EAS dashboard (or `eas env:create`):

- [ ] `EXPO_PUBLIC_COGNITO_USER_POOL_ID`
- [ ] `EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID`
- [ ] `EXPO_PUBLIC_COGNITO_DOMAIN`
- [ ] `EXPO_PUBLIC_AUTH_REDIRECT_SIGN_IN`
- [ ] `EXPO_PUBLIC_AUTH_REDIRECT_SIGN_OUT`
- [ ] `EXPO_PUBLIC_AUTH_PROVIDERS`
- [ ] `EXPO_PUBLIC_API_BASE_URL`
- [x] `EXPO_PUBLIC_REVENUECAT_API_KEY` (RevenueCat production public key; set for preview and production 2026-08-08)

Before the first `eas build --profile production`, repeat on the **production** environment with prod values, and additionally:

- [x] `EXPO_PUBLIC_COGNITO_USER_POOL_ID`
- [x] `EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID`
- [x] `EXPO_PUBLIC_COGNITO_DOMAIN`
- [x] `EXPO_PUBLIC_AUTH_REDIRECT_SIGN_IN`
- [x] `EXPO_PUBLIC_AUTH_REDIRECT_SIGN_OUT`
- [x] `EXPO_PUBLIC_AUTH_PROVIDERS`
- [x] `EXPO_PUBLIC_API_BASE_URL`
- [x] `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID`
- [x] `EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID`
- [x] `EXPO_PUBLIC_REVENUECAT_YEARLY_PRODUCT_ID`
- [ ] `EXPO_PUBLIC_PRIVACY_POLICY_URL`
- [ ] `EXPO_PUBLIC_TERMS_URL`
- [x] `EXPO_PUBLIC_SUPPORT_EMAIL` (`support@divotlab.ai`)

## Quick smoke test

After setting env vars, a successful boot of a staging build should log:

```
Configuring Amplify { appEnv: 'staging', envConfigComplete: true, usingFallback: false, authProviders: [...], apiEndpoint: '...' }
Amplify configured successfully for React Native
```

A **failed** boot will throw with an explicit list of missing fields, e.g.:

```
Missing EXPO_PUBLIC_* config for app env "staging". Refusing partial fallback in non-dev environments. Missing: EXPO_PUBLIC_COGNITO_DOMAIN, EXPO_PUBLIC_API_BASE_URL. See docs/launch-env-vars.md.
```
