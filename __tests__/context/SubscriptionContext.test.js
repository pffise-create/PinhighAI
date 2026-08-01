// SubscriptionContext.test.js - RevenueCat subscription context
// Tests: entitlementActive derivation, presentPaywall success/failure,
// REVENUECAT_UNAVAILABLE when unconfigured, web platform disable.
import React from 'react';
import { Platform } from 'react-native';
import { renderHook, waitFor, act } from '@testing-library/react-native';

// Mutable config consumed by the hoisted jest.mock factory below.
let mockApiKey = 'test_public_api_key';
const ENTITLEMENT_ID = 'DivotLab Unlimited';

jest.mock('../../src/config/subscriptions', () => ({
  get REVENUECAT_API_KEY() {
    return mockApiKey;
  },
  REVENUECAT_ENTITLEMENT_ID: 'DivotLab Unlimited',
  REVENUECAT_OFFERING_ID: '',
  REVENUECAT_PRODUCT_IDS: { monthly: 'monthly', yearly: 'yearly' },
}));

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    setLogLevel: jest.fn(),
    LOG_LEVEL: { VERBOSE: 'VERBOSE', DEBUG: 'DEBUG', WARN: 'WARN' },
    getCustomerInfo: jest.fn(),
    getOfferings: jest.fn(),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(),
    logIn: jest.fn(),
    logOut: jest.fn(),
    restorePurchases: jest.fn(),
    purchasePackage: jest.fn(),
  },
}));

jest.mock('react-native-purchases-ui', () => ({
  __esModule: true,
  default: {
    presentPaywall: jest.fn(),
    presentPaywallIfNeeded: jest.fn(),
    presentCustomerCenter: jest.fn(),
  },
  PAYWALL_RESULT: {
    NOT_PRESENTED: 'NOT_PRESENTED',
    ERROR: 'ERROR',
    CANCELLED: 'CANCELLED',
    PURCHASED: 'PURCHASED',
    RESTORED: 'RESTORED',
  },
}));

jest.mock('../../src/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

const Purchases = require('react-native-purchases').default;
const RevenueCatUI = require('react-native-purchases-ui').default;
const { PAYWALL_RESULT } = require('react-native-purchases-ui');
const { useAuth } = require('../../src/context/AuthContext');
const {
  SubscriptionProvider,
  useSubscriptions,
} = require('../../src/context/SubscriptionContext');

const customerInfoWith = (entitlements = {}) => ({
  originalAppUserId: 'user-1',
  entitlements: { active: entitlements },
});

const inactiveInfo = customerInfoWith({});
const activeInfo = customerInfoWith({
  [ENTITLEMENT_ID]: { identifier: ENTITLEMENT_ID, isActive: true },
});

const emptyOfferings = { current: { availablePackages: [] }, all: {} };

const renderSubscriptions = () =>
  renderHook(() => useSubscriptions(), {
    wrapper: ({ children }) => (
      <SubscriptionProvider>{children}</SubscriptionProvider>
    ),
  });

describe('SubscriptionContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiKey = 'test_public_api_key';
    useAuth.mockReturnValue({ user: { id: 'user-1' }, isAuthenticated: true });
    Purchases.getCustomerInfo.mockResolvedValue(inactiveInfo);
    Purchases.getOfferings.mockResolvedValue(emptyOfferings);
    Purchases.logIn.mockResolvedValue({ customerInfo: inactiveInfo });
    Purchases.logOut.mockResolvedValue(inactiveInfo);
  });

  describe('entitlementActive derivation from customerInfo', () => {
    it('is false when customerInfo has no active entitlement', async () => {
      const { result } = renderSubscriptions();

      await waitFor(() => expect(result.current.identityReady).toBe(true));
      expect(result.current.isConfigured).toBe(true);
      expect(result.current.entitlementActive).toBe(false);
    });

    it('is true when customerInfo has the configured entitlement active', async () => {
      Purchases.getCustomerInfo.mockResolvedValue(activeInfo);
      Purchases.logIn.mockResolvedValue({ customerInfo: activeInfo });

      const { result } = renderSubscriptions();

      await waitFor(() => expect(result.current.entitlementActive).toBe(true));
      expect(result.current.customerInfo).toEqual(activeInfo);
    });

    it('flips to true when a customer info update listener reports the entitlement', async () => {
      const { result } = renderSubscriptions();
      await waitFor(() => expect(result.current.identityReady).toBe(true));
      expect(result.current.entitlementActive).toBe(false);

      const listener = Purchases.addCustomerInfoUpdateListener.mock.calls[0][0];
      act(() => listener(activeInfo));

      expect(result.current.entitlementActive).toBe(true);
    });
  });

  describe('presentPaywall', () => {
    it('resolves purchasedOrRestored=true and refreshes customer info on purchase', async () => {
      RevenueCatUI.presentPaywall.mockResolvedValue(PAYWALL_RESULT.PURCHASED);
      const { result } = renderSubscriptions();
      await waitFor(() => expect(result.current.identityReady).toBe(true));

      Purchases.getCustomerInfo.mockResolvedValue(activeInfo);
      const callsBefore = Purchases.getCustomerInfo.mock.calls.length;

      let outcome;
      await act(async () => {
        outcome = await result.current.presentPaywall();
      });

      expect(outcome).toEqual({
        result: PAYWALL_RESULT.PURCHASED,
        purchasedOrRestored: true,
      });
      expect(Purchases.getCustomerInfo.mock.calls.length).toBe(callsBefore + 1);
      expect(result.current.entitlementActive).toBe(true);
    });

    it('resolves purchasedOrRestored=false without refresh when the paywall is dismissed', async () => {
      RevenueCatUI.presentPaywall.mockResolvedValue(PAYWALL_RESULT.CANCELLED);
      const { result } = renderSubscriptions();
      await waitFor(() => expect(result.current.identityReady).toBe(true));

      const callsBefore = Purchases.getCustomerInfo.mock.calls.length;

      let outcome;
      await act(async () => {
        outcome = await result.current.presentPaywall();
      });

      expect(outcome).toEqual({
        result: PAYWALL_RESULT.CANCELLED,
        purchasedOrRestored: false,
      });
      expect(Purchases.getCustomerInfo.mock.calls.length).toBe(callsBefore);
    });

    it('throws a normalized error and records lastError when presentation fails', async () => {
      RevenueCatUI.presentPaywall.mockRejectedValue({
        code: 'PurchaseNotAllowedError',
        message: 'Purchases are not allowed on this device.',
      });
      const { result } = renderSubscriptions();
      await waitFor(() => expect(result.current.identityReady).toBe(true));

      await act(async () => {
        await expect(result.current.presentPaywall()).rejects.toMatchObject({
          code: 'PurchaseNotAllowedError',
          message: 'Purchases are not allowed on this device.',
        });
      });

      expect(result.current.lastError).toMatchObject({
        code: 'PurchaseNotAllowedError',
      });
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('unconfigured runtime (missing API key)', () => {
    it('throws REVENUECAT_UNAVAILABLE from presentPaywall and never configures the SDK', async () => {
      mockApiKey = '';
      const { result } = renderSubscriptions();

      expect(Purchases.configure).not.toHaveBeenCalled();
      expect(result.current.isConfigured).toBe(false);

      await act(async () => {
        await expect(result.current.presentPaywall()).rejects.toMatchObject({
          code: 'REVENUECAT_UNAVAILABLE',
        });
      });
      expect(RevenueCatUI.presentPaywall).not.toHaveBeenCalled();
      expect(result.current.lastError).toMatchObject({ code: 'REVENUECAT_UNAVAILABLE' });
    });

    it('throws REVENUECAT_UNAVAILABLE from restorePurchases when unconfigured', async () => {
      mockApiKey = '';
      const { result } = renderSubscriptions();

      await act(async () => {
        await expect(result.current.restorePurchases()).rejects.toMatchObject({
          code: 'REVENUECAT_UNAVAILABLE',
        });
      });
      expect(Purchases.restorePurchases).not.toHaveBeenCalled();
    });
  });

  describe('web platform disable', () => {
    let originalOSDescriptor;

    beforeEach(() => {
      originalOSDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        get: () => 'web',
      });
    });

    afterEach(() => {
      Object.defineProperty(Platform, 'OS', originalOSDescriptor);
    });

    it('disables subscriptions with a web-specific REVENUECAT_UNAVAILABLE error', async () => {
      const { result } = renderSubscriptions();

      expect(result.current.isNativeAvailable).toBe(false);
      expect(result.current.isConfigured).toBe(false);
      expect(result.current.lastError).toMatchObject({
        code: 'REVENUECAT_UNAVAILABLE',
        message: expect.stringContaining('web preview'),
      });
      expect(Purchases.configure).not.toHaveBeenCalled();
      expect(Purchases.getCustomerInfo).not.toHaveBeenCalled();

      await act(async () => {
        await expect(result.current.presentPaywall()).rejects.toMatchObject({
          code: 'REVENUECAT_UNAVAILABLE',
        });
      });
    });
  });
});
