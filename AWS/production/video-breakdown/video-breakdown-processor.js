'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
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
let cachedOpenAIKey = null;
let ffmpegPath = null;
let ffprobePath = null;

const HTTP_REQUEST_TIMEOUT_MS = parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || '45000', 10);
const BREAKDOWN_SCRIPT_MODEL = process.env.VIDEO_BREAKDOWN_SCRIPT_MODEL || 'gpt-5.6-luna';
const BREAKDOWN_TTS_MODEL = process.env.VIDEO_BREAKDOWN_TTS_MODEL || 'gpt-4o-mini-tts';
const BREAKDOWN_TTS_VOICE = process.env.VIDEO_BREAKDOWN_VOICE || 'cedar';
const BREAKDOWN_WIDTH = Math.max(540, parseInt(process.env.VIDEO_BREAKDOWN_WIDTH || '720', 10));
const BREAKDOWN_HEIGHT = Math.max(960, parseInt(process.env.VIDEO_BREAKDOWN_HEIGHT || '1280', 10));
const BREAKDOWN_FPS = Math.max(24, parseInt(process.env.VIDEO_BREAKDOWN_FPS || '30', 10));

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
  return `${clean.slice(0, maxLength - 1).trimEnd()}…`;
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

function buildFallbackStoryboard({ aiAnalysis, frameLookup }) {
  const observations = collectObservations(aiAnalysis);
  const coachingResponse = safeSentence(
    aiAnalysis?.coaching_response,
    'Here is the cleanest read from your swing.'
  );

  const selected = [];
  const usedPhases = new Set();
  for (const observation of observations) {
    if (selected.length >= BREAKDOWN_MAX_SCENES) break;
    const phase = observation.phase || 'swing_general';
    if (usedPhases.has(phase) && phase !== 'impact') continue;
    usedPhases.add(phase);
    selected.push(observation);
  }

  if (selected.length === 0) {
    selected.push({ phase: 'setup', observation: coachingResponse, impact: 'neutral', confidence: 0.6 });
  }

  const scenes = selected.map((observation, index) => {
    const frame = frameLookup.pickForPhase(observation.phase) || frameLookup.frames[index] || frameLookup.frames[0];
    const phaseLabel = (observation.phase || 'swing_general').replace(/_/g, ' ');
    const narration = index === 0
      ? `${coachingResponse} ${safeSentence(observation.observation, '')}`.trim()
      : safeSentence(observation.observation, coachingResponse);

    return {
      id: `scene_${index + 1}`,
      phase: observation.phase || 'swing_general',
      headline: index === 0 ? 'What stands out' : phaseLabel.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      narration: summarizeCaption(narration, 180),
      caption: summarizeCaption(narration, 110),
      frame_url: frame?.marked_url || frame?.url || null,
      frame_timestamp: frame?.timestamp ?? null,
      marked: Boolean(frame?.marked_url),
    };
  });

  return {
    title: 'Swing Breakdown',
    summary: summarizeCaption(coachingResponse, 140),
    scenes,
  };
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
  const candidateFrames = ['setup', 'backswing', 'transition', 'impact', 'follow_through']
    .map((phase) => {
      const frame = frameLookup.pickForPhase(phase);
      return frame
        ? { phase, timestamp: frame.timestamp, marked: Boolean(frame.marked_url) }
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
          'scenes must be an array of 3 or 4 objects with keys phase, headline, narration, caption. ' +
          'Use a calm, trustworthy private-coach voice. Keep the total spoken runtime under 26 seconds. ' +
          'Captions should be subway-safe: concise, readable, and natural with the sound off. ' +
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
            max_narration_chars_per_scene: 180,
            max_caption_chars_per_scene: 110,
          },
          preferred_shape: fallback,
        }),
      },
    ],
    max_completion_tokens: 900,
    response_format: { type: 'json_object' },
  };

  const response = await callOpenAiChatCompletions(request);
  const text = response?.choices?.[0]?.message?.content || '';
  const parsed = extractJsonObjectFromText(text);
  if (!parsed) return fallback;

  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  if (scenes.length === 0) return fallback;

  return {
    title: typeof parsed.title === 'string' ? parsed.title.trim() : fallback.title,
    summary: typeof parsed.summary === 'string' ? summarizeCaption(parsed.summary, 140) : fallback.summary,
    scenes: scenes
      .slice(0, BREAKDOWN_MAX_SCENES)
      .map((scene, index) => {
        const phase = typeof scene?.phase === 'string' ? scene.phase : fallback.scenes[index]?.phase || 'swing_general';
        const frame = frameLookup.pickForPhase(phase) || frameLookup.frames[index] || frameLookup.frames[0];
        const narration = summarizeCaption(
          typeof scene?.narration === 'string' ? scene.narration : fallback.scenes[index]?.narration,
          180
        );
        return {
          id: `scene_${index + 1}`,
          phase,
          headline: typeof scene?.headline === 'string'
            ? summarizeCaption(scene.headline, 36)
            : (fallback.scenes[index]?.headline || 'Key move'),
          narration,
          caption: summarizeCaption(
            typeof scene?.caption === 'string' ? scene.caption : narration,
            110
          ),
          frame_url: frame?.marked_url || frame?.url || null,
          frame_timestamp: frame?.timestamp ?? null,
          marked: Boolean(frame?.marked_url),
        };
      })
      .filter((scene) => scene.frame_url && scene.narration),
  };
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
  const response = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buffer = await streamToBuffer(response.Body);
  await fsp.writeFile(outPath, buffer);
  return outPath;
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
    response_format: 'mp3',
    input: scene.narration,
    instructions:
      'Speak like a calm, premium golf coach. Clear pacing. Confident, natural, and not theatrical.',
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

async function renderSceneVideo({ framePath, audioPath, scenePath, durationSeconds }) {
  const ffmpeg = resolveBinary('ffmpeg');
  const frameCount = Math.max(2, Math.ceil(durationSeconds * BREAKDOWN_FPS));
  const fadeOutStart = Math.max(0.1, durationSeconds - 0.28);
  const filter = [
    `[0:v]scale=${BREAKDOWN_WIDTH}:${BREAKDOWN_HEIGHT}:force_original_aspect_ratio=increase,crop=${BREAKDOWN_WIDTH}:${BREAKDOWN_HEIGHT},boxblur=18:2[bg]`,
    `[0:v]scale=${BREAKDOWN_WIDTH - 48}:${BREAKDOWN_HEIGHT - 220}:force_original_aspect_ratio=decrease,zoompan=z='min(zoom+0.0009,1.05)':d=${frameCount}:s=${BREAKDOWN_WIDTH - 48}x${BREAKDOWN_HEIGHT - 220}:fps=${BREAKDOWN_FPS}[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto,fade=t=in:st=0:d=0.18,fade=t=out:st=${fadeOutStart.toFixed(2)}:d=0.24,format=yuv420p[v]`,
  ].join(';');

  await execFileAsync(ffmpeg, [
    '-y',
    '-loop', '1',
    '-i', framePath,
    '-i', audioPath,
    '-filter_complex', filter,
    '-map', '[v]',
    '-map', '1:a',
    '-t', durationSeconds.toFixed(2),
    '-r', String(BREAKDOWN_FPS),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    scenePath,
  ]);
}

async function concatVideos(scenePaths, outputPath) {
  const ffmpeg = resolveBinary('ffmpeg');
  const concatPath = path.join(path.dirname(outputPath), 'concat.txt');
  const concatBody = scenePaths.map((scenePath) => `file '${scenePath.replace(/'/g, "'\\''")}'`).join('\n');
  await fsp.writeFile(concatPath, concatBody);

  await execFileAsync(ffmpeg, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    '-c', 'copy',
    outputPath,
  ]);

  return outputPath;
}

async function extractPosterFrame(videoPath, posterPath) {
  const ffmpeg = resolveBinary('ffmpeg');
  await execFileAsync(ffmpeg, [
    '-y',
    '-i', videoPath,
    '-frames:v', '1',
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

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'swing-breakdown-'));
  const scenePaths = [];

  try {
    let currentTime = 0;
    const renderedScenes = [];

    for (let index = 0; index < storyboard.scenes.length; index += 1) {
      const scene = storyboard.scenes[index];
      const framePath = path.join(tempRoot, `scene-${index + 1}.jpg`);
      const audioPath = path.join(tempRoot, `scene-${index + 1}.mp3`);
      const scenePath = path.join(tempRoot, `scene-${index + 1}.mp4`);

      await downloadFrameToFile(scene.frame_url, framePath);
      const durationSeconds = await synthesizeSceneAudio(scene, audioPath);
      await renderSceneVideo({
        framePath,
        audioPath,
        scenePath,
        durationSeconds,
      });

      scenePaths.push(scenePath);
      renderedScenes.push({
        ...scene,
        start_seconds: Number(currentTime.toFixed(2)),
        end_seconds: Number((currentTime + durationSeconds).toFixed(2)),
      });
      currentTime += durationSeconds;
    }

    const breakdownVideoPath = path.join(tempRoot, 'breakdown.mp4');
    const posterPath = path.join(tempRoot, 'breakdown-poster.jpg');
    await concatVideos(scenePaths, breakdownVideoPath);
    await extractPosterFrame(breakdownVideoPath, posterPath);

    const durationSeconds = await probeMediaDuration(breakdownVideoPath);
    const { bucketName, videoKey, posterKey } = buildBreakdownStoragePrefix(item);
    if (!bucketName) {
      throw new Error('No bucket name available for breakdown upload');
    }

    const [videoUrl, posterUrl] = await Promise.all([
      uploadFileToS3(breakdownVideoPath, bucketName, videoKey, 'video/mp4'),
      uploadFileToS3(posterPath, bucketName, posterKey, 'image/jpeg'),
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
      requested_at: item.video_breakdown?.requested_at || new Date().toISOString(),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      scenes: renderedScenes.map((scene) => ({
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
