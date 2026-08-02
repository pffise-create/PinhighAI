// AI Analysis Processor - Focused Lambda for processing completed frame extractions with OpenAI vision models
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const https = require('https');
const {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_VERSION,
  buildAnalysisNaturalContractPrompt,
  buildVisionFactExtractionPrompt,
  buildCoachRenderPrompt,
  buildDeveloperContext,
} = require('../prompts/coachingSystemPrompt');
const swingRepository = require('../data/swingRepository');
const swingProfileRepository = require('../data/swingProfileRepository');
// Initialize clients
let dynamodb = null;
let s3Client = null;
let secretsManager = null;
let cachedOpenAIKey = null;
const HTTP_REQUEST_TIMEOUT_MS = parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || '45000', 10);
const DEFAULT_AI_ANALYSIS_MODEL = process.env.AI_ANALYSIS_MODEL || 'gpt-5.2';
// Mutable so offline model benchmarks can override per invocation via
// event.model_override. ALWAYS reset at the top of the handler — Lambda
// reuses containers, so a benchmark run must never leak into a real one.
let AI_ANALYSIS_MODEL = DEFAULT_AI_ANALYSIS_MODEL;
const AI_ANALYSIS_TEMPERATURE = Math.max(0, Math.min(parseFloat(process.env.AI_ANALYSIS_TEMPERATURE || '0.35'), 1));
const OPENAI_FACT_MAX_COMPLETION_TOKENS = Math.max(900, parseInt(process.env.OPENAI_FACT_MAX_COMPLETION_TOKENS || '1400', 10));
const OPENAI_RENDER_MAX_COMPLETION_TOKENS = Math.max(1200, parseInt(process.env.OPENAI_RENDER_MAX_COMPLETION_TOKENS || '1800', 10));
const OPENAI_RENDER_RETRY_MAX_COMPLETION_TOKENS = Math.max(
  OPENAI_RENDER_MAX_COMPLETION_TOKENS,
  parseInt(process.env.OPENAI_RENDER_RETRY_MAX_COMPLETION_TOKENS || '2600', 10)
);
const MAX_ANALYSIS_FRAMES = Math.max(6, Math.min(parseInt(process.env.MAX_ANALYSIS_FRAMES || '12', 10), 20));
const IN_FLIGHT_LOCK_MS = Math.max(60_000, parseInt(process.env.AI_ANALYSIS_IN_FLIGHT_LOCK_MS || '600000', 10));
const PRIOR_SWING_CONTEXT_LIMIT = Math.max(1, Math.min(parseInt(process.env.AI_ANALYSIS_CONTEXT_SWINGS || '3', 10), 5));
const GENERIC_GATE_MONITOR_ONLY = process.env.GENERIC_GATE_MONITOR_ONLY !== 'false';
const COACH_TONE_PROFILE = (process.env.COACH_TONE_PROFILE || 'wry').toLowerCase();
const POST_ANALYSIS_TO_ASSISTANT_THREAD = process.env.POST_ANALYSIS_TO_ASSISTANT_THREAD !== 'false';
const DYNAMO_ATTRIBUTE_KEYS = new Set(['S', 'N', 'BOOL', 'NULL', 'M', 'L', 'SS', 'NS', 'BS', 'B']);
const GENERIC_PHRASES = [
  'grip pressure',
  'body rotation',
  'follow-through',
  'swing with a pause',
  'stay balanced',
  'keep your head down',
  'slow it down',
  'great work keep it up',
  'your setup looks solid',
  'fully rotating your hips and shoulders',
  'ball striking and direction'
];
const EVIDENCE_PATTERNS = [
  /\b(backswing|downswing|transition|impact|follow[- ]?through)\b/i,
  /\b(clubface|path|shaft|lead wrist|trail wrist|hip|shoulder|pelvis|torso)\b/i,
  /\b(open|closed|inside|outside|steep|shallow|early extension|cast|release)\b/i,
  /\b(face-to-path|start line|launch|spin|curve|push|pull|slice|hook)\b/i,
  /\b\d+(\.\d+)?\b/,
];
const PHASE_HINTS = [
  { phase: 'setup', pattern: /\b(setup|address|stance|posture|grip at address)\b/i },
  { phase: 'backswing', pattern: /\b(backswing|takeaway|top of swing)\b/i },
  { phase: 'transition', pattern: /\b(transition)\b/i },
  { phase: 'downswing', pattern: /\b(downswing|delivery|slot|shallowing)\b/i },
  { phase: 'impact', pattern: /\b(impact|strike|contact)\b/i },
  { phase: 'follow_through', pattern: /\b(follow[- ]?through|finish)\b/i },
];

function getDynamoClient() {
  if (!dynamodb) {
    const client = new DynamoDBClient({});
    dynamodb = DynamoDBDocumentClient.from(client);
  }
  return dynamodb;
}

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
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

// HTTP request helper for OpenAI API
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

function isDynamoAttributeValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }
  return keys.every((key) => DYNAMO_ATTRIBUTE_KEYS.has(key));
}

function looksLikeMarshalledItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return false;
  }
  return Object.values(item).some((value) => isDynamoAttributeValue(value));
}

function normalizeDynamoItem(item) {
  if (!item || typeof item !== 'object') {
    return item;
  }
  if (!looksLikeMarshalledItem(item)) {
    return item;
  }

  try {
    return unmarshall(item);
  } catch (error) {
    console.warn('Failed to unmarshall DynamoDB item, continuing with raw item:', error.message);
    return item;
  }
}

function normalizeAnalysisResults(analysisResults) {
  if (!analysisResults) {
    return null;
  }

  if (typeof analysisResults === 'string') {
    try {
      return JSON.parse(analysisResults);
    } catch (error) {
      console.warn('Failed to parse string analysis_results payload:', error.message);
      return null;
    }
  }

  if (isDynamoAttributeValue(analysisResults)) {
    try {
      return unmarshall({ analysis_results: analysisResults }).analysis_results || null;
    } catch (error) {
      console.warn('Failed to unmarshall analysis_results attribute value:', error.message);
      return null;
    }
  }

  return analysisResults;
}

function normalizeFrame(frame) {
  if (!frame) {
    return null;
  }

  let normalized = frame;
  if (isDynamoAttributeValue(frame)) {
    try {
      normalized = unmarshall({ frame }).frame;
    } catch (error) {
      console.warn('Failed to unmarshall frame value:', error.message);
      return null;
    }
  }

  if (!normalized || typeof normalized !== 'object') {
    return null;
  }

  const phase = normalized.phase || normalized.frame_id || normalized.id;
  const url = normalized.url || normalized.frame_url || normalized.image_url;

  if (!phase || !url) {
    return null;
  }

  return { ...normalized, phase, url };
}

function extractFrameData(fullSwingData) {
  const analysisResults = normalizeAnalysisResults(
    fullSwingData?.analysis_results || fullSwingData?.analysisResults
  );

  const rawFrames =
    analysisResults?.frames ||
    fullSwingData?.frames ||
    fullSwingData?.frame_data ||
    [];

  const frames = Array.isArray(rawFrames)
    ? rawFrames.map(normalizeFrame).filter(Boolean)
    : [];

  return {
    analysisResults,
    frames
  };
}


// Download and convert image to base64 with compression
async function downloadAndCompressImage(imageUrl) {
  try {
    // Parse the S3 URL
    const url = new URL(imageUrl);
    const key = decodeURIComponent(url.pathname.substring(1)); // Remove leading slash and decode
    const bucket = url.hostname.split('.')[0]; // Extract bucket from S3 hostname
    
    console.log(`Downloading image from S3: bucket=${bucket}, key=${key}`);
    
    const s3 = getS3Client();
    
    const getObjectCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await s3.send(getObjectCommand);
    
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    // Simple base64 conversion
    const base64 = buffer.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64}`;
    
    console.log(`Successfully converted ${key} to base64 (${buffer.length} bytes)`);
    
    return {
      dataUrl,
      sourceBytes: buffer.length,
      payloadBytes: Buffer.byteLength(dataUrl, 'utf8'),
    };
    
  } catch (error) {
    console.error(`Error downloading image ${imageUrl}:`, error);
    throw error;
  }
}

// Get or create user thread for OpenAI Assistant
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
    
    console.log(`No existing thread found for user ${userId}, creating new thread`);
    
    // Create new OpenAI thread
    const threadResponse = await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: '/v1/threads',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      }
    }, JSON.stringify({}));
    
    const newThread = JSON.parse(threadResponse);
    const threadData = {
      user_id: userId,
      thread_id: newThread.id,
      swing_count: 0,
      message_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // Store in DynamoDB
    await dynamodb.send(new PutCommand({
      TableName: process.env.USER_THREADS_TABLE,
      Item: threadData
    }));
    
    console.log(`Created new thread ${newThread.id} for user ${userId}`);
    return threadData;
    
  } catch (error) {
    console.error(`Error getting/creating user thread for ${userId}:`, error);
    throw error;
  }
}

// Add analysis results to user's assistant thread
async function addAnalysisToUserThread(userId, analysis, analysisId) {
  try {
    console.log(`Adding swing analysis to user thread for: ${userId}`);
    
    // Get or create user thread
    const userThread = await getUserThread(userId);
    const threadId = userThread.thread_id;
    
    // Format the analysis message
    const analysisMessage = `**Swing Analysis Complete** (ID: ${analysisId})

${analysis}

You can ask me questions about this analysis or request tips for improvement!`;
    
    // Add message to OpenAI thread
    await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: `/v1/threads/${threadId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      }
    }, JSON.stringify({
      role: 'assistant',
      content: analysisMessage
    }));
    
    // Update thread metadata
    const dynamodb = getDynamoClient();
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.USER_THREADS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: 'SET swing_count = swing_count + :inc, updated_at = :timestamp',
      ExpressionAttributeValues: {
        ':inc': 1,
        ':timestamp': new Date().toISOString()
      }
    }));
    
    console.log(`Analysis automatically added to thread ${threadId} for user ${userId}`);
    
  } catch (error) {
    console.error(`Error adding analysis to user thread for ${userId}:`, error);
    // Don't throw - analysis succeeded even if thread posting failed
    console.warn('Analysis completed but thread posting failed - user can still access results');
  }
}

function selectFramesForAnalysis(frames, maxFrames) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return [];
  }

  if (frames.length <= maxFrames) {
    return frames;
  }

  const selected = [];
  const usedIndexes = new Set();
  const denominator = Math.max(maxFrames - 1, 1);

  for (let i = 0; i < maxFrames; i++) {
    const rawIndex = Math.round((i * (frames.length - 1)) / denominator);
    let idx = Math.min(Math.max(rawIndex, 0), frames.length - 1);

    while (usedIndexes.has(idx) && idx < frames.length - 1) {
      idx += 1;
    }
    while (usedIndexes.has(idx) && idx > 0) {
      idx -= 1;
    }

    usedIndexes.add(idx);
    selected.push(frames[idx]);
  }

  return selected.sort((a, b) => {
    const aPhase = a?.phase || '';
    const bPhase = b?.phase || '';
    return aPhase.localeCompare(bPhase);
  });
}

function readAssistantMessageContent(message) {
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part?.type === 'text' && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}

function extractJsonObjectFromText(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return null;
  }

  const text = input.trim();
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : text;

  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

function normalizeFactExtractionResult(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const observations = Array.isArray(input.key_observations) ? input.key_observations : [];
  const keyObservations = observations
    .filter((obs) => obs && typeof obs === 'object' && typeof obs.observation === 'string')
    .slice(0, 8)
    .map((obs, index) => ({
      id: typeof obs.id === 'string' ? obs.id : `fact_${index + 1}`,
      phase: typeof obs.phase === 'string' ? obs.phase : 'swing_general',
      observation: obs.observation.trim().slice(0, 500),
      confidence: typeof obs.confidence === 'number' && Number.isFinite(obs.confidence)
        ? Math.max(0.2, Math.min(Number(obs.confidence.toFixed(2)), 0.95))
        : 0.65,
      impact: ['positive', 'negative', 'neutral'].includes(obs.impact) ? obs.impact : 'neutral',
      evidence_markers: Array.isArray(obs.evidence_markers)
        ? obs.evidence_markers.filter((m) => typeof m === 'string').slice(0, 5)
        : [],
    }));

  const uncertainties = Array.isArray(input.uncertainties)
    ? input.uncertainties.filter((entry) => typeof entry === 'string').slice(0, 5)
    : [];

  return {
    visibility_summary: typeof input.visibility_summary === 'string' ? input.visibility_summary.slice(0, 500) : null,
    key_observations: keyObservations,
    uncertainties,
    question_relevance: typeof input.question_relevance === 'string' ? input.question_relevance.slice(0, 300) : null,
  };
}

function buildVisualObservationsFromFacts(facts) {
  return (Array.isArray(facts?.key_observations) ? facts.key_observations : []).map((obs, index) => ({
    id: typeof obs.id === 'string' ? obs.id : `obs_${index + 1}`,
    phase: obs.phase || 'swing_general',
    observation: obs.observation,
    evidence: {
      source: 'vision_fact_extraction',
      markers: Array.isArray(obs.evidence_markers) ? obs.evidence_markers.slice(0, 5) : [],
    },
    confidence: typeof obs.confidence === 'number' ? obs.confidence : 0.65,
    impact: obs.impact || 'neutral',
  }));
}

// Returns the GPT-5 minor version (gpt-5 -> 0, gpt-5.6-terra -> 6), or null
// for non-GPT-5 models. Version-aware rather than prefix-matched so newer
// releases don't silently fall into the wrong reasoning_effort branch.
function getGpt5Minor(model) {
  const match = /^gpt-5(?:\.(\d+))?\b/.exec(typeof model === 'string' ? model : '');
  if (!match) return null;
  return match[1] ? parseInt(match[1], 10) : 0;
}

function applyModelSpecificControls(request, { temperature } = {}) {
  if (!request || typeof request !== 'object') {
    return request;
  }

  const minor = getGpt5Minor(request.model);
  if (minor !== null) {
    if (Object.prototype.hasOwnProperty.call(request, 'temperature')) {
      delete request.temperature;
    }
    // Only the original gpt-5 accepts 'minimal'. Every 5.1+ release uses the
    // none|low|medium|high|xhigh enum and 400s on 'minimal'.
    request.reasoning_effort = request.reasoning_effort || (minor >= 1 ? 'low' : 'minimal');
    return request;
  }

  if (typeof temperature === 'number') {
    request.temperature = temperature;
  }
  return request;
}

async function callOpenAiChatCompletions(payload) {
  const response = await makeHttpsRequest({
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    }
  }, JSON.stringify(payload));

  return JSON.parse(response);
}

function getOpenAiChoiceDiagnostics(responseBody) {
  const choice = responseBody?.choices?.[0] || {};
  return {
    finishReason: choice.finish_reason || null,
    messageKeys: choice.message ? Object.keys(choice.message) : [],
    usage: responseBody?.usage || null,
    model: responseBody?.model || null,
  };
}

function createOpenAiRetryPayload(request, maxCompletionTokens) {
  const retryPayload = {
    ...request,
    max_completion_tokens: maxCompletionTokens,
  };

  const retryMinor = getGpt5Minor(retryPayload.model);
  if (retryMinor !== null && retryMinor >= 1) {
    retryPayload.reasoning_effort = 'none';
  }

  return retryPayload;
}

async function callOpenAiForRequiredText(request, { operation, retryMaxCompletionTokens = null } = {}) {
  const responseBody = await callOpenAiChatCompletions(request);
  const text = readAssistantMessageContent(responseBody?.choices?.[0]?.message);

  if (text) {
    return { text, rawResponse: responseBody, retryUsed: false };
  }

  console.warn(
    `OpenAI returned empty ${operation || 'assistant'} text; diagnostics:`,
    JSON.stringify(getOpenAiChoiceDiagnostics(responseBody))
  );

  if (!retryMaxCompletionTokens) {
    throw new Error(`Model returned empty ${operation || 'assistant'} text`);
  }

  const retryPayload = createOpenAiRetryPayload(request, retryMaxCompletionTokens);
  const retryResponseBody = await callOpenAiChatCompletions(retryPayload);
  const retryText = readAssistantMessageContent(retryResponseBody?.choices?.[0]?.message);

  if (!retryText) {
    console.warn(
      `OpenAI retry also returned empty ${operation || 'assistant'} text; diagnostics:`,
      JSON.stringify(getOpenAiChoiceDiagnostics(retryResponseBody))
    );
    throw new Error(`Model returned empty ${operation || 'assistant'} text after retry`);
  }

  return { text: retryText, rawResponse: retryResponseBody, retryUsed: true };
}

async function gatherDeveloperContext({ userId, analysisId, dynamoClient }) {
  if (!userId) {
    return null;
  }

  const swings = await swingRepository.getLastAnalyzedSwings({
    userId,
    limit: PRIOR_SWING_CONTEXT_LIMIT + 1,
    client: dynamoClient,
  });

  if (!Array.isArray(swings) || swings.length === 0) {
    return null;
  }

  const recentPriorSwings = swings
    .filter((swing) => (swing.analysisId || swing.analysis_id) !== analysisId)
    .slice(0, PRIOR_SWING_CONTEXT_LIMIT);

  if (recentPriorSwings.length === 0) {
    return null;
  }

  const derivedProfile =
    recentPriorSwings[0]?.analysisResults?.user_context ||
    recentPriorSwings[0]?.analysis_results?.user_context ||
    null;

  return buildDeveloperContext({
    swings: recentPriorSwings,
    swingProfile: derivedProfile,
  });
}

function tokenizeWords(input) {
  if (typeof input !== 'string') {
    return [];
  }

  const matches = input.toLowerCase().match(/[a-z0-9']+/g);
  return Array.isArray(matches) ? matches : [];
}

function scoreGenericCoachingResponse(responseText) {
  const text = typeof responseText === 'string' ? responseText.trim() : '';
  if (!text) {
    return {
      genericScore: 100,
      evidenceHits: 0,
      boilerplateHits: 0,
      tokenCount: 0,
      uniqueTokenRatio: 0,
      looksGeneric: true,
    };
  }

  const lower = text.toLowerCase();
  const tokens = tokenizeWords(lower);
  const uniqueTokenRatio = tokens.length > 0
    ? new Set(tokens).size / tokens.length
    : 0;

  const evidenceHits = EVIDENCE_PATTERNS.reduce((count, pattern) => {
    return count + (pattern.test(text) ? 1 : 0);
  }, 0);

  const boilerplateHits = GENERIC_PHRASES.reduce((count, phrase) => {
    return count + (lower.includes(phrase) ? 1 : 0);
  }, 0);

  let score = 0;
  if (tokens.length < 70) score += 20;
  if (uniqueTokenRatio < 0.45) score += 15;
  if (evidenceHits < 2) score += 30;
  if (evidenceHits < 3) score += 10;
  if (boilerplateHits >= 2) score += 30;
  if (boilerplateHits >= 4) score += 10;
  if (/\byour setup looks solid\b/i.test(text) && /\bswing path\b/i.test(text) && /\bfollow[- ]?through\b/i.test(text)) {
    score += 25;
  }

  const genericScore = Math.max(0, Math.min(score, 100));
  return {
    genericScore,
    evidenceHits,
    boilerplateHits,
    tokenCount: tokens.length,
    uniqueTokenRatio: Number(uniqueTokenRatio.toFixed(4)),
    looksGeneric: genericScore >= 55,
  };
}

function splitIntoSentences(text) {
  if (typeof text !== 'string') {
    return [];
  }

  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20);
}

function inferObservationPhase(sentence, fallbackPhases) {
  for (const hint of PHASE_HINTS) {
    if (hint.pattern.test(sentence)) {
      return hint.phase;
    }
  }

  if (Array.isArray(fallbackPhases) && fallbackPhases.length > 0) {
    return fallbackPhases[0];
  }

  return 'swing_general';
}

function detectObservationImpact(sentence) {
  if (!sentence) return 'neutral';
  if (/\b(better|improved|solid|good|well|strong)\b/i.test(sentence)) return 'positive';
  if (/\b(issue|problem|open|steep|stuck|early extension|cast|loss|poor)\b/i.test(sentence)) return 'negative';
  return 'neutral';
}

function estimateObservationConfidence(sentence) {
  let confidence = 0.65;
  if (/\b(clearly|definitely|consistently|noticeably)\b/i.test(sentence)) confidence += 0.15;
  if (/\b(likely|maybe|appears|seems|probably)\b/i.test(sentence)) confidence -= 0.15;
  if (EVIDENCE_PATTERNS.some((pattern) => pattern.test(sentence))) confidence += 0.1;
  return Math.max(0.2, Math.min(Number(confidence.toFixed(2)), 0.95));
}

// Legacy fallback-only heuristic parser. Do not use as primary visual memory.
function buildHeuristicVisualObservations({ responseText, selectedFrames }) {
  const sentences = splitIntoSentences(responseText);
  const fallbackPhases = Array.isArray(selectedFrames)
    ? selectedFrames.map((frame) => frame.phase).filter(Boolean).slice(0, 6)
    : [];

  const candidateSentences = sentences.filter((sentence) => (
    /\b(you|your|club|face|path|wrist|hip|shoulder|rotation|impact|transition|backswing|downswing|finish|setup)\b/i.test(sentence)
  ));

  const picked = candidateSentences.slice(0, 6);

  return picked.map((sentence, index) => ({
    id: `obs_${index + 1}`,
    phase: inferObservationPhase(sentence, fallbackPhases.slice(index, index + 1)),
    observation: sentence,
    evidence: {
      source: 'coaching_response_heuristic',
      markers: EVIDENCE_PATTERNS
        .map((pattern, patternIndex) => ({ pattern, patternIndex }))
        .filter(({ pattern }) => pattern.test(sentence))
        .map(({ patternIndex }) => `evidence_pattern_${patternIndex + 1}`)
        .slice(0, 3),
    },
    confidence: estimateObservationConfidence(sentence),
    impact: detectObservationImpact(sentence),
  }));
}

async function extractSwingFactsWithVision({ selectedFrameImages, userQuestion }) {
  const promptText = buildVisionFactExtractionPrompt({ userQuestion });
  const messageContent = [
    {
      type: 'text',
      text: `${promptText}\n\nDo not mention frames or internal references in the JSON values.`,
    },
  ];

  selectedFrameImages.forEach((frame, index) => {
    messageContent.push({
      type: 'text',
      text: `Internal frame reference ${index + 1}: ${frame.phase}`,
    });
    messageContent.push({
      type: 'image_url',
      image_url: { url: frame.image },
    });
  });

  const request = {
    model: AI_ANALYSIS_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You extract visible swing facts from images and return strict JSON only.',
      },
      {
        role: 'user',
        content: messageContent,
      },
    ],
    max_completion_tokens: OPENAI_FACT_MAX_COMPLETION_TOKENS,
    response_format: { type: 'json_object' },
  };
  applyModelSpecificControls(request, { temperature: 0.15 });

  const responseBody = await callOpenAiChatCompletions(request);
  const message = responseBody?.choices?.[0]?.message;
  const text = readAssistantMessageContent(message);
  const parsed = extractJsonObjectFromText(text);
  if (!parsed) {
    throw new Error('Fact extraction model returned non-JSON output');
  }

  return {
    facts: normalizeFactExtractionResult(parsed),
    rawResponse: responseBody,
    rawText: text,
  };
}

async function renderCoachResponseFromFacts({
  facts,
  userQuestion,
  rewriteHint = null,
}) {
  const renderPrompt = buildCoachRenderPrompt({
    responseMode: 'analysis',
    tone: COACH_TONE_PROFILE,
    hasQuestion: typeof userQuestion === 'string' && userQuestion.trim().length > 0,
  });
  const analysisContractPrompt = buildAnalysisNaturalContractPrompt();

  const userContent = [
    {
      type: 'text',
      text:
        `${analysisContractPrompt}\n\n${renderPrompt}\n` +
        (rewriteHint ? `Rewrite guidance: ${rewriteHint}\n` : '') +
        'Use the structured facts below as the evidence source. ' +
        'Do not pretend to have seen details that are not in the facts. ' +
        'Do not mention JSON, schemas, or internal fields.\n\n' +
        `Attached player question: ${typeof userQuestion === 'string' && userQuestion.trim() ? userQuestion.trim() : 'None'}\n` +
        `Structured swing facts: ${JSON.stringify(facts)}`,
    },
  ];

  const request = {
    model: AI_ANALYSIS_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    max_completion_tokens: OPENAI_RENDER_MAX_COMPLETION_TOKENS,
  };
  applyModelSpecificControls(request, { temperature: AI_ANALYSIS_TEMPERATURE });

  const { text: finalAnalysis, rawResponse, retryUsed } = await callOpenAiForRequiredText(request, {
    operation: 'coaching analysis',
    retryMaxCompletionTokens: OPENAI_RENDER_RETRY_MAX_COMPLETION_TOKENS,
  });

  return {
    text: finalAnalysis,
    rawResponse,
    retryUsed,
  };
}

async function renderCoachResponseDirectFromFrames({ selectedFrameImages, userQuestion }) {
  const analysisContractPrompt = buildAnalysisNaturalContractPrompt();
  const messageContent = [
    {
      type: 'text',
      text:
        `${analysisContractPrompt}\n\n` +
        buildCoachRenderPrompt({
          responseMode: 'analysis',
          tone: COACH_TONE_PROFILE,
          hasQuestion: typeof userQuestion === 'string' && userQuestion.trim().length > 0,
        }) + '\n' +
        'You are a professional golf coach reviewing sequential images from one short swing video. ' +
        'Treat these as one continuous motion and provide one cohesive coaching response. ' +
        'Do not mention frames, image order, or internal references. ' +
        'Default to best-effort coaching when the golfer and club are visible in most images. ' +
        'Only say footage is insufficient if visibility is truly unusable. ' +
        'If visibility is partial, state assumptions briefly and still give a useful best-effort coaching response. ' +
        `Attached player question: ${typeof userQuestion === 'string' && userQuestion.trim() ? userQuestion.trim() : 'None'}`,
    },
  ];

  selectedFrameImages.forEach((frame, index) => {
    messageContent.push({ type: 'text', text: `Internal frame reference ${index + 1}: ${frame.phase}` });
    messageContent.push({ type: 'image_url', image_url: { url: frame.image } });
  });

  const request = {
    model: AI_ANALYSIS_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: messageContent },
    ],
    max_completion_tokens: OPENAI_RENDER_MAX_COMPLETION_TOKENS,
  };
  applyModelSpecificControls(request, { temperature: AI_ANALYSIS_TEMPERATURE });
  const { text: finalAnalysis, rawResponse, retryUsed } = await callOpenAiForRequiredText(request, {
    operation: 'coaching analysis',
    retryMaxCompletionTokens: OPENAI_RENDER_RETRY_MAX_COMPLETION_TOKENS,
  });
  return { text: finalAnalysis, rawResponse, retryUsed };
}

// Main AI analysis function using OpenAI GPT-5
async function analyzeSwingWithGPT5(frameData, swingData) {
  try {
    console.log(`Starting swing analysis with model ${AI_ANALYSIS_MODEL}`);

    const analysisId = swingData.analysis_id;
    const userId = swingData.user_id;
    const userQuestion = typeof swingData.user_question === 'string' ? swingData.user_question.trim() : '';

    const allFrameUrls = frameData.frame_urls || {};
    const allFrames = Object.keys(allFrameUrls).sort().map(frameKey => ({
      phase: frameKey,
      url: allFrameUrls[frameKey]
    }));

    if (allFrames.length === 0) {
      throw new Error('No valid frame URLs found for analysis');
    }

    const modelFrameLimit = AI_ANALYSIS_MODEL.startsWith('gpt-5')
      ? Math.min(MAX_ANALYSIS_FRAMES, 10)
      : MAX_ANALYSIS_FRAMES;
    const selectedFrames = selectFramesForAnalysis(allFrames, modelFrameLimit);
    console.log(`Selected ${selectedFrames.length}/${allFrames.length} frames for model inference`);

    const selectedFrameImages = [];
    for (const frame of selectedFrames) {
      try {
        console.log(`Processing frame: ${frame.phase}`);
        const imagePayload = await downloadAndCompressImage(frame.url);
        selectedFrameImages.push({
          phase: frame.phase,
          image: imagePayload.dataUrl,
          sourceBytes: imagePayload.sourceBytes,
          payloadBytes: imagePayload.payloadBytes,
        });
      } catch (error) {
        console.error(`Failed to process frame ${frame.phase}:`, error.message);
      }
    }

    if (selectedFrameImages.length === 0) {
      throw new Error('No frame images could be converted');
    }

    const factStartedAt = Date.now();
    let factResult = null;
    let factsDurationMs = 0;
    let factExtractionFallbackUsed = false;
    try {
      factResult = await extractSwingFactsWithVision({
        selectedFrameImages,
        userQuestion,
      });
      factsDurationMs = Date.now() - factStartedAt;
    } catch (factError) {
      factsDurationMs = Date.now() - factStartedAt;
      factExtractionFallbackUsed = true;
      console.warn('Fact extraction failed, falling back to direct frame coaching render:', factError.message);
    }

    const visualObservations = factResult
      ? buildVisualObservationsFromFacts(factResult.facts)
      : [];

    const renderStartedAt = Date.now();
    let renderResult = factResult
      ? await renderCoachResponseFromFacts({
          facts: factResult.facts,
          userQuestion,
        })
      : await renderCoachResponseDirectFromFrames({
          selectedFrameImages,
          userQuestion,
        });
    let finalAnalysis = renderResult.text;
    let quality = scoreGenericCoachingResponse(finalAnalysis);
    let rewriteAttempted = false;
    let renderRetryUsed = Boolean(renderResult.retryUsed);

    if (quality.looksGeneric && factResult) {
      rewriteAttempted = true;
      renderResult = await renderCoachResponseFromFacts({
        facts: factResult.facts,
        userQuestion,
        rewriteHint:
          'The previous draft sounded generic. Use the specific observed details from the structured facts and avoid default setup/path/follow-through boilerplate. Vary cadence and avoid repeated do-X-so-Y phrasing.',
      });
      finalAnalysis = renderResult.text;
      renderRetryUsed = renderRetryUsed || Boolean(renderResult.retryUsed);
      quality = scoreGenericCoachingResponse(finalAnalysis);
    }
    const renderDurationMs = Date.now() - renderStartedAt;
    const frameTelemetry = {
      promptVersion: SYSTEM_PROMPT_VERSION,
      model: AI_ANALYSIS_MODEL,
      toneProfile: COACH_TONE_PROFILE,
      temperature: AI_ANALYSIS_TEMPERATURE,
      framesSelected: selectedFrames.length,
      framesAnalyzed: selectedFrameImages.length,
      frameSourceBytesTotal: selectedFrameImages.reduce((total, frame) => total + (frame.sourceBytes || 0), 0),
      framePayloadBytesTotal: selectedFrameImages.reduce((total, frame) => total + (frame.payloadBytes || 0), 0),
      genericGateMonitorOnly: GENERIC_GATE_MONITOR_ONLY,
      genericScore: quality.genericScore,
      looksGeneric: quality.looksGeneric,
      evidenceHits: quality.evidenceHits,
      boilerplateHits: quality.boilerplateHits,
      factsExtracted: visualObservations.length,
      factsDurationMs,
      factExtractionFallbackUsed,
      renderDurationMs,
      renderRetryUsed,
      rewriteAttempted,
      userQuestionAttached: !!userQuestion,
      visualObservationCount: visualObservations.length,
    };

    console.log('AI_ANALYSIS_TELEMETRY', JSON.stringify(frameTelemetry));

    if (POST_ANALYSIS_TO_ASSISTANT_THREAD && userId) {
      await addAnalysisToUserThread(userId, finalAnalysis, analysisId);
    }

    return {
      success: true,
      response: finalAnalysis,
      coaching_response: finalAnalysis,
      frames_analyzed: selectedFrameImages.length,
      frames_skipped: Math.max(allFrames.length - selectedFrameImages.length, 0),
      fallback_triggered: false,
      fallback_reason: null,
      skipped_frames: [],
      tokens_used: (factResult?.rawResponse?.usage?.total_tokens || 0) + (renderResult.rawResponse?.usage?.total_tokens || 0),
      // Input and output tokens are priced very differently, so keep the
      // split for cost attribution across the two-stage pipeline.
      token_usage: {
        prompt: (factResult?.rawResponse?.usage?.prompt_tokens || 0) + (renderResult.rawResponse?.usage?.prompt_tokens || 0),
        completion: (factResult?.rawResponse?.usage?.completion_tokens || 0) + (renderResult.rawResponse?.usage?.completion_tokens || 0),
        cached: (factResult?.rawResponse?.usage?.prompt_tokens_details?.cached_tokens || 0)
          + (renderResult.rawResponse?.usage?.prompt_tokens_details?.cached_tokens || 0),
      },
      batches_processed: 1,
      model_used: AI_ANALYSIS_MODEL,
      prompt_version: SYSTEM_PROMPT_VERSION,
      visual_observations: visualObservations,
      vision_facts: factResult ? factResult.facts : null,
      user_question: userQuestion || null,
      quality_gate: {
        generic_score: quality.genericScore,
        evidence_hits: quality.evidenceHits,
        boilerplate_hits: quality.boilerplateHits,
        token_count: quality.tokenCount,
        unique_token_ratio: quality.uniqueTokenRatio,
        looks_generic: quality.looksGeneric,
        mode: GENERIC_GATE_MONITOR_ONLY ? 'monitor' : 'enforce',
        decision: quality.looksGeneric ? 'flagged' : 'passed',
        rewrite_attempted: rewriteAttempted,
        fact_extraction_fallback_used: factExtractionFallbackUsed,
        render_retry_used: renderRetryUsed,
      },
    };
    
  } catch (error) {
    console.error('Error in analyzeSwingWithGPT5:', error);
    throw error;
  }
}

// Process swing analysis from DynamoDB stream or direct invocation
async function processSwingAnalysis(swingData) {
  try {
    console.log('Processing swing analysis from trigger...');
    
    let analysisId, status, userId;
    
    // Handle both DynamoDB stream format and direct invocation format
    if (swingData.analysis_id?.S) {
      // DynamoDB stream format
      analysisId = swingData.analysis_id.S;
      status = swingData.status.S;
      userId = swingData.user_id?.S;
    } else {
      // Direct invocation format
      analysisId = swingData.analysis_id;
      status = swingData.status;
      userId = swingData.user_id;
    }
    
    if (!analysisId) {
      console.error('No analysis_id found in swing data');
      return;
    }
    
    console.log(`Starting AI analysis for: ${analysisId}, status: ${status}`);
    
    // Get the full analysis data from DynamoDB
    const dynamodb = getDynamoClient();
    
    const result = await dynamodb.send(new GetCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { analysis_id: analysisId }
    }));
    
    if (!result.Item) {
      console.error(`Analysis record not found: ${analysisId}`);
      return;
    }
    
    console.log('Got full record from DynamoDB');
    const fullSwingData = normalizeDynamoItem(result.Item);
    const currentStatus = fullSwingData.status;
    const lastUpdatedAtMs = fullSwingData.updated_at ? new Date(fullSwingData.updated_at).getTime() : null;
    const isProcessingLockActive =
      currentStatus === 'AI_PROCESSING' &&
      lastUpdatedAtMs &&
      (Date.now() - lastUpdatedAtMs) < IN_FLIGHT_LOCK_MS;

    if (fullSwingData.ai_analysis_completed || currentStatus === 'AI_COMPLETED') {
      console.log(`Skipping ${analysisId}: analysis already completed`);
      return;
    }

    if (isProcessingLockActive) {
      console.log(`Skipping ${analysisId}: another worker is already processing this analysis`);
      return;
    }
    
    // Check if frame data exists - frames can be plain JSON or marshalled DynamoDB map/list values
    const { analysisResults, frames: frameData } = extractFrameData(fullSwingData);
    if (!frameData || frameData.length === 0) {
      console.error(
        `No frame data found for analysis: ${analysisId}. Available top-level keys:`,
        Object.keys(fullSwingData || {})
      );
      console.error(`No frame data found for analysis: ${analysisId}. analysis_results value:`, fullSwingData.analysis_results);
      await updateAnalysisStatus(analysisId, 'FAILED', 'AI analysis failed: no frame data found');
      return;
    }
    
    console.log(`Found ${frameData.length} frames for AI analysis`);
    
    // Convert frame data to expected format
    const frame_urls = {};
    frameData.forEach(frame => {
      if (frame.phase && frame.url) {
        frame_urls[frame.phase] = frame.url;
      }
    });
    
    const convertedFrameData = {
      frame_urls: frame_urls,
      video_duration: analysisResults?.video_duration,
      fps: analysisResults?.fps,
      frames_extracted: frameData.length
    };
    
    console.log(`Converted ${Object.keys(frame_urls).length} frame URLs for AI analysis`);
    
    // Update status to indicate AI analysis started
    await updateAnalysisStatus(analysisId, 'AI_PROCESSING', 'AI analysis in progress...');
    
    // Call AI analysis function
    const aiResult = await analyzeSwingWithGPT5(convertedFrameData, fullSwingData);
    
    if (aiResult && aiResult.response) {
      console.log(`AI analysis completed successfully for: ${analysisId}`);
      
      // Log fallback status if triggered
      if (aiResult.fallback_triggered) {
        console.warn(`🚨 ANALYSIS COMPLETED WITH FALLBACK: ${analysisId}`);
        console.warn(`🚨 FALLBACK DETAILS: ${aiResult.fallback_reason}`);
        console.warn(`🚨 FRAMES: ${aiResult.frames_analyzed} analyzed, ${aiResult.frames_skipped} skipped`);
      }
      
      // Update the record with AI analysis results and fallback tracking
      await dynamodb.send(new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE,
        Key: { analysis_id: analysisId },
        UpdateExpression: 'SET ai_analysis = :analysis, ai_analysis_completed = :completed, #status = :status, progress_message = :progress, updated_at = :timestamp, fallback_triggered = :fallback, frames_analyzed = :frames_analyzed, frames_skipped = :frames_skipped',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':analysis': JSON.stringify(aiResult),
          ':completed': true,
          ':status': 'AI_COMPLETED',
          ':progress': aiResult.fallback_triggered 
            ? `AI analysis completed with fallback (${aiResult.frames_skipped} frames skipped)`
            : 'AI coaching analysis completed successfully',
          ':timestamp': new Date().toISOString(),
          ':fallback': aiResult.fallback_triggered || false,
          ':frames_analyzed': aiResult.frames_analyzed || 0,
          ':frames_skipped': aiResult.frames_skipped || 0
        }
      }));
      if (userId) {
        const profileAnalysisResults = analysisResults
          ? Object.fromEntries(Object.entries(analysisResults).filter(([key]) => key !== 'frames'))
          : null;

        try {
          await swingProfileRepository.upsertFromAnalysis({
            userId,
            analysisId,
            aiAnalysis: aiResult,
            analysisResults: profileAnalysisResults,
            client: dynamodb,
            timestamp: new Date(),
          });
        } catch (profileError) {
          console.error(`Failed to update swing profile for ${userId}:`, profileError);
        }
      }
      
      console.log(`🎉 Analysis fully completed for: ${analysisId}`);
    } else {
      console.error(`AI analysis returned invalid result for: ${analysisId}`);
      await updateAnalysisStatus(analysisId, 'FAILED', 'AI analysis returned invalid result');
    }
    
  } catch (error) {
    console.error('Error in processSwingAnalysis:', error);
    
    // Update status to indicate failure
    const analysisId = swingData.analysis_id?.S || swingData.analysis_id;
    if (analysisId) {
      await updateAnalysisStatus(analysisId, 'FAILED', `AI analysis failed: ${error.message}`);
    }
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
  // Reset first so a prior benchmark invocation in this warm container can
  // never affect a real one.
  AI_ANALYSIS_MODEL = typeof event?.model_override === 'string' && event.model_override.trim()
    ? event.model_override.trim()
    : DEFAULT_AI_ANALYSIS_MODEL;
  if (AI_ANALYSIS_MODEL !== DEFAULT_AI_ANALYSIS_MODEL) {
    console.log(`MODEL OVERRIDE ACTIVE: ${AI_ANALYSIS_MODEL} (default ${DEFAULT_AI_ANALYSIS_MODEL})`);
  }

  console.log('AI ANALYSIS PROCESSOR - Event summary:', {
    hasAnalysisId: !!event?.analysis_id,
    hasRecords: Array.isArray(event?.Records),
    firstRecordSource: event?.Records?.[0]?.eventSource || null,
  });
  console.log('AI ANALYSIS PROCESSOR - Environment Check:', {
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    dynamoTable: process.env.DYNAMODB_TABLE,
    userThreadsTable: process.env.USER_THREADS_TABLE,
    swingProfileTable: process.env.SWING_PROFILE_TABLE || 'golf-coach-swing-profiles',
    model: AI_ANALYSIS_MODEL,
    temperature: AI_ANALYSIS_TEMPERATURE,
    promptVersion: SYSTEM_PROMPT_VERSION,
    maxAnalysisFrames: MAX_ANALYSIS_FRAMES,
    timeoutMs: HTTP_REQUEST_TIMEOUT_MS,
    genericGateMode: GENERIC_GATE_MONITOR_ONLY ? 'monitor' : 'enforce',
  });
  
  try {
    await ensureOpenAIKey();
    
    // Handle direct invocation from frame extraction
    if (event.analysis_id && event.user_id) {
      console.log('Processing direct invocation from frame extractor');
      await processSwingAnalysis({
        analysis_id: event.analysis_id,
        user_id: event.user_id,
        status: event.status || 'COMPLETED'
      });
      
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'AI analysis completed successfully' })
      };
    }

    // Handle SQS events from frame extractor queue
    if (event.Records && event.Records[0]?.eventSource === 'aws:sqs') {
      console.log(`Processing ${event.Records.length} SQS messages for AI analysis`);
      let processed = 0;

      for (const record of event.Records) {
        try {
          const body = typeof record.body === 'string' ? JSON.parse(record.body) : (record.body || {});
          const analysisId = body.analysis_id || record.messageAttributes?.analysis_id?.stringValue;
          const userId = body.user_id || record.messageAttributes?.user_id?.stringValue;
          const status = body.status || record.messageAttributes?.status?.stringValue || 'COMPLETED';

          if (!analysisId) {
            console.warn(`Skipping SQS message ${record.messageId}: missing analysis_id`);
            continue;
          }

          await processSwingAnalysis({
            analysis_id: analysisId,
            user_id: userId,
            status,
          });
          processed += 1;
        } catch (recordError) {
          // Do not throw here, otherwise SQS retries can hot-loop and duplicate work.
          console.error(`SQS message ${record.messageId} failed:`, recordError);
        }
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'SQS messages processed', processed, received: event.Records.length })
      };
    }
    
    // Handle DynamoDB stream records (legacy support)
    if (event.Records) {
      console.log('Processing DynamoDB stream records');
      
      for (const record of event.Records) {
        if (record.eventName === 'INSERT' || record.eventName === 'MODIFY') {
          const swingData = record.dynamodb.NewImage;
          const status = swingData.status?.S;
          const aiCompleted = swingData.ai_analysis_completed?.BOOL;
          
          // Only process completed records that haven't had AI analysis yet
          if (status === 'COMPLETED' && (aiCompleted === false || aiCompleted === null || aiCompleted === undefined)) {
            await processSwingAnalysis(swingData);
          }
        }
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Stream records processed' })
      };
    }
    
    // Unknown event type
    console.log('Unknown event type received');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Unknown event type' })
    };
    
  } catch (error) {
    console.error('Error in AI analysis processor:', error);
    return { 
      statusCode: 500,
      body: JSON.stringify({ error: error.message }) 
    };
  }
};

exports.__private = {
  selectFramesForAnalysis,
  readAssistantMessageContent,
  gatherDeveloperContext,
  scoreGenericCoachingResponse,
  normalizeDynamoItem,
  extractFrameData,
  getGpt5Minor,
  applyModelSpecificControls,
  createOpenAiRetryPayload,
};

