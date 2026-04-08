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
| `EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID` | no (defaults to `"monthly"`) | `"monthly"` | Must match App Store Connect product ID. |
| `EXPO_PUBLIC_REVENUECAT_YEARLY_PRODUCT_ID` | no (defaults to `"yearly"`) | `"yearly"` | Same. |

### Legal / support (`src/screens/SettingsModal.js`)
All three are optional. When unset, the corresponding Settings row shows the neutral "coming before public launch" alert. When set, the row opens via `Linking.openURL`.

| Var | Required? | Notes |
|---|---|---|
| `EXPO_PUBLIC_PRIVACY_POLICY_URL` | no (required at public launch) | Full `https://` URL. |
| `EXPO_PUBLIC_TERMS_URL` | no (required at public launch) | Full `https://` URL. |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | no (required at public launch) | Plain email address; the app wraps it in `mailto:`. |

## Launch checklist: EAS dashboard environment variables

Before the first `eas build --profile preview` for staging QA, set these on the **preview** environment via EAS dashboard (or `eas env:create`):

- [ ] `EXPO_PUBLIC_COGNITO_USER_POOL_ID`
- [ ] `EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID`
- [ ] `EXPO_PUBLIC_COGNITO_DOMAIN`
- [ ] `EXPO_PUBLIC_AUTH_REDIRECT_SIGN_IN`
- [ ] `EXPO_PUBLIC_AUTH_REDIRECT_SIGN_OUT`
- [ ] `EXPO_PUBLIC_AUTH_PROVIDERS`
- [ ] `EXPO_PUBLIC_API_BASE_URL`
- [ ] `EXPO_PUBLIC_REVENUECAT_API_KEY`

Before the first `eas build --profile production`, repeat on the **production** environment with prod values, and additionally:

- [ ] `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID` (if not using the default)
- [ ] `EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID`
- [ ] `EXPO_PUBLIC_REVENUECAT_YEARLY_PRODUCT_ID`
- [ ] `EXPO_PUBLIC_PRIVACY_POLICY_URL`
- [ ] `EXPO_PUBLIC_TERMS_URL`
- [ ] `EXPO_PUBLIC_SUPPORT_EMAIL`

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
