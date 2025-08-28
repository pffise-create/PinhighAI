// ChatScreen.js - ChatGPT-style golf coaching interface
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import ChatHistoryManager from '../services/chatHistoryManager';
import videoService from '../services/videoService';
import chatApiService from '../services/chatApiService';
import * as ImagePicker from 'expo-image-picker';
import { Video } from 'expo-av';
import * as VideoThumbnails from 'expo-video-thumbnails';

const ChatScreen = ({ navigation, route }) => {
  const { user, isAuthenticated } = useAuth();
  // ChatGPT-style simple state
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationSummary, setConversationSummary] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const flatListRef = useRef(null);
  
  const userId = user?.email || 'guest';

  // Simple markdown renderer for coach messages
  const renderMarkdownText = (text) => {
    if (!text) return null;
    
    // First replace dashes with bullets
    let processedText = text.replace(/^- /gm, '• ');
    
    const parts = [];
    let lastIndex = 0;
    const boldRegex = /\*\*(.*?)\*\*/g;
    let match;
    
    while ((match = boldRegex.exec(processedText)) !== null) {
      // Add text before bold
      if (match.index > lastIndex) {
        parts.push(processedText.substring(lastIndex, match.index));
      }
      
      // Add bold text
      parts.push({
        text: match[1],
        bold: true
      });
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < processedText.length) {
      parts.push(processedText.substring(lastIndex));
    }
    
    return (
      <Text style={styles.coachText}>
        {parts.map((part, index) => {
          if (typeof part === 'string') {
            return part;
          } else {
            return (
              <Text key={index} style={[styles.coachText, { fontWeight: 'bold' }]}>
                {part.text}
              </Text>
            );
          }
        })}
      </Text>
    );
  };

  useEffect(() => {
    if (!isInitialized) {
      initializePrimaryChat();
    }
    // ChatGPT-style: No processing state to clear
  }, [isAuthenticated, userId]); // Removed isInitialized from dependencies

  // Handle video recorded from camera
  useEffect(() => {
    if (route.params?.recordedVideo && !isProcessingVideo) {
      const { uri, duration } = route.params.recordedVideo;
      navigation.setParams({ recordedVideo: null }); // Clear the param
      setIsProcessingVideo(true);
      handleCameraVideo(uri, duration);
    }
  }, [route.params?.recordedVideo, isProcessingVideo]);

  // Handle camera video with thumbnail
  const handleCameraVideo = async (videoUri, videoDuration) => {
    try {
      // Generate thumbnail for the video
      const thumbnailUri = await generateVideoThumbnail(videoUri);
      
      // Add user message with video thumbnail first
      const userMessage = {
        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        text: null,
        sender: 'user',
        timestamp: new Date(),
        messageType: 'video',
        hasVideo: true,
        videoUri: videoUri,
        videoThumbnail: thumbnailUri,
      };
      
      setMessages(prev => [...prev, userMessage]);
      await ChatHistoryManager.saveMessage(userId, userMessage);
      
      // Then process the video
      await processVideoUpload(videoUri, videoDuration);
    } catch (error) {
      Alert.alert('Error', 'Failed to process camera video');
    }
  };

  // Initialize chat as primary interface
  const initializePrimaryChat = async () => {
    try {
      // Load conversation history silently - no loading UI
      const conversation = await ChatHistoryManager.loadConversation(userId);
      const summary = await ChatHistoryManager.getConversationSummary(userId);
      
      setConversationSummary(summary);

      // Convert stored messages to display format
      const displayMessages = conversation.messages.map(msg => ({
        id: msg.id,
        text: msg.text,
        sender: msg.sender,
        timestamp: new Date(msg.timestamp),
        messageType: msg.messageType,
        videoReference: msg.videoReference,
      }));

      // Filter out any existing welcome/onboarding messages and stuck processing messages for clean UI
      const cleanMessages = displayMessages.filter(
        msg => msg.messageType !== 'onboarding' && 
               msg.messageType !== 'contextual_welcome' &&
               msg.messageType !== 'video_processing' &&
               msg.messageType !== 'processing' && // Remove any saved processing messages
               !(msg.text && msg.text.includes("Hi! I'm your AI golf coach"))
      );
      // Check for duplicate IDs before setting
      const messageIds = cleanMessages.map(m => m.id);
      const duplicateIds = messageIds.filter((id, index) => messageIds.indexOf(id) !== index);
      if (duplicateIds.length > 0) {
        console.error('🔥 DUPLICATE IDs in loaded messages:', duplicateIds);
        console.error('🔥 Full messages:', cleanMessages);
      }
      
      console.log('✅ Setting', cleanMessages.length, 'clean messages');
      setMessages(cleanMessages);
      setIsInitialized(true);
      
      // ChatGPT-style: No processing state to clear

      // ChatGPT-style: No onboarding - just clean chat

    } catch (error) {
      console.error('Failed to initialize chat:', error);
      // Fallback to clean UI
      setMessages([]);
      setIsInitialized(true);
    } finally {
      // ChatGPT-style: No loading state to clear
    }
  };


  // ChatGPT-style: No celebration logic needed

  // Handle video upload - show options for camera or gallery
  const handleVideoUpload = () => {
    Alert.alert(
      'Upload Video',
      'Choose how to upload your swing video',
      [
        { text: 'Camera', onPress: openCamera },
        { text: 'Gallery', onPress: openGallery },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const openCamera = () => {
    navigation.navigate('Camera');
  };

  // Generate video thumbnail
  const generateVideoThumbnail = async (videoUri) => {
    try {
      const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
        time: 1000, // 1 second into the video
        quality: 0.8,
      });
      return uri;
    } catch (error) {
      console.error('Failed to generate thumbnail:', error);
      return null;
    }
  };

  const openGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Media library access is required');
        return;
      }
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: true,  // Enable video trimming
        quality: 0.8,
        videoMaxDuration: 120,
        allowsMultipleSelection: false,
        videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const video = result.assets[0];
        
        // Generate thumbnail for the video
        const thumbnailUri = await generateVideoThumbnail(video.uri);
        
        // Add user message with video thumbnail first
        const userMessage = {
          id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          text: null,
          sender: 'user',
          timestamp: new Date(),
          messageType: 'video',
          hasVideo: true,
          videoUri: video.uri,
          videoThumbnail: thumbnailUri,
        };
        
        setMessages(prev => [...prev, userMessage]);
        await ChatHistoryManager.saveMessage(userId, userMessage);
        
        // Check video duration limit (5 seconds)
        const durationInSeconds = video.duration ? video.duration / 1000 : 0;
        if (durationInSeconds > 5) {
          Alert.alert(
            'Video Length Limit', 
            `Please select a video 5 seconds or shorter (${durationInSeconds.toFixed(1)}s selected).`
          );
          return;
        }
        
        // Then process the video
        await processVideoUpload(video.uri, durationInSeconds);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to select video from gallery');
    }
  };

  // Process video upload using real AWS integration
  const processVideoUpload = async (videoUri, videoDuration) => {
    let messageInterval;
    
    try {
      const videoId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Start processing with initial message
      setIsProcessingVideo(true);
      setProcessingMessage('Addressing the ball...');
      
      // Golf-themed processing messages
      const golfMessages = [
        'Addressing the ball...',
        'Taking a practice swing...',
        'Checking the wind...',
        'Reading the lie...',
        'Aligning the shot...',
        'Measuring yardage...',
        'Selecting the right club...',
        'Checking grip pressure...',
        'Finding the target line...',
        'Taking dead aim...',
        'Analyzing swing plane...',
        'Studying tempo...',
        'Reviewing impact position...',
        'Calculating ball flight...',
        'Replacing divots...'
      ];
      
      let messageIndex = 0;
      
      // Update processing message function
      const updateProcessingMessage = (newText) => {
        setProcessingMessage(newText);
      };
      
      // Start message cycling
      messageInterval = setInterval(() => {
        messageIndex = (messageIndex + 1) % golfMessages.length;
        updateProcessingMessage(golfMessages[messageIndex]);
      }, 2000); // Change every 2 seconds

      // Step 1: Upload video and trigger analysis
      const uploadResult = await videoService.uploadAndAnalyze(
        videoUri, 
        videoDuration,
        (progress) => {
          // Update to upload-specific messages
          const uploadMessages = [
            'Teeing up your swing...',
            'Loading into the cart...',
            'Driving to the range...',
            'Setting up on the tee box...'
          ];
          const msgIndex = Math.floor(progress * uploadMessages.length);
          updateProcessingMessage(uploadMessages[Math.min(msgIndex, uploadMessages.length - 1)]);
        }
      );
      
      
      // Step 2: Poll for analysis completion
      
      const analysisResult = await videoService.waitForAnalysisComplete(
        uploadResult.jobId,
        (progressInfo) => {
          // Update to analysis-specific messages
          const analysisMessages = [
            'Reviewing your setup...',
            'Analyzing swing plane...',
            'Studying impact position...',
            'Calculating ball flight...',
            'Checking follow-through...',
            'Finding improvement areas...',
            'Preparing coaching tips...'
          ];
          const msgIndex = Math.floor((progressInfo.progress || 0) * analysisMessages.length);
          updateProcessingMessage(analysisMessages[Math.min(msgIndex, analysisMessages.length - 1)]);
        }
      );
      
      
      // Step 3: Process analysis results
      if (analysisResult.status === 'completed' && analysisResult.analysis) {
        // Parse the AI analysis
        const aiData = typeof analysisResult.analysis === 'string' 
          ? JSON.parse(analysisResult.analysis) 
          : analysisResult.analysis;
        
        const isFirstAnalysis = conversationSummary?.analysisCount === 0;
        // ChatGPT-style: Simple AI response message 
        const analysisMessage = {
          id: `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sender: 'assistant', // ChatGPT-style sender
          text: aiData.coaching_response || 'I had trouble analyzing that swing. Please try uploading another video.',
          timestamp: new Date(),
          messageType: 'response',
          isProcessing: false,
        };
        
        // Clear the message interval and add analysis message
        clearInterval(messageInterval);
        setProcessingMessage('');
        
        setMessages(prev => [...prev, analysisMessage]);
        
        await ChatHistoryManager.saveMessage(userId, analysisMessage);
        
        // Update conversation summary
        if (conversationSummary) {
          setConversationSummary({
            ...conversationSummary,
            analysisCount: conversationSummary.analysisCount + 1,
            hasVideoUploads: true,
          });
        }
        
        setIsProcessingVideo(false);
        setProcessingMessage(''); // Clear processing message
      } else {
        throw new Error('Analysis did not complete successfully');
      }

    } catch (error) {
      console.error('❌ Video processing failed:', error);
      
      // Clear any running intervals
      if (messageInterval) clearInterval(messageInterval);
      
      // Clear processing and show error message
      setProcessingMessage('');
      
      const errorMessage = {
        id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        text: 'Sorry, there was an issue processing your video. Please try again.',
        sender: 'assistant',
        timestamp: new Date(),
        messageType: 'error',
      };
      
      setMessages(prev => [...prev, errorMessage]);
      
      await ChatHistoryManager.saveMessage(userId, errorMessage);
    } finally {
      setIsProcessingVideo(false); // Reset processing flag
      setProcessingMessage(''); // Clear processing message
    }
  };




  // Send message with real AI integration
  const sendMessage = async () => {
    if (!inputText.trim()) return;

    const userMessage = {
      id: `user_${Date.now()}`,
      text: inputText.trim(),
      sender: 'user',
      timestamp: new Date(),
      messageType: 'text',
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    // Save user message
    try {
      await ChatHistoryManager.saveMessage(userId, userMessage);
    } catch (error) {
      console.error('Failed to save user message:', error);
    }

    // Real AI coaching response via production service
    try {
      const conversationHistory = chatApiService.formatConversationHistory(messages);
      const coachingContext = chatApiService.formatCoachingContext(conversationSummary, messages);
      
      const result = await chatApiService.sendMessage(
        userMessage.text,
        userId,
        conversationHistory,
        coachingContext
      );
      
      const coachResponse = {
        id: `coach_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        text: result.response || 'I had trouble processing your message. Please try again.',
        sender: 'coach',
        timestamp: new Date(),
        messageType: result.fallback ? 'fallback' : 'response',
        tokensUsed: result.tokensUsed,
        apiSuccess: result.success
      };

      setMessages(prev => [...prev, coachResponse]);
      await ChatHistoryManager.saveMessage(userId, coachResponse);
      
    } catch (error) {
      console.error('❌ Unexpected error in chat service:', error);
      
      // Honest fallback - don't promise what we can't deliver
      const fallbackResponse = {
        id: `coach_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        text: 'I\'m having trouble connecting right now. Please try again in a few minutes.',
        sender: 'coach',
        timestamp: new Date(),
        messageType: 'connection_error',
      };

      setMessages(prev => [...prev, fallbackResponse]);
      await ChatHistoryManager.saveMessage(userId, fallbackResponse);
    } finally {
      setIsLoading(false);
    }
  };


  // ChatGPT-style: No onboarding actions needed

  // Render message component
  // Option 3 header with status indicator
  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.title}>Your Coach</Text>
      <View style={styles.statusIndicator} />
    </View>
  );

  // Option 3 message rendering with coaching design
  const renderMessage = ({ item }) => {
    if (item.sender === 'user') {
      return (
        <View style={styles.userMessageContainer}>
          {item.hasVideo && (
            <TouchableOpacity style={styles.videoThumbnail}>
              <Image source={{ uri: item.videoThumbnail }} style={styles.thumbnailImage} />
              <View style={styles.playOverlay}>
                <Ionicons name="play" size={20} color="white" />
              </View>
            </TouchableOpacity>
          )}
          {item.text && (
            <View style={styles.userMessageBubble}>
              <Text style={styles.userText}>{item.text}</Text>
            </View>
          )}
        </View>
      );
    }
    
    // Assistant message (coach) - simple loading state
    if (item.isLoading) {
      return (
        <View style={styles.coachMessageContainer}>
          <Text style={styles.coachText}>Analyzing your swing...</Text>
        </View>
      );
    }
    
    // Coach message with Option 3 design
    return (
      <View style={styles.coachMessageContainer}>
        {renderMarkdownText(item.text)}
      </View>
    );
  };


  // Option 3 input section with purple accents
  const renderInputSection = () => (
    <View style={styles.inputContainer}>
      <TouchableOpacity style={styles.cameraButton} onPress={handleVideoUpload}>
        <Ionicons name="camera" size={20} color="#805AD5" />
      </TouchableOpacity>
      <TextInput
        style={styles.input}
        placeholder="Ask your coach anything..."
        value={inputText}
        onChangeText={setInputText}
        multiline
        maxHeight={100}
      />
      <TouchableOpacity 
        style={[styles.sendButton, inputText.trim() && !isLoading && styles.sendButtonActive]} 
        onPress={sendMessage}
        disabled={!inputText.trim() || isLoading}
      >
        <Ionicons name="send" size={18} color={inputText.trim() && !isLoading ? "white" : "#ccc"} />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}

      <KeyboardAvoidingView 
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Upload Options Modal */}
        {/* UploadOptionsModal removed - ChatGPT style uses direct camera button */}

        {/* First Analysis Celebration */}
        {/* FirstAnalysisCelebration removed - ChatGPT style is celebration-free */}

        {/* ChatGPT-style: No progressive onboarding */}

        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          style={styles.messagesList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          showsVerticalScrollIndicator={false}
        />
        
        {isLoading && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <ActivityIndicator size="small" color="#000" />
            <Text style={{ fontSize: 14, color: '#666', fontStyle: 'italic', marginLeft: 8 }}>Coach is thinking...</Text>
          </View>
        )}
        
        {isProcessingVideo && processingMessage && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <ActivityIndicator size="small" color="#805AD5" />
            <Text style={{ fontSize: 14, color: '#666', fontStyle: 'italic', marginLeft: 8 }}>{processingMessage}</Text>
          </View>
        )}
        
        {renderInputSection()}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// Option 3 AI Coach Companion styling
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7FAFC', // Light blue-gray background
  },
  
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1B4332', // Primary green
  },
  
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#805AD5', // Purple accent
  },
  
  messagesList: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  
  // User messages (right-aligned, green background)
  userMessageContainer: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    marginBottom: 16,
    marginTop: 8,
  },
  
  userMessageBubble: {
    backgroundColor: '#1B4332', // Primary green
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 16,
  },
  
  userText: {
    fontSize: 17,
    color: '#FFFFFF',
    lineHeight: 24,
  },
  
  // Coach messages (full width like Claude/ChatGPT - no container)
  coachMessageContainer: {
    width: '100%',
    marginBottom: 12,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  
  coachText: {
    fontSize: 17,
    color: '#2D3748', // Dark gray text
    lineHeight: 24,
  },
  
  // Video thumbnail in user messages
  videoThumbnail: {
    width: 200,
    height: 112,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    position: 'relative',
  },
  
  thumbnailImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F0F0F0',
  },
  
  playOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -15 }, { translateY: -15 }],
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Input area with purple accents
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  
  cameraButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(128, 90, 213, 0.2)', // Purple with 20% opacity
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    borderRadius: 24,
    maxHeight: 100,
    color: '#2D3748',
  },
  
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
    backgroundColor: 'transparent',
  },
  
  sendButtonActive: {
    backgroundColor: '#805AD5', // Purple accent
  },
});

export default ChatScreen;