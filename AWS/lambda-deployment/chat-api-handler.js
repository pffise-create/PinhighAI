// Chat API Handler - Focused Lambda for handling chat requests with user threading
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const https = require('https');

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
    
    if (data) {
      req.write(data);
    }
    
    req.end();
  });
}

// Extract user context from event (authentication handling)
async function extractUserContext(event) {
  console.log('EXTRACT USER CONTEXT: Starting');
  
  try {
    // For HTTP requests, check for Authorization header
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      console.log('AUTH HEADER: Found, attempting JWT validation');
      
      // TODO: JWT validation will be enabled in production deployment
      // For now, return basic authenticated context
      console.log('JWT VALIDATION: Currently disabled, falling back to guest mode');
    }
    
    // Fall back to guest user context
    const guestContext = {
      isAuthenticated: false,
      userId: 'guest-' + Date.now(),
      email: null,
      name: 'Guest User',
      userType: 'guest'
    };
    
    console.log('USER CONTEXT: Returning guest context:', guestContext);
    return guestContext;
    
  } catch (error) {
    console.error('ERROR extracting user context:', error);
    
    // Always return valid context, even on error
    return {
      isAuthenticated: false,
      userId: 'guest-' + Date.now(),
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
async function handleChatRequest(event, userContext) {
  try {
    console.log('Starting user thread chat continuation...');
    
    // Parse request body to extract message
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { message } = body;
    // IMPORTANT: Use consistent userId from request body for thread continuity
    const userId = body.userId || userContext?.userId || 'guest-user';
    
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
    
    // Create assistant and run with thread continuation
    const assistantResponse = await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: '/v1/assistants',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      }
    }, JSON.stringify({
      name: 'Golf Coach',
      instructions: 'You are a professional golf coach having ongoing conversations with golfers. Provide natural, conversational coaching advice.',
      model: 'gpt-4o',
      tools: []
    }));
    
    const assistant = JSON.parse(assistantResponse);
    
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
      assistant_id: assistant.id,
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