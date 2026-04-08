// Runtime environment configuration derived from EXPO_PUBLIC_* variables.
//
// Consumed by src/config/amplifyConfig.js. Values come from:
//   - local .env files for dev (see .env.staging.example as the template)
//   - EAS build profiles for dev/preview/production (see eas.json)
//
// EXPO_PUBLIC_* values are baked into the client bundle at build time and are
// considered public — never put secrets here.

const DEFAULT_APP_ENV = 'dev';

const readString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const readList = (value) => {
  const raw = readString(value);
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const appEnv = readString(process.env.EXPO_PUBLIC_APP_ENV) || DEFAULT_APP_ENV;

const cognito = {
  userPoolId: readString(process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID),
  userPoolClientId: readString(process.env.EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID),
  identityPoolId: readString(process.env.EXPO_PUBLIC_COGNITO_IDENTITY_POOL_ID),
  domain: readString(process.env.EXPO_PUBLIC_COGNITO_DOMAIN),
  redirectSignIn: readList(process.env.EXPO_PUBLIC_AUTH_REDIRECT_SIGN_IN),
  redirectSignOut: readList(process.env.EXPO_PUBLIC_AUTH_REDIRECT_SIGN_OUT),
};

const api = {
  baseUrl: readString(process.env.EXPO_PUBLIC_API_BASE_URL),
};

export const authProviders = readList(process.env.EXPO_PUBLIC_AUTH_PROVIDERS);

// Minimum set of variables required to configure Amplify for staging/prod.
// Identity pool is intentionally not required here — amplifyConfig.js does not
// wire identityPoolId into Amplify.Auth, so a missing value should not block
// the sign-in flow.
const REQUIRED_COGNITO_FIELDS = [
  cognito.userPoolId,
  cognito.userPoolClientId,
  cognito.domain,
];

export const isEnvConfigComplete = () => {
  if (!api.baseUrl) return false;
  if (REQUIRED_COGNITO_FIELDS.some((field) => !field)) return false;
  if (cognito.redirectSignIn.length === 0) return false;
  if (cognito.redirectSignOut.length === 0) return false;
  return true;
};

const runtimeEnvConfig = {
  appEnv,
  cognito,
  api,
  authProviders,
};

export default runtimeEnvConfig;
