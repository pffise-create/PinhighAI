import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

export default function ProgressiveOnboardingMessage({ 
  type, 
  onActionPress, 
  onDismiss,
  customMessage 
}) {
  const getOnboardingContent = () => {
    switch (type) {
      case 'firstTime':
        return {
          emoji: '👋',
          title: 'Welcome to Pin High!',
          message: customMessage || "Hi! I'm your AI golf coach. Ready to analyze your swing? Tap 📹 above to start!",
          actionText: 'Upload First Video',
          celebratory: false,
        };
      
      case 'postUpload':
        return {
          emoji: '⏳',
          title: 'Analyzing Your Swing',
          message: customMessage || "Perfect! Your video is uploaded. I'm analyzing your swing now - this takes about 30 seconds...",
          actionText: null,
          celebratory: false,
        };
      
      case 'firstAnalysisComplete':
        return {
          emoji: '🎯',
          title: 'First Analysis Complete!',
          message: customMessage || "🎉 Your first swing analysis is complete! This is the beginning of your improvement journey. Ask me anything about your technique.",
          actionText: 'See My Analysis',
          celebratory: true,
        };
      
      case 'returningUser':
        return {
          emoji: '🏌️',
          title: 'Welcome Back!',
          message: customMessage || "Ready to analyze another swing or ask about your previous analysis?",
          actionText: 'Upload Another Video',
          celebratory: false,
        };
      
      case 'encouragement':
        return {
          emoji: '💪',
          title: 'Keep It Up!',
          message: customMessage || "You're building great momentum with your practice! Every swing gets you closer to your goals.",
          actionText: null,
          celebratory: true,
        };
      
      default:
        return {
          emoji: '⛳',
          title: 'Let\'s Improve Your Game',
          message: customMessage || "I'm here to help you become a better golfer. What would you like to work on?",
          actionText: null,
          celebratory: false,
        };
    }
  };

  const content = getOnboardingContent();

  return (
    <View style={[
      styles.container,
      content.celebratory && styles.celebratoryContainer
    ]}>
      <View style={styles.header}>
        <Text style={styles.emoji}>{content.emoji}</Text>
        <Text style={styles.title}>{content.title}</Text>
      </View>
      
      <Text style={styles.message}>{content.message}</Text>
      
      {content.actionText && (
        <TouchableOpacity 
          style={[
            styles.actionButton,
            content.celebratory && styles.celebratoryButton
          ]}
          onPress={onActionPress}
          activeOpacity={0.8}
        >
          <Text style={styles.actionButtonText}>{content.actionText}</Text>
        </TouchableOpacity>
      )}
      
      {onDismiss && (
        <TouchableOpacity style={styles.dismissButton} onPress={onDismiss}>
          <Text style={styles.dismissText}>Got it</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    ...shadows.base,
  },
  celebratoryContainer: {
    borderLeftColor: colors.accent,
    backgroundColor: '#FFF9E6', // Light gold background for celebrations
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  emoji: {
    fontSize: 24,
    marginRight: spacing.sm,
  },
  title: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    flex: 1,
  },
  message: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    lineHeight: 22,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.base,
  },
  actionButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.base,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  celebratoryButton: {
    backgroundColor: colors.accent,
  },
  actionButtonText: {
    color: colors.surface,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },
  dismissButton: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  dismissText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
    fontFamily: typography.fontFamily,
  },
});