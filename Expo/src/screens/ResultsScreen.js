import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';
import ChatMessage from '../components/ChatMessage';
import CoachingSessionIndicator from '../components/CoachingSessionIndicator';
import ContinueCoachingButton from '../components/ContinueCoachingButton';
import ConversationContextService from '../services/conversationContext';
import { useAuth } from '../context/AuthContext';

const ResultsScreen = ({ navigation, route }) => {
  const { jobId, analysisData: preLoadedAnalysisData } = route.params || {};
  const { user, isAuthenticated } = useAuth();
  
  // Existing state
  const [analysisData, setAnalysisData] = useState(preLoadedAnalysisData || null);
  const [chatMessages, setChatMessages] = useState([]);
  const [loading, setLoading] = useState(!preLoadedAnalysisData);
  const [inputText, setInputText] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const flatListRef = useRef(null);
  
  // New coaching context state
  const [coachingContext, setCoachingContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState(null);
  
  const API_BASE_URL = 'https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod';
  
  // Load coaching context for authenticated users
  useEffect(() => {
    const loadCoachingContext = async () => {
      if (!isAuthenticated || !user?.id) {
        console.log('👤 Guest user - skipping context loading');
        return;
      }

      try {
        setContextLoading(true);
        setContextError(null);
        
        console.log('🔄 Loading coaching context for user:', user.email);
        const context = await ConversationContextService.assembleCoachingContext(
          user.email, 
          jobId // current swing ID
        );
        
        setCoachingContext(context);
        console.log('✅ Coaching context loaded:', context.session_metadata);
        
      } catch (error) {
        console.error('❌ Failed to load coaching context:', error);
        setContextError(error.message);
        // Continue without context - graceful fallback
      } finally {
        setContextLoading(false);
      }
    };
    
    loadCoachingContext();
  }, [isAuthenticated, user?.id, jobId]);

  useEffect(() => {
    if (preLoadedAnalysisData) {
      // Use pre-loaded data and set up initial chat message
      setupInitialChatMessage(preLoadedAnalysisData);
      setLoading(false);
    } else if (jobId) {
      fetchAnalysisResults();
    } else {
      setLoading(false);
    }
  }, [jobId, preLoadedAnalysisData]);

  const setupInitialChatMessage = (data) => {
    const initialMessage = {
      id: 1,
      text: data.coachingResponse || data.rawAnalysis?.coaching_response || "Here's your swing analysis!",
      sender: 'ai',
      timestamp: new Date(),
      type: 'coaching_analysis',
      metadata: {
        symptoms: data.rawAnalysis?.symptoms_detected || [],
        recommendations: data.practiceRecommendations || data.rawAnalysis?.practice_recommendations || [],
        confidence: data.rawAnalysis?.confidence_score || 85
      }
    };
    setChatMessages([initialMessage]);
  };

  const fetchAnalysisResults = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/video/results/${jobId}`);
      const data = await response.json();

      if (data.ai_analysis_completed && data.ai_analysis) {
        setAnalysisData(data);

        const initialMessage = {
          id: 1,
          text: data.ai_analysis.coaching_response,
          sender: 'ai',
          timestamp: new Date(),
          type: 'coaching_analysis',
          metadata: {
            symptoms: data.ai_analysis.symptoms_detected,
            recommendations: data.ai_analysis.practice_recommendations,
            confidence: data.ai_analysis.confidence_score
          }
        };

        setChatMessages([initialMessage]);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error fetching results:', error);
      Alert.alert('Error', 'Failed to load analysis results');
      setLoading(false);
    }
  };

  const sendFollowUpQuestion = async () => {
    if (!inputText.trim()) return;

    // Dismiss keyboard immediately
    Keyboard.dismiss();

    const userMessage = {
      id: chatMessages.length + 1,
      text: inputText,
      sender: 'user',
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    const questionText = inputText; // Store before clearing
    setInputText('');
    setIsSendingMessage(true);

    // Store user message for authenticated users
    if (isAuthenticated && user?.id) {
      try {
        await ConversationContextService.storeConversationMessage(
          user.email,
          { text: questionText, sender: 'user', type: 'swing_followup' },
          jobId
        );
        console.log('✅ User message stored in context');
      } catch (error) {
        console.error('❌ Failed to store user message:', error);
      }
    }

    // Scroll to latest message after adding user message
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);

    try {
      // Enhanced API request with coaching context
      const requestBody = {
        message: questionText,
        context: analysisData.ai_analysis,
        jobId: jobId,
        conversationHistory: chatMessages.slice(-10).map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text
        })),
        // Include coaching context for authenticated users
        ...(isAuthenticated && coachingContext && {
          coachingContext: {
            sessionMetadata: coachingContext.session_metadata,
            coachingThemes: coachingContext.coaching_themes,
            recentConversations: coachingContext.recent_conversations?.slice(0, 5), // Last 5 for efficiency
            userType: 'authenticated'
          }
        }),
        messageType: 'swing_followup'
      };

      console.log('🚀 Sending enhanced follow-up request with context:', !!coachingContext);

      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        console.error('Chat API response not OK:', response.status, response.statusText);
        throw new Error(`API response not OK: ${response.status}`);
      }

      const aiResponse = await response.json();
      console.log('Chat API response:', aiResponse);

      const aiResponseText = aiResponse.response || aiResponse.message || 'Let me help you with that...';

      const aiMessage = {
        id: chatMessages.length + 2,
        text: aiResponseText,
        sender: 'ai',
        timestamp: new Date(),
        type: 'followup'
      };

      setChatMessages(prev => [...prev, aiMessage]);

      // Store AI response for authenticated users
      if (isAuthenticated && user?.id) {
        try {
          await ConversationContextService.storeConversationMessage(
            user.email,
            { text: aiResponseText, sender: 'coach', type: 'swing_followup' },
            jobId
          );
          console.log('✅ AI response stored in context');
        } catch (error) {
          console.error('❌ Failed to store AI response:', error);
        }
      }
      
      // Scroll to latest message after AI response
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.error('Error sending follow-up:', error);
      
      // Provide a contextual fallback response instead of showing error
      const fallbackResponse = getFallbackResponse(inputText, analysisData);
      
      const aiMessage = {
        id: chatMessages.length + 2,
        text: fallbackResponse,
        sender: 'ai',
        timestamp: new Date(),
        type: 'fallback'
      };
      
      setChatMessages(prev => [...prev, aiMessage]);
      
      // Scroll to latest message after fallback response
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } finally {
      setIsSendingMessage(false);
    }
  };

  const getFallbackResponse = (userMessage, analysisData) => {
    const lowerMessage = userMessage.toLowerCase();
    
    // Use the analysis context for specific responses
    if (analysisData && analysisData.ai_analysis) {
      if (lowerMessage.includes('p1') || lowerMessage.includes('address') || lowerMessage.includes('setup')) {
        return 'At address (P1), focus on proper posture: feet shoulder-width apart, slight knee flex, spine tilted away from target, and weight balanced. Based on your swing analysis, ensure you maintain these fundamentals.';
      }
      
      if (lowerMessage.includes('p4') || lowerMessage.includes('top') || lowerMessage.includes('backswing')) {
        return 'At the top (P4), your lead arm should be relatively straight, shoulders turned about 90°, and weight shifted to your trail side. The club should be parallel to the target line for most golfers.';
      }
      
      if (lowerMessage.includes('p7') || lowerMessage.includes('impact')) {
        return 'Impact (P7) is crucial! Your hips should be open to the target, weight shifted forward, hands slightly ahead of the ball, and the clubface square. This is where all your practice pays off.';
      }
      
      if (lowerMessage.includes('practice') || lowerMessage.includes('drill') || lowerMessage.includes('improve')) {
        const recommendations = analysisData.ai_analysis.practice_recommendations || [];
        if (recommendations.length > 0) {
          return `Based on your swing analysis, here are your personalized practice drills:\n${recommendations.map((rec, i) => `${i+1}. ${rec}`).join('\n')}\n\nFocus on these areas for the best improvement!`;
        }
        return 'For effective practice, focus on slow, controlled swings first. Try the alignment stick drill for swing path, mirror work for posture, and impact bag training for solid contact. Quality over quantity!';
      }
      
      if (lowerMessage.includes('slice') || lowerMessage.includes('hook') || lowerMessage.includes('ball flight')) {
        return 'Ball flight issues usually stem from face angle and swing path. A slice typically means an open clubface or out-to-in swing path. Work on grip, setup, and swing plane to improve your ball flight.';
      }
      
      // Reference the specific analysis
      if (analysisData.ai_analysis.root_cause) {
        return `Based on your analysis, the root cause we identified was: ${analysisData.ai_analysis.root_cause}. Try asking me about specific positions in your swing (P1-P10) or practice drills to address this issue.`;
      }
    }
    
    return "I understand you're asking about your golf technique. While I'm having trouble connecting to my full AI system right now, I'm still here to help! Ask me about specific swing positions (P1-P10), common swing faults, practice drills, or any golf fundamentals you'd like to work on.";
  };

  // Navigation to ChatScreen with context
  const handleContinueCoaching = (context) => {
    console.log('🚀 Navigating to ChatScreen with context:', !!context);
    
    navigation.navigate('Chat', {
      coachingContext: context,
      currentSwingId: jobId,
      analysisData: analysisData,
      initialMessage: `Let's continue our coaching conversation about your recent swing analysis.`
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading your coaching analysis...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!jobId || !analysisData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>No analysis data available</Text>
          <TouchableOpacity 
            style={styles.primaryButton}
            onPress={() => navigation.navigate('VideoRecord')}
          >
            <Text style={styles.buttonText}>Upload a Video</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }


  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        {/* Coaching Session Indicator for authenticated users */}
        <CoachingSessionIndicator
          sessionNumber={coachingContext?.session_metadata?.total_sessions || 0}
          currentFocus={coachingContext?.coaching_themes?.active_focus_areas}
          timeline={coachingContext?.coaching_themes?.last_updated}
          loading={contextLoading}
        />

        <FlatList
          ref={flatListRef}
          data={chatMessages}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <ChatMessage 
              message={item} 
              analysisData={analysisData}
            />
          )}
          style={styles.chatContainer}
          contentContainerStyle={styles.chatContentContainer}
          showsVerticalScrollIndicator={false}
        />

        {/* Continue Coaching Button */}
        <ContinueCoachingButton
          onPress={handleContinueCoaching}
          context={coachingContext}
          loading={contextLoading}
          disabled={!analysisData}
        />

        <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ask a follow-up question about your swing..."
          multiline
          maxLength={500}
        />
        <TouchableOpacity 
          onPress={sendFollowUpQuestion}
          disabled={isSendingMessage || !inputText.trim()}
          style={[
            styles.sendButton,
            (!inputText.trim() || isSendingMessage) && styles.sendButtonDisabled
          ]}
        >
          {isSendingMessage ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Text style={styles.sendButtonText}>Send</Text>
          )}
        </TouchableOpacity>
      </View>

        <View style={styles.bottomActions}>
          <TouchableOpacity 
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('VideoRecord')}
          >
            <Text style={styles.secondaryButtonText}>Upload Another Video</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.lg,
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  errorText: {
    fontSize: typography.fontSizes.lg,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginHorizontal: spacing.base,
    marginTop: spacing.base,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    ...shadows.sm,
  },
  summaryTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  confidenceScore: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontFamily: typography.fontFamily,
  },
  chatContainer: {
    flex: 1,
    paddingHorizontal: spacing.base,
  },
  chatContentContainer: {
    paddingBottom: spacing.lg,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    maxHeight: 100,
    fontSize: typography.fontSizes.base,
    fontFamily: typography.fontFamily,
    backgroundColor: colors.background,
  },
  sendButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 60,
  },
  sendButtonDisabled: {
    backgroundColor: colors.textSecondary,
    opacity: 0.5,
  },
  sendButtonText: {
    color: colors.background,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },
  bottomActions: {
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing['2xl'],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    ...shadows.base,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.base,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  buttonText: {
    color: colors.background,
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },
});

export default ResultsScreen;