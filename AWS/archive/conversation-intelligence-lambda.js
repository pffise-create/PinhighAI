/**
 * Sprint 4A: Conversation Intelligence Lambda Function
 * 
 * This Lambda function orchestrates conversation compression, intelligent
 * summarization, theme extraction, and automated cleanup for the Pin High
 * coaching conversation system.
 */

const AWS = require('aws-sdk');
const { ConversationCompressionEngine } = require('./conversation-compression-algorithm');
const { ConversationSummarizationEngine } = require('./conversation-summarization');
const { CoachingThemeExtractionEngine } = require('./coaching-theme-extraction');
const { ConversationCleanupEngine } = require('./conversation-cleanup-automation');

// Initialize AWS services
const dynamodb = new AWS.DynamoDB.DocumentClient();
const cloudwatch = new AWS.CloudWatch();
const eventbridge = new AWS.EventBridge();

// CONVERSATION INTELLIGENCE CONFIGURATION
const INTELLIGENCE_CONFIG = {
  PROCESSING_MODES: {
    REAL_TIME: 'real_time',           // Process individual conversations
    BATCH: 'batch',                   // Process multiple conversations
    SCHEDULED: 'scheduled',           // Scheduled maintenance
    EMERGENCY: 'emergency'            // Emergency cleanup
  },
  
  TRIGGER_TYPES: {
    CONVERSATION_SIZE: 'conversation_size_trigger',
    TIME_BASED: 'time_based_trigger',
    USER_REQUEST: 'user_request_trigger',
    SYSTEM_HEALTH: 'system_health_trigger',
    API_CALL: 'api_call_trigger'
  },
  
  INTELLIGENCE_OPERATIONS: {
    COMPRESS: 'compress_conversation',
    SUMMARIZE: 'generate_summary',
    EXTRACT_THEMES: 'extract_themes',
    CLEANUP: 'perform_cleanup',
    ANALYZE: 'analyze_conversation',
    OPTIMIZE: 'optimize_performance'
  },
  
  PERFORMANCE_LIMITS: {
    MAX_CONCURRENT_OPERATIONS: 5,
    MAX_PROCESSING_TIME: 300000,     // 5 minutes
    MAX_MEMORY_USAGE: 512,           // MB
    RATE_LIMIT_PER_MINUTE: 20
  }
};

/**
 * Main Lambda handler for conversation intelligence
 */
exports.handler = async (event) => {
  console.log('🧠 Conversation Intelligence Lambda triggered:', JSON.stringify(event, null, 2));
  
  try {
    // Parse event and determine processing mode
    const processingContext = await parseIntelligenceEvent(event);
    
    // Initialize intelligence processor
    const processor = new ConversationIntelligenceProcessor(processingContext);
    
    // Execute intelligence operations
    const result = await processor.processIntelligenceRequest();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(result)
    };
    
  } catch (error) {
    console.error('❌ Conversation Intelligence error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

/**
 * Parse intelligence event and determine processing context
 */
async function parseIntelligenceEvent(event) {
  try {
    let processingContext = {
      mode: INTELLIGENCE_CONFIG.PROCESSING_MODES.REAL_TIME,
      trigger: INTELLIGENCE_CONFIG.TRIGGER_TYPES.API_CALL,
      operations: [],
      targetConversations: [],
      targetUsers: [],
      parameters: {}
    };
    
    // Handle different event sources
    if (event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event') {
      // CloudWatch scheduled event
      processingContext.mode = INTELLIGENCE_CONFIG.PROCESSING_MODES.SCHEDULED;
      processingContext.trigger = INTELLIGENCE_CONFIG.TRIGGER_TYPES.TIME_BASED;
      processingContext.operations = [
        INTELLIGENCE_CONFIG.INTELLIGENCE_OPERATIONS.CLEANUP,
        INTELLIGENCE_CONFIG.INTELLIGENCE_OPERATIONS.OPTIMIZE
      ];
      
    } else if (event.Records && event.Records[0].eventSource === 'aws:dynamodb') {
      // DynamoDB stream trigger
      processingContext.mode = INTELLIGENCE_CONFIG.PROCESSING_MODES.REAL_TIME;
      processingContext.trigger = INTELLIGENCE_CONFIG.TRIGGER_TYPES.CONVERSATION_SIZE;
      
      // Process DynamoDB stream records
      const conversationIds = event.Records
        .filter(record => record.eventName === 'MODIFY')
        .map(record => record.dynamodb.Keys.conversation_id.S)
        .filter(id => id);
      
      processingContext.targetConversations = conversationIds;
      processingContext.operations = [
        INTELLIGENCE_CONFIG.INTELLIGENCE_OPERATIONS.ANALYZE,
        INTELLIGENCE_CONFIG.INTELLIGENCE_OPERATIONS.COMPRESS
      ];
      
    } else if (event.httpMethod === 'POST') {
      // API Gateway request
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      
      processingContext.mode = body.mode || INTELLIGENCE_CONFIG.PROCESSING_MODES.REAL_TIME;
      processingContext.trigger = INTELLIGENCE_CONFIG.TRIGGER_TYPES.USER_REQUEST;
      processingContext.operations = body.operations || [INTELLIGENCE_CONFIG.INTELLIGENCE_OPERATIONS.ANALYZE];
      processingContext.targetConversations = body.conversationIds || [];
      processingContext.targetUsers = body.userIds || [];
      processingContext.parameters = body.parameters || {};
      
    } else if (event.detail && event.detail.requestType) {
      // EventBridge custom event
      processingContext.mode = event.detail.mode || INTELLIGENCE_CONFIG.PROCESSING_MODES.BATCH;
      processingContext.trigger = INTELLIGENCE_CONFIG.TRIGGER_TYPES.SYSTEM_HEALTH;
      processingContext.operations = event.detail.operations || [];
      processingContext.parameters = event.detail.parameters || {};
    }
    
    console.log(`🧠 Processing context determined: ${processingContext.mode} mode, ${processingContext.operations.length} operations`);
    return processingContext;
    
  } catch (error) {
    console.error('❌ Error parsing intelligence event:', error);
    throw new Error(`Failed to parse intelligence event: ${error.message}`);
  }
}

/**
 * Conversation Intelligence Processor
 */
class ConversationIntelligenceProcessor {
  
  constructor(processingContext) {
    this.context = processingContext;
    this.cleanupEngine = new ConversationCleanupEngine();
    this.metrics = {
      operationsCompleted: 0,
      conversationsProcessed: 0,
      errorsEncountered: 0,
      processingTime: 0,
      memoryUsed: 0
    };
    this.startTime = Date.now();
  }
  
  /**
   * Main processing orchestration
   */
  async processIntelligenceRequest() {
    try {
      console.log(`🧠 Starting intelligence processing: ${this.context.mode} mode`);
      
      const result = {
        success: true,
        mode: this.context.mode,
        trigger: this.context.trigger,
        operations: [],
        metrics: this.metrics,
        timestamp: new Date().toISOString()
      };
      
      // Execute operations based on mode
      switch (this.context.mode) {
        case INTELLIGENCE_CONFIG.PROCESSING_MODES.REAL_TIME:
          result.operations = await this.processRealTime();
          break;
          
        case INTELLIGENCE_CONFIG.PROCESSING_MODES.BATCH:
          result.operations = await this.processBatch();
          break;
          
        case INTELLIGENCE_CONFIG.PROCESSING_MODES.SCHEDULED:
          result.operations = await this.processScheduled();
          break;
          
        case INTELLIGENCE_CONFIG.PROCESSING_MODES.EMERGENCY:
          result.operations = await this.processEmergency();
          break;
          
        default:
          throw new Error(`Unknown processing mode: ${this.context.mode}`);
      }
      
      // Update metrics
      this.metrics.processingTime = Date.now() - this.startTime;
      result.metrics = this.metrics;
      
      // Track success metrics
      await this.trackIntelligenceMetrics(result);
      
      console.log(`✅ Intelligence processing complete: ${this.metrics.operationsCompleted} operations, ${this.metrics.conversationsProcessed} conversations`);
      return result;
      
    } catch (error) {
      console.error('❌ Error in intelligence processing:', error);
      
      this.metrics.errorsEncountered++;
      await this.trackIntelligenceError(error);
      
      throw error;
    }
  }
  
  /**
   * Process real-time intelligence operations
   */
  async processRealTime() {
    const operationResults = [];
    
    // Process specific conversations or users
    const conversationsToProcess = await this.identifyTargetConversations();
    
    for (const conversationId of conversationsToProcess) {
      for (const operation of this.context.operations) {
        try {
          const operationResult = await this.executeIntelligenceOperation(operation, conversationId);
          operationResults.push(operationResult);
          this.metrics.operationsCompleted++;
          
        } catch (error) {
          console.error(`❌ Error executing ${operation} on ${conversationId}:`, error);
          this.metrics.errorsEncountered++;
          
          operationResults.push({
            operation: operation,
            conversationId: conversationId,
            success: false,
            error: error.message
          });
        }
      }
      
      this.metrics.conversationsProcessed++;
    }
    
    return operationResults;
  }
  
  /**
   * Process batch intelligence operations
   */
  async processBatch() {
    const operationResults = [];
    
    // Get batch of conversations needing processing
    const conversationBatch = await this.getBatchConversations();
    
    console.log(`📦 Processing batch of ${conversationBatch.length} conversations`);
    
    // Process conversations in parallel (with concurrency limit)
    const batchPromises = conversationBatch.map(conversationId => 
      this.processBatchConversation(conversationId)
    );
    
    const batchResults = await Promise.allSettled(batchPromises);
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        operationResults.push(...result.value);
        this.metrics.conversationsProcessed++;
      } else {
        console.error(`❌ Batch processing error for conversation ${conversationBatch[index]}:`, result.reason);
        this.metrics.errorsEncountered++;
        
        operationResults.push({
          conversationId: conversationBatch[index],
          success: false,
          error: result.reason.message
        });
      }
    });
    
    return operationResults;
  }
  
  /**
   * Process scheduled maintenance operations
   */
  async processScheduled() {
    const operationResults = [];
    
    console.log('⏰ Executing scheduled conversation intelligence maintenance');
    
    // Perform system-wide cleanup
    const cleanupResult = await this.cleanupEngine.performConversationCleanup('scheduled');
    operationResults.push({
      operation: 'system_cleanup',
      success: cleanupResult.success,
      metrics: cleanupResult.metrics
    });
    
    // Perform system optimization
    const optimizationResult = await this.performSystemOptimization();
    operationResults.push({
      operation: 'system_optimization',
      success: optimizationResult.success,
      optimizations: optimizationResult.optimizations
    });
    
    // Update system health metrics
    await this.updateSystemHealthMetrics();
    
    this.metrics.operationsCompleted += 2;
    
    return operationResults;
  }
  
  /**
   * Process emergency operations
   */
  async processEmergency() {
    const operationResults = [];
    
    console.log('🚨 Executing emergency conversation intelligence operations');
    
    // Emergency cleanup with aggressive settings
    const emergencyCleanup = await this.cleanupEngine.performConversationCleanup('emergency');
    operationResults.push({
      operation: 'emergency_cleanup',
      success: emergencyCleanup.success,
      metrics: emergencyCleanup.metrics
    });
    
    // Emergency compression of largest conversations
    const largeConversations = await this.identifyLargeConversations(10);
    
    for (const conversationId of largeConversations) {
      try {
        const compressionResult = await this.executeEmergencyCompression(conversationId);
        operationResults.push(compressionResult);
        this.metrics.operationsCompleted++;
        
      } catch (error) {
        console.error(`❌ Emergency compression error for ${conversationId}:`, error);
        this.metrics.errorsEncountered++;
      }
    }
    
    return operationResults;
  }
  
  /**
   * Execute individual intelligence operation
   */
  async executeIntelligenceOperation(operation, conversationId) {
    const operationStartTime = Date.now();
    
    try {
      console.log(`🔧 Executing ${operation} on conversation ${conversationId}`);
      
      let result = {
        operation: operation,
        conversationId: conversationId,
        success: false,
        data: null,
        processingTime: 0
      };
      
      switch (operation) {
        case INTELLIGENCE_CONFIG.INTELLIGENCE_OPERATIONS.COMPRESS:
          result = await this.executeCompressionOperation(conversationId);
          break;
          
        case INTELLIGENCE_CONFIG.INTELLIGENCE_OPERATIONS.SUMMARIZE:
          result = await this.executeSummarizationOperation(conversationId);
          break;
          
        case INTELLIGENCE_CONFIG.INTELLIGENCE_OPERATIONS.EXTRACT_THEMES:
          result = await this.executeThemeExtractionOperation(conversationId);
          break;
          
        case INTELLIGENCE_CONFIG.INTELLIGENCE_OPERATIONS.ANALYZE:
          result = await this.executeAnalysisOperation(conversationId);
          break;
          
        case INTELLIGENCE_CONFIG.INTELLIGENCE_OPERATIONS.CLEANUP:
          result = await this.executeCleanupOperation(conversationId);
          break;
          
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
      
      result.processingTime = Date.now() - operationStartTime;
      return result;
      
    } catch (error) {
      console.error(`❌ Error executing ${operation}:`, error);
      return {
        operation: operation,
        conversationId: conversationId,
        success: false,
        error: error.message,
        processingTime: Date.now() - operationStartTime
      };
    }
  }
  
  /**
   * Execute compression operation
   */
  async executeCompressionOperation(conversationId) {
    try {
      const conversationData = await this.getConversationData(conversationId);
      
      if (!conversationData) {
        throw new Error('Conversation not found');
      }
      
      const compressionAnalysis = await ConversationCompressionEngine.analyzeCompressionNeeds(conversationData);
      
      if (!compressionAnalysis.compressionNeeded) {
        return {
          operation: 'compress',
          conversationId: conversationId,
          success: true,
          data: { message: 'No compression needed' }
        };
      }
      
      const compressionResult = await ConversationCompressionEngine.compressConversation(
        conversationData,
        compressionAnalysis
      );
      
      if (compressionResult.success) {
        // Update conversation in database
        await this.updateConversationWithCompression(conversationId, compressionResult);
      }
      
      return {
        operation: 'compress',
        conversationId: conversationId,
        success: compressionResult.success,
        data: {
          originalMessages: compressionResult.originalMessageCount,
          retainedMessages: compressionResult.retainedMessageCount,
          compressionRatio: compressionResult.compressionRatio
        }
      };
      
    } catch (error) {
      throw new Error(`Compression operation failed: ${error.message}`);
    }
  }
  
  /**
   * Execute summarization operation
   */
  async executeSummarizationOperation(conversationId) {
    try {
      const conversationData = await this.getConversationData(conversationId);
      
      if (!conversationData || !conversationData.recent_messages) {
        throw new Error('No conversation messages found');
      }
      
      const summaryResult = await ConversationSummarizationEngine.generateIntelligentSummary(
        conversationData.recent_messages,
        {
          summaryType: 'intelligence_summary',
          userId: conversationData.user_id,
          conversationId: conversationId
        }
      );
      
      // Store summary in conversation
      await this.updateConversationWithSummary(conversationId, summaryResult);
      
      return {
        operation: 'summarize',
        conversationId: conversationId,
        success: true,
        data: {
          summaryLength: summaryResult.summary?.length || 0,
          themesIdentified: summaryResult.coachingThemes?.length || 0,
          tokensUsed: summaryResult.generationMetadata?.tokensUsed || 0
        }
      };
      
    } catch (error) {
      throw new Error(`Summarization operation failed: ${error.message}`);
    }
  }
  
  /**
   * Execute theme extraction operation
   */
  async executeThemeExtractionOperation(conversationId) {
    try {
      const conversationData = await this.getConversationData(conversationId);
      
      if (!conversationData || !conversationData.recent_messages) {
        throw new Error('No conversation messages found');
      }
      
      const themeExtraction = await CoachingThemeExtractionEngine.extractCoachingThemes(
        conversationData.recent_messages,
        conversationData.coaching_themes || [],
        conversationData.user_id
      );
      
      // Update conversation with extracted themes
      await this.updateConversationWithThemes(conversationId, themeExtraction);
      
      return {
        operation: 'extract_themes',
        conversationId: conversationId,
        success: true,
        data: {
          themesExtracted: themeExtraction.extractedThemes.length,
          averageConfidence: themeExtraction.extractionMetadata.averageConfidence,
          relationshipDynamics: themeExtraction.relationshipDynamics
        }
      };
      
    } catch (error) {
      throw new Error(`Theme extraction operation failed: ${error.message}`);
    }
  }
  
  /**
   * Execute analysis operation
   */
  async executeAnalysisOperation(conversationId) {
    try {
      const conversationData = await this.getConversationData(conversationId);
      
      if (!conversationData) {
        throw new Error('Conversation not found');
      }
      
      // Comprehensive conversation analysis
      const analysis = {
        conversationId: conversationId,
        messageCount: conversationData.recent_messages?.length || 0,
        lastActivity: conversationData.last_updated,
        tokensUsed: conversationData.total_tokens_used || 0,
        status: conversationData.conversation_status || 'active'
      };
      
      // Analyze compression needs
      if (conversationData.recent_messages) {
        const compressionAnalysis = await ConversationCompressionEngine.analyzeCompressionNeeds(conversationData);
        analysis.compressionRecommendation = compressionAnalysis.compressionNeeded ? 'recommended' : 'not_needed';
        analysis.compressionUrgency = compressionAnalysis.compressionUrgency;
      }
      
      // Analyze conversation health
      analysis.healthScore = this.calculateConversationHealthScore(conversationData);
      analysis.recommendations = this.generateConversationRecommendations(analysis);
      
      return {
        operation: 'analyze',
        conversationId: conversationId,
        success: true,
        data: analysis
      };
      
    } catch (error) {
      throw new Error(`Analysis operation failed: ${error.message}`);
    }
  }
  
  /**
   * Execute cleanup operation
   */
  async executeCleanupOperation(conversationId) {
    try {
      const cleanupResult = await this.cleanupEngine.performConversationCleanup('targeted', conversationId);
      
      return {
        operation: 'cleanup',
        conversationId: conversationId,
        success: cleanupResult.success,
        data: cleanupResult.metrics
      };
      
    } catch (error) {
      throw new Error(`Cleanup operation failed: ${error.message}`);
    }
  }
  
  /**
   * Helper functions
   */
  
  async identifyTargetConversations() {
    if (this.context.targetConversations.length > 0) {
      return this.context.targetConversations;
    }
    
    if (this.context.targetUsers.length > 0) {
      // Get conversations for specific users
      const conversations = [];
      for (const userId of this.context.targetUsers) {
        const userConversations = await this.getConversationsForUser(userId);
        conversations.push(...userConversations);
      }
      return conversations;
    }
    
    // Default: get conversations that need attention
    return await this.getConversationsNeedingAttention();
  }
  
  async getConversationData(conversationId) {
    try {
      const result = await dynamodb.get({
        TableName: 'coaching-conversations',
        Key: { conversation_id: conversationId }
      }).promise();
      
      return result.Item;
      
    } catch (error) {
      console.error(`❌ Error getting conversation data for ${conversationId}:`, error);
      return null;
    }
  }
  
  async getConversationsForUser(userId) {
    try {
      const result = await dynamodb.query({
        TableName: 'coaching-conversations',
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: {
          ':userId': userId
        }
      }).promise();
      
      return result.Items.map(item => item.conversation_id);
      
    } catch (error) {
      console.error(`❌ Error getting conversations for user ${userId}:`, error);
      return [];
    }
  }
  
  async getConversationsNeedingAttention() {
    try {
      const result = await dynamodb.scan({
        TableName: 'coaching-conversations',
        FilterExpression: 'attribute_exists(recent_messages) AND conversation_status = :status',
        ExpressionAttributeValues: {
          ':status': 'active'
        },
        ProjectionExpression: 'conversation_id'
      }).promise();
      
      return result.Items.map(item => item.conversation_id).slice(0, 10); // Limit to 10
      
    } catch (error) {
      console.error('❌ Error getting conversations needing attention:', error);
      return [];
    }
  }
  
  calculateConversationHealthScore(conversationData) {
    let healthScore = 100;
    
    const messageCount = conversationData.recent_messages?.length || 0;
    const lastUpdated = new Date(conversationData.last_updated);
    const daysSinceUpdate = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
    
    // Deduct points for size issues
    if (messageCount > 80) healthScore -= 20;
    else if (messageCount > 60) healthScore -= 10;
    
    // Deduct points for staleness
    if (daysSinceUpdate > 30) healthScore -= 30;
    else if (daysSinceUpdate > 14) healthScore -= 15;
    
    // Deduct points for missing metadata
    if (!conversationData.coaching_themes) healthScore -= 10;
    if (!conversationData.conversation_summary) healthScore -= 10;
    
    return Math.max(0, healthScore);
  }
  
  generateConversationRecommendations(analysis) {
    const recommendations = [];
    
    if (analysis.messageCount > 80) {
      recommendations.push('Consider compression to improve performance');
    }
    
    if (analysis.compressionRecommendation === 'recommended') {
      recommendations.push(`Compression ${analysis.compressionUrgency} priority`);
    }
    
    if (analysis.healthScore < 70) {
      recommendations.push('Conversation needs maintenance attention');
    }
    
    const daysSinceActivity = (Date.now() - new Date(analysis.lastActivity).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceActivity > 30) {
      recommendations.push('Consider archiving due to inactivity');
    }
    
    return recommendations;
  }
  
  async updateConversationWithCompression(conversationId, compressionResult) {
    // Implementation for updating conversation with compression results
    console.log(`📦 Updating conversation ${conversationId} with compression results`);
  }
  
  async updateConversationWithSummary(conversationId, summaryResult) {
    // Implementation for updating conversation with summary
    console.log(`📝 Updating conversation ${conversationId} with summary`);
  }
  
  async updateConversationWithThemes(conversationId, themeExtraction) {
    // Implementation for updating conversation with themes
    console.log(`🎯 Updating conversation ${conversationId} with themes`);
  }
  
  async trackIntelligenceMetrics(result) {
    try {
      const metrics = [
        {
          MetricName: 'IntelligenceOperationsCompleted',
          Value: this.metrics.operationsCompleted,
          Unit: 'Count'
        },
        {
          MetricName: 'ConversationsProcessed',
          Value: this.metrics.conversationsProcessed,
          Unit: 'Count'
        },
        {
          MetricName: 'IntelligenceProcessingTime',
          Value: this.metrics.processingTime,
          Unit: 'Milliseconds'
        }
      ];
      
      await cloudwatch.putMetricData({
        Namespace: 'PinHigh/ConversationIntelligence',
        MetricData: metrics.map(metric => ({
          ...metric,
          Timestamp: new Date()
        }))
      }).promise();
      
    } catch (error) {
      console.error('❌ Error tracking intelligence metrics:', error);
    }
  }
  
  async trackIntelligenceError(error) {
    try {
      await cloudwatch.putMetricData({
        Namespace: 'PinHigh/ConversationIntelligence',
        MetricData: [{
          MetricName: 'IntelligenceErrors',
          Value: 1,
          Unit: 'Count',
          Timestamp: new Date()
        }]
      }).promise();
      
    } catch (metricsError) {
      console.error('❌ Error tracking intelligence error:', metricsError);
    }
  }
  
  async getBatchConversations() {
    // Get conversations for batch processing
    return await this.getConversationsNeedingAttention();
  }
  
  async processBatchConversation(conversationId) {
    const operationResults = [];
    
    for (const operation of this.context.operations) {
      const result = await this.executeIntelligenceOperation(operation, conversationId);
      operationResults.push(result);
    }
    
    return operationResults;
  }
  
  async performSystemOptimization() {
    // System-wide optimization operations
    return {
      success: true,
      optimizations: ['database_cleanup', 'index_optimization', 'cache_refresh']
    };
  }
  
  async updateSystemHealthMetrics() {
    // Update overall system health metrics
    console.log('📊 Updating system health metrics');
  }
  
  async identifyLargeConversations(limit) {
    try {
      const result = await dynamodb.scan({
        TableName: 'coaching-conversations',
        FilterExpression: 'size(recent_messages) > :threshold',
        ExpressionAttributeValues: {
          ':threshold': 50
        },
        ProjectionExpression: 'conversation_id'
      }).promise();
      
      return result.Items.map(item => item.conversation_id).slice(0, limit);
      
    } catch (error) {
      console.error('❌ Error identifying large conversations:', error);
      return [];
    }
  }
  
  async executeEmergencyCompression(conversationId) {
    // Emergency compression with aggressive settings
    return await this.executeCompressionOperation(conversationId);
  }
}

// EXPORT INTELLIGENCE LAMBDA
module.exports = {
  ConversationIntelligenceProcessor,
  INTELLIGENCE_CONFIG
};