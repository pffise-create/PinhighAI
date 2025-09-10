/**
 * Pin High Coaching Chat Lambda Function
 * Sprint 3A: Context-Aware Chat API & DynamoDB Table with Security
 * 
 * Provides intelligent coaching conversations with context awareness,
 * cost controls, security, and conversation state management.
 */

const AWS = require('aws-sdk');
const https = require('https');

// Initialize AWS services
const dynamodb = new AWS.DynamoDB.DocumentClient();
const cloudwatch = new AWS.CloudWatch();

// Configuration
const CONFIG = {
  TABLES: {
    COACHING_CONVERSATIONS: 'coaching-conversations',
    GOLF_ANALYSES: 'golf-coach-analyses'
  },
  LIMITS: {
    MAX_TOKENS_PER_REQUEST: 1500,
    RATE_LIMIT_PER_HOUR: 15,
    DAILY_COST_LIMIT_PER_USER: 5,
    TOTAL_DAILY_COST_LIMIT: 100,
    MAX_REQUEST_SIZE: 10240, // 10KB
    MAX_MESSAGE_LENGTH: 1000
  },
  OPENAI: {
    MODEL: 'gpt-4o',
    MAX_TOKENS: 800,
    TEMPERATURE: 0.7
  }
};

/**
 * Main Lambda handler
 */
exports.handler = async (event) => {
  console.log('🎯 Pin High Coaching Chat request received:', JSON.stringify(event, null, 2));
  
  try {
    // Start performance tracking
    const startTime = Date.now();
    
    // 1. Validate and parse request
    const request = await validateRequest(event);
    console.log('✅ Request validated:', request.userId);
    
    // 2. Check rate limits and cost controls
    await checkUserLimits(request.userId);
    console.log('✅ Rate limits checked for user:', request.userId);
    
    // 3. Assemble coaching context
    const context = await assembleCoachingContext(request);
    console.log('✅ Coaching context assembled:', context.conversationId);
    
    // 4. Call GPT-4o with context-aware prompt
    const response = await callGPTWithCoachingContext(context, request);
    console.log('✅ GPT response received');
    
    // 5. Store conversation state
    await storeConversationState(request.userId, request, response);
    console.log('✅ Conversation state stored');
    
    // 6. Track metrics
    const processingTime = Date.now() - startTime;
    await trackMetrics(request.userId, response, processingTime);
    
    // 7. Return coaching response
    return formatCoachingResponse(response);
    
  } catch (error) {
    console.error('❌ Coaching chat error:', error);
    return handleCoachingError(error);
  }
};

/**
 * Validate incoming request
 */
async function validateRequest(event) {
  try {
    // Check request size
    const requestSize = JSON.stringify(event).length;
    if (requestSize > CONFIG.LIMITS.MAX_REQUEST_SIZE) {
      throw new Error('Request too large');
    }
    
    // Parse body
    const body = event.body ? JSON.parse(event.body) : event;
    
    // Validate required fields
    if (!body.message || typeof body.message !== 'string') {
      throw new Error('Invalid message format');
    }
    
    if (body.message.length > CONFIG.LIMITS.MAX_MESSAGE_LENGTH) {
      throw new Error('Message too long');
    }
    
    // Extract user ID from various sources
    let userId = body.userId;
    if (!userId && event.requestContext?.authorizer?.claims?.email) {
      userId = event.requestContext.authorizer.claims.email;
    }
    if (!userId && body.coachingContext?.sessionMetadata?.userId) {
      userId = body.coachingContext.sessionMetadata.userId;
    }
    
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid or missing user ID');
    }
    
    // Sanitize inputs
    return {
      message: sanitizeInput(body.message),
      userId: sanitizeInput(userId),
      context: body.context || {},
      coachingContext: body.coachingContext || null,
      conversationHistory: body.conversationHistory || [],
      messageType: body.messageType || 'general_coaching',
      jobId: body.jobId || null
    };
    
  } catch (error) {
    console.error('Request validation error:', error);
    throw new Error(`Invalid request: ${error.message}`);
  }
}

/**
 * Sanitize user input
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  return input
    .trim()
    .replace(/[<>\"'&]/g, '') // Remove potentially dangerous characters
    .substring(0, CONFIG.LIMITS.MAX_MESSAGE_LENGTH);
}

/**
 * Check rate limits and cost controls
 */
async function checkUserLimits(userId) {
  try {
    // Check hourly rate limit
    const hourlyRequests = await getHourlyRequestCount(userId);
    if (hourlyRequests >= CONFIG.LIMITS.RATE_LIMIT_PER_HOUR) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }
    
    // Check daily cost limit per user
    const dailyCost = await getDailyCost(userId);
    if (dailyCost >= CONFIG.LIMITS.DAILY_COST_LIMIT_PER_USER) {
      throw new Error('Daily usage limit reached. Premium users get higher limits.');
    }
    
    // Check total system cost
    const totalCost = await getTotalDailyCost();
    if (totalCost >= CONFIG.LIMITS.TOTAL_DAILY_COST_LIMIT) {
      throw new Error('System at capacity. Please try again later.');
    }
    
  } catch (error) {
    console.error('Rate limit check error:', error);
    throw error;
  }
}

/**
 * Get hourly request count for user
 */
async function getHourlyRequestCount(userId) {
  try {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const params = {
      TableName: CONFIG.TABLES.COACHING_CONVERSATIONS,
      IndexName: 'user-index',
      KeyConditionExpression: 'user_id = :userId AND last_updated > :hourAgo',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':hourAgo': hourAgo
      },
      Select: 'COUNT'
    };
    
    const result = await dynamodb.query(params).promise();
    return result.Count || 0;
    
  } catch (error) {
    console.error('Error getting hourly request count:', error);
    return 0; // Allow request if we can't check
  }
}

/**
 * Get daily cost for user (simplified)
 */
async function getDailyCost(userId) {
  try {
    // In a real implementation, this would track actual OpenAI API costs
    // For now, we'll estimate based on request count
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const params = {
      TableName: CONFIG.TABLES.COACHING_CONVERSATIONS,
      IndexName: 'user-index',
      KeyConditionExpression: 'user_id = :userId AND last_updated > :todayStart',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':todayStart': todayStart.toISOString()
      },
      Select: 'COUNT'
    };
    
    const result = await dynamodb.query(params).promise();
    const requestCount = result.Count || 0;
    
    // Estimate $0.10 per request (rough estimate for GPT-4o usage)
    return requestCount * 0.10;
    
  } catch (error) {
    console.error('Error getting daily cost:', error);
    return 0; // Allow request if we can't check
  }
}

/**
 * Get total daily cost across all users
 */
async function getTotalDailyCost() {
  try {
    // This would require a separate tracking system in production
    // For now, return 0 to allow requests
    return 0;
  } catch (error) {
    console.error('Error getting total daily cost:', error);
    return 0;
  }
}

/**
 * Assemble coaching context for the request
 */
async function assembleCoachingContext(request) {
  try {
    const conversationId = `conv_${request.userId}`;
    
    // Get existing conversation
    const existingConversation = await getConversationHistory(conversationId);
    
    // Get recent swing analyses if available
    const recentSwings = await getRecentSwingAnalyses(request.userId, 5);
    
    // Get user profile data
    const userProfile = await getUserProfile(request.userId);
    
    const context = {
      conversationId,
      userId: request.userId,
      currentMessage: request.message,
      messageType: request.messageType,
      existingConversation,
      recentSwings,
      userProfile,
      passedCoachingContext: request.coachingContext,
      swingReference: request.jobId
    };
    
    return context;
    
  } catch (error) {
    console.error('Error assembling coaching context:', error);
    // Return minimal context to allow conversation to continue
    return {
      conversationId: `conv_${request.userId}`,
      userId: request.userId,
      currentMessage: request.message,
      messageType: request.messageType || 'general_coaching'
    };
  }
}

/**
 * Get conversation history from DynamoDB
 */
async function getConversationHistory(conversationId) {
  try {
    const params = {
      TableName: CONFIG.TABLES.COACHING_CONVERSATIONS,
      Key: { conversation_id: conversationId }
    };
    
    const result = await dynamodb.get(params).promise();
    return result.Item || null;
    
  } catch (error) {
    console.error('Error getting conversation history:', error);
    return null;
  }
}

/**
 * Get recent swing analyses for user
 */
async function getRecentSwingAnalyses(userId, limit = 5) {
  try {
    const params = {
      TableName: CONFIG.TABLES.GOLF_ANALYSES,
      IndexName: 'user-index', // Assuming this index exists
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      ScanIndexForward: false, // Get most recent first
      Limit: limit
    };
    
    const result = await dynamodb.query(params).promise();
    return result.Items || [];
    
  } catch (error) {
    console.error('Error getting recent swing analyses:', error);
    return [];
  }
}

/**
 * Get user profile information
 */
async function getUserProfile(userId) {
  try {
    // In a real implementation, this would query a user profile table
    // For now, return basic profile
    return {
      userId,
      joinDate: new Date().toISOString(),
      preferences: {},
      goals: []
    };
    
  } catch (error) {
    console.error('Error getting user profile:', error);
    return { userId };
  }
}

/**
 * Call GPT-4o with coaching context
 */
async function callGPTWithCoachingContext(context, request) {
  try {
    const prompt = buildCoachingPrompt(context, request);
    
    const requestBody = {
      model: CONFIG.OPENAI.MODEL,
      messages: prompt.messages,
      max_tokens: CONFIG.OPENAI.MAX_TOKENS,
      temperature: CONFIG.OPENAI.TEMPERATURE,
      user: context.userId // For OpenAI usage tracking
    };
    
    console.log('🤖 Calling OpenAI with coaching context');
    
    const response = await callOpenAI(requestBody);
    
    return {
      text: response.choices[0].message.content,
      tokensUsed: response.usage.total_tokens,
      model: response.model,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('GPT call error:', error);
    throw new Error('Failed to generate coaching response');
  }
}

/**
 * Build coaching-aware prompt
 */
function buildCoachingPrompt(context, request) {
  const systemPrompt = buildSystemPrompt(context);
  const conversationHistory = buildConversationHistory(context, request);
  const currentMessage = request.message;
  
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: currentMessage }
  ];
  
  return { messages };
}

/**
 * Build system prompt with coaching context
 */
function buildSystemPrompt(context) {
  let systemPrompt = `You are an expert golf coach AI for Pin High, providing personalized coaching through ongoing conversations.`;
  
  // Add coaching relationship context
  if (context.existingConversation) {
    const sessionCount = context.existingConversation.coaching_themes?.session_count || 1;
    const primaryFocus = context.existingConversation.coaching_themes?.primary_focus;
    
    systemPrompt += `\n\nCOACHING RELATIONSHIP CONTEXT:`;
    systemPrompt += `\n- This is session ${sessionCount} with this golfer`;
    
    if (primaryFocus) {
      systemPrompt += `\n- Current focus area: ${primaryFocus.replace(/_/g, ' ')}`;
    }
    
    if (context.existingConversation.coaching_themes?.recent_improvements) {
      systemPrompt += `\n- Recent improvements: ${context.existingConversation.coaching_themes.recent_improvements.join(', ')}`;
    }
  }
  
  // Add swing context if available
  if (context.swingReference && context.recentSwings.length > 0) {
    const currentSwing = context.recentSwings.find(s => s.analysis_id === context.swingReference);
    if (currentSwing) {
      systemPrompt += `\n\nCURRENT SWING ANALYSIS CONTEXT:`;
      systemPrompt += `\n- Overall Score: ${currentSwing.ai_analysis?.overall_score || 'N/A'}/10`;
      systemPrompt += `\n- Key Areas: ${currentSwing.ai_analysis?.symptoms_detected?.join(', ') || 'General technique'}`;
    }
  }
  
  systemPrompt += `\n\nRESPONSE GUIDELINES:`;
  systemPrompt += `\n- Maintain warm, encouraging coaching tone`;
  systemPrompt += `\n- Reference our coaching relationship naturally`;
  systemPrompt += `\n- Provide specific, actionable advice`;
  systemPrompt += `\n- Ask follow-up questions to deepen understanding`;
  systemPrompt += `\n- Celebrate progress and improvements`;
  systemPrompt += `\n- Keep responses under 200 words for mobile users`;
  
  return systemPrompt;
}

/**
 * Build conversation history for context
 */
function buildConversationHistory(context, request) {
  const history = [];
  
  // Add recent conversation messages
  if (context.existingConversation?.recent_messages) {
    const recentMessages = context.existingConversation.recent_messages.slice(-10);
    
    recentMessages.forEach(msg => {
      history.push({
        role: msg.role === 'coach' ? 'assistant' : 'user',
        content: msg.content
      });
    });
  }
  
  // Add conversation history from request (for immediate context)
  if (request.conversationHistory) {
    request.conversationHistory.slice(-5).forEach(msg => {
      history.push({
        role: msg.role,
        content: msg.content
      });
    });
  }
  
  return history;
}

/**
 * Call OpenAI API
 */
async function callOpenAI(requestBody) {
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
 * Store conversation state in DynamoDB
 */
async function storeConversationState(userId, request, response) {
  try {
    const conversationId = `conv_${userId}`;
    const timestamp = new Date().toISOString();
    
    // Create message objects
    const userMessage = {
      message_id: `msg_${Date.now()}_user`,
      role: 'user',
      content: request.message,
      timestamp,
      swing_reference: request.jobId || null,
      tokens_used: 0
    };
    
    const assistantMessage = {
      message_id: `msg_${Date.now()}_assistant`,
      role: 'assistant',
      content: response.text,
      timestamp,
      swing_reference: request.jobId || null,
      tokens_used: response.tokensUsed || 0
    };
    
    // Update or create conversation record
    const params = {
      TableName: CONFIG.TABLES.COACHING_CONVERSATIONS,
      Key: { conversation_id: conversationId },
      UpdateExpression: `
        SET 
          user_id = :userId,
          last_updated = :timestamp,
          recent_messages = list_append(if_not_exists(recent_messages, :emptyList), :newMessages),
          total_tokens_used = if_not_exists(total_tokens_used, :zero) + :tokensUsed,
          conversation_status = :status
      `,
      ExpressionAttributeValues: {
        ':userId': userId,
        ':timestamp': timestamp,
        ':newMessages': [userMessage, assistantMessage],
        ':emptyList': [],
        ':tokensUsed': response.tokensUsed || 0,
        ':zero': 0,
        ':status': 'active'
      }
    };
    
    await dynamodb.update(params).promise();
    console.log('✅ Conversation state stored successfully');
    
  } catch (error) {
    console.error('Error storing conversation state:', error);
    // Don't throw - conversation should continue even if storage fails
  }
}

/**
 * Track metrics in CloudWatch
 */
async function trackMetrics(userId, response, processingTime) {
  try {
    const metrics = [
      {
        MetricName: 'ConversationRequests',
        Value: 1,
        Unit: 'Count'
      },
      {
        MetricName: 'TokensUsed',
        Value: response.tokensUsed || 0,
        Unit: 'Count'
      },
      {
        MetricName: 'ResponseTime',
        Value: processingTime,
        Unit: 'Milliseconds'
      }
    ];
    
    const params = {
      Namespace: 'PinHigh/CoachingChat',
      MetricData: metrics.map(metric => ({
        ...metric,
        Dimensions: [
          {
            Name: 'Service',
            Value: 'CoachingChat'
          }
        ],
        Timestamp: new Date()
      }))
    };
    
    await cloudwatch.putMetricData(params).promise();
    
  } catch (error) {
    console.error('Error tracking metrics:', error);
    // Don't throw - metrics failure shouldn't affect user
  }
}

/**
 * Format successful coaching response
 */
function formatCoachingResponse(response) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'OPTIONS,POST'
    },
    body: JSON.stringify({
      response: response.text,
      tokensUsed: response.tokensUsed,
      timestamp: response.timestamp,
      success: true
    })
  };
}

/**
 * Handle coaching errors with user-friendly responses
 */
function handleCoachingError(error) {
  console.error('Coaching error details:', error);
  
  let statusCode = 500;
  let errorMessage = 'I\'m having trouble connecting right now. Please try again in a moment.';
  
  if (error.message.includes('Rate limit exceeded')) {
    statusCode = 429;
    errorMessage = 'You\'ve reached your hourly limit. Please try again later, or consider upgrading for higher limits.';
  } else if (error.message.includes('Daily usage limit')) {
    statusCode = 429;
    errorMessage = 'You\'ve reached your daily usage limit. Premium users get higher limits.';
  } else if (error.message.includes('System at capacity')) {
    statusCode = 503;
    errorMessage = 'Our coaching system is at capacity. Please try again in a few minutes.';
  } else if (error.message.includes('Invalid request')) {
    statusCode = 400;
    errorMessage = 'I didn\'t understand that request. Could you please rephrase your question?';
  }
  
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'OPTIONS,POST'
    },
    body: JSON.stringify({
      error: errorMessage,
      success: false,
      timestamp: new Date().toISOString()
    })
  };
}