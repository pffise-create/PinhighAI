// Video Upload Handler - Focused Lambda for handling video upload requests
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

// Initialize clients
let dynamodb = null;
let lambdaClient = null;

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

// Extract analysis ID from S3 key
function extractAnalysisIdFromS3Key(s3Key) {
  if (!s3Key) return null;
  
  // Extract filename from path
  const filename = s3Key.split('/').pop();
  
  // Remove extension
  const nameWithoutExtension = filename.split('.')[0];
  
  return nameWithoutExtension;
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

// Main workflow: Create analysis record and trigger frame extraction
async function startAnalysisWorkflow(analysisId, s3Key, bucketName, userId, userContext) {
  try {
    console.log(`Starting analysis workflow for ${analysisId}`);
    
    const dynamodb = getDynamoClient();
    
    // First check if analysis already exists
    const getCommand = new GetCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { analysis_id: analysisId }
    });
    
    const existingRecord = await dynamodb.send(getCommand);
    
    if (existingRecord.Item) {
      console.log(`Analysis ${analysisId} already exists with status: ${existingRecord.Item.status}`);
      
      // If frames are already extracted, trigger AI analysis directly
      if (existingRecord.Item.status === 'COMPLETED' && !existingRecord.Item.ai_analysis_completed) {
        console.log(`DIRECT TRIGGER: AI analysis for completed frames: ${analysisId}`);
        
        // Trigger AI analysis processor Lambda
        await triggerAIAnalysisProcessor(analysisId, existingRecord.Item.user_id || userId);
        return;
      }
      
      // Record exists, don't overwrite
      console.log('Record exists, not overwriting');
      return;
    }
    
    // Create new analysis record
    const putCommand = new PutCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Item: {
        analysis_id: analysisId,
        user_id: userId,
        user_email: userContext?.email || null,
        user_name: userContext?.name || null,
        user_type: userContext?.userType || 'guest',
        is_authenticated: userContext?.isAuthenticated || false,
        status: 'STARTED',
        progress_message: 'Analysis request received, starting frame extraction...',
        s3_key: s3Key,
        bucket_name: bucketName,
        ai_analysis_completed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    });
    
    await dynamodb.send(putCommand);
    console.log(`Created NEW DynamoDB record for analysis ${analysisId}`);
    
    // Trigger frame extraction
    await triggerFrameExtraction(analysisId, s3Key, bucketName, userId);
    
  } catch (error) {
    console.error('Error starting analysis workflow:', error);
    await updateAnalysisStatus(analysisId, 'FAILED', error.message);
    throw error;
  }
}

// Trigger frame extraction Lambda
async function triggerFrameExtraction(analysisId, s3Key, bucketName, userId) {
  try {
    console.log(`Triggering frame extraction for ${analysisId}`);
    
    const lambda = getLambdaClient();
    
    const invokeCommand = new InvokeCommand({
      FunctionName: process.env.FRAME_EXTRACTOR_FUNCTION_NAME || 'golf-coach-frame-extractor-v2',
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify({
        s3_bucket: bucketName,
        s3_key: s3Key,
        analysis_id: analysisId,
        user_id: userId
      })
    });
    
    await lambda.send(invokeCommand);
    console.log(`Frame extraction triggered successfully for ${analysisId}`);
    
    // Update status to indicate frame extraction started
    await updateAnalysisStatus(analysisId, 'PROCESSING', 'Frame extraction started...');
    
  } catch (error) {
    console.error(`Error triggering frame extraction for ${analysisId}:`, error);
    await updateAnalysisStatus(analysisId, 'FAILED', `Frame extraction failed: ${error.message}`);
    throw error;
  }
}

// Trigger AI analysis processor Lambda
async function triggerAIAnalysisProcessor(analysisId, userId) {
  try {
    console.log(`Triggering AI analysis processor for ${analysisId}`);
    
    const lambda = getLambdaClient();
    
    const invokeCommand = new InvokeCommand({
      FunctionName: process.env.AI_ANALYSIS_PROCESSOR_FUNCTION_NAME,
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify({
        analysis_id: analysisId,
        user_id: userId,
        status: 'COMPLETED'
      })
    });
    
    await lambda.send(invokeCommand);
    console.log(`AI analysis processor triggered successfully for ${analysisId}`);
    
  } catch (error) {
    console.error(`Error triggering AI analysis processor for ${analysisId}:`, error);
    throw error;
  }
}

// Update analysis status in DynamoDB
async function updateAnalysisStatus(analysisId, status, progressMessage = null) {
  try {
    if (!analysisId) return;
    
    const dynamodb = getDynamoClient();
    
    const updateExpression = progressMessage 
      ? 'SET #status = :status, progress_message = :message, updated_at = :timestamp'
      : 'SET #status = :status, updated_at = :timestamp';
    
    const expressionAttributeValues = {
      ':status': status,
      ':timestamp': new Date().toISOString()
    };
    
    if (progressMessage) {
      expressionAttributeValues[':message'] = progressMessage;
    }
    
    const updateCommand = new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { analysis_id: analysisId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: expressionAttributeValues
    });
    
    await dynamodb.send(updateCommand);
    console.log(`Updated analysis ${analysisId} status to: ${status}`);
    
  } catch (error) {
    console.error(`Error updating analysis status for ${analysisId}:`, error);
  }
}

// Main Lambda handler
exports.handler = async (event) => {
  console.log('VIDEO UPLOAD HANDLER - Event:', JSON.stringify(event, null, 2));
  console.log('VIDEO UPLOAD HANDLER - Environment Check:', {
    dynamoTable: process.env.DYNAMODB_TABLE,
    frameExtractorFunction: process.env.FRAME_EXTRACTOR_FUNCTION_NAME,
    aiAnalysisProcessorFunction: process.env.AI_ANALYSIS_PROCESSOR_FUNCTION_NAME
  });
  
  try {
    // Extract user context from the request
    const userContext = await extractUserContext(event);
    console.log('USER CONTEXT:', userContext);
    
    // Validate this is a POST request for video analysis
    if (event.httpMethod !== 'POST' || !event.body) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Invalid request - POST with body required' })
      };
    }
    
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { s3Key, bucketName } = body;
    
    if (!s3Key || !bucketName) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Missing required fields: s3Key, bucketName' })
      };
    }
    
    // Use authenticated user ID or fall back to guest
    const userId = userContext.userId;
    
    console.log('API Gateway trigger for video:', s3Key);
    console.log('Using userId from context:', userId);
    
    // Create analysis ID from the s3Key filename
    const analysisId = extractAnalysisIdFromS3Key(s3Key) || `analysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Start the analysis workflow
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
    
  } catch (error) {
    console.error('Error in video upload handler:', error);
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