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
} from 'react-native';
import { colors, typography, spacing, borderRadius, shadows, coaching } from '../utils/theme';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import ChatHistoryManager from '../services/chatHistoryManager';
import ChatHeader from '../components/ChatHeader';
import ProgressiveOnboardingMessage from '../components/ProgressiveOnboardingMessage';
import UploadOptionsModal from '../components/UploadOptionsModal';
import VideoProgressMessage from '../components/VideoProgressMessage';
import AnalysisResultMessage from '../components/AnalysisResultMessage';
import FirstAnalysisCelebration from '../components/FirstAnalysisCelebration';
import videoService from '../services/videoService';
import chatApiService from '../services/chatApiService';
import * as ImagePicker from 'expo-image-picker';

const ChatScreen = ({ navigation, route }) => {
  const { user, isAuthenticated } = useAuth();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [onboardingType, setOnboardingType] = useState(null);
  const [conversationSummary, setConversationSummary] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [currentVideoProcessing, setCurrentVideoProcessing] = useState(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationData, setCelebrationData] = useState(null);
  const flatListRef = useRef(null);
  
  const userId = user?.email || 'guest';

  useEffect(() => {
    initializePrimaryChat();
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
      setIsLoadingHistory(true);

      // Load conversation history
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

      setMessages(displayMessages);

      // Determine onboarding experience
      if (summary.isFirstTime && summary.totalMessages === 0) {
        setOnboardingType('firstTime');
        // Add welcome message for first-time users
        const welcomeMessage = {
          id: `welcome_${Date.now()}`,
          text: "Hi! I'm your AI golf coach. Ready to analyze your swing? Tap 📹 above to start!",
          sender: 'coach',
          timestamp: new Date(),
          messageType: 'onboarding',
        };
        setMessages([welcomeMessage]);
        
        // Save welcome message
        await ChatHistoryManager.saveMessage(userId, welcomeMessage);
      } else if (summary.analysisCount === 1 && !hasRecentCelebration(displayMessages)) {
        setOnboardingType('firstAnalysisComplete');
      } else if (summary.totalMessages > 0) {
        setOnboardingType('returningUser');
        // Clean UI - no welcome back messages
      }

    } catch (error) {
      console.error('Failed to initialize chat:', error);
      // Fallback to first-time experience
      setOnboardingType('firstTime');
      const fallbackMessage = {
        id: 'fallback_welcome',
        text: "Hi! I'm your AI golf coach. Let's get started by analyzing your swing!",
        sender: 'coach',
        timestamp: new Date(),
        messageType: 'onboarding',
      };
      setMessages([fallbackMessage]);
    } finally {
      setIsLoadingHistory(false);
    }
  };


  // Check if user has recent celebration message
  const hasRecentCelebration = (messages) => {
    return messages.some(msg => 
      msg.messageType === 'celebration' || 
      msg.text.includes('analysis is complete!') ||
      msg.text.includes('🎉')
    );
  };

  // Handle video upload
  const handleVideoUpload = () => {
    console.log('🎥 Video upload button pressed');
    setShowUploadModal(true);
    console.log('📱 Upload modal should now be visible:', true);
  };

  const openCamera = () => {
    setShowUploadModal(false);
    setOnboardingType('postUpload');
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
      
      // Set current processing video
      setCurrentVideoProcessing({
        videoId,
        stage: 'uploading',
        progress: 0,
      });

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
        text: result.response,
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


  // Handle onboarding actions
  const handleOnboardingAction = () => {
    switch (onboardingType) {
      case 'firstTime':
      case 'returningUser':
        handleVideoUpload();
        break;
      case 'firstAnalysisComplete':
        // Scroll to analysis or show details
        setOnboardingType(null);
        break;
      default:
        setOnboardingType(null);
    }
  };

  // Render message component
  // Clean header with video upload
  const renderHeader = () => (
    <View style={styles.header}>
      <View>
        <Text style={styles.headerTitle}>Coaching Chat</Text>
        <Text style={styles.headerSubtitle}>
          Your AI golf coach is here to help
        </Text>
      </View>
      <TouchableOpacity 
        style={styles.headerCameraButton} 
        onPress={handleVideoUpload}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="videocam" size={24} color={colors.coachAccent} />
      </TouchableOpacity>
    </View>
  );

  // Message rendering with coaching presence
  const renderMessage = ({ item }) => {
    const isCoach = item.sender === 'coach';
    const isOnboarding = item.messageType === 'onboarding';
    const isProgress = item.messageType === 'progress';
    const isVideoProcessing = item.messageType === 'video_processing';
    const isAnalysisResult = item.messageType === 'analysis_result';
    
    // Render video processing message
    if (isVideoProcessing) {
      const processingData = currentVideoProcessing && currentVideoProcessing.videoId === item.videoId 
        ? currentVideoProcessing 
        : { stage: item.stage || 'processing', progress: 0 };
      
      return (
        <VideoProgressMessage
          stage={processingData.stage}
          progress={processingData.progress}
          message={getProcessingMessage(processingData.stage)}
          videoId={item.videoId}
        />
      );
    }

    // Render analysis result message
    if (isAnalysisResult) {
      return (
        <AnalysisResultMessage
          analysisData={item.analysisData}
          isFirstAnalysis={item.isFirstAnalysis}
          videoId={item.videoId}
        />
      );
    }
    
    // Clean coaching message rendering
    if (isCoach) {
      return (
        <View style={styles.coachingMessageContainer}>
          <View style={[
            styles.coachingMessage,
            isOnboarding && styles.onboardingMessage,
            isProgress && styles.progressMessage,
          ]}>
            <Text style={styles.coachingMessageText}>{item.text}</Text>
          </View>
          <Text style={styles.messageTimestamp}>
            {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      );
    }
    
    // User message rendering
    return (
      <View style={styles.userMessageContainer}>
        <View style={styles.userMessage}>
          <Text style={styles.userMessageText}>{item.text}</Text>
        </View>
        <Text style={styles.messageTimestamp}>
          {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
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

  // Clean input section
  const renderInputSection = () => (
    <View style={styles.inputContainer}>
      <TextInput
        style={styles.textInput}
        value={inputText}
        onChangeText={setInputText}
        placeholder={currentVideoProcessing ? "Video processing..." : "Ask your coach anything..."}
        placeholderTextColor={colors.textLight}
        multiline
        maxLength={500}
        onSubmitEditing={sendMessage}
        returnKeyType="send"
        editable={!currentVideoProcessing}
      />
      
      <TouchableOpacity 
        style={[styles.sendButton, (!inputText.trim() || isLoading || currentVideoProcessing) && styles.disabledButton]}
        onPress={sendMessage}
        accessible={true}
        accessibilityLabel="Send message"
        disabled={!inputText.trim() || isLoading || currentVideoProcessing}
      >
        <Ionicons name="send" size={20} color={colors.surface} />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}

      <KeyboardAvoidingView 
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Upload Options Modal */}
        <UploadOptionsModal
          visible={showUploadModal}
          onClose={() => {
            console.log('🚫 Upload modal closed');
            setShowUploadModal(false);
          }}
          onRecordVideo={() => {
            console.log('📹 Record video selected');
            openCamera();
          }}
          onChooseFromGallery={() => {
            console.log('📱 Gallery selection selected');
            openGallery();
          }}
        />

        {/* First Analysis Celebration */}
        <FirstAnalysisCelebration
          visible={showCelebration}
          analysisData={celebrationData}
          onClose={() => {
            setShowCelebration(false);
            setOnboardingType(null);
          }}
          onViewAnalysis={() => {
            setShowCelebration(false);
            // Scroll to the analysis message
            flatListRef.current?.scrollToEnd({ animated: true });
          }}
        />

        {/* Progressive Onboarding */}
        {onboardingType && !showCelebration && (
          <ProgressiveOnboardingMessage
            type={onboardingType}
            onActionPress={handleOnboardingAction}
            onDismiss={() => setOnboardingType(null)}
          />
        )}

        {isLoadingHistory ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading your coaching history...</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={item => item.id}
            style={styles.messagesList}
            contentContainerStyle={styles.messagesContent}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
          />
        )}
        
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Coach is thinking...</Text>
          </View>
        )}
        
        {renderInputSection()}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  
  // Clean header styling
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  
  headerTitle: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
  },
  
  headerCameraButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.coachAccent + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  headerSubtitle: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginTop: spacing.xs,
  },
  
  chatContainer: {
    flex: 1,
  },
  
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  
  loadingText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontStyle: 'italic',
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  
  messagesList: {
    flex: 1,
  },
  
  messagesContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  
  // Clean coaching message containers
  coachingMessageContainer: {
    alignSelf: 'flex-start',
    maxWidth: '88%',
    marginBottom: spacing.lg,
    marginLeft: spacing.lg,
    marginRight: spacing['2xl'],
  },
  
  coachingMessage: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.coachAccent,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    ...shadows.sm,
  },
  
  onboardingMessage: {
    backgroundColor: colors.success + '15', // Light green with transparency
    borderLeftColor: colors.success,
  },
  
  progressMessage: {
    backgroundColor: colors.warning + '15', // Light orange with transparency
    borderLeftColor: colors.warning,
  },
  
  coachingMessageText: {
    fontSize: typography.fontSizes.base,
    lineHeight: typography.lineHeights.relaxed,
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  
  // Clean user message containers
  userMessageContainer: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    marginBottom: spacing.lg,
    marginRight: spacing.lg,
    marginLeft: spacing['2xl'],
  },
  
  userMessage: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    ...shadows.sm,
  },
  
  userMessageText: {
    fontSize: typography.fontSizes.base,
    lineHeight: typography.lineHeights.relaxed,
    color: colors.surface,
    fontFamily: typography.fontFamily,
  },
  
  messageTimestamp: {
    fontSize: typography.fontSizes.xs,
    color: colors.textLight,
    fontFamily: typography.fontFamily,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
  
  // Clean input section
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  
  
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    fontSize: typography.fontSizes.base,
    fontFamily: typography.fontFamily,
    color: colors.text,
    backgroundColor: colors.background,
    maxHeight: 100,
    marginRight: spacing.sm,
  },
  
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.coachAccent,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.sm,
  },
  
  disabledButton: {
    backgroundColor: colors.textLight,
    opacity: 0.6,
  },
});

export default ChatScreen;