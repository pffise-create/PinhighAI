# Launch Plan

## Goal

Ship fast to test product-market fit with the smallest credible launch.

Launch path:
- Phase 1: `TestFlight beta`
- Phase 2: `iOS soft launch`

Optimization target:
- Speed over completeness
- Keep only what is needed to test whether users will sign up, start a trial, and pay for the product

## Launch Scope

### In Scope
- `iOS only`
- `Google + Apple` auth
- `7-day free trial`
- `monthly + annual` subscription options
- teaser/locked analysis before subscription
- TestFlight beta first, then soft launch

### Out of Scope for Launch
- Android
- web monetization
- email/password auth
- advanced settings and profile management
- deep analytics expansion
- non-essential polish beyond trust/paywall/legal flows

## Product Definition

The launch product should support this user journey:
1. New user opens the app
2. User signs in with Google or Apple
3. User experiences the core coaching flow
4. User sees teaser/locked analysis
5. User hits paywall
6. User starts a 7-day trial or purchases a subscription
7. User can restore and manage subscription successfully

## Phase 0: Scope Lock

Goal:
- Stop feature drift and lock the launch product

Tasks:
- Confirm launch is `iOS only`
- Confirm auth is `Google + Apple`
- Confirm pricing structure is `7-day free trial + monthly + annual`
- Confirm pre-subscription experience is teaser/locked analysis only
- Explicitly defer web, Android, and email/password

Exit criteria:
- No new launch-scope features are added unless they directly unblock auth, billing, legal, or App Store approval

## Phase 1: Beta-Ready Product

Goal:
- Produce a TestFlight build that can be tested end to end by real beta users

### Workstream 1: Auth and Environment Setup

Tasks:
- Stand up a real `staging/beta` auth and API configuration
- Populate staging env values
- Add and validate Apple Sign In
- Keep Google Sign In working
- Ensure staging builds do not depend on dev fallback config

Exit criteria:
- A staging/TestFlight build can sign in successfully with Google and Apple

### Workstream 2: RevenueCat and Store Wiring

Tasks:
- Create App Store subscription products for `monthly` and `annual`
- Configure `7-day free trial`
- Configure RevenueCat entitlement and offering
- Connect RevenueCat webhook to backend entitlement sync
- Validate locked analysis behavior against entitlement state
- Validate purchase, restore, and manage subscription flows on device

Exit criteria:
- A staging/TestFlight user can start trial, subscribe, restore purchases, and manage billing successfully

### Workstream 3: Settings, Legal, and Support

Tasks:
- Replace placeholder settings actions
- Create real `Privacy Policy`
- Create real `Terms of Service`
- Add real support contact details
- Link legal/support destinations from the app
- Make paywall/settings copy consistent with actual offer

Exit criteria:
- No placeholder legal or support surfaces remain in the app

### Workstream 4: First-Run QA Strategy

Goal:
- Make the unauthenticated signup, first login, and paywall path repeatable to test

Tasks:
- Create a pool of dedicated staging Google accounts for first-run auth testing
- Create dedicated Apple IDs for Sign in with Apple testing
- Create separate Apple sandbox tester accounts for subscription testing
- Track all QA accounts in a private tracker, not in app config or git
- Standardize two testing loops:
  - `fresh install + brand-new staging account`
  - `existing install + unused staging account`
- Add an internal `dev/staging-only` QA reset/debug surface that can:
  - sign out
  - clear local app state
  - clear local chat/history/onboarding state
  - inspect current auth user
  - inspect current entitlement state
  - trigger paywall/locked preview states quickly

Exit criteria:
- The team can repeatedly test a brand-new user signup and paywall flow without ambiguity from stale auth, local storage, or prior entitlement state

### Workstream 5: Beta QA

Tasks:
- Run real-device tests for:
  - Google sign-in
  - Apple sign-in
  - locked analysis preview
  - paywall presentation
  - trial start
  - monthly/annual purchase visibility
  - restore purchases
  - sign out and relaunch state
- Fix critical issues found during beta validation

Exit criteria:
- A beta tester can install from TestFlight and complete the end-to-end first-run and billing path

## Phase 2: Soft Launch Readiness

Goal:
- Convert the beta into a minimal public release

### Workstream 1: Production Configuration

Tasks:
- Populate real prod env values
- Replace any test RevenueCat keys with real prod keys
- Validate production auth/provider configuration
- Validate production webhook and entitlement sync

Exit criteria:
- Production build points only at production services and billing configuration

### Workstream 2: Business and Platform Setup

Tasks:
- Finish LLC or business entity setup
- Finish bank account and payout setup
- Ensure Apple business/tax/payout configuration is complete

Exit criteria:
- The app can legally and operationally accept payouts

### Workstream 3: Release Operations

Tasks:
- Prepare App Store listing assets and copy
- Add basic monitoring/crash visibility
- Use a beta-validated commit as the production release candidate
- Run final launch checklist before submitting

Exit criteria:
- The app is safe enough to release to a limited public audience

## Phase 3: Soft Launch

Goal:
- Get real PMF signal with limited exposure and minimal operational risk

Tasks:
- Release to the App Store with limited promotion
- Monitor:
  - sign-in completion
  - paywall view rate
  - trial starts
  - conversion to paid
  - restore failures
  - support issues
  - obvious churn/confusion points
- Keep post-launch fixes small and fast

Exit criteria:
- Enough signal exists to decide whether to iterate, reposition, or invest further

## Launch Blockers

### Blockers for TestFlight Beta
- Apple Sign In not complete
- RevenueCat/store products not fully wired
- placeholders remain in settings/legal/support
- no real legal copy
- no staging/beta validation path
- no repeatable first-run QA flow

### Blockers for Soft Launch
- no business entity
- no bank/payout setup
- no production-ready env configuration
- no successful beta cycle

## Recommended Execution Order

1. Lock scope
2. Set up staging/beta environment
3. Set up QA account strategy for first-run testing
4. Build internal reset/debug tooling for staging/dev
5. Finish Apple Sign In
6. Finish RevenueCat/store setup
7. Write legal copy and wire support/legal links
8. Run TestFlight beta
9. Complete business/bank/prod setup in parallel
10. Prepare production config and soft launch

## Work Split

### Inside the Repo
- Apple Sign In
- RevenueCat/paywall completion
- settings/legal/support wiring
- staging/prod env setup
- first-run QA reset/debug tooling
- beta QA fixes
- release hardening

### Outside the Repo
- App Store Connect subscription setup
- RevenueCat dashboard setup
- legal copy creation
- LLC/business entity setup
- bank/tax/payout setup
- support email/domain

## Decision Principles

Use these to avoid slowing down launch:
- Prefer shipping the narrowest credible product over adding optional features
- Cut anything that does not improve auth, paywall, legal trust, or launch viability
- Beta first, public later
- Validate on device for anything involving auth or subscriptions
- Use staging for iteration and production only after staging has passed
