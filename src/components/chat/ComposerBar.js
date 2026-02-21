// ComposerBar.js - Input area: attachment button + pill TextInput + send button
// Shows video preview row when video is selected. All touch targets >= 44px.
import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius } from '../../utils/theme';

const ComposerBar = ({
  inputText,
  onChangeText,
  onSend,
  onAttachmentPress,
  isSending,
  selectedVideo,
  videoThumbnail,
  onClearVideo,
}) => {
  const hasContent = inputText.trim().length > 0 || !!selectedVideo;
  const isDisabled = !hasContent || isSending;

  return (
    <View style={styles.container}>
      {/* Video preview row */}
      {selectedVideo && (
        <View style={styles.videoCard}>
          <View style={styles.videoPreviewRow}>
            {videoThumbnail ? (
              <Image source={{ uri: videoThumbnail }} style={styles.videoThumb} />
            ) : (
              <View style={[styles.videoThumb, styles.videoThumbFallback]}>
                <Ionicons name="videocam" size={20} color={colors.white} />
              </View>
            )}
            <View style={styles.videoMeta}>
              <Text style={styles.videoTitle}>Swing clip ready</Text>
              <Text style={styles.videoSubtitle}>
                {selectedVideo.duration?.toFixed(1)}s
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClearVideo}
              accessibilityLabel="Remove selected video"
              accessibilityRole="button"
              style={styles.videoDismissButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Composer row */}
      <View style={styles.composerRow}>
        <TouchableOpacity
          style={styles.attachButton}
          onPress={onAttachmentPress}
          accessibilityLabel="Attach swing video"
          accessibilityRole="button"
        >
          <Ionicons name="camera" size={22} color={colors.primary} />
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          value={inputText}
          placeholder={
            selectedVideo ? 'Add a note for your coach...' : 'Ask your coach anything...'
          }
          placeholderTextColor={colors.textSecondary}
          onChangeText={onChangeText}
          multiline
          maxLength={2000}
        />

        <TouchableOpacity
          style={[styles.sendButton, isDisabled && styles.sendButtonDisabled]}
          onPress={onSend}
          disabled={isDisabled}
          accessibilityLabel={selectedVideo ? 'Send video' : 'Send message'}
          accessibilityRole="button"
          accessibilityState={{ disabled: isDisabled }}
        >
          {isSending ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Ionicons name="arrow-up" size={18} color={colors.white} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
  },
  videoCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  videoPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  videoThumb: {
    width: 96,
    height: 54,
    borderRadius: borderRadius.md,
    marginRight: spacing.md,
  },
  videoThumbFallback: {
    backgroundColor: colors.textLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoMeta: {
    flex: 1,
  },
  videoTitle: {
    fontWeight: typography.fontWeights.semibold,
    fontSize: typography.fontSizes.base,
    color: colors.text,
  },
  videoSubtitle: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
  },
  videoDismissButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  attachButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
    color: colors.text,
    fontSize: typography.fontSizes.base,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
});

export default React.memo(ComposerBar);
