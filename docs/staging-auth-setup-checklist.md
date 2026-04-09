# Staging Auth Setup Checklist (Step 2)

Use this checklist to stand up a real staging auth flow for internal + small external beta testing.

## Goal
- Enable `Google` sign-in first in staging (to unblock UI iteration and Playwright review).
- Add `Apple` sign-in before release.
- Keep staging auth isolated from production users/data.
- Use the existing shared API/backend for now to keep setup lightweight.

## 1) Staging Auth Infrastructure (Amplify/Cognito)
- [x] Create a staging Cognito User Pool (or Amplify env) for beta auth.
- [x] Create a staging App Client (no client secret for mobile app auth flow).
- [x] Create / confirm a staging Identity Pool (if required by current app flows).
- [x] Create a staging hosted UI domain (Cognito domain).
- [x] Record values for:
  - `USER_POOL_ID`
  - `USER_POOL_CLIENT_ID`
  - `IDENTITY_POOL_ID`
  - `COGNITO_DOMAIN`

## 2) Google Sign-In (Staging First)
- [x] Create Google OAuth client(s) for staging callback URIs.
- [x] Add staging callback URL(s) to Cognito hosted UI provider config.
- [x] Enable `Google` provider in staging auth.
- [ ] Validate sign-in round trip on a local build against staging.

## 3) Redirect / Deep Link Configuration
- [ ] Confirm app deep link scheme (`golfcoach://`) for native sign-in callbacks.
- [ ] Define staging `redirectSignIn` URI list.
- [ ] Define staging `redirectSignOut` URI list.
- [ ] (Optional) Add web localhost callback URIs for Playwright/browser auth testing if needed.

## 4) App Environment Configuration
- [x] Populate `.env.staging.local` from `.env.staging.example`.
- [x] Set `EXPO_PUBLIC_APP_ENV=staging`.
- [x] Set staging Cognito values.
- [x] Point `EXPO_PUBLIC_API_BASE_URL` to the current shared API/backend.
- [x] Set `EXPO_PUBLIC_AUTH_PROVIDERS=Google` initially.
- [ ] Verify app starts without fallback warning in staging mode.

## 5) Beta Build Mapping
- [x] Use the `preview` EAS profile as the staging/beta build.
- [x] Confirm `preview` sets `EXPO_PUBLIC_APP_ENV=staging`.
- [x] Confirm `production` remains the production release build.

## 6) Test Accounts (Internal + External Beta)
- [ ] Create at least 2 internal staging test users (UI/admin + clean user path).
- [ ] Create naming convention (e.g. `staging-ui-01`, `staging-beta-01`).
- [ ] Track owner/purpose/reset notes in a private tracker (not git).
- [ ] Validate sign-in for at least one test account on local and one beta build.

## 7) Playwright Validation (UI/Auth Access)
- [ ] Confirm browser auth path works for staging test account (or document browser limitations).
- [ ] Capture baseline screenshots for sign-in, chat, and settings.
- [ ] Document any auth flow caveats (redirect timing, popup behavior, cookies/session persistence).

## 8) Apple Sign-In (Before Release)

See [`docs/apple-sign-in-setup.md`](./apple-sign-in-setup.md) for the full
walkthrough — exact portal navigation, exact values to enter, common errors.

- [ ] **Apple Developer portal** — enable Sign In with Apple on primary App ID
      (`com.pinhighai.golfcoach`), create Services ID
      (`com.pinhighai.golfcoach.web`) with both staging + prod return URLs,
      create private key and download the `.p8` file (one-time download),
      record Team ID + Key ID.
- [ ] **Staging Cognito user pool** (`us-east-1_gquwrWOYG`) — add Apple as
      federated identity provider, enable on staging app client.
- [ ] **Production Cognito user pool** (`us-east-1_s9LDheoFF`) — same setup,
      using the same 4 values as staging.
- [ ] **EAS env vars** — change `EXPO_PUBLIC_AUTH_PROVIDERS` from `Google` to
      `Google,Apple` on both preview and production environments.
- [ ] **Device validation** — rebuild staging, tap "Continue with Apple",
      confirm round-trip completes and lands in chat. Repeat for prod via
      TestFlight before App Store submission.
- [ ] **App Review risk** — if rejected under guideline 4.8, swap
      `signInWithRedirect({ provider: 'Apple' })` for
      `expo-apple-authentication` native flow. See risk note in the setup doc.

## Notes
- For `staging` and `prod`, the app now refuses partial `EXPO_PUBLIC_*` config fallback. Populate all required values.
- Subscription testing (trial/purchase/restore) still requires device sandbox testing later; Playwright is UI/auth validation only.
- This checklist intentionally assumes a shared API/backend for now; only auth is being isolated in this step.
