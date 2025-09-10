import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors, typography, spacing, borderRadius } from '../utils/theme';

const CameraScreen = ({ navigation }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraRef = useRef(null);

  const startRecording = async () => {
    if (!cameraReady) {
      Alert.alert('Camera Not Ready', 'Please wait for the camera to initialize');
      return;
    }
    
    if (cameraRef.current) {
      try {
        console.log('Starting recording...');
        setIsRecording(true);
        
        const video = await cameraRef.current.recordAsync({
          maxDuration: 5000, // 5 seconds limit for cost control
        });
        
        console.log('Recording completed:', video);
        setIsRecording(false);
        
        // Navigate back to Chat with the recorded video for processing
        navigation.navigate('Chat', {
          recordedVideo: {
            uri: video.uri,
            duration: video.duration || 0,
          }
        });
        
        console.log('Video recorded successfully:', {
          uri: video.uri,
          duration: video.duration || 0,
        });
        
      } catch (error) {
        console.error('Error recording video:', error);
        setIsRecording(false);
        Alert.alert('Recording Error', `Failed to record video: ${error.message}`);
      }
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && isRecording) {
      console.log('Stopping recording...');
      cameraRef.current.stopRecording();
    }
  };

  const goBack = () => {
    if (isRecording) {
      stopRecording();
    }
    navigation.goBack();
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContainer}>
          <Text style={styles.text}>Requesting camera permissions...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContainer}>
          <Text style={styles.text}>Camera access is required to record videos</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        mode="video"
        onCameraReady={() => {
          console.log('Camera is ready');
          setCameraReady(true);
        }}
      />
      
      {/* Overlay */}
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
              !cameraReady && styles.disabledButton,
            ]}
            onPress={isRecording ? stopRecording : startRecording}
            disabled={!cameraReady}
          >
            <View style={[
              styles.recordButtonInner,
              isRecording && styles.recordingButtonInner
            ]} />
          </TouchableOpacity>
          
          <Text style={styles.recordButtonLabel}>
            {!cameraReady ? 'Camera Loading...' : isRecording ? 'Tap to Stop' : 'Tap to Record'}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    pointerEvents: 'box-none',
  },
  topOverlay: {
    padding: spacing.lg,
    alignItems: 'center',
    paddingTop: 60,
    pointerEvents: 'box-none',
  },
  bottomOverlay: {
    paddingBottom: 100,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  backButton: {
    position: 'absolute',
    top: 60,
    left: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: borderRadius.base,
    pointerEvents: 'auto',
  },
  backButtonText: {
    color: colors.background,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
  },
  instructionText: {
    color: colors.background,
    fontSize: typography.fontSizes.base,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: spacing.base,
    borderRadius: borderRadius.base,
    marginTop: 50,
    fontFamily: typography.fontFamily,
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
    pointerEvents: 'auto',
  },
  recordingButton: {
    backgroundColor: 'rgba(255,0,0,0.8)',
    borderColor: 'red',
  },
  disabledButton: {
    backgroundColor: 'rgba(128,128,128,0.5)',
    borderColor: 'gray',
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
    color: colors.background,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
  },
  text: {
    color: colors.background,
    fontSize: typography.fontSizes.base,
    textAlign: 'center',
    marginBottom: spacing.base,
    fontFamily: typography.fontFamily,
  },
  permissionButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.base,
    marginTop: spacing.base,
  },
  buttonText: {
    color: colors.background,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },
});

export default CameraScreen;