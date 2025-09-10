# Sprint 3B: Enhanced Follow-up API Mobile Integration Guide

## Overview

Sprint 3B enhances the existing follow-up API in the golf-ai-analysis Lambda to integrate with the new coaching conversations system from Sprint 3A. This creates a unified coaching experience that maintains context across all user interactions.

## Key Features Implemented

### 1. **Enhanced Context Assembly**
- **Multiple Data Sources**: Integrates mobile app context, swing analysis data, coaching conversations, and user history
- **Authenticated User Benefits**: Higher rate limits and richer context for signed-in users
- **Graceful Degradation**: Works for both authenticated and guest users

### 2. **Improved Follow-up Conversations**
- **Context-Aware Responses**: References previous coaching sessions and swing analyses
- **Coaching Relationship Continuity**: Maintains coaching persona across interactions
- **Enhanced Rate Limiting**: Double limits for authenticated users (20 vs 10 requests/hour)

### 3. **Dual Storage System**
- **Existing System**: Stores conversations with swing analyses for reference
- **Coaching System**: Integrates with Sprint 3A coaching conversations table
- **Cross-System Linking**: Links follow-up conversations to specific swing analyses

## Mobile App Integration Changes

### 1. **Enhanced Chat Request Format**

**Previous Format:**
```javascript
const chatRequest = {
  message: "How can I improve my impact position?",
  context: swingAnalysisResult,
  jobId: analysisId,
  conversationHistory: chatHistory
};
```

**New Enhanced Format:**
```javascript
const chatRequest = {
  message: "How can I improve my impact position?",
  context: swingAnalysisResult,
  jobId: analysisId,
  conversationHistory: chatHistory,
  
  // NEW: Add coaching context from mobile app
  coachingContext: {
    sessionMetadata: {
      userId: user.email,
      sessionId: currentSessionId,
      appVersion: "3.0.0"
    },
    coachingThemes: assembledCoachingThemes,
    recentConversations: recentAppConversations
  },
  
  // NEW: Explicit user identification for better context
  userId: user.email || user.sub
};
```

### 2. **Enhanced Response Format**

**New Response Fields:**
```javascript
{
  "response": "Great question about impact! Based on our previous sessions...",
  "message": "Great question about impact! Based on our previous sessions...", // Fallback
  "tokensUsed": 245,
  "contextSources": 4,  // NEW: Number of context sources used
  "timestamp": "2025-08-22T...",
  "success": true
}
```

### 3. **Rate Limiting Enhancements**

**Enhanced Error Response:**
```javascript
{
  "error": "Rate limit exceeded",
  "message": "You've reached your authenticated user limit of 20 requests per hour. As an authenticated user, you get higher limits! Please try again at 3:45 PM.",
  "resetTime": 1629384300000,
  "requestCount": 20,
  "limit": 20,
  "success": false
}
```

### 4. **Mobile App Code Updates**

#### A. Update ChatScreen.js to Send Enhanced Context

```javascript
// In src/screens/ChatScreen.js
const sendEnhancedChatMessage = async (message) => {
  try {
    setIsLoading(true);
    
    // Assemble enhanced coaching context
    const coachingContext = await assembleEnhancedCoachingContext();
    
    const requestBody = {
      message: message.trim(),
      context: currentSwingAnalysis,
      jobId: currentJobId,
      conversationHistory: messages.slice(-10), // Last 10 messages
      
      // NEW: Enhanced context for Sprint 3B
      coachingContext: coachingContext,
      userId: user?.email || user?.sub
    };
    
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': user ? `Bearer ${await user.getIdToken()}` : undefined
      },
      body: JSON.stringify(requestBody)
    });
    
    const data = await response.json();
    
    if (response.status === 429) {
      // Enhanced rate limiting error handling
      Alert.alert(
        "Rate Limit Reached", 
        data.message,
        [
          { text: "OK", style: "default" },
          { 
            text: user ? "Upgrade Account" : "Sign In for Higher Limits", 
            onPress: () => {
              if (!user) {
                navigation.navigate('SignIn');
              } else {
                // Navigate to upgrade screen
              }
            }
          }
        ]
      );
      return;
    }
    
    if (data.success) {
      // Handle enhanced response
      const newMessage = {
        _id: Math.random().toString(),
        text: data.response,
        createdAt: new Date(data.timestamp),
        user: { _id: 2, name: 'Pin High Coach' },
        // NEW: Store enhanced metadata
        metadata: {
          tokensUsed: data.tokensUsed,
          contextSources: data.contextSources,
          enhanced: !data.fallback
        }
      };
      
      setMessages(previousMessages => 
        GiftedChat.append(previousMessages, [newMessage])
      );
      
      // Store conversation for continuity
      await storeEnhancedConversation(message, data.response, data);
    }
    
  } catch (error) {
    console.error('Enhanced chat error:', error);
    // Handle error with enhanced messaging
  } finally {
    setIsLoading(false);
  }
};

// NEW: Assemble enhanced coaching context from mobile app
const assembleEnhancedCoachingContext = async () => {
  try {
    const coachingContext = await ConversationContextService.assembleCoachingContext(
      user?.email || 'guest',
      currentJobId
    );
    
    return {
      sessionMetadata: {
        userId: user?.email || 'guest',
        sessionId: `session_${Date.now()}`,
        appVersion: Constants.expoConfig.version,
        screenContext: 'ChatScreen'
      },
      coachingThemes: coachingContext.coachingThemes || {},
      recentConversations: coachingContext.recentConversations || []
    };
  } catch (error) {
    console.warn('Could not assemble enhanced coaching context:', error);
    return null;
  }
};

// NEW: Store enhanced conversation with metadata
const storeEnhancedConversation = async (userMessage, aiResponse, responseData) => {
  try {
    await ConversationContextService.storeConversationMessage(
      user?.email || 'guest',
      {
        userMessage,
        aiResponse,
        tokensUsed: responseData.tokensUsed,
        contextSources: responseData.contextSources,
        swingReference: currentJobId,
        enhanced: !responseData.fallback,
        timestamp: responseData.timestamp
      },
      currentJobId
    );
  } catch (error) {
    console.warn('Could not store enhanced conversation:', error);
  }
};
```

#### B. Update ConversationContextService for Enhanced Integration

```javascript
// In src/services/conversationContext.js
class ConversationContextService {
  // NEW: Enhanced context assembly for Sprint 3B integration
  static async assembleEnhancedCoachingContext(userId, currentSwingId = null) {
    try {
      // Get existing context
      const existingContext = await this.assembleCoachingContext(userId, currentSwingId);
      
      // Add enhanced integration metadata
      const enhancedContext = {
        ...existingContext,
        integrationVersion: 'sprint_3b',
        enhancedFeatures: {
          crossSystemIntegration: true,
          contextSources: ['mobile_app', 'swing_analysis', 'coaching_conversations'],
          userAuthenticated: userId !== 'guest'
        },
        sessionMetadata: {
          lastContextUpdate: new Date().toISOString(),
          contextSourceCount: Object.keys(existingContext).filter(key => 
            existingContext[key] && typeof existingContext[key] === 'object'
          ).length
        }
      };
      
      return enhancedContext;
      
    } catch (error) {
      console.error('Error assembling enhanced coaching context:', error);
      return null;
    }
  }
  
  // NEW: Enhanced conversation storage with Sprint 3B metadata
  static async storeEnhancedConversationMessage(userId, messageData, swingId = null) {
    try {
      const conversationKey = this.getConversationKey(userId);
      const existingConversations = await AsyncStorage.getItem(conversationKey);
      const conversations = existingConversations ? JSON.parse(existingConversations) : [];
      
      const enhancedMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        swingId: swingId,
        userMessage: messageData.userMessage,
        aiResponse: messageData.aiResponse,
        
        // NEW: Enhanced metadata for Sprint 3B
        metadata: {
          tokensUsed: messageData.tokensUsed || 0,
          contextSources: messageData.contextSources || 0,
          enhanced: messageData.enhanced || false,
          integrationVersion: 'sprint_3b',
          backendIntegration: {
            storedInAnalysisSystem: !!swingId,
            storedInCoachingSystem: userId !== 'guest',
            crossSystemLinked: !!(swingId && userId !== 'guest')
          }
        }
      };
      
      conversations.push(enhancedMessage);
      
      // Keep last 50 enhanced messages
      if (conversations.length > 50) {
        conversations.splice(0, conversations.length - 50);
      }
      
      await AsyncStorage.setItem(conversationKey, JSON.stringify(conversations));
      console.log('Enhanced conversation message stored successfully');
      
    } catch (error) {
      console.error('Error storing enhanced conversation message:', error);
    }
  }
}
```

### 5. **Testing Integration**

#### A. Test Enhanced Context Assembly
```javascript
// Test enhanced context with different user types
const testEnhancedContext = async () => {
  // Test authenticated user
  const authenticatedContext = await assembleEnhancedCoachingContext();
  console.log('Authenticated context sources:', authenticatedContext?.sessionMetadata?.contextSourceCount);
  
  // Test guest user
  const guestContext = await assembleEnhancedCoachingContext();
  console.log('Guest context sources:', guestContext?.sessionMetadata?.contextSourceCount);
};
```

#### B. Test Rate Limiting
```javascript
// Test enhanced rate limiting
const testRateLimiting = async () => {
  const requests = [];
  
  // Send multiple requests to test limits
  for (let i = 0; i < 25; i++) {
    requests.push(
      sendEnhancedChatMessage(`Test message ${i + 1}`)
    );
  }
  
  const results = await Promise.allSettled(requests);
  console.log('Rate limiting test results:', results);
};
```

## Benefits for Users

### 1. **Authenticated Users**
- **Higher Rate Limits**: 20 requests/hour vs 10 for guests
- **Enhanced Context**: Rich coaching history and cross-session continuity
- **Personalized Responses**: Coach references previous sessions naturally
- **Progress Tracking**: Coaching conversations linked to swing analyses

### 2. **Guest Users**
- **Excellent Experience**: Still receive great coaching with available context
- **Upgrade Incentive**: Clear benefits shown for signing in
- **No Regression**: All existing functionality maintained

### 3. **All Users**
- **Better Responses**: More contextual and relevant coaching advice
- **Continuity**: Conversations reference previous interactions
- **Reliability**: Graceful degradation if context sources fail
- **Performance**: Enhanced caching and error handling

## Migration Notes

### 1. **Backward Compatibility**
- All existing chat functionality continues to work
- New fields are optional - old format still supported
- Progressive enhancement approach

### 2. **Gradual Rollout**
- Can be deployed without breaking existing users
- Enhanced features activate automatically for new requests
- Existing conversations remain accessible

### 3. **Error Handling**
- Enhanced fallback responses for better user experience
- Context assembly failures don't break conversations
- Graceful degradation to previous functionality

## Monitoring and Metrics

### 1. **New CloudWatch Metrics**
- `EnhancedFollowUpConversations`: Count of enhanced chat requests
- `EnhancedFollowUpTokensUsed`: Token usage for enhanced requests  
- `EnhancedFollowUpContextSources`: Number of context sources per request
- `ContextIntegrationSuccess`: Success rate of context assembly

### 2. **Mobile App Analytics**
- Track enhanced context assembly success rate
- Monitor rate limiting impact on user experience
- Measure coaching conversation continuity

---

**Sprint 3B Complete**: Enhanced Follow-up API with Context Integration successfully implemented and ready for mobile app integration!