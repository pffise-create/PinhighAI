import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { colors, typography, radius, shadows } from '../utils/theme';

export function ChatBubble({
  type,
  content,
  imageUrl,
  isLoading,
  hasError,
  timestamp,
  onRetry,
}) {
  const isUser = type === 'user';
  const isCoach = type === 'coach' || type === 'assistant';
  const isSystem = type === 'system';

  if (isSystem) {
    return (
      <View style={styles.systemContainer}>
        <View style={styles.systemBubble}>
          <Text style={styles.systemText}>{content}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, isUser && styles.containerUser]}>
      <View style={[styles.maxWidth, isUser && styles.alignEnd]}>
        <View
          style={[
            styles.bubble,
            isUser ? styles.bubbleUser : styles.bubbleCoach,
          ]}
        >
          {isLoading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={colors.textSecondary} size="small" />
              <Text style={styles.loadingText}>Coach is thinking...</Text>
            </View>
          )}

          {content && !isLoading && (
            <Text style={[styles.content, isUser && styles.contentUser]}>
              {content}
            </Text>
          )}

          {imageUrl && (
            <Image
              source={{ uri: imageUrl }}
              style={styles.attachedImage}
              resizeMode="cover"
            />
          )}

          {hasError && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>Failed to send</Text>
              {onRetry && (
                <TouchableOpacity onPress={onRetry}>
                  <Text style={styles.retryText}>Try again</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {timestamp && (
          <Text style={styles.timestamp}>{timestamp}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  containerUser: {
    justifyContent: 'flex-end',
  },
  maxWidth: {
    maxWidth: '85%',
    alignItems: 'flex-start',
  },
  alignEnd: {
    alignItems: 'flex-end',
  },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  bubbleUser: {
    backgroundColor: colors.brandFern,
    borderBottomRightRadius: radius.md,
    ...shadows.sm,
  },
  bubbleCoach: {
    backgroundColor: colors.surfaceElevated,
    borderBottomLeftRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.xs,
  },
  content: {
    fontSize: typography.base,
    lineHeight: typography.baseLh,
    color: colors.textPrimary,
  },
  contentUser: {
    color: colors.textInverse,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: typography.sm,
    lineHeight: typography.smLh,
    color: colors.textSecondary,
  },
  attachedImage: {
    width: '100%',
    height: 200,
    borderRadius: radius.md,
    marginTop: 8,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  errorText: {
    fontSize: typography.sm,
    lineHeight: typography.smLh,
    color: colors.statusError,
  },
  retryText: {
    fontSize: typography.sm,
    lineHeight: typography.smLh,
    color: colors.statusError,
    textDecorationLine: 'underline',
    fontWeight: typography.medium,
  },
  timestamp: {
    fontSize: typography.xs,
    lineHeight: typography.xsLh,
    color: colors.textSecondary,
    marginTop: 4,
    marginHorizontal: 8,
  },
  systemContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  systemBubble: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  systemText: {
    fontSize: typography.sm,
    lineHeight: typography.smLh,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

export default ChatBubble;
