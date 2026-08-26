'use strict';

const BREAKDOWN_VERSION = '2026-08-08.v2';
const BREAKDOWN_TARGET_SECONDS = 26;
const BREAKDOWN_MAX_SCENES = 4;
const BREAKDOWN_MUTED_DEFAULT = true;

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function clampNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCue(cue, index) {
  if (!cue || typeof cue !== 'object') return null;

  const startSeconds = clampNumber(cue.start_seconds, 0);
  const endSeconds = clampNumber(cue.end_seconds, startSeconds);
  const caption = typeof cue.caption === 'string' ? cue.caption.trim() : '';
  const narration = typeof cue.narration === 'string' ? cue.narration.trim() : caption;

  if (!caption && !narration) return null;

  return {
    id: typeof cue.id === 'string' ? cue.id : `cue_${index + 1}`,
    phase: typeof cue.phase === 'string' ? cue.phase : 'swing_general',
    frame_phase: typeof cue.frame_phase === 'string' ? cue.frame_phase : null,
    headline: typeof cue.headline === 'string' ? cue.headline.trim() : '',
    caption: caption || narration,
    narration,
    start_seconds: Math.max(0, Number(startSeconds.toFixed(2))),
    end_seconds: Math.max(
      Number(startSeconds.toFixed(2)),
      Number(endSeconds.toFixed(2))
    ),
    frame_timestamp: clampNumber(cue.frame_timestamp, null),
    frame_url: typeof cue.frame_url === 'string' ? cue.frame_url : null,
    poster_url: typeof cue.poster_url === 'string' ? cue.poster_url : null,
    marked: cue.marked === true,
  };
}

function normalizeBreakdownRecord(raw) {
  const parsed = parseMaybeJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;

  const scenes = Array.isArray(parsed.scenes)
    ? parsed.scenes.map(normalizeCue).filter(Boolean)
    : [];

  return {
    version: typeof parsed.version === 'string' ? parsed.version : BREAKDOWN_VERSION,
    status: typeof parsed.status === 'string' ? parsed.status : 'idle',
    title: typeof parsed.title === 'string' ? parsed.title.trim() : 'Swing Breakdown',
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    duration_seconds: clampNumber(parsed.duration_seconds, null),
    muted_default: parsed.muted_default !== false,
    voice: typeof parsed.voice === 'string' ? parsed.voice : null,
    video_url: typeof parsed.video_url === 'string' ? parsed.video_url : null,
    video_s3_key: typeof parsed.video_s3_key === 'string' ? parsed.video_s3_key : null,
    poster_url: typeof parsed.poster_url === 'string' ? parsed.poster_url : null,
    poster_s3_key: typeof parsed.poster_s3_key === 'string' ? parsed.poster_s3_key : null,
    captions_url: typeof parsed.captions_url === 'string' ? parsed.captions_url : null,
    captions_s3_key: typeof parsed.captions_s3_key === 'string' ? parsed.captions_s3_key : null,
    captions_default: parsed.captions_default !== false,
    embedded_captions: parsed.embedded_captions === true,
    requested_at: typeof parsed.requested_at === 'string' ? parsed.requested_at : null,
    completed_at: typeof parsed.completed_at === 'string' ? parsed.completed_at : null,
    updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : null,
    error_message: typeof parsed.error_message === 'string' ? parsed.error_message : null,
    scenes,
  };
}

function buildBreakdownPreview(raw) {
  const breakdown = normalizeBreakdownRecord(raw);
  if (!breakdown) return null;

  return {
    version: breakdown.version,
    status: breakdown.status,
    title: breakdown.title,
    summary: breakdown.summary,
    duration_seconds: breakdown.duration_seconds,
    muted_default: breakdown.muted_default,
    voice: breakdown.voice,
    video_url: breakdown.video_url,
    poster_url: breakdown.poster_url,
    captions_url: breakdown.captions_url,
    captions_default: breakdown.captions_default,
    embedded_captions: breakdown.embedded_captions,
    requested_at: breakdown.requested_at,
    completed_at: breakdown.completed_at,
    updated_at: breakdown.updated_at,
    error_message: breakdown.error_message,
    scenes: breakdown.scenes,
  };
}

function buildMarkedFrameMap(analysisResults) {
  const markingFrames = Array.isArray(analysisResults?.marking?.frames)
    ? analysisResults.marking.frames
    : [];

  if (markingFrames.length === 0) {
    return new Map();
  }

  return markingFrames.reduce((map, frame) => {
    const phase = typeof frame?.phase === 'string' ? frame.phase : null;
    const markedUrl = typeof frame?.url === 'string'
      ? frame.url
      : (typeof frame?.marked_frame_url === 'string' ? frame.marked_frame_url : null);
    if (phase && markedUrl) {
      map.set(phase, markedUrl);
    }
    return map;
  }, new Map());
}

function normalizeFrames(analysisResults) {
  const frames = Array.isArray(analysisResults?.frames) ? analysisResults.frames : [];
  const markedFrameMap = buildMarkedFrameMap(analysisResults);
  return frames
    .map((frame, index) => ({
      phase: typeof frame?.phase === 'string' ? frame.phase : `frame_${String(index).padStart(3, '0')}`,
      url: typeof frame?.url === 'string' ? frame.url : null,
      marked_url: typeof frame?.marked_url === 'string'
        ? frame.marked_url
        : (
          typeof frame?.markedUrl === 'string'
            ? frame.markedUrl
            : (markedFrameMap.get(frame?.phase) || null)
        ),
      timestamp: clampNumber(frame?.timestamp, index),
      frame_number: clampNumber(frame?.frame_number, index),
    }))
    .filter((frame) => frame.url)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function pickFrameByRatio(frames, ratio) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const index = Math.round((frames.length - 1) * clampedRatio);
  return frames[Math.max(0, Math.min(frames.length - 1, index))] || frames[0];
}

function pickFrameForPhase(frames, phase, anchorTime = null) {
  if (!Array.isArray(frames) || frames.length === 0) return null;

  const last = frames[frames.length - 1];
  const first = frames[0];
  const anchor = clampNumber(anchorTime, null);

  const chooseClosest = (target) => {
    if (target === null) return null;
    return frames.reduce((best, frame) => {
      if (!best) return frame;
      return Math.abs(frame.timestamp - target) < Math.abs(best.timestamp - target)
        ? frame
        : best;
    }, null);
  };

  switch (phase) {
    case 'setup':
    case 'address':
      return first;
    case 'takeaway':
      return anchor === null
        ? pickFrameByRatio(frames, 0.2)
        : chooseClosest(Math.max(first.timestamp, anchor - 0.55));
    case 'backswing':
    case 'top':
      return anchor === null
        ? pickFrameByRatio(frames, 0.5)
        : chooseClosest(Math.max(first.timestamp, anchor - 0.32));
    case 'transition':
    case 'delivery':
      return anchor === null
        ? pickFrameByRatio(frames, 0.67)
        : chooseClosest(Math.max(first.timestamp, anchor - 0.12));
    case 'downswing':
    case 'strike':
      return anchor === null
        ? pickFrameByRatio(frames, 0.78)
        : chooseClosest(Math.max(first.timestamp, anchor - 0.04));
    case 'impact':
      return anchor === null ? pickFrameByRatio(frames, 0.83) : chooseClosest(anchor);
    case 'follow_through':
    case 'finish':
      return anchor === null
        ? last
        : chooseClosest(Math.min(last.timestamp, anchor + 0.35));
    default:
      return pickFrameByRatio(frames, 0.5);
  }
}

function buildFrameLookup(analysisResults) {
  const frames = normalizeFrames(analysisResults);
  const anchorTime = clampNumber(analysisResults?.extraction?.anchor_time, null);
  return {
    frames,
    anchorTime,
    pickForPhase: (phase) => pickFrameForPhase(frames, phase, anchorTime),
  };
}

module.exports = {
  BREAKDOWN_VERSION,
  BREAKDOWN_TARGET_SECONDS,
  BREAKDOWN_MAX_SCENES,
  BREAKDOWN_MUTED_DEFAULT,
  buildBreakdownPreview,
  buildFrameLookup,
  clampNumber,
  normalizeBreakdownRecord,
  normalizeFrames,
  parseMaybeJson,
};
