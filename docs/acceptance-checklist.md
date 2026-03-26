# Acceptance Validation Checklist

Use this checklist for launch-critical validation. It is intentionally biased toward the current launch path:
- `iOS first`
- `TestFlight beta -> soft launch`
- `Google + Apple`
- `7-day free trial`
- `monthly + annual`
- teaser/locked analysis before subscription

## 1. Auth and First-Run

- Fresh install on device or simulator opens to sign-in without stale session state.
- Google sign-in completes successfully.
- Apple sign-in completes successfully.
- Sign-out returns the user to sign-in and clears authenticated state.
- Fresh-user loop is repeatable using staging QA accounts and reset workflow.

## 2. Core Product Flow

- Authenticated user lands in chat successfully.
- User can send a text message and receive a response.
- User can select and upload a swing video.
- Analysis polling completes and returns a coaching response or a locked-analysis response without crashing.
- Chat history persists across relaunch for the same authenticated user.

## 3. Subscription and Paywall

- New non-entitled user sees teaser/locked analysis behavior as expected.
- Paywall opens from the locked-analysis CTA.
- Trial start flow works on device using sandbox billing.
- Monthly and annual products are visible in the configured offering.
- Restore purchases works correctly.
- Manage subscription / Customer Center opens successfully.
- Entitlement state updates correctly after purchase and restore.

## 4. Settings, Legal, and Support

- Settings opens from chat.
- Settings shows real support information, not placeholders.
- Privacy Policy link works.
- Terms of Service link works.
- Sign-out works from settings.

## 5. Environment and Release Safety

- Staging build uses staging auth/API/billing configuration.
- Production build uses production auth/API/billing configuration.
- No production build depends on dev fallback config.
- RevenueCat webhook sync is configured and reachable in the target environment.

## 6. Backend and Observability

- Video upload handler, analysis processor, and chat handler respond successfully for the tested flow.
- Locked-result gating matches backend entitlement state.
- Relevant Lambda logs do not expose secrets or unnecessary personal data.
- Deployment state is recorded in [`docs/DEPLOYMENT-TRACKER.md`](./DEPLOYMENT-TRACKER.md) when backend behavior changes.

## 7. Automated Checks

- `npm test`
- `npm run check:hygiene`
- Targeted backend tests for any changed AWS handlers

## 8. Exit Criteria for TestFlight Beta

- A brand-new staging user can install the app, sign in, hit the paywall, start a trial or restore, and access the app without placeholder or dead-end flows.

## 9. Exit Criteria for Soft Launch

- Beta cycle completed successfully.
- Production env is configured.
- Legal/support surfaces are live.
- Billing works on production configuration.
- Business/payout setup is complete outside the repo.
