// VideoRecordScreen.js - Updated to poll for real analysis results
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Video } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';
import videoService from '../services/videoService';

const { width } = Dimensions.get('window');

const VideoRecordScreen = ({ navigation, route }) => {
  const [videoUri, setVideoUri] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [videoDuration, setVideoDuration] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    if (route.params?.recordedVideo) {
      const { uri, duration } = route.params.recordedVideo;
      setVideoUri(uri);
      setVideoDuration(duration);
      navigation.setParams({ recordedVideo: null });
    }
  }, [route.params?.recordedVideo]);

  const handleRecordVideo = () => {
    navigation.navigate('Camera');
  };

  const handleSelectVideo = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Media library access is required');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: 1,
        videoMaxDuration: 120,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const video = result.assets[0];
        setVideoUri(video.uri);
        setVideoDuration(video.duration ? video.duration / 1000 : null);
      }
    } catch (error) {
      console.error('Error picking video:', error);
      Alert.alert('Error', 'Failed to select video from gallery.');
    }
  };

  const handleUploadVideo = async () => {
    if (!videoUri) {
      Alert.alert('Error', 'Please select a video first');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setStatusMessage('Starting upload...');
    
    try {
      // Step 1: Upload video and trigger analysis
      setStatusMessage('Uploading video to cloud...');
      const uploadResult = await videoService.uploadAndAnalyze(
        videoUri, 
        videoDuration,
        (progress) => {
          setUploadProgress(progress * 0.3); // Upload is 30% of total
          setStatusMessage(`Uploading: ${Math.round(progress)}%`);
        }
      );
      
      console.log('✅ Upload complete, jobId:', uploadResult.jobId);
      
      // Step 2: Poll for analysis completion
      setStatusMessage('Processing video with AI coach...');
      setUploadProgress(30);
      
      const analysisResult = await videoService.waitForAnalysisComplete(
        uploadResult.jobId,
        (progressInfo) => {
          // Update progress from 30% to 100%
          const analysisProgress = 30 + (progressInfo.progress * 70);
          setUploadProgress(analysisProgress);
          setStatusMessage(progressInfo.message || 'Analyzing swing...');
        }
      );
      
      console.log('✅ Analysis complete:', analysisResult);
      setIsUploading(false);
      
      // Step 3: Navigate based on analysis result
      if (analysisResult.status === 'completed' && analysisResult.analysis) {
        // Parse the AI analysis
        const aiData = typeof analysisResult.analysis === 'string' 
          ? JSON.parse(analysisResult.analysis) 
          : analysisResult.analysis;
        
        // Navigate to ResultsScreen with jobId
        navigation.navigate('Results', { 
          jobId: uploadResult.jobId,
          analysisData: {
            jobId: uploadResult.jobId,
            overallScore: aiData.overall_score || 7.5,
            strengths: aiData.strengths || [],
            improvements: aiData.areas_for_improvement || [],
            keyInsights: aiData.key_insights || [],
            coachingResponse: aiData.coaching_response,
            practiceRecommendations: aiData.practice_recommendations || [],
            rawAnalysis: aiData
          }
        });
      } else {
        throw new Error('Analysis did not complete successfully');
      }
      
    } catch (error) {
      console.error('❌ Upload/Analysis failed:', error);
      setIsUploading(false);
      setUploadProgress(0);
      setStatusMessage('');
      
      // More specific error messages
      let errorMessage = 'Unknown error occurred';
      if (error.message.includes('timeout')) {
        errorMessage = 'Analysis is taking longer than expected. Please try again or check your analysis history.';
      } else if (error.message.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      } else {
        errorMessage = error.message;
      }
      
      Alert.alert(
        'Upload Failed', 
        errorMessage,
        [
          { text: 'Try Again', onPress: () => handleUploadVideo() },
          { text: 'Cancel', style: 'cancel' }
        ]
      );
    }
  };

  const clearVideo = () => {
    setVideoUri(null);
    setVideoDuration(null);
    setUploadProgress(0);
    setStatusMessage('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Upload Your Golf Swing</Text>
        <Text style={styles.subtitle}>
          Record a new video or select from your gallery
        </Text>

        {videoUri ? (
          <View style={styles.videoContainer}>
            <Video
              source={{ uri: videoUri }}
              style={styles.videoPlayer}
              useNativeControls
              resizeMode="contain"
              shouldPlay={false}
            />
            <TouchableOpacity
              style={styles.clearButton}
              onPress={clearVideo}
              disabled={isUploading}
            >
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.placeholderContainer}>
            <Text style={styles.placeholderText}>
              No video selected
            </Text>
          </View>
        )}

        {videoUri && videoDuration !== null && (
          <View style={styles.videoInfoContainer}>
            <Text style={styles.videoInfoText}>
              Duration: {videoDuration.toFixed(1)} seconds
            </Text>
          </View>
        )}

        {/* Upload Progress */}
        {isUploading && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFill, 
                  { width: `${uploadProgress}%` }
                ]} 
              />
            </View>
            <Text style={styles.progressText}>
              {statusMessage}
            </Text>
            <Text style={styles.progressPercent}>
              {Math.round(uploadProgress)}%
            </Text>
          </View>
        )}

        <View style={styles.buttonContainer}>
          {!isUploading && (
            <>
              <TouchableOpacity
                style={styles.recordButton}
                onPress={handleRecordVideo}
              >
                <Text style={styles.buttonText}>Record Video</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.selectButton}
                onPress={handleSelectVideo}
              >
                <Text style={styles.buttonText}>Select from Gallery</Text>
              </TouchableOpacity>
            </>
          )}

          {videoUri && (
            <TouchableOpacity
              style={[styles.uploadButton, isUploading && styles.disabledButton]}
              onPress={handleUploadVideo}
              disabled={isUploading}
            >
              {isUploading ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text style={styles.uploadButtonText}>Analyze Swing</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.tipsContainer}>
          <Text style={styles.tipsTitle}>Recording Tips:</Text>
          <Text style={styles.tipText}>• Film from side angle (profile view)</Text>
          <Text style={styles.tipText}>• Keep entire swing in frame</Text>
          <Text style={styles.tipText}>• Record 30-60 seconds</Text>
          <Text style={styles.tipText}>• Analysis takes 30-60 seconds</Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  title: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.medium,
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.sm,
    fontFamily: typography.fontFamily,
  },
  subtitle: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing['2xl'],
    fontFamily: typography.fontFamily,
  },
  videoContainer: {
    height: 300,
    backgroundColor: '#000',
    borderRadius: borderRadius.lg,
    marginBottom: spacing.base,
    position: 'relative',
    overflow: 'hidden',
  },
  videoPlayer: {
    flex: 1,
    backgroundColor: '#000',
  },
  clearButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: borderRadius.base,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearButtonText: {
    color: colors.background,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.bold,
  },
  placeholderContainer: {
    height: 300,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.textLight,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.base,
  },
  placeholderText: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  videoInfoContainer: {
    backgroundColor: colors.surface,
    padding: spacing.sm,
    borderRadius: borderRadius.base,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  videoInfoText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  progressContainer: {
    marginBottom: spacing.lg,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.base,
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.textLight,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: borderRadius.sm,
  },
  progressText: {
    fontSize: typography.fontSizes.sm,
    color: colors.primary,
    textAlign: 'center',
    fontFamily: typography.fontFamily,
  },
  progressPercent: {
    fontSize: typography.fontSizes.lg,
    color: colors.primary,
    textAlign: 'center',
    fontWeight: typography.fontWeights.semibold,
    marginTop: spacing.xs,
  },
  buttonContainer: {
    gap: spacing.base,
    marginBottom: spacing['2xl'],
  },
  recordButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing['2xl'],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    ...shadows.base,
  },
  selectButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing['2xl'],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    ...shadows.base,
  },
  uploadButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing['2xl'],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
    ...shadows.base,
  },
  disabledButton: {
    backgroundColor: colors.textLight,
  },
  buttonText: {
    color: colors.background,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },
  uploadButtonText: {
    color: colors.background,
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
  },
  tipsContainer: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginTop: spacing.lg,
    ...shadows.sm,
  },
  tipsTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    marginBottom: spacing.sm,
    fontFamily: typography.fontFamily,
  },
  tipText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    fontFamily: typography.fontFamily,
  },
});

export default VideoRecordScreen;