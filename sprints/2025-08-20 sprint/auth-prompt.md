CONTEXT: You are implementing user authentication for a golf coaching app using AWS Cognito with Google Sign-In and React Native (Expo). The user has already set up Google OAuth credentials and needs the complete authentication infrastructure.

CURRENT SYSTEM:
- React Native app with Expo
- AWS backend: Lambda functions, DynamoDB, API Gateway
- API Gateway: https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod
- Region: us-east-1, Account: 458252603969
- Google OAuth client configured (client ID and secret available)

IMPLEMENTATION REQUIREMENTS:

1. AWS COGNITO INFRASTRUCTURE SETUP:
   - Create User Pool with Google as identity provider
   - Create User Pool Client for mobile app
   - Create Identity Pool for AWS credentials
   - Configure hosted UI for authentication
   - Set up proper IAM roles and policies

2. REACT NATIVE AUTHENTICATION INTEGRATION:
   - Install and configure AWS Amplify Auth
   - Implement Google Sign-In flow
   - Create authentication screens (Sign In, Profile)
   - Add authentication state management
   - Integrate with existing navigation flow

3. BACKEND USER CONTEXT INTEGRATION:
   - Update Lambda functions to extract user ID from Cognito tokens
   - Modify DynamoDB operations to include user context
   - Update API Gateway to require authentication
   - Implement user-specific data isolation

4. USER DATA STRUCTURE:
   - Design user profile storage in DynamoDB
   - Link swing analyses to authenticated users
   - Prepare for coaching conversation history per user
   - Handle user onboarding and profile setup

SECURITY REQUIREMENTS:
- Secure token validation in Lambda functions
- User data isolation (users can only access their own data)
- Proper CORS configuration for mobile app
- Error handling that doesn't leak user information

TECHNICAL CONSTRAINTS:
- Use Expo managed workflow (no ejecting)
- Maintain compatibility with existing Lambda functions
- Keep API Gateway endpoints unchanged where possible
- Implement incremental rollout capability

AWS CLI ACCESS: Assume AWS CLI is configured with proper permissions
GOOGLE OAUTH: Client ID and secret are available for configuration

DELIVERABLES:
1. Complete AWS Cognito setup (CLI commands and configuration)
2. React Native authentication implementation with screens
3. Updated Lambda functions with user context
4. User profile and data structure design
5. Testing procedures for authentication flow
6. Documentation for environment variables and configuration

SUCCESS CRITERIA:
- Users can sign in with Google and access personalized content
- All swing analyses are linked to authenticated users
- Backend properly validates user tokens and enforces data isolation
- Authentication state persists across app sessions
- Smooth user experience with proper loading and error states

Please provide step-by-step implementation starting with AWS infrastructure setup, then mobile app integration, then backend updates.