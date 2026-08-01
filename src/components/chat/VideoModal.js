// VideoModal.js - Full-screen video playback modal
// Single instance owned by ChatScreen. Only mounts useVideoPlayer when visible,
// so there's exactly one player hook in the tree (not one per video message).
import React from 'react';
import {
  Modal,
  SafeAreaView,
  TouchableOpacity,
  StyleSheet,
  Text,
  View,
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

  const handleClose = React.useCallback(() => {
    player?.pause?.();
    onClose?.();
  }, [onClose, player]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerCloseButton}
          onPress={handleClose}
          accessibilityLabel="Back to chat"
          accessibilityRole="button"
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <Ionicons name="chevron-back" size={20} color={colors.white} />
          <Text style={styles.headerCloseText}>Back to chat</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleClose}
          accessibilityLabel="Close video"
          accessibilityRole="button"
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <Ionicons name="close" size={28} color={colors.white} />
        </TouchableOpacity>
      </View>
      <View style={styles.videoShell}>
        {player && (
          <VideoView
            player={player}
            style={styles.videoView}
            nativeControls
          />
        )}
      </View>
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleClose}
          accessibilityLabel="Back to chat"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={18} color={colors.white} />
          <Text style={styles.backButtonText}>Back to chat</Text>
        </TouchableOpacity>
      </View>
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
  },
  header: {
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.black,
  },
  headerCloseButton: {
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: spacing.base,
    backgroundColor: colors.overlayMedium,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCloseText: {
    color: colors.white,
    marginLeft: spacing.xs,
    fontWeight: '600',
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.overlayMedium,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoShell: {
    flex: 1,
    backgroundColor: colors.black,
  },
  videoView: {
    width: '100%',
    height: '100%',
  },
  footer: {
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    alignItems: 'flex-start',
    backgroundColor: colors.black,
  },
  backButton: {
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: spacing.base,
    backgroundColor: colors.overlayMedium,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: colors.white,
    marginLeft: spacing.xs,
    fontWeight: '600',
  },
});

export default React.memo(VideoModal);
