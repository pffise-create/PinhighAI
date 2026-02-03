import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Image,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Video } from 'expo-av';
import * as VideoThumbnails from 'expo-video-thumbnails';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const THUMBNAIL_WIDTH = 60;
const THUMBNAIL_HEIGHT = 80;
const MAX_CLIP_DURATION = 5; // 5 seconds max
const MIN_CLIP_DURATION = 2; // 2 seconds min
const NUM_THUMBNAILS = 8;

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
};

const VideoTrimmer = ({
  videoUri,
  videoDuration,
  onTrimComplete,
  onCancel,
}) => {
  const videoRef = useRef(null);
  const [thumbnails, setThumbnails] = useState([]);
  const [isLoadingThumbnails, setIsLoadingThumbnails] = useState(true);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(Math.min(MAX_CLIP_DURATION, videoDuration));
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);

  const clipDuration = endTime - startTime;
  const maxStart = Math.max(0, videoDuration - MIN_CLIP_DURATION);

  // Generate thumbnails on mount
  useEffect(() => {
    generateThumbnails();
  }, [videoUri, videoDuration]);

  const generateThumbnails = async () => {
    if (!videoUri || !videoDuration) return;

    setIsLoadingThumbnails(true);
    setError(null);

    try {
      const thumbs = [];
      const interval = videoDuration / NUM_THUMBNAILS;

      for (let i = 0; i < NUM_THUMBNAILS; i++) {
        const time = i * interval * 1000; // Convert to milliseconds
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
            time: Math.floor(time),
            quality: 0.5,
          });
          thumbs.push({ uri, time: time / 1000 });
        } catch (thumbError) {
          console.warn(`Failed to generate thumbnail at ${time}ms:`, thumbError);
          thumbs.push({ uri: null, time: time / 1000 });
        }
      }

      setThumbnails(thumbs);
    } catch (err) {
      console.error('Error generating thumbnails:', err);
      setError('Failed to load video thumbnails');
    } finally {
      setIsLoadingThumbnails(false);
    }
  };

  // Update video position when start time changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.setPositionAsync(startTime * 1000);
      setCurrentTime(startTime);
    }
  }, [startTime]);

  // Handle playback status updates
  const onPlaybackStatusUpdate = useCallback((status) => {
    if (status.isLoaded) {
      const currentPos = status.positionMillis / 1000;
      setCurrentTime(currentPos);

      // Loop within the selected range
      if (currentPos >= endTime) {
        videoRef.current?.setPositionAsync(startTime * 1000);
      }

      setIsPlaying(status.isPlaying);
    }
  }, [startTime, endTime]);

  const handlePlayPause = async () => {
    if (!videoRef.current) return;

    if (isPlaying) {
      await videoRef.current.pauseAsync();
    } else {
      // Start from beginning of selection if at or past end
      if (currentTime >= endTime || currentTime < startTime) {
        await videoRef.current.setPositionAsync(startTime * 1000);
      }
      await videoRef.current.playAsync();
    }
  };

  const handleStartTimeChange = (value) => {
    const newStart = Math.min(value, endTime - MIN_CLIP_DURATION);
    setStartTime(Math.max(0, newStart));

    // Adjust end time if clip would be too long
    if (endTime - newStart > MAX_CLIP_DURATION) {
      setEndTime(newStart + MAX_CLIP_DURATION);
    }
  };

  const handleEndTimeChange = (value) => {
    const newEnd = Math.max(value, startTime + MIN_CLIP_DURATION);
    setEndTime(Math.min(videoDuration, newEnd));

    // Adjust start time if clip would be too long
    if (newEnd - startTime > MAX_CLIP_DURATION) {
      setStartTime(newEnd - MAX_CLIP_DURATION);
    }
  };

  const handleConfirm = () => {
    onTrimComplete({
      startTime,
      endTime,
      duration: clipDuration,
    });
  };

  const renderThumbnailTimeline = () => {
    const timelineWidth = SCREEN_WIDTH - spacing.lg * 2;
    const startPercent = (startTime / videoDuration) * 100;
    const endPercent = (endTime / videoDuration) * 100;

    return (
      <View style={styles.timelineContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbnailScroll}
        >
          {isLoadingThumbnails ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.loadingText}>Loading preview...</Text>
            </View>
          ) : (
            <View style={styles.thumbnailRow}>
              {thumbnails.map((thumb, index) => (
                <View key={index} style={styles.thumbnailWrapper}>
                  {thumb.uri ? (
                    <Image source={{ uri: thumb.uri }} style={styles.thumbnail} />
                  ) : (
                    <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                      <Ionicons name="image-outline" size={20} color={colors.textLight} />
                    </View>
                  )}
                </View>
              ))}

              {/* Selection overlay */}
              <View
                style={[
                  styles.selectionOverlay,
                  {
                    left: `${startPercent}%`,
                    width: `${endPercent - startPercent}%`,
                  }
                ]}
              />

              {/* Dimmed areas outside selection */}
              <View style={[styles.dimOverlay, { left: 0, width: `${startPercent}%` }]} />
              <View style={[styles.dimOverlay, { left: `${endPercent}%`, right: 0, width: undefined }]} />
            </View>
          )}
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel} style={styles.cancelButton}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Trim Video</Text>
        <TouchableOpacity
          onPress={handleConfirm}
          style={styles.confirmButton}
          disabled={clipDuration < MIN_CLIP_DURATION}
        >
          <Text style={styles.confirmText}>Done</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.videoContainer}>
        <Video
          ref={videoRef}
          source={{ uri: videoUri }}
          style={styles.video}
          resizeMode="contain"
          shouldPlay={false}
          isLooping={false}
          onPlaybackStatusUpdate={onPlaybackStatusUpdate}
        />

        <TouchableOpacity style={styles.playButton} onPress={handlePlayPause}>
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={40}
            color={colors.background}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.infoBar}>
        <Text style={styles.clipDuration}>
          Clip: {clipDuration.toFixed(1)}s
        </Text>
        {clipDuration > MAX_CLIP_DURATION && (
          <Text style={styles.warningText}>Max {MAX_CLIP_DURATION}s</Text>
        )}
        {clipDuration < MIN_CLIP_DURATION && (
          <Text style={styles.warningText}>Min {MIN_CLIP_DURATION}s</Text>
        )}
      </View>

      {renderThumbnailTimeline()}

      <View style={styles.slidersContainer}>
        <View style={styles.sliderRow}>
          <Text style={styles.sliderLabel}>Start</Text>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={maxStart}
            value={startTime}
            onValueChange={handleStartTimeChange}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.textLight}
            thumbTintColor={colors.accent}
          />
          <Text style={styles.timeText}>{formatTime(startTime)}</Text>
        </View>

        <View style={styles.sliderRow}>
          <Text style={styles.sliderLabel}>End</Text>
          <Slider
            style={styles.slider}
            minimumValue={MIN_CLIP_DURATION}
            maximumValue={videoDuration}
            value={endTime}
            onValueChange={handleEndTimeChange}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.textLight}
            thumbTintColor={colors.accent}
          />
          <Text style={styles.timeText}>{formatTime(endTime)}</Text>
        </View>
      </View>

      <View style={styles.instructionContainer}>
        <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
        <Text style={styles.instructionText}>
          Select a {MIN_CLIP_DURATION}-{MAX_CLIP_DURATION} second segment containing your swing
        </Text>
      </View>

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cancelButton: {
    padding: spacing.sm,
  },
  title: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  confirmButton: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.base,
  },
  confirmText: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.background,
    fontFamily: typography.fontFamily,
  },
  videoContainer: {
    height: 280,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  playButton: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.base,
  },
  clipDuration: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
  },
  warningText: {
    fontSize: typography.fontSizes.sm,
    color: colors.error || '#e74c3c',
    fontFamily: typography.fontFamily,
  },
  timelineContainer: {
    height: THUMBNAIL_HEIGHT + spacing.base * 2,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.base,
  },
  thumbnailScroll: {
    minWidth: '100%',
  },
  thumbnailRow: {
    flexDirection: 'row',
    height: THUMBNAIL_HEIGHT,
    position: 'relative',
  },
  thumbnailWrapper: {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    marginRight: 2,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: borderRadius.sm,
  },
  thumbnailPlaceholder: {
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionOverlay: {
    position: 'absolute',
    top: -4,
    bottom: -4,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: borderRadius.sm,
    backgroundColor: 'transparent',
  },
  dimOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: SCREEN_WIDTH - spacing.lg * 2,
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  slidersContainer: {
    paddingHorizontal: spacing.lg,
    gap: spacing.base,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sliderLabel: {
    width: 40,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  timeText: {
    width: 55,
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'right',
  },
  instructionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  instructionText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  errorContainer: {
    margin: spacing.lg,
    padding: spacing.base,
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    borderRadius: borderRadius.base,
  },
  errorText: {
    fontSize: typography.fontSizes.sm,
    color: colors.error || '#e74c3c',
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
});

export default VideoTrimmer;
