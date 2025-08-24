import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

const CoachingAnalysisCard = ({ analysis, text }) => {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Swing Analysis</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.coachingText}>{text}</Text>

        {analysis?.symptoms && analysis.symptoms.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Issues Detected:</Text>
            {analysis.symptoms.map((symptom, index) => (
              <View key={index} style={styles.listItem}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.listText}>{symptom}</Text>
              </View>
            ))}
          </View>
        )}

        {analysis?.recommendations && analysis.recommendations.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Practice Recommendations:</Text>
            {analysis.recommendations.map((recommendation, index) => (
              <View key={index} style={styles.recommendationItem}>
                <Text style={styles.recommendationNumber}>{index + 1}.</Text>
                <Text style={styles.recommendationText}>{recommendation}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Ask me any questions about your swing analysis below!
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.base,
    overflow: 'hidden',
  },
  header: {
    backgroundColor: colors.primary,
    padding: spacing.base,
    alignItems: 'center',
  },
  title: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.background,
    fontFamily: typography.fontFamily,
  },
  confidence: {
    fontSize: typography.fontSizes.sm,
    color: colors.background,
    opacity: 0.9,
    marginTop: spacing.xs,
    fontFamily: typography.fontFamily,
  },
  content: {
    padding: spacing.base,
  },
  coachingText: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    lineHeight: 22,
    marginBottom: spacing.base,
    fontFamily: typography.fontFamily,
    fontStyle: 'italic',
  },
  section: {
    marginBottom: spacing.base,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
    fontFamily: typography.fontFamily,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  bullet: {
    fontSize: typography.fontSizes.base,
    color: colors.accent,
    marginRight: spacing.sm,
    marginTop: 2,
    fontFamily: typography.fontFamily,
  },
  listText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 18,
    fontFamily: typography.fontFamily,
  },
  recommendationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    borderRadius: borderRadius.base,
  },
  recommendationNumber: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    marginRight: spacing.sm,
    marginTop: 2,
    fontFamily: typography.fontFamily,
  },
  recommendationText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    flex: 1,
    lineHeight: 18,
    fontFamily: typography.fontFamily,
  },
  footer: {
    backgroundColor: colors.surface,
    padding: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    fontFamily: typography.fontFamily,
    fontStyle: 'italic',
  },
});

export default CoachingAnalysisCard;