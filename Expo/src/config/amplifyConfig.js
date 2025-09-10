// AWS Amplify Configuration for Golf Coach App
import { Amplify } from 'aws-amplify';
// Note: @aws-amplify/react-native doesn't export configureAmplify in newer versions

// AUTHENTICATION STATUS: ✅ CONFIGURED AND READY
// 
// Cognito infrastructure has been created and configured:
// - User Pool ID: us-east-1_s9LDheoFF
// - Client ID: 2ngu9n6gdcbab01r89qbjh88ns
// - Identity Pool ID: us-east-1:b04d8bef-ea01-4205-b1a2-11ba771efbb6
// - Domain: golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com
//
// CURRENT STATUS: ✅ Ready for authentication testing

const amplifyConfig = {
  Auth: {
    Cognito: {
      // Cognito configuration - LIVE VALUES
      userPoolId: 'us-east-1_s9LDheoFF', // ✅ Live User Pool ID
      userPoolClientId: '2ngu9n6gdcbab01r89qbjh88ns', // ✅ Live Client ID  
      identityPoolId: 'us-east-1:b04d8bef-ea01-4205-b1a2-11ba771efbb6', // ✅ Live Identity Pool ID
      
      // OAuth configuration for Google Sign-In
      loginWith: {
        oauth: {
          domain: 'golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com', // ✅ Live domain
          scopes: ['email', 'profile', 'openid'],
          redirectSignIn: ['golfcoach://'], // Your app's custom URL scheme
          redirectSignOut: ['golfcoach://logout'],
          responseType: 'code',
          providers: ['Google'], // ✅ Google Sign-In now active
        }
      }
    }
  },
  
  // API Gateway configuration (for authenticated API calls)
  API: {
    REST: {
      golfCoachAPI: {
        endpoint: 'https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod',
        region: 'us-east-1',
      },
    },
  },
};

// Configure Amplify for React Native
export const configureAmplify = () => {
  try {
    console.log('Configuring Amplify with config:', amplifyConfig);
    
    // Configure Amplify with our settings
    Amplify.configure(amplifyConfig);
    console.log('Amplify configured successfully for React Native');
  } catch (error) {
    console.error('Error configuring Amplify:', error);
    throw error;
  }
};

export default amplifyConfig;