import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

export default function ImprovementAreasCard({ improvements, onPress }) {
  if (!improvements || improvements.length === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Ionicons name="trending-up" size={24} color={colors.primary} />
          <Text style={styles.title}>Focus Areas</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            Your improvement areas will appear here after swing analysis! 🎯
          </Text>
        </View>
      </View>
    );
  }

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return colors.error;
      case 'medium': return colors.warning;
      case 'low': return colors.success;
      default: return colors.primary;
    }
  };

  const getPriorityLabel = (priority) => {
    switch (priority) {
      case 'high': return 'High Priority';
      case 'medium': return 'Medium Priority';
      case 'low': return 'Low Priority';
      default: return 'Focus Area';
    }
  };

  const getProgressIcon = (trend) => {
    switch (trend) {
      case 'improving': return { name: 'trending-up', color: colors.success };
      case 'working_on': return { name: 'build', color: colors.warning };
      case 'new': return { name: 'add-circle', color: colors.primary };
      case 'mastered': return { name: 'checkmark-circle', color: colors.success };
      default: return { name: 'ellipse', color: colors.textSecondary };
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'fundamentals': return 'fitness';
      case 'technique': return 'golf';
      case 'timing': return 'time';
      case 'ball_striking': return 'radio-button-on';
      default: return 'golf';
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
          <Ionicons name="trending-up" size={24} color={colors.primary} />
          <Text style={styles.title}>Focus Areas</Text>
        </View>
        <View style={styles.priorityBadge}>
          <Text style={styles.priorityText}>Top {Math.min(improvements.length, 3)}</Text>
        </View>
      </View>

      <Text style={styles.subtitle}>
        Key areas to focus on for maximum improvement
      </Text>

      <View style={styles.improvementsList}>
        {improvements.slice(0, 3).map((improvement, index) => {
          const priorityColor = getPriorityColor(improvement.priority);
          const progressIcon = getProgressIcon(improvement.progressTrend);
          const categoryIcon = getCategoryIcon(improvement.category);
          
          return (
            <View key={index} style={styles.improvementItem}>
              <View style={styles.improvementHeader}>
                <View style={styles.improvementTitleRow}>
                  <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
                  <Text style={styles.improvementText}>{improvement.text}</Text>
                </View>
                <View style={styles.progressContainer}>
                  <Ionicons 
                    name={progressIcon.name} 
                    size={16} 
                    color={progressIcon.color} 
                  />
                </View>
              </View>
              
              <View style={styles.improvementDetails}>
                <View style={styles.categoryContainer}>
                  <Ionicons name={categoryIcon} size={14} color={colors.textSecondary} />
                  <Text style={styles.categoryText}>
                    {improvement.category.charAt(0).toUpperCase() + improvement.category.slice(1).replace('_', ' ')}
                  </Text>
                </View>
                
                <View style={styles.priorityContainer}>
                  <Text style={[styles.priorityLabel, { color: priorityColor }]}>
                    {getPriorityLabel(improvement.priority)}
                  </Text>
                </View>
              </View>

              {improvement.frequency > 1 && (
                <View style={styles.frequencyIndicator}>
                  <Text style={styles.frequencyText}>
                    Mentioned in {improvement.frequency} analysis{improvement.frequency > 1 ? 'es' : ''}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      <View style={styles.footer}>
        <View style={styles.actionHint}>
          <Ionicons name="lightbulb" size={16} color={colors.accent} />
          <Text style={styles.actionHintText}>
            Focus on one area at a time for best results
          </Text>
        </View>
      </View>

      {improvements.length > 3 && (
        <View style={styles.moreIndicator}>
          <Text style={styles.moreText}>
            +{improvements.length - 3} more areas to explore
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </View>
      )}
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
    borderLeftColor: colors.primary,
    ...shadows.base,
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
  priorityBadge: {
    backgroundColor: colors.primary + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  priorityText: {
    color: colors.primary,
    fontSize: typography.fontSizes.xs,
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
  improvementsList: {
    marginBottom: spacing.sm,
  },
  improvementItem: {
    backgroundColor: colors.background,
    padding: spacing.base,
    borderRadius: borderRadius.base,
    marginBottom: spacing.sm,
  },
  improvementHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  improvementTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
    marginTop: 6, // Align with text
  },
  improvementText: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    flex: 1,
    lineHeight: 20,
  },
  progressContainer: {
    width: 24,
    alignItems: 'center',
  },
  improvementDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  categoryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.xs,
  },
  priorityContainer: {
    alignItems: 'flex-end',
  },
  priorityLabel: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },
  frequencyIndicator: {
    backgroundColor: colors.accent + '10',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
  },
  frequencyText: {
    fontSize: typography.fontSizes.xs,
    color: colors.accent,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  footer: {
    marginTop: spacing.sm,
  },
  actionHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent + '10',
    padding: spacing.sm,
    borderRadius: borderRadius.base,
  },
  actionHintText: {
    fontSize: typography.fontSizes.sm,
    color: colors.accent,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    marginLeft: spacing.sm,
    flex: 1,
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