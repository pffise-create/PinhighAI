# Alki DivotLab App Store Launch Runbook

Verified 2026-08-26. This is the dependency-ordered plan from the current state to a publicly downloadable App Store release.

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
- [x] Production and preview EAS have the verified auth, API, RevenueCat, support, privacy, and terms values with no duplicate RevenueCat overrides.
- [x] App Store support URL, privacy URL, marketing URL, copyright, manual release mode, App Review contact, and review notes are complete.
- [ ] App Store age rating, content rights, app privacy, medical-device declaration, DSA declaration, reviewer credentials, and United States-only availability remain incomplete.
- [x] Launch work is committed on draft PR `#13`; both GitHub CI jobs pass. The PR is not yet merged to `main`.
- [x] `divotlab.ai`, `/privacy/`, and `/terms/` are deployed from GitHub Pages and contain the approved business/support details.
- [ ] GitHub is still provisioning the `divotlab.ai` TLS certificate, so HTTPS enforcement and final external URL verification remain pending.
- [ ] RevenueCat v1 server key is missing, the AWS session needs login, and subscription gating remains off.
- [x] Account-deletion code now deletes the RevenueCat customer before app-owned data; focused and full backend tests pass. Deployment still requires the server key and AWS login.
- [x] Release commit `c5483ab` sets iPhone-only support and iOS build number `2`; 112 app tests, 145 backend tests, hygiene, Playwright, and the production iOS export pass from a clean checkout.
- [ ] The production EAS build is blocked only by one-time Apple distribution-credential validation using Patrick's Apple ID and 2FA.

## Phase 1: Lock release decisions

- [x] **Patrick:** Confirm device scope: iPhone-only for `1.0`.
- [x] **Patrick:** Confirm storefront scope: United States only for the first release.
- [x] **Patrick:** Confirm release control: manual release after approval.
- [x] **Patrick:** Confirm seller/legal entity: `Alki Golf LLC`, using its verified principal address.
- [x] **Patrick:** Confirm DSA status for `1.0`: not acting as a trader on the App Store while DivotLab is distributed only outside the EU. Reassess before enabling any EU storefront.
- [x] **Patrick:** Confirm email setup: one Google Workspace account at `pat@divotlab.ai`; `support@divotlab.ai` forwards to it and is available as a Gmail send-as address.

Exit gate: device scope, storefronts, release method, and seller identity are written down.

## Phase 2: Make one releasable source revision

- [x] **Codex:** Reconcile the launch work, exclude local/generated artifacts, and preserve all intended changes in commit `eb07753`.
- [x] **Codex:** Close PRs `#1`-`#3` as superseded by consolidated launch PR `#13`.
- [x] **Codex:** Fix account deletion so RevenueCat customer data is deleted or appropriately anonymized along with app-owned data.
- [x] **Codex:** Apply the Phase 1 device-support decision in `app.json` and increment iOS build number to `2`.
- [x] **Codex:** Run app tests, backend tests, Playwright, iOS export, hygiene checks, and GitHub CI.
- [x] **Codex:** Commit, push, and open consolidated draft release PR `#13`.
- [ ] **Together:** Review and merge PR `#13`, then tag the release-candidate commit.

Exit gate: clean `main`, green CI, and a known release-candidate commit.

## Phase 3: Finish business, legal, and public URLs

- [x] **Patrick:** App Store Connect -> Business -> Agreements. Open Paid Apps and make its status `Active`.
- [x] **Patrick:** Business -> Agreements -> Tax Forms. Submit every requested form and resolve missing information.
- [x] **Patrick:** Business -> Agreements -> Banking. Add and verify the payout account.
- [x] **Patrick:** Submit the Washington formation filing for `Alki Golf LLC`.
- [ ] **Patrick:** After state approval, obtain the LLC EIN, register the `DivotLab` trade name, and request a D-U-N-S number using the verified principal address.
- [ ] **Patrick:** After D-U-N-S synchronization, request conversion of the Apple Developer membership from individual to organization.
- [ ] **Patrick:** After Apple approves the conversion, update and re-verify App Store agreements, tax, and banking information for `Alki Golf LLC` if Apple requests it.
- [x] **Patrick:** Confirm legal details: `Alki Golf LLC`; 522 W Riverside Ave, Ste N, Spokane, WA 99201; effective August 15, 2026; Washington law; Spokane County/Eastern District of Washington venue.
- [ ] **Patrick:** Open [Google Workspace](https://workspace.google.com/) -> Get started -> choose Business Starter -> select one user -> choose `Use a domain you already own` -> enter `divotlab.ai`.
- [ ] **Patrick:** Create the first Workspace administrator as `pat@divotlab.ai`. Store its password in a password manager and add `pffise@gmail.com` as its recovery email.
- [ ] **Patrick:** Copy the domain-verification TXT value supplied by Google. In Namecheap: Domain List -> `divotlab.ai` -> Manage -> Advanced DNS -> Host Records -> Add New Record -> TXT Record. Set Host to `@`, paste Google's value, set TTL to Automatic, and save.
- [ ] **Patrick:** Return to Google's setup wizard and click Verify. Do not continue until Google confirms ownership.
- [ ] **Patrick:** In Namecheap: Advanced DNS -> Mail Settings -> Custom MX. Remove existing Namecheap/private-email MX records, then add Host `@`, mail server `smtp.google.com`, priority `1`, TTL Automatic. Do not remove the GitHub Pages A records or the `www` CNAME.
- [ ] **Patrick:** Return to Google Admin -> Account -> Domains -> Manage domains -> Activate Gmail, then wait until Gmail reports active.
- [ ] **Patrick:** In [Google Admin](https://admin.google.com/): Directory -> Users -> Patrick -> Add Alternate Emails -> Alternate email -> enter `support` -> Save. This routes `support@divotlab.ai` into the `pat@divotlab.ai` inbox without a second paid user.
- [ ] **Patrick:** Sign in to [Gmail](https://mail.google.com/) as `pat@divotlab.ai` -> Settings -> See all settings -> Accounts and Import -> Send mail as -> Add another email address -> add `support@divotlab.ai` -> complete verification.
- [ ] **Patrick:** In the same Gmail section, select `Reply from the same address the message was sent to` so support replies use `support@divotlab.ai`.
- [ ] **Patrick:** Google Admin -> Security -> Authentication -> 2-Step Verification -> allow/enforce it, then enroll `pat@divotlab.ai`.
- [ ] **Patrick:** Google Admin -> Apps -> Google Workspace -> Gmail -> Authenticate email -> generate the DKIM record. Add Google's exact DKIM TXT record in Namecheap, start authentication in Google Admin, and add the SPF/DMARC records Google recommends. Do not create a second SPF record; update the existing one if present.
- [ ] **Patrick:** From `pffise@gmail.com`, send separate tests to `pat@divotlab.ai` and `support@divotlab.ai`. Reply from each address in Workspace Gmail and confirm both replies reach `pffise@gmail.com` without a spam warning.
- [ ] **Patrick:** Confirm whether the app is a regulated medical device. Expected answer is no, but this is an owner declaration.
- [x] **Codex:** Finalize the privacy policy and terms using the confirmed business details.
- [x] **Codex:** Build responsive `/privacy/` and `/terms/` website pages and link them from the marketing-site footer.
- [x] **Codex:** Publish the marketing, privacy, and terms pages on `divotlab.ai`; verified page content is being served from commit `ca36369`.
- [ ] **Codex:** Enable HTTPS after GitHub finishes issuing the custom-domain certificate, then verify every public URL without bypassing TLS validation.
- [ ] **Patrick:** Finish the Workspace mailbox setup above; **Codex:** then verify the support mailbox from outside the developer account.

Exit gate: Paid Apps is active and all legal/support URLs are live.

## Phase 4: Complete configuration and billing enforcement

- [x] **Codex:** Remove duplicate preview EAS variables and retain the production RevenueCat key and full product IDs.
- [x] **Codex:** Add verified production EAS values for Cognito, redirects, auth providers, API base URL, RevenueCat, and support email.
- [x] **Codex:** Add production and preview privacy, terms, and support values after publishing the legal pages.
- [ ] **Patrick:** RevenueCat -> Project Settings -> API Keys -> create a secret v1 key with read access to customers/subscribers. Store it in Mac Keychain; never paste it into chat or Git.
- [ ] **Patrick:** Run `aws login` on the Mac when prompted so Codex can update Lambda configuration.
- [ ] **Codex:** Add `REVENUECAT_SECRET_API_KEY` to the chat and results Lambdas while leaving `SUBSCRIPTION_GATING_ENABLED=false`.
- [ ] **Codex:** Verify live entitlement lookup and account-deletion cleanup with disposable users.
- [x] **Patrick:** Confirm at least one sandbox purchaser exists.
- [ ] **Patrick:** Optional but recommended: create a second sandbox purchaser for a clean annual-plan test while the first account tests monthly and restore.

Exit gate: production configuration is complete, backend entitlement lookup works, and sandbox accounts exist.

## Phase 5: Build and start TestFlight

- [x] **Codex:** Increment the iOS build number and pass every production build gate from release commit `c5483ab`.
- [ ] **Patrick:** On the Mac, open Terminal, go to the project, run `eas build --platform ios --profile production`, answer `Yes` to Apple login, sign in as `pffise@gmail.com`, and approve Apple 2FA. Let the command finish; this validates/creates the distribution certificate and provisioning profile.
- [ ] **Codex:** Immediately rerun the production EAS build from release commit `c5483ab` after Apple credentials are validated.
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
- [ ] **Patrick:** App Information -> Digital Services Act -> select non-trader for DivotLab while it remains United States-only. Reassess and complete trader verification before adding EU storefronts.
- [ ] **Patrick:** Complete the Health & Fitness regulated-medical-device declaration.
- [x] **Patrick:** Provide App Review contact: Patrick Fise, `pffise@gmail.com`, `410-493-0404`.
- [ ] **Patrick:** Create a stable reviewer login (recommended username: `appreview@divotlab.ai`) using a sign-in method the production app supports. Put its password only in App Review Information, not Git or chat.
- [x] **Codex:** Set support URL, privacy URL, marketing URL, manual release mode, copyright, and final editable metadata.
- [ ] **Patrick:** App Store Connect -> DivotLab -> Distribution -> Pricing and Availability -> App Availability -> choose `United States` only -> Save.
- [x] **Codex:** Verify subtitle `AI-powered golf swing coach` and primary category `Sports` in App Store Connect.
- [x] **Codex:** Create App Review details and notes explaining sign-in, subscriptions/trial, swing testing, restore, and account deletion.
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

1. **Patrick:** Validate Apple build credentials: in Terminal run `cd /Users/patrickfise/Documents/ReactNativeProjects/GolfCoachExpoFixed`, then `eas build --platform ios --profile production`. Choose Apple login, use `pffise@gmail.com`, and approve 2FA. Tell Codex when the build starts or finishes.
2. **Patrick:** Create the RevenueCat v1 secret key: RevenueCat -> DivotLab -> Project settings -> API keys -> Secret API keys -> New. Give it read/write customer access. In macOS Keychain Access choose File -> New Password Item, name it `REVENUECAT_SECRET_API_KEY`, use account `patrickfise`, and paste the key as the password. Do not send the key in chat. Then run `aws login` in Terminal and finish the browser sign-in.
3. **Patrick:** Complete Google Workspace using the Phase 3 steps, including `pat@divotlab.ai`, the `support@divotlab.ai` alias/send-as address, 2FA, DKIM, and external mail tests.
4. **Patrick:** Complete the App Store owner declarations: age rating, app privacy, content rights, DSA non-trader, and regulated-medical-device `No`; set availability to United States only; create the reviewer account and enter its credentials only in App Review Information.
5. **Codex:** After steps 1-2, upload build `2`, configure TestFlight, deploy and test RevenueCat enforcement/account deletion, enable gating after purchase/restore pass, attach the build and subscriptions, and prepare the draft submission.
6. **Patrick:** Install the TestFlight candidate, perform Phase 6, review the final listing, submit for review, and manually release after approval.

The LLC EIN, trade-name registration, D-U-N-S request, and Apple organization-account conversion can continue in parallel; they do not need to delay this individual-account `1.0` submission.
