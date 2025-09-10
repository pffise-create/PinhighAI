/**
 * Sprint 3B: Enhanced Follow-up API with Context Integration
 * 
 * This file contains the enhanced follow-up API integration that connects
 * the existing golf-ai-analysis Lambda with the new coaching conversations
 * system from Sprint 3A.
 */

// ENHANCED CHAT REQUEST HANDLER WITH COACHING CONTEXT INTEGRATION
async function handleEnhancedChatRequest(event, userContext) {
  try {
    console.log('🎯 Processing enhanced chat request with coaching context integration');
    
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { message, context, jobId, conversationHistory, coachingContext } = body;
    
    if (!message) {
      return createErrorResponse(400, 'Message is required');
    }
    
    // Extract userId for context linking
    const userId = userContext?.userId || body.userId || 'guest-user';
    console.log(`Chat request from user: ${userId}`);
    
    // ENHANCED RATE LIMITING with user context
    const rateLimitCheck = checkEnhancedRateLimit(userId, userContext);
    if (!rateLimitCheck.allowed) {
      return createRateLimitResponse(rateLimitCheck);
    }
    
    // STEP 1: Assemble coaching context from multiple sources
    const assembledContext = await assembleFollowUpContext({
      userId,
      jobId,
      existingContext: context,
      coachingContext,
      conversationHistory,
      userContext
    });
    
    // STEP 2: Build context-aware prompt with coaching integration
    const prompt = buildContextAwareFollowUpPrompt(message, assembledContext);
    
    // STEP 3: Call coaching chat API if available, fallback to direct GPT
    const response = await callContextAwareGPT(prompt, assembledContext);
    
    // STEP 4: Store conversation state for continuity
    await storeFollowUpConversationState(userId, message, response, assembledContext);
    
    // STEP 5: Track metrics and return response
    await trackFollowUpMetrics(userId, response);
    
    return createSuccessResponse(response);
    
  } catch (error) {
    console.error('❌ Error in enhanced chat request:', error);
    return createChatErrorResponse(error, body?.message);
  }
}

// ENHANCED RATE LIMITING WITH USER CONTEXT
function checkEnhancedRateLimit(userId, userContext) {
  const baseLimit = MAX_REQUESTS_PER_USER_PER_HOUR;
  
  // Enhanced limits for authenticated users
  let adjustedLimit = baseLimit;
  if (userContext?.isAuthenticated) {
    adjustedLimit = baseLimit * 2; // Double limit for authenticated users
  }
  
  const now = Date.now();
  const userKey = `enhanced_chat_${userId}`;
  
  // Clean old entries
  rateLimitStore.forEach((timestamps, key) => {
    const validTimestamps = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (validTimestamps.length === 0) {
      rateLimitStore.delete(key);
    } else {
      rateLimitStore.set(key, validTimestamps);
    }
  });
  
  const userRequests = rateLimitStore.get(userKey) || [];
  const recentRequests = userRequests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
  
  if (recentRequests.length >= adjustedLimit) {
    return {
      allowed: false,
      requestCount: recentRequests.length,
      limit: adjustedLimit,
      resetTime: Math.min(...recentRequests) + RATE_LIMIT_WINDOW_MS,
      userType: userContext?.userType || 'guest'
    };
  }
  
  // Add current request
  recentRequests.push(now);
  rateLimitStore.set(userKey, recentRequests);
  
  return {
    allowed: true,
    requestCount: recentRequests.length,
    remainingRequests: adjustedLimit - recentRequests.length,
    limit: adjustedLimit
  };
}

// ASSEMBLE COACHING CONTEXT FROM MULTIPLE SOURCES
async function assembleFollowUpContext(options) {
  const { userId, jobId, existingContext, coachingContext, conversationHistory, userContext } = options;
  
  console.log('📋 Assembling follow-up context from multiple sources...');
  
  const context = {
    userId,
    jobId,
    userContext,
    timestamp: new Date().toISOString()
  };
  
  try {
    // SOURCE 1: Current swing analysis context
    if (existingContext) {
      context.currentSwingAnalysis = existingContext;
      console.log('✅ Current swing analysis context loaded');
    }
    
    // SOURCE 2: Mobile app coaching context
    if (coachingContext) {
      context.mobileCoachingContext = coachingContext;
      console.log('✅ Mobile coaching context loaded');
    }
    
    // SOURCE 3: Recent conversation history
    if (conversationHistory && conversationHistory.length > 0) {
      context.recentConversationHistory = conversationHistory.slice(-10); // Last 10 messages
      console.log(`✅ Recent conversation history loaded (${conversationHistory.length} messages)`);
    }
    
    // SOURCE 4: Fetch coaching conversations from Sprint 3A system
    if (userContext?.isAuthenticated) {
      try {
        context.coachingConversations = await fetchCoachingConversationsFromAPI(userId);
        console.log('✅ Coaching conversations from Sprint 3A system loaded');
      } catch (error) {
        console.warn('⚠️ Could not fetch coaching conversations:', error.message);
        context.coachingConversations = null;
      }
    }
    
    // SOURCE 5: User coaching history from existing system
    if (userContext?.isAuthenticated) {
      try {
        context.userCoachingHistory = await fetchUserCoachingHistory(userId, jobId);
        console.log('✅ User coaching history loaded');
      } catch (error) {
        console.warn('⚠️ Could not fetch user coaching history:', error.message);
        context.userCoachingHistory = null;
      }
    }
    
    // SOURCE 6: Current swing analysis if jobId provided
    if (jobId) {
      try {
        context.currentSwingData = await getCurrentSwingAnalysis(jobId);
        console.log('✅ Current swing data loaded');
      } catch (error) {
        console.warn('⚠️ Could not fetch current swing analysis:', error.message);
        context.currentSwingData = null;
      }
    }
    
    console.log(`📋 Context assembly complete: ${Object.keys(context).length} sources integrated`);
    return context;
    
  } catch (error) {
    console.error('❌ Error assembling follow-up context:', error);
    
    // Return minimal context to allow conversation to continue
    return {
      userId,
      jobId,
      userContext,
      timestamp: new Date().toISOString(),
      error: 'Partial context due to assembly error'
    };
  }
}

// FETCH COACHING CONVERSATIONS FROM SPRINT 3A API
async function fetchCoachingConversationsFromAPI(userId) {
  try {
    console.log(`🔗 Fetching coaching conversations for user: ${userId}`);
    
    // Check if the coaching chat Lambda is available in the same region
    const lambda = getLambdaClient();
    
    const invokeParams = {
      FunctionName: 'golf-coaching-chat',
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        httpMethod: 'GET',
        path: '/context',
        queryStringParameters: {
          userId: userId,
          limit: '5'
        }
      })
    };
    
    const result = await lambda.send(new InvokeCommand(invokeParams));
    const response = JSON.parse(Buffer.from(result.Payload).toString());
    
    if (response.statusCode === 200) {
      const data = JSON.parse(response.body);
      return data.conversations || [];
    } else {
      console.warn('Coaching conversations API returned error:', response.statusCode);
      return null;
    }
    
  } catch (error) {
    console.warn('Could not fetch coaching conversations from API:', error.message);
    
    // Fallback: Try to fetch directly from DynamoDB
    try {
      const dynamodb = getDynamoClient();
      const conversationId = `conv_${userId}`;
      
      const params = {
        TableName: 'coaching-conversations',
        Key: { conversation_id: conversationId }
      };
      
      const result = await dynamodb.send(new GetCommand(params));
      
      if (result.Item) {
        return [{
          conversation_id: result.Item.conversation_id,
          recent_messages: result.Item.recent_messages || [],
          coaching_themes: result.Item.coaching_themes || {},
          last_updated: result.Item.last_updated
        }];
      }
      
    } catch (fallbackError) {
      console.warn('Fallback coaching conversations fetch failed:', fallbackError.message);
    }
    
    return null;
  }
}

// GET CURRENT SWING ANALYSIS DATA
async function getCurrentSwingAnalysis(jobId) {
  try {
    const dynamodb = getDynamoClient();
    
    const params = {
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: jobId }
    };
    
    const result = await dynamodb.send(new GetCommand(params));
    
    if (result.Item) {
      return {
        analysis_id: result.Item.analysis_id,
        ai_analysis: result.Item.ai_analysis,
        ai_analysis_completed: result.Item.ai_analysis_completed,
        status: result.Item.status,
        created_at: result.Item.created_at,
        user_context: {
          handicap: result.Item.user_handicap,
          club_used: result.Item.club_used,
          shot_type: result.Item.shot_type,
          user_question: result.Item.user_question
        }
      };
    }
    
    return null;
    
  } catch (error) {
    console.error('Error fetching current swing analysis:', error);
    return null;
  }
}

// BUILD CONTEXT-AWARE FOLLOW-UP PROMPT
function buildContextAwareFollowUpPrompt(message, assembledContext) {
  const { userId, userContext, currentSwingAnalysis, coachingConversations, userCoachingHistory, currentSwingData } = assembledContext;
  
  // Build system prompt with integrated context
  let systemPrompt = `You are a warm, encouraging PGA golf instructor providing follow-up coaching through Pin High's integrated coaching system.`;
  
  // Add user relationship context
  if (userContext?.isAuthenticated) {
    systemPrompt += `\n\nCOACHING RELATIONSHIP CONTEXT:`;
    systemPrompt += `\n- This is an authenticated user with ongoing coaching relationship`;
    systemPrompt += `\n- User: ${userContext.name || userContext.email}`;
    
    // Add coaching history context
    if (userCoachingHistory && userCoachingHistory.sessionCount > 0) {
      systemPrompt += `\n- Previous sessions: ${userCoachingHistory.sessionCount}`;
      systemPrompt += `\n- Current focus areas: ${userCoachingHistory.focusAreas.map(f => f.focus).join(', ')}`;
      
      if (userCoachingHistory.lastSessionDate) {
        const daysSince = Math.floor((Date.now() - new Date(userCoachingHistory.lastSessionDate).getTime()) / (1000 * 60 * 60 * 24));
        systemPrompt += `\n- Last session: ${daysSince} days ago`;
      }
    }
    
    // Add coaching conversations context
    if (coachingConversations && coachingConversations.length > 0) {
      const recentConversation = coachingConversations[0];
      if (recentConversation.recent_messages && recentConversation.recent_messages.length > 0) {
        systemPrompt += `\n- Recent coaching discussions available`;
        systemPrompt += `\n- Last interaction: ${recentConversation.last_updated}`;
      }
    }
  } else {
    systemPrompt += `\n\nGUEST COACHING SESSION:`;
    systemPrompt += `\n- Provide excellent coaching experience`;
    systemPrompt += `\n- Focus on immediate actionable improvements`;
  }
  
  // Add current swing context
  if (currentSwingData && currentSwingData.ai_analysis) {
    systemPrompt += `\n\nCURRENT SWING ANALYSIS CONTEXT:`;
    
    if (typeof currentSwingData.ai_analysis === 'object') {
      const analysis = currentSwingData.ai_analysis;
      systemPrompt += `\n- Root cause: ${analysis.root_cause || 'General improvement'}`;
      systemPrompt += `\n- Confidence: ${analysis.confidence_score || 'N/A'}/100`;
      
      if (analysis.symptoms_detected && analysis.symptoms_detected.length > 0) {
        systemPrompt += `\n- Key symptoms: ${analysis.symptoms_detected.join(', ')}`;
      }
      
      if (analysis.practice_recommendations && analysis.practice_recommendations.length > 0) {
        systemPrompt += `\n- Current focus: ${analysis.practice_recommendations.slice(0, 2).join(', ')}`;
      }
    }
  }
  
  // Add response guidelines
  systemPrompt += `\n\nRESPONSE GUIDELINES:`;
  systemPrompt += `\n- Reference our coaching relationship naturally when context available`;
  systemPrompt += `\n- Connect current question to swing analysis and coaching history`;
  systemPrompt += `\n- Provide specific, actionable advice`;
  systemPrompt += `\n- Use encouraging, supportive coaching tone`;
  systemPrompt += `\n- Ask follow-up questions to deepen understanding`;
  systemPrompt += `\n- Keep responses under 250 words for mobile users`;
  
  // Build conversation messages
  const messages = [
    { role: 'system', content: systemPrompt }
  ];
  
  // Add recent conversation history for context
  if (assembledContext.recentConversationHistory) {
    assembledContext.recentConversationHistory.slice(-6).forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    });
  }
  
  // Add coaching conversations context if available
  if (coachingConversations && coachingConversations[0]?.recent_messages) {
    const recentMessages = coachingConversations[0].recent_messages.slice(-4);
    recentMessages.forEach(msg => {
      messages.push({
        role: msg.role === 'coach' ? 'assistant' : 'user',
        content: msg.content
      });
    });
  }
  
  // Add current user message
  messages.push({
    role: 'user',
    content: message
  });
  
  return { messages, systemPrompt };
}

// CALL CONTEXT-AWARE GPT WITH INTEGRATED COACHING
async function callContextAwareGPT(prompt, assembledContext) {
  try {
    console.log('🤖 Calling context-aware GPT with integrated coaching context');
    
    const requestData = JSON.stringify({
      model: "gpt-4o",
      messages: prompt.messages,
      max_tokens: 400,
      temperature: 0.8,
      user: assembledContext.userId // For OpenAI usage tracking
    });
    
    const response = await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestData)
      }
    }, requestData);
    
    const responseData = JSON.parse(response);
    
    if (responseData.error) {
      throw new Error(`OpenAI API error: ${responseData.error.message}`);
    }
    
    const chatResponse = responseData.choices[0].message.content;
    
    return {
      text: chatResponse,
      tokensUsed: responseData.usage?.total_tokens || 0,
      model: responseData.model,
      timestamp: new Date().toISOString(),
      contextSources: Object.keys(assembledContext).filter(key => assembledContext[key] !== null && assembledContext[key] !== undefined).length
    };
    
  } catch (error) {
    console.error('❌ Error calling context-aware GPT:', error);
    throw error;
  }
}

// STORE FOLLOW-UP CONVERSATION STATE
async function storeFollowUpConversationState(userId, userMessage, response, assembledContext) {
  try {
    console.log('💾 Storing follow-up conversation state with coaching integration');
    
    // Store in both systems for full integration
    
    // 1. Store in existing conversation tracking (if jobId available)
    if (assembledContext.jobId) {
      await storeInExistingSystem(assembledContext.jobId, userMessage, response);
    }
    
    // 2. Store in coaching conversations system (Sprint 3A) if user is authenticated
    if (assembledContext.userContext?.isAuthenticated) {
      await storeInCoachingSystem(userId, userMessage, response, assembledContext);
    }
    
    console.log('✅ Conversation state stored in integrated systems');
    
  } catch (error) {
    console.error('❌ Error storing follow-up conversation state:', error);
    // Don't throw - conversation should continue even if storage fails
  }
}

// STORE IN EXISTING CONVERSATION SYSTEM
async function storeInExistingSystem(jobId, userMessage, response) {
  try {
    const dynamodb = getDynamoClient();
    
    const conversationEntry = {
      timestamp: new Date().toISOString(),
      user_message: userMessage,
      ai_response: response.text,
      tokens_used: response.tokensUsed || 0,
      context_sources: response.contextSources || 0
    };
    
    // Update the analysis record with conversation history
    const params = {
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: jobId },
      UpdateExpression: 'SET follow_up_conversations = list_append(if_not_exists(follow_up_conversations, :empty_list), :new_conversation), updated_at = :timestamp',
      ExpressionAttributeValues: {
        ':new_conversation': [conversationEntry],
        ':empty_list': [],
        ':timestamp': new Date().toISOString()
      }
    };
    
    await dynamodb.send(new UpdateCommand(params));
    console.log('✅ Stored in existing analysis system');
    
  } catch (error) {
    console.error('❌ Error storing in existing system:', error);
  }
}

// STORE IN COACHING CONVERSATIONS SYSTEM (SPRINT 3A)
async function storeInCoachingSystem(userId, userMessage, response, assembledContext) {
  try {
    console.log('🔗 Storing in Sprint 3A coaching conversations system');
    
    // Try to call the coaching chat Lambda to store the conversation
    const lambda = getLambdaClient();
    
    const storePayload = {
      httpMethod: 'POST',
      path: '/store-conversation',
      body: JSON.stringify({
        userId: userId,
        userMessage: userMessage,
        assistantResponse: response.text,
        messageType: 'follow_up',
        swingReference: assembledContext.jobId,
        tokensUsed: response.tokensUsed || 0,
        contextSources: response.contextSources || 0,
        timestamp: response.timestamp
      })
    };
    
    const invokeParams = {
      FunctionName: 'golf-coaching-chat',
      InvocationType: 'Event', // Async invoke
      Payload: JSON.stringify(storePayload)
    };
    
    await lambda.send(new InvokeCommand(invokeParams));
    console.log('✅ Async storage request sent to coaching system');
    
  } catch (error) {
    console.warn('⚠️ Could not store in coaching system, using fallback:', error.message);
    
    // Fallback: Store directly in DynamoDB
    try {
      await storeDirectlyInCoachingTable(userId, userMessage, response, assembledContext);
    } catch (fallbackError) {
      console.error('❌ Fallback storage also failed:', fallbackError.message);
    }
  }
}

// FALLBACK: STORE DIRECTLY IN COACHING CONVERSATIONS TABLE
async function storeDirectlyInCoachingTable(userId, userMessage, response, assembledContext) {
  try {
    const dynamodb = getDynamoClient();
    const conversationId = `conv_${userId}`;
    const timestamp = new Date().toISOString();
    
    const userMessageObj = {
      message_id: `msg_${Date.now()}_user`,
      role: 'user',
      content: userMessage,
      timestamp,
      swing_reference: assembledContext.jobId || null,
      message_type: 'follow_up',
      tokens_used: 0
    };
    
    const assistantMessageObj = {
      message_id: `msg_${Date.now()}_assistant`,
      role: 'assistant',
      content: response.text,
      timestamp,
      swing_reference: assembledContext.jobId || null,
      message_type: 'follow_up',
      tokens_used: response.tokensUsed || 0
    };
    
    const params = {
      TableName: 'coaching-conversations',
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
        ':newMessages': [userMessageObj, assistantMessageObj],
        ':emptyList': [],
        ':tokensUsed': response.tokensUsed || 0,
        ':zero': 0,
        ':status': 'active'
      }
    };
    
    await dynamodb.send(new UpdateCommand(params));
    console.log('✅ Fallback storage in coaching table successful');
    
  } catch (error) {
    console.error('❌ Direct coaching table storage failed:', error);
    throw error;
  }
}

// TRACK FOLLOW-UP METRICS
async function trackFollowUpMetrics(userId, response) {
  try {
    // Send metrics to CloudWatch
    await sendCloudWatchMetrics('FollowUpConversations', 1, 'Count', userId);
    await sendCloudWatchMetrics('FollowUpTokensUsed', response.tokensUsed || 0, 'Count', userId);
    await sendCloudWatchMetrics('FollowUpContextSources', response.contextSources || 0, 'Count', userId);
    
    console.log('📊 Follow-up metrics tracked successfully');
    
  } catch (error) {
    console.error('❌ Error tracking follow-up metrics:', error);
    // Don't throw - metrics failure shouldn't affect user experience
  }
}

// HELPER FUNCTIONS FOR RESPONSE CREATION
function createErrorResponse(statusCode, message) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      error: message,
      success: false,
      timestamp: new Date().toISOString()
    })
  };
}

function createRateLimitResponse(rateLimitCheck) {
  const resetTime = new Date(rateLimitCheck.resetTime);
  return {
    statusCode: 429,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      error: 'Rate limit exceeded',
      message: `You've reached your ${rateLimitCheck.userType} limit of ${rateLimitCheck.limit} requests per hour. Please try again at ${resetTime.toLocaleTimeString()}.`,
      resetTime: rateLimitCheck.resetTime,
      requestCount: rateLimitCheck.requestCount,
      limit: rateLimitCheck.limit,
      success: false
    })
  };
}

function createSuccessResponse(response) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      response: response.text,
      message: response.text, // Fallback for app compatibility
      tokensUsed: response.tokensUsed,
      contextSources: response.contextSources,
      timestamp: response.timestamp,
      success: true
    })
  };
}

function createChatErrorResponse(error, userMessage) {
  console.error('Chat error details:', error);
  
  // Provide contextual fallback responses
  const fallbackResponse = getEnhancedFallbackResponse(userMessage, error);
  
  return {
    statusCode: 200, // Return 200 to avoid app errors
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      response: fallbackResponse,
      message: fallbackResponse,
      success: true,
      fallback: true,
      error_handled: true
    })
  };
}

function getEnhancedFallbackResponse(userMessage, error) {
  const lowerMessage = (userMessage || '').toLowerCase();
  
  // Provide contextual responses based on error type
  if (error.message.includes('Rate limit') || error.message.includes('Too Many Requests')) {
    return "I'm getting a lot of requests right now! Give me a moment and then ask your golf question again. I'm here to help with your swing technique.";
  }
  
  if (error.message.includes('timeout') || error.message.includes('network')) {
    return "I'm having a brief connection issue, but I'm still here! Ask me about any specific part of your golf swing - setup, backswing, impact, or follow-through - and I'll help you improve.";
  }
  
  // Content-based fallback responses
  if (lowerMessage.includes('drill') || lowerMessage.includes('practice')) {
    return "For effective practice, try these fundamentals: slow controlled swings first, mirror work for posture, alignment stick drills for swing path, and impact bag work for solid contact. What specific area of your swing would you like to focus on?";
  }
  
  if (lowerMessage.includes('impact') || lowerMessage.includes('contact')) {
    return "Great impact position has weight shifted forward, hands slightly ahead of the ball, hips open to target, and square clubface. Focus on the feel of 'trapping' the ball against the ground. What does your ball flight tell you about your current impact?";
  }
  
  if (lowerMessage.includes('slice') || lowerMessage.includes('fade')) {
    return "Slices often come from an open clubface or out-to-in swing path. Check your grip first - can you see 2-3 knuckles on your lead hand? Then work on swinging more from the inside. What direction does your ball typically start?";
  }
  
  if (lowerMessage.includes('hook') || lowerMessage.includes('draw')) {
    return "Hooks usually result from a closed clubface or very inside swing path. Try weakening your grip slightly and feeling like you're swinging the club more 'around' your body rather than up and down. How's your ball position?";
  }
  
  return "I'm here to help with your golf improvement! While I had a brief technical hiccup, I can still discuss swing mechanics, drills, course strategy, or any golf questions you have. What specific part of your game would you like to work on?";
}

// EXPORT FUNCTIONS FOR INTEGRATION
module.exports = {
  handleEnhancedChatRequest,
  assembleFollowUpContext,
  buildContextAwareFollowUpPrompt,
  callContextAwareGPT,
  storeFollowUpConversationState,
  fetchCoachingConversationsFromAPI,
  getCurrentSwingAnalysis,
  checkEnhancedRateLimit,
  trackFollowUpMetrics
};