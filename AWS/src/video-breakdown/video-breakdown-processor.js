'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const https = require('https');
const Jimp = require('jimp-compact');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const {
  BREAKDOWN_MAX_SCENES,
  BREAKDOWN_MUTED_DEFAULT,
  BREAKDOWN_TARGET_SECONDS,
  BREAKDOWN_VERSION,
  buildFrameLookup,
  clampNumber,
  parseMaybeJson,
} = require('./shared');

const execFileAsync = promisify(execFile);

let dynamodb = null;
let s3Client = null;
let secretsManager = null;
let lambdaClient = null;
let cachedOpenAIKey = null;
let ffmpegPath = null;
let ffprobePath = null;
let overlayFontsPromise = null;

const HTTP_REQUEST_TIMEOUT_MS = parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || '45000', 10);
const BREAKDOWN_SCRIPT_MODEL = process.env.VIDEO_BREAKDOWN_SCRIPT_MODEL || 'gpt-5.6-luna';
const BREAKDOWN_TTS_MODEL = process.env.VIDEO_BREAKDOWN_TTS_MODEL || 'gpt-4o-mini-tts';
const BREAKDOWN_TTS_VOICE = process.env.VIDEO_BREAKDOWN_VOICE || 'cedar';
const BREAKDOWN_TTS_RESPONSE_FORMAT = process.env.VIDEO_BREAKDOWN_TTS_RESPONSE_FORMAT || 'mp3';
const BREAKDOWN_WIDTH = Math.max(540, parseInt(process.env.VIDEO_BREAKDOWN_WIDTH || '720', 10));
const BREAKDOWN_HEIGHT = Math.max(960, parseInt(process.env.VIDEO_BREAKDOWN_HEIGHT || '1280', 10));
const BREAKDOWN_FPS = Math.max(24, parseInt(process.env.VIDEO_BREAKDOWN_FPS || '30', 10));
const BREAKDOWN_MAX_RUNTIME_SECONDS = Math.max(
  12,
  parseInt(process.env.VIDEO_BREAKDOWN_MAX_RUNTIME_SECONDS || '30', 10)
);
const BREAKDOWN_MAX_TOTAL_NARRATION_WORDS = Math.max(
  36,
  parseInt(process.env.VIDEO_BREAKDOWN_MAX_TOTAL_NARRATION_WORDS || '52', 10)
);
const BREAKDOWN_MAX_SCENE_NARRATION_WORDS = Math.max(
  10,
  parseInt(process.env.VIDEO_BREAKDOWN_MAX_SCENE_NARRATION_WORDS || '16', 10)
);
const BREAKDOWN_MAX_SCENE_CAPTION_CHARS = Math.max(
  72,
  parseInt(process.env.VIDEO_BREAKDOWN_MAX_SCENE_CAPTION_CHARS || '90', 10)
);
const BREAKDOWN_REQUIRE_MARKED_FRAMES = process.env.VIDEO_BREAKDOWN_REQUIRE_MARKED_FRAMES !== 'false';
const BREAKDOWN_SCENE_TRANSITION_SECONDS = Number.parseFloat(
  process.env.VIDEO_BREAKDOWN_SCENE_TRANSITION_SECONDS || '0.18'
);
const SWING_MARKER_FUNCTION_NAME = process.env.SWING_MARKER_FUNCTION_NAME || 'golf-swing-marker';

function getDynamoClient() {
  if (!dynamodb) {
    dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return dynamodb;
}

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
}

function getLambdaClient() {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({});
  }
  return lambdaClient;
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
  const response = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) {
    throw new Error('OpenAI secret is empty');
  }

  cachedOpenAIKey = response.SecretString;
  process.env.OPENAI_API_KEY = response.SecretString;
  return cachedOpenAIKey;
}

function makeHttpsRequest(options, data = null, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(binary ? body : body.toString('utf8'));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.toString('utf8')}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(HTTP_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Request to ${options.hostname}${options.path} timed out after ${HTTP_REQUEST_TIMEOUT_MS}ms`));
    });

    if (data) req.write(data);
    req.end();
  });
}

function getGpt5Minor(model) {
  const match = /^gpt-5(?:\.(\d+))?\b/.exec(typeof model === 'string' ? model : '');
  if (!match) return null;
  return match[1] ? parseInt(match[1], 10) : 0;
}

function applyModelSpecificControls(request) {
  const minor = getGpt5Minor(request?.model);
  if (minor === null) {
    request.temperature = 0.35;
    return request;
  }

  if (Object.prototype.hasOwnProperty.call(request, 'temperature')) {
    delete request.temperature;
  }
  request.reasoning_effort = minor >= 1 ? 'low' : 'minimal';
  return request;
}

function extractJsonObjectFromText(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const text = input.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch (secondError) {
        return null;
      }
    }
    return null;
  }
}

function safeSentence(text, fallback) {
  const input = typeof text === 'string' ? text.trim() : '';
  if (!input) return fallback;
  const sentence = input.split(/(?<=[.!?])\s+/)[0]?.trim();
  return sentence || fallback;
}

function summarizeCaption(text, maxLength = 120) {
  const clean = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
  if (!clean) return '';
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeSpokenText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\u2026/g, '...')
    .replace(/[\u2013\u2014]/g, ', ')
    .replace(/[\u2018\u2019]/g, '\'')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00a0/g, ' ')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text) {
  const normalized = normalizeSpokenText(text);
  return normalized ? normalized.split(/\s+/).length : 0;
}

function trimWords(text, maxWords) {
  const normalized = normalizeSpokenText(text);
  if (!normalized) return '';
  const words = normalized.split(/\s+/);
  if (words.length <= maxWords) return normalized;
  const trimmed = words.slice(0, maxWords).join(' ').replace(/[,:;]+$/g, '');
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function tightenNarration(text, maxWords) {
  const normalized = normalizeSpokenText(text);
  if (!normalized) return '';
  const conciseSentence = safeSentence(normalized, normalized);
  return trimWords(conciseSentence, maxWords);
}

function tightenCaption(text, fallback) {
  const normalized = normalizeSpokenText(text) || normalizeSpokenText(fallback);
  return summarizeCaption(normalized, BREAKDOWN_MAX_SCENE_CAPTION_CHARS);
}

function finalizeSceneHeadline(scene, sceneIndex) {
  const rawHeadline = normalizeSpokenText(scene?.headline || '').replace(/[.!?]+$/g, '').trim();
  const context = normalizeSpokenText(`${scene?.caption || ''} ${scene?.narration || ''}`).toLowerCase();

  if (sceneIndex === 2) {
    if (/\bcenter/.test(context) && /\btop\b/.test(context)) {
      return 'Feel Centered at the Top';
    }
    if (rawHeadline && rawHeadline.length <= 28) {
      return summarizeCaption(rawHeadline, 32).replace(/\.{3}$/g, '');
    }
    return 'One Feel to Rehearse';
  }

  if (sceneIndex === 1 && (!rawHeadline || /^what it costs$/i.test(rawHeadline))) {
    if (/low point/.test(context)) {
      return 'Low Point Gets Late';
    }
    return 'Why Contact Suffers';
  }

  if (sceneIndex === 3 && (!rawHeadline || /^keep this$/i.test(rawHeadline))) {
    if (/finish/.test(context)) {
      return 'Keep the Balanced Finish';
    }
    return 'Keep This Move';
  }

  if (sceneIndex === 0 && (!rawHeadline || /^main issue$/i.test(rawHeadline))) {
    if (/high hands/.test(context) || /trail-side|trail side|lean away|tilt away/.test(context)) {
      return 'High Hands with Trail-Side Lean';
    }
    return 'Main Issue';
  }

  return summarizeCaption(rawHeadline || 'Key move', 36).replace(/\.{3}$/g, '');
}

function tightenScenesForRuntime(scenes) {
  if (!Array.isArray(scenes) || scenes.length === 0) return [];
  const perSceneWordBudget = Math.max(
    10,
    Math.min(
      BREAKDOWN_MAX_SCENE_NARRATION_WORDS,
      Math.floor(BREAKDOWN_MAX_TOTAL_NARRATION_WORDS / scenes.length)
    )
  );

  return scenes.map((scene, index) => {
    const narration = tightenNarration(scene?.narration || scene?.caption || '', perSceneWordBudget);
    return {
      ...scene,
      headline: finalizeSceneHeadline(scene, index),
      narration,
      caption: tightenCaption(scene?.caption, narration),
    };
  }).filter((scene) => scene.narration);
}

function resolveSceneFramePhase(phase, context = '') {
  const normalizedPhase = normalizeSpokenText(phase || '').toLowerCase();
  const normalizedContext = normalizeSpokenText(context).toLowerCase();
  const combined = `${normalizedPhase} ${normalizedContext}`.trim();

  if (
    /finish|follow through|follow_through|lead foot|trail foot|trail toe|chest through|high finish|balanced finish/.test(combined)
  ) {
    return 'finish';
  }

  if (
    /impact|strike|contact|low point|delivery|transition|downswing|drop\/flip|sweepy/.test(combined)
  ) {
    return combined.includes('impact') ? 'impact' : 'delivery';
  }

  if (
    /top|backswing|high hands|trail-side|trail side|side bend|tilt away|lean away/.test(combined)
  ) {
    return 'top';
  }

  if (
    /setup|address|posture|stance|ball position|grip|arms hang/.test(combined)
  ) {
    return 'setup';
  }

  switch (normalizedPhase) {
    case 'address':
    case 'setup':
      return 'setup';
    case 'takeaway':
      return 'takeaway';
    case 'backswing':
    case 'top':
      return 'top';
    case 'transition':
      return 'delivery';
    case 'delivery':
    case 'downswing':
    case 'strike':
      return 'delivery';
    case 'impact':
      return 'impact';
    case 'follow_through':
    case 'finish':
      return 'finish';
    default:
      return 'delivery';
  }
}

function extractPriorityCue(coachingResponse, fallback) {
  const normalized = normalizeSpokenText(coachingResponse);
  if (!normalized) {
    return fallback;
  }

  const patterns = [
    /feel like (.+?)(?:\.|$)/i,
    /one practical priority[^:]*:\s*(.+?)(?:\.|$)/i,
    /main[^.]*difference-maker[^.]*\.\s*(.+?)(?:\.|$)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return summarizeCaption(match[1].trim(), 170);
    }
  }

  return fallback;
}

function extractConsequenceCue(coachingResponse, fallback) {
  const normalized = normalizeSpokenText(coachingResponse);
  if (!normalized) {
    return fallback;
  }

  if (/low point/.test(normalized) && /timing-dependent|drop\/flip|sweepy|thin|fat/.test(normalized)) {
    return 'That can move the low point back and make contact more timing-dependent.';
  }

  const leadToMatch = normalized.match(/lead to (.+?)(?:\.|$)/i);
  if (leadToMatch?.[1]) {
    return summarizeCaption(leadToMatch[1].trim(), 170);
  }

  return fallback;
}

function pickClosestMarkedFrame(frames, targetTimestamp) {
  const markedFrames = Array.isArray(frames)
    ? frames.filter((frame) => typeof frame?.marked_url === 'string' && frame.marked_url)
    : [];
  if (!markedFrames.length) return null;
  if (!Number.isFinite(targetTimestamp)) return markedFrames[0];

  return markedFrames.reduce((best, frame) => {
    if (!best) return frame;
    return Math.abs((frame.timestamp ?? 0) - targetTimestamp) < Math.abs((best.timestamp ?? 0) - targetTimestamp)
      ? frame
      : best;
  }, null);
}

function selectFrameForScene(frameLookup, phase, fallbackIndex = 0) {
  const primary = frameLookup.pickForPhase(phase) || frameLookup.frames[fallbackIndex] || frameLookup.frames[0] || null;
  if (!primary) return null;

  if (primary.marked_url) {
    return primary;
  }

  const markedAlternative = pickClosestMarkedFrame(frameLookup.frames, primary.timestamp);
  if (markedAlternative) {
    return markedAlternative;
  }

  return BREAKDOWN_REQUIRE_MARKED_FRAMES ? null : primary;
}

function estimateBreakdownRuntime(sceneDurations) {
  if (!Array.isArray(sceneDurations) || sceneDurations.length === 0) return 0;
  return sceneDurations.reduce((total, duration, index) => (
    total + duration - (index === 0 ? 0 : BREAKDOWN_SCENE_TRANSITION_SECONDS)
  ), 0);
}

function derivePreciseImpactTimestamp(frameLookup, fallbackTimestamp = null) {
  const anchorTime = clampNumber(frameLookup?.anchorTime, null);
  if (anchorTime !== null) {
    return Number(anchorTime.toFixed(2));
  }

  const topFrame = frameLookup?.pickForPhase?.('top') || null;
  const finishFrame = frameLookup?.pickForPhase?.('finish') || null;
  if (
    topFrame
    && finishFrame
    && Number.isFinite(topFrame.timestamp)
    && Number.isFinite(finishFrame.timestamp)
    && finishFrame.timestamp > topFrame.timestamp
  ) {
    const precise = topFrame.timestamp + ((finishFrame.timestamp - topFrame.timestamp) * 0.6);
    return Number(precise.toFixed(2));
  }

  return clampNumber(fallbackTimestamp, 1.1);
}

function collectObservations(aiAnalysis) {
  const facts = Array.isArray(aiAnalysis?.vision_facts?.key_observations)
    ? aiAnalysis.vision_facts.key_observations
    : [];
  const visuals = Array.isArray(aiAnalysis?.visual_observations)
    ? aiAnalysis.visual_observations
    : [];

  const merged = [
    ...facts.map((obs) => ({
      phase: obs.phase || 'swing_general',
      observation: obs.observation || '',
      confidence: clampNumber(obs.confidence, 0.6),
      impact: obs.impact || 'neutral',
    })),
    ...visuals.map((obs) => ({
      phase: obs.phase || 'swing_general',
      observation: obs.observation || '',
      confidence: clampNumber(obs.confidence, 0.6),
      impact: obs.impact || 'neutral',
    })),
  ];

  const seen = new Set();
  return merged
    .filter((obs) => typeof obs.observation === 'string' && obs.observation.trim())
    .filter((obs) => {
      const key = `${obs.phase}|${obs.observation.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const impactWeight = { negative: 2, neutral: 1, positive: 0 };
      return (
        (impactWeight[b.impact] || 0) - (impactWeight[a.impact] || 0) ||
        (b.confidence || 0) - (a.confidence || 0)
      );
    });
}

function findObservationByPattern(observations, pattern) {
  if (!Array.isArray(observations)) return null;
  return observations.find((obs) => pattern.test(normalizeSpokenText(obs?.observation || '').toLowerCase())) || null;
}

function buildIssueSceneCopy({ observations, fallbackText }) {
  const highHandsObservation = findObservationByPattern(
    observations,
    /hands .* high|high .* hands|shaft close to horizontal|shaft is near-horizontal/
  );
  const trailSideObservation = findObservationByPattern(
    observations,
    /trail side|tilt|side bend|lean away|leans back/
  );

  if (highHandsObservation && trailSideObservation) {
    return {
      headline: 'High Hands with Trail-Side Lean',
      narration: 'At the top, your hands get high and your chest leans back.',
      caption: 'Top gets high with extra lean away from target.',
    };
  }

  if (highHandsObservation) {
    return {
      headline: 'Hands Get High at the Top',
      narration: 'At the top, your hands climb a little too high for this stock swing.',
      caption: 'Hands get high at the top of the backswing.',
    };
  }

  if (trailSideObservation) {
    return {
      headline: 'Top Leans into the Trail Side',
      narration: 'At the top, your chest leans back into the trail side.',
      caption: 'Top leans away from the target instead of staying centered.',
    };
  }

  return {
    headline: 'Main Issue',
    narration: safeSentence(fallbackText, 'The main issue shows up near the top of the swing.'),
    caption: summarizeCaption(fallbackText, 100),
  };
}

function buildConsequenceSceneCopy(coachingResponse) {
  const normalized = normalizeSpokenText(coachingResponse).toLowerCase();
  if (/low point/.test(normalized) && /thin|sweepy|drop\/flip|drop\/ flippy|flip|timing-dependent|timing dependent/.test(normalized)) {
    return {
      headline: 'Low Point Gets Late',
      narration: 'That sends the low point back, so contact gets thin or flippy.',
      caption: 'Late low point turns contact thin or flippy.',
    };
  }

  if (/low point/.test(normalized)) {
    return {
      headline: 'Low Point Gets Late',
      narration: 'That sends the low point back and makes contact more timing-dependent.',
      caption: 'Low point drifts back, so contact gets timing-dependent.',
    };
  }

  return {
    headline: 'Why Contact Suffers',
    narration: 'That shape makes contact more timing-dependent through the strike.',
    caption: 'Contact gets more timing-dependent through impact.',
  };
}

function buildFeelSceneCopy(coachingResponse) {
  const normalized = normalizeSpokenText(coachingResponse).toLowerCase();
  if (/centered|trail side|trail-side/.test(normalized)) {
    return {
      headline: 'Feel Centered at the Top',
      narration: 'Rehearse this: feel centered at the top, ribs over zipper.',
      caption: 'Practice: ribs stacked over zipper at the top.',
    };
  }

  return {
    headline: 'One Feel to Rehearse',
    narration: 'Rehearse one feel: centered at the top so low point stays forward.',
    caption: 'Practice one centered top feel.',
  };
}

function buildKeepSceneCopy(keepObservation, coachingResponse) {
  const keepText = normalizeSpokenText(keepObservation?.observation || coachingResponse).toLowerCase();
  if (/lead foot|trail foot|trail toe|finish|chest rotated/.test(keepText)) {
    return {
      headline: 'Keep the Balanced Finish',
      narration: 'Keep the finish: chest through, weight forward, trail toe up.',
      caption: 'Keep the balanced finish with weight forward.',
    };
  }

  return {
    headline: 'Keep This Move',
    narration: safeSentence(
      keepObservation?.observation || coachingResponse,
      'Keep the balanced finish and weight forward through the swing.'
    ),
    caption: summarizeCaption(
      keepObservation?.observation || 'Keep the balanced finish and weight forward through the swing.',
      100
    ),
  };
}

function buildFallbackStoryboard({ aiAnalysis, frameLookup }) {
  const observations = collectObservations(aiAnalysis);
  const coachingResponse = normalizeSpokenText(
    aiAnalysis?.coaching_response || 'Here is the cleanest read from your swing.'
  );
  const issueObservation = observations.find((obs) => resolveSceneFramePhase(obs.phase, obs.observation) === 'top')
    || observations.find((obs) => resolveSceneFramePhase(obs.phase, obs.observation) === 'delivery')
    || observations[0]
    || { phase: 'delivery', observation: coachingResponse, impact: 'neutral', confidence: 0.6 };
  const keepObservation = observations.find((obs) => obs.impact === 'positive')
    || observations.find((obs) => resolveSceneFramePhase(obs.phase, obs.observation) === 'finish')
    || observations.find((obs) => resolveSceneFramePhase(obs.phase, obs.observation) === 'setup')
    || issueObservation;
  const issueFramePhase = resolveSceneFramePhase(issueObservation.phase, issueObservation.observation);
  const keepFramePhase = resolveSceneFramePhase(keepObservation.phase, keepObservation.observation);
  const consequenceLine = extractConsequenceCue(
    coachingResponse,
    'That position can move the low point back and make the strike more timing-dependent.'
  );
  const priorityLine = extractPriorityCue(
    coachingResponse,
    'Feel more centered at the top so the low point stays forward.'
  );
  const issueCopy = buildIssueSceneCopy({
    observations,
    fallbackText: issueObservation.observation || coachingResponse,
  });
  const consequenceCopy = buildConsequenceSceneCopy(consequenceLine || coachingResponse);
  const feelCopy = buildFeelSceneCopy(priorityLine || coachingResponse);
  const keepCopy = buildKeepSceneCopy(keepObservation, coachingResponse);

  const sceneDefinitions = [
    {
      phase: 'main issue',
      frame_phase: issueFramePhase,
      headline: issueCopy.headline,
      narration: issueCopy.narration,
      caption: issueCopy.caption,
    },
    {
      phase: 'what it costs',
      frame_phase: /impact/.test(consequenceLine.toLowerCase()) ? 'impact' : 'delivery',
      headline: consequenceCopy.headline,
      narration: consequenceCopy.narration,
      caption: consequenceCopy.caption,
    },
    {
      phase: 'one feel',
      frame_phase: issueFramePhase,
      headline: feelCopy.headline,
      narration: feelCopy.narration,
      caption: feelCopy.caption,
    },
    {
      phase: 'keep this',
      frame_phase: keepFramePhase,
      headline: keepCopy.headline,
      narration: keepCopy.narration,
      caption: keepCopy.caption,
    },
  ];

  const scenes = sceneDefinitions.map((scene, index) => {
    const frame = selectFrameForScene(frameLookup, scene.frame_phase || scene.phase, index);
    const narration = summarizeCaption(scene.narration, 180);
    return {
      id: `scene_${index + 1}`,
      phase: scene.phase,
      frame_phase: scene.frame_phase,
      headline: scene.headline,
      narration,
      caption: summarizeCaption(scene.caption || narration, 110),
      frame_url: frame?.marked_url || (BREAKDOWN_REQUIRE_MARKED_FRAMES ? null : frame?.url) || null,
      frame_timestamp: frame?.timestamp ?? null,
      marked: Boolean(frame?.marked_url),
    };
  }).filter((scene) => scene.frame_url);

  return {
    title: 'More Centered Top, Cleaner Strike',
    summary: summarizeCaption('High hands and trail-side lean at the top send the low point back; feel more centered and keep the balanced finish.', 140),
    scenes: tightenScenesForRuntime(scenes),
  };
}

function isClippedSceneLine(text) {
  const normalized = normalizeSpokenText(text);
  if (!normalized) return true;
  if (/\.{3}$/.test(normalized)) return true;
  return /\b(and|or|with|the|a|an|to|of|in|on|for|from|by|at|into|over|under|behind|through|is|are|was|were)\.$/i.test(normalized);
}

function isWeakStoryboard(storyboard) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  if (scenes.length !== BREAKDOWN_MAX_SCENES) return true;

  const genericHeadlines = new Set(['main issue', 'what it costs', 'one feel', 'keep this']);
  let hasActionableFeel = false;

  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const headline = normalizeSpokenText(scene?.headline || '').toLowerCase();
    const combined = normalizeSpokenText(`${scene?.headline || ''} ${scene?.caption || ''} ${scene?.narration || ''}`).toLowerCase();

    if (!scene?.frame_url || !scene?.narration || !scene?.caption) return true;
    if (genericHeadlines.has(headline)) return true;
    if (isClippedSceneLine(scene.narration) || isClippedSceneLine(scene.caption)) return true;
    if (index === 2 && /(practice|rehearse|feel|drill|center)/.test(combined)) {
      hasActionableFeel = true;
    }
  }

  return !hasActionableFeel;
}

async function callOpenAiChatCompletions(payload) {
  await ensureOpenAIKey();
  const request = applyModelSpecificControls({ ...payload });
  const responseBody = await makeHttpsRequest({
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
  }, JSON.stringify(request));
  return JSON.parse(responseBody);
}

async function buildStoryboardWithModel({ aiAnalysis, frameLookup }) {
  const fallback = buildFallbackStoryboard({ aiAnalysis, frameLookup });
  const candidateFrames = ['setup', 'top', 'delivery', 'impact', 'finish']
    .map((framePhase) => {
      const frame = selectFrameForScene(frameLookup, framePhase);
      return frame
        ? { frame_phase: framePhase, timestamp: frame.timestamp, marked: Boolean(frame.marked_url) }
        : null;
    })
    .filter(Boolean);

  const request = {
    model: BREAKDOWN_SCRIPT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You write premium, concise golf coaching voiceover scripts as strict JSON only. ' +
          'Return an object with keys title, summary, scenes. ' +
          'scenes must be an array of exactly 4 objects with keys phase, frame_phase, headline, narration, caption. ' +
          'Use a calm, trustworthy private-coach voice. Keep the total spoken runtime under 24 seconds. ' +
          'Write short spoken lines with clean cadence, one clear point per scene. ' +
          'Use roughly 12 to 16 spoken words per scene and no more than 55 spoken words total. ' +
          'Headlines should feel like coaching takeaways, not checkpoint labels or marketing. ' +
          'Captions should be subway-safe: concise, readable, and natural with the sound off. ' +
          'Use this exact teaching structure in order: 1) main issue, 2) what it costs, 3) one feel, 4) keep this. ' +
          'Scene 3 must include one explicit takeaway the golfer can rehearse immediately. ' +
          'frame_phase must be one of: setup, top, delivery, impact, finish. ' +
          'The frame_phase must match the spoken point exactly. If the point is about the top, use top. ' +
          'Avoid generic checkpoint talk unless it directly supports the diagnosis. ' +
          'Do not mention AI, tools, overlays, frames, or timestamps.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          current_coaching_response: aiAnalysis?.coaching_response || null,
          visual_observations: collectObservations(aiAnalysis).slice(0, 8),
          candidate_scene_phases: candidateFrames,
          output_constraints: {
            max_scenes: BREAKDOWN_MAX_SCENES,
            target_runtime_seconds: BREAKDOWN_TARGET_SECONDS,
            max_total_narration_words: BREAKDOWN_MAX_TOTAL_NARRATION_WORDS,
            max_narration_words_per_scene: BREAKDOWN_MAX_SCENE_NARRATION_WORDS,
            max_narration_chars_per_scene: 120,
            max_caption_chars_per_scene: BREAKDOWN_MAX_SCENE_CAPTION_CHARS,
          },
          preferred_shape: fallback,
        }),
      },
    ],
    max_completion_tokens: 650,
    response_format: { type: 'json_object' },
  };

  const response = await callOpenAiChatCompletions(request);
  const text = response?.choices?.[0]?.message?.content || '';
  const parsed = extractJsonObjectFromText(text);
  if (!parsed) return fallback;

  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  if (scenes.length === 0) return fallback;

  const candidateStoryboard = {
    title: typeof parsed.title === 'string' ? parsed.title.trim() : fallback.title,
    summary: typeof parsed.summary === 'string' ? summarizeCaption(parsed.summary, 140) : fallback.summary,
    scenes: tightenScenesForRuntime(
      scenes
        .slice(0, BREAKDOWN_MAX_SCENES)
        .map((scene, index) => {
          const phase = typeof scene?.phase === 'string' ? scene.phase : fallback.scenes[index]?.phase || 'swing_general';
          const framePhase = resolveSceneFramePhase(
            typeof scene?.frame_phase === 'string' ? scene.frame_phase : phase,
            `${scene?.headline || ''} ${scene?.caption || ''} ${scene?.narration || ''}`
          );
          const frame = selectFrameForScene(frameLookup, framePhase, index);
          const narration = summarizeCaption(
            typeof scene?.narration === 'string' ? scene.narration : fallback.scenes[index]?.narration,
            180
          );
          return {
            id: `scene_${index + 1}`,
            phase,
            frame_phase: framePhase,
            headline: typeof scene?.headline === 'string'
              ? summarizeCaption(scene.headline, 36)
              : (fallback.scenes[index]?.headline || 'Key move'),
            narration,
            caption: summarizeCaption(
              typeof scene?.caption === 'string' ? scene.caption : narration,
              110
            ),
            frame_url: frame?.marked_url || (BREAKDOWN_REQUIRE_MARKED_FRAMES ? null : frame?.url) || null,
            frame_timestamp: frame?.timestamp ?? null,
            marked: Boolean(frame?.marked_url),
          };
        })
        .filter((scene) => scene.frame_url && scene.narration)
    ),
  };

  return isWeakStoryboard(candidateStoryboard) ? fallback : candidateStoryboard;
}

function parseS3Url(url) {
  const parsed = new URL(url);
  const bucket = parsed.hostname.split('.')[0];
  const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  return { bucket, key };
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function downloadFrameToFile(url, outPath) {
  const { bucket, key } = parseS3Url(url);
  return downloadS3ObjectToFile({ bucket, key }, outPath);
}

async function downloadS3ObjectToFile({ bucket, key }, outPath) {
  const response = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buffer = await streamToBuffer(response.Body);
  await fsp.writeFile(outPath, buffer);
  return outPath;
}

function parseS3Location(s3Path) {
  if (typeof s3Path !== 'string' || !s3Path.startsWith('s3://')) return null;
  const trimmed = s3Path.slice('s3://'.length);
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) return null;
  return {
    bucket: trimmed.slice(0, slashIndex),
    key: trimmed.slice(slashIndex + 1),
  };
}

function resolveAnalysisVideoLocation(item) {
  if (typeof item?.bucket_name === 'string' && typeof item?.s3_key === 'string' && item.s3_key) {
    return {
      bucket: item.bucket_name,
      key: item.s3_key,
    };
  }

  return parseS3Location(item?.processed_video_path) || parseS3Location(item?.video_path);
}

function findBinaryInOpt(name) {
  const stack = ['/opt'];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.name === name || entry.name.endsWith(`\\${name}`)) {
        return entryPath;
      }
    }
  }
  return null;
}

function resolveBinary(name) {
  const cache = name === 'ffmpeg' ? ffmpegPath : ffprobePath;
  if (cache) return cache;

  const envPath = process.env[`${name.toUpperCase()}_PATH`];
  const candidates = [
    envPath,
    `/opt/bin/${name}`,
    `/opt/${name}`,
    `/opt/opt\\bin\\${name}`,
    name,
  ].filter(Boolean);

  let resolved = candidates.find((candidate) => candidate === name || fs.existsSync(candidate));
  if (!resolved) {
    resolved = findBinaryInOpt(name) || name;
  }

  if (name === 'ffmpeg') ffmpegPath = resolved;
  if (name === 'ffprobe') ffprobePath = resolved;
  return resolved;
}

function wrapCaptionText(text, maxLineLength = 28, maxLines = 2) {
  const normalized = normalizeSpokenText(text);
  if (!normalized) return '';

  const words = normalized.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxLineLength || !currentLine) {
      currentLine = nextLine;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
    if (lines.length >= maxLines - 1) {
      const remaining = [currentLine, ...words.slice(index + 1)].join(' ');
      lines.push(summarizeCaption(remaining, maxLineLength + 16));
      return lines.slice(0, maxLines).join('\n');
    }
  }

  if (lines.length < maxLines && currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, maxLines).join('\n');
}

function loadOverlayFonts() {
  if (!overlayFontsPromise) {
    const baseFontPath = path.join(__dirname, '..', '..', 'shared-assets', 'fonts', 'open-sans');
    overlayFontsPromise = Promise.all([
      Jimp.loadFont(path.join(baseFontPath, 'open-sans-16-white', 'open-sans-16-white.fnt')),
      Jimp.loadFont(path.join(baseFontPath, 'open-sans-32-white', 'open-sans-32-white.fnt')),
    ]).then(([meta, primary]) => ({ meta, primary }));
  }
  return overlayFontsPromise;
}

function fillRect(image, x, y, width, height, { r, g, b, a }) {
  image.scan(x, y, width, height, function scanFill(px, py, idx) {
    if (px < x || py < y || px >= x + width || py >= y + height) return;
    this.bitmap.data[idx + 0] = r;
    this.bitmap.data[idx + 1] = g;
    this.bitmap.data[idx + 2] = b;
    this.bitmap.data[idx + 3] = a;
  });
}

async function renderSceneOverlay({
  overlayPath,
  headline,
  caption,
  sceneIndex,
  totalScenes,
}) {
  const fonts = await loadOverlayFonts();
  const overlay = await new Jimp(BREAKDOWN_WIDTH, BREAKDOWN_HEIGHT, 0x00000000);
  const sceneCounter = `${String(sceneIndex + 1).padStart(2, '0')} / ${String(totalScenes).padStart(2, '0')}`;
  const wrappedCaption = wrapCaptionText(caption, 30, 2);

  fillRect(overlay, 24, 24, BREAKDOWN_WIDTH - 48, 120, { r: 7, g: 16, b: 13, a: 176 });
  fillRect(overlay, BREAKDOWN_WIDTH - 170, 28, 118, 34, { r: 7, g: 16, b: 13, a: 220 });
  fillRect(overlay, 24, BREAKDOWN_HEIGHT - 208, BREAKDOWN_WIDTH - 48, 156, { r: 7, g: 16, b: 13, a: 218 });
  fillRect(overlay, 24, 24, 10, 120, { r: 201, g: 166, b: 84, a: 240 });
  fillRect(overlay, 24, BREAKDOWN_HEIGHT - 212, BREAKDOWN_WIDTH - 48, 3, { r: 201, g: 166, b: 84, a: 224 });
  fillRect(overlay, 24, BREAKDOWN_HEIGHT - 50, BREAKDOWN_WIDTH - 48, 2, { r: 255, g: 255, b: 255, a: 32 });

  overlay.print(fonts.meta, 48, 28, {
    text: 'DIVOTLAB COACH CUT',
    alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT,
    alignmentY: Jimp.VERTICAL_ALIGN_TOP,
  }, 280, 28);
  overlay.print(fonts.meta, BREAKDOWN_WIDTH - 164, 28, {
    text: sceneCounter,
    alignmentX: Jimp.HORIZONTAL_ALIGN_RIGHT,
    alignmentY: Jimp.VERTICAL_ALIGN_TOP,
  }, 116, 28);
  overlay.print(fonts.primary, 48, 58, {
    text: normalizeSpokenText(headline || ''),
    alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT,
    alignmentY: Jimp.VERTICAL_ALIGN_TOP,
  }, BREAKDOWN_WIDTH - 96, 76);
  overlay.print(fonts.primary, 48, BREAKDOWN_HEIGHT - 184, {
    text: wrappedCaption,
    alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
    alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE,
  }, BREAKDOWN_WIDTH - 96, 128);

  await overlay.writeAsync(overlayPath);
}

async function probeMediaDuration(filePath) {
  const ffprobe = resolveBinary('ffprobe');
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return Math.max(0.1, Number.parseFloat(stdout.trim()) || 0.1);
}

async function synthesizeSceneAudio(scene, audioPath) {
  await ensureOpenAIKey();
  const body = JSON.stringify({
    model: BREAKDOWN_TTS_MODEL,
    voice: BREAKDOWN_TTS_VOICE,
    response_format: BREAKDOWN_TTS_RESPONSE_FORMAT,
    input: scene.narration,
    instructions:
      'Speak like a calm, premium golf coach. Warm, clear pacing. Confident, natural, and never theatrical.',
  });

  const audio = await makeHttpsRequest({
    hostname: 'api.openai.com',
    path: '/v1/audio/speech',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
  }, body, { binary: true });

  await fsp.writeFile(audioPath, audio);
  return probeMediaDuration(audioPath);
}

function getAudioExtension() {
  switch (BREAKDOWN_TTS_RESPONSE_FORMAT) {
    case 'wav':
    case 'mp3':
    case 'flac':
    case 'opus':
    case 'aac':
      return BREAKDOWN_TTS_RESPONSE_FORMAT;
    default:
      return 'audio';
  }
}

function buildNarrationTrackInput(scenes) {
  return scenes
    .map((scene) => trimWords(scene?.narration || scene?.caption || '', BREAKDOWN_MAX_SCENE_NARRATION_WORDS))
    .filter(Boolean)
    .join(' ');
}

async function synthesizeBreakdownAudio(scenes, audioPath) {
  await ensureOpenAIKey();
  const input = buildNarrationTrackInput(scenes);
  const body = JSON.stringify({
    model: BREAKDOWN_TTS_MODEL,
    voice: BREAKDOWN_TTS_VOICE,
    response_format: BREAKDOWN_TTS_RESPONSE_FORMAT,
    input,
    instructions:
      'Speak like one continuous premium golf lesson. Add a subtle beat between each sentence, but never reset your tone between thoughts. Calm, clear pacing. Confident, natural, and never theatrical.',
  });

  const audio = await makeHttpsRequest({
    hostname: 'api.openai.com',
    path: '/v1/audio/speech',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
  }, body, { binary: true });

  await fsp.writeFile(audioPath, audio);
  return probeMediaDuration(audioPath);
}

function buildSceneTimings(scenes, totalDurationSeconds) {
  const safeDuration = Math.max(0.1, Number(totalDurationSeconds) || 0.1);
  const weights = scenes.map((scene) => Math.max(1, countWords(scene?.narration || scene?.caption || '')));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || scenes.length;
  const minimumDuration = Math.min(3, Math.max(2.3, safeDuration / Math.max(scenes.length * 1.45, 1)));
  const minimumTotal = minimumDuration * scenes.length;
  const baseDurations = minimumTotal < safeDuration
    ? weights.map((weight) => minimumDuration + ((safeDuration - minimumTotal) * (weight / totalWeight)))
    : weights.map((weight) => safeDuration * (weight / totalWeight));

  let consumed = 0;
  const cueDurations = baseDurations.map((duration, index) => {
    if (index === baseDurations.length - 1) {
      return Number(Math.max(0.6, safeDuration - consumed).toFixed(2));
    }
    const rounded = Number(duration.toFixed(2));
    consumed += rounded;
    return rounded;
  });

  let cursor = 0;
  const timedScenes = scenes.map((scene, index) => {
    const cueDuration = cueDurations[index];
    const startSeconds = Number(cursor.toFixed(2));
    const endSeconds = Number((cursor + cueDuration).toFixed(2));
    cursor = endSeconds;
    return {
      ...scene,
      start_seconds: startSeconds,
      end_seconds: endSeconds,
    };
  });

  const clipDurations = cueDurations.map((cueDuration, index) => (
    index === cueDurations.length - 1
      ? cueDuration
      : Number((cueDuration + BREAKDOWN_SCENE_TRANSITION_SECONDS).toFixed(2))
  ));

  return { timedScenes, clipDurations };
}

async function extractSceneMotionClip({
  sourceVideoPath,
  clipPath,
  timestamp,
  targetDurationSeconds,
}) {
  if (!Number.isFinite(timestamp)) return null;

  const ffmpeg = resolveBinary('ffmpeg');
  const rawClipDuration = Math.max(0.6, Math.min(0.9, targetDurationSeconds / 1.08));
  const startSeconds = Math.max(0, timestamp - (rawClipDuration * 0.55));

  await execFileAsync(ffmpeg, [
    '-y',
    '-ss', startSeconds.toFixed(2),
    '-i', sourceVideoPath,
    '-t', rawClipDuration.toFixed(2),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    clipPath,
  ]);

  return clipPath;
}

async function extractVideoFrameAtTimestamp({ sourceVideoPath, framePath, timestamp }) {
  const ffmpeg = resolveBinary('ffmpeg');
  await execFileAsync(ffmpeg, [
    '-y',
    '-ss', Number(Math.max(0, timestamp).toFixed(2)),
    '-i', sourceVideoPath,
    '-frames:v', '1',
    '-update', '1',
    framePath,
  ]);
  return framePath;
}

function formatSubtitleTimestamp(seconds, format = 'vtt') {
  const totalMilliseconds = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const secs = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const separator = format === 'srt' ? ',' : '.';
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(secs).padStart(2, '0'),
  ].join(':') + `${separator}${String(milliseconds).padStart(3, '0')}`;
}

async function writeSubtitleFile({ scenes, filePath, format = 'vtt' }) {
  const rows = [];
  if (format === 'vtt') {
    rows.push('WEBVTT', '');
  }

  let cueIndex = 1;
  for (const scene of scenes) {
    const caption = normalizeSpokenText(scene?.caption || scene?.narration || '');
    if (!caption) continue;

    const headline = normalizeSpokenText(scene?.headline || '');
    const startSeconds = Math.max(0, Number(scene?.start_seconds) || 0);
    const endSeconds = Math.max(startSeconds + 0.4, Number(scene?.end_seconds) || startSeconds + 0.4);
    const lines = [];
    if (headline && headline.toLowerCase() !== caption.toLowerCase()) {
      lines.push(headline);
    }
    lines.push(caption);

    if (format === 'srt') {
      rows.push(String(cueIndex));
    }
    rows.push(
      `${formatSubtitleTimestamp(startSeconds, format)} --> ${formatSubtitleTimestamp(endSeconds, format)}`
    );
    rows.push(lines.join('\n'));
    rows.push('');
    cueIndex += 1;
  }

  await fsp.writeFile(filePath, rows.join('\n'));
}

function buildMuxNarrationArgs({ videoPath, audioPath, subtitlePath, outputPath }) {
  return [
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-i', subtitlePath,
    '-map', '0:v',
    '-map', '1:a',
    '-map', '2:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-c:s', 'mov_text',
    '-movflags', '+faststart',
    '-metadata:s:s:0', 'language=eng',
    '-metadata:s:s:0', 'handler_name=English',
    '-disposition:s:0', 'default',
    outputPath,
  ];
}

async function muxNarrationAndSubtitleTrack({ videoPath, audioPath, subtitlePath, outputPath }) {
  const ffmpeg = resolveBinary('ffmpeg');
  await execFileAsync(ffmpeg, buildMuxNarrationArgs({
    videoPath,
    audioPath,
    subtitlePath,
    outputPath,
  }));
}

function buildGeneratedFramePrefix(item) {
  const userId = item?.user_id || 'video-breakdown-lab';
  const analysisId = item?.analysis_id || 'breakdown';
  return `golf-swings/${userId}/frames/${analysisId}-breakdown-generated`;
}

async function invokeSwingMarker({ bucketName, frameKeys, outPrefix }) {
  const response = await getLambdaClient().send(new InvokeCommand({
    FunctionName: SWING_MARKER_FUNCTION_NAME,
    Payload: Buffer.from(JSON.stringify({
      bucket: bucketName,
      frame_keys: frameKeys,
      out_prefix: outPrefix,
    })),
  }));

  const payloadText = response?.Payload ? Buffer.from(response.Payload).toString('utf8') : '{}';
  const parsed = parseMaybeJson(payloadText) || {};
  if (parsed.generated !== true || !Array.isArray(parsed.marked_keys) || parsed.marked_keys.length === 0) {
    throw new Error(parsed.reason || parsed.errorMessage || 'Swing marker did not return marked frames');
  }
  return parsed;
}

async function createCustomMarkedImpactFrame({
  item,
  bucketName,
  sourceVideoPath,
  tempRoot,
  frameLookup,
}) {
  const preciseTimestamp = derivePreciseImpactTimestamp(frameLookup, frameLookup?.pickForPhase?.('impact')?.timestamp);
  const prefix = buildGeneratedFramePrefix(item);
  const addressLocalPath = path.join(tempRoot, 'generated-impact-address.jpg');
  const impactLocalPath = path.join(tempRoot, 'generated-impact-frame.jpg');
  const markedLocalPath = path.join(tempRoot, 'generated-impact-marked.jpg');
  const addressKey = `${prefix}/plain/address.jpg`;
  const impactKey = `${prefix}/plain/impact-${String(preciseTimestamp).replace('.', '-')}.jpg`;
  const markedPrefix = `${prefix}/marked`;

  await extractVideoFrameAtTimestamp({ sourceVideoPath, framePath: addressLocalPath, timestamp: 0 });
  await extractVideoFrameAtTimestamp({ sourceVideoPath, framePath: impactLocalPath, timestamp: preciseTimestamp });
  await uploadFileToS3(addressLocalPath, bucketName, addressKey, 'image/jpeg');
  await uploadFileToS3(impactLocalPath, bucketName, impactKey, 'image/jpeg');

  const markerResult = await invokeSwingMarker({
    bucketName,
    frameKeys: [addressKey, impactKey],
    outPrefix: markedPrefix,
  });
  const markedKey = markerResult.marked_keys[1] || markerResult.marked_keys[markerResult.marked_keys.length - 1];
  await downloadS3ObjectToFile({ bucket: bucketName, key: markedKey }, markedLocalPath);

  return {
    localPath: markedLocalPath,
    frameTimestamp: preciseTimestamp,
    frameUrl: `https://${bucketName}.s3.amazonaws.com/${markedKey}`,
    marked: true,
  };
}

async function createFeelFocusFrame({ sourceFramePath, outputPath }) {
  const source = await Jimp.read(sourceFramePath);
  const canvas = source.clone()
    .cover(BREAKDOWN_WIDTH, BREAKDOWN_HEIGHT)
    .blur(4)
    .brightness(-0.18);

  const cropX = Math.round(source.bitmap.width * 0.14);
  const cropY = Math.round(source.bitmap.height * 0.08);
  const cropWidth = Math.round(source.bitmap.width * 0.56);
  const cropHeight = Math.round(source.bitmap.height * 0.62);
  const focusCardX = 58;
  const focusCardY = 168;
  const focusCardWidth = BREAKDOWN_WIDTH - 116;
  const focusCardHeight = BREAKDOWN_HEIGHT - 428;
  const focusPanel = source.clone()
    .crop(cropX, cropY, cropWidth, cropHeight)
    .cover(focusCardWidth, focusCardHeight)
    .brightness(0.04)
    .contrast(0.06);

  fillRect(canvas, focusCardX - 8, focusCardY - 8, focusCardWidth + 16, focusCardHeight + 16, { r: 0, g: 0, b: 0, a: 132 });
  fillRect(canvas, focusCardX - 8, focusCardY - 8, 5, focusCardHeight + 16, { r: 201, g: 166, b: 84, a: 214 });
  fillRect(canvas, focusCardX - 8, focusCardY - 8, focusCardWidth + 16, 3, { r: 201, g: 166, b: 84, a: 188 });
  canvas.composite(focusPanel, focusCardX, focusCardY);

  const fonts = await loadOverlayFonts();
  const labelWidth = 126;
  const labelY = focusCardY + 18;
  fillRect(canvas, focusCardX + 18, labelY, labelWidth, 30, { r: 7, g: 16, b: 13, a: 214 });
  fillRect(canvas, focusCardX + 18 + labelWidth + 10, labelY + 13, 94, 4, { r: 201, g: 166, b: 84, a: 176 });
  canvas.print(fonts.meta, focusCardX + 18, labelY + 5, {
    text: 'FEEL TARGET',
    alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
    alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE,
  }, labelWidth, 20);

  await canvas.quality(92).writeAsync(outputPath);
  return outputPath;
}

async function renderSceneVideo({
  motionClipPath = null,
  framePath,
  scenePath,
  overlayPath,
  durationSeconds,
  sceneIndex,
  totalScenes,
}) {
  const ffmpeg = resolveBinary('ffmpeg');
  const frameCount = Math.max(2, Math.ceil(durationSeconds * BREAKDOWN_FPS));
  const fadeOutStart = Math.max(0.1, durationSeconds - 0.28);
  const progressRatio = Math.max(0.16, (sceneIndex + 1) / Math.max(totalScenes, 1));
  const progressWidth = Math.round((BREAKDOWN_WIDTH - 48) * progressRatio);
  const zoomRate = (0.0009 + (sceneIndex * 0.00006)).toFixed(5);
  const hasMotionPrelude = Boolean(motionClipPath);
  const motionLeadSeconds = hasMotionPrelude
    ? Math.min(0.92, Math.max(0.72, durationSeconds * 0.16))
    : 0;
  const freezeTransitionOffset = Math.max(0.16, motionLeadSeconds - 0.16).toFixed(2);
  const stillInputIndex = hasMotionPrelude ? 1 : 0;
  const overlayInputIndex = hasMotionPrelude ? 2 : 1;

  const freezeBaseFilter = [
    `[${stillInputIndex}:v]scale=${BREAKDOWN_WIDTH}:${BREAKDOWN_HEIGHT}:force_original_aspect_ratio=increase,crop=${BREAKDOWN_WIDTH}:${BREAKDOWN_HEIGHT},eq=saturation=0.82:contrast=1.08:brightness=-0.03,boxblur=24:3[bg]`,
    `[${stillInputIndex}:v]scale=${BREAKDOWN_WIDTH - 48}:${BREAKDOWN_HEIGHT - 224}:force_original_aspect_ratio=decrease,zoompan=z='min(zoom+${zoomRate},1.065)':d=${frameCount}:s=${BREAKDOWN_WIDTH - 48}x${BREAKDOWN_HEIGHT - 224}:fps=${BREAKDOWN_FPS},eq=saturation=1.04:contrast=1.02,unsharp=3:3:0.4[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto,` +
      `drawbox=x=0:y=0:w=iw:h=132:color=0x07100D@0.18:t=fill,` +
      `drawbox=x=0:y=ih-172:w=iw:h=172:color=0x07100D@0.24:t=fill,` +
      `drawbox=x=24:y=24:w=iw-48:h=ih-48:color=0xFFFFFF@0.08:t=2,` +
      `drawbox=x=24:y=42:w=10:h=108:color=0xC9A654@0.85:t=fill,` +
      `drawbox=x=24:y=ih-36:w=iw-48:h=2:color=0xFFFFFF@0.10:t=fill,` +
      `drawbox=x=24:y=ih-36:w=${progressWidth}:h=2:color=0xC9A654@0.96:t=fill,` +
      `fps=${BREAKDOWN_FPS},settb=AVTB,format=yuv420p[freeze]`,
  ];

  const filter = hasMotionPrelude
    ? [
      `[0:v]scale=${BREAKDOWN_WIDTH}:${BREAKDOWN_HEIGHT}:force_original_aspect_ratio=increase,crop=${BREAKDOWN_WIDTH}:${BREAKDOWN_HEIGHT},fps=${BREAKDOWN_FPS},trim=duration=${motionLeadSeconds.toFixed(2)},setpts=PTS-STARTPTS*1.08,eq=saturation=1.02:contrast=1.03:brightness=-0.01,unsharp=3:3:0.35,settb=AVTB,format=yuv420p[motion]`,
      ...freezeBaseFilter,
      `[motion][freeze]xfade=transition=fade:duration=0.16:offset=${freezeTransitionOffset}[scene_base]`,
      `[${overlayInputIndex}:v]scale=${BREAKDOWN_WIDTH}:${BREAKDOWN_HEIGHT}:force_original_aspect_ratio=disable[ov]`,
      `[scene_base][ov]overlay=0:0:format=auto,fade=t=in:st=0:d=0.18,fade=t=out:st=${fadeOutStart.toFixed(2)}:d=0.24,format=yuv420p[v]`,
    ].join(';')
    : [
      ...freezeBaseFilter,
      `[${overlayInputIndex}:v]scale=${BREAKDOWN_WIDTH}:${BREAKDOWN_HEIGHT}:force_original_aspect_ratio=disable[ov]`,
      `[freeze][ov]overlay=0:0:format=auto,fade=t=in:st=0:d=0.18,fade=t=out:st=${fadeOutStart.toFixed(2)}:d=0.24,format=yuv420p[v]`,
    ].join(';');

  const args = hasMotionPrelude
    ? [
      '-y',
      '-i', motionClipPath,
      '-loop', '1',
      '-i', framePath,
      '-loop', '1',
      '-i', overlayPath,
      '-filter_complex', filter,
      '-map', '[v]',
      '-t', durationSeconds.toFixed(2),
      '-r', String(BREAKDOWN_FPS),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-an',
      scenePath,
    ]
    : [
      '-y',
      '-loop', '1',
      '-i', framePath,
      '-loop', '1',
      '-i', overlayPath,
      '-filter_complex', filter,
      '-map', '[v]',
      '-t', durationSeconds.toFixed(2),
      '-r', String(BREAKDOWN_FPS),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-an',
      scenePath,
    ];

  await execFileAsync(ffmpeg, args);
}

async function stitchVideosWithTransitions(scenePaths, sceneDurations, outputPath) {
  if (scenePaths.length === 1) {
    await fsp.copyFile(scenePaths[0], outputPath);
    return outputPath;
  }

  const ffmpeg = resolveBinary('ffmpeg');
  const args = ['-y'];
  scenePaths.forEach((scenePath) => {
    args.push('-i', scenePath);
  });

  const filterParts = [];
  scenePaths.forEach((_, index) => {
    filterParts.push(`[${index}:v]setpts=PTS-STARTPTS,fps=${BREAKDOWN_FPS},format=yuv420p[v${index}]`);
  });

  let currentVideoLabel = 'v0';
  let accumulatedOffset = sceneDurations[0];

  for (let index = 1; index < scenePaths.length; index += 1) {
    const nextVideoLabel = `v${index}`;
    const outputVideoLabel = `vx${index}`;
    const xfadeOffset = Math.max(0.1, accumulatedOffset - BREAKDOWN_SCENE_TRANSITION_SECONDS);

    filterParts.push(
      `[${currentVideoLabel}][${nextVideoLabel}]xfade=transition=fade:duration=${BREAKDOWN_SCENE_TRANSITION_SECONDS}:offset=${xfadeOffset.toFixed(2)}[${outputVideoLabel}]`
    );

    currentVideoLabel = outputVideoLabel;
    accumulatedOffset += sceneDurations[index] - BREAKDOWN_SCENE_TRANSITION_SECONDS;
  }

  args.push(
    '-filter_complex', filterParts.join(';'),
    '-map', `[${currentVideoLabel}]`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    outputPath,
  );

  await execFileAsync(ffmpeg, args);

  return outputPath;
}

async function extractPosterFrame(videoPath, posterPath, seekSeconds = 0.8) {
  const ffmpeg = resolveBinary('ffmpeg');
  await execFileAsync(ffmpeg, [
    '-y',
    '-ss', Number(Math.max(0.2, seekSeconds).toFixed(2)),
    '-i', videoPath,
    '-frames:v', '1',
    '-update', '1',
    posterPath,
  ]);
}

function buildBreakdownStoragePrefix(item) {
  const bucketName = item?.bucket_name || process.env.EXPO_PUBLIC_VIDEO_BUCKET || process.env.VIDEO_BUCKET;
  const userId = item?.user_id;
  const analysisId = item?.analysis_id;
  return {
    bucketName,
    videoKey: `golf-swings/${userId}/${analysisId}/breakdown/${analysisId}-breakdown.mp4`,
    posterKey: `golf-swings/${userId}/${analysisId}/breakdown/${analysisId}-breakdown-poster.jpg`,
    captionsKey: `golf-swings/${userId}/${analysisId}/breakdown/${analysisId}-breakdown.vtt`,
  };
}

async function uploadFileToS3(filePath, bucketName, key, contentType) {
  const body = await fsp.readFile(filePath);
  await getS3Client().send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return `https://${bucketName}.s3.amazonaws.com/${key}`;
}

function buildQueuedBreakdown(existing = {}) {
  return {
    version: BREAKDOWN_VERSION,
    status: 'queued',
    title: existing.title || 'Swing Breakdown',
    summary: existing.summary || 'Muted by default. Captions stay on.',
    muted_default: BREAKDOWN_MUTED_DEFAULT,
    voice: BREAKDOWN_TTS_VOICE,
    requested_at: existing.requested_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    scenes: Array.isArray(existing.scenes) ? existing.scenes : [],
  };
}

async function updateBreakdownRecord(analysisId, breakdown) {
  await getDynamoClient().send(new UpdateCommand({
    TableName: process.env.DYNAMODB_TABLE,
    Key: { analysis_id: analysisId },
    UpdateExpression: 'SET video_breakdown = :breakdown, updated_at = :timestamp',
    ExpressionAttributeValues: {
      ':breakdown': breakdown,
      ':timestamp': new Date().toISOString(),
    },
  }));
}

async function loadAnalysisRecord(analysisId) {
  const result = await getDynamoClient().send(new GetCommand({
    TableName: process.env.DYNAMODB_TABLE,
    Key: { analysis_id: analysisId },
  }));
  return result.Item || null;
}

async function buildRenderedBreakdown(item) {
  const aiAnalysis = parseMaybeJson(item.ai_analysis);
  const analysisResults = parseMaybeJson(item.analysis_results);
  if (!aiAnalysis?.coaching_response) {
    throw new Error('Analysis record is missing coaching_response');
  }

  const frameLookup = buildFrameLookup(analysisResults || {});
  if (!frameLookup.frames.length) {
    throw new Error('Analysis record is missing extracted frames');
  }

  const storyboard = await buildStoryboardWithModel({ aiAnalysis, frameLookup });
  if (!Array.isArray(storyboard.scenes) || storyboard.scenes.length === 0) {
    throw new Error('Could not build storyboard scenes');
  }
  if (BREAKDOWN_REQUIRE_MARKED_FRAMES && storyboard.scenes.some((scene) => !scene.marked || !scene.frame_url)) {
    throw new Error('Breakdown requires marked frames for every selected scene');
  }

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'swing-breakdown-'));
  const scenePaths = [];
  const { bucketName, videoKey, posterKey, captionsKey } = buildBreakdownStoragePrefix(item);

  try {
    let sourceVideoPath = null;
    const videoLocation = resolveAnalysisVideoLocation(item);
    if (videoLocation) {
      const extension = path.extname(videoLocation.key || '') || '.mov';
      const candidatePath = path.join(tempRoot, `source-video${extension}`);
      try {
        await downloadS3ObjectToFile(videoLocation, candidatePath);
        sourceVideoPath = candidatePath;
      } catch (error) {
        console.warn('Failed to download source swing video for motion prelude:', error.message);
      }
    }

    const narrationAudioPath = path.join(tempRoot, `breakdown-narration.${getAudioExtension()}`);
    const narrationDurationSeconds = await synthesizeBreakdownAudio(storyboard.scenes, narrationAudioPath);
    if (narrationDurationSeconds > BREAKDOWN_MAX_RUNTIME_SECONDS) {
      throw new Error(`Breakdown narration exceeded ${BREAKDOWN_MAX_RUNTIME_SECONDS} seconds before final render`);
    }
    const { timedScenes, clipDurations } = buildSceneTimings(storyboard.scenes, narrationDurationSeconds);

    for (let index = 0; index < timedScenes.length; index += 1) {
      const scene = timedScenes[index];
      const framePath = path.join(tempRoot, `scene-${index + 1}.jpg`);
      const scenePath = path.join(tempRoot, `scene-${index + 1}.mp4`);
      const overlayPath = path.join(tempRoot, `scene-${index + 1}-overlay.png`);
      const motionClipPath = path.join(tempRoot, `scene-${index + 1}-motion.mp4`);
      const renderedScene = { ...scene };
      if (
        index === 1
        && sourceVideoPath
        && bucketName
      ) {
        try {
          const impactFrame = await createCustomMarkedImpactFrame({
            item,
            bucketName,
            sourceVideoPath,
            tempRoot,
            frameLookup,
          });
          await fsp.copyFile(impactFrame.localPath, framePath);
          renderedScene.frame_url = impactFrame.frameUrl;
          renderedScene.frame_timestamp = impactFrame.frameTimestamp;
          renderedScene.frame_phase = 'impact';
          renderedScene.marked = true;
        } catch (error) {
          console.warn('Failed to render a custom impact proof frame:', error.message);
          await downloadFrameToFile(scene.frame_url, framePath);
        }
      } else {
        await downloadFrameToFile(scene.frame_url, framePath);
      }

      if (index === 2) {
        const splitFramePath = path.join(tempRoot, `scene-${index + 1}-feel.jpg`);
        await createFeelFocusFrame({ sourceFramePath: framePath, outputPath: splitFramePath });
        await fsp.copyFile(splitFramePath, framePath);
        if (bucketName) {
          const feelKey = `golf-swings/${item.user_id}/${item.analysis_id}/breakdown/${item.analysis_id}-scene-${index + 1}-feel.jpg`;
          renderedScene.frame_url = await uploadFileToS3(splitFramePath, bucketName, feelKey, 'image/jpeg');
        }
      }

      await renderSceneOverlay({
        overlayPath,
        headline: renderedScene.headline || '',
        caption: renderedScene.caption || renderedScene.narration,
        sceneIndex: index,
        totalScenes: timedScenes.length,
      });
      let motionPreludePath = null;
      if (sourceVideoPath && Number.isFinite(renderedScene.frame_timestamp)) {
        try {
          motionPreludePath = await extractSceneMotionClip({
            sourceVideoPath,
            clipPath: motionClipPath,
            timestamp: renderedScene.frame_timestamp,
            targetDurationSeconds: Math.min(0.92, Math.max(0.72, clipDurations[index] * 0.16)),
          });
        } catch (error) {
          console.warn(`Failed to render motion prelude for scene ${index + 1}:`, error.message);
        }
      }
      await renderSceneVideo({
        motionClipPath: motionPreludePath,
        framePath,
        scenePath,
        overlayPath,
        durationSeconds: clipDurations[index],
        sceneIndex: index,
        totalScenes: timedScenes.length,
      });

      scenePaths.push(scenePath);
      timedScenes[index] = renderedScene;
    }

    const stitchedVideoPath = path.join(tempRoot, 'breakdown-stitched.mp4');
    const breakdownVideoPath = path.join(tempRoot, 'breakdown.mp4');
    const posterPath = path.join(tempRoot, 'breakdown-poster.jpg');
    const captionsSrtPath = path.join(tempRoot, 'breakdown-captions.srt');
    const captionsVttPath = path.join(tempRoot, 'breakdown-captions.vtt');
    await stitchVideosWithTransitions(scenePaths, clipDurations, stitchedVideoPath);

    await writeSubtitleFile({ scenes: timedScenes, filePath: captionsSrtPath, format: 'srt' });
    await writeSubtitleFile({ scenes: timedScenes, filePath: captionsVttPath, format: 'vtt' });
    await muxNarrationAndSubtitleTrack({
      videoPath: stitchedVideoPath,
      audioPath: narrationAudioPath,
      subtitlePath: captionsSrtPath,
      outputPath: breakdownVideoPath,
    });

    const durationSeconds = await probeMediaDuration(breakdownVideoPath);
    const posterSeekSeconds = Math.min(
      Math.max(0.8, durationSeconds - 0.8),
      Math.max(0.8, durationSeconds * 0.55)
    );
    await extractPosterFrame(breakdownVideoPath, posterPath, posterSeekSeconds);
    if (durationSeconds > BREAKDOWN_MAX_RUNTIME_SECONDS) {
      throw new Error(`Breakdown exceeded ${BREAKDOWN_MAX_RUNTIME_SECONDS} seconds after render`);
    }
    if (!bucketName) {
      throw new Error('No bucket name available for breakdown upload');
    }

    const [videoUrl, posterUrl, captionsUrl] = await Promise.all([
      uploadFileToS3(breakdownVideoPath, bucketName, videoKey, 'video/mp4'),
      uploadFileToS3(posterPath, bucketName, posterKey, 'image/jpeg'),
      uploadFileToS3(captionsVttPath, bucketName, captionsKey, 'text/vtt; charset=utf-8'),
    ]);

    return {
      version: BREAKDOWN_VERSION,
      status: 'completed',
      title: storyboard.title || 'Swing Breakdown',
      summary: storyboard.summary || summarizeCaption(aiAnalysis.coaching_response, 140),
      duration_seconds: Number(durationSeconds.toFixed(2)),
      muted_default: BREAKDOWN_MUTED_DEFAULT,
      voice: BREAKDOWN_TTS_VOICE,
      video_url: videoUrl,
      video_s3_key: videoKey,
      poster_url: posterUrl,
      poster_s3_key: posterKey,
      captions_url: captionsUrl,
      captions_s3_key: captionsKey,
      captions_default: true,
      embedded_captions: true,
      requested_at: item.video_breakdown?.requested_at || new Date().toISOString(),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      scenes: timedScenes.map((scene) => ({
        ...scene,
        poster_url: posterUrl,
      })),
    };
  } finally {
    try {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean temporary breakdown directory:', error.message);
    }
  }
}

async function processVideoBreakdown(event) {
  const analysisId = event?.analysis_id;
  if (!analysisId) {
    throw new Error('analysis_id is required');
  }

  const item = await loadAnalysisRecord(analysisId);
  if (!item) {
    throw new Error(`Analysis ${analysisId} was not found`);
  }
  if (!item.ai_analysis_completed) {
    throw new Error(`Analysis ${analysisId} is not complete yet`);
  }

  const queued = buildQueuedBreakdown(item.video_breakdown || {});
  queued.status = 'processing';
  await updateBreakdownRecord(analysisId, queued);

  const completed = await buildRenderedBreakdown({
    ...item,
    video_breakdown: queued,
  });
  await updateBreakdownRecord(analysisId, completed);
  return completed;
}

exports.handler = async (event) => {
  console.log('VIDEO BREAKDOWN PROCESSOR event:', JSON.stringify(event));
  try {
    const result = await processVideoBreakdown(event || {});
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: result.status,
        analysis_id: event?.analysis_id || null,
        duration_seconds: result.duration_seconds,
      }),
    };
  } catch (error) {
    console.error('VIDEO BREAKDOWN PROCESSOR failed:', error);
    const analysisId = event?.analysis_id;
    if (analysisId) {
      try {
        const failed = {
          ...buildQueuedBreakdown((await loadAnalysisRecord(analysisId))?.video_breakdown || {}),
          status: 'failed',
          updated_at: new Date().toISOString(),
          error_message: error.message,
        };
        await updateBreakdownRecord(analysisId, failed);
      } catch (persistError) {
        console.error('Failed to persist breakdown failure:', persistError);
      }
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
        analysis_id: analysisId || null,
      }),
    };
  }
};

exports.__private = {
  BREAKDOWN_MAX_RUNTIME_SECONDS,
  BREAKDOWN_REQUIRE_MARKED_FRAMES,
  buildFallbackStoryboard,
  buildMuxNarrationArgs,
  derivePreciseImpactTimestamp,
  estimateBreakdownRuntime,
  finalizeSceneHeadline,
  formatSubtitleTimestamp,
  isWeakStoryboard,
  normalizeSpokenText,
  pickClosestMarkedFrame,
  selectFrameForScene,
  tightenScenesForRuntime,
};
