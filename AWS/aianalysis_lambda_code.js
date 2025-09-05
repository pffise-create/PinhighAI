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
  // For DynamoDB streams, we MUST get real user context
  if (event.Records && event.Records.length > 0) {
    const record = event.Records[0];
    
    if (record.eventSource === 'aws:dynamodb') {
      const newImage = record.dynamodb?.NewImage;
      
      if (!newImage) {
        throw new Error('DynamoDB stream missing NewImage data');
      }
      
      const userId = newImage.user_id?.S;
      if (!userId) {
        throw new Error('DynamoDB stream missing user_id');
      }
      
      return {
        isAuthenticated: newImage.is_authenticated?.BOOL || false,
        userId: userId,
        email: newImage.user_email?.S || null,
        name: newImage.user_name?.S || 'Guest User',
        userType: newImage.user_type?.S || 'guest'
      };
    }
  }
  
  // For HTTP requests, check for Authorization header
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  
  if (authHeader) {
    const tokenValidation = await validateToken(authHeader);
    if (tokenValidation.valid) {
      return {
        isAuthenticated: true,
        userId: tokenValidation.userId,
        email: tokenValidation.email,
        name: tokenValidation.name,
        userType: 'authenticated'
      };
    }
  }
  
  // Fallback for HTTP requests without valid auth
  return {
    isAuthenticated: false,
    userId: 'guest-user',
    email: null,
    name: 'Guest User',
    userType: 'guest'
  };
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
  console.log('LAMBDA START - Event:', JSON.stringify(event, null, 2));
  console.log('LAMBDA START - Environment Check:', {
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    dynamoTable: process.env.DYNAMODB_TABLE,
    userThreadsTable: process.env.USER_THREADS_TABLE
  });
  console.log('LAMBDA START - Event type:', event.Records ? 'DynamoDB_Stream' : 'HTTP_Request');
  
  try {
    // Extract user context from the request (handles both authenticated and guest users)
    const userContext = await extractUserContext(event);
    console.log('USER CONTEXT:', userContext);
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
      console.log('DYNAMO STREAM: Detected', event.Records.length, 'records');
      console.log('DYNAMO RECORD:', JSON.stringify(event.Records[0], null, 2));
      
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
            console.log('FUNCTION CHECK: processSwingAnalysis type:', typeof processSwingAnalysis);
            console.log('FUNCTION CHECK: processSwingAnalysis exists:', processSwingAnalysis !== undefined);
            console.log('FUNCTION CHECK: swingData:', JSON.stringify(swingData, null, 2));
            try {
              console.log('CALLING processSwingAnalysis...');
              await processSwingAnalysis(swingData);
              console.log('SUCCESS: processSwingAnalysis completed');
            } catch (processError) {
              console.error('ERROR in processSwingAnalysis:', processError);
              console.error('ERROR stack:', processError.stack);
              console.error('ERROR name:', processError.name);
              console.error('ERROR message:', processError.message);
            }
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
      FunctionName: 'golf-coach-frame-extractor-v2', // Use working Docker version with 0.1s intervals
      InvocationType: 'Event', // Asynchronous invocation
      Payload: JSON.stringify(frameExtractionPayload)
    });
    
    await lambdaClient.send(invokeCommand);
    console.log(`Successfully triggered Docker frame extraction for ${analysisId}`);
    
    console.log(`SUCCESS: Frame extraction trigger completed for ${analysisId}, Docker Lambda will process it`);
    
  } catch (error) {
    console.error(`ERROR: Frame extraction failed for ${analysisId}:`, error);
    
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

// PROCESS SWING ANALYSIS - Called by DynamoDB stream when frame extraction completes
async function processSwingAnalysis(swingData) {
  try {
    console.log('DIAGNOSTIC: processSwingAnalysis function called');
    console.log('DIAGNOSTIC: swingData parameter:', JSON.stringify(swingData, null, 2));
    console.log('STEP 1: Processing swing analysis from DynamoDB stream trigger...');
    
    const analysisId = swingData.analysis_id?.S;
    const status = swingData.status?.S;
    
    if (!analysisId) {
      console.error('ERROR: STEP 1 FAILED: No analysis_id found in DynamoDB record');
      console.error('swingData structure:', JSON.stringify(swingData, null, 2));
      return;
    }
    
    console.log(`INFO: STEP 2: Starting AI analysis for: ${analysisId}, status: ${status}`);
    
    // Get the full analysis data from DynamoDB to prepare for AI analysis
    console.log('STEP STEP 3: Getting DynamoDB client...');
    const dynamodb = getDynamoClient();
    
    console.log(`STEP STEP 4: Fetching full record for ${analysisId}...`);
    const result = await dynamodb.send(new GetCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: analysisId }
    }));
    
    if (!result.Item) {
      console.error(`ERROR: STEP 4 FAILED: Analysis record not found: ${analysisId}`);
      console.error('DynamoDB result:', JSON.stringify(result, null, 2));
      return;
    }
    
    console.log('SUCCESS: STEP 4 SUCCESS: Got full record from DynamoDB');
    const fullSwingData = result.Item;
    
    // Check if frame data exists
    const frameData = fullSwingData.analysis_results?.M;
    if (!frameData || !frameData.frames?.L) {
      console.error(`ERROR: No frame data found for analysis: ${analysisId}`);
      return;
    }
    
    console.log(`SUCCESS: Found ${frameData.frames.L.length} frames for AI analysis`);
    
    // Convert DynamoDB format to expected format for analyzeSwingWithGPT4o
    const frame_urls = {};
    frameData.frames.L.forEach(frame => {
      const frameMap = frame.M;
      if (frameMap.phase?.S && frameMap.url?.S) {
        frame_urls[frameMap.phase.S] = frameMap.url.S;
      }
    });
    
    // Create the expected frameData structure
    const convertedFrameData = {
      frame_urls: frame_urls,
      // Include other frame metadata if needed
      video_duration: frameData.video_duration?.N ? parseFloat(frameData.video_duration.N) : null,
      fps: frameData.fps?.N ? parseFloat(frameData.fps.N) : null,
      frames_extracted: frameData.frames_extracted?.N ? parseInt(frameData.frames_extracted.N) : frameData.frames.L.length
    };
    
    console.log(`SUCCESS: STEP 6/7 SUCCESS: Converted ${Object.keys(frame_urls).length} frame URLs for AI analysis`);
    console.log('Sample frame URLs:', Object.keys(frame_urls).slice(0, 3));
    
    // Call our unified threading AI analysis function with converted data
    console.log('STEP STEP 8: Calling analyzeSwingWithGPT4o...');
    const aiResult = await analyzeSwingWithGPT4o(convertedFrameData, fullSwingData);
    console.log('SUCCESS: STEP 8 COMPLETED: analyzeSwingWithGPT4o returned result');
    
    console.log('STEP STEP 9: Processing AI analysis result...');
    console.log('aiResult type:', typeof aiResult);
    console.log('aiResult keys:', aiResult ? Object.keys(aiResult) : 'NULL');
    console.log('aiResult.response exists:', !!aiResult?.response);
    
    if (aiResult && aiResult.response) {
      console.log(`SUCCESS: STEP 9 SUCCESS: AI analysis completed successfully for: ${analysisId}`);
      
      console.log('STEP STEP 10: Updating DynamoDB with AI results...');
      // Update the record with AI analysis results
      await dynamodb.send(new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
        Key: { analysis_id: analysisId },
        UpdateExpression: 'SET ai_analysis = :analysis, ai_analysis_completed = :completed, #status = :status, progress_message = :progress, updated_at = :timestamp',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':analysis': JSON.stringify(aiResult),
          ':completed': true,
          ':status': 'AI_COMPLETED',
          ':progress': 'AI coaching analysis completed successfully',
          ':timestamp': new Date().toISOString()
        }
      }));
      
      console.log(`🎉 STEP 10 SUCCESS: Analysis fully completed for: ${analysisId}`);
    } else {
      console.error(`ERROR: STEP 9 FAILED: AI analysis returned invalid result for: ${analysisId}`);
      console.error('Full aiResult:', JSON.stringify(aiResult, null, 2));
    }
    
  } catch (error) {
    console.error('ERROR: Error in processSwingAnalysis:', error);
    
    // Update status to indicate failure
    try {
      const dynamodb = getDynamoClient();
      await dynamodb.send(new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
        Key: { analysis_id: swingData.analysis_id?.S },
        UpdateExpression: 'SET #status = :status, progress_message = :progress, updated_at = :timestamp',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':progress': `AI analysis failed: ${error.message}`,
          ':timestamp': new Date().toISOString()
        }
      }));
    } catch (updateError) {
      console.error('Failed to update error status:', updateError);
    }
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
  try {
    console.log('DIAGNOSTIC: Starting analyzeSwingWithGPT4o function');
    console.log('DIAGNOSTIC: Input frameData type:', typeof frameData);
    console.log('DIAGNOSTIC: Input swingData type:', typeof swingData);
    console.log('DIAGNOSTIC: swingData structure:', JSON.stringify(swingData, null, 2));
    
    if (!process.env.OPENAI_API_KEY) {
      console.error('DIAGNOSTIC: OPENAI_API_KEY environment variable not set');
      throw new Error('OPENAI_API_KEY environment variable not set');
    }
    console.log('DIAGNOSTIC: OpenAI API key exists:', !!process.env.OPENAI_API_KEY);

    // 1. Extract userId from swingData with detailed logging
    console.log('DIAGNOSTIC: Extracting analysisId and userId from swingData...');
    const analysisId = swingData.analysis_id?.S;
    const userId = swingData.user_id?.S;
    
    console.log('DIAGNOSTIC: Extracted analysisId:', analysisId);
    console.log('DIAGNOSTIC: Extracted userId:', userId);
    console.log('DIAGNOSTIC: userId type:', typeof userId);
    console.log('DIAGNOSTIC: userId is null/undefined:', userId == null);
    console.log('DIAGNOSTIC: userId is empty string:', userId === '');
    
    if (!userId) {
      console.error('DIAGNOSTIC: userId validation failed - userId is required for user thread management');
      throw new Error('userId is required for user thread management');
    }
    
    console.log(`DIAGNOSTIC: Processing swing analysis for user: ${userId}`);
    
    // 2. Check for existing user thread with comprehensive error handling
    console.log('DIAGNOSTIC: About to call getUserThread with userId:', userId);
    let userThreadData;
    try {
      userThreadData = await getUserThread(userId);
      console.log('DIAGNOSTIC: getUserThread returned successfully');
      console.log('DIAGNOSTIC: userThreadData:', JSON.stringify(userThreadData, null, 2));
    } catch (getUserThreadError) {
      console.error('DIAGNOSTIC: getUserThread failed with error:', getUserThreadError);
      console.error('DIAGNOSTIC: getUserThread error name:', getUserThreadError.name);
      console.error('DIAGNOSTIC: getUserThread error message:', getUserThreadError.message);
      console.error('DIAGNOSTIC: getUserThread error stack:', getUserThreadError.stack);
      throw getUserThreadError;
    }
    let threadId = userThreadData?.thread_id;
    
    // 3. If no thread exists, create new OpenAI thread with coaching system prompt
    if (!threadId) {
      console.log(`Creating new coaching thread for user ${userId}`);
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
        created_at: new Date().toISOString()
      };
      await storeUserThread(userId, userThreadData);
    } else {
      console.log(`Using existing thread ${threadId} for user ${userId}`);
    }
    
    // 4. Send ALL frames from frameData.frame_urls to existing/new thread
    const allFrameUrls = frameData.frame_urls || {};
    const allFrames = Object.keys(allFrameUrls).sort().map(frameKey => ({
      phase: frameKey,
      url: allFrameUrls[frameKey]
    }));
    
    if (allFrames.length === 0) {
      throw new Error('No valid frame URLs found for analysis');
    }
    
    console.log(`Sending ALL ${allFrames.length} frames to user thread ${threadId}`);
    
    // Download and convert ALL images to base64
    const base64Images = [];
    for (const frame of allFrames) {
      try {
        const base64Image = await downloadAndCompressImage(frame.url);
        base64Images.push({
          phase: frame.phase,
          image: base64Image
        });
      } catch (error) {
        console.warn(`Failed to download frame ${frame.phase}:`, error.message);
      }
    }
    
    if (base64Images.length === 0) {
      throw new Error('No frame images could be downloaded and converted');
    }
    
    // 5. Enhanced prompt: "Analyze this swing and identify 6-8 key frames. Reference previous swings if this helps with progression."
    const messageContent = [
      {
        type: "text",
        text: `Analyze this swing and identify 6-8 key frames. Reference previous swings if this helps with progression.

Provide comprehensive coaching advice, then end with key frames in this format:
KEY_FRAMES: frame_001,frame_008,frame_015,frame_022,frame_029,frame_036

Select the most critical frames showing key swing positions.`
      }
    ];
    
    // Add all frames with labels
    base64Images.forEach(frame => {
      messageContent.push({
        type: "text", 
        text: `Frame: ${frame.phase}`
      });
      messageContent.push({
        type: "image_url",
        image_url: {
          url: frame.image,
          detail: "high"
        }
      });
    });
    
    // Add message to thread
    await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: `/v1/threads/${threadId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      }
    }, JSON.stringify({ role: 'user', content: messageContent }));
    
    // Create and run assistant
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
      name: 'Golf Swing Coach',
      instructions: 'You are a professional golf coach analyzing swing videos. Provide natural, conversational coaching advice.',
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
      max_completion_tokens: 2500,
      temperature: 0.7
    }));
    
    const run = JSON.parse(runResponse);
    
    // Wait for completion
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
    
    // Get response
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
    const aiResponse = messages.data[0].content[0].text.value;
    
    // 6. Parse response to extract coaching text + key frame list
    const keyFrameMatch = aiResponse.match(/KEY_FRAMES:\s*([^\n\r]+)/);
    const keyFrames = keyFrameMatch ? keyFrameMatch[1].split(',').map(f => f.trim()) : [];
    const coachingText = aiResponse.replace(/KEY_FRAMES:.*$/g, '').trim();
    
    console.log(`Parsed ${keyFrames.length} key frames for curation`);
    
    // 7. Use OpenAI Threads API to delete non-key frame messages immediately
    let deletedCount = 0;
    for (const message of messages.data) {
      if (message.role === 'user' && message.content) {
        const frameMatch = message.content.find(c => c.type === 'text' && c.text.value.startsWith('Frame: '));
        if (frameMatch) {
          const frameId = frameMatch.text.value.replace('Frame: ', '');
          if (!keyFrames.includes(frameId)) {
            await makeHttpsRequest({
              hostname: 'api.openai.com',
              path: `/v1/threads/${threadId}/messages/${message.id}`,
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'OpenAI-Beta': 'assistants=v2'
              }
            });
            deletedCount++;
          }
        }
      }
    }
    console.log(`Frame curation complete: deleted ${deletedCount} non-key frames`);
    
    // 8. Update user thread metadata with new swing analysis
    const swingMetadata = {
      analysis_id: analysisId,
      date: new Date().toISOString(),
      key_frames: keyFrames
    };
    await addSwingToUserHistory(userId, swingMetadata);
    
    console.log(`User thread swing analysis completed for ${userId}`);
    
    // Function should work with existing storeAIAnalysis() for response storage
    const analysisResult = {
      coaching_response: coachingText,
      thread_id: threadId,
      selected_frames: keyFrames,
      symptoms_detected: [],
      root_cause: null,
      confidence_score: null,
      practice_recommendations: []
    };
    
    // 9. Return coaching response for immediate display
    return analysisResult;
    
  } catch (error) {
    console.error('Error in user thread swing analysis:', error);
    
    // Function should maintain existing error handling patterns
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

  const systemPrompt = `You are a supportive, Tour-level golf coach who communicates like a knowledgeable practice partner. You can have normal conversations AND provide swing coaching when appropriate.

🔥 CONVERSATIONAL INTELLIGENCE - READ THE ROOM:

SIMPLE QUESTIONS → SIMPLE ANSWERS:
- "What was my last question about?" → Just answer what they asked about, don't coach
- "Can you clarify that?" → Provide the clarification they need
- "Thanks for the tip!" → Acknowledge naturally, maybe ask how it felt
- "What do you mean by..." → Explain the concept they're asking about
- Casual follow-ups → Match their casual energy with friendly responses

COACHING QUESTIONS → COACHING RESPONSES:
- "How can I fix my slice?" → Full coaching mode activated
- "What should I work on?" → Analyze their swing and provide coaching
- "I'm still having trouble with..." → Dive into technical coaching
- Questions about technique, improvement, drills, or swing mechanics → Coach them

BE CONVERSATIONAL FIRST, COACH SECOND:
- Don't force every response into swing analysis format
- If they're asking a simple question about previous conversation, just answer it naturally
- Only provide full swing coaching when they're specifically asking about technique or improvement  
- Match their energy - casual questions get casual answers, coaching questions get coaching responses
- You can chat normally while being ready to coach when they need it

ASSESS & ADAPT YOUR COMMUNICATION:
- If they ask technical questions → give detailed, analytical responses
- If they seem frustrated → be encouraging and supportive  
- If they're casual/conversational → match their energy and be playful
- If they want direct feedback → be straightforward, skip the fluff
- Vary your structure: sometimes step-by-step, sometimes casual, depending on context

VIDEO-SPECIFIC ROOT CAUSE COACHING:
- Always reference what you actually observed in THEIR swing frames: "I noticed in your backswing..." "Looking at your impact position..."
- Identify the underlying fundamental causing multiple issues you saw
- Connect observed symptoms: "Your over-the-top move and early extension both stem from what I see at P4..."
- Focus on maximum 2 things: the root cause + one secondary issue from their video
- Use specific swing positions (P1-P10) when relevant: "At P7, I can see..."

COACHING APPROACH:
- Always explain what you see, why it matters, and what they can do about it
- Use both mechanics and feels/analogies ("*feel like you're throwing your triceps*," "*slap the ball with the face*")
- Normalize misses as feedback, never shame bad swings
- Adapt to the player's tendencies and goals you observe
- Invite them to test feels/drills and come back with feedback so you can refine

ENGAGEMENT & INFORMATION GATHERING:
- End most responses with a thoughtful question that helps you learn more about their golf game
- Ask about their experience with the swing feel or drill you suggested
- Inquire about their ball flight, miss patterns, or what they've tried before
- Questions should feel natural and coaching-focused, not forced
- Examples: "How does that feel when you try it?" "What's your typical miss with this club?" "Have you noticed this happening with other clubs too?"
- Use questions to deepen the coaching relationship and gather context for better future advice

FORMATTING FOR CLARITY:
- **Bold key swing concepts** and root causes you identified
- Use *italics* for feels/sensations ("*feel like you're stepping into a throw*")
- Lists for drills when helpful, but keep conversational in casual chat
- Keep paragraphs short for mobile readability
- Use emojis naturally to enhance communication, but don't overdo it

RESPONSE STRUCTURE (COACHING MODE ONLY):
When they're asking for swing coaching, use this structure:
1. Encouraging acknowledgment of what you saw them doing well in their swing
2. Root cause from their video: "I noticed..." with **bold fundamental** and why it creates the symptoms you observed
3. Secondary insight from their swing (if needed)
4. *Actionable feel/analogy* for fixing what you saw
5. Invitation to test and report back OR coaching question to gather more information

RESPONSE STRUCTURE (CONVERSATIONAL MODE):
When they're asking simple questions or having casual conversation:
- Just answer their question naturally
- Be friendly and helpful
- Don't force coaching structure
- You can still reference previous coaching context if relevant
- Keep it conversational and natural

When providing swing coaching, always reference their actual swing video, never give generic golf advice. Be their knowledgeable practice partner who can both chat naturally and provide expert coaching when they need it.`;

  const context = await buildUnifiedContext({ userId, frameData, conversationHistory: history });
  const userPrompt = buildContextualUserPrompt(context, userMessage);

  // Build complete messages array with conversation history integration
  const messages = [
    { role: "system", content: systemPrompt }
  ];

  // Add conversation history if available (for chat interactions)
  if (history && history.length > 0 && messageType === 'chat') {
    console.log(`🗣️ Adding ${history.length} conversation history messages to context`);
    
    // Add the conversation history messages
    history.forEach(msg => {
      if (msg.role && msg.content && msg.content.trim()) {
        messages.push({
          role: msg.role,
          content: msg.content.trim()
        });
      }
    });
  }

  // Add the current user message
  if (userMessage && userMessage.trim()) {
    messages.push({ role: "user", content: userMessage.trim() });
  } else if (userPrompt && userPrompt.trim()) {
    messages.push({ role: "user", content: userPrompt.trim() });
  }

  return { 
    systemPrompt, 
    userPrompt, 
    messages // Complete messages array for OpenAI API
  };
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

// Parse dual response (coaching + P1-P10 frame selection)
async function parseDualResponse(aiResponse) {
  try {
    console.log('Parsing dual response for coaching and P1-P10 frame selection...');
    
    // Try to extract JSON from response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsedResponse = JSON.parse(jsonMatch[0]);
      
      // Validate that we have both coaching response and selected frames
      if (parsedResponse.coaching_response && parsedResponse.selected_frames) {
        console.log('Successfully parsed dual response with coaching and P1-P10 frames');
        return {
          coaching_response: parsedResponse.coaching_response,
          selected_frames: parsedResponse.selected_frames,
          frame_explanations: parsedResponse.frame_explanations || {}
        };
      }
    }
    
    // Fallback: if JSON parsing fails, return raw response as coaching
    console.log('JSON parsing failed, using raw response as coaching');
    return {
      coaching_response: aiResponse.trim(),
      selected_frames: {},
      frame_explanations: {}
    };
    
  } catch (error) {
    console.error('Error parsing dual response:', error);
    // Fallback: return raw response
    return {
      coaching_response: aiResponse.trim(),
      selected_frames: {},
      frame_explanations: {}
    };
  }
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
    
    // Enhanced storage: Save both coaching response and selected P1-P10 frames
    const updateExpression = 'SET ai_analysis = :analysis, ai_analysis_completed = :completed, updated_at = :timestamp';
    const expressionAttributeValues = {
      ':analysis': analysis,
      ':completed': true,
      ':timestamp': new Date().toISOString()
    };
    
    // Add P1-P10 frame selections if available
    if (analysis.selected_frames && Object.keys(analysis.selected_frames).length > 0) {
      updateExpression += ', selected_frames = :frames';
      expressionAttributeValues[':frames'] = analysis.selected_frames;
      console.log('Storing P1-P10 frame selections:', Object.keys(analysis.selected_frames).join(', '));
    }
    
    // Add frame explanations if available
    if (analysis.frame_explanations && Object.keys(analysis.frame_explanations).length > 0) {
      updateExpression += ', frame_explanations = :explanations';
      expressionAttributeValues[':explanations'] = analysis.frame_explanations;
    }
    
    const command = new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: analysisId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues
    });
    
    await dynamodb.send(command);
    console.log(`Enhanced AI analysis with P1-P10 frames stored for ${analysisId}`);
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
    console.log('Starting user thread chat continuation...');
    
    // 1. Parse request body to extract: message, userId
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { message } = body;
    const userId = userContext?.userId || body.userId || 'guest-user';
    
    // 2. Basic input validation only
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
    
    // 3. Get user's existing thread: getUserThread(userId)
    let userThreadData = await getUserThread(userId);
    let threadId = userThreadData?.thread_id;
    
    // 4. If no thread exists, create general coaching thread (no swing context)
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
        created_at: new Date().toISOString()
      };
      await storeUserThread(userId, userThreadData);
    } else {
      console.log(`Using existing thread ${threadId} for user ${userId}`);
    }
    
    // 5. Add user's message to their OpenAI thread
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
    
    // 6. Call OpenAI API with thread continuation (no additional context needed)
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
    
    // Wait for completion
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
    
    // Get response
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
    
    // 7. Parse AI response and return formatted result
    const chatResponse = messages.data[0].content[0].text.value;
    
    // 8. Update thread metadata (last_updated, message_count)
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


// REMOVED: fetchCoachingConversationsFromAPI - tried to access non-existent golf-coaching-chat Lambda
// All conversation retrieval now handled by fetchRecentConversationsSimple() function above

// USER THREAD MANAGEMENT FUNCTIONS FOR UNIFIED THREADING
async function getUserThread(userId) {
  try {
    console.log('DIAGNOSTIC: getUserThread called with userId:', userId);
    console.log('DIAGNOSTIC: userId type:', typeof userId);
    console.log('DIAGNOSTIC: USER_THREADS_TABLE env var:', process.env.USER_THREADS_TABLE);
    
    const tableName = process.env.USER_THREADS_TABLE || 'golf-user-threads';
    console.log('DIAGNOSTIC: Using table name:', tableName);
    
    console.log('DIAGNOSTIC: Getting DynamoDB client...');
    const dynamodb = getDynamoClient();
    console.log('DIAGNOSTIC: DynamoDB client obtained successfully');
    
    console.log('DIAGNOSTIC: Creating GetCommand with key structure:', { user_id: userId });
    const getCommand = new GetCommand({
      TableName: tableName,
      Key: { user_id: userId }
    });
    console.log('DIAGNOSTIC: GetCommand created successfully');
    
    console.log('DIAGNOSTIC: Sending GetCommand to DynamoDB...');
    const response = await dynamodb.send(getCommand);
    console.log('DIAGNOSTIC: DynamoDB response received');
    console.log('DIAGNOSTIC: DynamoDB response structure:', JSON.stringify(response, null, 2));
    
    if (response.Item) {
      console.log('DIAGNOSTIC: Found existing thread for user:', userId);
      console.log('DIAGNOSTIC: Thread data:', JSON.stringify(response.Item, null, 2));
      return response.Item;
    } else {
      console.log('DIAGNOSTIC: No existing thread found for user:', userId);
      return null;
    }
    
  } catch (error) {
    console.error('DIAGNOSTIC: getUserThread error occurred');
    console.error('DIAGNOSTIC: Error type:', typeof error);
    console.error('DIAGNOSTIC: Error name:', error.name);
    console.error('DIAGNOSTIC: Error message:', error.message);
    console.error('DIAGNOSTIC: Error code:', error.code);
    console.error('DIAGNOSTIC: Error statusCode:', error.statusCode);
    console.error('DIAGNOSTIC: Error stack:', error.stack);
    console.error('DIAGNOSTIC: Full error object:', JSON.stringify(error, null, 2));
    
    // Don't return null, let the error propagate so we can see what's happening
    throw error;
  }
}

async function storeUserThread(userId, threadData) {
  try {
    console.log(`💾 Storing user thread for: ${userId}`);
    
    const dynamodb = getDynamoClient();
    const item = {
      user_id: userId,
      thread_id: threadData.thread_id,
      created_at: threadData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      swing_count: threadData.swing_count || 0,
      last_activity: new Date().toISOString()
    };
    
    await dynamodb.send(new PutCommand({
      TableName: process.env.USER_THREADS_TABLE || 'golf-user-threads',
      Item: item
    }));
    
    console.log(`SUCCESS: Stored thread mapping: ${userId} -> ${threadData.thread_id}`);
    return true;
    
  } catch (error) {
    console.error(`ERROR: Error storing user thread for ${userId}:`, error);
    return false;
  }
}

async function addSwingToUserHistory(userId, swingMetadata) {
  try {
    console.log(`📈 Adding swing to history for user: ${userId}`);
    
    const dynamodb = getDynamoClient();
    
    // Increment swing count and update last activity
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.USER_THREADS_TABLE || 'golf-user-threads',
      Key: { user_id: userId },
      UpdateExpression: 'ADD swing_count :inc SET last_activity = :timestamp, last_swing_id = :swing_id',
      ExpressionAttributeValues: {
        ':inc': 1,
        ':timestamp': new Date().toISOString(),
        ':swing_id': swingMetadata.analysis_id
      }
    }));
    
    console.log(`SUCCESS: Updated swing history for user: ${userId}`);
    return true;
    
  } catch (error) {
    console.error(`ERROR: Error adding swing to user history for ${userId}:`, error);
    return false;
  }
}

// Removed duplicate processSwingAnalysis function - using enhanced version above

// GET CURRENT SWING ANALYSIS DATA
async function getCurrentSwingAnalysisData(jobId) {
  try {
    
    const analysisId = swingData.analysis_id?.S;
    const status = swingData.status?.S;
    
    if (!analysisId) {
      console.error('ERROR: STEP 1 FAILED: No analysis_id found in DynamoDB record');
      console.error('swingData structure:', JSON.stringify(swingData, null, 2));
      return;
    }
    
    console.log(`INFO: STEP 2: Starting AI analysis for: ${analysisId}, status: ${status}`);
    
    // Get the full analysis data from DynamoDB to prepare for AI analysis
    console.log('STEP STEP 3: Getting DynamoDB client...');
    const dynamodb = getDynamoClient();
    
    console.log(`STEP STEP 4: Fetching full record for ${analysisId}...`);
    const result = await dynamodb.send(new GetCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: analysisId }
    }));
    
    if (!result.Item) {
      console.error(`ERROR: STEP 4 FAILED: Analysis record not found: ${analysisId}`);
      console.error('DynamoDB result:', JSON.stringify(result, null, 2));
      return;
    }
    
    console.log('SUCCESS: STEP 4 SUCCESS: Got full record from DynamoDB');
    const fullSwingData = result.Item;
    
    // Check if frame data exists
    const frameData = fullSwingData.analysis_results?.M;
    if (!frameData || !frameData.frames?.L) {
      console.error(`ERROR: No frame data found for analysis: ${analysisId}`);
      return;
    }
    
    console.log(`SUCCESS: Found ${frameData.frames.L.length} frames for AI analysis`);
    
    // Convert DynamoDB format to expected format for analyzeSwingWithGPT4o
    const frame_urls = {};
    frameData.frames.L.forEach(frame => {
      const frameMap = frame.M;
      if (frameMap.phase?.S && frameMap.url?.S) {
        frame_urls[frameMap.phase.S] = frameMap.url.S;
      }
    });
    
    // Create the expected frameData structure
    const convertedFrameData = {
      frame_urls: frame_urls,
      // Include other frame metadata if needed
      video_duration: frameData.video_duration?.N ? parseFloat(frameData.video_duration.N) : null,
      fps: frameData.fps?.N ? parseFloat(frameData.fps.N) : null,
      frames_extracted: frameData.frames_extracted?.N ? parseInt(frameData.frames_extracted.N) : frameData.frames.L.length
    };
    
    console.log(`SUCCESS: STEP 6/7 SUCCESS: Converted ${Object.keys(frame_urls).length} frame URLs for AI analysis`);
    console.log('Sample frame URLs:', Object.keys(frame_urls).slice(0, 3));
    
    // Call our unified threading AI analysis function with converted data
    console.log('STEP STEP 8: Calling analyzeSwingWithGPT4o...');
    const aiResult = await analyzeSwingWithGPT4o(convertedFrameData, fullSwingData);
    console.log('SUCCESS: STEP 8 COMPLETED: analyzeSwingWithGPT4o returned result');
    
    console.log('STEP STEP 9: Processing AI analysis result...');
    console.log('aiResult type:', typeof aiResult);
    console.log('aiResult keys:', aiResult ? Object.keys(aiResult) : 'NULL');
    console.log('aiResult.response exists:', !!aiResult?.response);
    
    if (aiResult && aiResult.response) {
      console.log(`SUCCESS: STEP 9 SUCCESS: AI analysis completed successfully for: ${analysisId}`);
      
      console.log('STEP STEP 10: Updating DynamoDB with AI results...');
      // Update the record with AI analysis results
      await dynamodb.send(new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
        Key: { analysis_id: analysisId },
        UpdateExpression: 'SET ai_analysis = :analysis, ai_analysis_completed = :completed, #status = :status, progress_message = :progress, updated_at = :timestamp',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':analysis': JSON.stringify(aiResult),
          ':completed': true,
          ':status': 'AI_COMPLETED',
          ':progress': 'AI coaching analysis completed successfully',
          ':timestamp': new Date().toISOString()
        }
      }));
      
      console.log(`🎉 STEP 10 SUCCESS: Analysis fully completed for: ${analysisId}`);
    } else {
      console.error(`ERROR: STEP 9 FAILED: AI analysis returned invalid result for: ${analysisId}`);
      console.error('Full aiResult:', JSON.stringify(aiResult, null, 2));
    }
    
  } catch (error) {
    console.error('ERROR: Error in processSwingAnalysis:', error);
    
    // Update status to indicate failure
    try {
      const dynamodb = getDynamoClient();
      await dynamodb.send(new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
        Key: { analysis_id: swingData.analysis_id?.S },
        UpdateExpression: 'SET #status = :status, progress_message = :progress, updated_at = :timestamp',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':progress': `AI analysis failed: ${error.message}`,
          ':timestamp': new Date().toISOString()
        }
      }));
    } catch (updateError) {
      console.error('Failed to update error status:', updateError);
    }
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


// SIMPLE, RELIABLE CONVERSATION STORAGE - Single table, no complexity
async function storeConversationSimple(userId, userMessage, aiResponse, jobId = null) {
  try {
    console.log('💾 Storing conversation in golf-coach-analyses table (simple method)');
    
    const dynamodb = getDynamoClient();
    const timestamp = new Date().toISOString();
    
    // Create conversation entry with both user message and AI response
    const conversationEntry = {
      timestamp: timestamp,
      user_message: userMessage,
      ai_response: aiResponse,
      tokens_used: 0, // Simple version - no token tracking
      storage_method: 'simple_reliable'
    };
    
    // Store in user's general conversation record OR specific analysis if jobId provided
    const recordKey = jobId || `conversation_${userId}`;
    
    const params = {
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: recordKey },
      UpdateExpression: `
        SET 
          follow_up_conversations = list_append(if_not_exists(follow_up_conversations, :empty_list), :new_conversation),
          updated_at = :timestamp,
          user_id = if_not_exists(user_id, :userId)
      `,
      ExpressionAttributeValues: {
        ':new_conversation': [conversationEntry],
        ':empty_list': [],
        ':timestamp': timestamp,
        ':userId': userId
      }
    };
    
    await dynamodb.send(new UpdateCommand(params));
    console.log(`SUCCESS: Conversation stored successfully in record: ${recordKey}`);
    
  } catch (error) {
    console.error('ERROR: Simple conversation storage failed:', error);
    // Don't throw - let conversation continue
  }
}

// SIMPLE CONVERSATION RETRIEVAL - Matches storage location exactly
async function fetchRecentConversationsSimple(userId, jobId = null) {
  try {
    console.log('🔍 Fetching recent conversations from golf-coach-analyses table');
    
    const dynamodb = getDynamoClient();
    
    // Check the same locations where we store conversations
    const recordsToCheck = [];
    
    // If jobId provided, check specific analysis record first
    if (jobId) {
      recordsToCheck.push(jobId);
    }
    
    // Always check general user conversation record as fallback
    recordsToCheck.push(`conversation_${userId}`);
    
    let allConversations = [];
    
    // Check each record location
    for (const recordKey of recordsToCheck) {
      try {
        const params = {
          TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
          Key: { analysis_id: recordKey }
        };
        
        const result = await dynamodb.send(new GetCommand(params));
        
        if (result.Item && result.Item.follow_up_conversations) {
          const conversations = result.Item.follow_up_conversations || [];
          console.log(`📝 Found ${conversations.length} conversations in record: ${recordKey}`);
          
          // Add record source to each conversation for context
          const conversationsWithSource = conversations.map(conv => ({
            ...conv,
            source_record: recordKey
          }));
          
          allConversations.push(...conversationsWithSource);
        }
      } catch (error) {
        console.warn(`⚠️ Could not fetch from record ${recordKey}:`, error.message);
      }
    }
    
    // Sort by timestamp (most recent first) and take last 20 messages
    const sortedConversations = allConversations
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 20);
    
    // Format for GPT prompt (convert to role-based messages)
    const formattedMessages = [];
    sortedConversations.reverse(); // Oldest first for proper conversation flow
    
    sortedConversations.forEach(conv => {
      // Add user message
      if (conv.user_message && conv.user_message.trim()) {
        formattedMessages.push({
          role: 'user',
          content: conv.user_message.trim(),
          timestamp: conv.timestamp,
          source: conv.source_record
        });
      }
      
      // Add AI response
      if (conv.ai_response && conv.ai_response.trim()) {
        formattedMessages.push({
          role: 'assistant',
          content: conv.ai_response.trim(),
          timestamp: conv.timestamp,
          source: conv.source_record
        });
      }
    });
    
    console.log(`SUCCESS: Retrieved and formatted ${formattedMessages.length} messages from ${allConversations.length} conversation entries`);
    
    return formattedMessages;
    
  } catch (error) {
    console.error('ERROR: Error fetching recent conversations:', error);
    return [];
  }
}

// USER THREAD MANAGEMENT FUNCTIONS - STEP 3

// Get or create user's conversation thread
async function getUserThread(userId) {
  try {
    console.log(`🔍 Getting user thread for: ${userId}`);
    
    const dynamodb = getDynamoClient();
    
    // 1. Query DynamoDB for existing user thread record
    const command = new GetCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: `user_${userId}` }
    });
    
    const result = await dynamodb.send(command);
    
    // 2. If exists, return { thread_id, swing_count, created_at }
    if (result.Item && result.Item.thread_id) {
      console.log(`SUCCESS: Found existing thread ${result.Item.thread_id} for user ${userId}`);
      return {
        thread_id: result.Item.thread_id,
        swing_count: result.Item.total_swings || 0,
        created_at: result.Item.created_at,
        last_updated: result.Item.last_updated,
        message_count: result.Item.message_count || 0
      };
    }
    
    console.log(`📝 No existing thread found for user ${userId}`);
    return null;
    
  } catch (error) {
    console.error(`ERROR: Error getting user thread for ${userId}:`, error);
    return null;
  }
}

// Store/update user thread information
async function storeUserThread(userId, threadData) {
  try {
    console.log(`💾 Storing user thread data for: ${userId}`);
    
    const dynamodb = getDynamoClient();
    
    // 1. Update or create DynamoDB record with thread mapping
    const updateExpression = `SET 
      record_type = :recordType,
      user_id = :userId,
      thread_id = :threadId,
      created_at = if_not_exists(created_at, :createdAt),
      swing_analyses = if_not_exists(swing_analyses, :emptyArray),
      total_swings = if_not_exists(total_swings, :zero),
      message_count = if_not_exists(message_count, :zero),
      last_updated = :lastUpdated`;
    
    const expressionAttributeValues = {
      ':recordType': 'user_thread',
      ':userId': userId,
      ':threadId': threadData.thread_id,
      ':createdAt': threadData.created_at || new Date().toISOString(),
      ':emptyArray': [],
      ':zero': 0,
      ':lastUpdated': threadData.last_updated || new Date().toISOString()
    };
    
    // Add optional fields if they exist in threadData
    if (threadData.swing_count !== undefined) {
      updateExpression += ', total_swings = :swingCount';
      expressionAttributeValues[':swingCount'] = threadData.swing_count;
    }
    
    if (threadData.message_count !== undefined) {
      updateExpression += ', message_count = :messageCount';
      expressionAttributeValues[':messageCount'] = threadData.message_count;
    }
    
    const command = new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: `user_${userId}` },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues
    });
    
    await dynamodb.send(command);
    console.log(`SUCCESS: User thread data stored successfully for ${userId}`);
    
  } catch (error) {
    console.error(`ERROR: Error storing user thread for ${userId}:`, error);
    throw error;
  }
}

// Add swing analysis metadata to user's record
async function addSwingToUserHistory(userId, swingMetadata) {
  try {
    console.log(`INFO: Adding swing to user history for: ${userId}`);
    
    const dynamodb = getDynamoClient();
    
    // 1. Update user's DynamoDB record to add swing to swing_analyses array
    const timestamp = new Date().toISOString();
    const swingEntry = {
      analysis_id: swingMetadata.analysis_id,
      date: swingMetadata.date || timestamp,
      key_frames: swingMetadata.key_frames || [],
      coaching_focus: swingMetadata.coaching_focus || 'general'
    };
    
    const command = new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE || 'golf-coach-analyses',
      Key: { analysis_id: `user_${userId}` },
      UpdateExpression: `
        SET 
          swing_analyses = list_append(if_not_exists(swing_analyses, :emptyArray), :newSwing),
          total_swings = if_not_exists(total_swings, :zero) + :one,
          last_updated = :timestamp
      `,
      ExpressionAttributeValues: {
        ':newSwing': [swingEntry],
        ':emptyArray': [],
        ':zero': 0,
        ':one': 1,
        ':timestamp': timestamp
      }
    });
    
    await dynamodb.send(command);
    console.log(`SUCCESS: Swing analysis added to user history for ${userId}`);
    
  } catch (error) {
    console.error(`ERROR: Error adding swing to user history for ${userId}:`, error);
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
    
    console.log('INFO: Enhanced follow-up metrics tracked successfully');
    
  } catch (error) {
    console.error('ERROR: Error tracking enhanced follow-up metrics:', error);
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