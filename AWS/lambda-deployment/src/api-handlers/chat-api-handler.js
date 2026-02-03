// Chat API Handler - Focused Lambda for handling chat requests with user threading
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const https = require('https');
const crypto = require('crypto');

// Initialize clients
let dynamodb = null;

function getDynamoClient() {
  if (!dynamodb) {
    const client = new DynamoDBClient({});
    dynamodb = DynamoDBDocumentClient.from(client);
  }
  return dynamodb;
}

// HTTP request helper function
const DEFAULT_HTTPS_TIMEOUT_MS = parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || '15000', 10);

function makeHttpsRequest(options, data = null, timeoutMs = DEFAULT_HTTPS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const requestOptions = { ...options };
    const req = https.request(requestOptions, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      const host = requestOptions.hostname || requestOptions.host || 'unknown-host';
      const path = requestOptions.path || '';
      req.destroy(new Error(`Request to ${host}${path} timed out after ${timeoutMs}ms`));
    });

    if (data) {
      req.write(data);
    }

    req.end();
  });
}
const JWKS_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
let cachedJwks = null;
let cachedJwksExpiresAt = 0;

function decodeJwtSegment(segment, label) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid ${label} segment`);
  }
}

async function fetchJsonWithRequest(url, timeoutMs = DEFAULT_HTTPS_TIMEOUT_MS) {
  const parsed = new URL(url);
  const responseBody = await makeHttpsRequest({
    hostname: parsed.hostname,
    path: `${parsed.pathname}${parsed.search}`,
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  }, null, timeoutMs);

  try {
    return JSON.parse(responseBody);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${url}: ${error.message}`);
  }
}

async function getJwks() {
  const now = Date.now();
  if (cachedJwks && cachedJwksExpiresAt > now) {
    return cachedJwks;
  }

  const region = process.env.COGNITO_REGION;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!region || !userPoolId) {
    throw new Error('Cognito configuration missing. Set COGNITO_REGION and COGNITO_USER_POOL_ID.');
  }

  const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  const jwks = await fetchJsonWithRequest(jwksUrl, Math.min(DEFAULT_HTTPS_TIMEOUT_MS, 5000));

  cachedJwks = jwks;
  cachedJwksExpiresAt = now + JWKS_CACHE_TTL_MS;
  return jwks;
}

async function verifyAndDecodeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const header = decodeJwtSegment(parts[0], 'header');
  const payload = decodeJwtSegment(parts[1], 'payload');

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
  }

  const jwks = await getJwks();
  const matchingKey = jwks.keys?.find((key) => key.kid === header.kid);
  if (!matchingKey) {
    throw new Error('Unable to find matching signing key for token');
  }

  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: matchingKey, format: 'jwk' });
  } catch (error) {
    throw new Error(`Failed to construct public key: ${error.message}`);
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();

  const signature = Buffer.from(parts[2], 'base64url');
  if (!verifier.verify(publicKey, signature)) {
    throw new Error('Invalid JWT signature');
  }

  const region = process.env.COGNITO_REGION;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  if (payload.iss !== issuer) {
    throw new Error('Token issuer mismatch');
  }

  const expectedClientId = process.env.COGNITO_APP_CLIENT_ID;
  if (expectedClientId && payload.aud !== expectedClientId && payload.client_id !== expectedClientId) {
    throw new Error('Token not issued for expected client');
  }

  if (!payload.exp || payload.exp * 1000 < Date.now()) {
    throw new Error('Token has expired');
  }

  return payload;
}

function buildUserContextFromPayload(payload) {
  return {
    isAuthenticated: true,
    userId: payload.sub,
    email: payload.email || payload.username || payload['cognito:username'] || null,
    name: payload.name || payload.email || payload.username || payload['cognito:username'] || 'Authenticated User',
    username: payload.username || payload['cognito:username'] || payload.email || payload.sub,
    userType: 'authenticated'
  };
}

const CHAT_ASSISTANT_INSTRUCTIONS = `You are Pin High, an AI-powered golf coach and supportive golf buddy with Tour-level analysis. The golfer is typically an 8-25 handicapper. Keep the tone conversational, encouraging, and a little playful while staying deeply knowledgeable. Diagnose underlying fundamentals rather than just symptoms. Reference earlier swings, drills, and feedback whenever it helps the player feel you remember their journey. Explain what the body and club are doing and why, using plain language with precise golf terms when helpful. Offer tailored drills or feels, encourage iterative progress, and avoid deterministic absolutes--guide them toward self-discovery. Ask occasional pro-level engagement questions (for example about miss pattern, contact quality, or feels) to deepen the diagnosis and keep the session interactive.`;

let cachedAssistantId = null;

async function getOrCreateAssistant() {
  if (process.env.GOLF_COACH_ASSISTANT_ID) {
    return process.env.GOLF_COACH_ASSISTANT_ID;
  }

  if (cachedAssistantId) {
    return cachedAssistantId;
  }

  try {
    const assistantPayload = {
      name: 'Pin High Swing Coach',
      instructions: CHAT_ASSISTANT_INSTRUCTIONS,
      model: 'gpt-4o-mini',
      tools: []
    };

    const assistantResponse = await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: '/v1/assistants',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      }
    }, JSON.stringify(assistantPayload));

    const assistant = JSON.parse(assistantResponse);
    cachedAssistantId = assistant.id;
    console.log('Created new assistant for chat:', cachedAssistantId);
    return cachedAssistantId;
  } catch (error) {
    console.error('Failed to create chat assistant:', error);
    throw new Error('Unable to obtain assistant id. Set GOLF_COACH_ASSISTANT_ID env var or allow creation.');
  }
}

function getGuestContext() {
  return {
    isAuthenticated: false,
    userId: 'guest-user',
    email: null,
    name: 'Guest User',
    userType: 'guest'
  };
}

// Extract user context from event with JWT validation
async function extractUserContext(event) {
  console.log('EXTRACT USER CONTEXT: Starting JWT validation');

  const guestContext = getGuestContext();

  try {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      console.log('AUTH HEADER: Found JWT token, verifying...');

      try {
        const payload = await verifyAndDecodeJwt(token);
        const authenticatedContext = buildUserContextFromPayload(payload);

        console.log('USER CONTEXT: Returning authenticated context:', {
          userId: authenticatedContext.userId,
          email: authenticatedContext.email,
          userType: authenticatedContext.userType
        });

        return authenticatedContext;
      } catch (jwtError) {
        console.error('JWT VERIFICATION ERROR:', jwtError.message);
      }
    } else {
      console.log('AUTH HEADER: No Bearer token found');
    }
  } catch (error) {
    console.error('ERROR extracting user context:', error);
  }

  console.log('USER CONTEXT: Falling back to guest mode');
  return guestContext;
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
async function handleChatRequest(event, userContext) {
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
      temperature: 0.7,
      instructions: CHAT_ASSISTANT_INSTRUCTIONS
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
  console.log('CHAT API HANDLER - Event:', JSON.stringify(event, null, 2));
  console.log('CHAT API HANDLER - Environment Check:', {
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    userThreadsTable: process.env.USER_THREADS_TABLE
  });
  
  try {
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









