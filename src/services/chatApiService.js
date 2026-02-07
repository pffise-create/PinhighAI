// chatApiService.js - Production chat API integration
// Single POST /api/chat endpoint. Backend handles thread continuity via JWT -> DynamoDB -> OpenAI Assistants.
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
    this.timeoutMs = 55000; // Align with 60s Lambda timeout (leave headroom)
  }

  buildChatUrl(pathOverride) {
    const path = pathOverride || CHAT_PATH;
    if (!path) return API_BASE_URL;
    if (path.startsWith('http')) return path;
    if (path.startsWith('/')) return `${API_BASE_URL}${path}`;
    return `${API_BASE_URL}/${path}`;
  }

  // Send message to AI coach. Returns { response, timestamp }.
  async sendMessage(message, userId, authHeaders = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.buildChatUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ message: message.trim(), userId }),
        signal: controller.signal,
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

      return {
        response: data.response || data.message,
        timestamp: data.timestamp || new Date().toISOString(),
      };
    } catch (error) {
      clearTimeout(timeoutId);

      // Propagate auth errors directly
      if (error?.message === 'AUTHENTICATION_REQUIRED') throw error;

      // Re-check for auth status codes embedded in error text (word-boundary match
      // to avoid false positives like "Error 4016")
      if (/\bAPI Error (401|403)\b/.test(error.message)) {
        throw new Error('AUTHENTICATION_REQUIRED');
      }

      throw error;
    }
  }
}

// Export singleton instance
export default new ChatApiService();
