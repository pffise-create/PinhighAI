// RevenueCat configuration derived from EXPO_PUBLIC_* variables.
//
// Consumed by src/context/SubscriptionContext.js. Values come from:
//   - local .env files for dev (see .env.staging.example as the template)
//   - EAS build profiles for dev/preview/production (see eas.json)
//
// EXPO_PUBLIC_* values are baked into the client bundle at build time and are
// considered public — the RevenueCat public API key is the only secret that
// belongs here, and it is designed to be shipped to clients.

const readString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const REVENUECAT_API_KEY = readString(process.env.EXPO_PUBLIC_REVENUECAT_API_KEY);

export const REVENUECAT_ENTITLEMENT_ID =
  readString(process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID) || 'DivotLab Unlimited';

// Optional — when set, SubscriptionContext will present that specific offering
// instead of the project default. Leave empty to use RevenueCat's `current`.
export const REVENUECAT_OFFERING_ID = readString(process.env.EXPO_PUBLIC_REVENUECAT_OFFERING_ID);

export const REVENUECAT_PRODUCT_IDS = {
  monthly:
    readString(process.env.EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID) || 'monthly',
  yearly:
    readString(process.env.EXPO_PUBLIC_REVENUECAT_YEARLY_PRODUCT_ID) || 'yearly',
};
