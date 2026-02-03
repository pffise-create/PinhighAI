// ChatHistoryManager.js - Conversation persistence and management
import AsyncStorage from '@react-native-async-storage/async-storage';

const MAX_MESSAGES = 50;
const STORAGE_PREFIX = 'chat_history_';

export class ChatHistoryManager {
  // Load conversation from storage
  static async loadConversation(userId = 'default') {
    try {
      const storageKey = `${STORAGE_PREFIX}${userId}`;
      const data = await AsyncStorage.getItem(storageKey);
      
      if (!data) {
        return {
          messages: [],
          lastUpdated: new Date().toISOString(),
          messageCount: 0,
          userProfile: {
            isFirstTime: true,
            lastInteraction: new Date().toISOString(),
          }
        };
      }

      const conversation = JSON.parse(data);
      
      // Ensure data integrity
      if (!conversation.messages || !Array.isArray(conversation.messages)) {
        console.warn('Invalid conversation data, resetting');
        return await this.resetConversation(userId);
      }

      return conversation;
    } catch (error) {
      console.error('Failed to load conversation:', error);
      // Return fresh conversation on error
      return {
        messages: [],
        lastUpdated: new Date().toISOString(),
        messageCount: 0,
        userProfile: {
          isFirstTime: true,
          lastInteraction: new Date().toISOString(),
        }
      };
    }
  }

  // Save a single message to conversation
  static async saveMessage(userId = 'default', message) {
    try {
      const conversation = await this.loadConversation(userId);
      
      // Create message object
      const newMessage = {
        id: Date.now().toString(),
        text: message.text || '',
        sender: message.sender || 'user', // 'user' or 'coach'
        timestamp: new Date().toISOString(),
        videoReference: message.videoReference || null,
        messageType: message.messageType || 'text', // 'text', 'video_upload', 'analysis_result', 'progress'
        ...message, // Allow additional properties
      };

      // Add message to conversation
      conversation.messages.push(newMessage);
      conversation.messageCount = conversation.messages.length;
      conversation.lastUpdated = new Date().toISOString();
      conversation.userProfile.lastInteraction = new Date().toISOString();
      conversation.userProfile.isFirstTime = false;

      // Clean up old messages if over limit
      if (conversation.messages.length > MAX_MESSAGES) {
        await this.clearOldMessages(userId, conversation);
      }

      // Save updated conversation
      const storageKey = `${STORAGE_PREFIX}${userId}`;
      await AsyncStorage.setItem(storageKey, JSON.stringify(conversation));

      return newMessage;
    } catch (error) {
      console.error('Failed to save message:', error);
      throw error;
    }
  }

  // Remove old messages to stay under limit
  static async clearOldMessages(userId = 'default', conversation = null) {
    try {
      if (!conversation) {
        conversation = await this.loadConversation(userId);
      }

      if (conversation.messages.length <= MAX_MESSAGES) {
        return conversation;
      }

      // Keep most recent messages
      const keepCount = Math.floor(MAX_MESSAGES * 0.8); // Keep 80% of limit
      conversation.messages = conversation.messages.slice(-keepCount);
      conversation.messageCount = conversation.messages.length;

      // Save cleaned conversation
      const storageKey = `${STORAGE_PREFIX}${userId}`;
      await AsyncStorage.setItem(storageKey, JSON.stringify(conversation));

      return conversation;
    } catch (error) {
      console.error('Failed to clear old messages:', error);
      return conversation;
    }
  }

  // Check if user is first-time
  static async isFirstTimeUser(userId = 'default') {
    try {
      const conversation = await this.loadConversation(userId);
      return conversation.userProfile.isFirstTime && conversation.messages.length === 0;
    } catch (error) {
      console.error('Failed to check first-time user status:', error);
      return true; // Default to first-time on error
    }
  }

  // Get conversation summary for display
  static async getConversationSummary(userId = 'default') {
    try {
      const conversation = await this.loadConversation(userId);
      
      return {
        totalMessages: conversation.messageCount,
        lastInteraction: conversation.userProfile.lastInteraction,
        hasVideoUploads: conversation.messages.some(msg => 
          msg.messageType === 'video_upload' || msg.videoReference
        ),
        analysisCount: conversation.messages.filter(msg => 
          msg.messageType === 'analysis_result'
        ).length,
        isFirstTime: conversation.userProfile.isFirstTime,
      };
    } catch (error) {
      console.error('Failed to get conversation summary:', error);
      return {
        totalMessages: 0,
        lastInteraction: new Date().toISOString(),
        hasVideoUploads: false,
        analysisCount: 0,
        isFirstTime: true,
      };
    }
  }

  // Add video reference to conversation
  static async addVideoReference(userId = 'default', videoId, analysisData = null) {
    try {
      // Add video upload message
      await this.saveMessage(userId, {
        text: 'Video uploaded successfully! Analyzing your swing...',
        sender: 'coach',
        messageType: 'progress',
        videoReference: videoId,
      });

      // If analysis data provided, add analysis result message
      if (analysisData) {
        await this.saveMessage(userId, {
          text: this.formatAnalysisMessage(analysisData),
          sender: 'coach',
          messageType: 'analysis_result',
          videoReference: videoId,
          analysisData: analysisData,
        });
      }

      return videoId;
    } catch (error) {
      console.error('Failed to add video reference:', error);
      throw error;
    }
  }

  // Format analysis data into user-friendly message
  static formatAnalysisMessage(analysisData) {
    try {
      if (!analysisData) return 'Your swing analysis is complete!';

      // Extract key insights for chat display
      const strengths = analysisData.strengths || [];
      const improvements = analysisData.improvements || [];
      
      let message = '🎯 Your swing analysis is complete!\n\n';
      
      if (strengths.length > 0) {
        message += '✅ **Strengths:**\n';
        strengths.slice(0, 2).forEach(strength => {
          message += `• ${strength}\n`;
        });
        message += '\n';
      }

      if (improvements.length > 0) {
        message += '🎯 **Focus Area:**\n';
        message += `• ${improvements[0]}\n\n`;
        message += 'Try another swing focusing on this area!';
      }

      return message;
    } catch (error) {
      console.error('Failed to format analysis message:', error);
      return 'Your swing analysis is complete! Ask me any questions about your technique.';
    }
  }

  // Reset conversation (for testing or user request)
  static async resetConversation(userId = 'default') {
    try {
      const freshConversation = {
        messages: [],
        lastUpdated: new Date().toISOString(),
        messageCount: 0,
        userProfile: {
          isFirstTime: true,
          lastInteraction: new Date().toISOString(),
        }
      };

      const storageKey = `${STORAGE_PREFIX}${userId}`;
      await AsyncStorage.setItem(storageKey, JSON.stringify(freshConversation));

      return freshConversation;
    } catch (error) {
      console.error('Failed to reset conversation:', error);
      throw error;
    }
  }

  // Get storage size for debugging
  static async getStorageSize(userId = 'default') {
    try {
      const storageKey = `${STORAGE_PREFIX}${userId}`;
      const data = await AsyncStorage.getItem(storageKey);
      return data ? data.length : 0;
    } catch (error) {
      console.error('Failed to get storage size:', error);
      return 0;
    }
  }

  // Update user profile
  static async updateUserProfile(userId = 'default', profileUpdates) {
    try {
      const conversation = await this.loadConversation(userId);
      conversation.userProfile = {
        ...conversation.userProfile,
        ...profileUpdates,
      };

      const storageKey = `${STORAGE_PREFIX}${userId}`;
      await AsyncStorage.setItem(storageKey, JSON.stringify(conversation));

      return conversation.userProfile;
    } catch (error) {
      console.error('Failed to update user profile:', error);
      throw error;
    }
  }
}

export default ChatHistoryManager;
