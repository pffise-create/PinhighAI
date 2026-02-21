import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

export default function FirstSwingInsights({ 
  analysis, 
  encouragement,
  onAnalyzeAnother,
  onViewFullAnalysis 
}) {
  const overallScore = analysis?.overallScore || 7.5;
  const strengths = analysis?.strengths || ['Good foundation'];
  const improvements = analysis?.improvements || ['Weight shift timing'];

  return (
    <View style={styles.container}>
      <View style={styles.celebrationCard}>
        <View style={styles.header}>
          <Text style={styles.celebrationEmoji}>🎉</Text>
          <Text style={styles.title}>Great Start!</Text>
          <Text style={styles.subtitle}>Here's what we learned from your first swing</Text>
        </View>

        <View style={styles.scoreSection}>
          <View style={styles.scoreCircle}>
            <Text style={styles.scoreValue}>{overallScore}</Text>
            <Text style={styles.scoreMax}>/10</Text>
          </View>
          <Text style={styles.scoreLabel}>Your First Score</Text>
        </View>

        <View style={styles.insightsSection}>
          <View style={styles.strengthsPreview}>
            <View style={styles.insightHeader}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={styles.insightTitle}>What You Did Well</Text>
            </View>
            <Text style={styles.strengthText}>
              {strengths[0] || 'Good swing foundation'}
            </Text>
          </View>

          <View style={styles.improvementsPreview}>
            <View style={styles.insightHeader}>
              <Ionicons name="trending-up" size={20} color={colors.primary} />
              <Text style={styles.insightTitle}>Your Focus Area</Text>
            </View>
            <Text style={styles.improvementText}>
              {improvements[0] || 'Swing fundamentals'}
            </Text>
            <Text style={styles.improvementDesc}>
              This is your key area for improvement. Focus on this and you'll see progress across your entire swing.
            </Text>
          </View>
        </View>

        <View style={styles.encouragementSection}>
          <Text style={styles.encouragementText}>
            {encouragement || "More videos will unlock detailed progress tracking and personalized coaching insights!"}
          </Text>
        </View>

        <View style={styles.actionButtons}>
          <TouchableOpacity 
            style={styles.primaryButton}
            onPress={onAnalyzeAnother}
            activeOpacity={0.8}
          >
            <Ionicons name="videocam" size={18} color={colors.surface} />
            <Text style={styles.primaryButtonText}>Analyze Another Swing</Text>
          </TouchableOpacity>

          {onViewFullAnalysis && (
            <TouchableOpacity 
              style={styles.secondaryButton}
              onPress={onViewFullAnalysis}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>View Full Analysis</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.nextStepsCard}>
        <View style={styles.nextStepsHeader}>
          <Ionicons name="map" size={20} color={colors.primary} />
          <Text style={styles.nextStepsTitle}>Your Coaching Journey</Text>
        </View>

        <View style={styles.journeySteps}>
          <View style={styles.journeyStep}>
            <View style={[styles.stepIndicator, styles.completedStep]}>
              <Ionicons name="checkmark" size={14} color={colors.surface} />
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>First Analysis Complete</Text>
              <Text style={styles.stepDesc}>You've established your baseline!</Text>
            </View>
          </View>

          <View style={styles.journeyStep}>
            <View style={[styles.stepIndicator, styles.nextStep]}>
              <Text style={styles.stepNumber}>2</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Upload More Swings</Text>
              <Text style={styles.stepDesc}>Track improvement and identify patterns</Text>
            </View>
          </View>

          <View style={styles.journeyStep}>
            <View style={[styles.stepIndicator, styles.futureStep]}>
              <Text style={styles.stepNumber}>3</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Detailed Progress</Text>
              <Text style={styles.stepDesc}>Unlock advanced coaching insights</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.motivationCard}>
        <View style={styles.motivationContent}>
          <Text style={styles.motivationTitle}>💪 Keep Building Momentum!</Text>
          <Text style={styles.motivationText}>
            Every professional golfer uses video analysis. You're on the right path to improvement!
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  celebrationCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    marginBottom: spacing.base,
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
    ...shadows.base,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  celebrationEmoji: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    lineHeight: 20,
  },
  scoreSection: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  scoreCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.success,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
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
  insightsSection: {
    marginBottom: spacing.lg,
  },
  strengthsPreview: {
    backgroundColor: colors.success + '10',
    padding: spacing.base,
    borderRadius: borderRadius.base,
    marginBottom: spacing.base,
  },
  improvementsPreview: {
    backgroundColor: colors.primary + '10',
    padding: spacing.base,
    borderRadius: borderRadius.base,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  insightTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  strengthText: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  improvementText: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    marginBottom: spacing.xs,
  },
  improvementDesc: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: 18,
  },
  encouragementSection: {
    backgroundColor: colors.accent + '10',
    padding: spacing.base,
    borderRadius: borderRadius.base,
    marginBottom: spacing.lg,
  },
  encouragementText: {
    fontSize: typography.fontSizes.sm,
    color: colors.accent,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    lineHeight: 20,
    fontWeight: typography.fontWeights.medium,
  },
  actionButtons: {
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  secondaryButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },
  nextStepsCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.base,
    ...shadows.base,
  },
  nextStepsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.base,
  },
  nextStepsTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  journeySteps: {
    marginLeft: spacing.sm,
  },
  journeyStep: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.base,
  },
  stepIndicator: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.base,
  },
  completedStep: {
    backgroundColor: colors.success,
  },
  nextStep: {
    backgroundColor: colors.primary,
  },
  futureStep: {
    backgroundColor: colors.textSecondary,
  },
  stepNumber: {
    color: colors.surface,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  stepDesc: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  motivationCard: {
    backgroundColor: colors.accent + '10',
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    ...shadows.sm,
  },
  motivationContent: {
    alignItems: 'center',
  },
  motivationTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.accent,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.sm,
  },
  motivationText: {
    fontSize: typography.fontSizes.sm,
    color: colors.accent,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    lineHeight: 18,
  },
});