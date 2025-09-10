import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

export default function VideoProgressMessage({ 
  stage, 
  progress = 0, 
  message,
  videoId 
}) {
  const spinValue = useRef(new Animated.Value(0)).current;
  const progressValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Start spinning animation
    const spinAnimation = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      })
    );
    spinAnimation.start();

    // Animate progress
    Animated.timing(progressValue, {
      toValue: progress,
      duration: 500,
      useNativeDriver: false,
    }).start();

    return () => spinAnimation.stop();
  }, [progress]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const getStageInfo = () => {
    switch (stage) {
      case 'uploading':
        return {
          icon: 'cloud-upload',
          title: 'Uploading Video',
          color: colors.primary,
          showProgress: true,
        };
      case 'processing':
        return {
          icon: 'settings',
          title: 'Processing Video',
          color: colors.accent,
          showProgress: false,
        };
      case 'extracting':
        return {
          icon: 'camera',
          title: 'Extracting Key Positions',
          color: colors.warning,
          showProgress: false,
        };
      case 'analyzing':
        return {
          icon: 'analytics',
          title: 'AI Analysis in Progress',
          color: colors.success,
          showProgress: false,
        };
      case 'complete':
        return {
          icon: 'checkmark-circle',
          title: 'Analysis Complete',
          color: colors.success,
          showProgress: false,
        };
      default:
        return {
          icon: 'hourglass',
          title: 'Processing...',
          color: colors.textSecondary,
          showProgress: false,
        };
    }
  };

  const stageInfo = getStageInfo();

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Animated.View
          style={[
            styles.iconWrapper,
            { backgroundColor: stageInfo.color + '20' }, // 20% opacity
            stage !== 'complete' && { transform: [{ rotate: spin }] }
          ]}
        >
          <Ionicons 
            name={stageInfo.icon} 
            size={24} 
            color={stageInfo.color} 
          />
        </Animated.View>
      </View>

      <View style={styles.contentContainer}>
        <Text style={styles.title}>{stageInfo.title}</Text>
        
        {message && (
          <Text style={styles.message}>{message}</Text>
        )}

        {stageInfo.showProgress && progress > 0 && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: progressValue.interpolate({
                      inputRange: [0, 100],
                      outputRange: ['0%', '100%'],
                      extrapolate: 'clamp',
                    }),
                    backgroundColor: stageInfo.color,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
        )}

        {stage === 'processing' && (
          <Text style={styles.estimateText}>
            ⏱️ This usually takes 30-60 seconds
          </Text>
        )}

        {stage === 'analyzing' && (
          <Text style={styles.estimateText}>
            🧠 Analyzing your P1-P10 swing positions...
          </Text>
        )}

        {videoId && (
          <Text style={styles.videoIdText}>
            Video ID: {videoId.substring(0, 8)}...
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderBottomLeftRadius: borderRadius.sm,
    padding: spacing.base,
    marginBottom: spacing.base,
    maxWidth: '90%',
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    ...shadows.sm,
  },
  iconContainer: {
    marginRight: spacing.base,
  },
  iconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentContainer: {
    flex: 1,
  },
  title: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  message: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    marginRight: spacing.sm,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    minWidth: 35,
    textAlign: 'right',
  },
  estimateText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textLight,
    fontStyle: 'italic',
    fontFamily: typography.fontFamily,
    marginTop: spacing.xs,
  },
  videoIdText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textLight,
    fontFamily: typography.fontFamily,
    marginTop: spacing.xs,
  },
});