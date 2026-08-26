import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, colors, shadows, spacing, typography } from '../../utils/theme';

const VIDEO_CARD_ASPECT_RATIO = 9 / 16;
const TRANSCRIPT_PREVIEW_LINES = 2;

function formatClock(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function normalizeDuration(breakdown) {
  const explicitDuration = Number(breakdown?.duration_seconds);
  if (Number.isFinite(explicitDuration) && explicitDuration > 0) {
    return explicitDuration;
  }

  const scenes = Array.isArray(breakdown?.scenes) ? breakdown.scenes : [];
  const lastScene = scenes[scenes.length - 1];
  const tail = Number(lastScene?.end_seconds);
  return Number.isFinite(tail) && tail > 0 ? tail : 0;
}

function getCueIndexAtTime(cues, currentTime) {
  if (!Array.isArray(cues) || cues.length === 0) return -1;

  const exactIndex = cues.findIndex(
    (cue) => currentTime >= cue.start_seconds && currentTime < cue.end_seconds
  );
  if (exactIndex >= 0) return exactIndex;

  const previousIndex = [...cues]
    .reverse()
    .findIndex((cue) => currentTime >= cue.start_seconds);
  if (previousIndex >= 0) {
    return cues.length - previousIndex - 1;
  }

  return 0;
}

function clampTime(seconds, durationSeconds) {
  const maxDuration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : 0;
  return Math.max(0, Math.min(Number(seconds) || 0, maxDuration));
}

const BreakdownVideoModalInner = ({ breakdown, onClose }) => {
  const cues = React.useMemo(
    () => (Array.isArray(breakdown?.scenes) ? breakdown.scenes : []),
    [breakdown?.scenes]
  );
  const durationFallback = React.useMemo(() => normalizeDuration(breakdown), [breakdown]);
  const posterUrl = breakdown?.poster_url || cues[0]?.poster_url || null;
  const mutedDefault = breakdown?.muted_default !== false;

  const [isMuted, setIsMuted] = React.useState(mutedDefault);
  const [captionsEnabled, setCaptionsEnabled] = React.useState(true);
  const [isReady, setIsReady] = React.useState(false);
  const [isBuffering, setIsBuffering] = React.useState(true);
  const [hasStarted, setHasStarted] = React.useState(false);
  const [hasEnded, setHasEnded] = React.useState(false);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [bufferedPosition, setBufferedPosition] = React.useState(0);
  const [durationSeconds, setDurationSeconds] = React.useState(durationFallback);
  const [activeCueIndex, setActiveCueIndex] = React.useState(0);
  const [errorMessage, setErrorMessage] = React.useState(null);
  const [hasRenderedFirstFrame, setHasRenderedFirstFrame] = React.useState(false);

  const cueFade = React.useRef(new Animated.Value(1)).current;
  const cueLift = React.useRef(new Animated.Value(0)).current;
  const isMountedRef = React.useRef(true);

  const player = useVideoPlayer(breakdown?.video_url, (instance) => {
    instance.loop = false;
    instance.muted = mutedDefault;
    instance.timeUpdateEventInterval = 0.1;
    instance.currentTime = 0;
    instance.pause();
  });

  const activeCue = cues[activeCueIndex] || cues[0] || null;
  const effectiveDuration = durationSeconds || durationFallback;
  const progressRatio = effectiveDuration > 0 ? currentTime / effectiveDuration : 0;
  const bufferedRatio = effectiveDuration > 0 ? bufferedPosition / effectiveDuration : 0;

  const animateCueChange = React.useCallback(() => {
    cueFade.setValue(0.55);
    cueLift.setValue(10);
    Animated.parallel([
      Animated.timing(cueFade, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(cueLift, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [cueFade, cueLift]);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (!player) return undefined;

    const subscriptions = [
      player.addListener('sourceLoad', ({ duration }) => {
        if (!isMountedRef.current) return;
        if (Number.isFinite(duration) && duration > 0) {
          setDurationSeconds(duration);
        }
        setIsReady(true);
        setIsBuffering(false);
      }),
      player.addListener('statusChange', ({ status, error }) => {
        if (!isMountedRef.current) return;

        if (status === 'loading') {
          setIsBuffering(true);
          return;
        }

        if (status === 'readyToPlay') {
          setIsReady(true);
          setIsBuffering(false);
          setErrorMessage(null);
          return;
        }

        if (status === 'error') {
          setIsBuffering(false);
          setIsPlaying(false);
          setErrorMessage(error?.message || 'The breakdown video could not load.');
        }
      }),
      player.addListener('playingChange', ({ isPlaying: nextIsPlaying }) => {
        if (!isMountedRef.current) return;
        setIsPlaying(nextIsPlaying);
        if (nextIsPlaying) {
          setHasStarted(true);
          setHasEnded(false);
          setErrorMessage(null);
        }
      }),
      player.addListener('timeUpdate', ({ currentTime: nextTime, bufferedPosition: nextBuffer }) => {
        if (!isMountedRef.current) return;

        setCurrentTime(nextTime);
        setBufferedPosition(nextBuffer);

        const nextCueIndex = getCueIndexAtTime(cues, nextTime);
        if (nextCueIndex >= 0 && nextCueIndex !== activeCueIndex) {
          setActiveCueIndex(nextCueIndex);
          animateCueChange();
        }
      }),
      player.addListener('playToEnd', () => {
        if (!isMountedRef.current) return;
        setHasEnded(true);
        setIsPlaying(false);
        setCurrentTime(effectiveDuration);
      }),
    ];

    return () => {
      subscriptions.forEach((subscription) => subscription?.remove?.());
      player.timeUpdateEventInterval = 0;
    };
  }, [activeCueIndex, animateCueChange, cues, effectiveDuration, player]);

  React.useEffect(() => {
    setDurationSeconds(durationFallback);
  }, [durationFallback]);

  const handleClose = React.useCallback(() => {
    player?.pause?.();
    onClose?.();
  }, [onClose, player]);

  const handleToggleMute = React.useCallback(() => {
    if (!player) return;
    const nextMuted = !isMuted;
    player.muted = nextMuted;
    setIsMuted(nextMuted);
  }, [isMuted, player]);

  const handleToggleCaptions = React.useCallback(() => {
    setCaptionsEnabled((current) => !current);
  }, []);

  const startPlayback = React.useCallback(() => {
    if (!player) return;
    if (hasEnded) {
      player.replay();
      setCurrentTime(0);
    } else {
      player.play();
    }
    setHasStarted(true);
    setHasEnded(false);
    setErrorMessage(null);
  }, [hasEnded, player]);

  const handleTogglePlayback = React.useCallback(() => {
    if (!player) return;
    if (!hasStarted || hasEnded) {
      startPlayback();
      return;
    }
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }, [hasEnded, hasStarted, isPlaying, player, startPlayback]);

  const handleSeekComplete = React.useCallback((value) => {
    if (!player) return;
    const nextTime = clampTime(value, effectiveDuration);
    player.currentTime = nextTime;
    setCurrentTime(nextTime);
    setHasEnded(false);
  }, [effectiveDuration, player]);

  const handleReplay = React.useCallback(() => {
    if (!player) return;
    player.replay();
    setCurrentTime(0);
    setHasEnded(false);
    setHasStarted(true);
  }, [player]);

  const handleStepCue = React.useCallback((direction) => {
    if (!player || !cues.length) return;
    const nextIndex = Math.max(0, Math.min(cues.length - 1, activeCueIndex + direction));
    const targetCue = cues[nextIndex];
    if (!targetCue) return;
    player.currentTime = targetCue.start_seconds;
    setCurrentTime(targetCue.start_seconds);
    setActiveCueIndex(nextIndex);
    setHasEnded(false);
    animateCueChange();
    if (hasStarted && !isPlaying) {
      player.play();
    }
  }, [activeCueIndex, animateCueChange, cues, hasStarted, isPlaying, player]);

  const handleSelectCue = React.useCallback((index) => {
    if (!player || !cues[index]) return;
    const cue = cues[index];
    player.currentTime = cue.start_seconds;
    setCurrentTime(cue.start_seconds);
    setActiveCueIndex(index);
    setHasEnded(false);
    animateCueChange();
  }, [animateCueChange, cues, player]);

  const primaryButtonLabel = hasEnded
    ? 'Replay Breakdown'
    : hasStarted
      ? (isPlaying ? 'Pause Breakdown' : 'Play Breakdown')
      : 'Start Breakdown';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {posterUrl ? (
          <Image
            source={{ uri: posterUrl }}
            style={styles.backdropImage}
            blurRadius={28}
          />
        ) : null}
        <LinearGradient
          colors={['rgba(8, 13, 12, 0.94)', 'rgba(8, 13, 12, 0.82)', 'rgba(8, 13, 12, 0.98)']}
          style={styles.backdropShade}
        />

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

          <View style={styles.headerCopy}>
            <Text style={styles.headerEyebrow}>Coach Cut</Text>
            <Text style={styles.headerTitle}>{breakdown?.title || 'Swing Breakdown'}</Text>
          </View>

          <View style={styles.headerMeta}>
            <View style={styles.headerMetaPill}>
              <Ionicons name="volume-mute" size={12} color={colors.coachAccentLight} />
              <Text style={styles.headerMetaText}>Muted</Text>
            </View>
            <View style={styles.headerMetaPill}>
              <Ionicons name="reader-outline" size={12} color={colors.coachAccentLight} />
              <Text style={styles.headerMetaText}>Captions</Text>
            </View>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.videoFrame}>
            <View style={styles.videoShell}>
              {player ? (
                <VideoView
                  player={player}
                  style={styles.videoView}
                  nativeControls={false}
                  contentFit="cover"
                  onFirstFrameRender={() => setHasRenderedFirstFrame(true)}
                />
              ) : null}

              {posterUrl && (!hasStarted || !hasRenderedFirstFrame) ? (
                <Image source={{ uri: posterUrl }} style={styles.posterImage} />
              ) : null}

              <LinearGradient
                colors={['rgba(0,0,0,0.18)', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0.42)']}
                style={styles.videoShade}
              />

              {!errorMessage && captionsEnabled && hasStarted && activeCue?.caption ? (
                <View style={styles.captionCard} pointerEvents="none">
                  <Text style={styles.captionEyebrow}>
                    {activeCue.headline || `Scene ${activeCueIndex + 1}`}
                  </Text>
                  <Text
                    style={styles.captionText}
                    numberOfLines={TRANSCRIPT_PREVIEW_LINES}
                  >
                    {activeCue.caption}
                  </Text>
                </View>
              ) : null}

              {errorMessage ? (
                <View style={styles.centerOverlay}>
                  <View style={styles.centerCard}>
                    <Ionicons name="alert-circle-outline" size={28} color={colors.white} />
                    <Text style={styles.centerTitle}>Playback hit a snag</Text>
                    <Text style={styles.centerBody}>{errorMessage}</Text>
                    <TouchableOpacity
                      style={styles.primaryOverlayButton}
                      onPress={startPlayback}
                      accessibilityRole="button"
                      accessibilityLabel="Try breakdown playback again"
                    >
                      <Text style={styles.primaryOverlayButtonText}>Try Again</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {!errorMessage && !hasStarted ? (
                <Pressable
                  style={styles.centerOverlay}
                  onPress={startPlayback}
                  accessibilityRole="button"
                  accessibilityLabel="Start narrated swing breakdown"
                >
                  <View style={styles.centerCard}>
                    <Text style={styles.centerEyebrow}>Quiet By Default</Text>
                    <Text style={styles.centerTitle}>Watch the key moments first</Text>
                    <Text style={styles.centerBody}>
                      {breakdown?.summary || 'A short coach-led walkthrough of the frames that matter most.'}
                    </Text>
                    <View style={styles.centerMetaRow}>
                      <View style={styles.centerMetaPill}>
                        <Ionicons name="volume-mute" size={12} color={colors.coachAccentLight} />
                        <Text style={styles.centerMetaText}>Starts muted</Text>
                      </View>
                      <View style={styles.centerMetaPill}>
                        <Ionicons name="reader-outline" size={12} color={colors.coachAccentLight} />
                        <Text style={styles.centerMetaText}>Captions on</Text>
                      </View>
                    </View>
                    <View style={styles.primaryOverlayButton}>
                      <Ionicons name="play" size={16} color={colors.primaryDark} />
                      <Text style={styles.primaryOverlayButtonText}>Start Breakdown</Text>
                    </View>
                  </View>
                </Pressable>
              ) : null}

              {!errorMessage && hasStarted && (isBuffering || !isReady) ? (
                <View style={styles.loadingPill} pointerEvents="none">
                  <ActivityIndicator size="small" color={colors.white} />
                  <Text style={styles.loadingPillText}>Buffering the next cue</Text>
                </View>
              ) : null}

              {!errorMessage && hasEnded ? (
                <View style={styles.endPill} pointerEvents="none">
                  <Ionicons name="checkmark-circle" size={14} color={colors.coachAccentLight} />
                  <Text style={styles.endPillText}>Breakdown complete</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.deck}>
            <View style={styles.deckTopRow}>
              <View style={styles.timelinePill}>
                <Text style={styles.timelinePillText}>
                  Scene {Math.max(1, activeCueIndex + 1)} of {Math.max(1, cues.length)}
                </Text>
              </View>
              <Text style={styles.durationLabel}>
                {formatClock(currentTime)} / {formatClock(effectiveDuration)}
              </Text>
            </View>

            <Animated.View
              style={[
                styles.focusCard,
                {
                  opacity: cueFade,
                  transform: [{ translateY: cueLift }],
                },
              ]}
            >
              <Text style={styles.focusEyebrow}>
                {activeCue?.phase ? activeCue.phase.replace(/_/g, ' ') : 'Swing sequence'}
              </Text>
              <Text style={styles.focusTitle}>
                {activeCue?.headline || breakdown?.title || 'Swing Breakdown'}
              </Text>
              <Text style={styles.focusBody}>
                {activeCue?.caption || activeCue?.narration || breakdown?.summary || 'Your coach notes appear here as the breakdown plays.'}
              </Text>
            </Animated.View>

            <View style={styles.progressCluster}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressBuffered, { width: `${Math.max(progressRatio, bufferedRatio) * 100}%` }]} />
                <View style={[styles.progressPlayed, { width: `${progressRatio * 100}%` }]} />
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={Math.max(effectiveDuration, 0.1)}
                value={clampTime(currentTime, effectiveDuration)}
                minimumTrackTintColor={colors.coachAccent}
                maximumTrackTintColor="rgba(255,255,255,0.14)"
                thumbTintColor={colors.white}
                onSlidingComplete={handleSeekComplete}
                accessibilityLabel="Breakdown playback position"
              />
            </View>

            <View style={styles.controlsRow}>
              <TouchableOpacity
                style={styles.secondaryControl}
                onPress={() => handleStepCue(-1)}
                accessibilityRole="button"
                accessibilityLabel="Jump to previous coaching scene"
              >
                <Ionicons name="play-skip-back" size={16} color={colors.white} />
                <Text style={styles.secondaryControlText}>Prev</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.primaryControl}
                onPress={handleTogglePlayback}
                accessibilityRole="button"
                accessibilityLabel={primaryButtonLabel}
              >
                <Ionicons
                  name={hasEnded ? 'refresh' : isPlaying ? 'pause' : 'play'}
                  size={18}
                  color={colors.primaryDark}
                />
                <Text style={styles.primaryControlText}>{primaryButtonLabel}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryControl}
                onPress={() => handleStepCue(1)}
                accessibilityRole="button"
                accessibilityLabel="Jump to next coaching scene"
              >
                <Ionicons name="play-skip-forward" size={16} color={colors.white} />
                <Text style={styles.secondaryControlText}>Next</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.togglesRow}>
              <TouchableOpacity
                style={[styles.togglePill, isMuted && styles.togglePillActive]}
                onPress={handleToggleMute}
                accessibilityRole="button"
                accessibilityLabel={isMuted ? 'Unmute breakdown audio' : 'Mute breakdown audio'}
              >
                <Ionicons
                  name={isMuted ? 'volume-mute' : 'volume-high'}
                  size={14}
                  color={isMuted ? colors.primaryDark : colors.white}
                />
                <Text style={[styles.togglePillText, isMuted && styles.togglePillTextActive]}>
                  {isMuted ? 'Unmute' : 'Mute'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.togglePill, captionsEnabled && styles.togglePillActive]}
                onPress={handleToggleCaptions}
                accessibilityRole="button"
                accessibilityLabel={captionsEnabled ? 'Turn captions off' : 'Turn captions on'}
              >
                <Ionicons
                  name="reader-outline"
                  size={14}
                  color={captionsEnabled ? colors.primaryDark : colors.white}
                />
                <Text
                  style={[
                    styles.togglePillText,
                    captionsEnabled && styles.togglePillTextActive,
                  ]}
                >
                  {captionsEnabled ? 'Captions On' : 'Captions Off'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.togglePill}
                onPress={handleReplay}
                accessibilityRole="button"
                accessibilityLabel="Replay breakdown from the beginning"
              >
                <Ionicons name="refresh" size={14} color={colors.white} />
                <Text style={styles.togglePillText}>Replay</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.chapterSection}>
              <Text style={styles.chapterLabel}>Chapter cues</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chapterRail}
              >
                {cues.map((cue, index) => {
                  const isActive = index === activeCueIndex;
                  return (
                    <TouchableOpacity
                      key={cue.id || `cue-${index + 1}`}
                      style={[styles.chapterChip, isActive && styles.chapterChipActive]}
                      onPress={() => handleSelectCue(index)}
                      accessibilityRole="button"
                      accessibilityLabel={`Jump to ${cue.headline || `scene ${index + 1}`}`}
                    >
                      <Text style={[styles.chapterIndex, isActive && styles.chapterIndexActive]}>
                        {String(index + 1).padStart(2, '0')}
                      </Text>
                      <Text
                        style={[styles.chapterText, isActive && styles.chapterTextActive]}
                        numberOfLines={1}
                      >
                        {cue.headline || cue.phase?.replace(/_/g, ' ') || `Scene ${index + 1}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </ScrollView>
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
  safeArea: {
    flex: 1,
    backgroundColor: '#08100d',
  },
  container: {
    flex: 1,
    backgroundColor: '#08100d',
  },
  backdropImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.22,
  },
  backdropShade: {
    ...StyleSheet.absoluteFillObject,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  headerButton: {
    minHeight: 42,
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.base,
    backgroundColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButtonText: {
    marginLeft: 4,
    color: colors.white,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
  },
  headerCopy: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  headerEyebrow: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  headerTitle: {
    marginTop: 2,
    color: colors.white,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    textAlign: 'center',
  },
  headerMeta: {
    alignItems: 'flex-end',
    gap: 6,
  },
  headerMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerMetaText: {
    marginLeft: 4,
    color: colors.white,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
  scrollContent: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.xl,
  },
  videoFrame: {
    marginBottom: spacing.base,
  },
  videoShell: {
    position: 'relative',
    aspectRatio: VIDEO_CARD_ASPECT_RATIO,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    backgroundColor: '#0d1512',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    ...shadows.lg,
  },
  videoView: {
    width: '100%',
    height: '100%',
  },
  posterImage: {
    ...StyleSheet.absoluteFillObject,
  },
  videoShade: {
    ...StyleSheet.absoluteFillObject,
  },
  captionCard: {
    position: 'absolute',
    left: spacing.base,
    right: spacing.base,
    bottom: spacing.base,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(6, 10, 9, 0.82)',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  captionEyebrow: {
    color: colors.coachAccentLight,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  captionText: {
    color: colors.white,
    fontSize: typography.fontSizes.base,
    lineHeight: typography.baseLh,
    textAlign: 'center',
  },
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  centerCard: {
    width: '100%',
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    backgroundColor: 'rgba(7, 12, 10, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  centerEyebrow: {
    color: colors.coachAccentLight,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  centerTitle: {
    color: colors.white,
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.bold,
    textAlign: 'center',
  },
  centerBody: {
    marginTop: spacing.sm,
    color: 'rgba(255,255,255,0.78)',
    fontSize: typography.fontSizes.sm,
    lineHeight: typography.smLh,
    textAlign: 'center',
  },
  centerMetaRow: {
    marginTop: spacing.base,
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  centerMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  centerMetaText: {
    marginLeft: 4,
    color: colors.white,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
  primaryOverlayButton: {
    marginTop: spacing.base,
    minHeight: 46,
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.coachAccent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryOverlayButtonText: {
    marginLeft: 6,
    color: colors.primaryDark,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.bold,
  },
  loadingPill: {
    position: 'absolute',
    top: spacing.base,
    right: spacing.base,
    borderRadius: borderRadius.pill,
    backgroundColor: 'rgba(7, 12, 10, 0.8)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingPillText: {
    marginLeft: 8,
    color: colors.white,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
  endPill: {
    position: 'absolute',
    top: spacing.base,
    left: spacing.base,
    borderRadius: borderRadius.pill,
    backgroundColor: 'rgba(7, 12, 10, 0.8)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  endPillText: {
    marginLeft: 6,
    color: colors.white,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
  deck: {
    borderRadius: borderRadius.xl,
    backgroundColor: 'rgba(10, 18, 15, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: spacing.base,
  },
  deckTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.base,
  },
  timelinePill: {
    borderRadius: borderRadius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  timelinePillText: {
    color: colors.white,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
  durationLabel: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
  focusCard: {
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.base,
  },
  focusEyebrow: {
    color: colors.coachAccentLight,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.55,
    marginBottom: 6,
  },
  focusTitle: {
    color: colors.white,
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold,
    marginBottom: spacing.xs,
  },
  focusBody: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: typography.fontSizes.sm,
    lineHeight: typography.smLh,
  },
  progressCluster: {
    marginTop: spacing.base,
  },
  progressTrack: {
    height: 3,
    borderRadius: borderRadius.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    marginBottom: -6,
  },
  progressBuffered: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  progressPlayed: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.coachAccent,
  },
  slider: {
    marginHorizontal: -12,
    height: 30,
  },
  controlsRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  primaryControl: {
    flex: 1,
    minHeight: 48,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.coachAccent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
  },
  primaryControlText: {
    marginLeft: 6,
    color: colors.primaryDark,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.bold,
  },
  secondaryControl: {
    minHeight: 48,
    borderRadius: borderRadius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryControlText: {
    marginLeft: 6,
    color: colors.white,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
  },
  togglesRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  togglePill: {
    minHeight: 40,
    borderRadius: borderRadius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
  },
  togglePillActive: {
    backgroundColor: colors.coachAccent,
    borderColor: colors.coachAccent,
  },
  togglePillText: {
    marginLeft: 6,
    color: colors.white,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
  },
  togglePillTextActive: {
    color: colors.primaryDark,
  },
  chapterSection: {
    marginTop: spacing.base,
  },
  chapterLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.55,
    marginBottom: spacing.sm,
  },
  chapterRail: {
    gap: spacing.sm,
    paddingRight: spacing.base,
  },
  chapterChip: {
    width: 168,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  chapterChipActive: {
    backgroundColor: 'rgba(201,166,84,0.18)',
    borderColor: 'rgba(201,166,84,0.55)',
  },
  chapterIndex: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.bold,
    marginBottom: 4,
  },
  chapterIndexActive: {
    color: colors.coachAccentLight,
  },
  chapterText: {
    color: colors.white,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
  },
  chapterTextActive: {
    color: colors.white,
  },
});

export default React.memo(BreakdownVideoModal);
