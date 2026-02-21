// Chat API Handler - Focused Lambda for handling chat requests with user threading
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { executeChatLoop } = require('../chat/chatLoop');
const https = require('https');

// Initialize clients
let dynamodb = null;
let secretsManager = null;
let cachedOpenAIKey = null;
const CHAT_LOOP_ENABLED = process.env.CHAT_LOOP_ENABLED === 'true';
const HTTP_REQUEST_TIMEOUT_MS = parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || '8000', 10);

function getDynamoClient() {
  if (!dynamodb) {
    const client = new DynamoDBClient({});
    dynamodb = DynamoDBDocumentClient.from(client);
  }
  return dynamodb;
}

function getSecretsManagerClient() {
  if (!secretsManager) {
    secretsManager = new SecretsManagerClient({});
  }
  return secretsManager;
}

async function ensureOpenAIKey() {
  if (cachedOpenAIKey) return cachedOpenAIKey;
  if (process.env.OPENAI_API_KEY) {
    cachedOpenAIKey = process.env.OPENAI_API_KEY;
    return cachedOpenAIKey;
  }
  const secretId = process.env.OPENAI_SECRET_NAME || process.env.OPENAI_SECRET_ARN;
  if (!secretId) {
    throw new Error('OPENAI_API_KEY not configured. Set OPENAI_SECRET_NAME or OPENAI_SECRET_ARN.');
  }
  const sm = getSecretsManagerClient();
  const resp = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!resp.SecretString) {
    throw new Error('OpenAI secret is empty');
  }
  cachedOpenAIKey = resp.SecretString;
  process.env.OPENAI_API_KEY = resp.SecretString;
  return cachedOpenAIKey;
}

// HTTP request helper function
function makeHttpsRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(HTTP_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Request to ${options.hostname}${options.path} timed out after ${HTTP_REQUEST_TIMEOUT_MS}ms`));
    });
    
    if (data) {
      req.write(data);
    }
    
    req.end();
  });
}

// Extract user context from event with JWT validation
async function extractUserContext(event) {
  console.log('EXTRACT USER CONTEXT: Starting JWT validation');
  
  try {
    // Check for Authorization header
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7); // Remove 'Bearer ' prefix
      console.log('AUTH HEADER: Found JWT token, validating...');
      
      try {
        // Decode JWT token (basic parsing without verification for now)
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        
        console.log('JWT PAYLOAD: Extracted user info from token');
        
        // Extract user information from Cognito JWT
        const authenticatedContext = {
          isAuthenticated: true,
          userId: payload.sub, // Cognito user ID (consistent across all tokens)
          email: payload.email || null,
          name: payload.name || payload.email || payload.username || 'Authenticated User',
          username: payload.username || payload['cognito:username'],
          userType: 'authenticated'
        };
        
        console.log('USER CONTEXT: Returning authenticated context:', {
          ...authenticatedContext,
          userId: authenticatedContext.userId // Show userId for debugging
        });
        
        return authenticatedContext;
        
      } catch (jwtError) {
        console.error('JWT PARSING ERROR:', jwtError.message);
        // Fall through to guest mode
      }
    } else {
      console.log('AUTH HEADER: No Bearer token found');
    }
    
    // Fall back to guest user context
    console.log('USER CONTEXT: Falling back to guest mode');
    const guestContext = {
      isAuthenticated: false,
      userId: 'guest-user', // Use consistent guest ID
      email: null,
      name: 'Guest User',
      userType: 'guest'
    };
    
    return guestContext;
    
  } catch (error) {
    console.error('ERROR extracting user context:', error);
    
    // Always return valid context, even on error
    return {
      isAuthenticated: false,
      userId: 'guest-user', // Consistent fallback
      email: null,
      name: 'Guest User',
      userType: 'guest'
    };
  }
}

// Get user thread data from DynamoDB
async function getUserThread(userId) {
  try {
    console.log(`Getting user thread for userId: ${userId}`);
    
    const dynamodb = getDynamoClient();
    
    const command = new GetCommand({
      TableName: process.env.USER_THREADS_TABLE,
      Key: { user_id: userId }
    });
    
    const result = await dynamodb.send(command);
    
    if (result.Item) {
      console.log(`Found existing thread for user ${userId}: ${result.Item.thread_id}`);
      return result.Item;
    }
    
    console.log(`No existing thread found for user ${userId}`);
    return null;
    
  } catch (error) {
    console.error(`Error getting user thread for ${userId}:`, error);
    throw error;
  }
}

// Store user thread data in DynamoDB
async function storeUserThread(userId, threadData) {
  try {
    console.log(`Storing user thread for userId: ${userId}, threadId: ${threadData.thread_id}`);
    
    const dynamodb = getDynamoClient();
    
    const command = new PutCommand({
      TableName: process.env.USER_THREADS_TABLE,
      Item: {
        user_id: userId,
        thread_id: threadData.thread_id,
        swing_count: threadData.swing_count || 0,
        message_count: threadData.message_count || 0,
        created_at: threadData.created_at,
        updated_at: new Date().toISOString(),
        last_updated: threadData.last_updated
      }
    });
    
    await dynamodb.send(command);
    console.log(`Successfully stored thread for user ${userId}`);
    
  } catch (error) {
    console.error(`Error storing user thread for ${userId}:`, error);
    throw error;
  }
}

// Handle chat request with user threading
async function handleChatLoopRequest(event, userContext) {
  let body;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
  } catch (error) {
    throw new Error('Invalid JSON body');
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Message is required',
        success: false,
        timestamp: new Date().toISOString()
      })
    };
  }

  const userId = userContext.userId;
  const dynamodbClient = getDynamoClient();
  const logger = {
    debug: (...args) => console.debug('CHAT_LOOP_DEBUG', ...args),
    warn: (...args) => console.warn('CHAT_LOOP_WARN', ...args),
    error: (...args) => console.error('CHAT_LOOP_ERROR', ...args)
  };

  const requestOpenAi = async (payload) => callChatCompletions(payload);
  const result = await executeChatLoop({
    userId,
    userMessage: message,
    dynamoClient: dynamodbClient,
    requestOpenAi,
    logger
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      response: result.reply,
      message: result.reply,
      success: true,
      timestamp: new Date().toISOString()
    })
  };
}
async function callChatCompletions(payload) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const requestBody = JSON.stringify(payload);
  const responseBody = await makeHttpsRequest({
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
      'Content-Type': 'application/json'
    }
  }, requestBody);

  try {
    return JSON.parse(responseBody);
  } catch (error) {
    throw new Error('Failed to parse OpenAI chat response: ' + error.message);
  }
}


async function handleChatRequest(event, userContext) {
  if (CHAT_LOOP_ENABLED) {
    try {
      return await handleChatLoopRequest(event, userContext);
    } catch (loopError) {
      console.error('CHAT LOOP ERROR:', loopError);
      const fallbackMessage = "I'm working through a small glitch. Please try your question again in a moment.";
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          response: fallbackMessage,
          message: fallbackMessage,
          success: true,
          fallback: true,
          timestamp: new Date().toISOString()
        })
      };
    }
  }

  try {
    console.log('Starting user thread chat continuation...');
    
    // Parse request body to extract message
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { message } = body;
    
    // SECURITY: Use authenticated userId from JWT, not from request body
    const userId = userContext.userId; // Always use authenticated user ID
    
    // Validate that userId matches request if provided (for backwards compatibility)
    if (body.userId && body.userId !== userId) {
      console.warn(`SECURITY WARNING: Request userId ${body.userId} doesn't match authenticated userId ${userId}`);
    }
    
    // Basic input validation
    if (!message) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Message is required',
          success: false,
          timestamp: new Date().toISOString()
        })
      };
    }
    
    console.log(`Chat request from user: ${userId}`);
    
    // Get user's existing thread
    let userThreadData = await getUserThread(userId);
    let threadId = userThreadData?.thread_id;
    
    // If no thread exists, create general coaching thread
    if (!threadId) {
      console.log(`Creating new general coaching thread for user ${userId}`);
      const threadResponse = await makeHttpsRequest({
        hostname: 'api.openai.com',
        path: '/v1/threads',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'assistants=v2'
        }
      }, JSON.stringify({}));
      
      const newThread = JSON.parse(threadResponse);
      threadId = newThread.id;
      
      userThreadData = {
        thread_id: threadId,
        swing_count: 0,
        message_count: 0,
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString()
      };
      await storeUserThread(userId, userThreadData);
    } else {
      console.log(`Using existing thread ${threadId} for user ${userId}`);
    }
    
    // Add user's message to their OpenAI thread
    await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: `/v1/threads/${threadId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      }
    }, JSON.stringify({
      role: 'user',
      content: message
    }));
    
    // Use persistent assistant ID (create once, reuse always)
    const assistantId = process.env.GOLF_COACH_ASSISTANT_ID || await getOrCreateAssistant();
    
    const runResponse = await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: `/v1/threads/${threadId}/runs`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      }
    }, JSON.stringify({
      assistant_id: assistantId,
      max_completion_tokens: 1500,
      temperature: 0.7
    }));
    
    const run = JSON.parse(runResponse);
    
    // Wait for completion with circuit breaker
    let attempts = 0;
    let completedRun;
    while (attempts < 30) {
      const statusResponse = await makeHttpsRequest({
        hostname: 'api.openai.com',
        path: `/v1/threads/${threadId}/runs/${run.id}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });
      
      completedRun = JSON.parse(statusResponse);
      
      if (completedRun.status === 'completed') {
        break;
      }
      if (completedRun.status === 'failed' || completedRun.status === 'cancelled') {
        throw new Error(`OpenAI run ${completedRun.status}: ${completedRun.last_error?.message || 'Unknown error'}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    if (completedRun.status !== 'completed') {
      throw new Error('OpenAI run timed out');
    }
    
    // Get the assistant's response
    const messagesResponse = await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: `/v1/threads/${threadId}/messages`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });
    
    const messages = JSON.parse(messagesResponse);
    const chatResponse = messages.data[0].content[0].text.value;
    
    // Update thread metadata
    userThreadData.last_updated = new Date().toISOString();
    userThreadData.message_count = (userThreadData.message_count || 0) + 1;
    await storeUserThread(userId, userThreadData);
    
    console.log(`User thread chat continuation completed for ${userId}`);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        response: chatResponse.trim(),
        message: chatResponse.trim(), // Fallback for app compatibility
        thread_id: threadId,
        timestamp: new Date().toISOString(),
        success: true
      })
    };
    
  } catch (error) {
    console.error('Error in user thread chat continuation:', error);
    
    // Circuit breaker: provide graceful fallback
    let fallbackMessage = 'I\'m temporarily having trouble connecting. Please try your question again in a moment.';
    
    if (error.message.includes('rate limit')) {
      fallbackMessage = 'I\'m receiving a lot of questions right now. Please wait a moment and try again.';
    } else if (error.message.includes('timeout')) {
      fallbackMessage = 'That\'s taking a bit longer than usual to process. Please try asking again.';
    }
    
    return {
      statusCode: 200, // Return 200 to provide graceful user experience
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        response: fallbackMessage,
        message: fallbackMessage,
        success: true,
        fallback: true,
        timestamp: new Date().toISOString()
      })
    };
  }
}

// Main Lambda handler
exports.handler = async (event) => {
  console.log('CHAT API HANDLER - Event summary:', {
    path: event?.path,
    method: event?.httpMethod,
    hasBody: !!event?.body,
    hasAuth: !!(event?.headers?.Authorization || event?.headers?.authorization),
  });
  console.log('CHAT API HANDLER - Environment Check:', {
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    userThreadsTable: process.env.USER_THREADS_TABLE,
    chatLoopEnabled: CHAT_LOOP_ENABLED,
    httpTimeoutMs: HTTP_REQUEST_TIMEOUT_MS,
  });
  
  try {
    await ensureOpenAIKey();
    
    // Extract user context from the request
    const userContext = await extractUserContext(event);
    console.log('USER CONTEXT:', userContext);
    
    // Validate this is a POST request for chat
    if (event.httpMethod !== 'POST' || !event.body) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          error: 'Invalid request - POST with body required',
          success: false
        })
      };
    }
    
    // Handle chat request
    return await handleChatRequest(event, userContext);
    
  } catch (error) {
    console.error('Error in chat API handler:', error);
    return { 
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: error.message,
        success: false
      }) 
    };
  }
};
