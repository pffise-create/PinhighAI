/**
 * ConversationContextService - Mobile Context Management for Pin High
 * 
 * Manages coaching conversation context locally on mobile devices.
 * Bridges the gap between swing analysis results and ongoing coaching conversations
 * while managing storage efficiently.
 * 
 * @version 1.0.0
 * @author Pin High Development Team
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Storage keys for different data types
 */
const STORAGE_KEYS = {
  CONVERSATION: (userId) => `conversation_${userId}`,
  COACHING_THEMES: (userId) => `coaching_themes_${userId}`,
  STORAGE_METADATA: (userId) => `storage_metadata_${userId}`,
};

/**
 * Configuration constants
 */
const CONFIG = {
  MAX_MESSAGES: 15,
  MAX_CONTEXT_MESSAGES: 10,
  MAX_STORAGE_SIZE: 50 * 1024, // 50KB per user
  MAX_TOKEN_COUNT: 1000,
  MAX_FOCUS_AREAS: 3,
  ASSEMBLY_TIMEOUT: 500, // 500ms target
};

/**
 * ConversationContextService - Static class for managing conversation context
 */
class ConversationContextService {
  
  /**
   * Assembles coaching context for AI API calls
   * 
   * @param {string} userId - User identifier
   * @param {string|null} currentSwingId - Current swing analysis ID
   * @returns {Promise<Object>} Structured context object under 1,000 tokens
   */
  static async assembleCoachingContext(userId, currentSwingId = null) {
    const startTime = Date.now();
    
    try {
      console.log('🔄 Assembling coaching context for user:', userId);
      
      // Validate input
      if (!userId || typeof userId !== 'string') {
        throw new Error('Invalid userId provided');
      }

      // Parallel data retrieval for performance
      const [currentSwing, recentMessages, coachingThemes] = await Promise.all([
        currentSwingId ? this._fetchSwingAnalysis(currentSwingId) : Promise.resolve(null),
        this._getRecentMessages(userId, CONFIG.MAX_CONTEXT_MESSAGES),
        this.getCoachingThemes(userId)
      ]);

      // Assemble context object
      const context = {
        user_id: userId,
        timestamp: new Date().toISOString(),
        current_swing: currentSwing,
        recent_conversations: recentMessages,
        coaching_themes: coachingThemes,
        session_metadata: {
          total_sessions: coachingThemes.session_count || 0,
          active_focus_areas: coachingThemes.active_focus_areas?.length || 0,
          last_activity: coachingThemes.last_updated || null
        }
      };

      // Optimize for token count
      const optimizedContext = this._optimizeContextForTokens(context);
      
      const assemblyTime = Date.now() - startTime;
      console.log(`✅ Context assembled in ${assemblyTime}ms`);
      
      return optimizedContext;
      
    } catch (error) {
      console.error('❌ Error assembling coaching context:', error);
      
      // Graceful fallback
      return {
        user_id: userId,
        timestamp: new Date().toISOString(),
        current_swing: null,
        recent_conversations: [],
        coaching_themes: this._getDefaultCoachingThemes(),
        session_metadata: { total_sessions: 0, active_focus_areas: 0, last_activity: null },
        error: 'Context assembly failed - using fallback data'
      };
    }
  }

  /**
   * Stores a conversation message with metadata
   * 
   * @param {string} userId - User identifier
   * @param {Object} message - Message object
   * @param {string|null} swingId - Associated swing analysis ID
   * @returns {Promise<boolean>} Success status
   */
  static async storeConversationMessage(userId, message, swingId = null) {
    try {
      console.log('💾 Storing conversation message for user:', userId);
      
      // Validate inputs
      if (!userId || !message) {
        throw new Error('Invalid userId or message provided');
      }

      // Create message object with metadata
      const messageWithMetadata = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        text: message.text || message,
        sender: message.sender || 'user',
        timestamp: new Date().toISOString(),
        swing_reference: swingId,
        context_type: swingId ? 'swing_followup' : 'general_coaching',
        metadata: {
          session_id: message.session_id || null,
          message_type: message.type || 'text',
          confidence: message.confidence || null
        }
      };

      // Get existing messages
      const existingMessages = await this._getStoredMessages(userId);
      
      // Add new message and maintain size limit
      const updatedMessages = [messageWithMetadata, ...existingMessages]
        .slice(0, CONFIG.MAX_MESSAGES);

      // Store updated messages
      await AsyncStorage.setItem(
        STORAGE_KEYS.CONVERSATION(userId),
        JSON.stringify(updatedMessages)
      );

      // Update storage metadata
      await this._updateStorageMetadata(userId);

      // Extract and update coaching themes from the message
      await this.updateCoachingThemes(userId, messageWithMetadata);

      console.log('✅ Message stored successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Error storing conversation message:', error);
      return false;
    }
  }

  /**
   * Retrieves coaching themes for a user
   * 
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Coaching themes object
   */
  static async getCoachingThemes(userId) {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.COACHING_THEMES(userId));
      
      if (!stored) {
        return this._getDefaultCoachingThemes();
      }

      const themes = JSON.parse(stored);
      
      // Validate structure
      if (!themes.active_focus_areas || !Array.isArray(themes.active_focus_areas)) {
        return this._getDefaultCoachingThemes();
      }

      return themes;
      
    } catch (error) {
      console.error('❌ Error retrieving coaching themes:', error);
      return this._getDefaultCoachingThemes();
    }
  }

  /**
   * Updates coaching themes based on new message content
   * 
   * @param {string} userId - User identifier
   * @param {Object} message - Message object to analyze
   * @returns {Promise<boolean>} Success status
   */
  static async updateCoachingThemes(userId, message) {
    try {
      const currentThemes = await this.getCoachingThemes(userId);
      
      // Extract coaching insights from message
      const insights = this._extractCoachingInsights(message);
      
      // Update themes based on insights
      const updatedThemes = {
        ...currentThemes,
        session_count: currentThemes.session_count + (insights.isNewSession ? 1 : 0),
        last_updated: new Date().toISOString(),
        active_focus_areas: this._updateFocusAreas(currentThemes.active_focus_areas, insights),
        graduated_areas: currentThemes.graduated_areas || [],
        focus_change_log: this._updateFocusChangeLog(currentThemes.focus_change_log || [], insights)
      };

      // Store updated themes
      await AsyncStorage.setItem(
        STORAGE_KEYS.COACHING_THEMES(userId),
        JSON.stringify(updatedThemes)
      );

      return true;
      
    } catch (error) {
      console.error('❌ Error updating coaching themes:', error);
      return false;
    }
  }

  /**
   * Clears all stored data for a user
   * 
   * @param {string} userId - User identifier
   * @returns {Promise<boolean>} Success status
   */
  static async clearUserData(userId) {
    try {
      const keys = [
        STORAGE_KEYS.CONVERSATION(userId),
        STORAGE_KEYS.COACHING_THEMES(userId),
        STORAGE_KEYS.STORAGE_METADATA(userId)
      ];

      await Promise.all(keys.map(key => AsyncStorage.removeItem(key)));
      
      console.log('✅ User data cleared successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Error clearing user data:', error);
      return false;
    }
  }

  /**
   * Gets storage usage statistics
   * 
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Storage statistics
   */
  static async getStorageStats(userId) {
    try {
      const [messages, themes, metadata] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.CONVERSATION(userId)),
        AsyncStorage.getItem(STORAGE_KEYS.COACHING_THEMES(userId)),
        AsyncStorage.getItem(STORAGE_KEYS.STORAGE_METADATA(userId))
      ]);

      const sizes = {
        messages: messages ? new Blob([messages]).size : 0,
        themes: themes ? new Blob([themes]).size : 0,
        metadata: metadata ? new Blob([metadata]).size : 0
      };

      const totalSize = sizes.messages + sizes.themes + sizes.metadata;

      return {
        total_size: totalSize,
        size_breakdown: sizes,
        usage_percentage: (totalSize / CONFIG.MAX_STORAGE_SIZE) * 100,
        message_count: messages ? JSON.parse(messages).length : 0,
        is_near_limit: totalSize > (CONFIG.MAX_STORAGE_SIZE * 0.8)
      };
      
    } catch (error) {
      console.error('❌ Error getting storage stats:', error);
      return { total_size: 0, usage_percentage: 0, message_count: 0, is_near_limit: false };
    }
  }

  // =============================================================================
  // PRIVATE HELPER METHODS
  // =============================================================================

  /**
   * Fetches swing analysis data from API
   * @private
   */
  static async _fetchSwingAnalysis(swingId) {
    try {
      // Note: Replace with actual API endpoint
      const API_BASE = 'https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod';
      
      const response = await fetch(`${API_BASE}/analysis/${swingId}`, {
        headers: {
          'Content-Type': 'application/json',
          // Add authentication headers if needed
        }
      });

      if (!response.ok) {
        throw new Error(`API responded with status: ${response.status}`);
      }

      return await response.json();
      
    } catch (error) {
      console.error('❌ Error fetching swing analysis:', error);
      return null;
    }
  }

  /**
   * Gets recent messages from storage
   * @private
   */
  static async _getRecentMessages(userId, limit = CONFIG.MAX_CONTEXT_MESSAGES) {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.CONVERSATION(userId));
      
      if (!stored) {
        return [];
      }

      const messages = JSON.parse(stored);
      return messages.slice(0, limit);
      
    } catch (error) {
      console.error('❌ Error getting recent messages:', error);
      return [];
    }
  }

  /**
   * Gets all stored messages for a user
   * @private
   */
  static async _getStoredMessages(userId) {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.CONVERSATION(userId));
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('❌ Error getting stored messages:', error);
      return [];
    }
  }

  /**
   * Updates storage metadata
   * @private
   */
  static async _updateStorageMetadata(userId) {
    try {
      const metadata = {
        last_updated: new Date().toISOString(),
        total_messages: (await this._getStoredMessages(userId)).length,
        storage_version: '1.0.0'
      };

      await AsyncStorage.setItem(
        STORAGE_KEYS.STORAGE_METADATA(userId),
        JSON.stringify(metadata)
      );
      
    } catch (error) {
      console.error('❌ Error updating storage metadata:', error);
    }
  }

  /**
   * Returns default coaching themes structure
   * @private
   */
  static _getDefaultCoachingThemes() {
    return {
      active_focus_areas: [],
      graduated_areas: [],
      session_count: 0,
      last_updated: new Date().toISOString(),
      focus_change_log: []
    };
  }

  /**
   * Optimizes context object for token efficiency
   * @private
   */
  static _optimizeContextForTokens(context) {
    // Implement token counting and optimization logic
    // For now, return as-is with basic optimization
    
    const optimized = {
      ...context,
      recent_conversations: context.recent_conversations.slice(0, 5), // Limit messages
      coaching_themes: {
        ...context.coaching_themes,
        active_focus_areas: context.coaching_themes.active_focus_areas?.slice(0, CONFIG.MAX_FOCUS_AREAS)
      }
    };

    return optimized;
  }

  /**
   * Extracts coaching insights from message content
   * @private
   */
  static _extractCoachingInsights(message) {
    // Basic insight extraction - can be enhanced with NLP
    const text = message.text?.toLowerCase() || '';
    
    return {
      isNewSession: message.context_type === 'swing_followup',
      containsFocusArea: /setup|swing|follow|grip|stance|posture/.test(text),
      isProgressUpdate: /better|improved|worse|struggling/.test(text),
      focusKeywords: this._extractFocusKeywords(text)
    };
  }

  /**
   * Extracts focus area keywords from text
   * @private
   */
  static _extractFocusKeywords(text) {
    const keywords = [];
    const focusAreas = {
      'setup': ['setup', 'stance', 'posture', 'alignment'],
      'backswing': ['backswing', 'takeaway', 'turn'],
      'downswing': ['downswing', 'transition', 'sequence'],
      'impact': ['impact', 'contact', 'strike'],
      'follow_through': ['follow', 'finish', 'extension']
    };

    Object.entries(focusAreas).forEach(([area, terms]) => {
      if (terms.some(term => text.includes(term))) {
        keywords.push(area);
      }
    });

    return keywords;
  }

  /**
   * Updates focus areas based on insights
   * @private
   */
  static _updateFocusAreas(currentAreas, insights) {
    // Basic focus area management - can be enhanced
    if (!insights.containsFocusArea) {
      return currentAreas;
    }

    const updatedAreas = [...(currentAreas || [])];
    
    // Add new focus areas from keywords (simplified)
    insights.focusKeywords.forEach(keyword => {
      const existingArea = updatedAreas.find(area => area.focus === keyword);
      
      if (existingArea) {
        existingArea.sessions_worked += 1;
        existingArea.last_assessment = new Date().toISOString();
      } else if (updatedAreas.length < CONFIG.MAX_FOCUS_AREAS) {
        updatedAreas.push({
          focus: keyword,
          priority: updatedAreas.length + 1,
          sessions_worked: 1,
          progress_level: 'developing',
          last_assessment: new Date().toISOString()
        });
      }
    });

    return updatedAreas;
  }

  /**
   * Updates focus change log
   * @private
   */
  static _updateFocusChangeLog(currentLog, insights) {
    // Keep log concise - only major changes
    if (insights.isNewSession) {
      return [
        {
          date: new Date().toISOString().split('T')[0],
          action: 'session_start',
          details: `Session with ${insights.focusKeywords.length} focus areas`
        },
        ...currentLog.slice(0, 9) // Keep last 10 entries
      ];
    }

    return currentLog;
  }
}

export default ConversationContextService;