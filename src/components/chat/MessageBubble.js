// MessageBubble.js - Chat message rendering
// Coach: borderless markdown (left-aligned, full width) — Claude/ChatGPT style
// User: brandForest bubble (right-aligned, max 85%)
// Video messages show tappable thumbnail via VideoPlayer component
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { colors, typography, spacing, borderRadius } from '../../utils/theme';
import VideoPlayer from './VideoPlayer';

// Markdown rendering styles for coach messages
const markdownStyles = {
  body: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    lineHeight: typography.lineHeights.relaxed * typography.fontSizes.base,
    fontFamily: typography.fontFamily,
  },
  heading1: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    marginBottom: spacing.sm,
    marginTop: spacing.base,
  },
  heading2: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  heading3: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.coachAccent,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  paragraph: { marginBottom: spacing.sm },
  strong: { fontWeight: typography.fontWeights.bold, color: colors.primary },
  bullet_list: { marginBottom: spacing.xs, marginLeft: spacing.sm },
  list_item: { marginBottom: spacing.xs },
  ordered_list: { marginBottom: spacing.xs, marginLeft: spacing.sm },
};

const formatMessageTime = (createdAt) => {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const MessageBubble = ({ message, onVideoPress }) => {
  const isUser = message.sender === 'user';
  const hasVideo = message.type === 'video' && message.videoUri;
  const timeLabel = formatMessageTime(message.createdAt);

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View style={styles.userContent}>
          {hasVideo && (
            <VideoPlayer
              thumbnailUri={message.videoThumbnail}
              videoUri={message.videoUri}
              duration={message.videoDuration}
              onPress={onVideoPress}
            />
          )}
          {message.text ? (
            <View style={styles.userBubble}>
              <Text style={styles.userText}>{message.text}</Text>
            </View>
          ) : null}
          {timeLabel ? <Text style={styles.userMeta}>{timeLabel}</Text> : null}
        </View>
      </View>
    );
  }

  // Coach message: avatar + surfaced assistant card
  return (
    <View style={styles.coachRow}>
      <View style={styles.coachAvatar} accessibilityLabel="PinHigh coach">
        <Ionicons name="sparkles" size={14} color={colors.coachAccent} />
      </View>
      <View style={styles.coachContent}>
        <View style={styles.coachBubble}>
          <Markdown style={markdownStyles}>{message.text || ''}</Markdown>
        </View>
        {timeLabel ? <Text style={styles.coachMeta}>{timeLabel}</Text> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  userRow: {
    width: '100%',
    alignItems: 'flex-end',
    marginBottom: spacing.lg,
  },
  userContent: {
    width: '85%',
    maxWidth: 420,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderBottomRightRadius: borderRadius.sm,
  },
  userText: {
    color: colors.white,
    fontSize: typography.fontSizes.base,
    lineHeight: typography.lineHeights.normal * typography.fontSizes.base,
  },
  userMeta: {
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
    color: colors.textSecondary,
    fontSize: typography.fontSizes.xs,
  },

  coachRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  coachAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginTop: spacing.xs,
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  coachContent: {
    flex: 1,
    maxWidth: '94%',
  },
  coachBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: borderRadius.lg,
    borderTopLeftRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  coachMeta: {
    marginTop: spacing.xs,
    color: colors.textSecondary,
    fontSize: typography.fontSizes.xs,
  },

  // Legacy styles retained for compatibility with old snapshots/tests
  userWrapper: {
    marginBottom: spacing.lg,
    alignSelf: 'flex-end',
    maxWidth: '85%',
  },
  coachWrapper: {
    marginBottom: spacing.lg,
    alignSelf: 'stretch',
    paddingHorizontal: spacing.xs,
  },
});

export default React.memo(MessageBubble);
