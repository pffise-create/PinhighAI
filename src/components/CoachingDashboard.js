/**
 * CoachingDashboard - Main dashboard container for HomeScreen
 * 
 * Displays coaching overview, session progress, recent analyses,
 * and provides quick access back to chat for authenticated users.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../utils/theme';
import CoachingStatusCard from './CoachingStatusCard';
import RecentAnalysisCard from './RecentAnalysisCard';
import ContinueCoachingButton from './ContinueCoachingButton';

const CoachingDashboard = ({ 
  overview, 
  recentAnalyses = [], 
  navigation,
  onContinueCoaching,
  loading = false 
}) => {
  
  const handleNavigateToAnalysis = (analysis) => {
    navigation.navigate('Chat', {
      focusAnalysisId: analysis.analysisId,
      initialMessage: `Can we review the swing analysis from ${analysis.date}?`,
    });
  };

  const handleNavigateToVideoRecord = () => {
    navigation.navigate('VideoRecord');
  };

  const handleNavigateToGeneralChat = () => {
    navigation.navigate('Chat', {
      initialMessage: 'I have a general golf question...'
    });
  };

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.welcomeTitle}>Welcome back!</Text>
        <Text style={styles.appTitle}>Pin High</Text>
      </View>

      {/* Coaching Status */}
      <CoachingStatusCard
        sessionCount={overview?.sessionCount || 0}
        currentFocus={overview?.currentFocus}
        lastActivity={overview?.lastActivity}
        hasActiveConversation={overview?.hasActiveConversation}
        progressSummary={overview?.progressSummary}
        loading={loading}
      />

      {/* Continue Coaching Action */}
      <ContinueCoachingButton
        onPress={onContinueCoaching}
        context={overview}
        disabled={loading}
        loading={loading}
      />

      {/* Recent Analyses */}
      {recentAnalyses.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Swing Analyses</Text>
          {recentAnalyses.slice(0, 5).map((analysis, index) => (
            <RecentAnalysisCard
              key={analysis.analysisId || index}
              analysis={analysis}
              onPress={() => handleNavigateToAnalysis(analysis)}
            />
          ))}
        </View>
      )}

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <View style={styles.buttonRow}>
          <View style={styles.primaryButtonContainer}>
            <TouchableOpacity 
              style={styles.primaryActionButton}
              onPress={handleNavigateToVideoRecord}
            >
              <Text style={styles.primaryActionText}>Analyze New Swing</Text>
              <Text style={styles.primaryActionSubtext}>Upload or record video</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity 
            style={styles.secondaryActionButton}
            onPress={handleNavigateToGeneralChat}
          >
            <Text style={styles.secondaryActionText}>Ask Coach Anything</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Coaching Focus Summary */}
      {overview?.progressSummary && (
        <View style={styles.progressSection}>
          <Text style={styles.sectionTitle}>What We're Working On</Text>
          <View style={styles.progressCard}>
            {overview.progressSummary.improvementAreas?.map((area, index) => (
              <View key={index} style={styles.focusItem}>
                <View style={styles.focusDot} />
                <Text style={styles.focusText}>
                  {area.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </Text>
              </View>
            ))}
            
            {overview.progressSummary.recentMilestones?.length > 0 && (
              <View style={styles.milestones}>
                <Text style={styles.milestoneTitle}>Recent Progress:</Text>
                {overview.progressSummary.recentMilestones.map((milestone, index) => (
                  <Text key={index} style={styles.milestoneText}>
                    ✓ {milestone.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </Text>
                ))}
              </View>
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  contentContainer: {
    paddingBottom: spacing['2xl'],
  },

  header: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },

  welcomeTitle: {
    fontSize: typography.fontSizes.lg,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },

  appTitle: {
    fontSize: typography.fontSizes['3xl'],
    fontWeight: typography.fontWeights.light,
    color: colors.primary,
    fontFamily: typography.fontFamily,
  },

  section: {
    marginHorizontal: spacing.base,
    marginVertical: spacing.lg,
  },

  sectionTitle: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.base,
  },

  actionButtons: {
    marginHorizontal: spacing.base,
    marginVertical: spacing.lg,
  },

  buttonRow: {
    marginBottom: spacing.base,
  },

  primaryButtonContainer: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },

  primaryActionButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.base,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
  },

  primaryActionText: {
    color: colors.surface,
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },

  primaryActionSubtext: {
    color: colors.surface,
    fontSize: typography.fontSizes.base,
    fontFamily: typography.fontFamily,
    opacity: 0.9,
  },

  secondaryActionButton: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.base,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  secondaryActionText: {
    color: colors.primary,
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },

  progressSection: {
    marginHorizontal: spacing.base,
    marginVertical: spacing.lg,
  },

  progressCard: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },

  focusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },

  focusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginRight: spacing.sm,
  },

  focusText: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontFamily: typography.fontFamily,
  },

  milestones: {
    marginTop: spacing.base,
    paddingTop: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  milestoneTitle: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    fontFamily: typography.fontFamily,
  },

  milestoneText: {
    fontSize: typography.fontSizes.sm,
    color: colors.success,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
});

export default CoachingDashboard;


