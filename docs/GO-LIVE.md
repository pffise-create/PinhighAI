# Alki DivotLab App Store Launch Checklist

Updated 2026-08-08. This is the current launch checklist.

The canonical dependency-ordered release plan is [`APP-STORE-LAUNCH-RUNBOOK.md`](./APP-STORE-LAUNCH-RUNBOOK.md).

## Patrick: next actions

- [x] **Add the RevenueCat v2 agent API key to Mac Keychain.** Stored as `codex-revenuecat-v2`.

- [x] **Choose subscription prices and trial.** Monthly is `$5.99`; annual is `$59.99`; both include a 7-day free trial.
- [ ] **Finish Apple business setup.** App Store Connect -> Business -> Agreements. Accept pending agreements, then complete Tax Forms and Banking until each status is Active.
- [ ] **Create a sandbox purchaser.** App Store Connect -> Users and Access -> Sandbox -> Testers -> +. Use a new email address that has never been an Apple Account.
- [ ] **Review the legal-page decisions.** Confirm the exact legal entity, business mailing address, effective date, governing law/dispute terms, and that `support@divotlab.ai` is the support address. The drafts are in `docs/legal/` and are not safe to publish while those fields remain `TBD`.
- [ ] **Answer owner declarations.** In the app's Distribution pages complete App Privacy, Age Ratings, Content Rights, and Digital Services Act trader status. These are legal/business declarations and should not be guessed by the agent.
- [ ] **Review the App Store listing copy.** Subtitle is `AI-powered golf swing coach`; primary category is Sports; secondary is Health & Fitness. Description, promotional text, and keywords are populated in App Store Connect. Change only if you dislike the positioning.
- [ ] **Review the App Store screenshots.** App Store Connect -> DivotLab -> Distribution -> iOS App. Three 6.9-inch screenshots captured from the running iOS app are uploaded. Confirm the content and order; no action is needed if you approve them.
- [ ] **Point `divotlab.ai` to hosting after legal approval.** The domain is currently parked at Namecheap, so support/privacy URLs cannot be submitted yet.

## Codex: next work

- [x] Use the RevenueCat key to connect and audit the DivotLab project.
- [x] Import the two App Store products and attach them to `DivotLab Unlimited` and the current monthly/yearly packages.
- [x] Add the RevenueCat public SDK key and identifiers to EAS preview and production without committing keys.
- [ ] Add a separate RevenueCat v1 secret API key to AWS for server-side entitlement lookup.
- [x] Deploy the in-app account deletion backend at authenticated `DELETE /api/account` with a least-privilege Lambda role.
- [ ] Device-test account deletion with a disposable user before submission.
- [x] Populate safe App Store metadata: subtitle, categories, description, promotional text, and keywords.
- [ ] Publish the approved legal/support pages, set App Store URLs, and add their EAS environment variables.
- [x] Configure subscription pricing and introductory offers in every App Store territory.
- [x] Capture and upload three running-app screenshots and both subscription review screenshots.
- [ ] Build and submit the first TestFlight build, then run the real-device launch journey.
- [ ] Enable backend subscription gating only after a sandbox purchase and restore pass.

## Completed and verified

- [x] Apple App ID `com.alkigolf.divotlab` has Sign in with Apple enabled.
- [x] Apple Services ID and web authentication were configured for Cognito.
- [x] Sign in with Apple private key was created and added to Cognito.
- [x] Cognito Apple attribute mapping uses Apple `email` -> user pool `email`.
- [x] App Store Connect app exists: `Alki DivotLab`, Apple ID `6799256144`, SKU `ALKIDIVOTLAB_IOS`.
- [x] Bundle ID is consistently `com.alkigolf.divotlab` in Apple and the app.
- [x] RevenueCat custom URL scheme `rc-b91814f453` is registered in Expo config.
- [x] App Store server-to-server notifications use the RevenueCat URL for Production and Sandbox, version V2.
- [x] Subscription group `DivotLab Unlimited` exists with an English localization.
- [x] Monthly product exists: `com.alkigolf.divotlab.monthly`.
- [x] Annual product exists: `com.alkigolf.divotlab.yearly`.
- [x] Both products have English name and description metadata.
- [x] Monthly pricing is `$5.99` in the US with Apple-equalized pricing in all 175 territories.
- [x] Annual pricing is `$59.99` in the US effective 2026-08-10, with Apple-equalized pricing in all 175 territories.
- [x] Both products have a 7-day free trial in all 175 territories and opt into future territories.
- [x] RevenueCat products are attached to the current offering, packages, and `DivotLab Unlimited` entitlement.
- [x] RevenueCat public SDK configuration is installed in EAS preview and production.
- [x] Internal TestFlight group `Internal Testers` exists and is ready for a build and members.
- [x] EAS submit config targets the new App Store Connect app ID.
- [x] Export compliance is declared in the app config with `ITSAppUsesNonExemptEncryption=false`.
- [x] App Store subtitle is `AI-powered golf swing coach`.
- [x] App Store categories are Sports (primary) and Health & Fitness (secondary).
- [x] App Store description, promotional text, and search keywords are populated.
- [x] Three 1320 x 2868 screenshots captured from the running iPhone simulator are uploaded and Apple reports processing `COMPLETE`.
- [x] Monthly and annual subscription review screenshots are uploaded; both products report `READY_TO_SUBMIT`.
- [x] Account deletion backend is deployed; unauthenticated requests are rejected by a Cognito API Gateway authorizer.
- [x] Apple private keys are excluded from Git; the Sign in with Apple key was moved to the private iCloud folder.

## Still blocked until later

- [ ] App Store listing still needs live support/privacy URLs, review contact, and review notes.
- [ ] No build is uploaded yet, so adding testers and device validation remain pending.
- [ ] Purchase, restore, Apple sign-in, Google sign-in, analysis, and account deletion need real-device validation.
