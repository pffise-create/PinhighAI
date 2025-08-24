# Google OAuth Redirect URI Fix Required

## 🚨 **Critical Issue Found**

Your Google OAuth client is configured with the **wrong redirect URI**.

### Current (Incorrect) Configuration:
```
https://golf-coach-users.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
```

### Required (Correct) Configuration:
```
https://golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
```

## 🔧 **How to Fix This**

### Step 1: Go to Google Cloud Console
1. Open [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **APIs & Services** → **Credentials**
3. Find your OAuth 2.0 Client ID: `422409985106-5dplg2gmqjtd9kcjnrevuqs2guqr89si.apps.googleusercontent.com`

### Step 2: Update Authorized Redirect URIs
**Remove this URI:**
```
https://golf-coach-users.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
```

**Add this URI:**
```
https://golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
```

**Also ensure these mobile redirect URIs are present:**
```
golfcoach://
exp://127.0.0.1:19000/--/
```

### Step 3: Save Changes
Click **Save** in Google Cloud Console

---

## 🔄 **Token Exchange Explained**

### What Happens in OAuth Flow:

1. **User clicks "Sign in with Google"**
   → Opens WebBrowser with Cognito OAuth URL

2. **User authenticates with Google** 
   → Google redirects to Cognito

3. **Cognito processes Google response**
   → Cognito redirects to your app with **authorization code**

4. **Your app receives authorization code**
   ```javascript
   golfcoach://?code=abc123-def456-authorization-code
   ```

5. **Token Exchange** (This is what we implemented)
   ```javascript
   POST https://golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com/oauth2/token
   Body: grant_type=authorization_code&client_id=...&code=abc123&redirect_uri=golfcoach://
   ```

6. **Receive JWT Tokens**
   ```json
   {
     "access_token": "eyJ0eXAiOiJKV1Q...",
     "id_token": "eyJ0eXAiOiJKV1Q...",
     "refresh_token": "eyJ0eXAiOiJKV1Q...",
     "token_type": "Bearer",
     "expires_in": 3600
   }
   ```

7. **Store tokens and authenticate user**

## ✅ **Current Implementation Status**

- ✅ **OAuth Flow**: Opens WebBrowser with correct Cognito URL
- ✅ **Authorization Code**: Properly extracted from callback URL  
- ✅ **Token Exchange**: Implemented with Cognito token endpoint
- ⚠️ **Google Redirect URI**: Needs fix in Google Cloud Console
- ⚠️ **Token Storage**: Basic implementation, could be enhanced

## 🧪 **Testing After Fix**

Once you update the Google OAuth redirect URI:

1. **Start the app** and go to Sign In screen
2. **Click "Continue with Google"** → Should open WebBrowser
3. **Sign in with Google** → Should redirect back to app
4. **Should see "Success"** alert and navigate to Home screen

## 🔐 **Security Notes**

- The **authorization code** is short-lived (usually 10 minutes)
- The **access token** expires (typically 1 hour)  
- The **refresh token** can be used to get new access tokens
- All tokens should be stored securely using Expo SecureStore

---

**After fixing the Google OAuth redirect URI, your Google Sign-In should work end-to-end!** 🚀