# Alki DivotLab App Store Launch Runbook

Verified 2026-08-15. This is the dependency-ordered plan from the current state to a publicly downloadable App Store release.

## Current verified state

- [x] App Store app `6799256144` exists for `com.alkigolf.divotlab` and version `1.0` is `PREPARE_FOR_SUBMISSION`.
- [x] Three running-app iPhone screenshots are uploaded and processed.
- [x] Monthly `$5.99` and annual `$59.99` subscriptions, each with a 7-day trial, are `READY_TO_SUBMIT`.
- [x] RevenueCat products, entitlement, offering, credentials, and Apple server notifications are connected.
- [x] Sign in with Apple is configured through Cognito.
- [x] Paid Apps agreement, tax, and banking are complete per the account holder.
- [x] One sandbox purchaser exists; the same account can be reset and reused for initial purchase testing.
- [x] Automated baseline passes: 112 app tests, 145 backend tests, one Playwright smoke test, and an iOS bundle export.
- [ ] No build has been uploaded to App Store Connect.
- [ ] The TestFlight internal group has zero testers.
- [ ] Production EAS has RevenueCat, auth, API, and support values; privacy and terms URLs remain missing.
- [ ] Preview EAS contains account-wide duplicate RevenueCat values, but the correct project-scoped values override them for this project.
- [ ] App Store support URL, privacy URL, age rating, content rights, review contact, review notes, and privacy answers are incomplete.
- [x] Launch work is committed on draft PR `#13`; both GitHub CI jobs pass. The PR is not yet merged to `main`.
- [ ] RevenueCat v1 server key is missing, the AWS session needs login, and subscription gating remains off.
- [x] Account-deletion code now deletes the RevenueCat customer before app-owned data; focused and full backend tests pass. Deployment still requires the server key and AWS login.

## Phase 1: Lock release decisions

- [ ] **Patrick:** Confirm device scope. Recommended: iPhone-only for `1.0`. The app currently declares iPad support; keeping it requires iPad testing and listing assets.
- [ ] **Patrick:** Confirm storefront scope. Recommended: United States only for the first release, then expand after validation.
- [ ] **Patrick:** Confirm release control. Recommended: manual release after approval rather than the current automatic-after-approval setting.
- [ ] **Patrick:** Confirm the public seller/legal entity name and whether Apple should treat the account as a Digital Services Act trader.

Exit gate: device scope, storefronts, release method, and seller identity are written down.

## Phase 2: Make one releasable source revision

- [x] **Codex:** Reconcile the launch work, exclude local/generated artifacts, and preserve all intended changes in commit `eb07753`.
- [x] **Codex:** Close PRs `#1`-`#3` as superseded by consolidated launch PR `#13`.
- [x] **Codex:** Fix account deletion so RevenueCat customer data is deleted or appropriately anonymized along with app-owned data.
- [ ] **Codex:** Apply the Phase 1 device-support decision in `app.json`.
- [x] **Codex:** Run app tests, backend tests, Playwright, iOS export, hygiene checks, and GitHub CI.
- [x] **Codex:** Commit, push, and open consolidated draft release PR `#13`.
- [ ] **Together:** Review and merge PR `#13`, then tag the release-candidate commit.

Exit gate: clean `main`, green CI, and a known release-candidate commit.

## Phase 3: Finish business, legal, and public URLs

- [x] **Patrick:** App Store Connect -> Business -> Agreements. Open Paid Apps and make its status `Active`.
- [x] **Patrick:** Business -> Agreements -> Tax Forms. Submit every requested form and resolve missing information.
- [x] **Patrick:** Business -> Agreements -> Banking. Add and verify the payout account.
- [ ] **Patrick:** Confirm the legal entity, mailing address, effective date, governing law, dispute terms, and `support@divotlab.ai` mailbox.
- [ ] **Patrick:** Confirm whether the app is a regulated medical device. Expected answer is no, but this is an owner declaration.
- [ ] **Codex:** Finalize the privacy policy and terms using the confirmed business details.
- [ ] **Codex:** Publish privacy, terms, and support pages on `divotlab.ai` over HTTPS.
- [ ] **Codex:** Verify every public URL and the support mailbox from outside the developer account.

Exit gate: Paid Apps is active and all legal/support URLs are live.

## Phase 4: Complete configuration and billing enforcement

- [ ] **Codex:** Remove duplicate preview EAS variables and retain the production RevenueCat key and full product IDs.
- [x] **Codex:** Add verified production EAS values for Cognito, redirects, auth providers, API base URL, RevenueCat, and support email.
- [ ] **Codex:** Add production privacy and terms URLs after the legal pages are published.
- [ ] **Patrick:** RevenueCat -> Project Settings -> API Keys -> create a secret v1 key with read access to customers/subscribers. Store it in Mac Keychain; never paste it into chat or Git.
- [ ] **Patrick:** Run `aws login` on the Mac when prompted so Codex can update Lambda configuration.
- [ ] **Codex:** Add `REVENUECAT_SECRET_API_KEY` to the chat and results Lambdas while leaving `SUBSCRIPTION_GATING_ENABLED=false`.
- [ ] **Codex:** Verify live entitlement lookup and account-deletion cleanup with disposable users.
- [x] **Patrick:** Confirm at least one sandbox purchaser exists.
- [ ] **Patrick:** Optional but recommended: create a second sandbox purchaser for a clean annual-plan test while the first account tests monthly and restore.

Exit gate: production configuration is complete, backend entitlement lookup works, and sandbox accounts exist.

## Phase 5: Build and start TestFlight

- [ ] **Codex:** Increment the iOS build number and run the production EAS build from the release-candidate commit.
- [ ] **Codex:** Submit the build to App Store Connect and wait for Apple processing to reach `Complete`.
- [ ] **Codex:** Resolve build warnings, export-compliance prompts, or privacy-manifest issues.
- [ ] **Codex:** Add the processed build to `Internal Testers` and add Patrick's App Store Connect user.
- [ ] **Codex:** Add concise TestFlight `What to Test` instructions covering auth, upload, analysis, billing, restore, and deletion.
- [ ] **Patrick:** Install TestFlight on the review iPhone, accept the invitation, and install the candidate.

Exit gate: the exact candidate build is installed from TestFlight on Patrick's physical iPhone.

## Phase 6: Patrick's personal pre-launch review

Use a fresh install first. Record every issue with a screenshot, exact steps, expected result, and actual result.

- [ ] First launch is polished: icon, splash, sign-in copy, safe areas, and no debug or staging UI.
- [ ] Apple sign-in completes; relaunch preserves the session; sign-out returns cleanly to sign-in.
- [ ] Google sign-in completes; relaunch preserves the session; sign-out returns cleanly to sign-in.
- [ ] Photo permission is understandable; denial and later recovery are handled.
- [ ] A valid swing video uploads, progresses, finishes analysis, and remains available after relaunch.
- [ ] Invalid, too-short, too-long, interrupted, and failed uploads show useful recovery paths.
- [ ] A free user receives only the intended teaser and sees the trial action.
- [ ] Paywall shows exactly `$5.99/month`, `$59.99/year`, 7-day trial terms, renewal language, privacy, terms, and restore.
- [ ] Monthly sandbox purchase starts the trial and unlocks the full result without restarting.
- [ ] Annual sandbox purchase is validated using a separate tester.
- [ ] Restore works after sign-out/reinstall and does not grant the wrong account access.
- [ ] Manage Subscription or Customer Center opens and reflects the active plan.
- [ ] Full coaching analysis is readable, specific, and does not make unsafe medical claims.
- [ ] Follow-up chat retains swing context, handles multiple questions, and recovers from network failure.
- [ ] Narrated swing breakdown generates, opens, starts muted, shows captions, and handles failure/retry.
- [ ] Settings legal links open the live pages and support creates a correctly addressed message.
- [ ] Account deletion clearly warns the user, succeeds, signs out, and prevents the old account from returning.
- [ ] Codex verifies deletion across Cognito, DynamoDB, S3, and RevenueCat using backend evidence.
- [ ] Review on a small supported iPhone and the current large iPhone for clipping, keyboard, rotation, and Dynamic Type issues.
- [ ] VoiceOver labels, contrast, touch targets, loading states, and error messages receive a basic accessibility pass.
- [ ] App Store screenshots and listing copy accurately match the candidate build.

Exit gate: no open P0/P1 defects; purchase, restore, analysis, chat, breakdown, and deletion each pass twice.

## Phase 7: Enable gating and run the release regression

- [ ] **Codex:** Fix every launch-blocking issue found in Phase 6 and upload a new build when code changes.
- [ ] **Patrick:** Re-run the affected personal-review steps on the new TestFlight build.
- [ ] **Codex:** Set `SUBSCRIPTION_GATING_ENABLED=true` only after purchase and restore pass.
- [ ] **Together:** Re-test free teaser, purchase unlock, entitled relaunch, expired/canceled state, restore, and backend outage grace.
- [ ] **Codex:** Re-run all automated tests and confirm CloudWatch has no new launch-path errors.

Exit gate: the final build passes with production gating enabled.

## Phase 8: Complete App Store metadata and submit

- [ ] **Patrick:** App Information -> Age Ratings -> answer every question and save the calculated rating.
- [ ] **Patrick:** App Privacy -> declare collected data and third-party practices, add the privacy URL, and publish the answers.
- [ ] **Patrick:** App Information -> Content Rights -> confirm the app has rights to all supplied content.
- [ ] **Patrick:** App Information -> Digital Services Act -> complete trader/non-trader verification for selected storefronts.
- [ ] **Patrick:** Complete the Health & Fitness regulated-medical-device declaration.
- [ ] **Patrick:** Provide App Review contact name, email, and phone number.
- [ ] **Codex:** Set support URL, privacy URL, optional marketing URL, storefront availability, release method, copyright, and final metadata.
- [x] **Codex:** Verify subtitle `AI-powered golf swing coach` and primary category `Sports` in App Store Connect.
- [ ] **Codex:** Write review notes explaining sign-in, the subscription path, sample swing testing, restore, and account deletion.
- [ ] **Together:** Review app name, subtitle, description, keywords, screenshots, prices, trial, and legal text one final time.
- [ ] **Codex:** Select the final build and add both subscriptions to the same review submission as version `1.0`.
- [ ] **Patrick:** App Review -> Draft Submission -> verify every item -> `Submit for Review`.

Exit gate: app version and both subscriptions show `Waiting for Review` or `In Review`.

## Phase 9: Approval and public release

- [ ] **Codex:** Monitor App Store status and relay any App Review message immediately.
- [ ] **Together:** Answer reviewer questions or fix a rejection, upload a new build if required, and resubmit.
- [ ] **Patrick:** After approval, perform the final release action if manual release was selected.
- [ ] **Codex:** Verify the public product page, download the public build, and confirm production sign-in, purchase display, legal links, and support.
- [ ] **Codex:** Monitor CloudWatch, RevenueCat, App Store crashes, support mail, and reviews closely for the first 24 hours and first 7 days.

Final gate: Alki DivotLab is searchable/downloadable in the selected storefronts and the public build passes the launch smoke test.

## Immediate next actions

1. Patrick confirms iPhone-only vs iPhone+iPad, initial storefronts, manual vs automatic release, legal entity/address, governing law, and DSA trader status.
2. Patrick creates the RevenueCat v1 key and runs `aws login` on the Mac.
3. Codex publishes legal pages once hosting access and owner details are available, then fills their EAS and App Store URLs.
4. Codex packages the current launch work into one release PR, deploys account deletion, and builds the TestFlight candidate.
5. Patrick performs the personal review, completes owner declarations, and approves the final submission.
