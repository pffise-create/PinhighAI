// LockedAnalysisCard.js - Teaser card for gated analysis/chat content
// Shows the preview summary the backend allows, plus a single trial CTA.
// Minimal by design: one card, one action.
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius } from '../../utils/theme';

const LockedAnalysisCard = ({ lockedAnalysis, onUnlock }) => {
  const [isBusy, setIsBusy] = useState(false);

  const handlePress = useCallback(async () => {
    if (isBusy || !onUnlock) return;
    setIsBusy(true);
    try {
      await onUnlock();
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, onUnlock]);

  if (!lockedAnalysis) return null;

  const headline = lockedAnalysis.headline || 'See the full swing breakdown';
  const ctaLabel = lockedAnalysis.cta_label || 'Start 7-Day Free Trial';

  return (
    <View style={styles.card} accessibilityLabel="Locked analysis">
      <View style={styles.lockRow}>
        <Ionicons name="lock-closed" size={14} color={colors.textSecondary} />
        <Text style={styles.headline}>{headline}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed, isBusy && styles.ctaBusy]}
        onPress={handlePress}
        disabled={isBusy}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
      >
        {isBusy ? (
          <ActivityIndicator size="small" color={colors.surface} />
        ) : (
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        )}
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.sm,
    padding: spacing.base,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  headline: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  cta: {
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaBusy: {
    opacity: 0.7,
  },
  ctaText: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.surface,
    fontFamily: typography.fontFamily,
  },
});

export default LockedAnalysisCard;
