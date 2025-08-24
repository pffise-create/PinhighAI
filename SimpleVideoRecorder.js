import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Video } from 'expo-av';

const { width, height } = Dimensions.get('window');

export default function SimpleVideoRecorder() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideo, setRecordedVideo] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const cameraRef = useRef(null);

  // Handle permission states
  if (!permission) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.text}>Requesting camera permissions...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.text}>
          Camera access is required to record golf swings.
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const startRecording = async () => {
    if (cameraRef.current) {
      try {
        console.log('Starting recording...');
        setIsRecording(true);
        
        const video = await cameraRef.current.recordAsync({
          quality: '720p',
          maxDuration: 30, // 30 seconds for testing
        });
        
        console.log('Recording completed:', video);
        setRecordedVideo(video);
        setIsRecording(false);
        setShowPreview(true);
        
      } catch (error) {
        console.error('Error recording video:', error);
        setIsRecording(false);
        Alert.alert('Error', 'Failed to record video. Please try again.');
      }
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && isRecording) {
      console.log('Stopping recording...');
      cameraRef.current.stopRecording();
    }
  };

  const recordAnother = () => {
    setRecordedVideo(null);
    setShowPreview(false);
  };

  // Show video preview after recording
  if (showPreview && recordedVideo) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Video Recorded! 🎥</Text>
        
        <View style={styles.videoContainer}>
          <Video
            source={{ uri: recordedVideo.uri }}
            style={styles.video}
            useNativeControls
            resizeMode="contain"
            shouldPlay={false}
          />
        </View>
        
        <View style={styles.previewInfo}>
          <Text style={styles.infoText}>Duration: {recordedVideo.duration || 'N/A'} seconds</Text>
          <Text style={styles.infoText}>File: {recordedVideo.uri.split('/').pop()}</Text>
        </View>
        
        <TouchableOpacity style={styles.recordAgainButton} onPress={recordAnother}>
          <Text style={styles.buttonText}>Record Another Video</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Show camera interface
  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        mode="video"
      >
        <View style={styles.overlay}>
          <View style={styles.topOverlay}>
            <Text style={styles.instructionText}>
              {isRecording 
                ? 'Recording your golf swing...' 
                : 'Position yourself and tap the record button'
              }
            </Text>
          </View>
          
          <View style={styles.bottomOverlay}>
            <TouchableOpacity
              style={[
                styles.recordButton,
                isRecording && styles.recordingButton,
              ]}
              onPress={isRecording ? stopRecording : startRecording}
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
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black',
    padding: 20,
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
  instructionText: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 15,
    borderRadius: 10,
    overflow: 'hidden',
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
  permissionButton: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    padding: 20,
    paddingTop: 60,
  },
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 20,
  },
  video: {
    width: width - 40,
    height: (width - 40) * 0.75, // 4:3 aspect ratio
    backgroundColor: '#333',
  },
  previewInfo: {
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
  recordAgainButton: {
    backgroundColor: '#4CAF50',
    margin: 20,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  text: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
  },
});