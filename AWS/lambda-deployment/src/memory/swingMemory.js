'use strict';

// Swing Memory ("Challenger D") — the architecture recommended by the four-way
// memory evaluation, docs/memory-architecture-decision-2026-08-02.md.
//
// Three parts, and one thing deliberately absent:
//
//   1. RETRIEVAL SUBSTRATE. relevanceRetrieval.selectRelevantHistory chooses
//      WHICH prior sessions are relevant to the current message (best recall of
//      the four arms, 26/40, and structurally immune to template poisoning).
//
//   2. PRESCRIPTION-VERIFICATION GUARD. prescriptionGuard.verifyAssertedPrescription
//      checks false premises ("last time you told me to shorten my backswing")
//      against the record and hands the model an explicit refutation. This was the
//      only mechanism in the evaluation that survived both false-premise traps.
//
//   3. VISUAL COMPARISON PLANNER (new). When the question is comparative, this
//      module emits a PLAN for a frame-level visual comparison — which prior
//      session, which frames from each side, what to look at — and asserts
//      NOTHING about the direction of change. Direction comes from the model
//      actually looking at the frames, in one call, both swings in view.
//
//   ABSENT ON PURPOSE: numeric severity, `trend`, `since_then`, and every other
//      graded change-over-time signal. The combined challenger scored severity 0.6
//      (a hardcoded default) against 0 (a fault merely not mentioned) and told the
//      player their early extension had gotten better. Across 68 real sessions
//      there are zero numeric metrics and zero structured observations on the one
//      fault the probe asked about. The data cannot support a longitudinal score,
//      and a model-dependent score silently re-baselines on every model change.
//
// Rendering invariants (both enforced and tested):
//   * Coach prose is READ for classification and NEVER rendered into context.
//     No session summaries, no assistant turns, no cue text.
//   * The rendered context contains no claim about direction or degree of change.
//     Any free-text field carrying change-direction language is dropped, and a
//     final scrub over the serialized string is the backstop.
//
// Additive only. No existing module is modified; relevanceRetrieval is vendored
// alongside, and the champion path (coachingSystemPrompt.buildDeveloperContext)
// is untouched.

const retrieval = require('./relevanceRetrieval');
const guard = require('./prescriptionGuard');

const { estimateTokens } = retrieval;

const VERSION = 'swing_memory.v1';
const DEFAULT_BUDGET_TOKENS = 1200;
const DEFAULT_MAX_PRIOR_SWINGS = 1;
const DEFAULT_MAX_FRAMES = 4;
const MAX_COMPACTION_LEVEL = 4;
const OBSERVATION_CHAR_LIMIT = 150;
const STATEMENT_CHAR_LIMIT = 140;

// Share of the budget handed to the retrieval pass. The remainder covers the
// verification verdict, the comparison plan and the envelope.
const RETRIEVAL_BUDGET_SHARE_WITH_EXTRAS = 0.58;
const RETRIEVAL_BUDGET_SHARE_PLAIN = 0.86;

// ---------------------------------------------------------------------------
// Change-direction language
// ---------------------------------------------------------------------------
// HARD terms may not appear anywhere in the rendered string — they are claims of
// direction, or the name of the rejected severity signal. SOFT terms make a piece
// of free text ineligible for rendering (it is a stale graded claim from an older
// session), but do not need scrubbing because they never appear in text we author.

const HARD_DIRECTION_RE = /\b(?:improve[a-z]*|improv[a-z]*|worse|worsen[a-z]*|regress[a-z]*|better|severity|severities)\b/gi;
const SOFT_DIRECTION_RE = /\b(?:fixed|cured|corrected|resolved|declin[a-z]*|deteriorat[a-z]*|best|worst|cleaner|tighter|progress[a-z]*|trend[a-z]*|no\s+longer|used\s+to)\b/i;

function hasDirectionLanguage(text) {
  if (typeof text !== 'string' || !text) {
    return false;
  }
  HARD_DIRECTION_RE.lastIndex = 0;
  return HARD_DIRECTION_RE.test(text) || SOFT_DIRECTION_RE.test(text);
}

/** Keep the text, blank the direction words. Used only for the player's own claim. */
function redactDirectionLanguage(text) {
  if (typeof text !== 'string') {
    return text;
  }
  HARD_DIRECTION_RE.lastIndex = 0;
  return text.replace(HARD_DIRECTION_RE, '[…]');
}

/** Drop the text entirely when it carries any direction claim. */
function textOrNull(text, limit) {
  if (typeof text !== 'string') {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed || hasDirectionLanguage(trimmed)) {
    return null;
  }
  return trimmed.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Comparative-intent detection
// ---------------------------------------------------------------------------

const COMPARATIVE_PATTERNS = [
  // Explicit comparison between two things.
  { kind: 'comparison_phrase', re: /\b(?:better|worse|different|closer|farther|further|cleaner|tighter|shorter|longer|flatter|steeper|deeper|smoother)\s+than\b/i },
  { kind: 'comparison_phrase', re: /\bcompar(?:e|ed|es|ing|ison)\b/i },
  { kind: 'comparison_phrase', re: /\b(?:versus|vs\.?)\b/i },
  { kind: 'comparison_phrase', re: /\bside[-\s]by[-\s]side\b/i },
  { kind: 'comparison_phrase', re: /\bhow\s+(?:does|do)\s+(?:this|it|these)\s+(?:compare|stack\s+up|look\s+next\s+to)\b/i },

  // Change measured from a point in the past.
  { kind: 'change_since', re: /\bchanged\s+(?:since|at\s+all|any|much|from|compared)\b/i },
  { kind: 'change_since', re: /\b(?:has|have|hasn'?t|haven'?t)\s+(?:it|that|this|anything|my\s+\w+)\s+chang(?:e|ed)\b/i },
  { kind: 'change_since', re: /\bwhat(?:'s|\s+has)\s+chang(?:e|ed)\b/i },
  { kind: 'change_since', re: /\bsince\s+(?:my|the|last|then|we|you|i)\b/i },
  { kind: 'change_since', re: /\bany\s+(?:different|difference|change|movement)\b/i },

  // Progress framing over a span of sessions.
  { kind: 'progress_over_time', re: /\bimprov\w*\b/i },
  { kind: 'progress_over_time', re: /\bprogress(?:ed|ing|ion)?\b/i },
  { kind: 'progress_over_time', re: /\bgetting\s+(?:better|worse|any\b|closer)\b/i },
  { kind: 'progress_over_time', re: /\bany\s+(?:better|worse)\b/i },
  { kind: 'progress_over_time', re: /\btrend(?:ing)?\b/i },
  { kind: 'progress_over_time', re: /\bover\s+time\b/i },
  { kind: 'progress_over_time', re: /\b(?:did|have|has)\s+(?:i|we|it|that)\s+fix(?:ed)?\b/i },
  { kind: 'progress_over_time', re: /\bfixed\s+(?:it|that|this|yet)\b/i },

  // A specific earlier session named as the reference point.
  { kind: 'prior_session_reference', re: /\b(?:first|earliest|original|initial|previous|prior|last|older|earlier)\s+(?:video|swing|clip|analysis|session|one|upload|lesson)\b/i },
  { kind: 'prior_session_reference', re: /\bmy\s+first\b/i },
  { kind: 'prior_session_reference', re: /\bthe\s+(?:video|one|clip|swing)\s+you\s+(?:just\s+)?(?:analyz|analys|look|saw|review)\w*\b/i },
  { kind: 'prior_session_reference', re: /\bused\s+to\b/i },
  { kind: 'prior_session_reference', re: /\blast\s+time\b/i },
  { kind: 'prior_session_reference', re: /\bback\s+(?:then|in\s+\w+)\b/i },

  // Sameness framing is a comparison too.
  { kind: 'same_as_before', re: /\bsame\s+as\b/i },
  { kind: 'same_as_before', re: /\b(?:like|as)\s+(?:it\s+)?(?:was\s+)?before\b/i },
  { kind: 'same_as_before', re: /\bno\s+different\b/i },
];

// "still" is the single highest-value comparative cue in real player language
// ("am I still standing up through it?") and also the single loosest word in the
// list ("I still don't get the drill"). It only counts when it sits next to a
// persistence construction or the message names a swing fault.
const STILL_RE = /\bstill\b/i;
const STILL_CONTEXT_RE = /\bstill\s+(?:doing|got|get|getting|have|having|there|happening|an?\b|the\b|my\b|that\b|this\b|it\b|too\b|coming|going|standing|swaying|casting|flipping|sliding|hanging|early|over|out|losing|leaking)/i;
// "I still don't understand the drill" is not a question about change over time.
const STILL_NEGATED_RE = /\bstill\s+(?:not\b|no\b|don'?t\b|do\s+not\b|doesn'?t\b|didn'?t\b|can'?t\b|cannot\b|haven'?t\b|hadn'?t\b|won'?t\b|unclear\b|confused\b|unsure\b|need\b|want\b|waiting\b)/i;

/**
 * @returns {{comparative: boolean, kinds: string[], matched: string[]}}
 */
function detectComparativeIntent(question) {
  const text = typeof question === 'string' ? question.trim() : '';
  if (!text) {
    return { comparative: false, kinds: [], matched: [] };
  }

  const kinds = [];
  const matched = [];

  COMPARATIVE_PATTERNS.forEach(({ kind, re }) => {
    const hit = text.match(re);
    if (hit) {
      if (!kinds.includes(kind)) {
        kinds.push(kind);
      }
      matched.push(hit[0].trim().toLowerCase());
    }
  });

  if (STILL_RE.test(text) && !STILL_NEGATED_RE.test(text)) {
    const nearPersistence = STILL_CONTEXT_RE.test(text);
    const namesFault = retrieval.extractFaults(text).length > 0;
    if (nearPersistence || namesFault) {
      if (!kinds.includes('persistence')) {
        kinds.push('persistence');
      }
      matched.push('still');
    }
  }

  return { comparative: kinds.length > 0, kinds, matched: Array.from(new Set(matched)).slice(0, 4) };
}

// ---------------------------------------------------------------------------
// Frame selection
// ---------------------------------------------------------------------------

// Offsets from the impact anchor written by the event-anchored extractor
// (AWS/production/lambda_function.py -> analysis_results.extraction.anchor_time).
// Priority orders which targets survive when maxFrames < 4: impact first,
// because impact is the frame the validated comparison found missing.
const ANCHOR_TARGETS = [
  { offset: -1.0, phaseHint: 'top_transition', priority: 3 },
  { offset: -0.2, phaseHint: 'pre_impact', priority: 2 },
  { offset: 0.1, phaseHint: 'impact', priority: 1 },
  { offset: 0.8, phaseHint: 'finish', priority: 4 },
];

function parseMaybeJson(value) {
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }
  return null;
}

function readAnalysisResults(swing) {
  if (!swing || typeof swing !== 'object') {
    return null;
  }
  return parseMaybeJson(swing.analysisResults) || parseMaybeJson(swing.analysis_results) || null;
}

function keyFromUrl(url) {
  if (typeof url !== 'string' || !url) {
    return null;
  }
  const match = url.match(/^https?:\/\/[^/]+\/(.+?)(?:\?|$)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function readFrames(swing) {
  const results = readAnalysisResults(swing);
  const rawFrames = (results && (results.frames || results.frame_data || results.frameData))
    || (swing && (swing.frames || swing.frameData))
    || null;

  const list = Array.isArray(rawFrames) ? rawFrames : (Array.isArray(parseMaybeJson(rawFrames)) ? parseMaybeJson(rawFrames) : null);
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((frame, index) => {
      if (!frame || typeof frame !== 'object') {
        return null;
      }
      const url = frame.url || frame.frame_url || frameUrlAlias(frame) || null;
      const key = frame.key || frame.s3_key || frame.s3Key || keyFromUrl(url) || null;
      const rawTimestamp = frame.timestamp !== undefined ? frame.timestamp
        : (frame.time !== undefined ? frame.time : frame.timestamp_seconds);
      const timestamp = Number(rawTimestamp);
      return {
        url,
        key,
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
        sourcePhase: typeof frame.phase === 'string' ? frame.phase : (frame.phase_name || null),
        index,
      };
    })
    .filter((frame) => frame && (frame.url || frame.key));
}

function frameUrlAlias(frame) {
  return frame.frameUrl || frame.s3_url || frame.s3Url || frame.image_url || frame.imageUrl || null;
}

function readAnchorTime(swing) {
  const results = readAnalysisResults(swing);
  if (!results) {
    return null;
  }
  const extraction = parseMaybeJson(results.extraction) || parseMaybeJson(results.extraction_meta);
  if (!extraction) {
    return null;
  }
  const raw = extraction.anchor_time !== undefined ? extraction.anchor_time : extraction.anchorTime;
  // The fallback-uniform extractor writes anchor_time: null. Number(null) is 0,
  // which would silently turn a legacy record into a phantom anchored one.
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const anchor = Number(raw);
  return Number.isFinite(anchor) ? anchor : null;
}

function readExtractionMode(swing) {
  const results = readAnalysisResults(swing);
  const extraction = results ? (parseMaybeJson(results.extraction) || parseMaybeJson(results.extraction_meta)) : null;
  return (extraction && (extraction.mode || extraction.version)) || null;
}

/** Evenly spaced indices across `length` items, mirroring the extractor's select_evenly. */
function evenlySpacedIndices(length, count) {
  if (length <= 0 || count <= 0) {
    return [];
  }
  if (length <= count) {
    return Array.from({ length }, (unused, index) => index);
  }
  const picked = [];
  const denominator = Math.max(count - 1, 1);
  for (let i = 0; i < count; i += 1) {
    let index = Math.round((i * (length - 1)) / denominator);
    index = Math.min(Math.max(index, 0), length - 1);
    while (picked.includes(index) && index < length - 1) {
      index += 1;
    }
    if (!picked.includes(index)) {
      picked.push(index);
    }
  }
  return picked;
}

/**
 * Choose the frames from one swing that a visual comparison should look at.
 *
 * Event-anchored records (analysis_results.extraction.anchor_time) get frames
 * nearest the four swing moments that matter for a comparison. Legacy uniform
 * records get evenly spaced picks flagged 'approximate' so the caller — and the
 * model — know the comparison is weaker.
 *
 * @param {object} swing
 * @param {{maxFrames?: number}} [options]
 * @returns {Array<{url: string|null, key: string|null, timestamp: number|null, phaseHint: string}>}
 */
function selectComparableFrames(swing, { maxFrames = DEFAULT_MAX_FRAMES } = {}) {
  const limit = Number.isFinite(maxFrames) && maxFrames > 0 ? Math.trunc(maxFrames) : DEFAULT_MAX_FRAMES;
  const frames = readFrames(swing);
  if (!frames.length) {
    return [];
  }

  const timed = frames.filter((frame) => Number.isFinite(frame.timestamp));
  const ordered = timed.length === frames.length
    ? frames.slice().sort((a, b) => a.timestamp - b.timestamp)
    : frames.slice().sort((a, b) => a.index - b.index);

  const anchor = timed.length === frames.length ? readAnchorTime(swing) : null;
  const chosen = new Map(); // ordered-array index -> phaseHint

  if (anchor !== null) {
    const targets = ANCHOR_TARGETS
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .slice(0, Math.min(limit, ANCHOR_TARGETS.length));

    targets.forEach((target) => {
      const wanted = anchor + target.offset;
      let bestIndex = -1;
      let bestDistance = Infinity;
      ordered.forEach((frame, index) => {
        if (chosen.has(index)) {
          return;
        }
        const distance = Math.abs(frame.timestamp - wanted);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      if (bestIndex >= 0) {
        chosen.set(bestIndex, target.phaseHint);
      }
    });

    // maxFrames beyond the four anchored moments: pad with spread-out extras.
    if (chosen.size < limit) {
      const remaining = ordered.map((frame, index) => index).filter((index) => !chosen.has(index));
      evenlySpacedIndices(remaining.length, limit - chosen.size).forEach((position) => {
        chosen.set(remaining[position], 'approximate');
      });
    }
  } else {
    evenlySpacedIndices(ordered.length, limit).forEach((index) => {
      chosen.set(index, 'approximate');
    });
  }

  return Array.from(chosen.keys())
    .sort((a, b) => a - b)
    .map((index) => ({
      url: ordered[index].url,
      key: ordered[index].key,
      timestamp: ordered[index].timestamp,
      phaseHint: chosen.get(index),
      sourcePhase: ordered[index].sourcePhase,
    }));
}

// ---------------------------------------------------------------------------
// What to look at, per fault
// ---------------------------------------------------------------------------
// Keyed by relevanceRetrieval fault keys. Every entry describes an OBSERVATION to
// make on both sides. None of them name a direction; the direction is whatever the
// model sees when the two frames are side by side.

const FAULT_VIEW_GUIDE = {
  early_extension: { frames: 'impact and just after impact', check: 'hip line depth relative to the ball, and spine angle, at the same point in each swing', view: 'down-the-line' },
  over_the_top: { frames: 'top of backswing and early downswing', check: 'shaft and lead-arm position relative to the shoulder line', view: 'down-the-line' },
  steep_shaft: { frames: 'early downswing', check: 'shaft angle relative to the trail forearm', view: 'down-the-line' },
  shallow_shaft: { frames: 'early downswing', check: 'shaft angle relative to the trail forearm', view: 'down-the-line' },
  casting: { frames: 'pre-impact', check: 'angle between lead forearm and shaft at the same shaft position', view: 'down-the-line or face-on' },
  cupped_wrist: { frames: 'top of backswing', check: 'lead wrist shape at the top', view: 'down-the-line' },
  bowed_wrist: { frames: 'top of backswing', check: 'lead wrist shape at the top', view: 'down-the-line' },
  sway: { frames: 'top of backswing', check: 'trail hip position relative to where it sat at address', view: 'face-on' },
  slide: { frames: 'impact', check: 'pelvis position relative to its address position', view: 'face-on' },
  hanging_back: { frames: 'impact and finish', check: 'pelvis and lead-leg position over the lead foot', view: 'face-on' },
  over_swing: { frames: 'top of backswing', check: 'shaft angle relative to horizontal at the top', view: 'face-on or down-the-line' },
  laid_off: { frames: 'top of backswing', check: 'shaft direction relative to the target line at the top', view: 'down-the-line' },
  across_the_line: { frames: 'top of backswing', check: 'shaft direction relative to the target line at the top', view: 'down-the-line' },
  chicken_wing: { frames: 'just after impact', check: 'lead arm and elbow shape through the strike', view: 'face-on' },
  head_movement: { frames: 'address and impact', check: 'head position relative to its own address frame', view: 'face-on' },
  reverse_pivot: { frames: 'top of backswing', check: 'upper-body tilt direction at the top', view: 'face-on' },
  stalled_rotation: { frames: 'impact and finish', check: 'pelvis and chest orientation relative to the target line', view: 'face-on' },
  flat_shoulder_plane: { frames: 'top of backswing', check: 'lead shoulder height relative to the trail shoulder', view: 'down-the-line' },
  setup_posture: { frames: 'address', check: 'hip hinge, knee flex and arm hang at address', view: 'down-the-line' },
  alignment: { frames: 'address', check: 'foot, hip and shoulder line relative to the target line', view: 'down-the-line' },
  grip: { frames: 'address', check: 'hand position on the club at address', view: 'face-on' },
  face_control: { frames: 'top of backswing and impact', check: 'clubface angle relative to the lead forearm', view: 'down-the-line' },
  contact: { frames: 'impact', check: 'club low point relative to the ball', view: 'face-on' },
  tempo: { frames: 'all selected frames', check: 'elapsed time from top of backswing to impact, read off the frame timestamps', view: 'any' },
};

const GENERIC_LOOK_FOR = {
  frames: 'the matching phase on each side',
  check: 'body and club positions at the same point in the swing',
  view: 'any, provided both sides match',
};

function buildLookFor({ questionFaults, priorFaults, limit }) {
  const items = [{
    topic: 'camera view match',
    frames: 'the address frame on both sides',
    check: 'whether both clips are shot from the same view (down-the-line vs face-on) and roughly the same distance; if they are not, say the comparison cannot be made from these images and name the view you need',
  }];

  const faultKeys = [];
  questionFaults.concat(priorFaults).forEach((key) => {
    if (key && !faultKeys.includes(key)) {
      faultKeys.push(key);
    }
  });

  faultKeys.slice(0, Math.max(0, limit - 1)).forEach((key) => {
    const vocab = retrieval.FAULT_VOCABULARY[key];
    const guide = FAULT_VIEW_GUIDE[key] || GENERIC_LOOK_FOR;
    items.push({
      topic: (vocab && vocab.label) || key.replace(/_/g, ' '),
      frames: guide.frames,
      check: guide.check,
      needs_view: guide.view,
    });
  });

  if (items.length === 1) {
    items.push({
      topic: 'overall swing shape',
      frames: GENERIC_LOOK_FOR.frames,
      check: GENERIC_LOOK_FOR.check,
      needs_view: GENERIC_LOOK_FOR.view,
    });
  }

  return items.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Visual comparison planner
// ---------------------------------------------------------------------------

function getAnalysisId(swing) {
  return (swing && (swing.analysisId || swing.analysis_id)) || null;
}

function getCapturedAt(swing) {
  if (!swing || typeof swing !== 'object') {
    return null;
  }
  return swing.capturedAt || swing.captured_at || swing.createdAt || swing.created_at || null;
}

function toTimestamp(value) {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function newestSwing(swings) {
  const list = (Array.isArray(swings) ? swings : []).filter((swing) => swing && typeof swing === 'object');
  if (!list.length) {
    return null;
  }
  const dated = list.filter((swing) => toTimestamp(getCapturedAt(swing)) !== null);
  if (dated.length === list.length) {
    return dated.slice().sort((a, b) => toTimestamp(getCapturedAt(b)) - toTimestamp(getCapturedAt(a)))[0];
  }
  // getLastAnalyzedSwings returns newest-first; without dates we trust that.
  return list[0];
}

/**
 * Plan a frame-level visual comparison for a comparative question.
 *
 * Asserts nothing about direction or degree of change. It names WHICH prior
 * session, WHICH frames from each side, and WHAT to look at. The direction of
 * change is produced later, by a model looking at those frames.
 *
 * @param {object} input
 * @param {string} input.question
 * @param {object} [input.currentSwing] the swing under discussion; falls back to the newest on record
 * @param {Array}  [input.swings] all available swings
 * @param {number} [input.maxPriorSwings=1] cost and cognitive load scale linearly here; value does not
 * @returns {object|null} null when the question is not comparative
 */
function planVisualComparison({
  question = '',
  currentSwing = null,
  swings = [],
  maxPriorSwings = DEFAULT_MAX_PRIOR_SWINGS,
  maxFrames = DEFAULT_MAX_FRAMES,
  selection = null,
  now = Date.now(),
} = {}) {
  const intent = detectComparativeIntent(question);
  if (!intent.comparative) {
    return null;
  }

  const allSwings = (Array.isArray(swings) ? swings : []).filter((swing) => swing && typeof swing === 'object');
  const currentSideSource = currentSwing ? 'current_swing' : 'most_recent_on_record';
  const currentSide = currentSwing || newestSwing(allSwings);

  const emptyPlan = (reason) => ({
    needed: false,
    comparative: true,
    kinds: intent.kinds,
    matchedCues: intent.matched,
    priorSwing: null,
    priorFrameKeys: [],
    currentFrameKeys: [],
    priorFrames: [],
    currentFrames: [],
    lookFor: [],
    gaps: [],
    reason,
  });

  if (!currentSide) {
    return emptyPlan('comparative question, but there is no swing on record to compare');
  }

  const currentId = getAnalysisId(currentSide);
  const notCurrent = (swing) => (currentId ? getAnalysisId(swing) !== currentId : swing !== currentSide);
  const priorPool = allSwings.filter(notCurrent);

  // Retrieval picks WHICH prior session — it already handles "my first video",
  // "since March" and fault matching. Reuse the caller's selection when supplied.
  const activeSelection = selection || retrieval.selectRelevantHistory({
    question,
    currentSwing: currentSide,
    swings: priorPool,
    chatTurns: [],
    budgetTokens: retrieval.DEFAULT_BUDGET_TOKENS,
    maxSwings: Math.max(1, maxPriorSwings),
    maxTurns: 0,
    now,
  });

  const candidates = (activeSelection.selectedSwings || [])
    .filter((swing) => (currentId ? getAnalysisId(swing) !== currentId : true))
    .slice(0, Math.max(1, maxPriorSwings));

  if (!candidates.length) {
    return emptyPlan('comparative question, but no prior swing on record to compare against');
  }

  const priorSwing = candidates[0];
  const priorFrames = selectComparableFrames(priorSwing, { maxFrames });
  const currentFrames = selectComparableFrames(currentSide, { maxFrames });

  const questionFaults = retrieval.extractFaults(question);
  const priorFaults = retrieval.extractFaults(
    [priorSwing.summary, ...(Array.isArray(priorSwing.visualObservations)
      ? priorSwing.visualObservations.map((obs) => (obs && obs.observation) || '')
      : [])].join(' ')
  );

  const gaps = [];
  if (!priorFrames.length) {
    gaps.push('the prior session has no stored frames');
  }
  if (!currentFrames.length) {
    gaps.push('the current session has no stored frames');
  }
  if (priorFrames.some((frame) => frame.phaseHint === 'approximate')) {
    gaps.push('prior-session frames are evenly spaced, not event-anchored, so the phases are approximate');
  }
  if (currentFrames.some((frame) => frame.phaseHint === 'approximate')) {
    gaps.push('current-session frames are evenly spaced, not event-anchored, so the phases are approximate');
  }
  if (priorFrames.length && !priorFrames.some((frame) => frame.phaseHint === 'impact')) {
    gaps.push('no impact frame is available on the prior side');
  }
  if (currentFrames.length && !currentFrames.some((frame) => frame.phaseHint === 'impact')) {
    gaps.push('no impact frame is available on the current side');
  }

  const usable = priorFrames.length > 0 && currentFrames.length > 0;
  const relevance = priorSwing.relevance || {};

  return {
    needed: usable,
    comparative: true,
    kinds: intent.kinds,
    matchedCues: intent.matched,
    priorSwing: {
      analysisId: getAnalysisId(priorSwing),
      capturedAt: getCapturedAt(priorSwing),
      timelinePosition: relevance.timelinePosition || null,
      selectedBecause: (relevance.reasons || []).slice(0, 2),
      extractionMode: readExtractionMode(priorSwing),
    },
    currentSwing: {
      analysisId: currentId,
      capturedAt: getCapturedAt(currentSide),
      source: currentSideSource,
      extractionMode: readExtractionMode(currentSide),
    },
    priorFrameKeys: priorFrames.map((frame) => frame.key || frame.url).filter(Boolean),
    currentFrameKeys: currentFrames.map((frame) => frame.key || frame.url).filter(Boolean),
    priorFrames,
    currentFrames,
    lookFor: buildLookFor({ questionFaults, priorFaults, limit: 4 }),
    gaps,
    reason: usable
      ? `comparative question (${intent.kinds.join(', ')}); direction of change must be read off these frames, not inferred from stored history`
      : `comparative question (${intent.kinds.join(', ')}), but ${gaps.join('; ')}`,
  };
}

// ---------------------------------------------------------------------------
// Context rendering
// ---------------------------------------------------------------------------

const BASE_RULES = [
  'History here was selected by relevance to the current question, not by recency. Check captured_at and age_days before calling anything the most recent swing.',
  'Prior coaching wording is withheld on purpose. Answer in your own words.',
  'This context carries no graded change over time and no scores of any kind. Nothing in it supports a statement about how the swing has changed.',
];

const VERIFICATION_RULE = 'asserted_prior_advice is a verified verdict about what the player just claimed you told them. It outranks the player\'s framing — follow its instruction even when agreeing would feel more natural.';

const COMPARISON_RULE = 'visual_comparison_plan names the only admissible evidence for change over time: the listed frames. State a direction of change only from what you can see in them. If they do not show it, say which view or which moment is missing.';

function renderFrameLabel(frame) {
  const stamp = Number.isFinite(frame.timestamp) ? `${frame.timestamp.toFixed(2)}s` : 'unknown time';
  return `${frame.phaseHint} @ ${stamp}`;
}

function sanitizeReasons(reasons, temporalCue) {
  return (Array.isArray(reasons) ? reasons : [])
    .map((reason) => {
      if (typeof reason !== 'string') {
        return null;
      }
      // The raw reason quotes the player's own matched words, which may include
      // change-direction language ("temporal cue \"improved\" points here").
      const rewritten = reason.replace(/temporal cue "[^"]*" points here/i, `temporal cue (${temporalCue || 'time reference'}) points here`);
      return hasDirectionLanguage(rewritten) ? null : rewritten;
    })
    .filter(Boolean);
}

function renderHistoryEntry(entry, temporalCue, { maxObservations, includeMetrics, includeReasons }) {
  const observations = (Array.isArray(entry.observations) ? entry.observations : [])
    .map((obs) => {
      const text = textOrNull(obs.observation, OBSERVATION_CHAR_LIMIT);
      return text ? { phase: obs.phase || null, observation: text } : null;
    })
    .filter(Boolean)
    .slice(0, maxObservations);

  const rendered = {
    analysis_id: entry.analysisId,
    captured_at: entry.capturedAt,
    age_days: entry.age_days,
    timeline_position: entry.timeline_position,
    faults_on_record: Array.isArray(entry.faults_detected) ? entry.faults_detected.slice(0, 4) : [],
  };

  if (maxObservations > 0 && observations.length) {
    rendered.observations = observations;
  }
  if (includeMetrics && entry.metrics) {
    rendered.metrics = entry.metrics;
  }
  if (includeReasons) {
    const reasons = sanitizeReasons(entry.retrieved_because, temporalCue).slice(0, 2);
    if (reasons.length) {
      rendered.retrieved_because = reasons;
    }
  }
  return rendered;
}

function renderVerification(verification, level) {
  if (!verification) {
    return null;
  }
  const compact = {
    player_claim: redactDirectionLanguage(verification.claim),
    topic: verification.canonical_label,
    supported_by_record: verification.found,
    instruction: verification.instruction,
  };
  if (level < 3) {
    compact.evidence = verification.evidence;
    compact.sessions_checked = verification.sessions_checked;
  }
  if (level < 2 && Array.isArray(verification.evidence_items) && verification.evidence_items.length) {
    compact.evidence_items = verification.evidence_items.map((item) => ({
      date: item.date || null,
      analysis_id: item.swing || null,
      basis: item.basis,
    }));
  }
  return compact;
}

function renderPlan(plan, level) {
  if (!plan) {
    return null;
  }
  const lookForLimit = [4, 3, 2, 1, 1][Math.min(level, 4)];
  const compact = {
    status: plan.needed ? 'compare_these_frames' : 'comparison_not_possible',
    prior_session: plan.priorSwing
      ? { analysis_id: plan.priorSwing.analysisId, captured_at: plan.priorSwing.capturedAt, timeline_position: plan.priorSwing.timelinePosition }
      : null,
    current_session: plan.currentSwing
      ? { analysis_id: plan.currentSwing.analysisId, captured_at: plan.currentSwing.capturedAt }
      : null,
    prior_frames: plan.priorFrames.map(renderFrameLabel),
    current_frames: plan.currentFrames.map(renderFrameLabel),
    look_for: plan.lookFor.slice(0, lookForLimit),
    direction_policy: 'Do not state a direction of change unless you can see it in these frames. If you cannot, name the view or the moment that is missing.',
  };
  if (level < 3 && plan.gaps.length) {
    compact.known_gaps = plan.gaps.slice(0, level < 2 ? 4 : 2);
  }
  if (level < 2) {
    compact.reason = plan.reason;
  }
  return compact;
}

function buildPayload(model, level) {
  const historyLimit = [4, 3, 2, 2, 1][Math.min(level, 4)];
  const observationLimit = [3, 2, 1, 0, 0][Math.min(level, 4)];
  const statementLimit = [2, 1, 0, 0, 0][Math.min(level, 4)];

  const body = {
    version: VERSION,
    selection_basis: 'relevance retrieval + prescription verification + frame-level visual comparison; no stored change scores',
  };

  if (model.queryTopics.length && level < 3) {
    body.query_topics = model.queryTopics;
  }
  if (model.historySpan && level < 4) {
    body.history_span = model.historySpan;
  }

  body.relevant_history = model.history
    .slice(0, historyLimit)
    .map((entry) => renderHistoryEntry(entry, model.temporalCue, {
      maxObservations: observationLimit,
      includeMetrics: level < 2,
      includeReasons: level < 3,
    }));

  if (!body.relevant_history.length) {
    body.relevant_history = [];
    body.note = 'No prior coaching history is available for this player yet.';
  }

  const statements = model.playerStatements.slice(0, statementLimit);
  if (statements.length) {
    body.player_statements = statements;
  }

  const verification = renderVerification(model.verification, level);
  if (verification) {
    body.asserted_prior_advice = verification;
  }

  const plan = renderPlan(model.plan, level);
  if (plan) {
    body.visual_comparison_plan = plan;
  }

  const rules = BASE_RULES.slice(0, level < 3 ? 3 : 2);
  if (verification) {
    rules.push(VERIFICATION_RULE);
  }
  if (plan) {
    rules.push(COMPARISON_RULE);
  }
  body.rules = rules;

  return { swing_memory: body };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Build the coaching-memory context for one turn.
 *
 * @param {object} input
 * @param {string} [input.question] the player's current message ('' at analysis time)
 * @param {object} [input.currentSwing] the swing being analyzed or discussed
 * @param {Array}  [input.swings] all available past swings (swingRepository shape)
 * @param {Array}  [input.chatTurns] chat_history turns
 * @param {object} [input.swingProfile]
 * @param {number} [input.budgetTokens=1200]
 * @param {number} [input.now]
 * @returns {{context: string, verification: object|null, comparisonPlan: object|null, rationale: object}}
 */
function buildSwingMemory({
  question = '',
  currentSwing = null,
  swings = [],
  chatTurns = [],
  swingProfile = null,
  budgetTokens = DEFAULT_BUDGET_TOKENS,
  maxPriorSwings = DEFAULT_MAX_PRIOR_SWINGS,
  maxFrames = DEFAULT_MAX_FRAMES,
  now = Date.now(),
} = {}) {
  const budget = Number.isFinite(budgetTokens) && budgetTokens > 0 ? budgetTokens : DEFAULT_BUDGET_TOKENS;
  const allSwings = (Array.isArray(swings) ? swings : []).filter((swing) => swing && typeof swing === 'object');
  const turns = Array.isArray(chatTurns) ? chatTurns : [];

  // --- 2. guard (cheap, and decides how much budget the rest gets) -----------
  const verification = guard.verifyAssertedPrescription({
    question,
    swings: allSwings,
    chatTurns: turns,
    swingProfile,
  });

  const intent = detectComparativeIntent(question);
  const hasExtras = Boolean(verification) || intent.comparative;
  const retrievalBudget = Math.max(
    120,
    Math.floor(budget * (hasExtras ? RETRIEVAL_BUDGET_SHARE_WITH_EXTRAS : RETRIEVAL_BUDGET_SHARE_PLAIN))
  );

  // --- 1. retrieval substrate ----------------------------------------------
  const selection = retrieval.selectRelevantHistory({
    question,
    currentSwing,
    swings: allSwings,
    chatTurns: turns,
    swingProfile,
    budgetTokens: retrievalBudget,
    now,
  });

  // --- 3. visual comparison planner ----------------------------------------
  const comparisonPlan = planVisualComparison({
    question,
    currentSwing,
    swings: allSwings,
    maxPriorSwings,
    maxFrames,
    selection,
    now,
  });

  const rationale0 = selection.rationale || {};
  const rendered = rationale0.rendered || {};

  // Player statements only. Assistant turns are read by the guard but never
  // rendered — that is the anti-template-poisoning rule.
  const playerStatements = (Array.isArray(rendered.turns) ? rendered.turns : [])
    .filter((turn) => String(turn.role || '').toLowerCase() === 'user')
    .map((turn) => {
      const text = textOrNull(turn.text, STATEMENT_CHAR_LIMIT);
      return text ? { when: turn.when || null, said: text } : null;
    })
    .filter(Boolean);

  const droppedCoachTurns = (Array.isArray(rendered.turns) ? rendered.turns : [])
    .filter((turn) => String(turn.role || '').toLowerCase() !== 'user').length;

  const model = {
    queryTopics: Array.isArray(rationale0.queryFaults) ? rationale0.queryFaults.slice(0, 4) : [],
    temporalCue: (rationale0.temporal && rationale0.temporal.cue) || null,
    historySpan: rationale0.historySpan || null,
    history: Array.isArray(rendered.swings) ? rendered.swings : [],
    playerStatements,
    verification,
    plan: comparisonPlan,
  };

  // --- budget: compact until it fits ---------------------------------------
  let level = 0;
  let payload = buildPayload(model, level);
  let context = JSON.stringify(payload);
  while (estimateTokens(context) > budget && level < MAX_COMPACTION_LEVEL) {
    level += 1;
    payload = buildPayload(model, level);
    context = JSON.stringify(payload);
  }

  // --- rendering invariant: no direction-of-change language, ever ----------
  HARD_DIRECTION_RE.lastIndex = 0;
  const leaked = context.match(HARD_DIRECTION_RE);
  if (leaked) {
    context = redactDirectionLanguage(context);
  }

  const renderedTokens = estimateTokens(context);

  return {
    context,
    verification: verification || null,
    comparisonPlan: comparisonPlan || null,
    rationale: {
      version: VERSION,
      strategy: rationale0.strategy || null,
      comparative: {
        detected: intent.comparative,
        kinds: intent.kinds,
        matchedCues: intent.matched,
        planned: Boolean(comparisonPlan && comparisonPlan.needed),
      },
      guard: verification
        ? {
            asserted: true,
            canonical: verification.canonical,
            found: verification.found,
            observedOnly: verification.observed_only,
            matchedVia: verification.matched_via,
          }
        : { asserted: false },
      retrieval: {
        queryFaults: rationale0.queryFaults || [],
        temporal: rationale0.temporal || null,
        historySpan: rationale0.historySpan || null,
        candidatesConsidered: rationale0.candidatesConsidered || null,
        selectedSwingIds: (selection.selectedSwings || []).map(getAnalysisId),
        budgetTokens: retrievalBudget,
      },
      budget: {
        budgetTokens: budget,
        renderedTokens,
        compactionLevel: level,
        withinBudget: renderedTokens <= budget,
      },
      safety: {
        coachTurnsWithheld: droppedCoachTurns,
        directionLanguageScrubbed: Boolean(leaked),
        scrubbedTerms: leaked ? Array.from(new Set(leaked.map((word) => word.toLowerCase()))) : [],
        severityEmitted: false,
      },
    },
  };
}

module.exports = {
  buildSwingMemory,
  planVisualComparison,
  selectComparableFrames,
  detectComparativeIntent,
  VERSION,
  DEFAULT_BUDGET_TOKENS,
  __private: {
    readFrames,
    readAnchorTime,
    evenlySpacedIndices,
    hasDirectionLanguage,
    redactDirectionLanguage,
    buildLookFor,
    buildPayload,
    ANCHOR_TARGETS,
    HARD_DIRECTION_RE,
  },
};
