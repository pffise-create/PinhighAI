# Apple Sign In Setup (Cognito Federated OIDC)

Step-by-step guide to enable "Continue with Apple" in the app for **staging**
and then **production**. Assumes the frontend button is already wired (it is —
see `src/screens/SignInScreen.js:182` and the `EXPO_PUBLIC_AUTH_PROVIDERS` env
var).

## Architecture at a glance

The app uses Amplify's `signInWithRedirect({ provider: 'Apple' })`, which sends
the user through the **Cognito hosted UI**. Cognito then redirects to Apple,
Apple authenticates the user, Apple returns to Cognito, Cognito creates/looks
up the user in the user pool and issues a JWT back to the app.

This is the **federated OIDC** pattern, not the native iOS "Sign in with Apple"
sheet. It works with our existing code and requires only configuration — no
new packages, no entitlement changes.

See **App Review risk note** at the bottom before production.

## Information you will collect

Before starting, you'll end up with 4 values that go into Cognito. Save them
in a password manager as you go. They are:

| Value | Where it comes from | Format |
|---|---|---|
| **Apple Team ID** | Apple Developer account → Membership | 10 chars, e.g. `ABCDE12345` |
| **Services ID** | You create it in Apple Developer portal | reverse-DNS, e.g. `com.pinhighai.golfcoach.web` |
| **Key ID** | You create it in Apple Developer portal | 10 chars |
| **Private key (.p8 file)** | Downloaded once at key creation | text file starting `-----BEGIN PRIVATE KEY-----` |

All 4 values are used in **both** staging and prod Cognito user pools. You do
not need separate keys per environment. The same Services ID can have multiple
return URLs listed on it (one for staging Cognito, one for prod).

## Prerequisites

- Admin access to the Apple Developer account that owns bundle ID
  `com.pinhighai.golfcoach`
- Admin access to both Cognito user pools:
  - **Staging**: `us-east-1_gquwrWOYG` (domain: `golf-coach-staging-auth-20260328.auth.us-east-1.amazoncognito.com`)
  - **Prod**: `us-east-1_s9LDheoFF` (domain: `golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com`)
- The Apple Developer Program License Agreement is accepted (we hit and fixed
  this during the Step 2 build).

---

## Part 1: Apple Developer portal

### 1.1 Enable Sign In with Apple on the primary App ID

1. Open **https://developer.apple.com/account**
2. Left nav → **Certificates, Identifiers & Profiles**
3. **Identifiers** section → click the row for your primary App ID
   (`com.pinhighai.golfcoach`)
4. Scroll down the list of capabilities, find **Sign In with Apple**, check
   the box
5. Click **Save** (top right), then **Continue**, then **Save** again on the
   confirmation screen
6. If prompted to regenerate provisioning profiles, say **yes** — EAS will
   pick up the new profile on the next build

### 1.2 Create a Services ID

The Services ID is the "OAuth client ID" Apple uses when a web/federated
flow (not the native iOS sheet) asks Apple to authenticate a user.

1. Same **Identifiers** page → click the blue **(+)** button at the top
2. Select **Services IDs** → **Continue**
3. **Description**: `PinHigh AI Sign In with Apple`
4. **Identifier**: `com.pinhighai.golfcoach.web` *(this becomes your Services ID — copy it)*
5. Click **Continue** → **Register**
6. Back on the **Identifiers** list, **click the Services ID you just created**
7. Check **Sign In with Apple** → click **Configure**
8. In the "Web Authentication Configuration" modal:
   - **Primary App ID**: select `com.pinhighai.golfcoach` from the dropdown
   - **Domains and Subdomains**, add **both**:
     - `golf-coach-staging-auth-20260328.auth.us-east-1.amazoncognito.com`
     - `golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com`
   - **Return URLs**, add **both**:
     - `https://golf-coach-staging-auth-20260328.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
     - `https://golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
9. Click **Next** → **Done** → **Continue** → **Save**

### 1.3 Create a Sign In with Apple private key

1. Same section of the portal → left sidebar → **Keys**
2. Click the blue **(+)** button
3. **Key Name**: `PinHigh AI Sign In with Apple`
4. Check **Sign In with Apple** → click **Configure**
5. **Primary App ID**: `com.pinhighai.golfcoach` → **Save**
6. Click **Continue** → **Register**
7. **DOWNLOAD THE .p8 FILE NOW.** Apple will only let you download it once.
   Save it somewhere safe — ideally your password manager as an attached file,
   or an encrypted secure note.
8. **Copy the Key ID** displayed on the confirmation page (10 chars,
   alphanumeric). You'll need it for Cognito.
9. Click **Done**

### 1.4 Grab your Team ID

1. Top-right of any Apple Developer portal page → click your name / account
   icon → **Membership details** (or left nav → **Membership**)
2. Copy the **Team ID** value (10 chars, alphanumeric)

At this point you should have all 4 values. Proceed to Cognito.

---

## Part 2: AWS Cognito — Staging user pool

### 2.1 Add Apple as a federated identity provider

1. AWS Console → **Cognito** → **User pools** → `golf-coach-users-staging`
2. **Sign-in experience** tab
3. Scroll to **Federated identity provider sign-in** → **Add identity provider**
4. Select **Apple**
5. Fill in:
   - **Services ID**: `com.pinhighai.golfcoach.web`
   - **Team ID**: *your 10-char Team ID*
   - **Key ID**: *your 10-char Key ID*
   - **Private key**: open the `.p8` file in a text editor, paste the **entire
     contents** including the `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----`
     lines
6. **Authorized scopes**: `email name` (space-separated, lowercase)
7. **Map attributes** (expand):
   - Apple `email` → User pool `email`
   - Apple `firstName` → User pool `given_name` *(optional; leave blank if
     you don't ask for it)*
   - Apple `lastName` → User pool `family_name` *(optional)*
8. Click **Add identity provider**

### 2.2 Enable Apple on the app client

1. Same user pool → **App integration** tab
2. Scroll to **App client list** → click the staging app client
   (`golf-coach-mobile-app-staging`, ID `1er8hfk30mbah75rbrbdrfb715`)
3. Scroll to **Login pages** / **Hosted UI** / **Managed login** → **Edit**
4. Under **Identity providers**, check **Sign in with Apple** in addition to
   Cognito + Google
5. Leave callback URLs and OAuth settings unchanged
6. **Save changes**

### 2.3 Update EAS Preview env vars

1. EAS dashboard → your project → **Environment Variables** → **Preview**
2. Edit `EXPO_PUBLIC_AUTH_PROVIDERS`
3. Change value from `Google` to `Google,Apple` (exact format, no spaces
   around the comma, capitalization matters)
4. **Save**

### 2.4 Rebuild and test on device

```
cd ~/GolfCoachExpoFixed
git pull origin main
eas build --profile preview --platform ios
```

When the build installs:

- Sign-in screen should now show **Continue with Apple** above Continue with
  Google
- Tap it → Safari view opens → Apple sign-in page loads
- Sign in with any Apple ID → should redirect back to the app and land in chat

**If it fails**, most common errors and fixes:

| Error | Meaning | Fix |
|---|---|---|
| `invalid_client` on Apple page | Services ID or return URL mismatch | Confirm Services ID in Cognito matches what you created; confirm Apple return URL contains the exact `/oauth2/idpresponse` path |
| `invalid_grant` after Apple login | Clock skew or Key ID wrong | Confirm Key ID in Cognito matches the downloaded .p8 |
| Hosted UI error "User does not exist" | Attribute mapping misconfigured | Confirm `email` attribute is mapped in the Cognito provider config |

---

## Part 3: AWS Cognito — Production user pool

Repeat Part 2 against the prod user pool **before** the soft launch. All 4
values (Team ID, Services ID, Key ID, .p8 contents) are the same as staging —
no new Apple portal work needed because the Services ID already lists both
return URLs.

1. User pool: `us-east-1_s9LDheoFF`
2. Add Apple as federated identity provider with the **same values** used in
   staging
3. Enable Apple on the prod app client (client ID is in
   `src/config/amplifyConfig.js:19` as `2ngu9n6gdcbab01r89qbjh88ns`)
4. EAS → **Production** environment → set `EXPO_PUBLIC_AUTH_PROVIDERS` to
   `Google,Apple`
5. Rebuild the production profile (`eas build --profile production --platform ios`)
6. Test via TestFlight before App Store submission

---

## App Review risk note

**Apple's App Review Guideline 4.8** requires apps that use third-party social
logins (like Google) to **also** offer Sign in with Apple "as an equivalent
option." The interpretation of "equivalent" is ambiguous:

- **Native path**: Use the `expo-apple-authentication` package to present the
  native iOS Sign in with Apple sheet. This is the safest path for App Review —
  no anecdotal rejections. But it requires more code work and a different
  token-exchange flow.
- **Federated OIDC path (what this guide sets up)**: User taps "Continue with
  Apple", gets bounced to Safari for the hosted UI, authenticates on
  `appleid.apple.com`, gets bounced back. Some apps have passed review with
  this; others have been rejected for not using the native sheet.

The federated OIDC approach is what our current code wires. **If App Review
rejects the submission citing guideline 4.8**, the fix is to swap
`signInWithRedirect({ provider: 'Apple' })` for the native
`expo-apple-authentication` flow. That's a scoped code change, not a
rearchitecture — you can plan ~1 day of work for it. The current setup is a
good bet for a first submission and a clean fallback plan if rejected.

Button prominence: Apple requires the Sign in with Apple button to be at
**equal or greater prominence** than other social logins. The current code
renders Apple **above** Google on the sign-in screen (`SignInScreen.js:267`),
which satisfies that rule.

## Related docs

- `docs/launch-env-vars.md` — where `EXPO_PUBLIC_AUTH_PROVIDERS` lives
- `docs/staging-auth-setup-checklist.md` §8 — the launch plan entry that
  points at this doc
- `src/screens/SignInScreen.js:182` — `handleAppleSignIn` implementation
- `src/config/amplifyConfig.js:106` — where `providers` is passed to Amplify
