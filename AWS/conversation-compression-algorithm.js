/**
 * Sprint 4A: Conversation Compression & Intelligence Algorithm
 * 
 * This module implements intelligent conversation compression algorithms
 * to manage growing coaching conversation data while maintaining quality
 * and coaching continuity.
 */

// CONVERSATION COMPRESSION CONSTANTS
const COMPRESSION_THRESHOLDS = {
  MAX_CONVERSATION_LENGTH: 100,        // Messages before compression needed
  COMPRESSION_TARGET_LENGTH: 50,       // Target length after compression
  MIN_MESSAGES_TO_COMPRESS: 20,        // Minimum messages needed for compression
  COACHING_THEME_RETENTION_DAYS: 30,   // Days to retain coaching themes
  CRITICAL_MESSAGE_KEYWORDS: [
    'breakthrough', 'major improvement', 'significant progress',
    'new focus area', 'goal achieved', 'milestone reached',
    'coaching plan', 'lesson learned', 'key insight'
  ]
};

const MESSAGE_IMPORTANCE_WEIGHTS = {
  SWING_REFERENCE: 0.9,               // Messages linked to specific swing analyses
  COACHING_BREAKTHROUGH: 0.95,        // Messages about major progress
  GOAL_SETTING: 0.8,                  // Messages about setting/achieving goals
  PRACTICE_FEEDBACK: 0.7,             // Messages about practice results
  TECHNICAL_INSTRUCTION: 0.75,        // Detailed technical coaching
  GENERAL_CHAT: 0.3,                  // General golf conversation
  ENCOURAGEMENT: 0.4,                 // Motivational messages
  PROGRESS_TRACKING: 0.85             // Messages tracking improvement
};

/**
 * Main conversation compression algorithm
 * Intelligently compresses conversation history while preserving coaching value
 */
class ConversationCompressionEngine {
  
  /**
   * Analyze conversation for compression needs
   */
  static async analyzeCompressionNeeds(conversationData) {
    try {
      console.log('🔍 Analyzing conversation compression needs...');
      
      const { conversation_id, recent_messages, total_tokens_used, last_updated } = conversationData;
      const messageCount = recent_messages?.length || 0;
      
      const analysis = {
        conversationId: conversation_id,
        currentMessageCount: messageCount,
        totalTokensUsed: total_tokens_used || 0,
        lastUpdated: last_updated,
        compressionNeeded: false,
        compressionUrgency: 'low',
        estimatedSavings: 0,
        retentionStrategy: 'standard'
      };
      
      // Check if compression is needed
      if (messageCount >= COMPRESSION_THRESHOLDS.MAX_CONVERSATION_LENGTH) {
        analysis.compressionNeeded = true;
        analysis.compressionUrgency = 'high';
        analysis.estimatedSavings = Math.floor((messageCount - COMPRESSION_THRESHOLDS.COMPRESSION_TARGET_LENGTH) * 0.8);
      } else if (messageCount >= COMPRESSION_THRESHOLDS.MAX_CONVERSATION_LENGTH * 0.8) {
        analysis.compressionNeeded = true;
        analysis.compressionUrgency = 'medium';
        analysis.estimatedSavings = Math.floor((messageCount - COMPRESSION_THRESHOLDS.COMPRESSION_TARGET_LENGTH) * 0.6);
      }
      
      // Analyze message quality and coaching value
      if (recent_messages && recent_messages.length > 0) {
        const qualityAnalysis = await this.analyzeMessageQuality(recent_messages);
        analysis.qualityMetrics = qualityAnalysis;
        
        // Adjust compression strategy based on coaching value
        if (qualityAnalysis.highValueMessagePercentage > 0.7) {
          analysis.retentionStrategy = 'high_value';
          analysis.estimatedSavings *= 0.7; // Reduce savings to preserve quality
        } else if (qualityAnalysis.highValueMessagePercentage < 0.3) {
          analysis.retentionStrategy = 'aggressive';
          analysis.estimatedSavings *= 1.3; // Increase savings potential
        }
      }
      
      console.log(`Compression analysis complete: ${analysis.compressionNeeded ? 'NEEDED' : 'NOT NEEDED'} (${analysis.compressionUrgency})`);
      return analysis;
      
    } catch (error) {
      console.error('❌ Error analyzing compression needs:', error);
      return {
        conversationId: conversationData.conversation_id,
        compressionNeeded: false,
        error: error.message
      };
    }
  }
  
  /**
   * Analyze message quality and coaching value
   */
  static async analyzeMessageQuality(messages) {
    try {
      console.log(`📊 Analyzing quality of ${messages.length} messages...`);
      
      let totalImportanceScore = 0;
      let highValueMessages = 0;
      let swingReferencedMessages = 0;
      let coachingBreakthroughs = 0;
      let technicalInstructions = 0;
      
      const messageAnalysis = messages.map(message => {
        const analysis = this.calculateMessageImportance(message);
        totalImportanceScore += analysis.importanceScore;
        
        if (analysis.importanceScore >= 0.7) highValueMessages++;
        if (analysis.hasSwingReference) swingReferencedMessages++;
        if (analysis.isCoachingBreakthrough) coachingBreakthroughs++;
        if (analysis.isTechnicalInstruction) technicalInstructions++;
        
        return {
          message_id: message.message_id,
          importanceScore: analysis.importanceScore,
          categories: analysis.categories,
          retentionRecommendation: analysis.importanceScore >= 0.6 ? 'retain' : 'compress'
        };
      });
      
      const qualityMetrics = {
        averageImportanceScore: totalImportanceScore / messages.length,
        highValueMessagePercentage: highValueMessages / messages.length,
        swingReferencedPercentage: swingReferencedMessages / messages.length,
        coachingBreakthroughCount: coachingBreakthroughs,
        technicalInstructionCount: technicalInstructions,
        messageAnalysis: messageAnalysis,
        recommendedRetentionCount: messageAnalysis.filter(m => m.retentionRecommendation === 'retain').length
      };
      
      console.log(`Quality analysis: ${qualityMetrics.highValueMessagePercentage.toFixed(2)}% high-value messages`);
      return qualityMetrics;
      
    } catch (error) {
      console.error('❌ Error analyzing message quality:', error);
      return {
        averageImportanceScore: 0.5,
        highValueMessagePercentage: 0.5,
        error: error.message
      };
    }
  }
  
  /**
   * Calculate importance score for individual message
   */
  static calculateMessageImportance(message) {
    try {
      const content = message.content?.toLowerCase() || '';
      const messageType = message.message_type || 'general_chat';
      const hasSwingReference = !!message.swing_reference;
      const timestamp = new Date(message.timestamp);
      const daysSinceMessage = (Date.now() - timestamp.getTime()) / (1000 * 60 * 60 * 24);
      
      let importanceScore = MESSAGE_IMPORTANCE_WEIGHTS[messageType.toUpperCase()] || MESSAGE_IMPORTANCE_WEIGHTS.GENERAL_CHAT;
      const categories = [messageType];
      
      // Boost score for swing-referenced messages
      if (hasSwingReference) {
        importanceScore = Math.max(importanceScore, MESSAGE_IMPORTANCE_WEIGHTS.SWING_REFERENCE);
        categories.push('swing_referenced');
      }
      
      // Check for coaching breakthrough keywords
      const isCoachingBreakthrough = COMPRESSION_THRESHOLDS.CRITICAL_MESSAGE_KEYWORDS.some(keyword => 
        content.includes(keyword)
      );
      
      if (isCoachingBreakthrough) {
        importanceScore = Math.max(importanceScore, MESSAGE_IMPORTANCE_WEIGHTS.COACHING_BREAKTHROUGH);
        categories.push('coaching_breakthrough');
      }
      
      // Check for technical instruction patterns
      const isTechnicalInstruction = (
        content.includes('p1') || content.includes('p2') || content.includes('p3') ||
        content.includes('p4') || content.includes('p5') || content.includes('p6') ||
        content.includes('p7') || content.includes('p8') || content.includes('p9') ||
        content.includes('p10') || content.includes('swing plane') ||
        content.includes('impact position') || content.includes('follow through')
      );
      
      if (isTechnicalInstruction) {
        importanceScore = Math.max(importanceScore, MESSAGE_IMPORTANCE_WEIGHTS.TECHNICAL_INSTRUCTION);
        categories.push('technical_instruction');
      }
      
      // Check for practice feedback
      const isPracticeFeedback = (
        content.includes('practice') || content.includes('drill') ||
        content.includes('range') || content.includes('worked on')
      );
      
      if (isPracticeFeedback) {
        importanceScore = Math.max(importanceScore, MESSAGE_IMPORTANCE_WEIGHTS.PRACTICE_FEEDBACK);
        categories.push('practice_feedback');
      }
      
      // Time decay factor (recent messages slightly more important)
      const timeDecayFactor = Math.max(0.8, 1 - (daysSinceMessage / 30)); // 30-day decay
      importanceScore *= timeDecayFactor;
      
      // Ensure score stays within bounds
      importanceScore = Math.min(1.0, Math.max(0.1, importanceScore));
      
      return {
        importanceScore,
        categories,
        hasSwingReference,
        isCoachingBreakthrough,
        isTechnicalInstruction,
        isPracticeFeedback,
        daysSinceMessage: Math.floor(daysSinceMessage)
      };
      
    } catch (error) {
      console.error('❌ Error calculating message importance:', error);
      return {
        importanceScore: 0.5,
        categories: ['unknown'],
        hasSwingReference: false,
        isCoachingBreakthrough: false,
        isTechnicalInstruction: false,
        isPracticeFeedback: false,
        daysSinceMessage: 0
      };
    }
  }
  
  /**
   * Compress conversation using intelligent selection
   */
  static async compressConversation(conversationData, compressionAnalysis) {
    try {
      console.log('🗜️ Starting intelligent conversation compression...');
      
      const { recent_messages } = conversationData;
      const { qualityMetrics, retentionStrategy } = compressionAnalysis;
      
      if (!recent_messages || recent_messages.length < COMPRESSION_THRESHOLDS.MIN_MESSAGES_TO_COMPRESS) {
        console.log('Not enough messages to compress');
        return {
          success: false,
          reason: 'Insufficient messages for compression'
        };
      }
      
      // Sort messages by importance score
      const messagesWithScores = qualityMetrics.messageAnalysis.map(analysis => {
        const message = recent_messages.find(m => m.message_id === analysis.message_id);
        return {
          ...message,
          importanceScore: analysis.importanceScore,
          categories: analysis.categories
        };
      }).sort((a, b) => b.importanceScore - a.importanceScore);
      
      // Determine retention strategy
      let targetRetentionCount = COMPRESSION_THRESHOLDS.COMPRESSION_TARGET_LENGTH;
      
      if (retentionStrategy === 'high_value') {
        targetRetentionCount = Math.floor(COMPRESSION_THRESHOLDS.COMPRESSION_TARGET_LENGTH * 1.2);
      } else if (retentionStrategy === 'aggressive') {
        targetRetentionCount = Math.floor(COMPRESSION_THRESHOLDS.COMPRESSION_TARGET_LENGTH * 0.8);
      }
      
      // Select messages to retain
      const retainedMessages = [];
      const compressedMessages = [];
      
      // Always retain the most recent 10 messages
      const recentCount = Math.min(10, recent_messages.length);
      const mostRecentMessages = recent_messages.slice(-recentCount);
      retainedMessages.push(...mostRecentMessages);
      
      // Add high-importance messages that aren't already included
      const remainingSlots = targetRetentionCount - retainedMessages.length;
      const olderHighValueMessages = messagesWithScores
        .filter(msg => !mostRecentMessages.some(recent => recent.message_id === msg.message_id))
        .filter(msg => msg.importanceScore >= 0.7)
        .slice(0, remainingSlots);
      
      retainedMessages.push(...olderHighValueMessages);
      
      // Messages to compress are those not retained
      const retainedIds = new Set(retainedMessages.map(m => m.message_id));
      compressedMessages.push(...recent_messages.filter(m => !retainedIds.has(m.message_id)));
      
      // Generate conversation summary from compressed messages
      const conversationSummary = await this.generateConversationSummary(compressedMessages, conversationData);
      
      const compressionResult = {
        success: true,
        originalMessageCount: recent_messages.length,
        retainedMessageCount: retainedMessages.length,
        compressedMessageCount: compressedMessages.length,
        retainedMessages: retainedMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
        conversationSummary: conversationSummary,
        compressionRatio: (compressedMessages.length / recent_messages.length).toFixed(2),
        retentionStrategy: retentionStrategy,
        compressionTimestamp: new Date().toISOString()
      };
      
      console.log(`✅ Compression complete: ${compressionResult.originalMessageCount} → ${compressionResult.retainedMessageCount} messages (${(compressionResult.compressionRatio * 100).toFixed(1)}% compressed)`);
      
      return compressionResult;
      
    } catch (error) {
      console.error('❌ Error compressing conversation:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Generate intelligent conversation summary
   */
  static async generateConversationSummary(compressedMessages, conversationData) {
    try {
      console.log(`📝 Generating summary for ${compressedMessages.length} compressed messages...`);
      
      if (compressedMessages.length === 0) {
        return {
          summary: 'No messages compressed in this session.',
          keyThemes: [],
          progressNotes: [],
          technicalPoints: []
        };
      }
      
      // Extract key themes and technical points
      const keyThemes = this.extractCoachingThemes(compressedMessages);
      const technicalPoints = this.extractTechnicalPoints(compressedMessages);
      const progressNotes = this.extractProgressNotes(compressedMessages);
      
      // Generate text summary
      const timeSpan = this.calculateTimeSpan(compressedMessages);
      const messageTypes = this.categorizeMessages(compressedMessages);
      
      let summary = `Coaching session summary (${timeSpan}): `;
      
      if (keyThemes.length > 0) {
        summary += `Focused on ${keyThemes.slice(0, 3).join(', ')}. `;
      }
      
      if (technicalPoints.length > 0) {
        summary += `Technical work included ${technicalPoints.slice(0, 2).join(' and ')}. `;
      }
      
      if (progressNotes.length > 0) {
        summary += `Progress noted: ${progressNotes.slice(0, 2).join(', ')}. `;
      }
      
      summary += `Session included ${compressedMessages.length} exchanges covering ${messageTypes.join(', ')}.`;
      
      const conversationSummary = {
        summary: summary,
        keyThemes: keyThemes,
        progressNotes: progressNotes,
        technicalPoints: technicalPoints,
        messageCount: compressedMessages.length,
        timeSpan: timeSpan,
        messageTypes: messageTypes,
        generatedAt: new Date().toISOString()
      };
      
      console.log('✅ Conversation summary generated successfully');
      return conversationSummary;
      
    } catch (error) {
      console.error('❌ Error generating conversation summary:', error);
      return {
        summary: 'Summary generation failed.',
        keyThemes: [],
        progressNotes: [],
        technicalPoints: [],
        error: error.message
      };
    }
  }
  
  /**
   * Extract coaching themes from messages
   */
  static extractCoachingThemes(messages) {
    const themeKeywords = {
      'swing plane': ['swing plane', 'club path', 'inside out', 'outside in'],
      'impact position': ['impact', 'ball striking', 'contact', 'compression'],
      'setup fundamentals': ['setup', 'address', 'posture', 'alignment', 'ball position'],
      'tempo and rhythm': ['tempo', 'rhythm', 'timing', 'pace', 'smooth'],
      'short game': ['chipping', 'pitching', 'wedge', 'short game', 'around green'],
      'putting': ['putting', 'putt', 'green reading', 'stroke'],
      'mental game': ['confidence', 'mental', 'focus', 'pressure', 'course management']
    };
    
    const themes = [];
    const themeCount = {};
    
    messages.forEach(message => {
      const content = message.content?.toLowerCase() || '';
      
      Object.entries(themeKeywords).forEach(([theme, keywords]) => {
        if (keywords.some(keyword => content.includes(keyword))) {
          themeCount[theme] = (themeCount[theme] || 0) + 1;
        }
      });
    });
    
    // Sort themes by frequency and return top ones
    return Object.entries(themeCount)
      .sort(([,a], [,b]) => b - a)
      .map(([theme]) => theme)
      .slice(0, 5);
  }
  
  /**
   * Extract technical points from messages
   */
  static extractTechnicalPoints(messages) {
    const technicalPatterns = [
      /p[1-9]|p10/gi,
      /swing plane/gi,
      /impact position/gi,
      /club face/gi,
      /ball position/gi,
      /weight shift/gi,
      /hip rotation/gi,
      /shoulder turn/gi,
      /wrist hinge/gi,
      /follow through/gi
    ];
    
    const technicalPoints = new Set();
    
    messages.forEach(message => {
      const content = message.content || '';
      
      technicalPatterns.forEach(pattern => {
        const matches = content.match(pattern);
        if (matches) {
          matches.forEach(match => technicalPoints.add(match.toLowerCase()));
        }
      });
    });
    
    return Array.from(technicalPoints).slice(0, 5);
  }
  
  /**
   * Extract progress notes from messages
   */
  static extractProgressNotes(messages) {
    const progressKeywords = [
      'improvement', 'better', 'progress', 'breakthrough', 'success',
      'achieved', 'mastered', 'consistent', 'solid contact', 'straight shots'
    ];
    
    const progressNotes = [];
    
    messages.forEach(message => {
      const content = message.content?.toLowerCase() || '';
      
      progressKeywords.forEach(keyword => {
        if (content.includes(keyword)) {
          // Extract sentence containing the progress keyword
          const sentences = content.split(/[.!?]+/);
          const progressSentence = sentences.find(sentence => sentence.includes(keyword));
          
          if (progressSentence && progressSentence.length > 10 && progressSentence.length < 100) {
            progressNotes.push(progressSentence.trim());
          }
        }
      });
    });
    
    // Remove duplicates and return top progress notes
    return [...new Set(progressNotes)].slice(0, 3);
  }
  
  /**
   * Calculate time span of messages
   */
  static calculateTimeSpan(messages) {
    if (messages.length === 0) return 'no timespan';
    
    const timestamps = messages.map(m => new Date(m.timestamp)).sort((a, b) => a - b);
    const firstMessage = timestamps[0];
    const lastMessage = timestamps[timestamps.length - 1];
    
    const daysDiff = Math.ceil((lastMessage - firstMessage) / (1000 * 60 * 60 * 24));
    
    if (daysDiff === 0) return 'same day';
    if (daysDiff === 1) return '1 day';
    if (daysDiff <= 7) return `${daysDiff} days`;
    if (daysDiff <= 30) return `${Math.ceil(daysDiff / 7)} weeks`;
    
    return `${Math.ceil(daysDiff / 30)} months`;
  }
  
  /**
   * Categorize messages by type
   */
  static categorizeMessages(messages) {
    const categories = new Set();
    
    messages.forEach(message => {
      const messageType = message.message_type || 'general_chat';
      categories.add(messageType.replace('_', ' '));
    });
    
    return Array.from(categories);
  }
}

// EXPORT COMPRESSION ENGINE
module.exports = {
  ConversationCompressionEngine,
  COMPRESSION_THRESHOLDS,
  MESSAGE_IMPORTANCE_WEIGHTS
};