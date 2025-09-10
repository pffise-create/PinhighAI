/**
 * Sprint 4A: Automated Conversation Cleanup System
 * 
 * This module implements automated conversation cleanup, archival, and 
 * maintenance to keep the coaching conversations system performant and
 * cost-effective while preserving valuable coaching data.
 */

const AWS = require('aws-sdk');
const { ConversationCompressionEngine } = require('./conversation-compression-algorithm');
const { ConversationSummarizationEngine } = require('./conversation-summarization');
const { CoachingThemeExtractionEngine } = require('./coaching-theme-extraction');

// CLEANUP CONFIGURATION
const CLEANUP_CONFIG = {
  // Cleanup triggers
  MAX_CONVERSATION_AGE_DAYS: 90,       // Archive conversations older than 90 days
  MAX_MESSAGES_PER_CONVERSATION: 100,  // Compress conversations with 100+ messages
  CLEANUP_BATCH_SIZE: 10,              // Process max 10 conversations per run
  
  // Retention policies
  ARCHIVE_RETENTION_DAYS: 365,         // Keep archives for 1 year
  SUMMARY_RETENTION_DAYS: 1095,        // Keep summaries for 3 years
  THEME_RETENTION_DAYS: 180,           // Keep themes for 6 months
  
  // Performance thresholds
  MAX_TOTAL_CONVERSATIONS: 1000,       // Global conversation limit
  USER_CONVERSATION_LIMIT: 5,          // Active conversations per user
  COMPRESSION_MEMORY_LIMIT: 256,       // MB memory limit for compression
  
  // Cost controls
  MAX_DAILY_CLEANUP_COST: 10,          // Max $10/day for cleanup operations
  SUMMARY_TOKEN_LIMIT: 500,            // Token limit for summaries
  BATCH_PROCESSING_DELAY: 2000         // 2 second delay between batches
};

/**
 * Automated Conversation Cleanup Engine
 */
class ConversationCleanupEngine {
  
  constructor() {
    this.dynamodb = new AWS.DynamoDB.DocumentClient();
    this.s3 = new AWS.S3();
    this.cloudwatch = new AWS.CloudWatch();
    this.lambda = new AWS.Lambda();
    
    this.tableName = 'coaching-conversations';
    this.archiveBucket = 'pin-high-conversation-archives';
    this.cleanupMetrics = {
      conversationsProcessed: 0,
      conversationsCompressed: 0,
      conversationsArchived: 0,
      messagesCompressed: 0,
      storageFreed: 0,
      costsIncurred: 0
    };
  }
  
  /**
   * Main cleanup orchestration function
   */
  async performConversationCleanup(triggerType = 'scheduled', targetUserId = null) {
    try {
      console.log(`🧹 Starting conversation cleanup (${triggerType})...`);
      
      const cleanupPlan = await this.generateCleanupPlan(targetUserId);
      
      if (cleanupPlan.totalActions === 0) {
        console.log('✅ No cleanup actions needed');
        return {
          success: true,
          message: 'No cleanup required',
          metrics: this.cleanupMetrics
        };
      }
      
      console.log(`📋 Cleanup plan: ${cleanupPlan.totalActions} actions identified`);
      
      // Execute cleanup plan in phases
      await this.executeCompressionPhase(cleanupPlan.compressionTargets);
      await this.executeArchivalPhase(cleanupPlan.archivalTargets);
      await this.executeThemeCleanupPhase(cleanupPlan.themeCleanupTargets);
      
      // Update conversation metadata
      await this.updateConversationMetadata();
      
      // Track cleanup metrics
      await this.trackCleanupMetrics();
      
      console.log('✅ Conversation cleanup completed successfully');
      
      return {
        success: true,
        metrics: this.cleanupMetrics,
        cleanupPlan: cleanupPlan,
        completedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Error during conversation cleanup:', error);
      
      // Track cleanup failures
      await this.trackCleanupFailure(error);
      
      return {
        success: false,
        error: error.message,
        metrics: this.cleanupMetrics
      };
    }
  }
  
  /**
   * Generate comprehensive cleanup plan
   */
  async generateCleanupPlan(targetUserId = null) {
    try {
      console.log('📋 Generating conversation cleanup plan...');
      
      // Get all conversations that need attention
      const conversationsToAnalyze = await this.getConversationsForCleanup(targetUserId);
      
      const cleanupPlan = {
        compressionTargets: [],
        archivalTargets: [],
        themeCleanupTargets: [],
        totalActions: 0,
        estimatedSavings: {
          storage: 0,
          compute: 0,
          cost: 0
        }
      };
      
      // Analyze each conversation for cleanup needs
      for (const conversation of conversationsToAnalyze) {
        const analysis = await this.analyzeConversationForCleanup(conversation);
        
        if (analysis.needsCompression) {
          cleanupPlan.compressionTargets.push({
            conversationId: conversation.conversation_id,
            userId: conversation.user_id,
            analysis: analysis,
            priority: this.calculateCompressionPriority(analysis)
          });
        }
        
        if (analysis.needsArchival) {
          cleanupPlan.archivalTargets.push({
            conversationId: conversation.conversation_id,
            userId: conversation.user_id,
            analysis: analysis,
            archiveReason: analysis.archiveReason
          });
        }
        
        if (analysis.needsThemeCleanup) {
          cleanupPlan.themeCleanupTargets.push({
            conversationId: conversation.conversation_id,
            userId: conversation.user_id,
            themes: analysis.outdatedThemes
          });
        }
        
        // Calculate estimated savings
        cleanupPlan.estimatedSavings.storage += analysis.estimatedStorageSavings || 0;
        cleanupPlan.estimatedSavings.compute += analysis.estimatedComputeSavings || 0;
      }
      
      cleanupPlan.totalActions = cleanupPlan.compressionTargets.length + 
                                cleanupPlan.archivalTargets.length + 
                                cleanupPlan.themeCleanupTargets.length;
      
      // Prioritize cleanup targets
      cleanupPlan.compressionTargets.sort((a, b) => b.priority - a.priority);
      
      // Limit batch size to stay within resource constraints
      cleanupPlan.compressionTargets = cleanupPlan.compressionTargets.slice(0, CLEANUP_CONFIG.CLEANUP_BATCH_SIZE);
      cleanupPlan.archivalTargets = cleanupPlan.archivalTargets.slice(0, CLEANUP_CONFIG.CLEANUP_BATCH_SIZE);
      
      console.log(`📋 Cleanup plan generated: ${cleanupPlan.totalActions} total actions`);
      return cleanupPlan;
      
    } catch (error) {
      console.error('❌ Error generating cleanup plan:', error);
      return {
        compressionTargets: [],
        archivalTargets: [],
        themeCleanupTargets: [],
        totalActions: 0,
        estimatedSavings: { storage: 0, compute: 0, cost: 0 },
        error: error.message
      };
    }
  }
  
  /**
   * Get conversations that need cleanup analysis
   */
  async getConversationsForCleanup(targetUserId = null) {
    try {
      let scanParams = {
        TableName: this.tableName,
        FilterExpression: 'attribute_exists(recent_messages)',
        ProjectionExpression: 'conversation_id, user_id, last_updated, recent_messages, total_tokens_used, coaching_themes, conversation_status'
      };
      
      // If targeting specific user, add filter
      if (targetUserId) {
        scanParams.FilterExpression += ' AND user_id = :userId';
        scanParams.ExpressionAttributeValues = {
          ':userId': targetUserId
        };
      }
      
      const result = await this.dynamodb.scan(scanParams).promise();
      
      // Filter conversations based on cleanup criteria
      const conversationsNeedingCleanup = result.Items.filter(conversation => {
        const lastUpdated = new Date(conversation.last_updated);
        const daysSinceUpdate = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
        const messageCount = conversation.recent_messages?.length || 0;
        
        // Needs cleanup if old, large, or inactive
        return daysSinceUpdate > 7 || // Updated more than a week ago
               messageCount > CLEANUP_CONFIG.MAX_MESSAGES_PER_CONVERSATION * 0.8 || // Close to message limit
               daysSinceUpdate > CLEANUP_CONFIG.MAX_CONVERSATION_AGE_DAYS || // Too old
               conversation.conversation_status === 'inactive'; // Marked inactive
      });
      
      console.log(`Found ${conversationsNeedingCleanup.length} conversations needing cleanup analysis`);
      return conversationsNeedingCleanup;
      
    } catch (error) {
      console.error('❌ Error getting conversations for cleanup:', error);
      return [];
    }
  }
  
  /**
   * Analyze individual conversation for cleanup needs
   */
  async analyzeConversationForCleanup(conversation) {
    try {
      const lastUpdated = new Date(conversation.last_updated);
      const daysSinceUpdate = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
      const messageCount = conversation.recent_messages?.length || 0;
      const totalTokens = conversation.total_tokens_used || 0;
      
      const analysis = {
        conversationId: conversation.conversation_id,
        messageCount: messageCount,
        daysSinceUpdate: daysSinceUpdate,
        totalTokens: totalTokens,
        needsCompression: false,
        needsArchival: false,
        needsThemeCleanup: false,
        compressionUrgency: 'low',
        archiveReason: null,
        outdatedThemes: [],
        estimatedStorageSavings: 0,
        estimatedComputeSavings: 0
      };
      
      // Check compression needs
      if (messageCount >= CLEANUP_CONFIG.MAX_MESSAGES_PER_CONVERSATION) {
        analysis.needsCompression = true;
        analysis.compressionUrgency = 'high';
        analysis.estimatedStorageSavings = Math.floor(messageCount * 0.6); // Estimate 60% reduction
      } else if (messageCount >= CLEANUP_CONFIG.MAX_MESSAGES_PER_CONVERSATION * 0.8) {
        analysis.needsCompression = true;
        analysis.compressionUrgency = 'medium';
        analysis.estimatedStorageSavings = Math.floor(messageCount * 0.4);
      }
      
      // Check archival needs
      if (daysSinceUpdate > CLEANUP_CONFIG.MAX_CONVERSATION_AGE_DAYS) {
        analysis.needsArchival = true;
        analysis.archiveReason = 'age_limit_exceeded';
      } else if (conversation.conversation_status === 'inactive') {
        analysis.needsArchival = true;
        analysis.archiveReason = 'marked_inactive';
      }
      
      // Check theme cleanup needs
      if (conversation.coaching_themes) {
        const outdatedThemes = this.identifyOutdatedThemes(conversation.coaching_themes);
        if (outdatedThemes.length > 0) {
          analysis.needsThemeCleanup = true;
          analysis.outdatedThemes = outdatedThemes;
        }
      }
      
      // Calculate compute savings from compression
      if (analysis.needsCompression) {
        analysis.estimatedComputeSavings = Math.floor(totalTokens * 0.3); // Estimate 30% token reduction
      }
      
      return analysis;
      
    } catch (error) {
      console.error(`❌ Error analyzing conversation ${conversation.conversation_id}:`, error);
      return {
        conversationId: conversation.conversation_id,
        needsCompression: false,
        needsArchival: false,
        needsThemeCleanup: false,
        error: error.message
      };
    }
  }
  
  /**
   * Execute compression phase
   */
  async executeCompressionPhase(compressionTargets) {
    if (compressionTargets.length === 0) {
      console.log('📦 No conversations need compression');
      return;
    }
    
    console.log(`📦 Compressing ${compressionTargets.length} conversations...`);
    
    for (const target of compressionTargets) {
      try {
        await this.compressConversation(target);
        this.cleanupMetrics.conversationsCompressed++;
        
        // Add delay between compressions to manage costs
        await this.delay(CLEANUP_CONFIG.BATCH_PROCESSING_DELAY);
        
      } catch (error) {
        console.error(`❌ Error compressing conversation ${target.conversationId}:`, error);
      }
    }
    
    console.log(`✅ Compression phase complete: ${this.cleanupMetrics.conversationsCompressed} conversations compressed`);
  }
  
  /**
   * Compress individual conversation
   */
  async compressConversation(target) {
    try {
      console.log(`📦 Compressing conversation: ${target.conversationId}`);
      
      // Get full conversation data
      const conversationData = await this.getFullConversationData(target.conversationId);
      
      if (!conversationData || !conversationData.recent_messages) {
        console.warn(`No conversation data found for ${target.conversationId}`);
        return;
      }
      
      // Run compression analysis
      const compressionAnalysis = await ConversationCompressionEngine.analyzeCompressionNeeds(conversationData);
      
      if (!compressionAnalysis.compressionNeeded) {
        console.log(`Conversation ${target.conversationId} no longer needs compression`);
        return;
      }
      
      // Perform compression
      const compressionResult = await ConversationCompressionEngine.compressConversation(
        conversationData, 
        compressionAnalysis
      );
      
      if (!compressionResult.success) {
        throw new Error(`Compression failed: ${compressionResult.error}`);
      }
      
      // Generate intelligent summary of compressed messages
      const summaryResult = await ConversationSummarizationEngine.generateIntelligentSummary(
        compressionResult.retainedMessages,
        {
          summaryType: 'compression_summary',
          userId: target.userId,
          conversationId: target.conversationId
        }
      );
      
      // Extract themes from compressed content
      const themeExtraction = await CoachingThemeExtractionEngine.extractCoachingThemes(
        compressionResult.retainedMessages,
        conversationData.coaching_themes || [],
        target.userId
      );
      
      // Update conversation in DynamoDB
      await this.updateCompressedConversation(target.conversationId, {
        compressedMessages: compressionResult.retainedMessages,
        conversationSummary: summaryResult,
        extractedThemes: themeExtraction.extractedThemes,
        compressionMetadata: {
          originalMessageCount: compressionResult.originalMessageCount,
          compressedMessageCount: compressionResult.retainedMessageCount,
          compressionRatio: compressionResult.compressionRatio,
          compressionDate: new Date().toISOString(),
          retentionStrategy: compressionResult.retentionStrategy
        }
      });
      
      this.cleanupMetrics.messagesCompressed += compressionResult.compressedMessageCount;
      this.cleanupMetrics.storageFreed += compressionResult.compressedMessageCount * 100; // Estimate bytes saved
      
      console.log(`✅ Conversation ${target.conversationId} compressed successfully`);
      
    } catch (error) {
      console.error(`❌ Error compressing conversation ${target.conversationId}:`, error);
      throw error;
    }
  }
  
  /**
   * Execute archival phase
   */
  async executeArchivalPhase(archivalTargets) {
    if (archivalTargets.length === 0) {
      console.log('📂 No conversations need archival');
      return;
    }
    
    console.log(`📂 Archiving ${archivalTargets.length} conversations...`);
    
    for (const target of archivalTargets) {
      try {
        await this.archiveConversation(target);
        this.cleanupMetrics.conversationsArchived++;
        
        // Add delay between archival operations
        await this.delay(CLEANUP_CONFIG.BATCH_PROCESSING_DELAY);
        
      } catch (error) {
        console.error(`❌ Error archiving conversation ${target.conversationId}:`, error);
      }
    }
    
    console.log(`✅ Archival phase complete: ${this.cleanupMetrics.conversationsArchived} conversations archived`);
  }
  
  /**
   * Archive individual conversation
   */
  async archiveConversation(target) {
    try {
      console.log(`📂 Archiving conversation: ${target.conversationId}`);
      
      // Get full conversation data
      const conversationData = await this.getFullConversationData(target.conversationId);
      
      if (!conversationData) {
        console.warn(`No conversation data found for ${target.conversationId}`);
        return;
      }
      
      // Create archive package
      const archivePackage = {
        conversationId: target.conversationId,
        userId: target.userId,
        archiveReason: target.archiveReason,
        archivedAt: new Date().toISOString(),
        originalData: conversationData,
        metadata: {
          messageCount: conversationData.recent_messages?.length || 0,
          totalTokens: conversationData.total_tokens_used || 0,
          conversationSpan: this.calculateConversationSpan(conversationData),
          lastActivity: conversationData.last_updated
        }
      };
      
      // Store in S3 archive
      const archiveKey = `conversations/${target.userId}/${target.conversationId}/${new Date().getFullYear()}/${Date.now()}.json`;
      
      await this.s3.putObject({
        Bucket: this.archiveBucket,
        Key: archiveKey,
        Body: JSON.stringify(archivePackage, null, 2),
        ContentType: 'application/json',
        StorageClass: 'STANDARD_IA', // Infrequent Access for cost savings
        ServerSideEncryption: 'AES256',
        Metadata: {
          'user-id': target.userId,
          'conversation-id': target.conversationId,
          'archive-reason': target.archiveReason,
          'message-count': String(archivePackage.metadata.messageCount)
        }
      }).promise();
      
      // Update conversation status in DynamoDB (mark as archived, keep summary)
      await this.updateArchivedConversationStatus(target.conversationId, archiveKey);
      
      console.log(`✅ Conversation ${target.conversationId} archived to S3: ${archiveKey}`);
      
    } catch (error) {
      console.error(`❌ Error archiving conversation ${target.conversationId}:`, error);
      throw error;
    }
  }
  
  /**
   * Execute theme cleanup phase
   */
  async executeThemeCleanupPhase(themeCleanupTargets) {
    if (themeCleanupTargets.length === 0) {
      console.log('🎯 No theme cleanup needed');
      return;
    }
    
    console.log(`🎯 Cleaning up themes for ${themeCleanupTargets.length} conversations...`);
    
    for (const target of themeCleanupTargets) {
      try {
        await this.cleanupConversationThemes(target);
        
      } catch (error) {
        console.error(`❌ Error cleaning up themes for ${target.conversationId}:`, error);
      }
    }
    
    console.log('✅ Theme cleanup phase complete');
  }
  
  /**
   * Helper functions
   */
  
  async getFullConversationData(conversationId) {
    try {
      const result = await this.dynamodb.get({
        TableName: this.tableName,
        Key: { conversation_id: conversationId }
      }).promise();
      
      return result.Item;
      
    } catch (error) {
      console.error(`❌ Error getting conversation data for ${conversationId}:`, error);
      return null;
    }
  }
  
  async updateCompressedConversation(conversationId, compressionData) {
    try {
      const updateParams = {
        TableName: this.tableName,
        Key: { conversation_id: conversationId },
        UpdateExpression: `
          SET 
            recent_messages = :messages,
            conversation_summary = :summary,
            coaching_themes = :themes,
            compression_metadata = :compressionMeta,
            last_updated = :timestamp,
            conversation_status = :status
        `,
        ExpressionAttributeValues: {
          ':messages': compressionData.compressedMessages,
          ':summary': compressionData.conversationSummary,
          ':themes': compressionData.extractedThemes,
          ':compressionMeta': compressionData.compressionMetadata,
          ':timestamp': new Date().toISOString(),
          ':status': 'compressed'
        }
      };
      
      await this.dynamodb.update(updateParams).promise();
      
    } catch (error) {
      console.error(`❌ Error updating compressed conversation ${conversationId}:`, error);
      throw error;
    }
  }
  
  async updateArchivedConversationStatus(conversationId, archiveKey) {
    try {
      const updateParams = {
        TableName: this.tableName,
        Key: { conversation_id: conversationId },
        UpdateExpression: `
          SET 
            conversation_status = :status,
            archive_location = :archiveKey,
            archived_at = :timestamp
          REMOVE recent_messages
        `,
        ExpressionAttributeValues: {
          ':status': 'archived',
          ':archiveKey': archiveKey,
          ':timestamp': new Date().toISOString()
        }
      };
      
      await this.dynamodb.update(updateParams).promise();
      
    } catch (error) {
      console.error(`❌ Error updating archived conversation status ${conversationId}:`, error);
      throw error;
    }
  }
  
  identifyOutdatedThemes(themes) {
    const cutoffDate = new Date(Date.now() - (CLEANUP_CONFIG.THEME_RETENTION_DAYS * 24 * 60 * 60 * 1000));
    
    return themes.filter(theme => {
      const themeDate = new Date(theme.lastUpdated || theme.created);
      return themeDate < cutoffDate;
    });
  }
  
  calculateCompressionPriority(analysis) {
    let priority = 0;
    
    // Base priority from message count
    priority += Math.min(50, analysis.messageCount);
    
    // Urgency multiplier
    if (analysis.compressionUrgency === 'high') priority *= 2;
    if (analysis.compressionUrgency === 'medium') priority *= 1.5;
    
    // Storage savings factor
    priority += analysis.estimatedStorageSavings * 0.1;
    
    return Math.round(priority);
  }
  
  calculateConversationSpan(conversationData) {
    try {
      const messages = conversationData.recent_messages || [];
      if (messages.length === 0) return 0;
      
      const timestamps = messages.map(m => new Date(m.timestamp));
      const earliest = Math.min(...timestamps);
      const latest = Math.max(...timestamps);
      
      return Math.ceil((latest - earliest) / (1000 * 60 * 60 * 24)); // Days
      
    } catch (error) {
      return 0;
    }
  }
  
  async cleanupConversationThemes(target) {
    try {
      const updateParams = {
        TableName: this.tableName,
        Key: { conversation_id: target.conversationId },
        UpdateExpression: 'REMOVE coaching_themes',
        ConditionExpression: 'attribute_exists(conversation_id)'
      };
      
      await this.dynamodb.update(updateParams).promise();
      console.log(`🎯 Cleaned up themes for conversation ${target.conversationId}`);
      
    } catch (error) {
      if (error.code !== 'ConditionalCheckFailedException') {
        throw error;
      }
    }
  }
  
  async updateConversationMetadata() {
    // Update global conversation metrics and health indicators
    console.log('📊 Updating conversation metadata...');
  }
  
  async trackCleanupMetrics() {
    try {
      // Send metrics to CloudWatch
      const metrics = [
        {
          MetricName: 'ConversationsProcessed',
          Value: this.cleanupMetrics.conversationsProcessed,
          Unit: 'Count'
        },
        {
          MetricName: 'ConversationsCompressed', 
          Value: this.cleanupMetrics.conversationsCompressed,
          Unit: 'Count'
        },
        {
          MetricName: 'ConversationsArchived',
          Value: this.cleanupMetrics.conversationsArchived,
          Unit: 'Count'
        },
        {
          MetricName: 'MessagesCompressed',
          Value: this.cleanupMetrics.messagesCompressed,
          Unit: 'Count'
        },
        {
          MetricName: 'StorageFreed',
          Value: this.cleanupMetrics.storageFreed,
          Unit: 'Bytes'
        }
      ];
      
      await this.cloudwatch.putMetricData({
        Namespace: 'PinHigh/ConversationCleanup',
        MetricData: metrics.map(metric => ({
          ...metric,
          Timestamp: new Date()
        }))
      }).promise();
      
      console.log('📊 Cleanup metrics tracked successfully');
      
    } catch (error) {
      console.error('❌ Error tracking cleanup metrics:', error);
    }
  }
  
  async trackCleanupFailure(error) {
    try {
      await this.cloudwatch.putMetricData({
        Namespace: 'PinHigh/ConversationCleanup',
        MetricData: [{
          MetricName: 'CleanupFailures',
          Value: 1,
          Unit: 'Count',
          Timestamp: new Date()
        }]
      }).promise();
      
    } catch (metricsError) {
      console.error('❌ Error tracking cleanup failure:', metricsError);
    }
  }
  
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// EXPORT CLEANUP ENGINE
module.exports = {
  ConversationCleanupEngine,
  CLEANUP_CONFIG
};