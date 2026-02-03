// Video Upload Handler - Focused Lambda for handling video upload requests
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const crypto = require('crypto');
const https = require('https');

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

// Extract user context from event with JWT validation
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

const JWKS_REQUEST_TIMEOUT_MS = parseInt(process.env.JWKS_REQUEST_TIMEOUT_MS || process.env.HTTP_REQUEST_TIMEOUT_MS || '5000', 10);

async function fetchJsonWithTimeout(url, timeoutMs = JWKS_REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const requestOptions = {
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };

    const req = https.request(requestOptions, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (parseError) {
            reject(new Error(`Failed to parse JSON from ${url}: ${parseError.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} when requesting ${url}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
    });
    req.end();
  });
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
  const jwks = await fetchJsonWithTimeout(jwksUrl);

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

function getGuestContext() {
  return {
    isAuthenticated: false,
    userId: 'guest-user',
    email: null,
    name: 'Guest User',
    userType: 'guest'
  };
}

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

// Main workflow: Create analysis record and trigger frame extraction
async function startAnalysisWorkflow(analysisId, s3Key, bucketName, userId, userContext, trimOptions = null) {
  try {
    console.log(`Starting analysis workflow for ${analysisId}`);
    if (trimOptions) {
      console.log(`With trim options: ${trimOptions.trimStartMs}ms to ${trimOptions.trimEndMs}ms`);
    }

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

    // Build analysis record with optional trim metadata
    const analysisRecord = {
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
    };

    // Add trim metadata if provided
    if (trimOptions) {
      analysisRecord.trim_start_ms = trimOptions.trimStartMs;
      analysisRecord.trim_end_ms = trimOptions.trimEndMs;
      analysisRecord.trim_duration_ms = trimOptions.trimEndMs - trimOptions.trimStartMs;
    }

    // Create new analysis record
    const putCommand = new PutCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Item: analysisRecord
    });

    await dynamodb.send(putCommand);
    console.log(`Created NEW DynamoDB record for analysis ${analysisId}`);

    // Trigger frame extraction with trim parameters
    await triggerFrameExtraction(analysisId, s3Key, bucketName, userId, trimOptions);

  } catch (error) {
    console.error('Error starting analysis workflow:', error);
    await updateAnalysisStatus(analysisId, 'FAILED', error.message);
    throw error;
  }
}

// Trigger frame extraction Lambda
async function triggerFrameExtraction(analysisId, s3Key, bucketName, userId, trimOptions = null) {
  try {
    console.log(`Triggering frame extraction for ${analysisId}`);
    if (trimOptions) {
      console.log(`With trim: ${trimOptions.trimStartMs}ms to ${trimOptions.trimEndMs}ms`);
    }

    const lambda = getLambdaClient();

    // Build payload with optional trim parameters
    const payload = {
      s3_bucket: bucketName,
      s3_key: s3Key,
      analysis_id: analysisId,
      user_id: userId
    };

    // Add trim parameters if provided
    if (trimOptions) {
      payload.trim_start_ms = trimOptions.trimStartMs;
      payload.trim_end_ms = trimOptions.trimEndMs;
    }

    const invokeCommand = new InvokeCommand({
      FunctionName: process.env.FRAME_EXTRACTOR_FUNCTION_NAME || 'golf-coach-frame-extractor-simple',
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify(payload)
    });

    await lambda.send(invokeCommand);
    console.log(`Frame extraction triggered successfully for ${analysisId}`);

    // Update status to indicate frame extraction started
    const progressMessage = trimOptions
      ? `Frame extraction started (trimmed: ${trimOptions.trimStartMs}ms to ${trimOptions.trimEndMs}ms)...`
      : 'Frame extraction started...';
    await updateAnalysisStatus(analysisId, 'PROCESSING', progressMessage);

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
    const { s3Key, bucketName, trimStartMs, trimEndMs } = body;

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

    // Log trim parameters if provided
    if (trimStartMs !== undefined && trimEndMs !== undefined) {
      console.log(`Trim parameters received: ${trimStartMs}ms to ${trimEndMs}ms (duration: ${trimEndMs - trimStartMs}ms)`);
    }

    // Create analysis ID from the s3Key filename
    const analysisId = extractAnalysisIdFromS3Key(s3Key) || `analysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Build trim options if provided
    const trimOptions = (trimStartMs !== undefined && trimEndMs !== undefined)
      ? { trimStartMs, trimEndMs }
      : null;

    // Start the analysis workflow with optional trim parameters
    await startAnalysisWorkflow(analysisId, s3Key, bucketName, userId, userContext, trimOptions);
    
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

