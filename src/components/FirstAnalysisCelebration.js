import React, { useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet,
  Animated,
  Dimensions 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

const { width } = Dimensions.get('window');

export default function FirstAnalysisCelebration({ 
  visible, 
  onClose, 
  onViewAnalysis,
  analysisData 
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const bounceAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Start celebration animation
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 100,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();

      // Bounce animation for celebration elements
      Animated.loop(
        Animated.sequence([
          Animated.timing(bounceAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(bounceAnim, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      // Reset animations when hidden
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.8);
      bounceAnim.setValue(0);
    }
  }, [visible]);

  if (!visible) return null;

  const bounceTransform = bounceAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -10],
  });

  const overallScore = analysisData?.overallScore || 7.5;
  const strengths = analysisData?.strengths || ['Great swing foundation'];

  return (
    <Animated.View 
      style={[
        styles.overlay,
        { 
          opacity: fadeAnim,
        }
      ]}
    >
      <Animated.View 
        style={[
          styles.celebrationContainer,
          {
            transform: [{ scale: scaleAnim }],
          }
        ]}
      >
        {/* Celebration Header */}
        <View style={styles.header}>
          <Animated.View 
            style={[
              styles.celebrationIcon,
              { transform: [{ translateY: bounceTransform }] }
            ]}
          >
            <Text style={styles.celebrationEmoji}>🎉</Text>
          </Animated.View>
          
          <Text style={styles.celebrationTitle}>
            First Analysis Complete!
          </Text>
          
          <Text style={styles.celebrationSubtitle}>
            This is the beginning of your golf improvement journey
          </Text>
        </View>

        {/* Score Highlight */}
        <View style={styles.scoreSection}>
          <View style={styles.scoreCircle}>
            <Text style={styles.scoreValue}>{overallScore}</Text>
            <Text style={styles.scoreMax}>/10</Text>
          </View>
          <Text style={styles.scoreLabel}>Your Swing Score</Text>
        </View>

        {/* Key Highlight */}
        <View style={styles.highlightSection}>
          <Text style={styles.highlightTitle}>🎯 What I Noticed:</Text>
          <Text style={styles.highlightText}>
            {strengths[0] || 'You have great potential!'}
          </Text>
        </View>

        {/* Encouragement */}
        <View style={styles.encouragementSection}>
          <Text style={styles.encouragementText}>
            Every great golfer started with their first analysis. You're now part of a community focused on continuous improvement!
          </Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            style={styles.primaryButton}
            onPress={onViewAnalysis}
            activeOpacity={0.8}
          >
            <Ionicons name="analytics" size={20} color={colors.surface} />
            <Text style={styles.primaryButtonText}>View Full Analysis</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.secondaryButton}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryButtonText}>Continue Chatting</Text>
          </TouchableOpacity>
        </View>

        {/* Achievement Badge */}
        <View style={styles.achievementBadge}>
          <Ionicons name="trophy" size={16} color={colors.accent} />
          <Text style={styles.achievementText}>First Analysis Achievement</Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  celebrationContainer: {
    backgroundColor: colors.surface,
    margin: spacing.lg,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    maxWidth: width - 40,
    ...shadows.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  celebrationIcon: {
    marginBottom: spacing.base,
  },
  celebrationEmoji: {
    fontSize: 48,
  },
  celebrationTitle: {
    fontSize: typography.fontSizes['3xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  celebrationSubtitle: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    lineHeight: 22,
  },
  scoreSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  scoreCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  scoreValue: {
    fontSize: typography.fontSizes['4xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.surface,
    fontFamily: typography.fontFamily,
  },
  scoreMax: {
    fontSize: typography.fontSizes.lg,
    color: colors.surface,
    fontFamily: typography.fontFamily,
    opacity: 0.8,
  },
  scoreLabel: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  highlightSection: {
    backgroundColor: colors.background,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    width: '100%',
    marginBottom: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  highlightTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.sm,
  },
  highlightText: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontFamily: typography.fontFamily,
    lineHeight: 20,
  },
  encouragementSection: {
    marginBottom: spacing.xl,
  },
  encouragementText: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    lineHeight: 22,
    fontStyle: 'italic',
  },
  buttonContainer: {
    width: '100%',
    marginBottom: spacing.base,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.base,
    ...shadows.sm,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  achievementBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent + '20',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    marginTop: spacing.base,
  },
  achievementText: {
    color: colors.accent,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.xs,
  },
});