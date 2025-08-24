/**
 * CoachingDashboardSkeleton - Loading states
 * 
 * Provides skeleton loading screens while coaching data
 * is being fetched and assembled from ConversationContextService.
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { colors, spacing, borderRadius } from '../utils/theme';

const CoachingDashboardSkeleton = () => {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = () => {
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]).start(() => pulse());
    };

    pulse();
  }, [pulseAnim]);

  const SkeletonBlock = ({ width = '100%', height = 20, style = {} }) => (
    <Animated.View
      style={[
        styles.skeletonBlock,
        {
          width,
          height,
          opacity: pulseAnim,
        },
        style,
      ]}
    />
  );

  return (
    <View style={styles.container}>
      {/* Header Skeleton */}
      <View style={styles.headerSkeleton}>
        <SkeletonBlock width="40%" height={24} style={{ marginBottom: spacing.sm }} />
        <SkeletonBlock width="60%" height={32} />
      </View>

      {/* Status Card Skeleton */}
      <View style={styles.statusCardSkeleton}>
        <View style={styles.statusHeader}>
          <SkeletonBlock width="30%" height={28} />
          <SkeletonBlock width="25%" height={16} />
        </View>
        
        <SkeletonBlock width="40%" height={12} style={{ marginBottom: spacing.xs }} />
        <SkeletonBlock width="70%" height={20} style={{ marginBottom: spacing.base }} />
        
        <View style={styles.progressSkeleton}>
          <SkeletonBlock width="100%" height={8} style={{ marginBottom: spacing.sm }} />
          <SkeletonBlock width="100%" height={8} style={{ marginBottom: spacing.sm }} />
          <SkeletonBlock width="80%" height={8} />
        </View>
        
        <View style={styles.statsSkeleton}>
          <SkeletonBlock width="20%" height={24} />
          <SkeletonBlock width="20%" height={24} />
          <SkeletonBlock width="20%" height={24} />
        </View>
      </View>

      {/* Continue Button Skeleton */}
      <View style={styles.buttonSkeleton}>
        <SkeletonBlock width="100%" height={60} />
      </View>

      {/* Recent Analyses Skeleton */}
      <View style={styles.sectionSkeleton}>
        <SkeletonBlock width="50%" height={20} style={{ marginBottom: spacing.base }} />
        
        {[1, 2, 3].map((_, index) => (
          <View key={index} style={styles.analysisCardSkeleton}>
            <View style={styles.analysisHeader}>
              <SkeletonBlock width="30%" height={14} />
              <SkeletonBlock width="20%" height={20} />
            </View>
            
            <View style={styles.analysisContent}>
              <SkeletonBlock width="15%" height={32} style={{ marginRight: spacing.base }} />
              <View style={styles.analysisDetails}>
                <SkeletonBlock width="40%" height={12} style={{ marginBottom: spacing.xs }} />
                <SkeletonBlock width="80%" height={16} style={{ marginBottom: spacing.xs }} />
                <SkeletonBlock width="60%" height={12} />
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Action Buttons Skeleton */}
      <View style={styles.actionsSkeleton}>
        <SkeletonBlock width="100%" height={70} style={{ marginBottom: spacing.base }} />
        <SkeletonBlock width="100%" height={50} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingBottom: spacing['2xl'],
  },

  skeletonBlock: {
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
  },

  headerSkeleton: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },

  statusCardSkeleton: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.base,
    marginVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.border,
  },

  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.base,
  },

  progressSkeleton: {
    marginVertical: spacing.base,
  },

  statsSkeleton: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.base,
    paddingTop: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  buttonSkeleton: {
    marginHorizontal: spacing.base,
    marginVertical: spacing.sm,
  },

  sectionSkeleton: {
    marginHorizontal: spacing.base,
    marginVertical: spacing.lg,
  },

  analysisCardSkeleton: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    padding: spacing.base,
  },

  analysisHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },

  analysisContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  analysisDetails: {
    flex: 1,
  },

  actionsSkeleton: {
    marginHorizontal: spacing.base,
    marginVertical: spacing.lg,
  },
});

export default CoachingDashboardSkeleton;