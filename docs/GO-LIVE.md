# Go-Live: the shortest path to a live app

**Written 2026-08-07.** Everything code-side is done and deployed. What remains is
almost entirely account setup only you can do. Ordered by dependency — later steps
are blocked by earlier ones.

## Status: code is ready

| Area | State |
|---|---|
| Backend (4 lambdas) | Deployed from main, smoke-tested |
| Coaching model | gpt-5.6-terra, analysis + chat (1.9x faster than before, better voice) |
| Coaching memory | swingMemory live — beat the old context 170-125 |
| Paywall gating | Built + deployed, **inert** until `SUBSCRIPTION_GATING_ENABLED=true` |
| Frame extraction | Event-anchored (won a blind bake-off 22-0) |
| Swing markings | Built, evaluated, **flags off** — NOT required for launch |
| App identity | `com.alkigolf.divotlab`, Alki DivotLab branding, iOS scheme + permissions fixed |
| Tests | 121 JS + 11 Python green |

## The critical path — 9 human steps

### 1. Apple Developer portal  ~30 min
- Create a **Services ID** for Sign in with Apple.
- Create a **private key (.p8)**; record the key ID and your team ID.
- (Apple sign-in is required by App Review for any app offering third-party sign-in.)

### 2. Cognito — Apple OIDC  ~20 min  *(blocked by 1)*
- Add Apple as an OIDC identity provider on the **prod** user pool (`us-east-1_s9LDheoFF`), using the team ID / Services ID / key ID / .p8 from step 1.
- Confirm Hosted UI callback URLs are exactly `golfcoach://` and `golfcoach://logout`.
- Repeat on staging (`us-east-1_gquwrWOYG`) if you want beta parity.

### 3. RevenueCat dashboard  ~30 min
- Entitlement named `DivotLab Unlimited` (or change `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID` to match).
- Offering containing the monthly + yearly packages.
- 7-day free trial on both products.
- Copy the **secret** key (`sk_...`).

### 4. App Store Connect  ~1-2 h
- App record using bundle ID **`com.alkigolf.divotlab`** (this is permanent after first upload).
- Two auto-renewable subscriptions matching `EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID` / `..._YEARLY_...` (defaults `monthly` / `yearly`).
- Attach the 7-day introductory offer to each.
- Create **sandbox testers** for purchase validation.
- Business entity, banking, tax — this is the long pole; start it first if it isn't done.

### 5. Host the legal docs  ~20 min
- `docs/legal/privacy-policy.md` and `docs/legal/terms-of-service.md` are written and branded. Host them anywhere stable (GitHub Pages is fine).
- Confirm `support@divotlab.ai` receives mail, or pick an Alki address.

### 6. Set environment variables  ~20 min  *(blocked by 1-5)*
**EAS `production` environment** — see `docs/launch-env-vars.md`:
- 6 Cognito vars, `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_REVENUECAT_API_KEY`
- `EXPO_PUBLIC_AUTH_PROVIDERS="Google,Apple"`
- `EXPO_PUBLIC_PRIVACY_POLICY_URL`, `EXPO_PUBLIC_TERMS_URL`

**Lambdas** (`golf-chat-api-handler` + `golf-results-api-handler`):
- `REVENUECAT_SECRET_API_KEY=sk_...`  ← this is what unlocks purchases server-side
- Leave `SUBSCRIPTION_GATING_ENABLED` OFF until step 8.

### 7. Build + device validation  ~1 h  *(blocked by 6)*
- `eas build --profile production --platform ios`
- On a real device: Google sign-in round-trip, Apple sign-in round-trip, upload a swing, get an analysis, ask a follow-up.
- **This is the first real test of several things** — no signed-in user has exercised the new chat memory or the terra chat model end to end.

### 8. Turn the paywall on  ~5 min  *(blocked by 7)*
- Validate a **sandbox purchase** first.
- Then set `SUBSCRIPTION_GATING_ENABLED=true` on both lambdas. Until this moment every user gets full access.

### 9. TestFlight -> soft launch
- Ship the validated build to TestFlight, invite testers, watch crash reports.
- Promote when the first-run and billing paths are reliable.

## Deliberately NOT required for launch
- Swing markings (both modes) — flags off, no user impact.
- Retroactive marking backfill.
- RevenueCat webhook — server-side lookup already unlocks purchases.

## Known risks to watch on first real traffic
- Chat memory + terra chat model have never run with a real signed-in user (no JWT available in dev). Watch CloudWatch for `SWING_MEMORY` and `CHAT_COMPLETION_TRUNCATED`.
- Ungated uploads cost a gpt-5.6-terra analysis each (~$0.047). Cap uploads if beta shows abuse.
- Cost/user/month at 3 videos + 15 chats: ~$0.18-0.44 depending on model mix. Margin at $10/mo is 95%+.
