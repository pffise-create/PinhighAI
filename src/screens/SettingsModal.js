import React, { useLayoutEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '../context/AuthContext';
import { useSubscriptions } from '../context/SubscriptionContext';
import { appEnv } from '../config/runtimeEnv';
import { SUPPORT_EMAIL_ADDRESS } from '../services/supportService';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/theme';

// Launch-time URL/email wiring. Populate these via EXPO_PUBLIC_* env vars in
// eas.json / .env once the legal/support site is live. When blank, the
// corresponding row falls back to the "coming before public launch" alert.
// Tracked in docs/launch-plan.md Step 6.
const readEnv = (value) => (typeof value === 'string' ? value.trim() : '');
const PRIVACY_POLICY_URL = readEnv(process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL);
const TERMS_OF_SERVICE_URL = readEnv(process.env.EXPO_PUBLIC_TERMS_URL);

const showQaTools = __DEV__ || appEnv !== 'prod';

const SettingsModal = ({ navigation }) => {
  const { user, signOut } = useAuth();
  const {
    restorePurchases,
    presentPaywall,
    presentCustomerCenter,
    resetSubscriptionIdentityForQa,
    entitlementActive,
    customerInfo,
    identityReady,
    isLoading: subscriptionsLoading,
    isConfigured: subscriptionsConfigured,
    isNativeAvailable: subscriptionsNativeAvailable,
    lastError: subscriptionLastError,
  } = useSubscriptions();
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: 'Settings',
      headerRight: () => (
        <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={22} color={colors.text} />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const handleSignOut = async () => {
    try {
      await signOut();
      setShowSignOutConfirm(false);
      navigation.goBack();
    } catch (error) {
      console.error('Failed to sign out:', error);
    }
  };

  const showPlaceholderAction = (title, message) => {
    Alert.alert(title, message);
  };

  // Try to open a real URL; on any failure (missing, unsupported, or throw),
  // fall back to the placeholder alert so the row never looks broken.
  const openExternalUrl = async (url, fallbackTitle, fallbackMessage) => {
    if (!url) {
      showPlaceholderAction(fallbackTitle, fallbackMessage);
      return;
    }
    try {
      await Linking.openURL(url);
    } catch (error) {
      console.error(`Failed to open ${fallbackTitle} URL:`, error);
      showPlaceholderAction(fallbackTitle, fallbackMessage);
    }
  };

  const handleOpenPrivacyPolicy = () =>
    openExternalUrl(
      PRIVACY_POLICY_URL,
      'Privacy Policy',
      'The Privacy Policy will be available before public launch.'
    );

  const handleOpenTerms = () =>
    openExternalUrl(
      TERMS_OF_SERVICE_URL,
      'Terms of Service',
      'The Terms of Service will be available before public launch.'
    );

  const handleOpenSupport = () => navigation.navigate('HelpSupport');

  const handleManageSubscription = async () => {
    if (!subscriptionsNativeAvailable || !subscriptionsConfigured) {
      Alert.alert(
        'Subscriptions Unavailable',
        'RevenueCat is not available in this runtime. Use an iOS/Android development build or TestFlight build to manage subscriptions.'
      );
      return;
    }

    if (!identityReady) {
      Alert.alert(
        'Still Connecting',
        'RevenueCat is still connecting this signed-in user. Wait a moment, then try again.'
      );
      return;
    }

    try {
      await presentCustomerCenter();
    } catch (error) {
      console.error('Customer Center launch failed:', error);
      Alert.alert(
        'Manage Subscription',
        error.message ||
          'Customer Center could not be opened. Confirm Customer Center is enabled in RevenueCat, then try again.'
      );
    }
  };

  const handleShowPaywall = async () => {
    if (!subscriptionsNativeAvailable || !subscriptionsConfigured) {
      Alert.alert(
        'Subscriptions Unavailable',
        'RevenueCat paywalls require an iOS/Android development build or TestFlight build.'
      );
      return;
    }

    if (!identityReady) {
      Alert.alert(
        'Still Connecting',
        'RevenueCat is still connecting this signed-in user. Wait a moment, then try again.'
      );
      return;
    }

    try {
      const result = await presentPaywall();
      if (result.purchasedOrRestored) {
        Alert.alert('Subscription Active', 'RevenueCat says this account now has access.');
      }
    } catch (error) {
      console.error('Paywall launch failed:', error);
      Alert.alert('Paywall Failed', error.message || 'RevenueCat paywall could not be opened.');
    }
  };

  const handleRestorePurchases = async () => {
    try {
      const result = await restorePurchases();
      if (result.entitlementActive) {
        Alert.alert('Restored', 'Your subscription is active on this account.');
      } else {
        Alert.alert('No Purchases Found', 'No active purchases were found to restore.');
      }
    } catch (error) {
      console.error('Restore purchases failed:', error);
      Alert.alert('Restore Failed', error.message || 'Unable to restore purchases right now.');
    }
  };

  const handleQaReset = () => {
    Alert.alert(
      'Reset QA State?',
      'This signs out, clears local app storage, and resets RevenueCat identity for this dev/staging install. It does not delete backend data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              await resetSubscriptionIdentityForQa?.();
              await signOut();
              await AsyncStorage.clear();
              navigation.goBack();
            } catch (error) {
              console.error('QA reset failed:', error);
              Alert.alert('QA Reset Failed', error.message || 'Unable to reset local QA state.');
            }
          },
        },
      ]
    );
  };

  const settingsActions = [
    {
      id: 'subscription',
      icon: 'card-outline',
      title: 'Manage Subscription',
      subtitle: 'Opens RevenueCat Customer Center once configured',
      onPress: handleManageSubscription,
    },
    {
      id: 'restore',
      icon: 'refresh-outline',
      title: 'Restore Purchases',
      subtitle: 'For sandbox/TestFlight purchase recovery',
      onPress: handleRestorePurchases,
    },
    {
      id: 'privacy',
      icon: 'shield-checkmark-outline',
      title: 'Privacy Policy',
      subtitle: PRIVACY_POLICY_URL ? 'Open policy' : 'Coming before public launch',
      onPress: handleOpenPrivacyPolicy,
    },
    {
      id: 'terms',
      icon: 'document-text-outline',
      title: 'Terms of Service',
      subtitle: TERMS_OF_SERVICE_URL ? 'Open terms' : 'Coming before public launch',
      onPress: handleOpenTerms,
    },
    {
      id: 'help',
      icon: 'help-circle-outline',
      title: 'Help & Support',
      subtitle: `Message us at ${SUPPORT_EMAIL_ADDRESS}`,
      onPress: handleOpenSupport,
    },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sheet}>
          <View style={styles.accountRow}>
            <View style={styles.avatarWrapper}>
              <Text style={styles.avatarInitials}>
                {(user?.email || 'G')[0]?.toUpperCase?.()}
              </Text>
            </View>
            <View style={styles.accountCopy}>
              <Text style={styles.accountPrimary}>{user?.email || 'Not signed in'}</Text>
            </View>
          </View>

          <View style={styles.groupDivider} />
          {settingsActions.map((item, index) => (
            <View key={item.id}>
              <TouchableOpacity
                style={styles.actionRow}
                activeOpacity={0.8}
                onPress={item.onPress}
              >
                <View style={styles.actionIcon}>
                  <Ionicons name={item.icon} size={18} color={colors.brandFern} />
                </View>
                <View style={styles.actionCopy}>
                  <Text style={styles.actionTitle}>{item.title}</Text>
                  {item.subtitle ? (
                    <Text style={styles.actionSubtitle}>{item.subtitle}</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
              {index < settingsActions.length - 1 ? <View style={styles.separator} /> : null}
            </View>
          ))}

          {showQaTools ? (
            <>
              <View style={styles.groupDivider} />
              <View style={styles.qaPanel}>
                <View style={styles.qaHeaderRow}>
                  <Ionicons name="flask-outline" size={17} color={colors.statusWarning} />
                  <Text style={styles.qaTitle}>QA Tools</Text>
                </View>
                <Text style={styles.qaMeta}>Env: {appEnv}</Text>
                <Text style={styles.qaMeta}>User: {user?.id || 'none'}</Text>
                <Text style={styles.qaMeta}>
                  Entitlement: {entitlementActive ? 'active' : 'inactive'}
                </Text>
                <Text style={styles.qaMeta}>
                  RevenueCat: {subscriptionsNativeAvailable ? 'native available' : 'native unavailable'} / {subscriptionsConfigured ? 'configured' : 'not configured'} / {identityReady ? 'identity ready' : 'identity pending'} / {subscriptionsLoading ? 'busy' : 'idle'}
                </Text>
                <Text style={styles.qaMeta}>
                  RC User: {customerInfo?.originalAppUserId || customerInfo?.appUserID || 'none'}
                </Text>
                {subscriptionLastError?.message ? (
                  <Text style={styles.qaError}>
                    RC Error: {subscriptionLastError.message}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={styles.qaPaywallButton}
                  activeOpacity={0.85}
                  onPress={handleShowPaywall}
                >
                  <Text style={styles.qaPaywallButtonText}>Show RevenueCat paywall</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.qaResetButton}
                  activeOpacity={0.85}
                  onPress={handleQaReset}
                >
                  <Text style={styles.qaResetButtonText}>Reset local first-run state</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}

          <View style={styles.groupDivider} />
          {!showSignOutConfirm ? (
            <TouchableOpacity
              style={styles.signOutRow}
              onPress={() => setShowSignOutConfirm(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="log-out-outline" size={18} color={colors.statusError} />
              <Text style={styles.signOutLabel}>Sign out</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.confirmContainer}>
              <Text style={styles.confirmTitle}>Sign out?</Text>
              <View style={styles.confirmButtons}>
                <TouchableOpacity
                  style={styles.confirmButtonSecondary}
                  onPress={() => setShowSignOutConfirm(false)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.confirmButtonSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmButtonDestructive}
                  onPress={handleSignOut}
                  activeOpacity={0.85}
                >
                  <Text style={styles.confirmButtonDestructiveText}>Sign Out</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing['3xl'],
  },
  headerButton: {
    padding: spacing.sm,
  },
  sheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 560,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    ...shadows.md,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceBase,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  groupDivider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginVertical: spacing.base,
  },
  avatarWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandFern,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
  },
  avatarInitials: {
    color: colors.textInverse,
    fontSize: typography.fontSizes.base,
    fontFamily: typography.fontFamilyHeading,
    fontWeight: typography.fontWeights.semibold,
  },
  accountCopy: {
    flex: 1,
  },
  accountPrimary: {
    color: colors.text,
    fontSize: typography.fontSizes.base,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  actionCopy: {
    flex: 1,
  },
  actionTitle: {
    color: colors.text,
    fontSize: typography.fontSizes.sm,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  actionSubtitle: {
    marginTop: spacing.xs,
    color: colors.textSecondary,
    fontSize: typography.fontSizes.xs,
    fontFamily: typography.fontFamily,
    lineHeight: typography.fontSizes.sm,
  },
  separator: {
    height: 1,
    backgroundColor: colors.borderSubtle,
  },
  qaPanel: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceBase,
    padding: spacing.base,
  },
  qaHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  qaTitle: {
    marginLeft: spacing.sm,
    color: colors.text,
    fontSize: typography.fontSizes.sm,
    fontFamily: typography.fontFamilyHeading,
    fontWeight: typography.fontWeights.semibold,
  },
  qaMeta: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.xs,
    fontFamily: typography.fontFamilyMono,
    marginTop: spacing.xs,
  },
  qaError: {
    color: colors.statusError,
    fontSize: typography.fontSizes.xs,
    fontFamily: typography.fontFamilyMono,
    marginTop: spacing.xs,
  },
  qaPaywallButton: {
    marginTop: spacing.base,
    minHeight: 40,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.brandFern,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(60,141,90,0.1)',
  },
  qaPaywallButtonText: {
    color: colors.brandFern,
    fontSize: typography.fontSizes.sm,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  qaResetButton: {
    marginTop: spacing.base,
    minHeight: 40,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.statusWarning,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(217,119,6,0.08)',
  },
  qaResetButtonText: {
    color: colors.statusWarning,
    fontSize: typography.fontSizes.sm,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  signOutRow: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.statusError,
    backgroundColor: 'rgba(197,48,48,0.06)',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutLabel: {
    marginLeft: spacing.sm,
    color: colors.statusError,
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
  },
  confirmContainer: {
    paddingVertical: spacing.xs,
  },
  confirmTitle: {
    color: colors.text,
    fontSize: typography.fontSizes.base,
    fontFamily: typography.fontFamilyHeading,
    fontWeight: typography.fontWeights.semibold,
    textAlign: 'center',
  },
  confirmButtons: {
    marginTop: spacing.base,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  confirmButtonSecondary: {
    flex: 1,
    height: 44,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonSecondaryText: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  confirmButtonDestructive: {
    flex: 1,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.statusError,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  confirmButtonDestructiveText: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.textInverse,
    fontFamily: typography.fontFamily,
  },
});

export default SettingsModal;
