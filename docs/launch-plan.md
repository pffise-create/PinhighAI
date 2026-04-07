# Feature Implementation Plan

**Overall Progress:** `38%`

## TLDR
Prepare the app for the fastest credible launch path: `TestFlight beta -> iOS soft launch`. Focus only on the remaining launch blockers we explicitly identified: staging/beta setup, repeatable first-run QA, Apple Sign In, RevenueCat/store wiring, legal/support surfaces, and final production readiness.

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

- [ ] 🟥 **Step 4: Finish Launch Auth**
  - [ ] 🟥 Keep Google Sign In working.
  - [ ] 🟥 Add and validate Apple Sign In in the actual app flow.
  - [ ] 🟥 Verify sign-in, sign-out, and relaunch behavior on device.

- [ ] 🟥 **Step 5: Finish RevenueCat and Store Wiring**
  - [ ] 🟥 Configure RevenueCat entitlement and offering for launch.
  - [ ] 🟥 Create App Store products for `monthly` and `annual`.
  - [ ] 🟥 Configure the `7-day free trial`.
  - [ ] 🟥 Connect webhook-based entitlement sync.
  - [ ] 🟥 Validate paywall, trial, purchase, restore, and manage-subscription behavior on device.

- [ ] 🟥 **Step 6: Finish Legal, Support, and Settings Surfaces**
  - [ ] 🟥 Write real `Privacy Policy`.
  - [ ] 🟥 Write real `Terms of Service`.
  - [ ] 🟥 Replace placeholder support and legal actions in settings.
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
