import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

export default function RecommendedDrillsCard({ drills, onPress }) {
  const [selectedDrill, setSelectedDrill] = useState(null);

  if (!drills || drills.length === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Ionicons name="fitness" size={24} color={colors.accent} />
          <Text style={styles.title}>Practice Drills</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            Personalized practice drills will appear here after swing analysis! 🏋️
          </Text>
        </View>
      </View>
    );
  }

  const getEffectivenessColor = (effectiveness) => {
    switch (effectiveness) {
      case 'high': return colors.success;
      case 'medium': return colors.warning;
      case 'low': return colors.textSecondary;
      default: return colors.primary;
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'timing': return 'time';
      case 'fundamentals': return 'fitness';
      case 'ball_striking': return 'radio-button-on';
      case 'general': return 'golf';
      default: return 'build';
    }
  };

  const getEffectivenessLabel = (effectiveness) => {
    switch (effectiveness) {
      case 'high': return 'Highly Effective';
      case 'medium': return 'Effective';
      case 'low': return 'Supporting';
      default: return 'Recommended';
    }
  };

  const handleDrillPress = (index) => {
    setSelectedDrill(selectedDrill === index ? null : index);
  };

  return (
    <TouchableOpacity 
      style={styles.card} 
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Ionicons name="fitness" size={24} color={colors.accent} />
          <Text style={styles.title}>Practice Drills</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{drills.length}</Text>
        </View>
      </View>

      <Text style={styles.subtitle}>
        Personalized drills based on your swing analysis
      </Text>

      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        style={styles.drillsScroll}
        contentContainerStyle={styles.drillsContainer}
      >
        {drills.slice(0, 5).map((drill, index) => {
          const isSelected = selectedDrill === index;
          const effectivenessColor = getEffectivenessColor(drill.effectiveness);
          const categoryIcon = getCategoryIcon(drill.category);
          
          return (
            <TouchableOpacity
              key={index}
              style={[
                styles.drillCard,
                isSelected && styles.selectedDrillCard
              ]}
              onPress={() => handleDrillPress(index)}
              activeOpacity={0.8}
            >
              <View style={styles.drillHeader}>
                <View style={[styles.categoryIconContainer, { backgroundColor: effectivenessColor + '20' }]}>
                  <Ionicons name={categoryIcon} size={20} color={effectivenessColor} />
                </View>
                <View style={styles.effectivenessContainer}>
                  <View style={[styles.effectivenessDot, { backgroundColor: effectivenessColor }]} />
                </View>
              </View>

              <Text style={styles.drillTitle}>{drill.title}</Text>
              
              <Text style={styles.drillDescription} numberOfLines={isSelected ? 0 : 2}>
                {drill.description}
              </Text>

              <View style={styles.drillMeta}>
                <View style={styles.timeContainer}>
                  <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                  <Text style={styles.timeText}>{drill.timeRequired}</Text>
                </View>
                
                <Text style={[styles.effectivenessLabel, { color: effectivenessColor }]}>
                  {getEffectivenessLabel(drill.effectiveness)}
                </Text>
              </View>

              {drill.frequency > 1 && (
                <View style={styles.frequencyBadge}>
                  <Text style={styles.frequencyText}>
                    Recommended {drill.frequency}x
                  </Text>
                </View>
              )}

              {isSelected && (
                <View style={styles.actionButtons}>
                  <TouchableOpacity style={styles.actionButton}>
                    <Ionicons name="play" size={14} color={colors.primary} />
                    <Text style={styles.actionButtonText}>Start Drill</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionButton, styles.secondaryButton]}>
                    <Ionicons name="bookmark-outline" size={14} color={colors.textSecondary} />
                    <Text style={[styles.actionButtonText, styles.secondaryButtonText]}>Save</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.practiceHint}>
          <Ionicons name="bulb" size={16} color={colors.accent} />
          <Text style={styles.practiceHintText}>
            Practice 2-3 drills per session for best results
          </Text>
        </View>
        
        {drills.length > 5 && (
          <TouchableOpacity style={styles.viewAllButton}>
            <Text style={styles.viewAllText}>
              View All {drills.length} Drills
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </TouchableOpacity>
        )}
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
    borderLeftColor: colors.accent,
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
  countBadge: {
    backgroundColor: colors.accent,
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
  drillsScroll: {
    marginBottom: spacing.base,
  },
  drillsContainer: {
    paddingRight: spacing.base,
  },
  drillCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginRight: spacing.base,
    width: 220,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectedDrillCard: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '05',
  },
  drillHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  categoryIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  effectivenessContainer: {
    alignItems: 'center',
  },
  effectivenessDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  drillTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
    lineHeight: 20,
  },
  drillDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  drillMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.xs,
  },
  effectivenessLabel: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },
  frequencyBadge: {
    backgroundColor: colors.accent + '10',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  frequencyText: {
    fontSize: typography.fontSizes.xs,
    color: colors.accent,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '10',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    marginRight: spacing.sm,
  },
  secondaryButton: {
    backgroundColor: colors.background,
  },
  actionButtonText: {
    fontSize: typography.fontSizes.xs,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    marginLeft: spacing.xs,
  },
  secondaryButtonText: {
    color: colors.textSecondary,
  },
  footer: {
    marginTop: spacing.sm,
  },
  practiceHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent + '10',
    padding: spacing.sm,
    borderRadius: borderRadius.base,
    marginBottom: spacing.sm,
  },
  practiceHintText: {
    fontSize: typography.fontSizes.sm,
    color: colors.accent,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    marginLeft: spacing.sm,
    flex: 1,
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  viewAllText: {
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