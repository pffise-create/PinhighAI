/**
 * CoachingHeader - Session and progress display for ChatScreen
 * 
 * Shows coaching relationship context including session count,
 * current focus areas, and recent progress for context awareness.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../utils/theme';

const CoachingHeader = ({ 
  sessionCount = 0,
  primaryFocus = null,
  recentProgress = null,
  currentSwingId = null,
  loading = false 
}) => {
  
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContent}>
          <View style={styles.loadingBar} />
          <View style={[styles.loadingBar, styles.loadingBarShort]} />
        </View>
      </View>
    );
  }

  // Don't show for guest users or first session without focus
  if (sessionCount === 0 && !primaryFocus && !currentSwingId) {
    return null;
  }

  const formatFocusArea = (focus) => {
    if (!focus) return null;
    
    if (typeof focus === 'string') {
      return focus.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    
    return focus.focus?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const displayFocus = formatFocusArea(primaryFocus);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Session Info */}
        {sessionCount > 0 && (
          <View style={styles.sessionSection}>
            <Text style={styles.sessionLabel}>Coaching Session</Text>
            <Text style={styles.sessionNumber}>{sessionCount}</Text>
          </View>
        )}

        {/* Current Swing Indicator */}
        {currentSwingId && (
          <View style={styles.swingSection}>
            <Text style={styles.swingLabel}>Discussing Swing Analysis</Text>
            <View style={styles.swingIndicator}>
              <Text style={styles.swingIcon}>📊</Text>
            </View>
          </View>
        )}

        {/* Current Focus */}
        {displayFocus && (
          <View style={styles.focusSection}>
            <Text style={styles.focusLabel}>Current Focus</Text>
            <Text style={styles.focusText}>{displayFocus}</Text>
          </View>
        )}

        {/* Recent Progress */}
        {recentProgress && recentProgress.length > 0 && (
          <View style={styles.progressSection}>
            <Text style={styles.progressLabel}>Recent Progress</Text>
            <View style={styles.progressList}>
              {recentProgress.slice(0, 2).map((progress, index) => (
                <Text key={index} style={styles.progressItem}>
                  ✓ {progress}
                </Text>
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  content: {
    padding: spacing.base,
  },

  loadingContent: {
    padding: spacing.base,
  },

  loadingBar: {
    height: 12,
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
  },

  loadingBarShort: {
    width: '60%',
  },

  sessionSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },

  sessionLabel: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },

  sessionNumber: {
    fontSize: typography.fontSizes.lg,
    color: colors.primary,
    fontWeight: typography.fontWeights.bold,
    fontFamily: typography.fontFamily,
  },

  swingSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: borderRadius.sm,
  },

  swingLabel: {
    fontSize: typography.fontSizes.sm,
    color: colors.surface,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },

  swingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  swingIcon: {
    fontSize: typography.fontSizes.base,
  },

  focusSection: {
    marginBottom: spacing.sm,
  },

  focusLabel: {
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
  },

  progressSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  progressLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontWeight: typography.fontWeights.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    fontFamily: typography.fontFamily,
  },

  progressList: {
    marginLeft: spacing.sm,
  },

  progressItem: {
    fontSize: typography.fontSizes.sm,
    color: colors.success,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
});

export default CoachingHeader;