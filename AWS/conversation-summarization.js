/**
 * Sprint 4A: Intelligent Conversation Summarization
 * 
 * This module implements AI-powered conversation summarization using GPT-4o
 * to create high-quality, coaching-focused summaries of compressed conversations.
 */

const https = require('https');

// SUMMARIZATION CONSTANTS
const SUMMARIZATION_CONFIG = {
  MAX_MESSAGES_PER_SUMMARY: 50,        // Maximum messages to summarize at once
  MIN_MESSAGES_FOR_AI_SUMMARY: 5,     // Minimum messages needed for AI summarization
  SUMMARY_MAX_TOKENS: 300,             // Maximum tokens for generated summary
  CONTEXT_TOKEN_LIMIT: 3000,           // Maximum tokens to send to GPT
  SUMMARY_TEMPERATURE: 0.3,            // Low temperature for consistent summaries
  COACHING_FOCUS_WEIGHT: 0.8           // Weight for coaching-related content
};

const SUMMARY_TYPES = {
  DAILY: 'daily_summary',
  WEEKLY: 'weekly_summary', 
  COACHING_SESSION: 'coaching_session',
  PROGRESS_MILESTONE: 'progress_milestone',
  TECHNICAL_FOCUS: 'technical_focus'
};

/**
 * Intelligent Conversation Summarization Engine
 */
class ConversationSummarizationEngine {
  
  /**
   * Generate intelligent summary using GPT-4o
   */
  static async generateIntelligentSummary(messages, summaryContext = {}) {
    try {
      console.log(`🧠 Generating intelligent summary for ${messages.length} messages...`);
      
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY not configured');
      }
      
      if (messages.length < SUMMARIZATION_CONFIG.MIN_MESSAGES_FOR_AI_SUMMARY) {
        return this.generateBasicSummary(messages, summaryContext);
      }
      
      // Prepare conversation content for GPT-4o
      const conversationContent = this.prepareConversationForSummary(messages, summaryContext);
      
      // Build coaching-focused summary prompt
      const summaryPrompt = this.buildSummaryPrompt(conversationContent, summaryContext);
      
      // Call GPT-4o for intelligent summarization
      const summaryResponse = await this.callGPTForSummarization(summaryPrompt);
      
      // Parse and enhance the summary
      const enhancedSummary = this.enhanceSummaryWithMetrics(summaryResponse, messages, summaryContext);
      
      console.log('✅ Intelligent summary generated successfully');
      return enhancedSummary;
      
    } catch (error) {
      console.error('❌ Error generating intelligent summary:', error);
      
      // Fallback to basic summary
      return this.generateBasicSummary(messages, summaryContext);
    }
  }
  
  /**
   * Prepare conversation content for GPT summarization
   */
  static prepareConversationForSummary(messages, summaryContext) {
    try {
      // Sort messages chronologically
      const sortedMessages = messages.sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
      );
      
      // Estimate token usage and trim if necessary
      let conversationText = '';
      let tokenEstimate = 0;
      const maxTokens = SUMMARIZATION_CONFIG.CONTEXT_TOKEN_LIMIT;
      
      // Add summary context first
      if (summaryContext.userId) {
        conversationText += `User: ${summaryContext.userId}\n`;
        tokenEstimate += 20;
      }
      
      if (summaryContext.timeRange) {
        conversationText += `Time Range: ${summaryContext.timeRange}\n`;
        tokenEstimate += 30;
      }
      
      conversationText += '\nConversation:\n';
      tokenEstimate += 20;
      
      // Add messages with token management
      for (const message of sortedMessages) {
        const messageRole = message.role === 'assistant' ? 'Coach' : 'Golfer';
        const messageContent = message.content || '';
        const messageText = `${messageRole}: ${messageContent}\n`;
        const messageTokens = Math.ceil(messageText.length / 4); // Rough token estimate
        
        if (tokenEstimate + messageTokens > maxTokens) {
          console.log(`Token limit reached, including ${conversationText.split('\n').length - 3} messages`);
          break;
        }
        
        conversationText += messageText;
        tokenEstimate += messageTokens;
      }
      
      return {
        conversationText,
        tokenEstimate,
        messageCount: sortedMessages.length,
        timeSpan: this.calculateTimeSpan(sortedMessages)
      };
      
    } catch (error) {
      console.error('❌ Error preparing conversation for summary:', error);
      return {
        conversationText: 'Error preparing conversation content',
        tokenEstimate: 100,
        messageCount: messages.length,
        timeSpan: 'unknown'
      };
    }
  }
  
  /**
   * Build coaching-focused summary prompt for GPT-4o
   */
  static buildSummaryPrompt(conversationContent, summaryContext) {
    const summaryType = summaryContext.summaryType || SUMMARY_TYPES.COACHING_SESSION;
    const focusAreas = summaryContext.focusAreas || [];
    
    let systemPrompt = `You are a professional golf coach creating an intelligent summary of coaching conversations. Your goal is to capture the essential coaching value, progress, and key insights from the conversation.

SUMMARY GUIDELINES:
- Focus on coaching progress, technical improvements, and breakthrough moments
- Identify specific swing mechanics discussed (P1-P10 positions, swing plane, impact, etc.)
- Note practice recommendations and their outcomes
- Highlight golfer's questions, challenges, and how they were addressed
- Track progress indicators and improvement patterns
- Extract actionable coaching insights for future sessions

SUMMARY TYPE: ${summaryType.replace('_', ' ').toUpperCase()}

STRUCTURE YOUR SUMMARY WITH:
1. Session Overview (2-3 sentences)
2. Key Technical Points Discussed
3. Progress Indicators & Breakthroughs
4. Practice Recommendations Given
5. Golfer's Main Questions/Concerns
6. Coaching Insights for Future Sessions

Keep the summary concise but comprehensive, focusing on coaching value over conversational details.`;

    if (focusAreas.length > 0) {
      systemPrompt += `\n\nFOCUS AREAS TO EMPHASIZE: ${focusAreas.join(', ')}`;
    }
    
    const userPrompt = `Please create an intelligent coaching summary of this conversation:

${conversationContent.conversationText}

CONVERSATION METADATA:
- Message Count: ${conversationContent.messageCount}
- Time Span: ${conversationContent.timeSpan}
- Token Estimate: ${conversationContent.tokenEstimate}

Create a comprehensive coaching summary that captures the essential value and progress from this conversation.`;

    return {
      systemPrompt,
      userPrompt,
      tokenEstimate: conversationContent.tokenEstimate + 500 // Add prompt tokens
    };
  }
  
  /**
   * Call GPT-4o for conversation summarization
   */
  static async callGPTForSummarization(summaryPrompt) {
    try {
      console.log('🤖 Calling GPT-4o for conversation summarization...');
      
      const messages = [
        {
          role: 'system',
          content: summaryPrompt.systemPrompt
        },
        {
          role: 'user',
          content: summaryPrompt.userPrompt
        }
      ];
      
      const requestBody = {
        model: 'gpt-4o',
        messages: messages,
        max_tokens: SUMMARIZATION_CONFIG.SUMMARY_MAX_TOKENS,
        temperature: SUMMARIZATION_CONFIG.SUMMARY_TEMPERATURE,
        top_p: 0.9
      };
      
      const response = await this.makeOpenAIRequest(requestBody);
      
      if (response.error) {
        throw new Error(`GPT-4o API error: ${response.error.message}`);
      }
      
      const summaryText = response.choices[0].message.content;
      const tokensUsed = response.usage?.total_tokens || 0;
      
      console.log(`✅ GPT-4o summarization complete (${tokensUsed} tokens used)`);
      
      return {
        summaryText,
        tokensUsed,
        model: response.model,
        generatedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Error calling GPT-4o for summarization:', error);
      throw error;
    }
  }
  
  /**
   * Make HTTPS request to OpenAI API
   */
  static async makeOpenAIRequest(requestBody) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(requestBody);
      
      const options = {
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };
      
      const req = https.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          try {
            const parsedResponse = JSON.parse(responseData);
            
            if (res.statusCode === 200) {
              resolve(parsedResponse);
            } else {
              reject(new Error(`OpenAI API error: ${res.statusCode} - ${parsedResponse.error?.message || responseData}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse OpenAI response: ${error.message}`));
          }
        });
      });
      
      req.on('error', (error) => {
        reject(new Error(`OpenAI API request error: ${error.message}`));
      });
      
      req.write(data);
      req.end();
    });
  }
  
  /**
   * Enhance summary with metrics and structured data
   */
  static enhanceSummaryWithMetrics(summaryResponse, originalMessages, summaryContext) {
    try {
      const summary = summaryResponse.summaryText;
      
      // Extract structured data from the conversation
      const metrics = this.extractConversationMetrics(originalMessages);
      const coachingThemes = this.extractCoachingThemes(originalMessages);
      const progressIndicators = this.extractProgressIndicators(originalMessages);
      const technicalFocus = this.extractTechnicalFocus(originalMessages);
      
      // Parse the summary for structured sections
      const structuredSummary = this.parseStructuredSummary(summary);
      
      const enhancedSummary = {
        // Core summary
        summary: summary,
        summaryType: summaryContext.summaryType || SUMMARY_TYPES.COACHING_SESSION,
        
        // Structured sections
        sessionOverview: structuredSummary.sessionOverview,
        keyTechnicalPoints: structuredSummary.keyTechnicalPoints || technicalFocus,
        progressIndicators: structuredSummary.progressIndicators || progressIndicators,
        practiceRecommendations: structuredSummary.practiceRecommendations,
        golferConcerns: structuredSummary.golferConcerns,
        coachingInsights: structuredSummary.coachingInsights,
        
        // Metrics and data
        conversationMetrics: metrics,
        coachingThemes: coachingThemes,
        
        // Generation metadata
        generationMetadata: {
          tokensUsed: summaryResponse.tokensUsed,
          model: summaryResponse.model,
          generatedAt: summaryResponse.generatedAt,
          originalMessageCount: originalMessages.length,
          compressionRatio: originalMessages.length > 0 ? (summary.length / this.calculateTotalMessageLength(originalMessages)).toFixed(3) : 0,
          summaryQuality: this.assessSummaryQuality(summary, originalMessages)
        }
      };
      
      console.log('✅ Summary enhanced with metrics and structure');
      return enhancedSummary;
      
    } catch (error) {
      console.error('❌ Error enhancing summary with metrics:', error);
      
      // Return basic enhanced summary
      return {
        summary: summaryResponse.summaryText,
        summaryType: summaryContext.summaryType || SUMMARY_TYPES.COACHING_SESSION,
        generationMetadata: {
          tokensUsed: summaryResponse.tokensUsed,
          model: summaryResponse.model,
          generatedAt: summaryResponse.generatedAt,
          originalMessageCount: originalMessages.length,
          error: error.message
        }
      };
    }
  }
  
  /**
   * Parse structured sections from GPT-generated summary
   */
  static parseStructuredSummary(summaryText) {
    try {
      const sections = {
        sessionOverview: '',
        keyTechnicalPoints: [],
        progressIndicators: [],
        practiceRecommendations: [],
        golferConcerns: [],
        coachingInsights: []
      };
      
      // Split summary into sections based on numbered structure
      const lines = summaryText.split('\n').filter(line => line.trim());
      let currentSection = 'sessionOverview';
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Detect section headers
        if (trimmedLine.match(/^1\.|session overview|overview/i)) {
          currentSection = 'sessionOverview';
          continue;
        } else if (trimmedLine.match(/^2\.|technical points|key technical/i)) {
          currentSection = 'keyTechnicalPoints';
          continue;
        } else if (trimmedLine.match(/^3\.|progress|breakthrough|indicator/i)) {
          currentSection = 'progressIndicators';
          continue;
        } else if (trimmedLine.match(/^4\.|practice|recommendation/i)) {
          currentSection = 'practiceRecommendations';
          continue;
        } else if (trimmedLine.match(/^5\.|question|concern|challenge/i)) {
          currentSection = 'golferConcerns';
          continue;
        } else if (trimmedLine.match(/^6\.|coaching insight|future/i)) {
          currentSection = 'coachingInsights';
          continue;
        }
        
        // Add content to current section
        if (trimmedLine && !trimmedLine.match(/^\d+\./)) {
          if (currentSection === 'sessionOverview') {
            sections[currentSection] += trimmedLine + ' ';
          } else {
            // For list sections, split by bullet points or commas
            if (trimmedLine.includes('•') || trimmedLine.includes('-')) {
              const items = trimmedLine.split(/[•-]/).filter(item => item.trim());
              sections[currentSection].push(...items.map(item => item.trim()));
            } else if (trimmedLine.includes(',')) {
              const items = trimmedLine.split(',').filter(item => item.trim());
              sections[currentSection].push(...items.map(item => item.trim()));
            } else {
              sections[currentSection].push(trimmedLine);
            }
          }
        }
      }
      
      // Clean up session overview
      sections.sessionOverview = sections.sessionOverview.trim();
      
      return sections;
      
    } catch (error) {
      console.error('❌ Error parsing structured summary:', error);
      return {};
    }
  }
  
  /**
   * Extract conversation metrics
   */
  static extractConversationMetrics(messages) {
    try {
      const metrics = {
        totalMessages: messages.length,
        userMessages: messages.filter(m => m.role === 'user').length,
        assistantMessages: messages.filter(m => m.role === 'assistant').length,
        averageMessageLength: 0,
        conversationDuration: 0,
        messageFrequency: 0
      };
      
      if (messages.length > 0) {
        // Calculate average message length
        const totalLength = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
        metrics.averageMessageLength = Math.round(totalLength / messages.length);
        
        // Calculate conversation duration
        const timestamps = messages.map(m => new Date(m.timestamp)).sort((a, b) => a - b);
        if (timestamps.length > 1) {
          const duration = timestamps[timestamps.length - 1] - timestamps[0];
          metrics.conversationDuration = Math.round(duration / (1000 * 60)); // minutes
        }
        
        // Calculate message frequency (messages per hour)
        if (metrics.conversationDuration > 0) {
          metrics.messageFrequency = Math.round((messages.length / metrics.conversationDuration) * 60);
        }
      }
      
      return metrics;
      
    } catch (error) {
      console.error('❌ Error extracting conversation metrics:', error);
      return {
        totalMessages: messages.length,
        error: error.message
      };
    }
  }
  
  /**
   * Extract coaching themes from messages
   */
  static extractCoachingThemes(messages) {
    const themePatterns = {
      'Swing Fundamentals': ['setup', 'address', 'posture', 'alignment', 'grip', 'stance'],
      'Swing Plane': ['swing plane', 'club path', 'inside out', 'outside in', 'on plane'],
      'Impact Zone': ['impact', 'ball striking', 'contact', 'compression', 'solid contact'],
      'Tempo & Timing': ['tempo', 'rhythm', 'timing', 'pace', 'smooth', 'accelerate'],
      'Short Game': ['chipping', 'pitching', 'wedge', 'short game', 'around green'],
      'Putting': ['putting', 'putt', 'green reading', 'stroke', 'distance control'],
      'Mental Game': ['confidence', 'mental', 'focus', 'pressure', 'course management'],
      'Ball Flight': ['slice', 'hook', 'draw', 'fade', 'straight', 'ball flight'],
      'Distance & Power': ['distance', 'power', 'speed', 'clubhead speed', 'carry']
    };
    
    const themeScores = {};
    
    messages.forEach(message => {
      const content = (message.content || '').toLowerCase();
      
      Object.entries(themePatterns).forEach(([theme, keywords]) => {
        const matchCount = keywords.filter(keyword => content.includes(keyword)).length;
        themeScores[theme] = (themeScores[theme] || 0) + matchCount;
      });
    });
    
    // Return themes sorted by relevance
    return Object.entries(themeScores)
      .filter(([theme, score]) => score > 0)
      .sort(([,a], [,b]) => b - a)
      .map(([theme, score]) => ({ theme, relevanceScore: score }))
      .slice(0, 5);
  }
  
  /**
   * Extract progress indicators from messages
   */
  static extractProgressIndicators(messages) {
    const progressPatterns = [
      'improvement', 'better', 'progress', 'breakthrough', 'success',
      'achieved', 'mastered', 'consistent', 'solid contact', 'straighter',
      'more distance', 'good feeling', 'clicked', 'finally got it'
    ];
    
    const progressIndicators = [];
    
    messages.forEach(message => {
      const content = message.content || '';
      const lowerContent = content.toLowerCase();
      
      progressPatterns.forEach(pattern => {
        if (lowerContent.includes(pattern)) {
          // Find the sentence containing the progress indicator
          const sentences = content.split(/[.!?]+/);
          const progressSentence = sentences.find(sentence => 
            sentence.toLowerCase().includes(pattern) && sentence.length > 10
          );
          
          if (progressSentence) {
            progressIndicators.push({
              indicator: progressSentence.trim(),
              timestamp: message.timestamp,
              pattern: pattern
            });
          }
        }
      });
    });
    
    return progressIndicators.slice(0, 5); // Return top 5 progress indicators
  }
  
  /**
   * Extract technical focus areas from messages
   */
  static extractTechnicalFocus(messages) {
    const technicalPatterns = {
      'P1-P4 (Setup to Top)': /p[1-4]|setup|address|backswing|top/gi,
      'P5-P7 (Transition to Impact)': /p[5-7]|transition|downswing|impact/gi,
      'P8-P10 (Follow Through)': /p[8-9]|p10|follow.*through|finish|extension/gi,
      'Club Face Control': /club.*face|face.*angle|open|closed|square/gi,
      'Weight Transfer': /weight.*shift|weight.*transfer|pressure/gi,
      'Hip & Shoulder Turn': /hip.*turn|shoulder.*turn|rotation/gi
    };
    
    const technicalFocus = [];
    
    Object.entries(technicalPatterns).forEach(([focus, pattern]) => {
      let matchCount = 0;
      messages.forEach(message => {
        const matches = (message.content || '').match(pattern);
        if (matches) matchCount += matches.length;
      });
      
      if (matchCount > 0) {
        technicalFocus.push({
          focusArea: focus,
          mentionCount: matchCount
        });
      }
    });
    
    return technicalFocus.sort((a, b) => b.mentionCount - a.mentionCount);
  }
  
  /**
   * Calculate time span of messages
   */
  static calculateTimeSpan(messages) {
    if (messages.length === 0) return 'no timespan';
    
    const timestamps = messages.map(m => new Date(m.timestamp)).sort((a, b) => a - b);
    const firstMessage = timestamps[0];
    const lastMessage = timestamps[timestamps.length - 1];
    
    const diffMs = lastMessage - firstMessage;
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    
    if (diffHours < 1) return 'within an hour';
    if (diffHours < 24) return `${Math.round(diffHours)} hours`;
    if (diffDays < 7) return `${Math.round(diffDays)} days`;
    if (diffDays < 30) return `${Math.round(diffDays / 7)} weeks`;
    
    return `${Math.round(diffDays / 30)} months`;
  }
  
  /**
   * Calculate total message length
   */
  static calculateTotalMessageLength(messages) {
    return messages.reduce((total, message) => total + (message.content?.length || 0), 0);
  }
  
  /**
   * Assess summary quality
   */
  static assessSummaryQuality(summary, originalMessages) {
    try {
      const summaryLength = summary.length;
      const totalOriginalLength = this.calculateTotalMessageLength(originalMessages);
      
      let quality = 'good';
      
      // Quality assessment based on compression ratio and content
      const compressionRatio = summaryLength / totalOriginalLength;
      
      if (compressionRatio > 0.8) {
        quality = 'poor'; // Too verbose
      } else if (compressionRatio < 0.1) {
        quality = 'poor'; // Too brief
      } else if (compressionRatio >= 0.2 && compressionRatio <= 0.4) {
        quality = 'excellent'; // Good compression ratio
      } else if (compressionRatio >= 0.15 && compressionRatio <= 0.6) {
        quality = 'good';
      } else {
        quality = 'fair';
      }
      
      // Enhance quality assessment based on content
      const hasStructure = summary.includes('1.') || summary.includes('2.');
      const hasCoachingTerms = /swing|golf|coach|practice|improve/gi.test(summary);
      const hasSpecifics = /p[1-9]|p10|impact|setup|follow/gi.test(summary);
      
      if (hasStructure && hasCoachingTerms && hasSpecifics) {
        if (quality === 'good') quality = 'excellent';
        if (quality === 'fair') quality = 'good';
      }
      
      return quality;
      
    } catch (error) {
      console.error('❌ Error assessing summary quality:', error);
      return 'unknown';
    }
  }
  
  /**
   * Generate basic summary (fallback when AI summarization fails)
   */
  static generateBasicSummary(messages, summaryContext) {
    try {
      console.log('📝 Generating basic fallback summary...');
      
      const messageCount = messages.length;
      const timeSpan = this.calculateTimeSpan(messages);
      const themes = this.extractCoachingThemes(messages);
      const progressIndicators = this.extractProgressIndicators(messages);
      
      let summary = `Coaching conversation summary (${timeSpan}): ${messageCount} messages exchanged. `;
      
      if (themes.length > 0) {
        summary += `Primary focus areas: ${themes.slice(0, 3).map(t => t.theme).join(', ')}. `;
      }
      
      if (progressIndicators.length > 0) {
        summary += `Progress noted: ${progressIndicators.length} improvement indicators identified. `;
      }
      
      summary += `Conversation covered technical instruction, practice guidance, and coaching feedback.`;
      
      return {
        summary: summary,
        summaryType: summaryContext.summaryType || SUMMARY_TYPES.COACHING_SESSION,
        coachingThemes: themes,
        progressIndicators: progressIndicators,
        generationMetadata: {
          method: 'basic_fallback',
          generatedAt: new Date().toISOString(),
          originalMessageCount: messageCount
        }
      };
      
    } catch (error) {
      console.error('❌ Error generating basic summary:', error);
      return {
        summary: 'Summary generation failed.',
        summaryType: SUMMARY_TYPES.COACHING_SESSION,
        generationMetadata: {
          method: 'error_fallback',
          error: error.message,
          generatedAt: new Date().toISOString()
        }
      };
    }
  }
}

// EXPORT SUMMARIZATION ENGINE
module.exports = {
  ConversationSummarizationEngine,
  SUMMARIZATION_CONFIG,
  SUMMARY_TYPES
};