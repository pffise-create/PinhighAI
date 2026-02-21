import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows, globalStyles } from '../utils/theme';

export default function StrengthsCard({ strengths, onPress }) {
  if (!strengths || strengths.length === 0) {
    return (
      <View style={[styles.card, globalStyles.coachingCard]}>
        <View style={styles.coachingIndicator}>
          <View style={styles.coachingDot} />
          <Text style={styles.coachingLabel}>Coaching Insight</Text>
        </View>
        <View style={styles.header}>
          <Ionicons name="checkmark-circle" size={24} color={colors.success} />
          <Text style={styles.title}>Your Strengths</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            Upload swing videos to discover your strengths! 💪
          </Text>
        </View>
      </View>
    );
  }

  const getImprovementIcon = (improvement) => {
    switch (improvement) {
      case 'improving': return { name: 'trending-up', color: colors.success };
      case 'stable': return { name: 'remove', color: colors.warning };
      case 'new': return { name: 'sparkles', color: colors.primary };
      default: return { name: 'checkmark-circle', color: colors.success };
    }
  };

  return (
    <TouchableOpacity 
      style={styles.card} 
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Ionicons name="checkmark-circle" size={24} color={colors.success} />
          <Text style={styles.title}>Your Strengths</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{strengths.length}</Text>
        </View>
      </View>

      <Text style={styles.subtitle}>
        These are the aspects of your swing that are working well
      </Text>

      <View style={styles.strengthsList}>
        {strengths.slice(0, 4).map((strength, index) => {
          const icon = getImprovementIcon(strength.improvement);
          return (
            <View key={index} style={styles.strengthItem}>
              <View style={styles.strengthContent}>
                <View style={styles.strengthIcon}>
                  <Ionicons name="golf" size={16} color={colors.success} />
                </View>
                <View style={styles.strengthTextContainer}>
                  <Text style={styles.strengthText}>{strength.text}</Text>
                  {strength.consistency && (
                    <Text style={styles.consistencyText}>
                      {strength.consistency}% consistency
                    </Text>
                  )}
                </View>
              </View>
              
              <View style={styles.trendContainer}>
                <Ionicons 
                  name={icon.name} 
                  size={16} 
                  color={icon.color} 
                />
              </View>
            </View>
          );
        })}
      </View>

      {strengths.length > 4 && (
        <View style={styles.moreIndicator}>
          <Text style={styles.moreText}>
            +{strengths.length - 4} more strengths
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </View>
      )}

      <View style={styles.footer}>
        <View style={styles.motivationContainer}>
          <Text style={styles.motivationText}>
            🎯 Keep building on these fundamentals!
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.base,
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
    ...shadows.base,
  },
  
  // Coaching presence indicators
  coachingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  
  coachingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.coachAccent,
    marginRight: spacing.xs,
  },
  
  coachingLabel: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
    color: colors.coachAccent,
    fontFamily: typography.fontFamily,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  countBadge: {
    backgroundColor: colors.success,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countText: {
    color: colors.surface,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
  },
  subtitle: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: 18,
    marginBottom: spacing.base,
  },
  strengthsList: {
    marginBottom: spacing.sm,
  },
  strengthItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  strengthContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  strengthIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.success + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  strengthTextContainer: {
    flex: 1,
  },
  strengthText: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    marginBottom: spacing.xs,
  },
  consistencyText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  trendContainer: {
    width: 24,
    alignItems: 'center',
  },
  moreIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
  },
  moreText: {
    fontSize: typography.fontSizes.sm,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    marginRight: spacing.xs,
  },
  footer: {
    marginTop: spacing.sm,
  },
  motivationContainer: {
    backgroundColor: colors.success + '10',
    padding: spacing.sm,
    borderRadius: borderRadius.base,
  },
  motivationText: {
    fontSize: typography.fontSizes.sm,
    color: colors.success,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    lineHeight: 22,
  },
});