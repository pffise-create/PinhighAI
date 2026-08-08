import React from 'react';
import {
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, colors, spacing, typography } from '../../utils/theme';

function pickActiveCue(cues, currentTime) {
  if (!Array.isArray(cues) || cues.length === 0) return null;
  return (
    cues.find((cue) => currentTime >= cue.start_seconds && currentTime <= cue.end_seconds) ||
    cues[cues.length - 1] ||
    null
  );
}

const BreakdownVideoModalInner = ({ breakdown, onClose }) => {
  const cues = Array.isArray(breakdown?.scenes) ? breakdown.scenes : [];
  const startMuted = breakdown?.muted_default !== false;
  const [isMuted, setIsMuted] = React.useState(startMuted);
  const [activeCue, setActiveCue] = React.useState(cues[0] || null);

  const player = useVideoPlayer(breakdown?.video_url, (instance) => {
    instance.loop = false;
    instance.muted = startMuted;
    instance.timeUpdateEventInterval = 0.1;
    instance.play();
  });

  React.useEffect(() => {
    if (!player) return undefined;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      setActiveCue(pickActiveCue(cues, currentTime));
    });
    return () => {
      sub?.remove?.();
      player.timeUpdateEventInterval = 0;
    };
  }, [cues, player]);

  const handleToggleMute = React.useCallback(() => {
    if (!player) return;
    const nextMuted = !isMuted;
    player.muted = nextMuted;
    setIsMuted(nextMuted);
  }, [isMuted, player]);

  const handleClose = React.useCallback(() => {
    player?.pause?.();
    onClose?.();
  }, [onClose, player]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Back to chat"
        >
          <Ionicons name="chevron-back" size={18} color={colors.white} />
          <Text style={styles.headerButtonText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{breakdown?.title || 'Swing Breakdown'}</Text>
          <Text style={styles.headerSubtitle}>Captions on</Text>
        </View>

        <TouchableOpacity
          style={styles.headerButton}
          onPress={handleToggleMute}
          accessibilityRole="button"
          accessibilityLabel={isMuted ? 'Unmute breakdown audio' : 'Mute breakdown audio'}
        >
          <Ionicons
            name={isMuted ? 'volume-mute' : 'volume-high'}
            size={18}
            color={colors.white}
          />
          <Text style={styles.headerButtonText}>{isMuted ? 'Unmute' : 'Mute'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.videoShell}>
        {player ? (
          <VideoView
            player={player}
            style={styles.videoView}
            nativeControls
            contentFit="contain"
          />
        ) : null}

        {activeCue?.caption ? (
          <View style={styles.captionWrap} pointerEvents="none">
            {activeCue.headline ? (
              <Text style={styles.captionHeadline}>{activeCue.headline}</Text>
            ) : null}
            <Text style={styles.captionText}>{activeCue.caption}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <View style={styles.footerPill}>
          <Ionicons name="volume-mute" size={14} color={colors.primary} />
          <Text style={styles.footerPillText}>Starts muted for public viewing</Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const BreakdownVideoModal = ({ visible, breakdown, onClose }) => (
  <Modal
    visible={visible}
    animationType="slide"
    presentationStyle="fullScreen"
    onRequestClose={onClose}
  >
    {visible && breakdown?.video_url ? (
      <BreakdownVideoModalInner breakdown={breakdown} onClose={onClose} />
    ) : null}
  </Modal>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.black,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  headerButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.overlayMedium,
  },
  headerButtonText: {
    color: colors.white,
    marginLeft: 4,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  headerTitle: {
    color: colors.white,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: typography.fontSizes.xs,
    marginTop: 2,
  },
  videoShell: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.black,
  },
  videoView: {
    width: '100%',
    height: '100%',
  },
  captionWrap: {
    position: 'absolute',
    left: spacing.base,
    right: spacing.base,
    bottom: spacing.xl,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  captionHeadline: {
    color: colors.coachAccentLight,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  captionText: {
    color: colors.white,
    fontSize: typography.fontSizes.base,
    lineHeight: typography.baseLh,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  footerPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  footerPillText: {
    marginLeft: 6,
    color: colors.primary,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
  },
});

export default React.memo(BreakdownVideoModal);
