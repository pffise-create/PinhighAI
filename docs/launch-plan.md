# Feature Implementation Plan

**Overall Progress:** `55%`

## TLDR
Prepare the app for the fastest credible launch path: `TestFlight beta -> iOS soft launch`. Focus only on the remaining launch blockers we explicitly identified: staging/beta setup, repeatable first-run QA, Apple Sign In, RevenueCat/store wiring, legal/support surfaces, and final production readiness.

**Code side is effectively done.** Every remaining task requires external access (AWS, Apple Developer portal, RevenueCat dashboard, App Store Connect, legal content, or a physical iOS device). See [Outstanding Launch Punch List](#outstanding-launch-punch-list) at the bottom of this file for the consolidated list. Env var reference: [`docs/launch-env-vars.md`](./launch-env-vars.md).

## Critical Decisions
- Decision 1: `iOS only` - fastest path to launch and PMF testing.
- Decision 2: `TestFlight beta before soft launch` - lowers risk and lets us validate signup, paywall, and purchase flow first.
- Decision 3: `Google + Apple auth only` - cuts email/password to reduce scope.
- Decision 4: `7-day trial + monthly + annual` - matches the intended monetization model.
- Decision 5: `Teaser / locked analysis before purchase` - keeps the core value visible while gating full access.
- Decision 6: `Web and Android deferred` - preserves speed and focus.
- Decision 7: `Shared backend/API for now` - fastest path; staging will isolate auth first and defer full backend separation.
- Decision 8: `preview` is the staging/beta build profile - keeps beta distribution separate from the production release build.

## Tasks:

- [x] 🟩 **Step 1: Lock Launch Scope**
  - [x] 🟩 Keep launch limited to `iOS`, `Google + Apple`, `7-day trial`, `monthly + annual`.
  - [x] 🟩 Explicitly defer `Android`, `web`, and `email/password`.
  - [x] 🟩 Use this document as the working launch scope reference.

- [ ] 🟨 **Step 2: Set Up Staging / Beta Environment**
  - [x] 🟩 Create staging Cognito resources for beta auth.
  - [x] 🟩 Configure Google auth for staging first.
  - [x] 🟩 Point staging builds at staging Cognito and the shared current API.
  - [x] 🟩 Populate real staging env values and ensure staging does not use dev fallback behavior.
  - [x] 🟩 Use `preview` as the staging/beta build profile.
  - [ ] 🟥 Validate local and beta builds against staging auth before launch-critical testing.

- [ ] 🟨 **Step 3: Create Repeatable First-Run QA**
  - [ ] 🟥 Create dedicated staging Google test identities.
  - [ ] 🟥 Create dedicated Apple IDs for Sign in with Apple testing.
  - [ ] 🟥 Create Apple sandbox testers for subscription testing.
  - [ ] 🟥 Track these accounts privately outside git.
  - [ ] 🟥 Standardize two test loops: `fresh install + new account` and `existing install + unused account`.
  - [x] 🟩 Add a dev/staging-only reset/debug path for auth, local state, and entitlement inspection.
  - [ ] 🟥 Validate the reset/debug path in a development build after a real Google sign-in.

- [ ] 🟨 **Step 4: Finish Launch Auth**
  - [x] 🟩 Keep Google Sign In working.
  - [ ] 🟨 Add and validate Apple Sign In in the actual app flow.
    - [x] 🟩 Frontend button + handler wired (`signInWithRedirect({ provider: 'Apple' })`), gated on `'Apple'` being present in `EXPO_PUBLIC_AUTH_PROVIDERS`.
    - [ ] 🟥 Configure Apple as an OIDC provider in staging + prod Cognito user pools (Apple team ID, services ID, key ID, private key). See `docs/staging-auth-setup-checklist.md` section 8.
    - [ ] 🟥 Add `Apple` to `EXPO_PUBLIC_AUTH_PROVIDERS` in staging/prod env configs once Cognito is ready.
    - [ ] 🟥 Device validation of the full round-trip on iOS.
  - [ ] 🟥 Verify sign-in, sign-out, and relaunch behavior on device.

- [ ] 🟨 **Step 5: Finish RevenueCat and Store Wiring**
  - [x] 🟩 `SubscriptionProvider` mounted in `App.js` inside `AuthProvider`; Settings `useSubscriptions()` now resolves instead of throwing.
  - [ ] 🟥 Configure RevenueCat entitlement and offering for launch (dashboard).
  - [ ] 🟥 Create App Store products for `monthly` and `annual`.
  - [ ] 🟥 Configure the `7-day free trial`.
  - [ ] 🟥 Connect webhook-based entitlement sync.
  - [ ] 🟥 Validate paywall, trial, purchase, restore, and manage-subscription behavior on device.

- [ ] 🟨 **Step 6: Finish Legal, Support, and Settings Surfaces**
  - [ ] 🟥 Write real `Privacy Policy` copy + host it.
  - [ ] 🟥 Write real `Terms of Service` copy + host it.
  - [x] 🟩 Replace placeholder support and legal actions in settings.
    - [x] 🟩 Added the missing Terms of Service row alongside Privacy Policy in `SettingsModal.js`.
    - [x] 🟩 Removed literal "(placeholder)" suffix from the support copy.
    - [x] 🟩 URL opens pre-wired: `EXPO_PUBLIC_PRIVACY_POLICY_URL`, `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_SUPPORT_EMAIL` (mailto). When unset, rows fall back to the neutral "coming before public launch" alert — set the env vars in eas.json/build env to flip them live with no code change.
  - [ ] 🟥 Ensure paywall and settings copy matches the real offer.

- [ ] 🟥 **Step 7: Validate Beta Build**
  - [ ] 🟥 Run end-to-end device validation for first-run auth, locked analysis, paywall, trial, restore, and sign-out.
  - [ ] 🟥 Fix launch-blocking issues found during beta validation.
  - [ ] 🟥 Ship a TestFlight beta only after the first-run and billing path is reliable.

- [ ] 🟥 **Step 8: Prepare Soft Launch Requirements**
  - [ ] 🟥 Populate real production env configuration.
  - [ ] 🟥 Replace any test billing keys with production values.
  - [ ] 🟥 Complete business entity, bank, payout, and Apple business setup outside the repo.
  - [ ] 🟥 Prepare App Store listing assets and minimal release operations.

- [ ] 🟥 **Step 9: Execute iOS Soft Launch**
  - [ ] 🟥 Release from a beta-validated build.
  - [ ] 🟥 Monitor sign-in completion, paywall views, trial starts, conversion, restores, and support issues.
  - [ ] 🟥 Use the soft launch to evaluate PMF before expanding scope.

## Outstanding Launch Punch List

Everything below needs a human to do it — either because it requires console/portal access, physical hardware, legal content, or business setup. Grouped by actor so each block can be worked in parallel.

### 1. AWS / Cognito (Steps 2, 4)
- [ ] Verify staging + prod Cognito user pools have all Hosted UI settings aligned with `golfcoach://` and `golfcoach://logout` callback URLs.
- [ ] Configure **Apple** as an OIDC identity provider in the **staging** Cognito user pool. Requires: Apple team ID, Services ID, key ID, private key (.p8). See `docs/staging-auth-setup-checklist.md` §8 if it exists.
- [ ] Repeat Apple OIDC configuration in the **prod** Cognito user pool before soft launch.

### 2. EAS dashboard / env vars (Step 2)
- [ ] Set all required `EXPO_PUBLIC_*` vars on the **preview** (staging) EAS environment per [`docs/launch-env-vars.md`](./launch-env-vars.md). Minimum: the 7 Cognito + API vars and `EXPO_PUBLIC_REVENUECAT_API_KEY`.
- [ ] Once Apple OIDC is live in Cognito staging, update `EXPO_PUBLIC_AUTH_PROVIDERS` to `"Google,Apple"` on the preview environment.
- [ ] Repeat for the **production** EAS environment before the prod build, including the RevenueCat product IDs and the legal/support URLs once those exist.

### 3. Apple Developer portal (Step 4)
- [ ] Create Services ID for Sign in with Apple (if not already).
- [ ] Create the private key (.p8) and record key ID, team ID.
- [ ] Hand these off to whoever configures Cognito OIDC.

### 4. RevenueCat dashboard (Step 5)
- [ ] Create entitlement `DivotLab Unlimited` (or update the env var to match whatever name you pick).
- [ ] Create an offering containing the monthly + yearly packages.
- [ ] Configure the **7-day free trial** on both products.
- [ ] Set up the webhook for entitlement sync to the backend.

### 5. App Store Connect (Steps 5, 8)
- [ ] Create auto-renewable subscription products with IDs matching `EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID` and `EXPO_PUBLIC_REVENUECAT_YEARLY_PRODUCT_ID` (defaults: `monthly`, `yearly`).
- [ ] Attach the 7-day free introductory offer to each.
- [ ] Create sandbox test users for purchase/restore validation.
- [ ] Prepare App Store listing assets (screenshots, description, keywords, privacy labels).
- [ ] Complete business entity, banking, tax, and payout setup.

### 6. Legal / support content (Step 6)
- [ ] Write Privacy Policy copy and host it at a stable URL.
- [ ] Write Terms of Service copy and host it at a stable URL.
- [ ] Stand up a real support mailbox.
- [ ] Set `EXPO_PUBLIC_PRIVACY_POLICY_URL`, `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_SUPPORT_EMAIL` in the EAS environments — **no code change needed**, rows auto-flip to live links once set.
- [ ] Audit paywall + settings copy against the real offer (price, trial length, billing cadence) before launch.

### 7. QA identities (Step 3)
- [ ] Create a set of staging Google test accounts.
- [ ] Create dedicated Apple IDs for Sign in with Apple testing.
- [ ] Create App Store sandbox testers for purchase testing.
- [ ] Track them privately (password manager, not git).

### 8. On-device validation (Steps 2, 3, 4, 5, 7)
- [ ] Install a preview build from EAS on a physical iOS device.
- [ ] **Step 2 close-out:** Confirm app boots against staging Cognito with no fallback warning. (Check console for `Configuring Amplify { ... usingFallback: false }`.)
- [ ] **Step 3:** Run the reset/debug path in Settings → QA Tools after a real Google sign-in; confirm it clears auth + RevenueCat identity.
- [ ] **Step 3:** Run both standardized QA loops — `fresh install + new account` and `existing install + unused account`.
- [ ] **Step 4:** Round-trip Google Sign In (sign in → backgrounded → relaunch → sign out).
- [ ] **Step 4:** Round-trip Apple Sign In, same flow, once Cognito OIDC is live.
- [ ] **Step 5:** Paywall presentation, monthly purchase, yearly purchase, restore, trial start, manage subscription (Customer Center).
- [ ] **Step 7:** End-to-end locked-analysis → paywall → purchase → unlocked-analysis flow.
- [ ] **Step 7:** File any launch-blocking bugs found and re-test after fix.

### 9. TestFlight + soft launch (Steps 7, 9)
- [ ] Ship preview build to TestFlight once all device validation passes.
- [ ] Invite beta testers; monitor crash reports + feedback.
- [ ] Promote to soft launch after beta green light.
- [ ] Monitor sign-in completion, paywall views, trial starts, conversion, restores, and support volume.
