import React from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, colors, shadows, spacing, typography } from '../../utils/theme';

const STATUS_COPY = {
  idle: {
    title: 'Video Breakdown',
    body: 'Get a short narrated walkthrough of the key swing moments.',
    cta: 'Generate Breakdown',
    icon: 'play-circle',
  },
  queued: {
    title: 'Video Breakdown',
    body: 'Queued now. This should land in under 30 seconds.',
    cta: null,
    icon: 'time-outline',
  },
  processing: {
    title: 'Rendering Breakdown',
    body: 'Building the key frames, voiceover, and caption track.',
    cta: null,
    icon: 'sync',
  },
  failed: {
    title: 'Breakdown Unavailable',
    body: 'The first render missed. Try again and I’ll rebuild it.',
    cta: 'Try Again',
    icon: 'refresh',
  },
};

function formatDuration(durationSeconds) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return `${duration.toFixed(1)}s`;
}

export default function VideoBreakdownCard({
  breakdown,
  onGenerate,
  onPress,
  disabled = false,
}) {
  const status = breakdown?.status || 'idle';
  const copy = STATUS_COPY[status] || STATUS_COPY.idle;
  const durationLabel = formatDuration(breakdown?.duration_seconds);
  const isReady = status === 'completed' && breakdown?.video_url;
  const isBusy = status === 'queued' || status === 'processing';

  if (isReady) {
    return (
      <TouchableOpacity
        style={styles.readyCard}
        activeOpacity={0.92}
        onPress={() => onPress?.(breakdown)}
        accessibilityRole="button"
        accessibilityLabel="Play narrated swing breakdown"
      >
        <View style={styles.readyHeader}>
          <View>
            <Text style={styles.readyEyebrow}>Video Breakdown</Text>
            <Text style={styles.readyTitle}>{breakdown.title || 'Swing Breakdown'}</Text>
          </View>
          <View style={styles.muteBadge}>
            <Ionicons name="volume-mute" size={14} color={colors.primary} />
            <Text style={styles.muteBadgeText}>Muted by default</Text>
          </View>
        </View>

        <View style={styles.posterShell}>
          {breakdown.poster_url ? (
            <Image source={{ uri: breakdown.poster_url }} style={styles.posterImage} />
          ) : (
            <View style={[styles.posterImage, styles.posterFallback]}>
              <Ionicons name="videocam" size={30} color={colors.white} />
            </View>
          )}
          <View style={styles.posterShade} />
          <View style={styles.playBadge}>
            <Ionicons name="play" size={18} color={colors.white} />
          </View>
          {durationLabel ? (
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>{durationLabel}</Text>
            </View>
          ) : null}
          <View style={styles.captionBadge}>
            <Ionicons name="reader-outline" size={12} color={colors.white} />
            <Text style={styles.captionBadgeText}>Captions on</Text>
          </View>
        </View>

        <Text style={styles.summaryText}>
          {breakdown.summary || 'A narrated walkthrough of your key swing moments.'}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.statusCard}>
      <View style={styles.statusIconWrap}>
        {isBusy ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Ionicons name={copy.icon} size={18} color={colors.primary} />
        )}
      </View>
      <View style={styles.statusContent}>
        <Text style={styles.statusTitle}>{copy.title}</Text>
        <Text style={styles.statusBody}>
          {breakdown?.error_message && status === 'failed'
            ? breakdown.error_message
            : copy.body}
        </Text>
        <View style={styles.statusMetaRow}>
          <View style={styles.metaPill}>
            <Ionicons name="volume-mute" size={12} color={colors.primary} />
            <Text style={styles.metaPillText}>Mute first</Text>
          </View>
          <View style={styles.metaPill}>
            <Ionicons name="reader-outline" size={12} color={colors.primary} />
            <Text style={styles.metaPillText}>Captions on</Text>
          </View>
        </View>
        {copy.cta ? (
          <TouchableOpacity
            style={[styles.ctaButton, disabled && styles.ctaButtonDisabled]}
            disabled={disabled}
            onPress={onGenerate}
            accessibilityRole="button"
            accessibilityLabel={copy.cta}
          >
            <Text style={styles.ctaButtonText}>{copy.cta}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readyCard: {
    marginTop: spacing.base,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.sm,
  },
  readyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  readyEyebrow: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  readyTitle: {
    color: colors.text,
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold,
  },
  muteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundMuted,
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  muteBadgeText: {
    marginLeft: 4,
    color: colors.primary,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
  posterShell: {
    position: 'relative',
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: colors.backgroundMuted,
    aspectRatio: 3 / 4,
    marginBottom: spacing.sm,
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryDark,
  },
  posterShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayLight,
  },
  playBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -22 }, { translateY: -22 }],
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.overlayMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationBadge: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.overlayMedium,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  durationText: {
    color: colors.white,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
  captionBadge: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.pill,
    backgroundColor: colors.overlayMedium,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  captionBadgeText: {
    marginLeft: 4,
    color: colors.white,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
  summaryText: {
    color: colors.text,
    fontSize: typography.fontSizes.sm,
    lineHeight: 20,
  },
  statusCard: {
    marginTop: spacing.base,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    flexDirection: 'row',
    alignItems: 'flex-start',
    ...shadows.xs,
  },
  statusIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.backgroundMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  statusContent: {
    flex: 1,
  },
  statusTitle: {
    color: colors.text,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    marginBottom: 4,
  },
  statusBody: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
    lineHeight: 20,
  },
  statusMetaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundMuted,
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  metaPillText: {
    marginLeft: 4,
    color: colors.primary,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
  ctaButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    borderRadius: borderRadius.pill,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  ctaButtonDisabled: {
    opacity: 0.5,
  },
  ctaButtonText: {
    color: colors.white,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
  },
});
