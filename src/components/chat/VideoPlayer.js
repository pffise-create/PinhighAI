// VideoPlayer.js - Tappable thumbnail with play icon overlay
// Pure display component — no hooks, no modal. Parent owns playback modal.
import React from 'react';
import {
  View,
  Image,
  TouchableOpacity,
  StyleSheet,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius } from '../../utils/theme';

const VideoPlayer = ({ thumbnailUri, videoUri, duration, onPress }) => (
  <TouchableOpacity
    style={styles.thumbnailContainer}
    onPress={() => onPress?.(videoUri)}
    activeOpacity={0.85}
    accessibilityLabel={`Play swing video${duration ? `, ${duration.toFixed(1)} seconds` : ''}`}
    accessibilityRole="button"
  >
    {thumbnailUri ? (
      <Image source={{ uri: thumbnailUri }} style={styles.thumbnail} />
    ) : (
      <View style={[styles.thumbnail, styles.thumbnailFallback]}>
        <Ionicons name="videocam" size={32} color={colors.white} />
      </View>
    )}
    <View style={styles.playOverlay}>
      <Ionicons name="play" size={28} color={colors.white} />
    </View>
    {duration > 0 && (
      <View style={styles.durationBadge}>
        <Text style={styles.durationText}>{duration.toFixed(1)}s</Text>
      </View>
    )}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  thumbnailContainer: {
    width: '100%',
    height: 180,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbnailFallback: {
    backgroundColor: colors.textLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.overlayLight,
  },
  durationBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.overlayMedium,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: borderRadius.sm,
  },
  durationText: {
    color: colors.white,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
});

export default React.memo(VideoPlayer);
