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

const VideoModalInner = ({ videoUri, onClose }) => {
  const player = useVideoPlayer(videoUri, (p) => {
    p.play();
  });

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

const VideoModal = ({ visible, videoUri, onClose }) => (
  <Modal
    visible={visible}
    animationType="slide"
    presentationStyle="fullScreen"
    onRequestClose={onClose}
  >
    {visible && videoUri ? (
      <VideoModalInner videoUri={videoUri} onClose={onClose} />
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
