/**
 * Sprint 4A: Coaching Theme Extraction System
 * 
 * This module implements intelligent coaching theme extraction and tracking
 * to identify persistent coaching focus areas, progress patterns, and
 * relationship dynamics across conversations.
 */

// COACHING THEME CONSTANTS
const THEME_EXTRACTION_CONFIG = {
  MIN_THEME_MENTIONS: 3,              // Minimum mentions to consider a theme
  THEME_DECAY_DAYS: 14,               // Days before theme relevance decays
  MAX_ACTIVE_THEMES: 8,               // Maximum active themes to track
  CONFIDENCE_THRESHOLD: 0.6,          // Minimum confidence for theme extraction
  PROGRESS_PATTERN_WINDOW: 30         // Days to analyze for progress patterns
};

const GOLF_COACHING_THEMES = {
  // Technical Fundamentals
  'Setup & Address Position': {
    keywords: ['setup', 'address', 'posture', 'stance', 'alignment', 'ball position', 'grip', 'p1'],
    category: 'fundamentals',
    priority: 'high',
    typical_duration: 'weeks'
  },
  
  'Swing Plane & Path': {
    keywords: ['swing plane', 'club path', 'inside out', 'outside in', 'on plane', 'steep', 'shallow'],
    category: 'mechanics',
    priority: 'high',
    typical_duration: 'months'
  },
  
  'Impact Position': {
    keywords: ['impact', 'ball striking', 'contact', 'compression', 'hands ahead', 'p7'],
    category: 'mechanics',
    priority: 'critical',
    typical_duration: 'months'
  },
  
  'Tempo & Timing': {
    keywords: ['tempo', 'rhythm', 'timing', 'pace', 'smooth', 'accelerate', 'transition', 'p5'],
    category: 'feel',
    priority: 'medium',
    typical_duration: 'weeks'
  },
  
  'Weight Transfer': {
    keywords: ['weight shift', 'weight transfer', 'pressure', 'ground force', 'pivot'],
    category: 'mechanics',
    priority: 'high',
    typical_duration: 'months'
  },
  
  // Short Game
  'Chipping & Pitching': {
    keywords: ['chipping', 'pitching', 'wedge', 'short game', 'around green', 'flop shot'],
    category: 'short_game',
    priority: 'medium',
    typical_duration: 'weeks'
  },
  
  'Putting': {
    keywords: ['putting', 'putt', 'green reading', 'stroke', 'distance control', 'speed'],
    category: 'putting',
    priority: 'medium',
    typical_duration: 'weeks'
  },
  
  // Ball Flight & Scoring
  'Ball Flight Control': {
    keywords: ['slice', 'hook', 'draw', 'fade', 'straight', 'ball flight', 'curve'],
    category: 'ball_flight',
    priority: 'high',
    typical_duration: 'months'
  },
  
  'Distance & Power': {
    keywords: ['distance', 'power', 'speed', 'clubhead speed', 'carry', 'longer drives'],
    category: 'power',
    priority: 'medium',
    typical_duration: 'months'
  },
  
  // Mental & Course Management
  'Mental Game': {
    keywords: ['confidence', 'mental', 'focus', 'pressure', 'nerves', 'visualization'],
    category: 'mental',
    priority: 'medium',
    typical_duration: 'ongoing'
  },
  
  'Course Management': {
    keywords: ['course management', 'strategy', 'club selection', 'smart play', 'risk reward'],
    category: 'strategy',
    priority: 'medium',
    typical_duration: 'ongoing'
  },
  
  // Practice & Development
  'Practice Routine': {
    keywords: ['practice', 'drill', 'range', 'training', 'repetition', 'muscle memory'],
    category: 'practice',
    priority: 'medium',
    typical_duration: 'ongoing'
  }
};

const PROGRESS_INDICATORS = {
  BREAKTHROUGH: ['breakthrough', 'clicked', 'finally got it', 'major improvement', 'game changer'],
  CONSISTENCY: ['consistent', 'repeatable', 'reliable', 'every time', 'solid contact'],
  CONFIDENCE: ['confident', 'comfortable', 'natural', 'feels good', 'automatic'],
  UNDERSTANDING: ['understand', 'makes sense', 'clear', 'get it', 'comprehend'],
  STRUGGLE: ['struggling', 'difficult', 'challenging', 'frustrated', 'not working'],
  PLATEAU: ['plateau', 'stuck', 'not improving', 'same issues', 'no progress']
};

/**
 * Coaching Theme Extraction Engine
 */
class CoachingThemeExtractionEngine {
  
  /**
   * Extract coaching themes from conversation messages
   */
  static async extractCoachingThemes(messages, existingThemes = [], userId = null) {
    try {
      console.log(`🎯 Extracting coaching themes from ${messages.length} messages...`);
      
      // Analyze messages for theme mentions
      const themeAnalysis = this.analyzeThemeMentions(messages);
      
      // Extract progress patterns for each theme
      const progressPatterns = this.extractProgressPatterns(messages, themeAnalysis);
      
      // Calculate theme confidence and relevance
      const themeConfidence = this.calculateThemeConfidence(themeAnalysis, messages);
      
      // Merge with existing themes
      const updatedThemes = this.mergeWithExistingThemes(themeAnalysis, existingThemes, progressPatterns);
      
      // Prioritize and filter themes
      const prioritizedThemes = this.prioritizeThemes(updatedThemes, themeConfidence);
      
      // Extract coaching relationship dynamics
      const relationshipDynamics = this.extractRelationshipDynamics(messages);
      
      const extractionResult = {
        extractedThemes: prioritizedThemes,
        progressPatterns: progressPatterns,
        relationshipDynamics: relationshipDynamics,
        extractionMetadata: {
          messageCount: messages.length,
          themesIdentified: prioritizedThemes.length,
          averageConfidence: this.calculateAverageConfidence(prioritizedThemes),
          extractionDate: new Date().toISOString(),
          userId: userId
        }
      };
      
      console.log(`✅ Theme extraction complete: ${prioritizedThemes.length} themes identified`);
      return extractionResult;
      
    } catch (error) {
      console.error('❌ Error extracting coaching themes:', error);
      return {
        extractedThemes: [],
        progressPatterns: {},
        relationshipDynamics: {},
        extractionMetadata: {
          error: error.message,
          extractionDate: new Date().toISOString()
        }
      };
    }
  }
  
  /**
   * Analyze theme mentions in messages
   */
  static analyzeThemeMentions(messages) {
    const themeAnalysis = {};
    
    // Initialize theme analysis structure
    Object.keys(GOLF_COACHING_THEMES).forEach(themeName => {
      themeAnalysis[themeName] = {
        mentions: [],
        totalMentions: 0,
        userMentions: 0,
        coachMentions: 0,
        contexts: [],
        firstMention: null,
        lastMention: null,
        mentionDensity: 0
      };
    });
    
    // Analyze each message for theme mentions
    messages.forEach((message, index) => {
      const content = (message.content || '').toLowerCase();
      const messageRole = message.role || 'user';
      const messageDate = new Date(message.timestamp);
      
      Object.entries(GOLF_COACHING_THEMES).forEach(([themeName, themeConfig]) => {
        const keywords = themeConfig.keywords;
        let mentionCount = 0;
        const mentionedKeywords = [];
        
        // Check for keyword matches
        keywords.forEach(keyword => {
          const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
          const matches = content.match(regex);
          if (matches) {
            mentionCount += matches.length;
            mentionedKeywords.push(keyword);
          }
        });
        
        if (mentionCount > 0) {
          const mention = {
            messageIndex: index,
            messageId: message.message_id,
            timestamp: message.timestamp,
            role: messageRole,
            mentionCount: mentionCount,
            keywords: mentionedKeywords,
            context: this.extractMentionContext(content, mentionedKeywords)
          };
          
          themeAnalysis[themeName].mentions.push(mention);
          themeAnalysis[themeName].totalMentions += mentionCount;
          
          if (messageRole === 'user') {
            themeAnalysis[themeName].userMentions += mentionCount;
          } else {
            themeAnalysis[themeName].coachMentions += mentionCount;
          }
          
          if (!themeAnalysis[themeName].firstMention) {
            themeAnalysis[themeName].firstMention = messageDate;
          }
          themeAnalysis[themeName].lastMention = messageDate;
          
          themeAnalysis[themeName].contexts.push(mention.context);
        }
      });
    });
    
    // Calculate mention density for each theme
    Object.keys(themeAnalysis).forEach(themeName => {
      const theme = themeAnalysis[themeName];
      if (theme.totalMentions > 0) {
        theme.mentionDensity = theme.totalMentions / messages.length;
        
        // Calculate conversation span for this theme
        if (theme.firstMention && theme.lastMention) {
          const spanDays = (theme.lastMention - theme.firstMention) / (1000 * 60 * 60 * 24);
          theme.conversationSpan = Math.max(1, spanDays);
        }
      }
    });
    
    return themeAnalysis;
  }
  
  /**
   * Extract mention context from message content
   */
  static extractMentionContext(content, keywords) {
    try {
      // Find sentences containing the keywords
      const sentences = content.split(/[.!?]+/);
      const contextSentences = [];
      
      keywords.forEach(keyword => {
        const matchingSentence = sentences.find(sentence => 
          sentence.toLowerCase().includes(keyword.toLowerCase())
        );
        
        if (matchingSentence && matchingSentence.trim().length > 10) {
          contextSentences.push(matchingSentence.trim());
        }
      });
      
      return contextSentences.slice(0, 2); // Return up to 2 context sentences
      
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Extract progress patterns for themes
   */
  static extractProgressPatterns(messages, themeAnalysis) {
    const progressPatterns = {};
    
    Object.keys(themeAnalysis).forEach(themeName => {
      const theme = themeAnalysis[themeName];
      
      if (theme.totalMentions >= THEME_EXTRACTION_CONFIG.MIN_THEME_MENTIONS) {
        progressPatterns[themeName] = this.analyzeThemeProgress(theme, messages);
      }
    });
    
    return progressPatterns;
  }
  
  /**
   * Analyze progress for a specific theme
   */
  static analyzeThemeProgress(theme, messages) {
    try {
      const progressAnalysis = {
        overallTrend: 'neutral',
        progressIndicators: [],
        strugglingIndicators: [],
        breakthroughMoments: [],
        consistencyLevel: 'unknown',
        coachingEffectiveness: 'unknown'
      };
      
      // Analyze messages containing theme mentions for progress indicators
      theme.mentions.forEach(mention => {
        const messageIndex = mention.messageIndex;
        const message = messages[messageIndex];
        const content = (message.content || '').toLowerCase();
        
        // Check for different types of progress indicators
        Object.entries(PROGRESS_INDICATORS).forEach(([indicatorType, keywords]) => {
          keywords.forEach(keyword => {
            if (content.includes(keyword)) {
              const indicator = {
                type: indicatorType,
                keyword: keyword,
                timestamp: message.timestamp,
                messageIndex: messageIndex,
                role: message.role,
                context: this.extractProgressContext(content, keyword)
              };
              
              switch (indicatorType) {
                case 'BREAKTHROUGH':
                  progressAnalysis.breakthroughMoments.push(indicator);
                  break;
                case 'CONSISTENCY':
                  progressAnalysis.progressIndicators.push(indicator);
                  break;
                case 'CONFIDENCE':
                  progressAnalysis.progressIndicators.push(indicator);
                  break;
                case 'UNDERSTANDING':
                  progressAnalysis.progressIndicators.push(indicator);
                  break;
                case 'STRUGGLE':
                  progressAnalysis.strugglingIndicators.push(indicator);
                  break;
                case 'PLATEAU':
                  progressAnalysis.strugglingIndicators.push(indicator);
                  break;
              }
            }
          });
        });
      });
      
      // Determine overall progress trend
      const positiveIndicators = progressAnalysis.progressIndicators.length + 
                                progressAnalysis.breakthroughMoments.length;
      const negativeIndicators = progressAnalysis.strugglingIndicators.length;
      
      if (positiveIndicators > negativeIndicators * 1.5) {
        progressAnalysis.overallTrend = 'improving';
      } else if (negativeIndicators > positiveIndicators * 1.5) {
        progressAnalysis.overallTrend = 'struggling';
      } else if (positiveIndicators === 0 && negativeIndicators === 0) {
        progressAnalysis.overallTrend = 'neutral';
      } else {
        progressAnalysis.overallTrend = 'mixed';
      }
      
      // Determine consistency level
      const consistencyIndicators = progressAnalysis.progressIndicators.filter(
        p => p.type === 'CONSISTENCY'
      );
      
      if (consistencyIndicators.length >= 2) {
        progressAnalysis.consistencyLevel = 'high';
      } else if (consistencyIndicators.length === 1) {
        progressAnalysis.consistencyLevel = 'medium';
      } else {
        progressAnalysis.consistencyLevel = 'low';
      }
      
      // Assess coaching effectiveness
      const userProgress = progressAnalysis.progressIndicators.filter(p => p.role === 'user').length;
      const coachMentions = theme.coachMentions;
      
      if (userProgress > 0 && coachMentions > 2) {
        progressAnalysis.coachingEffectiveness = 'effective';
      } else if (userProgress === 0 && coachMentions > 3) {
        progressAnalysis.coachingEffectiveness = 'needs_adjustment';
      } else {
        progressAnalysis.coachingEffectiveness = 'developing';
      }
      
      return progressAnalysis;
      
    } catch (error) {
      console.error(`❌ Error analyzing theme progress for ${theme}:`, error);
      return {
        overallTrend: 'unknown',
        progressIndicators: [],
        strugglingIndicators: [],
        breakthroughMoments: [],
        consistencyLevel: 'unknown',
        coachingEffectiveness: 'unknown',
        error: error.message
      };
    }
  }
  
  /**
   * Extract progress context from content
   */
  static extractProgressContext(content, keyword) {
    try {
      const sentences = content.split(/[.!?]+/);
      const contextSentence = sentences.find(sentence => 
        sentence.toLowerCase().includes(keyword.toLowerCase())
      );
      
      return contextSentence ? contextSentence.trim() : '';
      
    } catch (error) {
      return '';
    }
  }
  
  /**
   * Calculate theme confidence scores
   */
  static calculateThemeConfidence(themeAnalysis, messages) {
    const themeConfidence = {};
    
    Object.entries(themeAnalysis).forEach(([themeName, theme]) => {
      let confidence = 0;
      
      if (theme.totalMentions === 0) {
        themeConfidence[themeName] = 0;
        return;
      }
      
      // Base confidence from mention frequency
      confidence += Math.min(0.4, theme.mentionDensity * 10);
      
      // Boost for mutual discussion (both user and coach mention)
      if (theme.userMentions > 0 && theme.coachMentions > 0) {
        confidence += 0.2;
      }
      
      // Boost for conversation span (sustained discussion)
      if (theme.conversationSpan && theme.conversationSpan > 1) {
        confidence += Math.min(0.2, theme.conversationSpan / 7);
      }
      
      // Boost for multiple mention contexts
      if (theme.contexts.length > 2) {
        confidence += Math.min(0.1, theme.contexts.length * 0.02);
      }
      
      // Boost for theme priority (critical themes get higher confidence)
      const themeConfig = GOLF_COACHING_THEMES[themeName];
      if (themeConfig.priority === 'critical') {
        confidence += 0.1;
      } else if (themeConfig.priority === 'high') {
        confidence += 0.05;
      }
      
      // Cap confidence at 1.0
      themeConfidence[themeName] = Math.min(1.0, confidence);
    });
    
    return themeConfidence;
  }
  
  /**
   * Merge with existing themes
   */
  static mergeWithExistingThemes(newThemeAnalysis, existingThemes, progressPatterns) {
    const mergedThemes = {};
    
    // Start with existing themes and update them
    existingThemes.forEach(existingTheme => {
      const themeName = existingTheme.name;
      mergedThemes[themeName] = {
        ...existingTheme,
        updated: false
      };
    });
    
    // Add or update themes from new analysis
    Object.entries(newThemeAnalysis).forEach(([themeName, themeData]) => {
      if (themeData.totalMentions >= THEME_EXTRACTION_CONFIG.MIN_THEME_MENTIONS) {
        const themeConfig = GOLF_COACHING_THEMES[themeName];
        
        if (mergedThemes[themeName]) {
          // Update existing theme
          mergedThemes[themeName] = {
            ...mergedThemes[themeName],
            totalMentions: (mergedThemes[themeName].totalMentions || 0) + themeData.totalMentions,
            lastMention: themeData.lastMention,
            recentMentions: themeData.mentions,
            progressPattern: progressPatterns[themeName],
            updated: true,
            lastUpdated: new Date().toISOString()
          };
        } else {
          // Add new theme
          mergedThemes[themeName] = {
            name: themeName,
            category: themeConfig.category,
            priority: themeConfig.priority,
            totalMentions: themeData.totalMentions,
            firstMention: themeData.firstMention,
            lastMention: themeData.lastMention,
            conversationSpan: themeData.conversationSpan || 0,
            recentMentions: themeData.mentions,
            progressPattern: progressPatterns[themeName],
            created: new Date().toISOString(),
            updated: true,
            lastUpdated: new Date().toISOString()
          };
        }
      }
    });
    
    return Object.values(mergedThemes);
  }
  
  /**
   * Prioritize themes based on relevance and importance
   */
  static prioritizeThemes(themes, themeConfidence) {
    return themes
      .filter(theme => {
        // Filter out themes with low confidence
        const confidence = themeConfidence[theme.name] || 0;
        return confidence >= THEME_EXTRACTION_CONFIG.CONFIDENCE_THRESHOLD;
      })
      .map(theme => ({
        ...theme,
        confidence: themeConfidence[theme.name] || 0
      }))
      .sort((a, b) => {
        // Sort by priority, then confidence, then recent activity
        const priorityOrder = { 'critical': 3, 'high': 2, 'medium': 1, 'low': 0 };
        const aPriority = priorityOrder[a.priority] || 0;
        const bPriority = priorityOrder[b.priority] || 0;
        
        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }
        
        if (a.confidence !== b.confidence) {
          return b.confidence - a.confidence;
        }
        
        // Recent activity (last mention)
        const aLastMention = new Date(a.lastMention || 0);
        const bLastMention = new Date(b.lastMention || 0);
        return bLastMention - aLastMention;
      })
      .slice(0, THEME_EXTRACTION_CONFIG.MAX_ACTIVE_THEMES);
  }
  
  /**
   * Extract coaching relationship dynamics
   */
  static extractRelationshipDynamics(messages) {
    try {
      const dynamics = {
        communicationStyle: 'unknown',
        engagementLevel: 'unknown',
        coachingReceptivity: 'unknown',
        questionAsking: 'unknown',
        feedbackResponse: 'unknown',
        initiativeLevel: 'unknown'
      };
      
      const userMessages = messages.filter(m => m.role === 'user');
      const assistantMessages = messages.filter(m => m.role === 'assistant');
      
      if (userMessages.length === 0 || assistantMessages.length === 0) {
        return dynamics;
      }
      
      // Analyze communication style
      const avgUserMessageLength = userMessages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0) / userMessages.length;
      const avgAssistantMessageLength = assistantMessages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0) / assistantMessages.length;
      
      if (avgUserMessageLength > avgAssistantMessageLength * 0.8) {
        dynamics.communicationStyle = 'collaborative';
      } else if (avgUserMessageLength < avgAssistantMessageLength * 0.3) {
        dynamics.communicationStyle = 'coach_led';
      } else {
        dynamics.communicationStyle = 'balanced';
      }
      
      // Analyze engagement level
      const messageRatio = userMessages.length / messages.length;
      if (messageRatio > 0.6) {
        dynamics.engagementLevel = 'high';
      } else if (messageRatio > 0.4) {
        dynamics.engagementLevel = 'medium';
      } else {
        dynamics.engagementLevel = 'low';
      }
      
      // Analyze question asking
      const questionCount = userMessages.filter(msg => 
        (msg.content || '').includes('?') || 
        (msg.content || '').toLowerCase().match(/^(how|what|why|when|where|can|should|would|could)/)
      ).length;
      
      const questionRatio = questionCount / userMessages.length;
      if (questionRatio > 0.3) {
        dynamics.questionAsking = 'high';
      } else if (questionRatio > 0.1) {
        dynamics.questionAsking = 'medium';
      } else {
        dynamics.questionAsking = 'low';
      }
      
      // Analyze coaching receptivity
      const positiveResponses = userMessages.filter(msg => {
        const content = (msg.content || '').toLowerCase();
        return content.includes('thank') || content.includes('helpful') || 
               content.includes('great') || content.includes('understand') ||
               content.includes('make sense') || content.includes('got it');
      }).length;
      
      const receptivityRatio = positiveResponses / userMessages.length;
      if (receptivityRatio > 0.2) {
        dynamics.coachingReceptivity = 'high';
      } else if (receptivityRatio > 0.1) {
        dynamics.coachingReceptivity = 'medium';
      } else {
        dynamics.coachingReceptivity = 'low';
      }
      
      return dynamics;
      
    } catch (error) {
      console.error('❌ Error extracting relationship dynamics:', error);
      return {
        communicationStyle: 'unknown',
        engagementLevel: 'unknown',
        coachingReceptivity: 'unknown',
        questionAsking: 'unknown',
        feedbackResponse: 'unknown',
        initiativeLevel: 'unknown',
        error: error.message
      };
    }
  }
  
  /**
   * Calculate average confidence across themes
   */
  static calculateAverageConfidence(themes) {
    if (themes.length === 0) return 0;
    
    const totalConfidence = themes.reduce((sum, theme) => sum + (theme.confidence || 0), 0);
    return Math.round((totalConfidence / themes.length) * 100) / 100;
  }
  
  /**
   * Get theme recommendations for coaching focus
   */
  static getThemeRecommendations(extractedThemes, progressPatterns) {
    try {
      const recommendations = [];
      
      extractedThemes.forEach(theme => {
        const progress = progressPatterns[theme.name];
        
        if (!progress) return;
        
        let recommendation = {
          themeName: theme.name,
          priority: theme.priority,
          confidence: theme.confidence,
          recommendation: 'continue',
          reasoning: ''
        };
        
        // Analyze progress and make recommendations
        if (progress.overallTrend === 'improving' && progress.consistencyLevel === 'high') {
          recommendation.recommendation = 'graduate';
          recommendation.reasoning = 'Showing consistent improvement, ready to move to maintenance mode';
        } else if (progress.overallTrend === 'struggling' && theme.priority === 'critical') {
          recommendation.recommendation = 'intensify';
          recommendation.reasoning = 'Critical area showing struggles, needs focused attention';
        } else if (progress.overallTrend === 'mixed' && theme.totalMentions > 10) {
          recommendation.recommendation = 'adjust_approach';
          recommendation.reasoning = 'Mixed results despite high focus, coaching approach may need adjustment';
        } else if (progress.breakthroughMoments.length > 0) {
          recommendation.recommendation = 'build_on_breakthrough';
          recommendation.reasoning = 'Recent breakthrough identified, build momentum';
        } else {
          recommendation.recommendation = 'continue';
          recommendation.reasoning = 'Steady progress, maintain current approach';
        }
        
        recommendations.push(recommendation);
      });
      
      return recommendations.sort((a, b) => {
        const priorityOrder = { 'critical': 3, 'high': 2, 'medium': 1, 'low': 0 };
        return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
      });
      
    } catch (error) {
      console.error('❌ Error generating theme recommendations:', error);
      return [];
    }
  }
}

// EXPORT THEME EXTRACTION ENGINE
module.exports = {
  CoachingThemeExtractionEngine,
  THEME_EXTRACTION_CONFIG,
  GOLF_COACHING_THEMES,
  PROGRESS_INDICATORS
};