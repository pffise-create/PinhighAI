# API Gateway Authentication Configuration

## Overview
This document outlines how to configure API Gateway to handle both authenticated and guest users while maintaining backward compatibility.

## Current Status
- ✅ Lambda function now extracts and validates JWT tokens
- ✅ Lambda function handles both authenticated and guest users gracefully
- ⚠️ API Gateway configuration needs updating to optionally require authentication

## Configuration Strategy

### 1. Authentication Approach
**Optional Authentication**: Allow both authenticated and guest users to access endpoints
- Authenticated users get enhanced features (user tracking, personalized coaching)
- Guest users continue to work without authentication (backward compatibility)
- Lambda function extracts user context and handles both cases

### 2. API Gateway Authorizer Setup

#### Create Cognito Authorizer
```bash
# Create the Cognito authorizer for API Gateway
aws apigateway create-authorizer \
  --rest-api-id YOUR_API_GATEWAY_ID \
  --name golf-coach-cognito-auth \
  --type COGNITO_USER_POOLS \
  --provider-arns arn:aws:cognito-idp:us-east-1:YOUR_ACCOUNT_ID:userpool/YOUR_USER_POOL_ID \
  --auth-type REQUEST \
  --identity-source method.request.header.Authorization
```

#### Configure Methods (Optional Authorization)
For each method that should support optional authentication:

```bash
# Update method to use optional authorization
aws apigateway update-method \
  --rest-api-id YOUR_API_GATEWAY_ID \
  --resource-id YOUR_RESOURCE_ID \
  --http-method POST \
  --patch-ops op=replace,path=/authorizationType,value=NONE
```

**Note**: We're keeping authorization as NONE because our Lambda function handles JWT validation internally, allowing for optional authentication.

### 3. Environment Variables for Lambda

Add these environment variables to your Lambda function:

```bash
# Set Cognito environment variables for Lambda
aws lambda update-function-configuration \
  --function-name your-lambda-function-name \
  --environment Variables='{
    "COGNITO_USER_POOL_ID": "us-east-1_XXXXXXXXX",
    "COGNITO_REGION": "us-east-1",
    "DYNAMODB_TABLE": "golf-coach-analyses"
  }'
```

### 4. Testing Authentication

#### Test Authenticated Request
```bash
# Test with valid JWT token
curl -X POST https://your-api-gateway-url/prod/api/analysis \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"s3Key": "test-video.mp4", "bucketName": "your-bucket"}'
```

#### Test Guest Request  
```bash
# Test without authentication (guest mode)
curl -X POST https://your-api-gateway-url/prod/api/analysis \
  -H "Content-Type: application/json" \
  -d '{"s3Key": "test-video.mp4", "bucketName": "your-bucket"}'
```

### 5. User Data Isolation

#### DynamoDB Structure
With authentication, each record now includes:
```json
{
  "analysis_id": "analysis-123",
  "user_id": "cognito-user-id-or-guest-user",
  "user_email": "user@example.com",
  "user_name": "John Doe", 
  "user_type": "authenticated|guest",
  "is_authenticated": true,
  "status": "COMPLETED",
  "ai_analysis": "...",
  "created_at": "2025-08-21T10:00:00Z"
}
```

#### Data Access Patterns
- **Authenticated users**: Can access their own analyses using user_id filter
- **Guest users**: Use session-based access (current implementation)
- **Admin access**: Can access all records for support/analytics

### 6. Rate Limiting by User Type

Current Lambda implementation includes:
- **Authenticated users**: 10 requests per hour per user
- **Guest users**: Shared rate limit for 'guest-user' ID
- **Enhanced users**: Future premium tier with higher limits

### 7. Migration Strategy

#### Phase 1: Backward Compatible (Current)
- All endpoints work without authentication
- JWT tokens are processed if provided
- Guest users continue working normally

#### Phase 2: Enhanced Features
- Authenticated users get coaching history
- Personalized coaching recommendations
- Progress tracking and analytics

#### Phase 3: Optional Enforcement (Future)
- Option to require authentication for new features
- Legacy endpoints remain open for backward compatibility

## Implementation Checklist

- ✅ Lambda function updated to handle JWT tokens
- ✅ User context extraction and validation
- ✅ DynamoDB schema updated for user data
- ✅ Rate limiting by user type
- ⚠️ API Gateway environment variables setup needed
- ⚠️ Deploy updated Lambda function
- ⚠️ Test authentication flow end-to-end

## Deployment Steps

1. **Update Lambda Environment Variables**
   ```bash
   aws lambda update-function-configuration \
     --function-name golf-coach-ai-analysis \
     --environment Variables='{"COGNITO_USER_POOL_ID":"YOUR_POOL_ID","COGNITO_REGION":"us-east-1"}'
   ```

2. **Deploy Updated Lambda Code**
   ```bash
   cd AWS
   zip -r deployment.zip . -x '*.zip' 'node_modules/.cache/*'
   aws lambda update-function-code \
     --function-name golf-coach-ai-analysis \
     --zip-file fileb://deployment.zip
   ```

3. **Test Both Authentication Modes**
   - Test guest user flow (no auth header)
   - Test authenticated user flow (with JWT token)
   - Verify user data is properly stored

## Security Considerations

1. **Token Validation**: JWT tokens are properly verified against Cognito JWKS
2. **User Isolation**: Each user's data is tagged with their unique user_id
3. **Rate Limiting**: Per-user rate limiting prevents abuse
4. **Graceful Degradation**: Invalid tokens fall back to guest mode
5. **CORS**: Appropriate CORS headers for client applications

## Monitoring and Logging

The Lambda function logs:
- Authentication success/failure
- User context extraction
- Rate limiting decisions
- User data access patterns

CloudWatch metrics track:
- Authenticated vs guest requests
- Token validation success rate
- User adoption metrics