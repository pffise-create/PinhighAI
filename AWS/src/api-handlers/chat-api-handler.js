// Chat API Handler - Focused Lambda for handling chat requests with user threading
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { executeChatLoop } = require('../chat/chatLoop');
const swingRepository = require('../data/swingRepository');
const { SYSTEM_PROMPT, buildCoachRenderPrompt } = require('../prompts/coachingSystemPrompt');
const { buildLockedContent, evaluateAccessForLockedResult } = require('../access/entitlementGate');
const crypto = require('crypto');
const https = require('https');

// Initialize clients
let dynamodb = null;
let s3Client = null;
let secretsManager = null;
let cachedOpenAIKey = null;
const CHAT_LOOP_ENABLED = process.env.CHAT_LOOP_ENABLED === 'true';
const HTTP_REQUEST_TIMEOUT_MS = parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || '8000', 10);
const CHAT_VISUAL_TOOL_ENABLED = process.env.CHAT_VISUAL_TOOL_ENABLED !== 'false';
const CHAT_VISUAL_TOOL_MAX_FRAMES = Math.max(2, Math.min(parseInt(process.env.CHAT_VISUAL_TOOL_MAX_FRAMES || '4', 10), 6));
const COACH_TONE_PROFILE = (process.env.COACH_TONE_PROFILE || 'wry').toLowerCase();
const JWKS_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const jwksCacheByIssuer = new Map();

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

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
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

function hasBearerToken(event) {
  const authHeader = event?.headers?.Authorization || event?.headers?.authorization;
  return !!(authHeader && authHeader.startsWith('Bearer '));
}

function createChatLockedResultRef({ userId, message, reply }) {
  const hash = crypto.createHash('sha256');
  hash.update(String(userId || ''));
  hash.update('|chat|');
  hash.update(String(message || ''));
  hash.update('|');
  hash.update(String(reply || ''));
  return `chat#${hash.digest('hex').slice(0, 24)}`;
}

async function buildChatSuccessPayload({ userContext, userMessage, coachReply, extra = {} }) {
  const safeReply = typeof coachReply === 'string' ? coachReply.trim() : '';
  const basePayload = {
    response: safeReply,
    message: safeReply,
    success: true,
    timestamp: new Date().toISOString(),
    ...extra,
  };

  if (!userContext?.userId) {
    return basePayload;
  }

  let accessDecision;
  try {
    accessDecision = await evaluateAccessForLockedResult({
      userId: userContext.userId,
      client: getDynamoClient(),
      previewType: 'chat',
      resultRef: createChatLockedResultRef({
        userId: userContext.userId,
        message: userMessage,
        reply: safeReply,
      }),
    });
  } catch (error) {
    console.error('CHAT_GATING_CHECK_ERROR:', error);
    return basePayload;
  }

  if (accessDecision.allowFullResult) {
    return basePayload;
  }

  const lockedAnalysis = accessDecision.allowLockedResult
    ? buildLockedContent({
        aiAnalysis: { coaching_response: safeReply },
        lockContext: 'chat_response',
      })
    : {
        locked: true,
        lock_context: 'chat_response',
        headline: 'See the full swing breakdown',
        body: 'Start your 7-day free trial to unlock the complete analysis.',
        cta_label: 'Start 7-Day Free Trial',
        cta_action: 'start_trial',
      };

  const teaserText = lockedAnalysis.preview_summary || lockedAnalysis.preview_key_issue || lockedAnalysis.body;

  return {
    ...basePayload,
    response: teaserText,
    message: teaserText,
    locked: true,
    lock_reason: 'subscription_required',
    partial_result_available: !!accessDecision.allowLockedResult,
    locked_analysis: lockedAnalysis,
  };
}

function decodeJwtSegment(segment, label) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid ${label} segment`);
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = HTTP_REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: { Accept: 'application/json' }
    }, (res) => {
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

function parseCsvEnv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAllowedUserPoolIds() {
  const poolIds = [
    process.env.COGNITO_USER_POOL_ID,
    ...parseCsvEnv(process.env.COGNITO_USER_POOL_IDS),
  ].filter(Boolean);
  return Array.from(new Set(poolIds));
}

function getAllowedClientIds() {
  const clientIds = [
    process.env.COGNITO_APP_CLIENT_ID,
    ...parseCsvEnv(process.env.COGNITO_APP_CLIENT_IDS),
  ].filter(Boolean);
  return Array.from(new Set(clientIds));
}

function resolveTrustedIssuer(payload) {
  const region = process.env.COGNITO_REGION;
  const allowedUserPoolIds = getAllowedUserPoolIds();
  if (!region || !allowedUserPoolIds.length) {
    throw new Error('Cognito configuration missing. Set COGNITO_REGION and COGNITO_USER_POOL_ID.');
  }

  const trustedIssuers = allowedUserPoolIds.map(
    (userPoolId) => `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`
  );
  if (!trustedIssuers.includes(payload.iss)) {
    throw new Error('Token issuer mismatch');
  }
  return payload.iss;
}

async function getJwks(issuer) {
  const now = Date.now();
  const cached = jwksCacheByIssuer.get(issuer);
  if (cached?.jwks && cached.expiresAt > now) {
    return cached.jwks;
  }

  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  const jwks = await fetchJsonWithTimeout(jwksUrl);
  jwksCacheByIssuer.set(issuer, {
    jwks,
    expiresAt: now + JWKS_CACHE_TTL_MS,
  });
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

  const issuer = resolveTrustedIssuer(payload);
  const jwks = await getJwks(issuer);
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

  const allowedClientIds = getAllowedClientIds();
  if (
    allowedClientIds.length &&
    !allowedClientIds.includes(payload.aud) &&
    !allowedClientIds.includes(payload.client_id)
  ) {
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

// Extract user context from event with strict JWT validation
async function extractUserContext(event) {
  console.log('EXTRACT USER CONTEXT: Starting JWT validation');

  try {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { isAuthenticated: false, error: 'Missing bearer token' };
    }

    const token = authHeader.substring(7);
    const payload = await verifyAndDecodeJwt(token);
    const authenticatedContext = buildUserContextFromPayload(payload);

    console.log('USER CONTEXT: Returning authenticated context:', {
      userId: authenticatedContext.userId,
      email: authenticatedContext.email,
      userType: authenticatedContext.userType
    });

    return authenticatedContext;
  } catch (error) {
    console.error('JWT VERIFICATION ERROR:', error.message);
    return { isAuthenticated: false, error: error.message };
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
    logger,
    visualQuestionTool: answerVisualQuestionWithFrames,
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(
      await buildChatSuccessPayload({
        userContext,
        userMessage: message,
        coachReply: result.reply,
      })
    )
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

function selectVisualFrames(frames, maxFrames = CHAT_VISUAL_TOOL_MAX_FRAMES) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return [];
  }
  if (frames.length <= maxFrames) {
    return frames;
  }

  const preferredPhases = ['setup', 'backswing', 'transition', 'downswing', 'impact', 'follow_through'];
  const selected = [];
  const usedIndexes = new Set();

  preferredPhases.forEach((phase) => {
    if (selected.length >= maxFrames) return;
    const idx = frames.findIndex((frame, index) => !usedIndexes.has(index) && String(frame.phase || '').toLowerCase().includes(phase));
    if (idx >= 0) {
      usedIndexes.add(idx);
      selected.push(frames[idx]);
    }
  });

  for (let i = 0; i < frames.length && selected.length < maxFrames; i += 1) {
    if (!usedIndexes.has(i)) {
      usedIndexes.add(i);
      selected.push(frames[i]);
    }
  }

  return selected;
}

async function downloadFrameAsDataUrl(imageUrl) {
  const url = new URL(imageUrl);
  const bucket = url.hostname.split('.')[0];
  const key = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const s3 = getS3Client();
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  return {
    dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    bytes: buffer.length,
  };
}

function extractFramesFromAnalysis(analysis) {
  const frames = analysis?.analysisResults?.frames;
  if (!Array.isArray(frames)) {
    return [];
  }
  return frames
    .filter((frame) => frame && typeof frame === 'object' && (frame.url || frame.frame_url || frame.image_url))
    .map((frame, index) => ({
      phase: frame.phase || frame.frame_id || `frame_${index + 1}`,
      url: frame.url || frame.frame_url || frame.image_url,
    }));
}

async function answerVisualQuestionWithFrames({ userId, question, analysisId, dynamoClient, logger }) {
  const safeLog = logger || console;

  if (!CHAT_VISUAL_TOOL_ENABLED) {
    return {
      status: 'disabled',
      answer: null,
      message: 'Visual frame re-check tool is disabled.',
    };
  }

  const analysis = analysisId
    ? await swingRepository.getSwingAnalysis({ analysisId, client: dynamoClient })
    : (await swingRepository.getLastAnalyzedSwings({ userId, limit: 1, client: dynamoClient }))[0];

  if (!analysis) {
    return {
      status: 'not_found',
      answer: null,
      message: 'No analyzed swing found for visual follow-up.',
    };
  }

  const frames = extractFramesFromAnalysis(analysis);
  const selectedFrames = selectVisualFrames(frames, CHAT_VISUAL_TOOL_MAX_FRAMES);
  if (selectedFrames.length === 0) {
    return {
      status: 'frames_unavailable',
      answer: null,
      message: 'Frames are unavailable for this swing.',
      analysis_id: analysis.analysisId,
    };
  }

  const frameImages = [];
  for (const frame of selectedFrames) {
    try {
      const payload = await downloadFrameAsDataUrl(frame.url);
      frameImages.push({ phase: frame.phase, image: payload.dataUrl, bytes: payload.bytes });
    } catch (error) {
      safeLog.warn('CHAT_LOOP_WARN visual frame download failed', frame.phase, error.message);
    }
  }

  if (frameImages.length === 0) {
    return {
      status: 'frames_unavailable',
      answer: null,
      message: 'Frames could not be loaded for this swing.',
      analysis_id: analysis.analysisId,
    };
  }

  const visualPrompt = [
    {
      type: 'text',
      text:
        buildCoachRenderPrompt({
          responseMode: 'visual_fact_check',
          tone: COACH_TONE_PROFILE,
          hasQuestion: true,
        }) + ' Only use what you can infer from the provided swing images. Do not invent details.',
    },
    {
      type: 'text',
      text: `User question: ${question}`,
    },
  ];

  frameImages.forEach((frame) => {
    visualPrompt.push({ type: 'text', text: `Reference frame phase: ${frame.phase}` });
    visualPrompt.push({ type: 'image_url', image_url: { url: frame.image } });
  });

  const startedAt = Date.now();
  const response = await callChatCompletions({
    model: process.env.CHAT_VISUAL_TOOL_MODEL || process.env.CHAT_LOOP_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: visualPrompt },
    ],
    max_completion_tokens: 320,
    temperature: 0.35,
  });
  const durationMs = Date.now() - startedAt;

  const answer = response?.choices?.[0]?.message?.content?.trim() || '';
  safeLog.debug?.('VISUAL_TOOL_RESULT', {
    analysisId: analysis.analysisId,
    framesRequested: selectedFrames.length,
    framesLoaded: frameImages.length,
    bytesLoaded: frameImages.reduce((sum, frame) => sum + (frame.bytes || 0), 0),
    durationMs,
  });

  return {
    status: 'ok',
    answer,
    analysis_id: analysis.analysisId,
    frames_used: frameImages.map((frame) => frame.phase),
    duration_ms: durationMs,
  };
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
      body: JSON.stringify(
        await buildChatSuccessPayload({
          userContext,
          userMessage: message,
          coachReply: chatResponse.trim(),
          extra: { thread_id: threadId },
        })
      )
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
    hasAuth: hasBearerToken(event),
  });
  console.log('CHAT API HANDLER - Environment Check:', {
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    userThreadsTable: process.env.USER_THREADS_TABLE,
    cognitoRegion: process.env.COGNITO_REGION,
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID,
    chatLoopEnabled: CHAT_LOOP_ENABLED,
    httpTimeoutMs: HTTP_REQUEST_TIMEOUT_MS,
  });
  
  try {
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

    // Extract user context from the request
    const userContext = await extractUserContext(event);
    if (!userContext.isAuthenticated) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED',
          success: false
        })
      };
    }
    console.log('USER CONTEXT:', {
      userId: userContext.userId,
      userType: userContext.userType
    });

    await ensureOpenAIKey();
    
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
