import React, { useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';
import { useSubscriptions } from '../context/SubscriptionContext';
import { appEnv } from '../config/runtimeEnv';
import {
  SUPPORT_EMAIL_ADDRESS,
  buildSupportEmail,
  openSupportEmail,
} from '../services/supportService';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/theme';

const SUPPORT_CATEGORIES = [
  'Account',
  'Billing',
  'Swing analysis',
  'Bug report',
  'Feature idea',
  'Other',
];

const MIN_MESSAGE_LENGTH = 10;

const HelpSupportScreen = ({ navigation }) => {
  const { user } = useAuth();
  const { customerInfo, entitlementActive } = useSubscriptions();
  const [category, setCategory] = useState('Account');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: 'Help & Support',
      headerRight: () => (
        <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={22} color={colors.text} />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const revenueCatUserId = customerInfo?.originalAppUserId || customerInfo?.appUserID || '';

  const supportEmail = useMemo(
    () =>
      buildSupportEmail({
        category,
        message,
        user,
        appEnv,
        revenueCatUserId,
        entitlementActive,
      }),
    [category, message, user, revenueCatUserId, entitlementActive]
  );

  const trimmedMessage = message.trim();
  const canSend = trimmedMessage.length >= MIN_MESSAGE_LENGTH && !isSending;

  const handleSend = async () => {
    if (!canSend) {
      Alert.alert(
        'Add a Little Detail',
        'Please write a short message so support knows how to help.'
      );
      return;
    }

    setIsSending(true);
    try {
      await openSupportEmail({
        category,
        message: trimmedMessage,
        user,
        appEnv,
        revenueCatUserId,
        entitlementActive,
      });
    } catch (error) {
      console.error('Failed to open support email:', error);
      Alert.alert(
        'Email Not Available',
        `Please email us directly at ${SUPPORT_EMAIL_ADDRESS}.`
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroCard}>
            <View style={styles.heroIcon}>
              <Ionicons name="chatbubble-ellipses-outline" size={26} color={colors.brandForest} />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.title}>Send us a note</Text>
              <Text style={styles.description}>
                Tell us what happened and we’ll reply by email. Your account and app context
                are included automatically so we can help faster.
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>What can we help with?</Text>
            <View style={styles.categoryGrid}>
              {SUPPORT_CATEGORIES.map((item) => {
                const selected = item === category;
                return (
                  <TouchableOpacity
                    key={item}
                    style={[styles.categoryChip, selected && styles.categoryChipSelected]}
                    activeOpacity={0.85}
                    onPress={() => setCategory(item)}
                  >
                    <Text
                      style={[
                        styles.categoryChipText,
                        selected && styles.categoryChipTextSelected,
                      ]}
                    >
                      {item}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Message</Text>
            <TextInput
              style={styles.messageInput}
              value={message}
              onChangeText={setMessage}
              placeholder="Example: I uploaded a swing video and the analysis failed after processing."
              placeholderTextColor={colors.textSecondary}
              multiline
              textAlignVertical="top"
              autoCapitalize="sentences"
            />
            <Text style={styles.helperText}>
              This opens your email app before sending, so you can review or edit the note.
            </Text>
          </View>

          <View style={styles.contextCard}>
            <Text style={styles.contextTitle}>Included with your message</Text>
            <Text style={styles.contextLine}>To: {supportEmail.to}</Text>
            <Text style={styles.contextLine}>Subject: {supportEmail.subject}</Text>
            <Text style={styles.contextLine}>User: {user?.email || user?.id || 'unknown'}</Text>
            <Text style={styles.contextLine}>Env: {appEnv}</Text>
          </View>

          <TouchableOpacity
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            activeOpacity={0.88}
            onPress={handleSend}
            disabled={!canSend}
          >
            <Ionicons name="mail-outline" size={18} color={colors.textInverse} />
            <Text style={styles.sendButtonText}>
              {isSending ? 'Opening email...' : 'Open Email Draft'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoider: {
    flex: 1,
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
  heroCard: {
    flexDirection: 'row',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.sm,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(201,166,84,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
  },
  heroCopy: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: typography.fontSizes.xl,
    fontFamily: typography.fontFamilyHeading,
    fontWeight: typography.fontWeights.bold,
  },
  description: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
    fontFamily: typography.fontFamily,
    lineHeight: typography.fontSizes.lg,
  },
  section: {
    marginTop: spacing.xl,
  },
  label: {
    color: colors.text,
    fontSize: typography.fontSizes.sm,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.semibold,
    marginBottom: spacing.sm,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  categoryChipSelected: {
    borderColor: colors.brandFern,
    backgroundColor: 'rgba(60,141,90,0.12)',
  },
  categoryChipText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  categoryChipTextSelected: {
    color: colors.brandForest,
  },
  messageInput: {
    minHeight: 160,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: typography.fontSizes.base,
    fontFamily: typography.fontFamily,
    lineHeight: 22,
    padding: spacing.base,
  },
  helperText: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: typography.fontSizes.xs,
    fontFamily: typography.fontFamily,
    lineHeight: typography.fontSizes.sm,
  },
  contextCard: {
    marginTop: spacing.xl,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceBase,
    padding: spacing.base,
  },
  contextTitle: {
    color: colors.text,
    fontSize: typography.fontSizes.sm,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.semibold,
    marginBottom: spacing.xs,
  },
  contextLine: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.xs,
    fontFamily: typography.fontFamilyMono,
    marginTop: spacing.xs,
  },
  sendButton: {
    marginTop: spacing.xl,
    minHeight: 50,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.brandForest,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    ...shadows.md,
  },
  sendButtonDisabled: {
    backgroundColor: colors.textSecondary,
    opacity: 0.6,
  },
  sendButtonText: {
    marginLeft: spacing.sm,
    color: colors.textInverse,
    fontSize: typography.fontSizes.base,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.semibold,
  },
});

export default HelpSupportScreen;
