import React from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';
import CoachingAnalysisCard from './CoachingAnalysisCard';

const ChatMessage = ({ message, analysisData }) => {
  const isAI = message.sender === 'ai';

  // Markdown styles for coach messages
  const markdownStyles = {
    body: {
      fontSize: typography.fontSizes.base,
      color: isAI ? colors.background : colors.text,
      lineHeight: typography.lineHeights.relaxed * typography.fontSizes.base,
      fontFamily: typography.fontFamily,
    },
    heading1: {
      fontSize: typography.fontSizes['2xl'],
      fontWeight: typography.fontWeights.bold,
      color: isAI ? colors.background : colors.primary,
      marginBottom: spacing.sm,
      marginTop: spacing.base,
    },
    heading2: {
      fontSize: typography.fontSizes.xl,
      fontWeight: typography.fontWeights.semibold,
      color: isAI ? colors.background : colors.primary,
      marginBottom: spacing.xs,
      marginTop: spacing.sm,
    },
    heading3: {
      fontSize: typography.fontSizes.lg,
      fontWeight: typography.fontWeights.semibold,
      color: isAI ? colors.background : colors.coachAccent,
      marginBottom: spacing.xs,
      marginTop: spacing.sm,
    },
    strong: {
      fontWeight: typography.fontWeights.bold,
      color: isAI ? colors.background : colors.coachAccent,
    },
    em: {
      fontStyle: 'italic',
      color: isAI ? colors.background : colors.primary,
    },
    bullet_list: {
      marginBottom: spacing.sm,
    },
    ordered_list: {
      marginBottom: spacing.sm,
    },
    list_item: {
      marginBottom: spacing.xs,
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    bullet_list_icon: {
      color: isAI ? colors.background : colors.coachAccent,
      fontSize: typography.fontSizes.base,
      marginRight: spacing.xs,
      marginTop: 2,
    },
    paragraph: {
      marginBottom: spacing.sm,
      fontSize: typography.fontSizes.base,
      lineHeight: typography.lineHeights.relaxed * typography.fontSizes.base,
    },
  };

  const renderMessageText = (text) => {
    if (!text) return null;
    
    // Use markdown for AI messages, plain text for user messages
    if (isAI) {
      return (
        <Markdown style={markdownStyles}>
          {text}
        </Markdown>
      );
    } else {
      return (
        <Text style={[styles.messageText, styles.userText]}>
          {text}
        </Text>
      );
    }
  };

  return (
    <View style={[styles.messageContainer, isAI ? styles.aiMessage : styles.userMessage]}>
      <View style={[styles.messageBubble, isAI ? styles.aiBubble : styles.userBubble]}>
        {renderMessageText(message.text)}

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