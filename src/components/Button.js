import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { colors, typography, radius, shadows } from '../utils/theme';

export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  fullWidth,
  disabled,
  isLoading,
}) {
  const variantStyles = {
    primary: styles.variantPrimary,
    secondary: styles.variantSecondary,
    ghost: styles.variantGhost,
    destructive: styles.variantDestructive,
  };

  const variantTextStyles = {
    primary: styles.variantPrimaryText,
    secondary: styles.variantSecondaryText,
    ghost: styles.variantGhostText,
    destructive: styles.variantDestructiveText,
  };

  const sizeStyles = {
    sm: styles.sizeSm,
    md: styles.sizeMd,
    lg: styles.sizeLg,
  };

  const sizeTextStyles = {
    sm: styles.sizeSmText,
    md: styles.sizeMdText,
    lg: styles.sizeLgText,
  };

  return (
    <TouchableOpacity
      style={[
        styles.base,
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && styles.fullWidth,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled || isLoading}
      activeOpacity={0.8}
    >
      {isLoading ? (
        <ActivityIndicator
          color={variant === 'primary' || variant === 'destructive' ? colors.white : colors.brandForest}
        />
      ) : (
        <>
          {icon && <View style={styles.iconContainer}>{icon}</View>}
          <Text style={[variantTextStyles[variant], sizeTextStyles[size]]}>{children}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
  iconContainer: {
    marginRight: -4,
  },

  // Variants
  variantPrimary: {
    backgroundColor: colors.brandFern,
    borderRadius: radius.md,
    ...shadows.sm,
  },
  variantPrimaryText: {
    color: colors.textInverse,
    fontWeight: typography.medium,
  },
  variantSecondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: radius.md,
    ...shadows.sm,
  },
  variantSecondaryText: {
    color: colors.textPrimary,
    fontWeight: typography.medium,
  },
  variantGhost: {
    backgroundColor: 'transparent',
    borderRadius: radius.md,
  },
  variantGhostText: {
    color: colors.brandForest,
    fontWeight: typography.medium,
  },
  variantDestructive: {
    backgroundColor: colors.statusError,
    borderRadius: radius.md,
    ...shadows.sm,
  },
  variantDestructiveText: {
    color: colors.textInverse,
    fontWeight: typography.medium,
  },

  // Sizes
  sizeSm: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
  },
  sizeSmText: {
    fontSize: typography.sm,
    lineHeight: typography.smLh,
  },
  sizeMd: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: radius.md,
  },
  sizeMdText: {
    fontSize: typography.base,
    lineHeight: typography.baseLh,
  },
  sizeLg: {
    height: 52,
    paddingHorizontal: 24,
    borderRadius: radius.lg,
  },
  sizeLgText: {
    fontSize: typography.lg,
    lineHeight: typography.lgLh,
  },
});

export default Button;
