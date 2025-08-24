# AWS Cognito Infrastructure Setup Commands

**IMPORTANT**: These commands require Cognito permissions. Run these with an IAM user/role that has `CognitoIdentityProvider` and `CognitoIdentity` full access.

## Step 1: Create User Pool

```bash
aws cognito-idp create-user-pool \
  --pool-name "golf-coach-users" \
  --policies '{
    "PasswordPolicy": {
      "MinimumLength": 8,
      "RequireUppercase": false,
      "RequireLowercase": false,
      "RequireNumbers": false,
      "RequireSymbols": false
    }
  }' \
  --auto-verified-attributes email \
  --username-attributes email \
  --schema '[
    {
      "Name": "email",
      "AttributeDataType": "String",
      "Required": true,
      "Mutable": true
    },
    {
      "Name": "name",
      "AttributeDataType": "String",
      "Required": true,
      "Mutable": true
    },
    {
      "Name": "picture",
      "AttributeDataType": "String",
      "Required": false,
      "Mutable": true
    }
  ]' \
  --region us-east-1
```

**Save the UserPool Id from the response - you'll need it for the next steps.**

## Step 2: Create User Pool Client

```bash
aws cognito-idp create-user-pool-client \
  --user-pool-id YOUR_USER_POOL_ID_HERE \
  --client-name "golf-coach-mobile-app" \
  --generate-secret \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_PASSWORD_AUTH \
  --supported-identity-providers COGNITO Google \
  --callback-urls '[
    "golfcoach://",
    "exp://127.0.0.1:19000/--/",
    "https://auth.expo.io/@your-username/golf-coach"
  ]' \
  --logout-urls '[
    "golfcoach://logout",
    "exp://127.0.0.1:19000/--/logout"
  ]' \
  --allowed-o-auth-flows code \
  --allowed-o-auth-scopes openid email profile \
  --allowed-o-auth-flows-user-pool-client \
  --region us-east-1
```

**Save the ClientId and ClientSecret from the response.**

## Step 3: Create Google Identity Provider

**You'll need your Google OAuth Client ID and Client Secret**

```bash
aws cognito-idp create-identity-provider \
  --user-pool-id YOUR_USER_POOL_ID_HERE \
  --provider-name Google \
  --provider-type Google \
  --provider-details '{
    "client_id": "YOUR_GOOGLE_CLIENT_ID",
    "client_secret": "YOUR_GOOGLE_CLIENT_SECRET",
    "authorize_scopes": "openid email profile"
  }' \
  --attribute-mapping '{
    "email": "email",
    "name": "name", 
    "picture": "picture"
  }' \
  --region us-east-1
```

## Step 4: Create Identity Pool

```bash
aws cognito-identity create-identity-pool \
  --identity-pool-name "golf_coach_identity_pool" \
  --allow-unauthenticated-identities \
  --cognito-identity-providers '[
    {
      "ProviderName": "cognito-idp.us-east-1.amazonaws.com/YOUR_USER_POOL_ID_HERE",
      "ClientId": "YOUR_CLIENT_ID_HERE",
      "ServerSideTokenCheck": true
    }
  ]' \
  --region us-east-1
```

**Save the IdentityPoolId from the response.**

## Step 5: Create IAM Roles for Identity Pool

### Authenticated Role:
```bash
aws iam create-role \
  --role-name Cognito_golf_coach_identity_poolAuth_Role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Federated": "cognito-identity.amazonaws.com"
        },
        "Action": "sts:AssumeRoleWithWebIdentity",
        "Condition": {
          "StringEquals": {
            "cognito-identity.amazonaws.com:aud": "YOUR_IDENTITY_POOL_ID_HERE"
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated"
          }
        }
      }
    ]
  }'

aws iam attach-role-policy \
  --role-name Cognito_golf_coach_identity_poolAuth_Role \
  --policy-arn arn:aws:iam::aws:policy/AmazonAPIGatewayInvokeFullAccess
```

### Unauthenticated Role:
```bash
aws iam create-role \
  --role-name Cognito_golf_coach_identity_poolUnauth_Role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Federated": "cognito-identity.amazonaws.com"
        },
        "Action": "sts:AssumeRoleWithWebIdentity",
        "Condition": {
          "StringEquals": {
            "cognito-identity.amazonaws.com:aud": "YOUR_IDENTITY_POOL_ID_HERE"
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "unauthenticated"
          }
        }
      }
    ]
  }'
```

## Step 6: Set Identity Pool Roles

```bash
aws cognito-identity set-identity-pool-roles \
  --identity-pool-id YOUR_IDENTITY_POOL_ID_HERE \
  --roles '{
    "authenticated": "arn:aws:iam::458252603969:role/Cognito_golf_coach_identity_poolAuth_Role",
    "unauthenticated": "arn:aws:iam::458252603969:role/Cognito_golf_coach_identity_poolUnauth_Role"
  }' \
  --region us-east-1
```

## Step 7: Configure User Pool Domain (Optional)

```bash
aws cognito-idp create-user-pool-domain \
  --domain "golf-coach-auth-$(date +%s)" \
  --user-pool-id YOUR_USER_POOL_ID_HERE \
  --region us-east-1
```

## Environment Variables Needed

After running these commands, you'll need these values for your app:

```bash
# Copy these to your React Native app environment
export USER_POOL_ID="YOUR_USER_POOL_ID_HERE"
export USER_POOL_CLIENT_ID="YOUR_CLIENT_ID_HERE"
export IDENTITY_POOL_ID="YOUR_IDENTITY_POOL_ID_HERE"
export AWS_REGION="us-east-1"
export GOOGLE_CLIENT_ID="YOUR_GOOGLE_CLIENT_ID"
```

## Verification Commands

```bash
# Verify User Pool
aws cognito-idp describe-user-pool --user-pool-id YOUR_USER_POOL_ID_HERE

# Verify Identity Pool  
aws cognito-identity describe-identity-pool --identity-pool-id YOUR_IDENTITY_POOL_ID_HERE

# List Identity Providers
aws cognito-idp list-identity-providers --user-pool-id YOUR_USER_POOL_ID_HERE
```

---

**Next Steps**: Run these commands with appropriate AWS permissions, then proceed with React Native integration.