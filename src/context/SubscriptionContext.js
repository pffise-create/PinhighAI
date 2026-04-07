import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Purchases from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

import { useAuth } from './AuthContext';
import {
  REVENUECAT_API_KEY,
  REVENUECAT_ENTITLEMENT_ID,
  REVENUECAT_OFFERING_ID,
  REVENUECAT_PRODUCT_IDS,
} from '../config/subscriptions';

const SubscriptionContext = createContext(null);

const isPaywallResultSuccess = (result) =>
  result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED;

const hasEntitlement = (customerInfo, entitlementId) =>
  Boolean(customerInfo?.entitlements?.active?.[entitlementId]);

const normalizeError = (error) => ({
  code: error?.code || error?.userInfo?.readable_error_code || 'UNKNOWN',
  message: error?.message || 'Unknown RevenueCat error',
  raw: error,
});

const isMissingNativeModuleError = (error) => {
  const message = error?.message || '';
  return (
    message.includes('Native module (RNPurchases) not found') ||
    message.includes('native modules are unavailable') ||
    message.includes('package is not properly linked')
  );
};

const createUnavailableError = () => ({
  code: 'REVENUECAT_UNAVAILABLE',
  message:
    'Subscriptions are unavailable in Expo Go. Use an iOS/Android development build to test purchases.',
});

const isAnonymousRevenueCatUser = (customerInfo) => {
  const appUserId = customerInfo?.originalAppUserId || customerInfo?.appUserID || '';
  return typeof appUserId === 'string' && appUserId.startsWith('$RCAnonymousID:');
};

const isAnonymousLogoutError = (error) => {
  const message = error?.message || '';
  return message.includes('LogOut was called but the current user is anonymous');
};

const getPackageCatalog = (offerings) => {
  const availablePackages = offerings?.current?.availablePackages || [];
  const byProductId = Object.fromEntries(
    availablePackages
      .filter((pkg) => pkg?.product?.identifier)
      .map((pkg) => [pkg.product.identifier, pkg])
  );

  return {
    offerings,
    availablePackages,
    monthly: byProductId[REVENUECAT_PRODUCT_IDS.monthly] || null,
    yearly: byProductId[REVENUECAT_PRODUCT_IDS.yearly] || null,
  };
};

export const SubscriptionProvider = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [isConfigured, setIsConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [customerInfo, setCustomerInfo] = useState(null);
  const [offerings, setOfferings] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [isNativeAvailable, setIsNativeAvailable] = useState(true);
  const [identityReady, setIdentityReady] = useState(false);

  const entitlementActive = useMemo(
    () => hasEntitlement(customerInfo, REVENUECAT_ENTITLEMENT_ID),
    [customerInfo]
  );

  const refreshCustomerInfo = useCallback(async () => {
    const info = await Purchases.getCustomerInfo();
    setCustomerInfo(info);
    return info;
  }, []);

  const refreshOfferings = useCallback(async () => {
    const nextOfferings = await Purchases.getOfferings();
    setOfferings(nextOfferings);
    return nextOfferings;
  }, []);

  useEffect(() => {
    if (!REVENUECAT_API_KEY) {
      console.warn('RevenueCat API key is missing; subscriptions are disabled.');
      return undefined;
    }

    try {
      Purchases.setLogLevel(
        __DEV__ ? Purchases.LOG_LEVEL.DEBUG : Purchases.LOG_LEVEL.WARN
      );
      Purchases.configure({
        apiKey: REVENUECAT_API_KEY,
      });
      setIsNativeAvailable(true);
      setIsConfigured(true);
    } catch (error) {
      if (isMissingNativeModuleError(error)) {
        setIsNativeAvailable(false);
        setIsConfigured(false);
        setLastError(createUnavailableError());
        console.warn(
          'RevenueCat native module unavailable in this runtime. Use a development build for subscriptions.'
        );
        return undefined;
      }

      setLastError(normalizeError(error));
      console.error('RevenueCat configure failed:', error);
      return undefined;
    }

    const customerInfoListener = (info) => {
      setCustomerInfo(info);
    };

    Purchases.addCustomerInfoUpdateListener(customerInfoListener);

    (async () => {
      try {
        await Promise.all([refreshCustomerInfo(), refreshOfferings()]);
      } catch (error) {
        setLastError(normalizeError(error));
        console.error('RevenueCat initial load failed:', error);
      }
    })();

    return () => {
      Purchases.removeCustomerInfoUpdateListener(customerInfoListener);
    };
  }, [refreshCustomerInfo, refreshOfferings]);

  useEffect(() => {
    if (!isConfigured) return;

    let cancelled = false;
    setIdentityReady(false);

    const syncIdentity = async () => {
      try {
        if (isAuthenticated && user?.id) {
          const result = await Purchases.logIn(user.id);
          if (!cancelled) {
            setCustomerInfo(result.customerInfo);
          }
        } else {
          const currentInfo = await Purchases.getCustomerInfo();
          if (isAnonymousRevenueCatUser(currentInfo)) {
            if (!cancelled) {
              setCustomerInfo(currentInfo);
            }
            return;
          }

          const info = await Purchases.logOut();
          if (!cancelled) {
            setCustomerInfo(info);
          }
        }
      } catch (error) {
        if (isAnonymousLogoutError(error)) {
          if (!cancelled) {
            try {
              const currentInfo = await Purchases.getCustomerInfo();
              setCustomerInfo(currentInfo);
            } catch {
              // Ignore follow-up fetch failures for anonymous users.
            }
          }
          return;
        }

        if (!cancelled) {
          setLastError(normalizeError(error));
        }
        console.error('RevenueCat identity sync failed:', error);
      } finally {
        if (!cancelled) {
          setIdentityReady(true);
        }
      }
    };

    syncIdentity();

    return () => {
      cancelled = true;
    };
  }, [isConfigured, isAuthenticated, user?.id]);

  useEffect(() => {
    if (!isConfigured) {
      setIdentityReady(false);
    }
  }, [isConfigured]);

  const restorePurchases = useCallback(async () => {
    if (!isConfigured) {
      const unavailableError = createUnavailableError();
      setLastError(unavailableError);
      throw unavailableError;
    }

    setIsLoading(true);
    try {
      const info = await Purchases.restorePurchases();
      setCustomerInfo(info);
      return {
        customerInfo: info,
        entitlementActive: hasEntitlement(info, REVENUECAT_ENTITLEMENT_ID),
      };
    } catch (error) {
      const normalized = normalizeError(error);
      setLastError(normalized);
      throw normalized;
    } finally {
      setIsLoading(false);
    }
  }, [isConfigured]);

  const presentPaywallIfNeeded = useCallback(async () => {
    if (!isConfigured) {
      const unavailableError = createUnavailableError();
      setLastError(unavailableError);
      throw unavailableError;
    }

    setIsLoading(true);
    try {
      const packageCatalog = getPackageCatalog(offerings);
      const paywallResult = await RevenueCatUI.presentPaywallIfNeeded({
        requiredEntitlementIdentifier: REVENUECAT_ENTITLEMENT_ID,
        offering: REVENUECAT_OFFERING_ID
          ? packageCatalog.offerings?.all?.[REVENUECAT_OFFERING_ID]
          : undefined,
      });

      const purchasedOrRestored = isPaywallResultSuccess(paywallResult);
      if (purchasedOrRestored) {
        await refreshCustomerInfo();
      }

      return { result: paywallResult, purchasedOrRestored };
    } catch (error) {
      const normalized = normalizeError(error);
      setLastError(normalized);
      throw normalized;
    } finally {
      setIsLoading(false);
    }
  }, [isConfigured, offerings, refreshCustomerInfo]);

  const presentPaywall = useCallback(async () => {
    if (!isConfigured) {
      const unavailableError = createUnavailableError();
      setLastError(unavailableError);
      throw unavailableError;
    }

    setIsLoading(true);
    try {
      const packageCatalog = getPackageCatalog(offerings);
      const paywallResult = await RevenueCatUI.presentPaywall({
        offering: REVENUECAT_OFFERING_ID
          ? packageCatalog.offerings?.all?.[REVENUECAT_OFFERING_ID]
          : undefined,
      });

      const purchasedOrRestored = isPaywallResultSuccess(paywallResult);
      if (purchasedOrRestored) {
        await refreshCustomerInfo();
      }

      return { result: paywallResult, purchasedOrRestored };
    } catch (error) {
      const normalized = normalizeError(error);
      setLastError(normalized);
      throw normalized;
    } finally {
      setIsLoading(false);
    }
  }, [isConfigured, offerings, refreshCustomerInfo]);

  const presentCustomerCenter = useCallback(async () => {
    if (!isConfigured) {
      const unavailableError = createUnavailableError();
      setLastError(unavailableError);
      throw unavailableError;
    }

    try {
      await RevenueCatUI.presentCustomerCenter();
    } catch (error) {
      const normalized = normalizeError(error);
      setLastError(normalized);
      throw normalized;
    }
  }, []);

  const resetSubscriptionIdentityForQa = useCallback(async () => {
    if (!isConfigured) {
      return null;
    }

    try {
      const info = await Purchases.logOut();
      setCustomerInfo(info);
      return info;
    } catch (error) {
      if (isAnonymousLogoutError(error)) {
        const currentInfo = await Purchases.getCustomerInfo();
        setCustomerInfo(currentInfo);
        return currentInfo;
      }

      const normalized = normalizeError(error);
      setLastError(normalized);
      throw normalized;
    }
  }, [isConfigured]);

  const purchaseByProductKey = useCallback(async (productKey) => {
    if (!isConfigured) {
      const unavailableError = createUnavailableError();
      setLastError(unavailableError);
      throw unavailableError;
    }

    const packageCatalog = getPackageCatalog(offerings);
    const pkg =
      productKey === 'yearly' ? packageCatalog.yearly : packageCatalog.monthly;

    if (!pkg) {
      throw {
        code: 'PACKAGE_NOT_FOUND',
        message: `No package available for product key: ${productKey}`,
      };
    }

    setIsLoading(true);
    try {
      const result = await Purchases.purchasePackage(pkg);
      setCustomerInfo(result.customerInfo);
      return result;
    } catch (error) {
      const normalized = normalizeError(error);
      setLastError(normalized);
      throw normalized;
    } finally {
      setIsLoading(false);
    }
  }, [isConfigured, offerings]);

  const packageCatalog = useMemo(() => getPackageCatalog(offerings), [offerings]);

  const value = useMemo(() => ({
    isConfigured,
    isNativeAvailable,
    identityReady,
    isLoading,
    customerInfo,
    entitlementId: REVENUECAT_ENTITLEMENT_ID,
    entitlementActive,
    offerings: packageCatalog.offerings,
    availablePackages: packageCatalog.availablePackages,
    monthlyPackage: packageCatalog.monthly,
    yearlyPackage: packageCatalog.yearly,
    refreshCustomerInfo,
    refreshOfferings,
    restorePurchases,
    presentPaywallIfNeeded,
    presentPaywall,
    presentCustomerCenter,
    purchaseByProductKey,
    resetSubscriptionIdentityForQa,
    lastError,
  }), [
    isConfigured,
    isNativeAvailable,
    identityReady,
    isLoading,
    customerInfo,
    entitlementActive,
    packageCatalog,
    refreshCustomerInfo,
    refreshOfferings,
    restorePurchases,
    presentPaywallIfNeeded,
    presentPaywall,
    presentCustomerCenter,
    purchaseByProductKey,
    resetSubscriptionIdentityForQa,
    lastError,
  ]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
};

export const useSubscriptions = () => {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscriptions must be used within SubscriptionProvider');
  }
  return context;
};

export default SubscriptionContext;
