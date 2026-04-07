import React, { useLayoutEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Alert,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '../context/AuthContext';
import { useSubscriptions } from '../context/SubscriptionContext';
import { appEnv } from '../config/runtimeEnv';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/theme';

const SUPPORT_EMAIL = 'support@divotlab.ai (placeholder)';
const showQaTools = __DEV__ || appEnv !== 'prod';

const SettingsModal = ({ navigation }) => {
  const { user, signOut } = useAuth();
  const {
    restorePurchases,
    presentCustomerCenter,
    resetSubscriptionIdentityForQa,
    entitlementActive,
    customerInfo,
    identityReady,
    isNativeAvailable: subscriptionsNativeAvailable,
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

  const handleManageSubscription = async () => {
    try {
      await presentCustomerCenter();
    } catch (error) {
      console.error('Customer Center launch failed:', error);
      Alert.alert(
        'Manage Subscription',
        'Customer Center could not be opened. Please try again.'
      );
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
      onPress: handleManageSubscription,
    },
    {
      id: 'restore',
      icon: 'refresh-outline',
      title: 'Restore Purchases',
      onPress: handleRestorePurchases,
    },
    {
      id: 'privacy',
      icon: 'shield-checkmark-outline',
      title: 'Privacy Policy',
      onPress: () => showPlaceholderAction(
        'Privacy Policy',
        'Privacy Policy link will be added when the legal/support site project is ready.'
      ),
    },
    {
      id: 'help',
      icon: 'help-circle-outline',
      title: 'Help & Support',
      onPress: () => showPlaceholderAction(
        'Help & Support',
        `Support email placeholder:\n${SUPPORT_EMAIL}`
      ),
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
                  RevenueCat: {subscriptionsNativeAvailable ? 'native available' : 'native unavailable'} / {identityReady ? 'identity ready' : 'identity pending'}
                </Text>
                <Text style={styles.qaMeta}>
                  RC User: {customerInfo?.originalAppUserId || customerInfo?.appUserID || 'none'}
                </Text>
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
