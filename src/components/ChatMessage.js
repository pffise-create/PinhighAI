import React from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';
import CoachingAnalysisCard from './CoachingAnalysisCard';

const ChatMessage = ({ message, analysisData }) => {
  const isAI = message.sender === 'ai';

  return (
    <View style={[styles.messageContainer, isAI ? styles.aiMessage : styles.userMessage]}>
      <View style={[styles.messageBubble, isAI ? styles.aiBubble : styles.userBubble]}>
        <Text style={[styles.messageText, isAI ? styles.aiText : styles.userText]}>
          {message.text}
        </Text>

        {message.type === 'coaching_analysis' && message.metadata && (
          <View style={styles.additionalInfo}>
            {message.metadata.symptoms && message.metadata.symptoms.length > 0 && (
              <View style={styles.infoSection}>
                <Text style={[styles.infoTitle, isAI ? styles.aiText : styles.userText]}>Issues Detected:</Text>
                {message.metadata.symptoms.map((symptom, index) => (
                  <Text key={index} style={[styles.infoItem, isAI ? styles.aiText : styles.userText]}>• {symptom}</Text>
                ))}
              </View>
            )}

            {message.metadata.recommendations && message.metadata.recommendations.length > 0 && (
              <View style={styles.infoSection}>
                <Text style={[styles.infoTitle, isAI ? styles.aiText : styles.userText]}>Practice Recommendations:</Text>
                {message.metadata.recommendations.map((recommendation, index) => (
                  <Text key={index} style={[styles.infoItem, isAI ? styles.aiText : styles.userText]}>{index + 1}. {recommendation}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        <Text style={styles.timestamp}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  messageContainer: {
    flexDirection: 'row',
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.base,
  },
  aiMessage: {
    justifyContent: 'flex-start',
  },
  userMessage: {
    justifyContent: 'flex-end',
  },
  aiAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
    marginTop: spacing.xs,
  },
  aiAvatarText: {
    fontSize: 16,
  },
  messageBubble: {
    maxWidth: '95%',
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginVertical: spacing.xs,
  },
  aiBubble: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: spacing.xs,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: spacing.xs,
    alignSelf: 'flex-end',
  },
  messageText: {
    fontSize: typography.fontSizes.base,
    lineHeight: 20,
    fontFamily: typography.fontFamily,
  },
  aiText: {
    color: colors.text,
  },
  userText: {
    color: colors.background,
  },
  timestamp: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontFamily: typography.fontFamily,
    opacity: 0.7,
  },
  additionalInfo: {
    marginTop: spacing.sm,
  },
  infoSection: {
    marginBottom: spacing.sm,
  },
  infoTitle: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    marginBottom: spacing.xs,
    fontFamily: typography.fontFamily,
  },
  infoItem: {
    fontSize: typography.fontSizes.sm,
    marginBottom: spacing.xs,
    fontFamily: typography.fontFamily,
    lineHeight: 18,
  },
});

export default ChatMessage;