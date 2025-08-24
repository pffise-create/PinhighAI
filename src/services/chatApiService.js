// chatApiService.js - Production chat API integration
const API_BASE_URL = 'https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod';

class ChatApiService {
  constructor() {
    this.maxRetries = 2;
    this.timeoutMs = 15000; // 15 second timeout
  }

  // Send message to AI coach with retry logic
  async sendMessage(message, userId, conversationHistory = [], coachingContext = {}) {
    let attempts = 0;
    
    while (attempts <= this.maxRetries) {
      try {
        console.log(`💬 Sending message to coach API (attempt ${attempts + 1}/${this.maxRetries + 1})`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(`${API_BASE_URL}/api/chat/coaching`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: message,
            userId: userId,
            messageType: 'general_coaching',
            conversationHistory: conversationHistory.slice(-10), // Last 10 messages for context
            coachingContext: {
              sessionMetadata: coachingContext.sessionMetadata || {},
              hasVideoUploads: coachingContext.hasVideoUploads || false,
              analysisCount: coachingContext.analysisCount || 0,
              recentCoachingThemes: coachingContext.recentCoachingThemes || []
            }
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        
        console.log('✅ Coach API response received');
        
        return {
          success: true,
          response: data.response, // Pure AI response - no fallback text
          tokensUsed: data.tokensUsed || 0,
          timestamp: data.timestamp || new Date().toISOString()
        };

      } catch (error) {
        attempts++;
        console.error(`❌ Chat API attempt ${attempts} failed:`, error.message);

        // If this was the last attempt, return fallback
        if (attempts > this.maxRetries) {
          return this.getFallbackResponse(message, error);
        }

        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 1000));
      }
    }
  }

  // Provide honest fallback responses
  getFallbackResponse(userMessage, error) {
    console.log('🔄 Providing fallback coaching response');
    
    const message = userMessage.toLowerCase();
    let fallbackText;

    // Honest fallback based on message content
    if (message.includes('thank')) {
      fallbackText = 'You\'re welcome! I\'m having connection issues right now, so please try again in a few minutes.';
    } else if (message.includes('practice') || message.includes('drill') || message.includes('improve')) {
      fallbackText = 'That\'s a great question about practice! I\'m having trouble connecting right now to give you a personalized answer. Please try again in a few minutes when my connection is restored.';
    } else {
      fallbackText = 'I\'m having trouble connecting right now. Please try again in a few minutes.';
    }

    return {
      success: false,
      response: fallbackText,
      tokensUsed: 0,
      timestamp: new Date().toISOString(),
      error: error.message,
      fallback: true
    };
  }

  // Test API connectivity
  async testConnection() {
    try {
      console.log('🔍 Testing chat API connection...');
      
      const response = await fetch(`${API_BASE_URL}/api/chat/coaching`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'ping',
          userId: 'test',
          messageType: 'general_coaching',
          conversationHistory: []
        })
      });

      if (response.ok) {
        console.log('✅ Chat API is responding');
        return true;
      } else {
        console.warn('⚠️ Chat API returned non-200 status:', response.status);
        return false;
      }
      
    } catch (error) {
      console.error('❌ Chat API connection test failed:', error.message);
      return false;
    }
  }

  // Format conversation history for API
  formatConversationHistory(messages) {
    return messages
      .filter(msg => msg.messageType !== 'video_processing' && msg.messageType !== 'system')
      .slice(-10) // Last 10 relevant messages
      .map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.text
      }));
  }

  // Extract coaching context from conversation summary
  formatCoachingContext(conversationSummary, messages = []) {
    const recentAnalyses = messages
      .filter(msg => msg.messageType === 'analysis_result')
      .slice(-3); // Last 3 analyses

    const recentCoachingThemes = recentAnalyses
      .map(msg => msg.analysisData?.keyInsights || [])
      .flat()
      .slice(0, 5);

    return {
      sessionMetadata: {
        totalMessages: conversationSummary?.totalMessages || 0,
        analysisCount: conversationSummary?.analysisCount || 0,
        isFirstTime: conversationSummary?.isFirstTime || false,
        lastInteraction: conversationSummary?.lastInteraction
      },
      hasVideoUploads: conversationSummary?.hasVideoUploads || false,
      analysisCount: conversationSummary?.analysisCount || 0,
      recentCoachingThemes: recentCoachingThemes
    };
  }
}

// Export singleton instance
export default new ChatApiService();