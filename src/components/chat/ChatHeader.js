// ChatHeader.js - Minimal header: app name + settings gear
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius } from '../../utils/theme';

const ChatHeader = ({ onSettingsPress }) => (
  <View style={styles.container}>
    <View style={styles.header}>
      <View>
        <Text style={styles.title}>PinHigh Coach</Text>
        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Online</Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.settingsButton}
        onPress={onSettingsPress}
        accessibilityLabel="Open settings"
        accessibilityRole="button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    letterSpacing: -0.3,
  },
  statusRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
    marginRight: spacing.xs,
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
});

export default React.memo(ChatHeader);
