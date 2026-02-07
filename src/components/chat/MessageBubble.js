// MessageBubble.js - Chat message rendering
// Coach: borderless markdown (left-aligned, full width) — Claude/ChatGPT style
// User: brandForest bubble (right-aligned, max 85%)
// Video messages show tappable thumbnail via VideoPlayer component
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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

const MessageBubble = ({ message, onVideoPress }) => {
  const isUser = message.sender === 'user';
  const hasVideo = message.type === 'video' && message.videoThumbnail;

  if (isUser) {
    return (
      <View style={styles.userWrapper}>
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
      </View>
    );
  }

  // Coach message: borderless markdown, full width
  return (
    <View style={styles.coachWrapper}>
      <Markdown style={markdownStyles}>{message.text || ''}</Markdown>
    </View>
  );
};

const styles = StyleSheet.create({
  // User messages: right-aligned with brandForest bubble
  userWrapper: {
    marginBottom: spacing.lg,
    alignSelf: 'flex-end',
    maxWidth: '85%',
  },
  userBubble: {
    backgroundColor: colors.primary,
    padding: spacing.base,
    borderRadius: borderRadius.lg,
    borderBottomRightRadius: borderRadius.sm,
  },
  userText: {
    color: colors.white,
    fontSize: typography.fontSizes.base,
    lineHeight: typography.lineHeights.normal * typography.fontSizes.base,
  },

  // Coach messages: borderless, left-aligned, full width
  coachWrapper: {
    marginBottom: spacing.lg,
    alignSelf: 'stretch',
    paddingHorizontal: spacing.xs,
  },
});

export default React.memo(MessageBubble);
