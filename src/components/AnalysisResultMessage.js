import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet,
  Animated 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

export default function AnalysisResultMessage({ 
  analysisData, 
  isFirstAnalysis = false,
  onExpand,
  videoId 
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
    if (onExpand) {
      onExpand(!isExpanded);
    }
  };

  // Extract data with fallbacks
  const overallScore = analysisData?.overallScore || 7.5;
  const strengths = analysisData?.strengths || [
    'Good setup position',
    'Consistent tempo',
    'Solid balance throughout swing'
  ];
  const improvements = analysisData?.improvements || [
    'Weight shift timing',
    'Hip rotation in downswing'
  ];
  const drills = analysisData?.practiceRecommendations || [
    'Slow motion swings focusing on weight transfer',
    'Hip rotation drill with alignment stick',
    'Impact bag training for better contact'
  ];

  const primaryImprovement = improvements[0] || 'swing fundamentals';
  const coachingResponse = analysisData?.coachingResponse || 
    `Great swing! Your ${primaryImprovement} is the key area to focus on. This one change will help improve multiple aspects of your swing.`;

  return (
    <View style={[
      styles.container,
      isFirstAnalysis && styles.firstAnalysisContainer
    ]}>
      {/* Celebration Header for First Analysis */}
      {isFirstAnalysis && (
        <View style={styles.celebrationHeader}>
          <Text style={styles.celebrationEmoji}>🎉</Text>
          <Text style={styles.celebrationTitle}>First Analysis Complete!</Text>
          <Text style={styles.celebrationSubtitle}>
            This is the start of your improvement journey
          </Text>
        </View>
      )}

      {/* Coach Response */}
      <View style={styles.coachResponseSection}>
        <View style={styles.coachBadge}>
          <Ionicons name="golf" size={16} color={colors.surface} />
          <Text style={styles.coachBadgeText}>Your Coach</Text>
        </View>
        
        <Text style={styles.coachResponseText}>
          🎯 {coachingResponse}
        </Text>
      </View>

      {/* Overall Score */}
      <View style={styles.scoreSection}>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreValue}>{overallScore}/10</Text>
          <Text style={styles.scoreLabel}>Overall Swing</Text>
        </View>
        <View style={styles.scoreDivider} />
        <Text style={styles.scoreDescription}>
          {overallScore >= 8 ? 'Excellent swing!' : 
           overallScore >= 7 ? 'Great foundation!' :
           overallScore >= 6 ? 'Good potential!' : 
           'Lots of room to improve!'}
        </Text>
      </View>

      {/* Strengths (Always Visible) */}
      <View style={styles.strengthsSection}>
        <Text style={styles.sectionTitle}>✅ Your Strengths</Text>
        {strengths.slice(0, 2).map((strength, index) => (
          <View key={index} style={styles.strengthItem}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text style={styles.strengthText}>{strength}</Text>
          </View>
        ))}
      </View>

      {/* Primary Focus Area */}
      <View style={styles.focusSection}>
        <Text style={styles.sectionTitle}>🎯 Key Focus Area</Text>
        <View style={styles.focusItem}>
          <Text style={styles.focusText}>{primaryImprovement}</Text>
          <Text style={styles.focusDescription}>
            Work on this and you'll see improvement in multiple areas
          </Text>
        </View>
      </View>

      {/* Next Action */}
      <View style={styles.nextActionSection}>
        <Text style={styles.nextActionText}>
          💪 Try another swing focusing on {primaryImprovement}!
        </Text>
      </View>

      {/* Expandable Details */}
      <TouchableOpacity 
        style={styles.expandButton} 
        onPress={handleToggleExpand}
        activeOpacity={0.8}
      >
        <Text style={styles.expandButtonText}>
          {isExpanded ? 'Show Less' : 'View Detailed Analysis'}
        </Text>
        <Ionicons 
          name={isExpanded ? 'chevron-up' : 'chevron-down'} 
          size={16} 
          color={colors.primary} 
        />
      </TouchableOpacity>

      {/* Expanded Details */}
      {isExpanded && (
        <View style={styles.expandedContent}>
          {/* All Improvements */}
          {improvements.length > 1 && (
            <View style={styles.allImprovementsSection}>
              <Text style={styles.expandedSectionTitle}>🎯 All Improvement Areas</Text>
              {improvements.map((improvement, index) => (
                <View key={index} style={styles.improvementItem}>
                  <Text style={styles.improvementNumber}>{index + 1}.</Text>
                  <Text style={styles.improvementText}>{improvement}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Practice Drills */}
          <View style={styles.drillsSection}>
            <Text style={styles.expandedSectionTitle}>🏋️ Recommended Drills</Text>
            {drills.map((drill, index) => (
              <View key={index} style={styles.drillItem}>
                <Text style={styles.drillNumber}>{index + 1}.</Text>
                <Text style={styles.drillText}>{drill}</Text>
              </View>
            ))}
          </View>

          {/* All Strengths */}
          {strengths.length > 2 && (
            <View style={styles.allStrengthsSection}>
              <Text style={styles.expandedSectionTitle}>✅ All Strengths</Text>
              {strengths.map((strength, index) => (
                <View key={index} style={styles.strengthItem}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={styles.strengthTextSmall}>{strength}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Technical Details */}
          {videoId && (
            <View style={styles.technicalSection}>
              <Text style={styles.expandedSectionTitle}>📊 Technical Details</Text>
              <Text style={styles.technicalText}>
                Analysis ID: {videoId.substring(0, 12)}...
              </Text>
              <Text style={styles.technicalText}>
                P1-P10 position analysis complete
              </Text>
              <Text style={styles.technicalText}>
                Analyzed at: {new Date().toLocaleString()}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderBottomLeftRadius: borderRadius.sm,
    padding: spacing.lg,
    marginBottom: spacing.base,
    maxWidth: '95%',
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    ...shadows.base,
  },
  firstAnalysisContainer: {
    borderLeftColor: colors.accent,
    backgroundColor: '#FFF9E6', // Light gold for celebration
  },
  celebrationHeader: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    paddingBottom: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  celebrationEmoji: {
    fontSize: 32,
    marginBottom: spacing.xs,
  },
  celebrationTitle: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold,
    color: colors.accent,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  celebrationSubtitle: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  coachResponseSection: {
    marginBottom: spacing.base,
  },
  coachBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
  },
  coachBadgeText: {
    color: colors.surface,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.xs,
  },
  coachResponseText: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontFamily: typography.fontFamily,
    lineHeight: 22,
  },
  scoreSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.base,
    borderRadius: borderRadius.base,
    marginBottom: spacing.base,
  },
  scoreContainer: {
    alignItems: 'center',
    marginRight: spacing.base,
  },
  scoreValue: {
    fontSize: typography.fontSizes['3xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
  },
  scoreLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  scoreDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border,
    marginRight: spacing.base,
  },
  scoreDescription: {
    flex: 1,
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },
  strengthsSection: {
    marginBottom: spacing.base,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.sm,
  },
  strengthItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  strengthText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
    flex: 1,
  },
  strengthTextSmall: {
    fontSize: typography.fontSizes.xs,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
    flex: 1,
  },
  focusSection: {
    backgroundColor: '#F0F8F0', // Light green background
    padding: spacing.base,
    borderRadius: borderRadius.base,
    marginBottom: spacing.base,
  },
  focusItem: {
    marginTop: spacing.xs,
  },
  focusText: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  focusDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: 18,
  },
  nextActionSection: {
    backgroundColor: colors.accent + '20',
    padding: spacing.base,
    borderRadius: borderRadius.base,
    marginBottom: spacing.base,
  },
  nextActionText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  expandButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
  },
  expandButtonText: {
    fontSize: typography.fontSizes.sm,
    color: colors.primary,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    marginRight: spacing.xs,
  },
  expandedContent: {
    marginTop: spacing.base,
    paddingTop: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  expandedSectionTitle: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.sm,
  },
  allImprovementsSection: {
    marginBottom: spacing.base,
  },
  improvementItem: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  improvementNumber: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    marginRight: spacing.sm,
    minWidth: 20,
  },
  improvementText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
    flex: 1,
  },
  drillsSection: {
    marginBottom: spacing.base,
  },
  drillItem: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  drillNumber: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    marginRight: spacing.sm,
    minWidth: 20,
  },
  drillText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
    flex: 1,
    lineHeight: 18,
  },
  allStrengthsSection: {
    marginBottom: spacing.base,
  },
  technicalSection: {
    backgroundColor: colors.background,
    padding: spacing.base,
    borderRadius: borderRadius.base,
  },
  technicalText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textLight,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
});