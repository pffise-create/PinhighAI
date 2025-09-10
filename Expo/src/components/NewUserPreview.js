import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

export default function NewUserPreview({ onStartJourney }) {
  return (
    <View style={styles.container}>
      <View style={styles.welcomeCard}>
        <View style={styles.header}>
          <Text style={styles.welcomeEmoji}>👋</Text>
          <Text style={styles.welcomeTitle}>Welcome to Pin High!</Text>
          <Text style={styles.welcomeSubtitle}>
            Your personalized golf coaching journey is about to begin
          </Text>
        </View>

        <View style={styles.previewSection}>
          <Text style={styles.previewTitle}>What you'll see here soon:</Text>
          
          <View style={styles.previewItems}>
            <View style={styles.previewItem}>
              <View style={[styles.previewIcon, { backgroundColor: colors.success + '20' }]}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              </View>
              <View style={styles.previewContent}>
                <Text style={styles.previewItemTitle}>Your Strengths</Text>
                <Text style={styles.previewItemDesc}>
                  Celebrate what you're doing well in your swing
                </Text>
              </View>
            </View>

            <View style={styles.previewItem}>
              <View style={[styles.previewIcon, { backgroundColor: colors.primary + '20' }]}>
                <Ionicons name="trending-up" size={20} color={colors.primary} />
              </View>
              <View style={styles.previewContent}>
                <Text style={styles.previewItemTitle}>Focus Areas</Text>
                <Text style={styles.previewItemDesc}>
                  Key areas to work on for maximum improvement
                </Text>
              </View>
            </View>

            <View style={styles.previewItem}>
              <View style={[styles.previewIcon, { backgroundColor: colors.accent + '20' }]}>
                <Ionicons name="fitness" size={20} color={colors.accent} />
              </View>
              <View style={styles.previewContent}>
                <Text style={styles.previewItemTitle}>Practice Drills</Text>
                <Text style={styles.previewItemDesc}>
                  Personalized drills based on your swing analysis
                </Text>
              </View>
            </View>

            <View style={styles.previewItem}>
              <View style={[styles.previewIcon, { backgroundColor: colors.warning + '20' }]}>
                <Ionicons name="analytics" size={20} color={colors.warning} />
              </View>
              <View style={styles.previewContent}>
                <Text style={styles.previewItemTitle}>Progress Tracking</Text>
                <Text style={styles.previewItemDesc}>
                  Watch your improvement over time with detailed metrics
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.actionSection}>
          <TouchableOpacity 
            style={styles.startButton}
            onPress={onStartJourney}
            activeOpacity={0.8}
          >
            <Ionicons name="videocam" size={20} color={colors.surface} />
            <Text style={styles.startButtonText}>Upload Your First Swing</Text>
          </TouchableOpacity>
          
          <Text style={styles.encouragementText}>
            🎯 Every great golfer started with their first analysis
          </Text>
        </View>
      </View>

      <View style={styles.tipsCard}>
        <View style={styles.tipsHeader}>
          <Ionicons name="lightbulb" size={20} color={colors.accent} />
          <Text style={styles.tipsTitle}>Recording Tips</Text>
        </View>
        
        <View style={styles.tipsList}>
          <View style={styles.tip}>
            <Ionicons name="videocam" size={14} color={colors.textSecondary} />
            <Text style={styles.tipText}>Record from the side (profile view)</Text>
          </View>
          <View style={styles.tip}>
            <Ionicons name="golf" size={14} color={colors.textSecondary} />
            <Text style={styles.tipText}>Include setup through follow-through</Text>
          </View>
          <View style={styles.tip}>
            <Ionicons name="sunny" size={14} color={colors.textSecondary} />
            <Text style={styles.tipText}>Good lighting, steady camera</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  welcomeCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    marginBottom: spacing.base,
    ...shadows.base,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  welcomeEmoji: {
    fontSize: 48,
    marginBottom: spacing.base,
  },
  welcomeTitle: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  welcomeSubtitle: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    lineHeight: 22,
  },
  previewSection: {
    marginBottom: spacing.xl,
  },
  previewTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.base,
    textAlign: 'center',
  },
  previewItems: {
    marginTop: spacing.base,
  },
  previewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.base,
    backgroundColor: colors.background,
    padding: spacing.base,
    borderRadius: borderRadius.base,
  },
  previewIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.base,
  },
  previewContent: {
    flex: 1,
  },
  previewItemTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  previewItemDesc: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: 18,
  },
  actionSection: {
    alignItems: 'center',
  },
  startButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.base,
    ...shadows.sm,
  },
  startButtonText: {
    color: colors.surface,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  encouragementText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  tipsCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    ...shadows.base,
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.base,
  },
  tipsTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  tipsList: {
    marginLeft: spacing.base,
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  tipText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
    flex: 1,
  },
});