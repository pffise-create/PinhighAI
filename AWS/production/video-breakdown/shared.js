'use strict';

const BREAKDOWN_VERSION = '2026-08-08.v1';
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
    requested_at: breakdown.requested_at,
    completed_at: breakdown.completed_at,
    updated_at: breakdown.updated_at,
    error_message: breakdown.error_message,
    scenes: breakdown.scenes,
  };
}

function normalizeFrames(analysisResults) {
  const frames = Array.isArray(analysisResults?.frames) ? analysisResults.frames : [];
  return frames
    .map((frame, index) => ({
      phase: typeof frame?.phase === 'string' ? frame.phase : `frame_${String(index).padStart(3, '0')}`,
      url: typeof frame?.url === 'string' ? frame.url : null,
      marked_url: typeof frame?.marked_url === 'string'
        ? frame.marked_url
        : (typeof frame?.markedUrl === 'string' ? frame.markedUrl : null),
      timestamp: clampNumber(frame?.timestamp, index),
      frame_number: clampNumber(frame?.frame_number, index),
    }))
    .filter((frame) => frame.url)
    .sort((a, b) => a.timestamp - b.timestamp);
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
      return first;
    case 'backswing':
      return anchor === null
        ? frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.3))]
        : chooseClosest(Math.max(first.timestamp, anchor - 0.45));
    case 'transition':
      return anchor === null
        ? frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.5))]
        : chooseClosest(Math.max(first.timestamp, anchor - 0.18));
    case 'downswing':
      return anchor === null
        ? frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.65))]
        : chooseClosest(Math.max(first.timestamp, anchor - 0.06));
    case 'impact':
      return anchor === null ? frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.75))] : chooseClosest(anchor);
    case 'follow_through':
      return anchor === null
        ? last
        : chooseClosest(Math.min(last.timestamp, anchor + 0.35));
    default:
      return frames[Math.min(frames.length - 1, Math.floor(frames.length / 2))];
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
