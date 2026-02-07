// chatApiService.js - Production chat API integration
const DEFAULT_BASE_URL = 'https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod';
const resolveBaseUrl = (value) => {
  const base = value || DEFAULT_BASE_URL;
  return base.endsWith('/') ? base.slice(0, -1) : base;
};
const API_BASE_URL = resolveBaseUrl(process.env.EXPO_PUBLIC_API_URL);
const CHAT_PATH = process.env.EXPO_PUBLIC_CHAT_PATH || '/api/chat';

class ChatApiService {
  constructor() {
    // Chat can legitimately take >15s (OpenAI Assistants runs, cold starts).
    // Keep retries low to avoid duplicate server-side work.
    this.maxRetries = 0;
    this.timeoutMs = 55000; // Align with 60s Lambda timeout (leave headroom)
  }

  buildChatUrl(pathOverride) {
    const path = pathOverride || CHAT_PATH;
    if (!path) {
      return API_BASE_URL;
    }
    if (path.startsWith('http')) {
      return path;
    }
    if (path.startsWith('/')) {
      return `${API_BASE_URL}${path}`;
    }
    return `${API_BASE_URL}/${path}`;
  }

  // Send message to AI coach with simplified user thread payload
  async sendMessage(message, userId, authHeaders = {}, onProgress) {
    let attempts = 0;

    while (attempts <= this.maxRetries) {
      try {
        const attemptLabel = `${attempts + 1}/${this.maxRetries + 1}`;
        console.log(`Sending message to coach API (attempt ${attemptLabel})`);
        onProgress?.(`Sending (attempt ${attemptLabel})...`);
        console.log('Request payload:', {
          message: message.trim(),
          userId: userId
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const requestPayload = {
          message: message.trim(),
          userId: userId
        };

        const headers = {
          'Content-Type': 'application/json',
          ...authHeaders
        };

        const chatUrl = this.buildChatUrl();
        onProgress?.('Waiting for coach...');
        const response = await fetch(chatUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(requestPayload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 401 || response.status === 403) {
          throw new Error('AUTHENTICATION_REQUIRED');
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        console.log('Coach API response received');
        onProgress?.('Response received');

        return {
          success: true,
          response: data.response || data.message,
          message: data.message || data.response,
          tokensUsed: data.tokensUsed || 0,
          timestamp: data.timestamp || new Date().toISOString()
        };

      } catch (error) {
        attempts++;
        if (error?.message === 'AUTHENTICATION_REQUIRED') {
          throw error;
        }

        console.error(`Chat API attempt ${attempts} failed:`, error.message);
        onProgress?.('Connection issue, retrying...');

        // If this was the last attempt, throw error or return fallback
        if (attempts > this.maxRetries) {
          // Check if it's an auth error
          if (error.message.includes('401') || error.message.includes('403')) {
            throw new Error('AUTHENTICATION_REQUIRED');
          }
          return this.getFallbackResponse(message, error);
        }

        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 1000));
      }
    }
  }

  // Provide honest fallback responses
  getFallbackResponse(userMessage, error) {
    console.log('Providing fallback coaching response');
    
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
      console.log('Testing chat API connection...');
      
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer guest-token', // Dummy token for guest users
        ...authHeaders
      };
      
      const chatUrl = this.buildChatUrl();
      const response = await fetch(chatUrl, {
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
        console.log('Chat API is responding');
        return true;
      } else {
        console.warn('Chat API returned non-200 status:', response.status);
        return false;
      }
      
    } catch (error) {
      console.error('Chat API connection test failed:', error.message);
      return false;
    }
  }

}

// Export singleton instance
export default new ChatApiService();



