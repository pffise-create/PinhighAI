// Complete AI Analysis Lambda - Handles HTTP requests AND DynamoDB streams
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const https = require('https');

// AUTHENTICATION CONSTANTS
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || 'us-east-1_XXXXXXXXX';
const COGNITO_REGION = process.env.COGNITO_REGION || 'us-east-1';

// Note: JWT validation temporarily disabled due to missing dependencies
// This will be enabled once proper deployment with JWT packages is created

// COST PROTECTION CONSTANTS
const MAX_TOKENS_PER_REQUEST = 1200;
const MAX_CONTEXT_TOKENS = 1000;
const MAX_REQUESTS_PER_USER_PER_HOUR = 100; // Increased for testing
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// COACHING FOCUS MANAGEMENT
const MAX_ACTIVE_FOCUS_AREAS = 3;
const FOCUS_CHANGE_RULES = {
  GRADUATION: {
    trigger: "Player shows consistent improvement in focus area across 2+ sessions",
    action: "Move to maintenance mode, introduce new focus area"
  },
  HIGH_PRIORITY_OVERRIDE: {
    trigger: "New swing fault with confidence >90% and impact >current focus areas", 
    action: "Replace lowest-priority current focus area"
  },
  STAY_COURSE: {
    trigger: "Incremental progress or no clear improvement yet",
    action: "Continue current focus areas, adjust approach/drills"
  }
};

// Initialize clients inside functions to avoid initialization errors
let dynamodb = null;
let lambdaClient = null;
let apigateway = null;
let s3Client = null;
let cloudwatchClient = null;

// In-memory rate limiting store (for Lambda container reuse)
const rateLimitStore = new Map();

function getDynamoClient() {
  if (!dynamodb) {
    const client = new DynamoDBClient({});
    dynamodb = DynamoDBDocumentClient.from(client);
  }
  return dynamodb;
}

function getLambdaClient() {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({});
  }
  return lambdaClient;
}

function getApiGatewayClient() {
  if (!apigateway && process.env.WEBSOCKET_ENDPOINT) {
    apigateway = new ApiGatewayManagementApiClient({ 
      endpoint: process.env.WEBSOCKET_ENDPOINT 
    });
  }
  return apigateway;
}

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
}

function getCloudWatchClient() {
  if (!cloudwatchClient) {
    cloudwatchClient = new CloudWatchClient({});
  }
  return cloudwatchClient;
}

// COST PROTECTION FUNCTIONS

// Estimate token count for text (rough approximation: 1 token ≈ 4 characters)
function estimateTokenCount(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Check if user is within rate limit
function checkRateLimit(userId) {
  const now = Date.now();
  const userKey = `rate_${userId}`;
  
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
  
  if (recentRequests.length >= MAX_REQUESTS_PER_USER_PER_HOUR) {
    return {
      allowed: false,
      requestCount: recentRequests.length,
      resetTime: Math.min(...recentRequests) + RATE_LIMIT_WINDOW_MS
    };
  }
  
  // Add current request
  recentRequests.push(now);
  rateLimitStore.set(userKey, recentRequests);
  
  return {
    allowed: true,
    requestCount: recentRequests.length,
    remainingRequests: MAX_REQUESTS_PER_USER_PER_HOUR - recentRequests.length
  };
}

// AUTHENTICATION FUNCTIONS

// Simplified token validation (JWT validation disabled for now)
async function validateToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or invalid Authorization header' };
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    // TODO: Enable proper JWT validation once dependencies are deployed
    // For now, extract basic info from token payload without verification
    console.log('JWT validation temporarily disabled - using basic token parsing');
    
    // Simple base64 decode of token payload (NOT SECURE - for development only)
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    
    return {
      valid: true,
      userId: payload.sub || 'temp-user-id',
      email: payload.email || 'temp@example.com',
      name: payload.name || payload.email || 'Temp User',
      tokenPayload: payload
    };
  } catch (error) {
    console.error('Token parsing error:', error);
    return { 
      valid: false, 
      error: `Token parsing failed: ${error.message}` 
    };
  }
}

// Extract user context from event (handles both authenticated and guest users)
async function extractUserContext(event) {
  // Check for Authorization header
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  
  if (authHeader) {
    // Authenticated user
    const tokenValidation = await validateToken(authHeader);
    if (tokenValidation.valid) {
      console.log(`Authenticated user: ${tokenValidation.email} (${tokenValidation.userId})`);
      return {
        isAuthenticated: true,
        userId: tokenValidation.userId,
        email: tokenValidation.email,
        name: tokenValidation.name,
        userType: 'authenticated'
      };
    } else {
      console.warn('Invalid authentication token:', tokenValidation.error);
      // Return guest context for invalid tokens (backward compatibility)
      return {
        isAuthenticated: false,
        userId: 'guest-user',
        email: null,
        name: 'Guest User',
        userType: 'guest'
      };
    }
  } else {
    // Guest user (backward compatibility)
    console.log('No authentication header found, treating as guest user');
    return {
      isAuthenticated: false,
      userId: 'guest-user',
      email: null,
      name: 'Guest User',
      userType: 'guest'
    };
  }
}

// Send CloudWatch metrics
async function sendCloudWatchMetrics(metricName, value, unit = 'Count', userId = null) {
  try {
    const cloudwatch = getCloudWatchClient();
    const dimensions = [
      {
        Name: 'Environment',
        Value: process.env.STAGE || 'prod'
      }
    ];
    
    if (userId) {
      dimensions.push({
        Name: 'UserId',
        Value: userId
      });
    }
    
    const params = {
      Namespace: 'GolfCoach/AI',
      MetricData: [
        {
          MetricName: metricName,
          Value: value,
          Unit: unit,
          Dimensions: dimensions,
          Timestamp: new Date()
        }
      ]
    };
    
    await cloudwatch.send(new PutMetricDataCommand(params));
    console.log(`CloudWatch metric sent: ${metricName} = ${value}`);
  } catch (error) {
    console.error('Error sending CloudWatch metrics:', error);
    // Don't throw - metrics failures shouldn't break the function
  }
}

// COACHING HISTORY FUNCTIONS

// Fetch user's coaching history for context-aware responses (with timeout protection)
async function fetchUserCoachingHistory(userId, currentAnalysisId) {
  try {
    console.log(`Fetching coaching history for user: ${userId}`);
    
    // HOTFIX: Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Coaching history fetch timeout')), 3000); // 3 second timeout
    });
    
    const fetchPromise = async () => {
      const dynamodb = getDynamoClient();
      
      // UPDATED: Optimized query for user coaching history
      const scanParams = {
        TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
        FilterExpression: '#user_id = :userId AND attribute_exists(ai_analysis) AND #status = :status',
        ExpressionAttributeNames: {
          '#user_id': 'user_id',
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':status': 'COMPLETED'
        },
        Limit: 5, // Get last 5 completed sessions for context
        ProjectionExpression: 'analysis_id, created_at, ai_analysis, updated_at'
      };
      
      console.log('Fetching coaching history with params:', scanParams);
      return await dynamodb.send(new ScanCommand(scanParams));
    };
    
    // Race between fetch and timeout
    const result = await Promise.race([fetchPromise(), timeoutPromise]);
    
    if (!result.Items || result.Items.length === 0) {
      console.log('No previous coaching history found for user');
      return {
        sessionCount: 0,
        previousSessions: [],
        coachingThemes: [],
        focusAreas: [],
        isFirstTimeUser: true
      };
    }
    
    // HOTFIX: Filter client-side to exclude current analysis and only completed ones
    const filteredItems = result.Items.filter(item => {
      return item.analysis_id !== currentAnalysisId && 
             item.ai_analysis_completed === true &&
             item.ai_analysis; // Make sure ai_analysis exists
    });
    
    // Sort by date (most recent first) and limit to 5
    const sessions = filteredItems
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5);
    
    console.log(`Found ${sessions.length} previous coaching sessions`);
    
    // Extract coaching themes and focus areas from previous sessions
    const coachingThemes = [];
    const focusAreas = [];
    const sessionSummaries = [];
    
    sessions.forEach((session, index) => {
      const aiAnalysis = session.ai_analysis;
      
      if (aiAnalysis) {
        // Extract root cause and symptoms as themes
        if (aiAnalysis.root_cause) {
          coachingThemes.push({
            theme: aiAnalysis.root_cause,
            session: index + 1,
            analysisId: session.analysis_id,
            date: session.created_at
          });
        }
        
        // Extract practice recommendations as focus areas
        if (aiAnalysis.practice_recommendations && Array.isArray(aiAnalysis.practice_recommendations)) {
          aiAnalysis.practice_recommendations.forEach(rec => {
            focusAreas.push({
              focus: rec,
              session: index + 1,
              analysisId: session.analysis_id
            });
          });
        }
        
        // Create session summary for context
        sessionSummaries.push({
          analysisId: session.analysis_id,
          date: session.created_at,
          rootCause: aiAnalysis.root_cause || 'General swing improvement',
          confidence: aiAnalysis.confidence_score || 85,
          keySymptoms: aiAnalysis.symptoms_detected || [],
          sessionNumber: index + 1
        });
      }
    });
    
    // Deduplicate and prioritize focus areas (keep most recent, limit to 3)
    const uniqueFocusAreas = [];
    const seenFocus = new Set();
    
    focusAreas.forEach(focus => {
      const focusKey = focus.focus.toLowerCase().substring(0, 50);
      if (!seenFocus.has(focusKey) && uniqueFocusAreas.length < MAX_ACTIVE_FOCUS_AREAS) {
        uniqueFocusAreas.push(focus);
        seenFocus.add(focusKey);
      }
    });
    
    const historyData = {
      sessionCount: sessions.length,
      previousSessions: sessionSummaries,
      coachingThemes: coachingThemes.slice(0, 5), // Limit to 5 most recent themes
      focusAreas: uniqueFocusAreas,
      isFirstTimeUser: false,
      lastSessionDate: sessions[0]?.created_at,
      timesSinceLastSession: sessions[0]?.created_at ? 
        Math.floor((Date.now() - new Date(sessions[0].created_at).getTime()) / (1000 * 60 * 60 * 24)) : 0
    };
    
    console.log(`Coaching history summary: ${historyData.sessionCount} sessions, ${historyData.coachingThemes.length} themes, ${historyData.focusAreas.length} focus areas`);
    
    return historyData;
    
  } catch (error) {
    console.error('Error fetching coaching history:', error);
    
    // Graceful degradation - return minimal context
    return {
      sessionCount: 0,
      previousSessions: [],
      coachingThemes: [],
      focusAreas: [],
      isFirstTimeUser: true,
      error: 'Failed to load coaching history'
    };
  }
}

exports.handler = async (event) => {
  console.log('AI Analysis Lambda triggered:', JSON.stringify(event, null, 2));
  
  try {
    // Extract user context from the request (handles both authenticated and guest users)
    const userContext = await extractUserContext(event);
    console.log('User context:', userContext);
    // CHECK 1: Is this a GET request for results?
    if (event.httpMethod === 'GET' && event.pathParameters && event.pathParameters.jobId) {
      console.log('GET request for results detected');
      return await handleGetResults(event.pathParameters.jobId);
    }
    
    // CHECK 2: Is this a POST request for chat?
    if (event.httpMethod === 'POST' && event.path && event.path.includes('/chat')) {
      console.log('POST request for chat detected');
      console.log('Chat request path:', event.path);
      console.log('Chat request headers:', JSON.stringify(event.headers, null, 2));
      return await handleChatRequest(event, userContext);
    }
    
    // CHECK 3: Is this a POST request to trigger analysis?
    if (event.httpMethod === 'POST' && event.body) {
      console.log('POST request to trigger analysis detected');
      
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      const { s3Key, bucketName } = body;
      
      // Use authenticated user ID or fall back to guest
      const userId = userContext.userId;
      
      console.log('API Gateway trigger for video:', s3Key);
      console.log('Using userId from context:', userId);
      
      // Create a proper analysis ID from the s3Key filename
      const analysisId = extractAnalysisIdFromS3Key(s3Key) || `analysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Start the analysis workflow by creating DynamoDB record
      await startAnalysisWorkflow(analysisId, s3Key, bucketName, userId, userContext);
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          jobId: analysisId,
          status: 'started',
          message: 'Video analysis started successfully'
        })
      };
    }
    
    // CHECK 4: Is this a CloudWatch scheduled event for auto-processing?
    if (event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event') {
      console.log('CloudWatch scheduled event - processing pending analyses');
      await processPendingAnalyses();
      return { statusCode: 200, body: 'Processed pending analyses' };
    }
    
    // CHECK 5: Is this a DynamoDB Stream event?
    if (event.Records) {
      console.log('DynamoDB Stream event detected');
      
      // Process DynamoDB Stream records
      for (const record of event.Records) {
        if (record.eventName === 'INSERT' || record.eventName === 'MODIFY') {
          const swingData = record.dynamodb.NewImage;
          
          // Only process completed video analyses that haven't had AI analysis yet
          const status = swingData.status?.S;
          const aiCompleted = swingData.ai_analysis_completed?.BOOL;
          const analysisId = swingData.analysis_id?.S;
          
          console.log(`DynamoDB Stream - Record: ${analysisId}, status: ${status}, ai_completed: ${aiCompleted}`);
          
          // FIXED: Add missing frame extraction trigger for STARTED records
          const shouldTriggerFrameExtraction = (status === 'STARTED');
          const shouldTriggerAI = (
            status === 'COMPLETED' && 
            (aiCompleted === false || aiCompleted === null || aiCompleted === undefined)
          );
          
          if (shouldTriggerFrameExtraction) {
            console.log(`STREAM TRIGGER: Starting frame extraction for: ${analysisId}`);
            await triggerFrameExtraction(swingData);
          } else if (shouldTriggerAI) {
            console.log(`STREAM TRIGGER: Processing AI analysis for: ${analysisId}`);
            await processSwingAnalysis(swingData);
          } else {
            console.log(`STREAM SKIP: status=${status}, ai_completed=${aiCompleted} - No triggers needed`);
          }
        }
      }
      return { statusCode: 200, body: 'AI Analysis completed' };
    }
    
    // If we get here, it's an unknown event type
    console.log('Unknown event type');
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Unknown event type' })
    };
    
  } catch (error) {
    console.error('Error in AI Analysis Lambda:', error);
    return { 
      statusCode: 500, 
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message }) 
    };
  }
};

// NEW: Function to extract analysis ID from S3 key
function extractAnalysisIdFromS3Key(s3Key) {
  try {
    // s3Key format: golf-swings/user-xxx/timestamp-random.mov
    const parts = s3Key.split('/');
    if (parts.length >= 3) {
      const filename = parts[2];
      // Remove file extension
      const analysisId = filename.replace(/\.(mov|mp4|avi)$/i, '');
      return analysisId;
    }
    return null;
  } catch (error) {
    console.warn('Could not extract analysis ID from s3Key:', s3Key);
    return null;
  }
}

// FIXED: Function to start the analysis workflow without overwriting existing records
async function startAnalysisWorkflow(analysisId, s3Key, bucketName, userId, userContext) {
  try {
    console.log(`Starting analysis workflow for ${analysisId}`);
    
    const dynamodb = getDynamoClient();
    
    // First check if analysis already exists
    const getCommand = new GetCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: analysisId }
    });
    
    const existingRecord = await dynamodb.send(getCommand);
    
    if (existingRecord.Item) {
      console.log(`Analysis ${analysisId} already exists with status: ${existingRecord.Item.status}`);
      
      // If frames are already extracted, trigger AI analysis directly
      if (existingRecord.Item.status === 'COMPLETED' && !existingRecord.Item.ai_analysis_completed) {
        console.log(`DIRECT TRIGGER: AI analysis for completed frames: ${analysisId}`);
        
        // Trigger AI analysis immediately
        try {
          await processSwingAnalysis({
            analysis_id: { S: analysisId },
            status: { S: 'COMPLETED' },
            user_id: { S: existingRecord.Item.user_id || userId }
          });
          console.log(`AI analysis triggered successfully for: ${analysisId}`);
        } catch (error) {
          console.error(`Failed to trigger AI analysis for ${analysisId}:`, error);
        }
        return;
      }
      
      // Record exists, don't overwrite - just return
      console.log('Record exists, not overwriting');
      return;
    }
    
    // Only create new record if it doesn't exist
    const putCommand = new PutCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Item: {
        analysis_id: analysisId,
        user_id: userId || 'mobile-user',
        // Add user context for authenticated users
        user_email: userContext?.email || null,
        user_name: userContext?.name || null,
        user_type: userContext?.userType || 'guest',
        is_authenticated: userContext?.isAuthenticated || false,
        status: 'STARTED',
        progress_message: 'Analysis request received, starting frame extraction...',
        s3_key: s3Key,
        bucket_name: bucketName,
        ai_analysis_completed: false, // EXPLICITLY set to false for stream detection
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    });
    
    await dynamodb.send(putCommand);
    console.log(`Created NEW DynamoDB record for analysis ${analysisId}`);
    
  } catch (error) {
    console.error('Error starting analysis workflow:', error);
    throw error;
  }
}

// BACKUP: Function to scan for pending analyses and process them
async function processPendingAnalyses() {
  try {
    console.log('Scanning for pending AI analyses...');
    
    const dynamodb = getDynamoClient();
    
    // Scan for records that are COMPLETED but don't have AI analysis yet
    const command = new PutCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses'
    });
    
    // IMPROVED: Better scan to catch all pending analyses
    const scanParams = {
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      FilterExpression: '#status = :completed AND (attribute_not_exists(ai_analysis_completed) OR ai_analysis_completed = :false_val OR ai_analysis_completed = :null_val)',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':completed': 'COMPLETED',
        ':false_val': false,
        ':null_val': null
      },
      Limit: 5 // Process max 5 at a time
    };
    
    // Execute scan
    const result = await dynamodb.send(new ScanCommand(scanParams));
    
    if (!result.Items || result.Items.length === 0) {
      console.log('No pending analyses found');
      return;
    }
    
    console.log(`Found ${result.Items.length} pending analyses to process`);
    
    // Process each pending analysis
    for (const item of result.Items) {
      const analysisId = item.analysis_id;
      console.log(`Processing pending analysis: ${analysisId}`);
      
      // Convert to stream format and process
      const swingData = {
        analysis_id: { S: analysisId },
        status: { S: item.status },
        user_id: { S: item.user_id || 'mobile-user' }
      };
      
      try {
        await processSwingAnalysis(swingData);
        console.log(`Successfully processed: ${analysisId}`);
      } catch (error) {
        console.error(`Failed to process ${analysisId}:`, error);
      }
    }
    
  } catch (error) {
    console.error('Error in processPendingAnalyses:', error);
  }
}

// FIXED: Added missing frame extraction function
async function triggerFrameExtraction(swingData) {
  const analysisId = swingData.analysis_id?.S;
  const s3Key = swingData.s3_key?.S;
  const bucketName = swingData.bucket_name?.S;
  const userId = swingData.user_id?.S || 'mobile-user';
  
  console.log(`Starting frame extraction for analysis: ${analysisId}, video: ${s3Key}`);
  
  try {
    const dynamodb = getDynamoClient();
    
    // Update status to EXTRACTING_FRAMES
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: analysisId },
      UpdateExpression: 'SET #status = :status, progress_message = :message, updated_at = :timestamp',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'EXTRACTING_FRAMES',
        ':message': 'Extracting swing frames from video...',
        ':timestamp': new Date().toISOString()
      }
    }));
    
    // FIXED: Call real Docker-based frame extraction Lambda
    console.log(`Calling Docker frame extraction Lambda for ${s3Key}...`);
    
    const lambdaClient = getLambdaClient();
    
    // Prepare payload for Docker Lambda
    const frameExtractionPayload = {
      s3_bucket: bucketName,
      s3_key: s3Key,
      analysis_id: analysisId,
      user_id: userId
    };
    
    const invokeCommand = new InvokeCommand({
      FunctionName: 'golf-coach-frame-extractor', // Use Python version with 0.1s intervals
      InvocationType: 'Event', // Asynchronous invocation
      Payload: JSON.stringify(frameExtractionPayload)
    });
    
    await lambdaClient.send(invokeCommand);
    console.log(`Successfully triggered Docker frame extraction for ${analysisId}`);
    
    console.log(`✅ Frame extraction trigger completed for ${analysisId}, Docker Lambda will process it`);
    
  } catch (error) {
    console.error(`❌ Frame extraction failed for ${analysisId}:`, error);
    
    // Update status to FAILED
    const dynamodb = getDynamoClient();
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: analysisId },
      UpdateExpression: 'SET #status = :status, progress_message = :message, updated_at = :timestamp',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'FAILED',
        ':message': `Frame extraction failed: ${error.message}`,
        ':timestamp': new Date().toISOString()
      }
    }));
    
    throw error;
  }
}

async function processSwingAnalysis(swingData) {
  const analysisId = swingData.analysis_id?.S;
  const userId = swingData.user_id?.S || 'mobile-user'; // HOTFIX: Add fallback for userId
  const connectionId = swingData.connection_id?.S;
  
  if (!analysisId) {
    console.error('No analysis_id found in swing data');
    return;
  }
  
  if (!userId) {
    console.warn(`No userId found for analysis ${analysisId}, using fallback`);
  }
  
  try {
    console.log(`[DEBUG] Starting AI analysis for swing ${analysisId}`);
    
    // Notify user that AI analysis is starting (optional WebSocket)
    await sendWebSocketMessage(connectionId, {
      type: 'ai_analysis_started',
      message: 'Getting your personalized coaching...'
    });
    
    // Get frame URLs and metadata from DynamoDB
    console.log(`[DEBUG] Step 1: Getting frame data for ${analysisId}`);
    const frameData = await getSwingFrameData(analysisId);
    console.log(`[DEBUG] Frame data retrieved for analysis - ${Object.keys(frameData.frame_urls).length} frames found`);
    
    // Analyze swing with GPT-4o
    console.log(`[DEBUG] Step 2: Starting GPT-4o analysis for ${analysisId}`);
    const aiAnalysis = await analyzeSwingWithGPT4o(frameData, swingData);
    console.log(`[DEBUG] GPT-4o analysis complete for ${analysisId}`);
    
    // Store AI analysis results
    console.log(`[DEBUG] Step 3: Storing AI analysis results for ${analysisId}`);
    await storeAIAnalysis(analysisId, aiAnalysis);
    console.log(`[DEBUG] AI analysis stored successfully for ${analysisId}`);
    
    // Send coaching response to user (optional WebSocket)
    await sendWebSocketMessage(connectionId, {
      type: 'ai_coaching_complete',
      coaching: aiAnalysis.coaching_response,
      symptoms: aiAnalysis.symptoms_detected,
      root_cause: aiAnalysis.root_cause,
      confidence: aiAnalysis.confidence_score
    });
    
    console.log(`[SUCCESS] AI Analysis completed for swing ${analysisId}`);
    
  } catch (error) {
    console.error(`[ERROR] Error processing swing ${analysisId}:`, error);
    console.error(`[ERROR] Error stack:`, error.stack);
    
    // Send error message to user (optional WebSocket)
    await sendWebSocketMessage(connectionId, {
      type: 'ai_analysis_error',
      message: 'We encountered an issue processing your swing analysis. Please try uploading again.'
    });
    
    throw error; // Re-throw to see the error in lambda logs
  }
}

async function getSwingFrameData(analysisId) {
  try {
    const dynamodb = getDynamoClient();
    
    const command = new GetCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: analysisId }
    });
    
    const result = await dynamodb.send(command);
    
    if (!result.Item) {
      throw new Error(`Swing data not found for ${analysisId}`);
    }
    
    // Extract frame URLs from the analysis_results structure
    const analysisResults = result.Item.analysis_results;
    let frameUrls = {};
    
    if (analysisResults && analysisResults.frames) {
      // Convert the frame array to a URL map by phase
      analysisResults.frames.forEach(frame => {
        if (frame.phase && frame.url) {
          frameUrls[frame.phase] = frame.url;
        }
      });
    }
    
    return {
      analysis_id: analysisId,
      frame_urls: frameUrls,
      user_context: {
        handicap: result.Item.user_handicap || 'Unknown',
        club_used: result.Item.club_used || 'Unknown',
        shot_type: result.Item.shot_type || 'Unknown',
        user_question: result.Item.user_question || 'General swing analysis'
      },
      swing_metadata: {
        tempo_data: result.Item.tempo_data,
        swing_duration: result.Item.swing_duration
      }
    };
  } catch (error) {
    console.error('Error getting swing frame data:', error);
    throw error;
  }
}

// FIXED: Function to download image from S3 using AWS SDK with proper credentials
async function downloadAndCompressImage(url) {
  try {
    console.log(`Downloading image from S3: ${url.substring(0, 100)}...`);
    
    // Parse S3 URL to get bucket and key
    const urlParts = url.replace('https://', '').split('/');
    const bucketName = urlParts[0].replace('.s3.amazonaws.com', '');
    const key = urlParts.slice(1).join('/');
    
    console.log(`S3 Bucket: ${bucketName}, Key: ${key}`);
    
    const s3Client = getS3Client();
    
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    });
    
    const response = await s3Client.send(command);
    
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    const originalSize = buffer.length;
    const base64 = buffer.toString('base64');
    
    // FIXED: Ensure proper MIME type for GPT-4
    let contentType = response.ContentType;
    if (!contentType || !contentType.startsWith('image/')) {
      // Default to image/jpeg for JPG files
      contentType = 'image/jpeg';
    }
    
    const dataUrl = `data:${contentType};base64,${base64}`;
    
    console.log(`S3 image downloaded successfully: ${originalSize} bytes, Content-Type: ${contentType}`);
    return dataUrl;
    
  } catch (error) {
    console.error('Error downloading image from S3:', error);
    throw new Error(`Failed to download S3 image: ${error.message}`);
  }
}

// Function to download image and convert to base64 (fallback)
async function downloadImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading image: ${url.substring(0, 100)}...`);
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: Failed to download image`));
        return;
      }
      
      const chunks = [];
      
      response.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      response.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          const base64 = buffer.toString('base64');
          const contentType = response.headers['content-type'] || 'image/jpeg';
          
          const dataUrl = `data:${contentType};base64,${base64}`;
          console.log(`Image downloaded and converted to base64 (${buffer.length} bytes)`);
          resolve(dataUrl);
        } catch (error) {
          reject(error);
        }
      });
      
    }).on('error', (error) => {
      reject(error);
    });
  });
}

async function analyzeSwingWithGPT4o(frameData, swingData) {
  const startTime = Date.now();
  
  try {
    console.log('Starting enhanced GPT-4o analysis with cost protection...');
    
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable not set');
    }

    // CONTEXT-AWARE COACHING: Include user history for authenticated users
    console.log('Using context-aware coaching prompt (Sprint 1A restored)');
    
    // Extract analysis ID and user info from swingData
    const analysisId = swingData.analysis_id?.S;
    const userId = swingData.user_id?.S;
    const isAuthenticated = swingData.is_authenticated?.BOOL;
    
    // Fetch coaching history for authenticated users
    let coachingHistory = null;
    if (isAuthenticated && userId && userId !== 'guest-user') {
      console.log(`Fetching coaching history for authenticated user: ${userId}`);
      coachingHistory = await fetchUserCoachingHistory(userId, analysisId);
    }
    
    const systemPrompt = await buildContextAwareGolfCoachingPrompt(frameData, coachingHistory);
    
    // Use ALL frames for analysis (0.1s intervals = better swing detection)
    const allFrameUrls = frameData.frame_urls || {};
    const keyFrames = Object.keys(allFrameUrls).sort().map(frameKey => ({
      phase: frameKey,
      url: allFrameUrls[frameKey]
    }));
    
    if (keyFrames.length === 0) {
      throw new Error('No valid frame URLs found for analysis');
    }
    
    console.log(`Using ALL ${keyFrames.length} frames for better swing position detection (0.1s intervals)`);
    
    console.log(`Converting ${keyFrames.length} P1-P10 frames to base64 with compression...`);
    
    // Download and convert images to base64 SEQUENTIALLY (reliable)
    const base64Images = [];
    for (const frame of keyFrames) {
      try {
        const base64Image = await downloadAndCompressImage(frame.url);
        base64Images.push({
          phase: frame.phase,
          image: base64Image
        });
      } catch (error) {
        console.warn(`Failed to download frame ${frame.phase}:`, error.message);
        // Continue with other frames
      }
    }
    
    if (base64Images.length === 0) {
      throw new Error('No frame images could be downloaded and converted');
    }
    
    console.log(`Successfully converted ${base64Images.length} images to base64`);
    
    // Build message content with analysis request + all frames
    const messageContent = [
      {
        type: "text",
        text: `Here are ${base64Images.length} frames from a golf swing, captured every 0.1 seconds. From these, select whichever frames are most relevant for analysis and coaching. Focus on what will help this golfer improve - respond in whatever format is most helpful for their development. 

Also, please mention what color shirt and shorts the golfer is wearing to confirm the frames are visible.`
      }
    ];
    
    // Add each base64 image (unlabeled)
    base64Images.forEach(frame => {
      messageContent.push({
        type: "image_url",
        image_url: {
          url: frame.image,
          detail: "high"
        }
      });
    });
    
    const messages = [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: messageContent
      }
    ];
    
    // Token estimation for logging (no blocking) 
    const systemTokens = estimateTokenCount(systemPrompt);
    const userTokens = 100; // Estimate for images
    const totalEstimatedTokens = systemTokens + userTokens + 600; // +600 for response buffer
    
    console.log(`Estimated token usage: ${totalEstimatedTokens} (system: ${systemTokens}, user: ${userTokens}) - no blocking applied`);
    
    // TOKEN LIMITS REMOVED - letting all requests through
    
    const requestData = JSON.stringify({
      model: "gpt-4o",
      messages: messages,
      max_tokens: 2000,
      temperature: 0.9,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.1
    });
    
    console.log('Making enhanced GPT-4o API call with cost protection...');
    
    // DEBUG: Log exact request being sent to OpenAI
    console.log('=== DEBUG: EXACT OPENAI REQUEST ===');
    console.log('System prompt:', JSON.stringify(systemPrompt));
    console.log('Message content length:', messageContent.length);
    console.log('Message content:', JSON.stringify(messageContent));
    console.log('Full messages array:', JSON.stringify(messages));
    console.log('=== END DEBUG ===');
    
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
    
    const aiResponse = responseData.choices[0].message.content;
    const responseTokens = estimateTokenCount(aiResponse);
    const totalTokensUsed = systemTokens + userTokens + responseTokens;
    const processingTime = Date.now() - startTime;
    
    console.log(`Enhanced GPT-4o analysis completed successfully`);
    console.log(`Total tokens used: ${totalTokensUsed} (response: ${responseTokens})`);
    console.log(`Processing time: ${processingTime}ms`);
    
    // ULTRA-SIMPLIFIED: Skip CloudWatch metrics for now
    console.log('Skipping CloudWatch metrics (ultra-simplified Sprint 1A)');
    
    // RAW RESPONSE: Use AI response directly without any parsing
    console.log('Returning raw AI response without parsing');
    return {
      coaching_response: aiResponse.trim(),
      symptoms_detected: [],
      root_cause: null,
      confidence_score: null,
      practice_recommendations: []
    };
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('Error in enhanced GPT-4o analysis:', error);
    console.error(`Analysis failed after ${processingTime}ms`);
    
    // ULTRA-SIMPLIFIED: Skip error metrics for now  
    console.log('Skipping error metrics (ultra-simplified Sprint 1A)');
    
    // Enhanced error handling with graceful degradation
    if (error.message.includes('Rate limit exceeded')) {
      throw new Error('Too many coaching requests. Please wait an hour before requesting another analysis to help us manage costs.');
    } else if (error.message.includes('Request too large')) {
      throw new Error('Your swing analysis request is too complex. Please try uploading a shorter video or ask simpler questions.');
    } else if (error.message.includes('OpenAI API error')) {
      throw new Error('Our AI coaching service is temporarily unavailable. Please try again in a few minutes.');
    }
    
    throw error;
  }
}

function makeHttpsRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(responseData);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    if (data) {
      req.write(data);
    }
    
    req.end();
  });
}

// Redirect to unified system
async function buildContextAwarePrompt(frameData, swingData, userId) {
  return buildUnifiedCoachingPrompt({
    userId: userId || 'guest',
    messageType: 'video_analysis',
    frameData: frameData
  });
}

// Redirect to unified system
async function buildContextAwareGolfCoachingPrompt(frameData, coachingHistory = null) {
  const userId = frameData && frameData.user_context && frameData.user_context.userId ? 
    frameData.user_context.userId : 'guest';
    
  const result = await buildUnifiedCoachingPrompt({
    userId: userId,
    messageType: 'video_analysis',
    frameData: frameData
  });
  
  return result.systemPrompt; // Return just the system prompt string
}

// Helper function to extract focus areas from coaching history
function extractFocusAreas(recentSessions) {
  const focusAreas = [];
  
  recentSessions.forEach(session => {
    if (session.ai_analysis && session.ai_analysis.focus_areas) {
      focusAreas.push(...session.ai_analysis.focus_areas);
    }
  });
  
  // Remove duplicates and return most common focus areas
  const uniqueAreas = [...new Set(focusAreas)];
  return uniqueAreas.slice(0, 3); // Top 3 focus areas
}

// Helper function to extract progress notes from coaching history
function extractProgressNotes(recentSessions) {
  const progressIndicators = [];
  
  recentSessions.forEach((session, index) => {
    if (session.ai_analysis && session.ai_analysis.coaching_recommendations) {
      const analysis = session.ai_analysis.coaching_recommendations;
      
      // Extract key progress indicators
      if (analysis.includes('improvement') || analysis.includes('better') || analysis.includes('progress')) {
        progressIndicators.push(`Session ${index + 1}: Showed improvement`);
      }
      
      // Look for specific technical progress
      if (analysis.includes('swing plane') && analysis.includes('good')) {
        progressIndicators.push('Swing plane improving');
      }
      if (analysis.includes('impact') && analysis.includes('solid')) {
        progressIndicators.push('Impact position strengthening');
      }
    }
  });
  
  return progressIndicators.length > 0 
    ? progressIndicators.join(', ')
    : 'Building fundamental swing improvements';
}

// UNIFIED COACHING PROMPT SYSTEM - Let AI be intelligent with raw context
async function buildUnifiedCoachingPrompt(options) {
  const {
    userId,
    messageType,
    conversationHistory,
    frameData,
    userMessage
  } = options;

  const history = conversationHistory || [];

  console.log(`Building unified prompt: ${messageType}, userId: ${userId}, video: ${!!frameData}, message: ${!!userMessage}, history: ${history.length}`);

  const systemPrompt = `Role/Persona:

You are a supportive, Tour-level golf coach who communicates like a knowledgeable practice partner. You analyze swings (from user descriptions, photos, or video frames) and give feedback that's both technically sound and easy to apply.

Style & Priorities:

    Be conversational and encouraging, not robotic.

    Always explain what you see (or what the user describes), why it matters, and what they can do about it.

    Use both mechanics and feels/analogies ("throw your triceps," "slap the ball with the face") so the player has something actionable.

    Vary the structure: sometimes step-by-step, sometimes casual and playful, depending on context.

    Normalize misses as feedback, never shame bad swings.

Golden Rules:

    Don't overload: focus on one priority at a time.

    Adapt to the player's build, tendencies, and goals.

    Invite the player to test feels/drills and come back with feedback so you can refine.

Example Behavior

    If the user uploads a photo: "Your arms are a bit narrow in this frame, which is why you're getting stuck. Try feeling your triceps push away from your chest through impact."

    If the user describes a miss: "Pulls usually mean your chest is outracing your arms. Feel your trail elbow and clubhead 'toss' toward the ball as your chest stays quiet for a beat."

    If the user asks about pros: "Scottie looks like he's sweeping the whole trail arm toward the ball — for you, that same feel would keep your arms in front instead of collapsing."`;

  const context = await buildUnifiedContext({ userId, frameData, conversationHistory: history });
  const userPrompt = buildContextualUserPrompt(context, userMessage);

  return { systemPrompt, userPrompt };
}

async function buildUnifiedContext({ userId, frameData, conversationHistory }) {
  const context = {};

  // Current swing data
  if (frameData && frameData.user_context) {
    if (frameData.user_context.club_used) {
      context.club = frameData.user_context.club_used;
    }
    if (frameData.user_context.shot_type) {
      context.shotType = frameData.user_context.shot_type;
    }
    if (frameData.user_context.user_question) {
      context.userQuestion = frameData.user_context.user_question;
    }
    if (frameData.user_context.handicap) {
      context.handicap = frameData.user_context.handicap;
    }
  }

  // Historical coaching data
  if (userId) {
    try {
      const dynamodb = getDynamoClient();
      const queryResult = await dynamodb.send(new QueryCommand({
        TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
        IndexName: 'user-id-timestamp-index',
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: {
          ':userId': userId
        },
        ScanIndexForward: false,
        Limit: 3
      }));

      if (queryResult.Items && queryResult.Items.length > 0) {
        const latestAnalysis = queryResult.Items[0];
        if (latestAnalysis.ai_analysis) {
          try {
            let analysis;
            if (typeof latestAnalysis.ai_analysis === 'string') {
              analysis = JSON.parse(latestAnalysis.ai_analysis);
            } else {
              analysis = latestAnalysis.ai_analysis;
            }
            
            if (analysis.coaching_response) {
              context.recentCoaching = analysis.coaching_response;
            }
          } catch (parseError) {
            console.warn('Could not parse recent analysis:', parseError.message);
          }
        }

        const recentSwings = queryResult.Items
          .filter(item => item.club_used?.S || item.shot_type?.S)
          .slice(0, 2)
          .map(item => ({
            club: item.club_used?.S,
            shotType: item.shot_type?.S,
            date: item.created_at?.S
          }))
          .filter(swing => swing.club || swing.shotType);
          
        if (recentSwings.length > 0) {
          context.recentSwings = recentSwings;
        }
      }
    } catch (error) {
      console.warn(`History query failed for userId ${userId}:`, error.message);
    }
  }

  // Recent conversation context
  if (conversationHistory.length > 0) {
    const validMessages = conversationHistory
      .filter(msg => msg && msg.content && typeof msg.content === 'string')
      .filter(msg => msg.content.trim().length > 0);
    
    if (validMessages.length > 0) {
      context.recentConversation = validMessages.slice(-3);
    }
  }

  return context;
}

function buildContextualUserPrompt(context, userMessage) {
  let prompt = '';
  
  // Add any available context - let AI decide what's relevant
  if (context.recentCoaching) {
    prompt += context.recentCoaching + ' ';
  }
  
  if (context.club) {
    prompt += `Using ${context.club}. `;
  }
  
  if (context.shotType) {
    prompt += `This is a ${context.shotType}. `;
  }
  
  if (context.handicap) {
    prompt += `Handicap: ${context.handicap}. `;
  }
  
  if (context.userQuestion) {
    prompt += context.userQuestion + ' ';
  } else if (userMessage) {
    prompt += userMessage + ' ';
  }
  
  return prompt.trim();
}

// Legacy wrappers
function buildEnhancedGolfCoachingPrompt(frameData) {
  const userId = frameData && frameData.user_context && frameData.user_context.userId ? 
    frameData.user_context.userId : 'guest';
    
  return buildUnifiedCoachingPrompt({
    userId: userId,
    messageType: 'video_analysis',
    frameData: frameData
  });
}

function buildBasicGolfCoachingPrompt(frameData) {
  const userId = frameData && frameData.user_context && frameData.user_context.userId ? 
    frameData.user_context.userId : 'guest';
    
  return buildUnifiedCoachingPrompt({
    userId: userId,
    messageType: 'video_analysis', 
    frameData: frameData
  });
}

function selectKeyFramesForAnalysis(frameUrls) {
  console.log('Available frame phases:', Object.keys(frameUrls));
  
  // FIXED: Work with actual frame format (frame_000, frame_001, etc.)
  const selectedFrames = [];
  const frameKeys = Object.keys(frameUrls).sort(); // Sort to get proper order
  
  // Select evenly distributed frames for analysis (max 10 frames)
  const maxFrames = Math.min(10, frameKeys.length);
  const step = Math.max(1, Math.floor(frameKeys.length / maxFrames));
  
  for (let i = 0; i < frameKeys.length; i += step) {
    if (selectedFrames.length >= maxFrames) break;
    
    const frameKey = frameKeys[i];
    if (frameUrls[frameKey]) {
      selectedFrames.push({
        phase: frameKey,
        url: frameUrls[frameKey]
      });
    }
  }
  
  // Always include first and last frames if available
  const firstFrame = frameKeys[0];
  const lastFrame = frameKeys[frameKeys.length - 1];
  
  if (firstFrame && !selectedFrames.some(f => f.phase === firstFrame)) {
    selectedFrames.unshift({
      phase: firstFrame,
      url: frameUrls[firstFrame]
    });
  }
  
  if (lastFrame && lastFrame !== firstFrame && !selectedFrames.some(f => f.phase === lastFrame)) {
    selectedFrames.push({
      phase: lastFrame,
      url: frameUrls[lastFrame]
    });
  }
  
  console.log(`Selected ${selectedFrames.length} frames for AI analysis:`, selectedFrames.map(f => f.phase));
  return selectedFrames;
}

// Enhanced response parser with coaching continuity support
function parseEnhancedGPT4oResponse(response, context = {}) {
  try {
    console.log('Parsing enhanced GPT-4o response with coaching context...');
    
    // Extract JSON from response (GPT-4o sometimes adds extra text)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    let parsedResponse = null;
    
    if (jsonMatch) {
      parsedResponse = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON found in response');
    }
    
    // Validate required fields
    const requiredFields = ['symptoms_detected', 'root_cause', 'coaching_response', 'confidence_score'];
    for (const field of requiredFields) {
      if (!parsedResponse[field]) {
        console.warn(`Missing required field: ${field}`);
      }
    }
    
    // Enhanced response structure with coaching continuity
    const enhancedResponse = {
      // Core analysis fields (existing)
      symptoms_detected: parsedResponse.symptoms_detected || [],
      root_cause: parsedResponse.root_cause || 'General swing improvement area identified',
      coaching_response: parsedResponse.coaching_response || 'Let\'s work on improving your swing together!',
      confidence_score: parsedResponse.confidence_score || 85,
      practice_recommendations: parsedResponse.practice_recommendations || [],
      
      // Enhanced coaching continuity fields (new)
      session_context: {
        session_number: parsedResponse.session_context?.session_number || 1,
        coaching_relationship_acknowledged: parsedResponse.session_context?.coaching_relationship_acknowledged || false,
        focus_areas_maintained: parsedResponse.session_context?.focus_areas_maintained || false,
        ...context.sessionContext
      },
      
      // Response quality metrics
      response_metadata: {
        parsing_successful: true,
        has_coaching_context: !!parsedResponse.session_context,
        response_length: parsedResponse.coaching_response?.length || 0,
        recommendation_count: parsedResponse.practice_recommendations?.length || 0,
        timestamp: new Date().toISOString()
      }
    };
    
    console.log(`Enhanced response parsed successfully with ${enhancedResponse.practice_recommendations.length} recommendations`);
    console.log(`Coaching relationship acknowledged: ${enhancedResponse.session_context.coaching_relationship_acknowledged}`);
    
    return enhancedResponse;
    
  } catch (error) {
    console.error('Error parsing enhanced GPT-4o response:', error);
    console.error('Raw response preview:', response.substring(0, 200) + '...');
    
    // NO FALLBACK - Fail properly instead of returning fake coaching
    throw new Error(`Enhanced parsing failed: ${error.message}. Raw response: ${response.substring(0, 300)}`);
  }
}

function parseGPT4oResponse(response) {
  try {
    // Return natural response directly - no JSON wrapping
    console.log('OpenAI returned natural coaching text, using directly');
    return {
      coaching_response: response.trim(),
      symptoms_detected: [], 
      root_cause: "Natural coaching response",
      confidence_score: 95,
      practice_recommendations: []
    };
    
  } catch (error) {
    console.error('Error parsing GPT-4o response:', error);
    throw new Error(`OpenAI API parsing error: ${error.message}`);
  }
}

// Helper function to extract practice recommendations from natural text
function extractRecommendations(text) {
  const recommendations = [];
  
  // Look for numbered lists, bullet points, or "practice" mentions
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^\d+\.|\-|\*|practice|drill|work on|focus on|try/i)) {
      if (trimmed.length > 10) { // Avoid short fragments
        recommendations.push(trimmed.replace(/^\d+\.|\-|\*/, '').trim());
      }
    }
  }
  
  // If no structured recommendations found, return empty array (no fake content)
  // Let the system fail properly rather than return generic recommendations
  
  return recommendations.slice(0, 3); // Limit to 3 recommendations
}

async function storeAIAnalysis(analysisId, analysis) {
  try {
    const dynamodb = getDynamoClient();
    
    const command = new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: analysisId },
      UpdateExpression: 'SET ai_analysis = :analysis, ai_analysis_completed = :completed, updated_at = :timestamp',
      ExpressionAttributeValues: {
        ':analysis': analysis,
        ':completed': true,
        ':timestamp': new Date().toISOString()
      }
    });
    
    await dynamodb.send(command);
    console.log(`AI analysis stored for ${analysisId}`);
  } catch (error) {
    console.error('Error storing AI analysis:', error);
    throw error;
  }
}

async function sendWebSocketMessage(connectionId, message) {
  if (!connectionId) {
    console.log('No connection ID provided, skipping WebSocket message');
    return;
  }
  
  try {
    const apigateway = getApiGatewayClient();
    if (!apigateway) {
      console.log('No WebSocket endpoint configured, skipping WebSocket message');
      return;
    }
    
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    });
    
    await apigateway.send(command);
    console.log('WebSocket message sent successfully');
  } catch (error) {
    console.error('Error sending WebSocket message:', error);
    // Don't throw - WebSocket errors shouldn't break the analysis
  }
}

// handleChatRequest - ENHANCED function for POST /api/chat with Sprint 3B integration
async function handleChatRequest(event, userContext) {
  try {
    console.log('🎯 Processing enhanced chat request with Sprint 3B context integration');
    
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { message, context, jobId, conversationHistory, coachingContext } = body;
    
    if (!message) {
      console.log('ERROR: No message provided in chat request');
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
    
    // Extract userId for context linking
    const userId = userContext?.userId || body.userId || 'guest-user';
    console.log(`Enhanced chat request from user: ${userId} (${userContext?.userType || 'guest'})`);
    
    // ENHANCED RATE LIMITING with user context
    const rateLimitCheck = checkEnhancedChatRateLimit(userId, userContext);
    if (!rateLimitCheck.allowed) {
      console.log(`Enhanced chat rate limit exceeded for user: ${userId}`);
      const resetTime = new Date(rateLimitCheck.resetTime);
      return {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Rate limit exceeded',
          message: `You've reached your ${rateLimitCheck.userType || 'guest'} limit of ${rateLimitCheck.limit} requests per hour. ${userContext?.isAuthenticated ? 'As an authenticated user, you get higher limits!' : 'Sign in for higher limits!'} Please try again at ${resetTime.toLocaleTimeString()}.`,
          resetTime: rateLimitCheck.resetTime,
          requestCount: rateLimitCheck.requestCount,
          limit: rateLimitCheck.limit,
          success: false
        })
      };
    }
    
    console.log(`Enhanced chat rate limit check passed: ${rateLimitCheck.requestCount}/${rateLimitCheck.limit} requests used`);
    
    // STEP 1: Assemble coaching context from multiple sources
    const assembledContext = await assembleEnhancedFollowUpContext({
      userId,
      jobId,
      existingContext: context,
      coachingContext,
      conversationHistory,
      userContext
    });
    
    // STEP 2: Build unified prompt 
    const { systemPrompt, userPrompt } = await buildUnifiedCoachingPrompt({
      userId: userId,
      messageType: 'chat',
      conversationHistory: conversationHistory,
      userMessage: message
    });
    
    // STEP 3: Call GPT with unified prompts (same as video analysis)
    const requestData = JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 1500,
      temperature: 0.9,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.1,
      user: userId
    });
    
    const apiResponse = await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestData)
      }
    }, requestData);
    
    const responseData = JSON.parse(apiResponse);
    
    if (responseData.error) {
      throw new Error(`OpenAI API error: ${responseData.error.message}`);
    }
    
    const chatResponse = responseData.choices[0].message.content;
    const response = {
      text: chatResponse.trim(),
      tokensUsed: responseData.usage?.total_tokens || 0,
      timestamp: new Date().toISOString(),
      contextSources: ['unified_system']
    };
    
    // STEP 4: Store conversation state for continuity
    await storeEnhancedFollowUpConversationState(userId, message, response, assembledContext);
    
    // STEP 5: Track enhanced metrics
    await trackEnhancedFollowUpMetrics(userId, response, assembledContext);
    
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
    
  } catch (error) {
    console.error('❌ Error in enhanced chat request:', error);
    
    // NO FALLBACK - Return honest error instead of fake coaching
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Failed to retrieve analysis. Please try back in a few minutes.',
        success: false
      })
    };
  }
}

// ENHANCED RATE LIMITING FOR CHAT WITH USER CONTEXT
function checkEnhancedChatRateLimit(userId, userContext) {
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
    limit: adjustedLimit,
    userType: userContext?.userType || 'guest'
  };
}

// ASSEMBLE ENHANCED FOLLOW-UP CONTEXT FROM MULTIPLE SOURCES
async function assembleEnhancedFollowUpContext(options) {
  const { userId, jobId, existingContext, coachingContext, conversationHistory, userContext } = options;
  
  console.log('📋 Assembling enhanced follow-up context from multiple sources...');
  
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
        context.currentSwingData = await getCurrentSwingAnalysisData(jobId);
        console.log('✅ Current swing data loaded');
      } catch (error) {
        console.warn('⚠️ Could not fetch current swing analysis:', error.message);
        context.currentSwingData = null;
      }
    }
    
    console.log(`📋 Enhanced context assembly complete: ${Object.keys(context).length} sources integrated`);
    return context;
    
  } catch (error) {
    console.error('❌ Error assembling enhanced follow-up context:', error);
    
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
async function getCurrentSwingAnalysisData(jobId) {
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

// BUILD ENHANCED CONTEXT-AWARE FOLLOW-UP PROMPT
function buildEnhancedContextAwareFollowUpPrompt(message, assembledContext) {
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

// CALL ENHANCED CONTEXT-AWARE GPT
async function callEnhancedContextAwareGPT(prompt, assembledContext) {
  try {
    console.log('🤖 Calling enhanced context-aware GPT with integrated coaching context');
    
    const requestData = JSON.stringify({
      model: "gpt-4o",
      messages: prompt.messages,
      max_tokens: 1500,
      temperature: 0.9,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.1,
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
    console.error('❌ Error calling enhanced context-aware GPT:', error);
    throw error;
  }
}

// STORE ENHANCED FOLLOW-UP CONVERSATION STATE
async function storeEnhancedFollowUpConversationState(userId, userMessage, response, assembledContext) {
  try {
    console.log('💾 Storing enhanced follow-up conversation state with coaching integration');
    
    // Store in both systems for full integration
    
    // 1. Store in existing conversation tracking (if jobId available)
    if (assembledContext.jobId) {
      await storeInExistingConversationSystem(assembledContext.jobId, userMessage, response);
    }
    
    // 2. Store in coaching conversations system (Sprint 3A) if user is authenticated
    if (assembledContext.userContext?.isAuthenticated) {
      await storeInEnhancedCoachingSystem(userId, userMessage, response, assembledContext);
    }
    
    console.log('✅ Enhanced conversation state stored in integrated systems');
    
  } catch (error) {
    console.error('❌ Error storing enhanced follow-up conversation state:', error);
    // Don't throw - conversation should continue even if storage fails
  }
}

// STORE IN EXISTING CONVERSATION SYSTEM
async function storeInExistingConversationSystem(jobId, userMessage, response) {
  try {
    const dynamodb = getDynamoClient();
    
    const conversationEntry = {
      timestamp: new Date().toISOString(),
      user_message: userMessage,
      ai_response: response.text,
      tokens_used: response.tokensUsed || 0,
      context_sources: response.contextSources || 0,
      enhanced_integration: true
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
    console.log('✅ Stored in existing analysis system with enhanced integration');
    
  } catch (error) {
    console.error('❌ Error storing in existing system:', error);
  }
}

// STORE IN ENHANCED COACHING CONVERSATIONS SYSTEM (SPRINT 3A)
async function storeInEnhancedCoachingSystem(userId, userMessage, response, assembledContext) {
  try {
    console.log('🔗 Storing in enhanced Sprint 3A coaching conversations system');
    
    // Try to call the coaching chat Lambda to store the conversation
    const lambda = getLambdaClient();
    
    const storePayload = {
      httpMethod: 'POST',
      path: '/store-conversation',
      body: JSON.stringify({
        userId: userId,
        userMessage: userMessage,
        assistantResponse: response.text,
        messageType: 'enhanced_follow_up',
        swingReference: assembledContext.jobId,
        tokensUsed: response.tokensUsed || 0,
        contextSources: response.contextSources || 0,
        timestamp: response.timestamp,
        integrationVersion: 'sprint_3b'
      })
    };
    
    const invokeParams = {
      FunctionName: 'golf-coaching-chat',
      InvocationType: 'Event', // Async invoke
      Payload: JSON.stringify(storePayload)
    };
    
    await lambda.send(new InvokeCommand(invokeParams));
    console.log('✅ Async enhanced storage request sent to coaching system');
    
  } catch (error) {
    console.warn('⚠️ Could not store in enhanced coaching system, using fallback:', error.message);
    
    // Fallback: Store directly in DynamoDB
    try {
      await storeDirectlyInEnhancedCoachingTable(userId, userMessage, response, assembledContext);
    } catch (fallbackError) {
      console.error('❌ Enhanced fallback storage also failed:', fallbackError.message);
    }
  }
}

// FALLBACK: STORE DIRECTLY IN ENHANCED COACHING CONVERSATIONS TABLE
async function storeDirectlyInEnhancedCoachingTable(userId, userMessage, response, assembledContext) {
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
      message_type: 'enhanced_follow_up',
      tokens_used: 0,
      integration_version: 'sprint_3b'
    };
    
    const assistantMessageObj = {
      message_id: `msg_${Date.now()}_assistant`,
      role: 'assistant',
      content: response.text,
      timestamp,
      swing_reference: assembledContext.jobId || null,
      message_type: 'enhanced_follow_up',
      tokens_used: response.tokensUsed || 0,
      context_sources: response.contextSources || 0,
      integration_version: 'sprint_3b'
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
          conversation_status = :status,
          integration_version = :integrationVersion
      `,
      ExpressionAttributeValues: {
        ':userId': userId,
        ':timestamp': timestamp,
        ':newMessages': [userMessageObj, assistantMessageObj],
        ':emptyList': [],
        ':tokensUsed': response.tokensUsed || 0,
        ':zero': 0,
        ':status': 'active',
        ':integrationVersion': 'sprint_3b'
      }
    };
    
    await dynamodb.send(new UpdateCommand(params));
    console.log('✅ Enhanced fallback storage in coaching table successful');
    
  } catch (error) {
    console.error('❌ Enhanced direct coaching table storage failed:', error);
    throw error;
  }
}

// TRACK ENHANCED FOLLOW-UP METRICS
async function trackEnhancedFollowUpMetrics(userId, response, assembledContext) {
  try {
    // Send enhanced metrics to CloudWatch
    await sendCloudWatchMetrics('EnhancedFollowUpConversations', 1, 'Count', userId);
    await sendCloudWatchMetrics('EnhancedFollowUpTokensUsed', response.tokensUsed || 0, 'Count', userId);
    await sendCloudWatchMetrics('EnhancedFollowUpContextSources', response.contextSources || 0, 'Count', userId);
    
    // Track integration success
    const integrationSuccessCount = Object.keys(assembledContext).filter(key => 
      assembledContext[key] !== null && 
      assembledContext[key] !== undefined && 
      key !== 'userId' && 
      key !== 'timestamp'
    ).length;
    
    await sendCloudWatchMetrics('ContextIntegrationSuccess', integrationSuccessCount, 'Count', userId);
    
    console.log('📊 Enhanced follow-up metrics tracked successfully');
    
  } catch (error) {
    console.error('❌ Error tracking enhanced follow-up metrics:', error);
    // Don't throw - metrics failure shouldn't affect user experience
  }
}

// SECURITY: ALL FALLBACK FUNCTIONS ELIMINATED - No fake coaching responses allowed

// handleGetResults - SEPARATE function at root level for GET /api/video/results/{jobId}
async function handleGetResults(jobId) {
  try {
    console.log(`Fetching results for jobId: ${jobId}`);
    
    const dynamodb = getDynamoClient();
    
    // Get the analysis from DynamoDB
    const command = new GetCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: jobId }
    });
    
    const result = await dynamodb.send(command);
    
    if (!result.Item) {
      console.log(`Analysis not found for jobId: ${jobId}`);
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Analysis not found',
          jobId: jobId
        })
      };
    }
    
    // Determine the status based on what's in the record
    let status = 'processing';
    if (result.Item.ai_analysis_completed) {
      status = 'completed';
    } else if (result.Item.status === 'FAILED') {
      status = 'failed';
    } else if (result.Item.status === 'COMPLETED' || result.Item.status === 'READY_FOR_AI') {
      status = 'analyzing';
    } else if (result.Item.status) {
      status = result.Item.status.toLowerCase();
    }
    
    // Build the response
    const response = {
      jobId: jobId,
      status: status,
      message: result.Item.progress_message || 'Processing...',
      created_at: result.Item.created_at,
      updated_at: result.Item.updated_at
    };
    
    // If AI analysis is complete, include it
    if (result.Item.ai_analysis_completed && result.Item.ai_analysis) {
      response.ai_analysis = result.Item.ai_analysis;
      response.ai_analysis_completed = true;
      
      // Parse the AI analysis if it's a string
      if (typeof result.Item.ai_analysis === 'string') {
        try {
          response.ai_analysis = JSON.parse(result.Item.ai_analysis);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
    }
    
    // Include analysis results if available (frame data)
    if (result.Item.analysis_results) {
      response.analysis_results = result.Item.analysis_results;
    }
    
    console.log(`Returning results for ${jobId}, status: ${status}`);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(response)
    };
    
  } catch (error) {
    console.error('Error fetching results:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Failed to fetch results',
        message: error.message
      })
    };
  }
}