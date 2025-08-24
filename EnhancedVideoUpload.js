import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Dimensions,
  SafeAreaView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Video } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';

const { width, height } = Dimensions.get('window');

export default function EnhancedVideoUpload() {
  const [permission, requestPermission] = useCameraPermissions();
  const [currentStep, setCurrentStep] = useState('choose'); // choose, record, preview
  const [isRecording, setIsRecording] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const cameraRef = useRef(null);

  // Choose video from gallery
  const pickVideoFromGallery = async () => {
    try {
      // Request media library permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'We need access to your photo library to select videos.'
        );
        return;
      }

      // Launch image picker for videos
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: 1,
        videoMaxDuration: 120, // 2 minutes max
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const video = result.assets[0];
        console.log('Selected video:', video);
        
        setSelectedVideo({
          uri: video.uri,
          duration: video.duration / 1000, // Convert from milliseconds to seconds
          size: video.fileSize,
        });
        setCurrentStep('preview');
      }
    } catch (error) {
      console.error('Error picking video:', error);
      Alert.alert('Error', 'Failed to select video from gallery.');
    }
  };

  // Start recording new video
  const startRecording = async () => {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) {
        Alert.alert('Permission Required', 'Camera access is needed to record videos.');
        return;
      }
    }
    setCurrentStep('record');
  };

  // Record video functionality
  const handleStartRecording = async () => {
    if (cameraRef.current) {
      try {
        console.log('Starting recording...');
        setIsRecording(true);
        
        const video = await cameraRef.current.recordAsync({
          quality: '720p',
          maxDuration: 60, // 1 minute max for golf swings
        });
        
        console.log('Recording completed:', video);
        setSelectedVideo({
          uri: video.uri,
          duration: video.duration || 0,
        });
        setIsRecording(false);
        setCurrentStep('preview');
        
      } catch (error) {
        console.error('Error recording video:', error);
        setIsRecording(false);
        Alert.alert('Error', 'Failed to record video. Please try again.');
      }
    }
  };

  const handleStopRecording = () => {
    if (cameraRef.current && isRecording) {
      console.log('Stopping recording...');
      cameraRef.current.stopRecording();
    }
  };

  // Go back to main menu
  const goBack = () => {
    setCurrentStep('choose');
    setSelectedVideo(null);
    setIsRecording(false);
  };

  // Proceed with upload (placeholder for now)
  const proceedWithUpload = () => {
    if (selectedVideo) {
      Alert.alert(
        'Ready to Upload!',
        `Video duration: ${selectedVideo.duration?.toFixed(1) || 'Unknown'} seconds\nFile: ${selectedVideo.uri.split('/').pop()}`,
        [
          { text: 'Upload Later', style: 'cancel' },
          { text: 'Upload Now', onPress: () => console.log('Upload initiated!') }
        ]
      );
    }
  };

  // Main choice screen
  const renderChoiceScreen = () => (
    <View style={styles.choiceContainer}>
      <Text style={styles.title}>Upload Golf Swing Video</Text>
      <Text style={styles.subtitle}>
        Choose how you'd like to add your golf swing video
      </Text>
      
      <TouchableOpacity style={styles.optionButton} onPress={startRecording}>
        <Text style={styles.optionIcon}>📹</Text>
        <Text style={styles.optionTitle}>Record New Video</Text>
        <Text style={styles.optionDescription}>
          Use your camera to record a golf swing right now
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity style={styles.optionButton} onPress={pickVideoFromGallery}>
        <Text style={styles.optionIcon}>📱</Text>
        <Text style={styles.optionTitle}>Choose from Gallery</Text>
        <Text style={styles.optionDescription}>
          Select a golf swing video from your camera roll
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Camera recording screen
  const renderRecordingScreen = () => (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        mode="video"
      >
        <View style={styles.overlay}>
          <View style={styles.topOverlay}>
            <TouchableOpacity style={styles.backButton} onPress={goBack}>
              <Text style={styles.backButtonText}>← Back</Text>
            </TouchableOpacity>
            
            <Text style={styles.instructionText}>
              {isRecording 
                ? 'Recording your golf swing...' 
                : 'Position yourself and tap to record'
              }
            </Text>
          </View>
          
          <View style={styles.bottomOverlay}>
            <TouchableOpacity
              style={[
                styles.recordButton,
                isRecording && styles.recordingButton,
              ]}
              onPress={isRecording ? handleStopRecording : handleStartRecording}
            >
              <View style={[
                styles.recordButtonInner,
                isRecording && styles.recordingButtonInner
              ]} />
            </TouchableOpacity>
            
            <Text style={styles.recordButtonLabel}>
              {isRecording ? 'Tap to Stop' : 'Tap to Record'}
            </Text>
          </View>
        </View>
      </CameraView>
    </View>
  );

  // Video preview screen
  const renderPreviewScreen = () => (
    <View style={styles.container}>
      <View style={styles.previewHeader}>
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.previewTitle}>Video Preview</Text>
      </View>
      
      <View style={styles.videoContainer}>
        <Video
          source={{ uri: selectedVideo.uri }}
          style={styles.video}
          useNativeControls
          resizeMode="contain"
          shouldPlay={false}
        />
      </View>
      
      <View style={styles.videoInfo}>
        <Text style={styles.infoText}>
          Duration: {selectedVideo.duration?.toFixed(1) || 'Unknown'} seconds
        </Text>
        <Text style={styles.infoText}>
          File: {selectedVideo.uri.split('/').pop()}
        </Text>
        {selectedVideo.size && (
          <Text style={styles.infoText}>
            Size: {(selectedVideo.size / (1024 * 1024)).toFixed(1)} MB
          </Text>
        )}
      </View>
      
      <View style={styles.previewButtons}>
        <TouchableOpacity style={styles.retakeButton} onPress={goBack}>
          <Text style={styles.buttonText}>Choose Different Video</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.uploadButton} onPress={proceedWithUpload}>
          <Text style={styles.buttonText}>Use This Video</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {currentStep === 'choose' && renderChoiceScreen()}
      {currentStep === 'record' && renderRecordingScreen()}
      {currentStep === 'preview' && renderPreviewScreen()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  choiceContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#1a1a1a',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 50,
    lineHeight: 24,
  },
  optionButton: {
    backgroundColor: '#2a2a2a',
    padding: 25,
    borderRadius: 15,
    marginBottom: 20,
    width: '100%',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#444',
  },
  optionIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  optionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  optionDescription: {
    fontSize: 14,
    color: '#ccc',
    textAlign: 'center',
    lineHeight: 20,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
  },
  topOverlay: {
    padding: 20,
    alignItems: 'center',
    paddingTop: 60,
  },
  bottomOverlay: {
    paddingBottom: 100,
    alignItems: 'center',
  },
  backButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 10,
    borderRadius: 8,
  },
  backButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  instructionText: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 15,
    borderRadius: 10,
    marginTop: 50,
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'white',
    marginBottom: 10,
  },
  recordingButton: {
    backgroundColor: 'rgba(255,0,0,0.8)',
    borderColor: 'red',
  },
  recordButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'red',
  },
  recordingButtonInner: {
    width: 30,
    height: 30,
    borderRadius: 4,
    backgroundColor: 'white',
  },
  recordButtonLabel: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
  },
  previewTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginLeft: 20,
  },
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 20,
  },
  video: {
    width: width - 40,
    height: (width - 40) * 0.75,
    backgroundColor: '#333',
    borderRadius: 10,
  },
  videoInfo: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    margin: 20,
    padding: 15,
    borderRadius: 10,
  },
  infoText: {
    color: 'white',
    fontSize: 14,
    marginBottom: 5,
  },
  previewButtons: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 30,
    gap: 15,
  },
  retakeButton: {
    backgroundColor: '#666',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 10,
    flex: 1,
    alignItems: 'center',
  },
  uploadButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 10,
    flex: 1,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});