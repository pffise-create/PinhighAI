/**
 * ProgressIndicator - Visual progress display
 * 
 * Shows visual progress indicators for each focus area
 * in the user's coaching journey with color-coded status.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../utils/theme';

const ProgressIndicator = ({ areas = [], style = {} }) => {
  
  if (!areas || areas.length === 0) {
    return null;
  }

  const getProgressColor = (area) => {
    if (typeof area === 'string') {
      return colors.accent; // Default for string-based areas
    }

    if (area.progress_level === 'maintenance') return colors.success;
    if (area.progress_level === 'improving') return colors.accent;
    if (area.progress_level === 'developing') return colors.primary;
    return colors.textSecondary;
  };

  const getProgressPercentage = (area) => {
    if (typeof area === 'string') {
      return 50; // Default progress
    }

    switch (area.progress_level) {
      case 'maintenance': return 90;
      case 'improving': return 70;
      case 'developing': return 40;
      default: return 20;
    }
  };

  const formatAreaName = (area) => {
    const name = typeof area === 'string' ? area : area.focus;
    return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <View style={[styles.container, style]}>
      {areas.slice(0, 3).map((area, index) => {
        const progressColor = getProgressColor(area);
        const progressPercentage = getProgressPercentage(area);
        
        return (
          <View key={index} style={styles.progressItem}>
            <Text style={styles.areaName}>{formatAreaName(area)}</Text>
            
            <View style={styles.progressBarContainer}>
              <View 
                style={[
                  styles.progressBar,
                  {
                    width: `${progressPercentage}%`,
                    backgroundColor: progressColor
                  }
                ]}
              />
            </View>
            
            <Text style={[styles.progressText, { color: progressColor }]}>
              {progressPercentage}%
            </Text>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
  },

  progressItem: {
    marginBottom: spacing.base,
  },

  areaName: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },

  progressBarContainer: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
    overflow: 'hidden',
  },

  progressBar: {
    height: '100%',
    borderRadius: borderRadius.sm,
  },

  progressText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
    textAlign: 'right',
    fontFamily: typography.fontFamily,
  },
});

export default ProgressIndicator;