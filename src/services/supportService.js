import { Linking, Platform } from 'react-native';

export const DEFAULT_SUPPORT_EMAIL = 'support@divotlab.ai';

const readEnv = (value) => (typeof value === 'string' ? value.trim() : '');

export const SUPPORT_EMAIL_ADDRESS =
  readEnv(process.env.EXPO_PUBLIC_SUPPORT_EMAIL) || DEFAULT_SUPPORT_EMAIL;

const encodeMailtoValue = (value) => encodeURIComponent(value || '').replace(/%20/g, '+');

export const buildSupportEmail = ({
  category = 'General question',
  message,
  user,
  appEnv,
  revenueCatUserId,
  entitlementActive,
  platform = Platform.OS,
}) => {
  const trimmedMessage = String(message || '').trim();
  const normalizedCategory = String(category || 'General question').trim();
  const subject = `Alki DivotLab Support: ${normalizedCategory}`;
  const body = [
    trimmedMessage,
    '',
    '---',
    'Support context',
    `User email: ${user?.email || 'unknown'}`,
    `User id: ${user?.id || 'unknown'}`,
    `Environment: ${appEnv || 'unknown'}`,
    `Platform: ${platform || 'unknown'}`,
    `RevenueCat user: ${revenueCatUserId || 'unknown'}`,
    `Entitlement active: ${entitlementActive ? 'yes' : 'no'}`,
  ].join('\n');

  return {
    to: SUPPORT_EMAIL_ADDRESS,
    subject,
    body,
    url: `mailto:${SUPPORT_EMAIL_ADDRESS}?subject=${encodeMailtoValue(subject)}&body=${encodeMailtoValue(body)}`,
  };
};

export const openSupportEmail = async (supportRequest) => {
  const email = buildSupportEmail(supportRequest);
  await Linking.openURL(email.url);
  return email;
};
