// AWS Amplify Configuration for Golf Coach App
import { Amplify } from 'aws-amplify';
// Note: @aws-amplify/react-native doesn't export configureAmplify in newer versions
import runtimeEnvConfig, { appEnv, isEnvConfigComplete } from './runtimeEnv';

// AUTHENTICATION STATUS: CONFIGURED AND READY
// 
// Cognito infrastructure has been created and configured:
// - User Pool ID: us-east-1_s9LDheoFF
// - Client ID: 2ngu9n6gdcbab01r89qbjh88ns
// - Identity Pool ID: us-east-1:b04d8bef-ea01-4205-b1a2-11ba771efbb6
// - Domain: golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com
//
// CURRENT STATUS: Ready for authentication testing

const fallbackConfig = {
  cognito: {
    userPoolId: 'us-east-1_s9LDheoFF',
    userPoolClientId: '2ngu9n6gdcbab01r89qbjh88ns',
    identityPoolId: 'us-east-1:b04d8bef-ea01-4205-b1a2-11ba771efbb6',
    domain: 'golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com',
    providers: ['Google'],
    redirectSignIn: ['golfcoach://'],
    redirectSignOut: ['golfcoach://logout'],
  },
  api: {
    baseUrl: 'https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod',
    region: 'us-east-1',
  },
};

function getResolvedConfig() {
  const envConfigComplete = isEnvConfigComplete();
  const useFallback = appEnv === 'dev' && !envConfigComplete;

  if (!useFallback && !envConfigComplete) {
    throw new Error(
      `Missing EXPO_PUBLIC_* config for app env "${appEnv}". Refusing partial fallback in non-dev environments.`
    );
  }

  const resolvedCognito = useFallback
    ? fallbackConfig.cognito
    : {
        userPoolId: runtimeEnvConfig.cognito.userPoolId,
        userPoolClientId: runtimeEnvConfig.cognito.userPoolClientId,
        identityPoolId: runtimeEnvConfig.cognito.identityPoolId,
        domain: runtimeEnvConfig.cognito.domain,
        providers: runtimeEnvConfig.authProviders?.length
          ? runtimeEnvConfig.authProviders
          : fallbackConfig.cognito.providers,
        redirectSignIn: runtimeEnvConfig.cognito.redirectSignIn,
        redirectSignOut: runtimeEnvConfig.cognito.redirectSignOut,
      };

  const resolvedApi = useFallback
    ? fallbackConfig.api
    : {
        baseUrl: runtimeEnvConfig.api.baseUrl,
        region: fallbackConfig.api.region,
      };

  return { resolvedCognito, resolvedApi, envConfigComplete, useFallback };
}

const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: '',
      userPoolClientId: '',
      loginWith: {
        oauth: {
          domain: '',
          scopes: ['email', 'profile', 'openid'],
          redirectSignIn: [],
          redirectSignOut: [],
          responseType: 'code',
          providers: ['Google'],
        },
      },
    },
  },
  API: {
    REST: {
      golfCoachAPI: {
        endpoint: '',
        region: 'us-east-1',
      },
    },
  },
};

// Configure Amplify for React Native
export const configureAmplify = () => {
  try {
    const { resolvedCognito, resolvedApi, envConfigComplete, useFallback } = getResolvedConfig();
    amplifyConfig.Auth.Cognito.userPoolId = resolvedCognito.userPoolId;
    amplifyConfig.Auth.Cognito.userPoolClientId = resolvedCognito.userPoolClientId;
    // The app calls our backend with Cognito JWTs, not direct AWS credentials.
    // Avoid configuring identityPoolId here so token reads cannot fail because
    // Cognito Identity/IAM role mapping is temporarily misconfigured.
    amplifyConfig.Auth.Cognito.loginWith.oauth.domain = resolvedCognito.domain;
    amplifyConfig.Auth.Cognito.loginWith.oauth.redirectSignIn = resolvedCognito.redirectSignIn;
    amplifyConfig.Auth.Cognito.loginWith.oauth.redirectSignOut = resolvedCognito.redirectSignOut;
    amplifyConfig.Auth.Cognito.loginWith.oauth.providers = resolvedCognito.providers;
    amplifyConfig.API.REST.golfCoachAPI.endpoint = resolvedApi.baseUrl;
    amplifyConfig.API.REST.golfCoachAPI.region = resolvedApi.region;

    console.log('Configuring Amplify', {
      appEnv,
      envConfigComplete,
      usingFallback: useFallback,
      authProviders: resolvedCognito.providers,
      apiEndpoint: resolvedApi.baseUrl,
    });
    if (useFallback) {
      console.warn(
        'Amplify config is using dev fallback values. Set EXPO_PUBLIC_* env vars for explicit dev/staging/prod configuration.'
      );
    }
    
    // Configure Amplify with our settings
    Amplify.configure(amplifyConfig);
    console.log('Amplify configured successfully for React Native');
  } catch (error) {
    console.error('Error configuring Amplify:', error);
    throw error;
  }
};

export default amplifyConfig;
