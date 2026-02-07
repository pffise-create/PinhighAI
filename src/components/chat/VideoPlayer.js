// VideoPlayer.js - Tappable thumbnail with play icon overlay
// On press: opens modal with expo-video player for playback
import React, { useState, useCallback } from 'react';
import {
  View,
  Image,
  TouchableOpacity,
  Modal,
  StyleSheet,
  SafeAreaView,
  Text,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius } from '../../utils/theme';

const VideoPlayer = ({ thumbnailUri, videoUri, duration, onPress }) => {
  const [modalVisible, setModalVisible] = useState(false);

  const handlePress = useCallback(() => {
    if (videoUri) {
      setModalVisible(true);
    }
    onPress?.();
  }, [videoUri, onPress]);

  return (
    <>
      {/* Tappable thumbnail */}
      <TouchableOpacity
        style={styles.thumbnailContainer}
        onPress={handlePress}
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

      {/* Full-screen video playback modal */}
      {videoUri && (
        <VideoModal
          visible={modalVisible}
          videoUri={videoUri}
          onClose={() => setModalVisible(false)}
        />
      )}
    </>
  );
};

// Separate modal component to avoid creating player when not needed
const VideoModal = ({ visible, videoUri, onClose }) => {
  const player = useVideoPlayer(visible ? videoUri : null, (p) => {
    if (visible) {
      p.play();
    }
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalContainer}>
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
    </Modal>
  );
};

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
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  durationText: {
    color: colors.white,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
  modalContainer: {
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

export default React.memo(VideoPlayer);
