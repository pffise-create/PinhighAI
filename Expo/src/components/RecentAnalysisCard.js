/**
 * RecentAnalysisCard - Individual analysis preview
 * 
 * Displays swing analysis information with date, score, focus area,
 * and navigation to specific ResultsScreen for detailed review.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../utils/theme';

const RecentAnalysisCard = ({ analysis, onPress }) => {
  
  const formatAnalysisDate = (dateString) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffTime = Math.abs(now - date);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) return 'Yesterday';
      if (diffDays <= 7) return `${diffDays} days ago`;
      
      // Format as MM/DD for older dates
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      });
    } catch (error) {
      return dateString;
    }
  };

  const formatFocusArea = (focusArea) => {
    if (!focusArea) return 'General technique';
    
    return focusArea
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  const getScoreColor = (score) => {
    if (score >= 8) return colors.success;
    if (score >= 6) return colors.accent;
    return colors.textSecondary;
  };

  const getScoreDescription = (score) => {
    if (score >= 8) return 'Excellent';
    if (score >= 6) return 'Good';
    if (score >= 4) return 'Fair';
    return 'Needs Work';
  };

  return (
    <TouchableOpacity 
      style={styles.container}
      onPress={() => onPress(analysis)}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.dateText}>{formatAnalysisDate(analysis.date)}</Text>
          {analysis.hasFollowupChat && (
            <View style={styles.chatBadge}>
              <Text style={styles.chatBadgeText}>💬</Text>
            </View>
          )}
        </View>

        <View style={styles.mainContent}>
          <View style={styles.scoreSection}>
            <Text style={[styles.scoreNumber, { color: getScoreColor(analysis.overallScore) }]}>
              {analysis.overallScore.toFixed(1)}
            </Text>
            <Text style={styles.scoreLabel}>
              {getScoreDescription(analysis.overallScore)}
            </Text>
          </View>

          <View style={styles.detailsSection}>
            <Text style={styles.focusTitle}>Focus Area</Text>
            <Text style={styles.focusText}>{formatFocusArea(analysis.focusArea)}</Text>
            
            {analysis.keyImprovement && (
              <Text style={styles.improvementText}>
                Key: {analysis.keyImprovement}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.actionHint}>Tap to review analysis</Text>
          <Text style={styles.arrow}>→</Text>
        </View>
      </View>

      <View style={[styles.progressBar, { backgroundColor: getScoreColor(analysis.overallScore) }]} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },

  content: {
    padding: spacing.base,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },

  dateText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },

  chatBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },

  chatBadgeText: {
    fontSize: 12,
  },

  mainContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },

  scoreSection: {
    alignItems: 'center',
    marginRight: spacing.lg,
    minWidth: 60,
  },

  scoreNumber: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.bold,
    fontFamily: typography.fontFamily,
    lineHeight: typography.fontSizes['2xl'] * 1.1,
  },

  scoreLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontWeight: typography.fontWeights.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: typography.fontFamily,
  },

  detailsSection: {
    flex: 1,
  },

  focusTitle: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontWeight: typography.fontWeights.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    fontFamily: typography.fontFamily,
  },

  focusText: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },

  improvementText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    fontStyle: 'italic',
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  actionHint: {
    fontSize: typography.fontSizes.sm,
    color: colors.primary,
    fontFamily: typography.fontFamily,
  },

  arrow: {
    fontSize: typography.fontSizes.lg,
    color: colors.primary,
    fontWeight: typography.fontWeights.bold,
  },

  progressBar: {
    height: 3,
    width: '100%',
  },
});

export default RecentAnalysisCard;