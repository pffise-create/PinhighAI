/**
 * CoachingSessionIndicator - Displays coaching session progress and context
 * 
 * Shows users their coaching journey progress, current focus areas,
 * and session continuity information to build coaching relationship.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../utils/theme';

const CoachingSessionIndicator = ({ 
  sessionNumber = 0, 
  currentFocus = null, 
  timeline = null,
  loading = false 
}) => {
  
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContent}>
          <Text style={styles.loadingText}>Loading coaching context...</Text>
        </View>
      </View>
    );
  }

  // Don't show for guest users or first session
  if (sessionNumber === 0) {
    return null;
  }

  const formatTimeline = (dateString) => {
    if (!dateString) return 'Previous session';
    
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
      return 'Previous session';
    }
  };

  const getCurrentFocusDisplay = (focusAreas) => {
    if (!focusAreas || !Array.isArray(focusAreas) || focusAreas.length === 0) {
      return 'Overall technique';
    }
    
    const activeFocus = focusAreas
      .filter(area => area.progress_level !== 'maintenance')
      .sort((a, b) => a.priority - b.priority);
    
    if (activeFocus.length === 0) {
      return 'Technique refinement';
    }
    
    return activeFocus[0].focus.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const displayFocus = currentFocus || getCurrentFocusDisplay(currentFocus);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.sessionBadge}>
            <Text style={styles.sessionNumber}>Session {sessionNumber}</Text>
          </View>
          <Text style={styles.timelineText}>{formatTimeline(timeline)}</Text>
        </View>
        
        <View style={styles.focusSection}>
          <Text style={styles.focusLabel}>Current Focus</Text>
          <Text style={styles.focusText}>{displayFocus}</Text>
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
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  
  content: {
    padding: spacing.base,
  },
  
  loadingContent: {
    padding: spacing.base,
    alignItems: 'center',
  },
  
  loadingText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  
  sessionBadge: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  
  sessionNumber: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    color: colors.surface,
  },
  
  timelineText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  
  focusSection: {
    marginTop: spacing.xs,
  },
  
  focusLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontWeight: typography.fontWeights.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  
  focusText: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontWeight: typography.fontWeights.medium,
  },
});

export default CoachingSessionIndicator;