// chatApiService.js - Production chat API integration
const API_BASE_URL = 'https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod';

class ChatApiService {
  constructor() {
    this.maxRetries = 2;
    this.timeoutMs = 15000; // 15 second timeout
  }

  // Send message to AI coach with simplified user thread payload
  async sendMessage(message, userId, authHeaders = {}) {
    let attempts = 0;
    
    while (attempts <= this.maxRetries) {
      try {
        console.log(`💬 Sending message to coach API (attempt ${attempts + 1}/${this.maxRetries + 1})`);
        console.log('💬 Simplified request payload:', {
          message: message.trim(),
          userId: userId
        });
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const requestPayload = {
          message: message.trim(),
          userId: userId  // Always include userId for thread continuity
          // Remove: jobId, conversationHistory, swingContext - backend handles this now
        };

        const headers = {
          'Content-Type': 'application/json',
          ...authHeaders
        };
        
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(requestPayload),
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
        console.error('Full error:', error);
        console.error('Request was:', {
          url: `${API_BASE_URL}/api/chat`,
          message: message,
          userId: userId
        });

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
  async testConnection(authHeaders = {}) {
    try {
      console.log('🔍 Testing chat API connection...');
      
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer guest-token', // Dummy token for guest users
        ...authHeaders
      };
      
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: headers,
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

}

// Export singleton instance
export default new ChatApiService();