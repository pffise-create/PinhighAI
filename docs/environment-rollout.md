# Environment and Rollout Flow (Mobile App)

## Purpose
Define how this project uses `dev`, `staging (beta)`, and `prod`, and how changes move from local work to beta validation to production release.

This supports the UI transformation + subscriptions project by making auth, paywall, and settings changes testable before production rollout.

## Environment Model

### `dev` (local development)
- Used for local coding, UI iteration, and Playwright visual checks.
- Can point to staging services when real auth/test accounts are required.
- Should not contain production-only secrets.

### `staging` (beta)
- Used for internal testing and small external beta validation.
- Should use isolated auth config and test users.
- Currently planned to share the existing API/backend for speed, while keeping auth isolated first.
- Preferred target for validating sign-in, paywall gating, settings actions, and UI regressions before production.

### `prod`
- Used for public app releases.
- Must only be updated after staging validation succeeds.

## Configuration Strategy (Expo + Amplify)

The app should select environment behavior using `EXPO_PUBLIC_APP_ENV`:
- `dev`
- `staging`
- `prod`

Amplify/API values should come from environment variables (preferred), with explicit fallback behavior only for local continuity during migration.

### Expected public env vars (app build/runtime)
- `EXPO_PUBLIC_APP_ENV`
- `EXPO_PUBLIC_COGNITO_USER_POOL_ID`
- `EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID`
- `EXPO_PUBLIC_COGNITO_IDENTITY_POOL_ID`
- `EXPO_PUBLIC_COGNITO_DOMAIN`
- `EXPO_PUBLIC_AUTH_REDIRECT_SIGN_IN` (comma-separated if multiple)
- `EXPO_PUBLIC_AUTH_REDIRECT_SIGN_OUT` (comma-separated if multiple)
- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_AUTH_PROVIDERS` (comma-separated; example: `Google,Apple`)

Notes:
- `EXPO_PUBLIC_*` values are visible to the client app. Do not put secrets here.
- OAuth client secrets and other private credentials must stay in AWS console / secret stores, not in the app.

## Rollout Workflow (Beta First -> Production)

### 1) Develop on a short-lived branch
- Branch from `main` using a scoped name, e.g. `codex/ui-signin-polish` or `codex/settings-subscription`.
- Keep changes focused (UI, auth, billing, docs should not be mixed unless tightly related).

### 2) Validate locally
- Run app locally (`dev`) and verify the changed flow.
- Use Playwright for web UI regression checks (sign-in/chat/settings visuals and auth/gating states).
- When auth is involved, use staging test accounts.

### 3) Promote to staging (beta)
- Merge branch changes after local validation (or open PR and merge after review).
- Build/run the app against `staging` config.
- Use the `preview` EAS profile as the staging/beta build.
- Validate with internal testers first, then small external beta group if needed.
- For subscriptions: validate on device with Apple/Google sandbox testers (Playwright is UI-only for paywall states).

### 4) Promote to production
- Release from a commit already validated in staging whenever possible.
- Avoid mixing extra changes into the production release branch/commit.
- If a hotfix is needed, patch on a short-lived branch, validate in staging quickly, then release.

## GitHub and Commit Expectations

### Branching
- `main` is the production-ready integration branch.
- Use short-lived feature/fix branches prefixed `codex/`.

### Commit hygiene
- Keep commits small and scoped.
- Example commit messages:
  - `fix(chat): resolve appendMessage hook ordering runtime issue`
  - `feat(settings): add manage subscription and restore purchases actions`
  - `docs(agents): add beta-first rollout and environment flow`

### Promotion rule
- Production releases should come from a commit that has already passed staging validation.

## Testing Boundaries (Important)

### Playwright is for
- Sign-in/chat/settings visual regression checks
- Auth state and gating UI validation
- Paywall modal UI states and copy checks

### Device testing is required for
- Apple/Google purchase flow
- Trial start behavior
- Restore purchases
- Manage subscription handoff behavior
- Real entitlement edge cases

## Test Account Policy (Initial)
- Maintain dedicated staging test accounts for internal engineering/product review.
- Use clear naming conventions (e.g. `staging-ui-01`, `staging-beta-01`).
- Document account owner, purpose, and reset notes in a private internal tracker (not in git).
- Do not reuse production customer accounts for staging validation.

## Current Fast-Path Assumption

To move quickly, staging is currently defined as:
- separate Cognito/auth setup
- shared API/backend with the current environment
- `preview` EAS profile for staging/beta distribution

If data isolation becomes a problem later, separate staging backend resources can be added after auth/billing validation is working.

## Deferred (Track as Next Steps)
- Support email/domain provisioning
- Legal pages (Privacy/Terms) and domain
- LLC and business operations setup
