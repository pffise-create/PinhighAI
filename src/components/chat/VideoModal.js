// VideoModal.js - Full-screen video playback modal
// Single instance owned by ChatScreen. Only mounts useVideoPlayer when visible,
// so there's exactly one player hook in the tree (not one per video message).
import React from 'react';
import {
  Modal,
  SafeAreaView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../../utils/theme';

const normalizeTrimBounds = (trimData) => {
  if (!trimData || typeof trimData !== 'object') return null;

  const asNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const startMs = asNumber(trimData.startTimeMs ?? trimData.trimStartMs);
  const endMs = asNumber(trimData.endTimeMs ?? trimData.trimEndMs);
  if (startMs === null || endMs === null || endMs <= startMs) return null;

  return {
    startSeconds: Math.max(0, startMs / 1000),
    endSeconds: Math.max(0, endMs / 1000),
  };
};

const VideoModalInner = ({ videoUri, onClose, trimData }) => {
  const clipBounds = normalizeTrimBounds(trimData);
  const player = useVideoPlayer(videoUri, (p) => {
    p.loop = false;
    if (clipBounds) {
      p.currentTime = clipBounds.startSeconds;
      p.timeUpdateEventInterval = 0.1;
    }
    p.play();
  });

  React.useEffect(() => {
    if (!player || !clipBounds) return undefined;

    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (currentTime >= clipBounds.endSeconds) {
        player.pause();
        player.currentTime = clipBounds.startSeconds;
      }
    });

    return () => {
      sub?.remove?.();
      player.timeUpdateEventInterval = 0;
    };
  }, [clipBounds, player]);

  React.useEffect(() => {
    if (!player || !clipBounds) return;
    player.currentTime = clipBounds.startSeconds;
  }, [clipBounds, player]);

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        accessibilityLabel="Close video"
        accessibilityRole="button"
      >
        <Ionicons name="close" size={28} color={colors.white} />
      </TouchableOpacity>
      {player && (
        <VideoView
          player={player}
          style={styles.videoView}
          allowsFullscreen
          nativeControls
        />
      )}
    </SafeAreaView>
  );
};

const VideoModal = ({ visible, videoUri, trimData, onClose }) => (
  <Modal
    visible={visible}
    animationType="slide"
    presentationStyle="fullScreen"
    onRequestClose={onClose}
  >
    {visible && videoUri ? (
      <VideoModalInner videoUri={videoUri} trimData={trimData} onClose={onClose} />
    ) : null}
  </Modal>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.black,
    justifyContent: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.lg,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.overlayMedium,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoView: {
    width: '100%',
    height: '100%',
  },
});

export default React.memo(VideoModal);
