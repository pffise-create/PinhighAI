// ChatHeader.js - Minimal header: app name + settings gear
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing } from '../../utils/theme';

const ChatHeader = ({ onSettingsPress }) => (
  <View style={styles.header}>
    <Text style={styles.title}>PinHigh</Text>
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
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    letterSpacing: -0.3,
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
});

export default React.memo(ChatHeader);
