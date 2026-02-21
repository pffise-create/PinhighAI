import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

const { width } = Dimensions.get('window');

export default function ProgressVisualization({ progressData }) {
  if (!progressData) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Ionicons name="analytics" size={24} color={colors.primary} />
          <Text style={styles.title}>Progress Overview</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            Your progress tracking will appear here after multiple swing analyses! 📈
          </Text>
        </View>
      </View>
    );
  }

  const { overall, categories, milestones, recentWins } = progressData;

  const getTrendIcon = (trend) => {
    switch (trend) {
      case 'improving': return { name: 'trending-up', color: colors.success };
      case 'stable': return { name: 'remove', color: colors.warning };
      case 'declining': return { name: 'trending-down', color: colors.error };
      default: return { name: 'remove', color: colors.textSecondary };
    }
  };

  const getScoreColor = (score) => {
    if (score >= 8) return colors.success;
    if (score >= 7) return colors.warning;
    if (score >= 6) return colors.primary;
    return colors.error;
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Ionicons name="analytics" size={24} color={colors.primary} />
          <Text style={styles.title}>Progress Overview</Text>
        </View>
        {overall.improvement && (
          <View style={styles.improvementBadge}>
            <Text style={styles.improvementText}>
              {overall.improvement > 0 ? '+' : ''}{overall.improvement}
            </Text>
          </View>
        )}
      </View>

      {/* Overall Progress */}
      <View style={styles.overallSection}>
        <View style={styles.scoreContainer}>
          <View style={styles.scoreCircle}>
            <Text style={styles.scoreValue}>{overall.current}</Text>
            <Text style={styles.scoreMax}>/10</Text>
          </View>
          <View style={styles.scoreInfo}>
            <Text style={styles.scoreLabel}>Overall Swing Score</Text>
            <View style={styles.trendContainer}>
              <Ionicons 
                name={getTrendIcon(overall.trend).name} 
                size={16} 
                color={getTrendIcon(overall.trend).color} 
              />
              <Text style={[styles.trendText, { color: getTrendIcon(overall.trend).color }]}>
                {overall.trend.charAt(0).toUpperCase() + overall.trend.slice(1)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Category Progress */}
      {categories && categories.length > 0 && (
        <View style={styles.categoriesSection}>
          <Text style={styles.sectionTitle}>Category Progress</Text>
          {categories.slice(0, 4).map((category, index) => {
            const scoreColor = getScoreColor(category.score);
            const trendIcon = getTrendIcon(category.trend);
            
            return (
              <View key={index} style={styles.categoryItem}>
                <View style={styles.categoryHeader}>
                  <Text style={styles.categoryName}>{category.name}</Text>
                  <View style={styles.categoryScore}>
                    <Text style={[styles.categoryScoreText, { color: scoreColor }]}>
                      {category.score}
                    </Text>
                    <Ionicons 
                      name={trendIcon.name} 
                      size={14} 
                      color={trendIcon.color} 
                    />
                  </View>
                </View>
                <View style={styles.progressBar}>
                  <View 
                    style={[
                      styles.progressFill, 
                      { 
                        width: `${(category.score / 10) * 100}%`,
                        backgroundColor: scoreColor,
                      }
                    ]} 
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Recent Wins */}
      {recentWins && recentWins.length > 0 && (
        <View style={styles.winsSection}>
          <Text style={styles.sectionTitle}>Recent Wins 🎉</Text>
          {recentWins.slice(0, 3).map((win, index) => (
            <View key={index} style={styles.winItem}>
              <Ionicons name="trophy" size={16} color={colors.accent} />
              <Text style={styles.winText}>{win}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Milestones */}
      {milestones && milestones.length > 0 && (
        <View style={styles.milestonesSection}>
          <Text style={styles.sectionTitle}>Milestones</Text>
          <View style={styles.milestonesGrid}>
            {milestones.slice(0, 4).map((milestone, index) => (
              <View key={index} style={styles.milestoneItem}>
                <Ionicons 
                  name={milestone.achieved ? 'checkmark-circle' : 'ellipse-outline'} 
                  size={20} 
                  color={milestone.achieved ? colors.success : colors.textSecondary} 
                />
                <Text style={[
                  styles.milestoneText,
                  { color: milestone.achieved ? colors.success : colors.textSecondary }
                ]}>
                  {milestone.name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
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
    marginBottom: spacing.base,
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
  improvementBadge: {
    backgroundColor: colors.success + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  improvementText: {
    color: colors.success,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
  },
  overallSection: {
    marginBottom: spacing.lg,
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.base,
    borderRadius: borderRadius.lg,
  },
  scoreCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    alignItems: 'baseline',
    marginRight: spacing.base,
  },
  scoreValue: {
    fontSize: typography.fontSizes['3xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.surface,
    fontFamily: typography.fontFamily,
  },
  scoreMax: {
    fontSize: typography.fontSizes.base,
    color: colors.surface,
    fontFamily: typography.fontFamily,
    opacity: 0.8,
  },
  scoreInfo: {
    flex: 1,
  },
  scoreLabel: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  trendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trendText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.xs,
  },
  categoriesSection: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.sm,
  },
  categoryItem: {
    marginBottom: spacing.sm,
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  categoryName: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  categoryScore: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryScoreText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
    marginRight: spacing.xs,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  winsSection: {
    marginBottom: spacing.lg,
  },
  winItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent + '10',
    padding: spacing.sm,
    borderRadius: borderRadius.base,
    marginBottom: spacing.xs,
  },
  winText: {
    fontSize: typography.fontSizes.sm,
    color: colors.accent,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    marginLeft: spacing.sm,
    flex: 1,
  },
  milestonesSection: {
    marginBottom: spacing.base,
  },
  milestonesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  milestoneItem: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
    backgroundColor: colors.background,
    padding: spacing.sm,
    borderRadius: borderRadius.base,
    marginBottom: spacing.xs,
  },
  milestoneText: {
    fontSize: typography.fontSizes.xs,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    marginLeft: spacing.xs,
    flex: 1,
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