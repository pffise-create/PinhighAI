import React, { useLayoutEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Alert,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/theme';

const settingsSections = [
  {
    id: 'subscription',
    icon: 'card-outline',
    title: 'Subscription & Billing',
    description: 'Manage your subscription and payment methods',
    onPress: () => {},
  },
  {
    id: 'privacy',
    icon: 'shield-checkmark-outline',
    title: 'Data & Privacy',
    description: 'Review your data and privacy settings',
    onPress: () => {},
  },
  {
    id: 'help',
    icon: 'help-circle-outline',
    title: 'Help & Support',
    description: 'Get help or contact support',
    onPress: () => {},
  },
];

const SettingsModal = ({ navigation }) => {
  const { user, signOut } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.accountCard}>
          <View style={styles.avatarWrapper}>
            <Text style={styles.avatarInitials}>
              {(user?.email || 'G')[0]?.toUpperCase?.()}
            </Text>
          </View>
          <View style={styles.accountCopy}>
            <Text style={styles.accountTitle}>Account</Text>
            <Text style={styles.accountSubtitle}>{user?.email || 'Not signed in'}</Text>
          </View>
        </View>

        <View style={styles.preferencesCard}>
          <View style={styles.preferencesHeader}>
            <View style={styles.preferencesIcon}>
              <Ionicons name="notifications-outline" size={18} color={colors.brandFern} />
            </View>
            <View style={styles.preferencesCopy}>
              <Text style={styles.preferenceTitle}>Notifications</Text>
              <Text style={styles.preferenceDescription}>
                Stay in the loop when your coach drops fresh drills.
              </Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: colors.border, true: colors.brandFern }}
              thumbColor={notificationsEnabled ? colors.textInverse : colors.surface}
            />
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Coaching</Text>
          <View style={styles.sectionRow}>
            <View style={styles.sectionIcon}>
              <Ionicons name="golf-outline" size={20} color={colors.brandFern} />
            </View>
            <View style={styles.sectionCopy}>
              <Text style={styles.sectionTitle}>Coaching style</Text>
              <Text style={styles.sectionDescription}>Personalized coaching (more styles coming soon)</Text>
            </View>
          </View>
        </View>

        <View style={styles.linksCard}>
          {settingsSections.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.linkRow}
              activeOpacity={0.8}
              onPress={item.onPress}
            >
              <View style={styles.linkIcon}>
                <Ionicons name={item.icon} size={20} color={colors.brandFern} />
              </View>
              <View style={styles.linkCopy}>
                <Text style={styles.linkTitle}>{item.title}</Text>
                <Text style={styles.linkDescription}>{item.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.signOutSection}>
          {!showSignOutConfirm ? (
            <TouchableOpacity
              style={styles.signOutRow}
              onPress={() => setShowSignOutConfirm(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="log-out-outline" size={20} color={colors.statusError} />
              <Text style={styles.signOutLabel}>Sign out</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.confirmContainer}>
              <View style={styles.confirmTextContainer}>
                <Text style={styles.confirmTitle}>Sign Out?</Text>
                <Text style={styles.confirmDescription}>
                  You can always sign back in anytime.
                </Text>
              </View>
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
    paddingBottom: spacing['3xl'],
    paddingTop: spacing.base,
    gap: spacing.lg,
  },
  headerButton: {
    padding: spacing.sm,
  },
  cardBase: {
    borderRadius: borderRadius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  accountCard: {
    borderRadius: borderRadius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadows.sm,
  },
  avatarWrapper: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandFern,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
  },
  avatarInitials: {
    color: colors.textInverse,
    fontSize: typography.fontSizes.lg,
    fontFamily: typography.fontFamilyHeading,
    fontWeight: typography.fontWeights.semibold,
  },
  accountCopy: {
    flex: 1,
  },
  accountTitle: {
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSizes.sm,
  },
  accountSubtitle: {
    marginTop: 2,
    color: colors.text,
    fontFamily: typography.fontFamilyHeading,
    fontSize: typography.fontSizes.base,
  },
  preferencesCard: {
    borderRadius: borderRadius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.sm,
  },
  preferencesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  preferencesIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
  },
  preferencesCopy: {
    flex: 1,
  },
  preferenceTitle: {
    color: colors.text,
    fontFamily: typography.fontFamilyHeading,
    fontSize: typography.fontSizes.base,
  },
  preferenceDescription: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSizes.sm,
    lineHeight: typography.lineHeights.relaxed * typography.fontSizes.sm,
  },
  sectionCard: {
    borderRadius: borderRadius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.sm,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSizes.xs,
    textTransform: 'uppercase',
    marginBottom: spacing.base,
    letterSpacing: 1,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
  },
  sectionCopy: {
    flex: 1,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: typography.fontFamilyHeading,
    fontSize: typography.fontSizes.base,
  },
  sectionDescription: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSizes.sm,
    lineHeight: typography.lineHeights.relaxed * typography.fontSizes.sm,
  },
  linksCard: {
    borderRadius: borderRadius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
  },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
  },
  linkCopy: {
    flex: 1,
  },
  linkTitle: {
    color: colors.text,
    fontFamily: typography.fontFamilyHeading,
    fontSize: typography.fontSizes.base,
  },
  linkDescription: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSizes.sm,
    lineHeight: typography.lineHeights.relaxed * typography.fontSizes.sm,
  },
  signOutSection: {
    marginTop: spacing.lg,
  },
  signOutRow: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.statusError,
    backgroundColor: 'rgba(197,48,48,0.08)',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutLabel: {
    marginLeft: spacing.sm,
    color: colors.statusError,
    fontFamily: typography.fontFamilyHeading,
    fontSize: typography.fontSizes.base,
  },
  confirmContainer: {
    paddingVertical: spacing.sm,
  },
  confirmTextContainer: {
    alignItems: 'center',
    marginBottom: spacing.base,
  },
  confirmTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    marginBottom: 4,
    fontFamily: typography.fontFamily,
  },
  confirmDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  confirmButtons: {
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

