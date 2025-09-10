/**
 * CoachingStatusCard - Session progress display
 * 
 * Shows current coaching session number, focus areas, last activity,
 * and progress indicators for the user's coaching journey.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../utils/theme';
import ProgressIndicator from './ProgressIndicator';

const CoachingStatusCard = ({ 
  sessionCount = 0, 
  currentFocus = null,
  lastActivity = null,
  hasActiveConversation = false,
  progressSummary = null,
  loading = false 
}) => {
  
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContent}>
          <View style={styles.loadingBar} />
          <View style={[styles.loadingBar, styles.loadingBarShort]} />
          <View style={[styles.loadingBar, styles.loadingBarMedium]} />
        </View>
      </View>
    );
  }

  // Don't show for first-time users
  if (sessionCount === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.welcomeContent}>
          <Text style={styles.welcomeTitle}>Ready to improve your golf?</Text>
          <Text style={styles.welcomeText}>
            Upload your first swing video to start your personalized coaching journey with Pin High.
          </Text>
        </View>
      </View>
    );
  }

  const formatLastActivity = (dateString) => {
    if (!dateString) return 'Recent session';
    
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffTime = Math.abs(now - date);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) return 'Yesterday';
      if (diffDays <= 7) return `${diffDays} days ago`;
      if (diffDays <= 30) return `${Math.ceil(diffDays / 7)} weeks ago`;
      return 'Previous session';
    } catch (error) {
      return 'Recent session';
    }
  };

  const getFocusDisplay = () => {
    if (typeof currentFocus === 'string') {
      return currentFocus.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    
    if (progressSummary?.improvementAreas?.length > 0) {
      return progressSummary.improvementAreas[0]
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
    }
    
    return 'Overall technique';
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.sessionInfo}>
          <Text style={styles.sessionTitle}>Session {sessionCount}</Text>
          {hasActiveConversation && (
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>Active</Text>
            </View>
          )}
        </View>
        <Text style={styles.lastActivityText}>{formatLastActivity(lastActivity)}</Text>
      </View>

      <View style={styles.focusSection}>
        <Text style={styles.focusLabel}>Current Focus</Text>
        <Text style={styles.focusText}>{getFocusDisplay()}</Text>
      </View>

      {progressSummary && (
        <ProgressIndicator 
          areas={progressSummary.improvementAreas || []}
          style={styles.progressIndicator}
        />
      )}

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{sessionCount}</Text>
          <Text style={styles.statLabel}>Sessions</Text>
        </View>
        
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>
            {progressSummary?.improvementAreas?.length || 1}
          </Text>
          <Text style={styles.statLabel}>Focus Areas</Text>
        </View>
        
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>
            {progressSummary?.recentMilestones?.length || 0}
          </Text>
          <Text style={styles.statLabel}>Achievements</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.base,
    marginVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },

  loadingContent: {
    paddingVertical: spacing.base,
  },

  loadingBar: {
    height: 12,
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.sm,
  },

  loadingBarShort: {
    width: '60%',
  },

  loadingBarMedium: {
    width: '80%',
  },

  welcomeContent: {
    alignItems: 'center',
    paddingVertical: spacing.base,
  },

  welcomeTitle: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },

  welcomeText: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    lineHeight: typography.fontSizes.base * 1.4,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.base,
  },

  sessionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  sessionTitle: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
  },

  activeBadge: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    marginLeft: spacing.sm,
  },

  activeBadgeText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
    color: colors.surface,
    fontFamily: typography.fontFamily,
  },

  lastActivityText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    fontStyle: 'italic',
  },

  focusSection: {
    marginBottom: spacing.base,
  },

  focusLabel: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontWeight: typography.fontWeights.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    fontFamily: typography.fontFamily,
  },

  focusText: {
    fontSize: typography.fontSizes.lg,
    color: colors.text,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },

  progressIndicator: {
    marginVertical: spacing.base,
  },

  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.base,
    paddingTop: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  statItem: {
    alignItems: 'center',
  },

  statNumber: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold,
    color: colors.accent,
    fontFamily: typography.fontFamily,
  },

  statLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontWeight: typography.fontWeights.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xs,
    fontFamily: typography.fontFamily,
  },
});

export default CoachingStatusCard;