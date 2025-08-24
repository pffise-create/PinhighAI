// ChatScreen.js - Primary interface with progressive onboarding
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

const ChatScreen = ({ navigation, route }) => {
  const { user, isAuthenticated } = useAuth();
  // ChatGPT-style simple state
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationSummary, setConversationSummary] = useState(null);
  const flatListRef = useRef(null);
  
  const userId = user?.email || 'guest';

  useEffect(() => {
    initializePrimaryChat();
    // Clear any stuck video processing state on mount
    setCurrentVideoProcessing(null);
  }, [isAuthenticated, userId]);

  // Handle video recorded from camera
  useEffect(() => {
    if (route.params?.recordedVideo) {
      const { uri, duration } = route.params.recordedVideo;
      navigation.setParams({ recordedVideo: null }); // Clear the param
      processVideoUpload(uri, duration);
    }
  }, [route.params?.recordedVideo]);

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
               !msg.text.includes("Hi! I'm your AI golf coach")
      );
      setMessages(cleanMessages);
      
      // Clear any stuck processing state
      setCurrentVideoProcessing(null);

      // ChatGPT-style: No onboarding - just clean chat

    } catch (error) {
      console.error('Failed to initialize chat:', error);
      // Fallback to clean UI
      setMessages([]);
    } finally {
      // ChatGPT-style: No loading state to clear
    }
  };


  // ChatGPT-style: No celebration logic needed

  // Handle video upload
  const handleVideoUpload = () => {
    console.log('🎥 Video upload button pressed');
    setShowUploadModal(true);
    console.log('📱 Upload modal should now be visible:', true);
  };

  const openCamera = () => {
    // ChatGPT-style: Direct camera access
    navigation.navigate('Camera');
    
    // Add progress message
    addSystemMessage('Get ready to record your swing! Position yourself so I can see your full swing from the side.', 'system');
  };

  const openGallery = async () => {
    console.log('📱 Opening gallery...');
    
    try {
      // Close modal first, then check permissions
      setShowUploadModal(false);
      
      console.log('📱 Requesting media library permissions...');
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      console.log('📱 Permission status:', status);
      
      if (status !== 'granted') {
        console.log('❌ Permission denied');
        Alert.alert('Permission denied', 'Media library access is required');
        return;
      }

      // Longer delay to ensure modal is fully dismissed
      console.log('📱 Waiting for modal to close...');
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log('📱 Launching image library picker...');
      console.log('📱 About to call ImagePicker.launchImageLibraryAsync');
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'], // Use array format as recommended
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: 120,
        allowsMultipleSelection: false,
      });

      console.log('📱 Gallery picker finished, result:', result);
      console.log('📱 Result type:', typeof result);
      console.log('📱 Result canceled:', result?.canceled);
      console.log('📱 Result assets length:', result?.assets?.length);

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const video = result.assets[0];
        console.log('📱 Video selected:', { uri: video.uri, duration: video.duration });
        await processVideoUpload(video.uri, video.duration ? video.duration / 1000 : null);
      } else {
        console.log('📱 Gallery picker cancelled or no video selected');
      }
    } catch (error) {
      console.error('❌ Error picking video:', error);
      Alert.alert('Error', `Failed to select video from gallery: ${error.message}`);
    }
  };

  // Process video upload using real AWS integration
  const processVideoUpload = async (videoUri, videoDuration) => {
    try {
      const videoId = `chat_${Date.now()}`;
      
      // Set current processing video with timeout protection
      setCurrentVideoProcessing({
        videoId,
        stage: 'uploading',
        progress: 0,
      });
      
      // Auto-clear processing state after 5 minutes if stuck
      setTimeout(() => {
        setCurrentVideoProcessing(prev => {
          if (prev && prev.videoId === videoId) {
            console.log('⚠️ Auto-clearing stuck video processing after timeout');
            return null;
          }
          return prev;
        });
      }, 300000); // 5 minutes

      // Add video processing message
      const processingMessage = {
        id: `processing_${Date.now()}`,
        sender: 'coach',
        timestamp: new Date(),
        messageType: 'video_processing',
        videoId,
        stage: 'uploading',
      };
      setMessages(prev => [...prev, processingMessage]);
      await ChatHistoryManager.saveMessage(userId, processingMessage);

      // Step 1: Upload video and trigger analysis
      const uploadResult = await videoService.uploadAndAnalyze(
        videoUri, 
        videoDuration,
        (progress) => {
          setCurrentVideoProcessing(prev => ({ 
            ...prev, 
            progress: progress * 0.3, // Upload is 30% of total
            stage: 'uploading'
          }));
        }
      );
      
      console.log('✅ Upload complete, jobId:', uploadResult.jobId);
      
      // Step 2: Poll for analysis completion
      setCurrentVideoProcessing(prev => ({ 
        ...prev, 
        stage: 'processing', 
        progress: 30 
      }));
      
      const analysisResult = await videoService.waitForAnalysisComplete(
        uploadResult.jobId,
        (progressInfo) => {
          // Update progress from 30% to 100%
          const analysisProgress = 30 + (progressInfo.progress * 70);
          setCurrentVideoProcessing(prev => ({ 
            ...prev, 
            progress: analysisProgress,
            stage: progressInfo.message?.includes('analyzing') ? 'analyzing' : 'processing'
          }));
        }
      );
      
      console.log('✅ Analysis complete:', analysisResult);
      
      // Step 3: Process analysis results
      if (analysisResult.status === 'completed' && analysisResult.analysis) {
        // Parse the AI analysis
        const aiData = typeof analysisResult.analysis === 'string' 
          ? JSON.parse(analysisResult.analysis) 
          : analysisResult.analysis;
        
        const isFirstAnalysis = conversationSummary?.analysisCount === 0;
        const analysisMessage = {
          id: `analysis_${Date.now()}`,
          sender: 'coach',
          timestamp: new Date(),
          messageType: 'analysis_result',
          videoId,
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
          },
          isFirstAnalysis,
        };
        
        setMessages(prev => [...prev, analysisMessage]);
        await ChatHistoryManager.saveMessage(userId, analysisMessage);
        await ChatHistoryManager.addVideoReference(userId, uploadResult.jobId, analysisMessage.analysisData);
        
        // Update conversation summary
        if (conversationSummary) {
          setConversationSummary({
            ...conversationSummary,
            analysisCount: conversationSummary.analysisCount + 1,
            hasVideoUploads: true,
          });
        }
        
        // Clear processing state
        setCurrentVideoProcessing(null);
        
        // Show celebration for first analysis
        if (isFirstAnalysis) {
          setCelebrationData(analysisMessage.analysisData);
          setTimeout(() => {
            setShowCelebration(true);
          }, 500);
        }
      } else {
        throw new Error('Analysis did not complete successfully');
      }

    } catch (error) {
      console.error('❌ Video processing failed:', error);
      setCurrentVideoProcessing(null);
      
      // More specific error messages
      let errorMessage = 'Sorry, there was an issue processing your video. Please try again.';
      if (error.message.includes('timeout')) {
        errorMessage = 'Analysis is taking longer than expected. Please try again or check your connection.';
      } else if (error.message.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      }
      
      addSystemMessage(errorMessage, 'error');
    }
  };


  // Add system messages
  const addSystemMessage = async (text, type = 'system') => {
    const systemMessage = {
      id: `system_${Date.now()}`,
      text,
      sender: 'coach',
      timestamp: new Date(),
      messageType: type,
    };
    
    setMessages(prev => [...prev, systemMessage]);
    await ChatHistoryManager.saveMessage(userId, systemMessage);
  };

  // Use pure AI response - no canned phrases
  const extractAIResponse = (analysisResult) => {
    // The AI analysis already contains the natural coaching response
    // Just extract it directly without any modifications
    if (analysisResult?.coaching_response) {
      return analysisResult.coaching_response;
    }
    
    // If no coaching response, use the ai_analysis field
    if (analysisResult?.ai_analysis?.coaching_response) {
      return analysisResult.ai_analysis.coaching_response;
    }
    
    // Last fallback - only for connection issues
    return "I had trouble analyzing that swing. Please try uploading another video.";
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
        id: `coach_${Date.now()}`,
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
        id: `coach_${Date.now()}`,
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
  // ChatGPT-style minimal header
  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.title}>Golf Coach</Text>
    </View>
  );

  // Message rendering with coaching presence
  // ChatGPT-style simple message rendering - only user and assistant
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
          {item.text && <Text style={styles.userText}>{item.text}</Text>}
        </View>
      );
    }
    
    // Assistant message (coach) - simple loading state
    if (item.isLoading) {
      return (
        <View style={styles.assistantMessageContainer}>
          <Text style={styles.assistantText}>Analyzing your swing...</Text>
        </View>
      );
    }
    
    // Normal assistant message
    return (
      <View style={styles.assistantMessageContainer}>
        <Text style={styles.assistantText}>{item.text}</Text>
      </View>
    );
  };

  // Get processing message text
  const getProcessingMessage = (stage) => {
    switch (stage) {
      case 'uploading':
        return 'Uploading your swing video to the cloud...';
      case 'processing':
        return 'Processing video and preparing for analysis...';
      case 'extracting':
        return 'Extracting key swing positions (P1-P10)...';
      case 'analyzing':
        return 'AI coach is analyzing your technique...';
      case 'complete':
        return 'Analysis complete! Preparing your coaching insights...';
      default:
        return 'Processing your swing video...';
    }
  };

  // ChatGPT-style input with camera button
  const renderInputSection = () => (
    <View style={styles.inputContainer}>
      <TouchableOpacity style={styles.cameraButton} onPress={handleVideoUpload}>
        <Ionicons name="camera" size={20} color="#666" />
      </TouchableOpacity>
      <TextInput
        style={styles.input}
        placeholder="Message Golf Coach..."
        value={inputText}
        onChangeText={setInputText}
        multiline
        maxHeight={100}
      />
      <TouchableOpacity 
        style={styles.sendButton} 
        onPress={sendMessage}
        disabled={!inputText.trim() || isLoading}
      >
        <Ionicons name="send" size={18} color={inputText.trim() && !isLoading ? "#000" : "#ccc"} />
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
        )}
        
        {isLoading && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <ActivityIndicator size="small" color="#000" />
            <Text style={{ fontSize: 14, color: '#666', fontStyle: 'italic', marginLeft: 8 }}>Coach is thinking...</Text>
          </View>
        )}
        
        {renderInputSection()}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// ChatGPT-inspired minimal styling
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF', // Pure white like ChatGPT
  },
  
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
  },
  
  messagesList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  
  // User messages (right-aligned, simple)
  userMessageContainer: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    marginBottom: 16,
    marginTop: 8,
  },
  
  userText: {
    fontSize: 16,
    color: '#000000',
    lineHeight: 22,
  },
  
  // Assistant messages (left-aligned, simple)  
  assistantMessageContainer: {
    alignSelf: 'flex-start',
    maxWidth: '80%',
    marginBottom: 16,
    marginTop: 8,
  },
  
  assistantText: {
    fontSize: 16,
    color: '#000000',
    lineHeight: 22,
  },
  
  // Video thumbnail in user messages
  videoThumbnail: {
    width: 200,
    height: 112,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 8,
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
  
  // Simple input area
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  
  cameraButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 20,
    maxHeight: 100,
  },
  
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
});

export default ChatScreen;