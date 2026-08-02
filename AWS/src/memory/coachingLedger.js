// Longitudinal Coaching Ledger
// ----------------------------------------------------------------------------
// An additive, drop-in memory layer for the coaching model. It derives a
// compact, append-only-shaped ledger of the coaching relationship from data we
// ALREADY persist (swing analyses, swing profile, chat turns). No new tables,
// no migrations, no npm dependencies.
//
// Design constraint (the Feb 2026 "template poisoning" incident):
//   The model must never be handed its own prior prose to parrot. So this module
//   reads prior coaching text only to CLASSIFY it into canonical tags, and emits
//   structured facts (tags, severities, dates, counts, deltas) — never the
//   sentences. Cue text is opt-in and off by default.
//
// Everything here is pure and synchronous. Callers fetch data with the existing
// repositories and pass the shapes straight through.

const LEDGER_VERSION = 'ledger.v1';

const DEFAULT_MAX_SESSIONS = 12;
const DEFAULT_MAX_ENTRIES = 6;
const DEFAULT_MAX_TOKENS = 1200;
const CHARS_PER_TOKEN = 4;

// Severity delta required before we call something improved / regressed.
const SEVERITY_EPSILON = 0.15;
// Relative delta required before a metric counts as moved at all.
const METRIC_EPSILON_RATIO = 0.02;

// Pipeline metrics that say nothing about the golf swing.
const IGNORED_METRICS = new Set([
  'frames_extracted',
  'frames_analyzed',
  'frames_skipped',
  'frame_count',
  'video_duration',
  'duration',
  'duration_ms',
  'fps',
  'file_size',
  'file_size_bytes',
  'tokens_used',
  'batches_processed',
]);

// ---------------------------------------------------------------------------
// Canonical fault taxonomy. Tags are neutral technical labels, not coach voice.
// ---------------------------------------------------------------------------

const FAULT_TAGS = [
  { tag: 'early_extension', phase: 'downswing', keywords: ['early extension', 'loss of posture', 'standing up', 'stand up', 'spine angle', 'hips toward the ball', 'thrust toward', 'hips back', 'stay in posture', 'hold posture', 'maintain posture', 'keep posture'] },
  { tag: 'over_the_top', phase: 'transition', keywords: ['over the top', 'over-the-top', 'out-to-in', 'out to in', 'outside-in', 'outside in', 'steep transition', 'steep shaft'] },
  { tag: 'casting', phase: 'downswing', keywords: ['casting', 'cast the club', 'early release', 'scoop', 'flip', 'loss of lag'] },
  { tag: 'lag_wrist_angle', phase: 'downswing', keywords: ['lag', 'wrist angle', 'cupped', 'bowed', 'flat lead wrist', 'wrist hinge', 'wrist set'] },
  { tag: 'lateral_sway', phase: 'backswing', keywords: ['sway', 'lateral slide', 'hip slide', 'slide off the ball', 'lateral shift'] },
  { tag: 'weight_shift', phase: 'downswing', keywords: ['weight shift', 'pressure shift', 'weight transfer', 'hanging back', 'hang back', 'back foot at impact', 'weight forward'] },
  { tag: 'head_movement', phase: 'swing_general', keywords: ['head movement', 'head dip', 'head lift', 'head moving', 'looking up', 'head position'] },
  { tag: 'face_control', phase: 'impact', keywords: ['open face', 'face open', 'clubface', 'club face', 'face control', 'closed face', 'shut face', 'face angle'] },
  { tag: 'path_in_to_out', phase: 'downswing', keywords: ['in-to-out', 'in to out', 'inside-out', 'inside out', 'stuck behind', 'trapped behind', 'club gets stuck'] },
  { tag: 'takeaway', phase: 'backswing', keywords: ['takeaway', 'first move back', 'one-piece', 'club inside early', 'club outside early'] },
  { tag: 'backswing_length', phase: 'backswing', keywords: ['overswing', 'past parallel', 'short backswing', 'arm collapse', 'across the line', 'laid off'] },
  { tag: 'body_rotation', phase: 'downswing', keywords: ['shoulder turn', 'hip turn', 'hip rotation', 'body rotation', 'clearing the hips', 'clear the hips', 'rotational', 'pivot stalls', 'stalls'] },
  { tag: 'tempo', phase: 'swing_general', keywords: ['tempo', 'rhythm', 'rushed', 'quick transition', 'pace of the swing', 'jerky'] },
  { tag: 'setup_alignment', phase: 'setup', keywords: ['alignment', 'aim', 'stance width', 'ball position', 'posture at address', 'address position', 'setup'] },
  { tag: 'grip', phase: 'setup', keywords: ['grip', 'hand position at address', 'strong grip', 'weak grip', 'knuckles'] },
  { tag: 'balance_finish', phase: 'follow_through', keywords: ['balance', 'off balance', 'finish position', 'falling back', 'falling forward'] },
  { tag: 'chicken_wing', phase: 'follow_through', keywords: ['chicken wing', 'lead arm collapse', 'breakdown through impact', 'arm extension through impact'] },
  { tag: 'reverse_pivot', phase: 'backswing', keywords: ['reverse pivot', 'reverse tilt'] },
  { tag: 'swing_plane', phase: 'swing_general', keywords: ['swing plane', 'shaft plane', 'on plane', 'off plane'] },
  { tag: 'low_point', phase: 'impact', keywords: ['low point', 'fat contact', 'thin contact', 'ground contact', 'strike location', 'turf interaction', 'ball-first', 'ball first'] },
  { tag: 'impact_position', phase: 'impact', keywords: ['impact position', 'hands ahead', 'shaft lean', 'flipping at impact'] },
];

// Player-stated ball-flight misses. Single canonical words — safe to echo.
const MISS_TAGS = [
  { tag: 'slice', keywords: ['slice', 'slicing', 'sliced'] },
  { tag: 'hook', keywords: ['hook', 'hooking', 'duck hook'] },
  { tag: 'push', keywords: ['push right', 'pushing it right', 'push shot'] },
  { tag: 'pull', keywords: ['pull left', 'pulling it left', 'pull shot'] },
  { tag: 'fat', keywords: ['fat shot', 'hitting it fat', 'chunk', 'chunking', 'behind the ball'] },
  { tag: 'thin', keywords: ['thin shot', 'hitting it thin', 'blading', 'bladed'] },
  { tag: 'shank', keywords: ['shank', 'shanking'] },
  { tag: 'top', keywords: ['topping', 'topped it'] },
  { tag: 'block', keywords: ['block right', 'blocking it'] },
  { tag: 'distance_loss', keywords: ['losing distance', 'more distance', 'hit it further', 'hit it farther', 'no distance'] },
  { tag: 'inconsistency', keywords: ['inconsistent', 'consistency', 'two-way miss', 'never know where'] },
];

const GOAL_MARKERS = [
  'i want to', 'i want a', 'i am trying to', "i'm trying to", 'trying to', 'my goal is',
  'i would like to', 'i need to', 'working on', 'i want my',
];

const CONSTRAINT_MARKERS = [
  'bad back', 'my back', 'shoulder injury', 'bad knee', 'my knee', 'injury', 'surgery',
  "can't rotate", 'cannot rotate', 'limited mobility', 'only practice', 'no range', 'left handed',
  'left-handed', 'lefty', 'i only play', 'i only get',
];

// Metric direction heuristics: substring match on the metric name.
const LOWER_IS_BETTER_HINTS = ['sway', 'loss', 'deviation', 'dispersion', 'error', 'variance', 'offline', 'dip', 'lift', 'slide', 'tilt_change', 'extension_gain', 'flip'];
const HIGHER_IS_BETTER_HINTS = ['turn', 'rotation', 'speed', 'consistency', 'stability', 'lag', 'width', 'score', 'shaft_lean', 'balance'];

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function round(value, places = 2) {
  if (!isFiniteNumber(value)) {
    return null;
  }
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function estimateTokens(input) {
  const text = typeof input === 'string' ? input : JSON.stringify(input || '');
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function toTimestamp(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function daysBetween(startIso, endIso) {
  const start = toTimestamp(startIso);
  const end = toTimestamp(endIso);
  if (start === null || end === null) {
    return null;
  }
  return Math.max(0, Math.round((end - start) / 86400000));
}

// ---------------------------------------------------------------------------
// Tagging: read prose, emit canonical tags. Prose itself never leaves here.
// ---------------------------------------------------------------------------

function classifyText(text, taxonomy = FAULT_TAGS, { maxTags = 2 } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return [];
  }
  const haystack = text.toLowerCase();
  const hits = [];

  taxonomy.forEach((entry) => {
    let score = 0;
    entry.keywords.forEach((keyword) => {
      if (haystack.includes(keyword)) {
        // Longer keyword matches are more specific, weight them higher.
        score += keyword.length;
      }
    });
    if (score > 0) {
      hits.push({ tag: entry.tag, phase: entry.phase || null, score });
    }
  });

  hits.sort((a, b) => (b.score - a.score) || a.tag.localeCompare(b.tag));
  return hits.slice(0, maxTags);
}

function classifyObservationTags(observation) {
  const text = [observation?.observation, observation?.phase, ...asArray(observation?.evidence_markers)]
    .filter((part) => typeof part === 'string')
    .join(' ');
  return classifyText(text);
}

function severityFromObservation(observation) {
  const confidence = isFiniteNumber(observation?.confidence)
    ? Math.max(0, Math.min(observation.confidence, 1))
    : 0.6;
  const impact = typeof observation?.impact === 'string' ? observation.impact.toLowerCase() : 'neutral';

  if (impact === 'positive') {
    return 0;
  }
  if (impact === 'negative') {
    return confidence;
  }
  return round(confidence * 0.5, 3);
}

function readObservations(swing) {
  const raw = asArray(swing?.visualObservations).length
    ? asArray(swing.visualObservations)
    : asArray(swing?.visual_observations).length
      ? asArray(swing.visual_observations)
      : asArray(swing?.aiAnalysis?.visual_observations);

  return raw
    .filter((obs) => obs && typeof obs === 'object')
    .map((obs, index) => ({
      id: typeof obs.id === 'string' ? obs.id : `obs_${index + 1}`,
      phase: typeof obs.phase === 'string' ? obs.phase : 'swing_general',
      observation: typeof obs.observation === 'string' ? obs.observation : '',
      confidence: isFiniteNumber(obs.confidence) ? obs.confidence : null,
      impact: typeof obs.impact === 'string' ? obs.impact : 'neutral',
      evidence_markers: asArray(obs.evidence_markers).length
        ? asArray(obs.evidence_markers)
        : asArray(obs.evidence?.markers),
    }));
}

function readMetrics(swing) {
  const sources = [
    swing?.metrics,
    swing?.analysisResults?.metrics,
    swing?.analysis_results?.metrics,
    swing?.analysisResults,
    swing?.analysis_results,
  ];

  const metrics = {};
  sources.forEach((source) => {
    if (!source || typeof source !== 'object') {
      return;
    }
    Object.entries(source).forEach(([key, value]) => {
      if (IGNORED_METRICS.has(key) || !isFiniteNumber(value)) {
        return;
      }
      if (!(key in metrics)) {
        metrics[key] = value;
      }
    });
  });

  return metrics;
}

function readCues(swing) {
  const ai = swing?.aiAnalysis || swing?.ai_analysis || {};
  const results = swing?.analysisResults || swing?.analysis_results || {};
  const candidates = [
    ...asArray(swing?.cues),
    ...asArray(ai.practice_recommendations),
    ...asArray(ai.drill_plan),
    ...asArray(ai.focus_areas),
    ...asArray(results.focus_areas),
  ];

  return candidates
    .map((cue) => {
      if (typeof cue === 'string') {
        return cue;
      }
      if (cue && typeof cue === 'object') {
        return cue.drill || cue.recommendation || cue.text || cue.title || null;
      }
      return null;
    })
    .filter((cue) => typeof cue === 'string' && cue.trim())
    .map((cue) => cue.trim())
    .slice(0, 4);
}

function readSummaryText(swing) {
  const candidates = [
    swing?.summary,
    swing?.aiAnalysis?.coaching_response,
    swing?.aiAnalysis?.response,
    swing?.ai_analysis?.coaching_response,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim());
  return found ? found.trim() : '';
}

function readPriorityText(swing) {
  const ai = swing?.aiAnalysis || swing?.ai_analysis || {};
  const results = swing?.analysisResults || swing?.analysis_results || {};
  const candidates = [ai.priority_fix, results.priority_fix, ai.root_causes, results.root_causes];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
    if (Array.isArray(candidate) && candidate.length) {
      const first = candidate.find((value) => typeof value === 'string' && value.trim());
      if (first) {
        return first.trim();
      }
    }
  }

  return '';
}

// ---------------------------------------------------------------------------
// Per-swing normalization: swing record -> structured facts
// ---------------------------------------------------------------------------

function summarizeSwing(swing) {
  const analysisId = swing?.analysisId || swing?.analysis_id || null;
  const capturedAt = swing?.capturedAt || swing?.captured_at || swing?.createdAt || swing?.created_at || null;
  const observations = readObservations(swing);
  const metrics = readMetrics(swing);
  const cues = readCues(swing);

  const severities = {};
  const positives = new Set();
  const evidenceByTag = {};

  observations.forEach((obs) => {
    const severity = severityFromObservation(obs);
    const tags = classifyObservationTags(obs);
    tags.forEach(({ tag, phase }) => {
      if (obs.impact === 'positive') {
        positives.add(tag);
      }
      if (!(tag in severities) || severity > severities[tag]) {
        severities[tag] = severity;
        evidenceByTag[tag] = {
          phase: obs.phase || phase || 'swing_general',
          confidence: isFiniteNumber(obs.confidence) ? round(obs.confidence, 2) : null,
          impact: obs.impact,
          markers: obs.evidence_markers
            .filter((marker) => typeof marker === 'string')
            .map((marker) => marker.slice(0, 24))
            .slice(0, 3),
          source: 'visual_observation',
        };
      }
    });
  });

  // Fallback for legacy swings with no structured observations: classify the
  // coaching text into tags. The text itself is discarded immediately.
  const summaryText = readSummaryText(swing);
  if (Object.keys(severities).length === 0 && summaryText) {
    classifyText(summaryText, FAULT_TAGS, { maxTags: 3 }).forEach(({ tag, phase }) => {
      severities[tag] = 0.6;
      evidenceByTag[tag] = {
        phase: phase || 'swing_general',
        confidence: null,
        impact: 'negative',
        markers: [],
        source: 'inferred_from_prior_text',
      };
    });
  }

  const priorityText = readPriorityText(swing);
  let priority = classifyText(priorityText)[0] || null;

  if (!priority) {
    const ranked = Object.entries(severities)
      .filter(([, severity]) => severity > 0)
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    if (ranked.length) {
      priority = { tag: ranked[0][0], phase: evidenceByTag[ranked[0][0]]?.phase || null };
    }
  }

  if (!priority && cues.length) {
    priority = classifyText(cues.join(' '))[0] || null;
  }

  const prescribed = [];
  cues.forEach((cue) => {
    classifyText(cue, FAULT_TAGS, { maxTags: 1 }).forEach(({ tag }) => {
      if (!prescribed.includes(tag)) {
        prescribed.push(tag);
      }
    });
  });

  return {
    analysisId,
    capturedAt,
    date: toIsoDate(capturedAt),
    timestamp: toTimestamp(capturedAt),
    severities,
    positives: Array.from(positives),
    evidenceByTag,
    metrics,
    cues,
    priority: priority ? { tag: priority.tag, phase: priority.phase || evidenceByTag[priority.tag]?.phase || null } : null,
    prescribed: prescribed.slice(0, 3),
    observationCount: observations.length,
  };
}

// ---------------------------------------------------------------------------
// Diffing helpers (exported)
// ---------------------------------------------------------------------------

function metricDirection(metricName, overrides = {}) {
  if (overrides && typeof overrides[metricName] === 'string') {
    return overrides[metricName];
  }
  const name = String(metricName || '').toLowerCase();
  if (LOWER_IS_BETTER_HINTS.some((hint) => name.includes(hint))) {
    return 'lower_is_better';
  }
  if (HIGHER_IS_BETTER_HINTS.some((hint) => name.includes(hint))) {
    return 'higher_is_better';
  }
  return 'unknown';
}

/**
 * Compare two numeric metric maps.
 * Returns an array of { metric, from, to, delta, direction, status }.
 * status is improved | regressed | unchanged | unknown.
 */
function diffMetrics(previousMetrics, currentMetrics, { metricDirections = {} } = {}) {
  const previous = previousMetrics && typeof previousMetrics === 'object' ? previousMetrics : {};
  const current = currentMetrics && typeof currentMetrics === 'object' ? currentMetrics : {};

  return Object.keys(current)
    .filter((key) => isFiniteNumber(current[key]) && isFiniteNumber(previous[key]) && !IGNORED_METRICS.has(key))
    .sort()
    .map((key) => {
      const from = previous[key];
      const to = current[key];
      const delta = round(to - from, 3);
      const scale = Math.max(Math.abs(from), Math.abs(to), 1e-9);
      const moved = Math.abs(to - from) > scale * METRIC_EPSILON_RATIO;
      const direction = metricDirection(key, metricDirections);

      let status = 'unchanged';
      if (moved && direction === 'lower_is_better') {
        status = to < from ? 'improved' : 'regressed';
      } else if (moved && direction === 'higher_is_better') {
        status = to > from ? 'improved' : 'regressed';
      } else if (moved) {
        status = 'unknown';
      }

      return { metric: key, from: round(from, 3), to: round(to, 3), delta, direction, status };
    });
}

/**
 * Compare a single tag's standing between two summarized swings.
 * Returns { tag, status, basis, from, to }.
 */
function diffTag(tag, previousSummary, currentSummary, { metricDirections = {} } = {}) {
  if (!tag || !previousSummary || !currentSummary) {
    return { tag: tag || null, status: 'unknown', basis: 'insufficient_history', from: null, to: null };
  }

  const from = isFiniteNumber(previousSummary.severities[tag]) ? previousSummary.severities[tag] : null;
  const to = isFiniteNumber(currentSummary.severities[tag]) ? currentSummary.severities[tag] : null;

  if (from === null) {
    return { tag, status: 'new', basis: 'not_in_prior_session', from: null, to: round(to, 2) };
  }

  if (to === null) {
    // Absence is weak evidence — the pattern may simply not be visible.
    const looksClean = currentSummary.observationCount > 0;
    return {
      tag,
      status: looksClean ? 'improved' : 'unknown',
      basis: looksClean ? 'not_observed_this_session' : 'no_comparable_evidence',
      from: round(from, 2),
      to: null,
    };
  }

  const delta = to - from;
  if (delta <= -SEVERITY_EPSILON) {
    return { tag, status: 'improved', basis: `severity ${round(from, 2)}->${round(to, 2)}`, from: round(from, 2), to: round(to, 2) };
  }
  if (delta >= SEVERITY_EPSILON) {
    return { tag, status: 'regressed', basis: `severity ${round(from, 2)}->${round(to, 2)}`, from: round(from, 2), to: round(to, 2) };
  }

  // Severity flat: let a directional metric break the tie if one moved.
  const metricMoves = diffMetrics(previousSummary.metrics, currentSummary.metrics, { metricDirections })
    .filter((entry) => entry.status === 'improved' || entry.status === 'regressed');
  if (metricMoves.length === 1) {
    const move = metricMoves[0];
    return { tag, status: move.status, basis: `${move.metric} ${move.from}->${move.to}`, from: round(from, 2), to: round(to, 2) };
  }

  return { tag, status: 'unchanged', basis: `severity ${round(from, 2)}->${round(to, 2)}`, from: round(from, 2), to: round(to, 2) };
}

/**
 * Full diff between two swings (raw repository shapes accepted).
 * Returns { previous, current, tags: [...], metrics: [...] }.
 */
function diffSwings({ previous, current, metricDirections = {} } = {}) {
  if (!previous || !current) {
    return { previous: null, current: null, tags: [], metrics: [] };
  }

  const previousSummary = previous.severities ? previous : summarizeSwing(previous);
  const currentSummary = current.severities ? current : summarizeSwing(current);

  const tags = Array.from(new Set([
    ...Object.keys(previousSummary.severities),
    ...Object.keys(currentSummary.severities),
  ])).sort();

  return {
    previous: previousSummary.analysisId,
    current: currentSummary.analysisId,
    tags: tags.map((tag) => diffTag(tag, previousSummary, currentSummary, { metricDirections })),
    metrics: diffMetrics(previousSummary.metrics, currentSummary.metrics, { metricDirections }),
  };
}

// ---------------------------------------------------------------------------
// Chat mining: durable player-stated facts
// ---------------------------------------------------------------------------

function extractStatedFacts(chatTurns) {
  const turns = asArray(chatTurns)
    .filter((turn) => turn && typeof turn === 'object')
    .filter((turn) => (turn.role || '').toLowerCase() === 'user')
    .map((turn) => (typeof turn.content === 'string' ? turn.content : ''))
    .filter(Boolean);

  const misses = new Set();
  const goals = new Set();
  const constraints = new Set();

  turns.forEach((content) => {
    const lower = content.toLowerCase();

    classifyText(lower, MISS_TAGS, { maxTags: 2 }).forEach(({ tag }) => misses.add(tag));

    GOAL_MARKERS.forEach((marker) => {
      const index = lower.indexOf(marker);
      if (index === -1) {
        return;
      }
      // Keep goals as canonical tags where we can classify them; otherwise a
      // very short normalized fragment (player's own words, not the coach's).
      const fragment = lower.slice(index + marker.length, index + marker.length + 60).split(/[.!?\n]/)[0].trim();
      const tagged = classifyText(fragment, FAULT_TAGS, { maxTags: 1 })[0]
        || classifyText(fragment, MISS_TAGS, { maxTags: 1 })[0];
      if (tagged) {
        goals.add(tagged.tag);
      } else if (fragment.length >= 4) {
        goals.add(fragment.split(/\s+/).slice(0, 6).join(' '));
      }
    });

    CONSTRAINT_MARKERS.forEach((marker) => {
      if (lower.includes(marker)) {
        constraints.add(marker);
      }
    });
  });

  return {
    goals: Array.from(goals).slice(0, 4),
    misses: Array.from(misses).slice(0, 4),
    constraints: Array.from(constraints).slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Ledger assembly
// ---------------------------------------------------------------------------

function orderSwingsChronologically(swings) {
  const list = asArray(swings).filter((swing) => swing && typeof swing === 'object');
  if (list.length <= 1) {
    return list.slice();
  }

  const summaries = list.map((swing) => toTimestamp(
    swing.capturedAt || swing.captured_at || swing.createdAt || swing.created_at
  ));

  if (summaries.every((value) => value !== null)) {
    return list
      .map((swing, index) => ({ swing, timestamp: summaries[index], index }))
      .sort((a, b) => (a.timestamp - b.timestamp) || (a.index - b.index))
      .map((entry) => entry.swing);
  }

  // getLastAnalyzedSwings returns newest-first; without dates we trust that.
  return list.slice().reverse();
}

function buildPatterns(summaries) {
  const byTag = new Map();

  summaries.forEach((summary, index) => {
    Object.entries(summary.severities).forEach(([tag, severity]) => {
      if (!byTag.has(tag)) {
        byTag.set(tag, { tag, sessions: [], severity: [] });
      }
      const record = byTag.get(tag);
      record.sessions.push(index + 1);
      record.severity.push(round(severity, 2));
    });
  });

  return Array.from(byTag.values())
    // Tags only ever seen as positives belong in ruled_out, not patterns.
    .filter((record) => record.severity.some((value) => value > 0))
    .map((record) => {
      const firstIndex = record.sessions[0] - 1;
      const first = summaries[firstIndex];
      const severities = record.severity;
      const delta = severities.length > 1 ? severities[severities.length - 1] - severities[0] : 0;
      let trend = 'flat';
      if (delta <= -SEVERITY_EPSILON) {
        trend = 'improving';
      } else if (delta >= SEVERITY_EPSILON) {
        trend = 'worsening';
      }

      return {
        tag: record.tag,
        sessions_seen: record.sessions.length,
        session_numbers: record.sessions,
        first_seen: { session: record.sessions[0], date: first?.date || null, swing: first?.analysisId || null },
        severity: severities,
        trend,
      };
    })
    .sort((a, b) => (b.sessions_seen - a.sessions_seen)
      || ((b.severity[b.severity.length - 1] || 0) - (a.severity[a.severity.length - 1] || 0))
      || a.tag.localeCompare(b.tag));
}

function buildRuledOut(summaries, swingProfile) {
  const negativeEver = new Set();
  const positiveCounts = new Map();

  summaries.forEach((summary) => {
    Object.entries(summary.severities).forEach(([tag, severity]) => {
      if (severity > 0) {
        negativeEver.add(tag);
      }
    });
    summary.positives.forEach((tag) => {
      positiveCounts.set(tag, (positiveCounts.get(tag) || 0) + 1);
    });
  });

  const ruledOut = [];
  positiveCounts.forEach((count, tag) => {
    if (!negativeEver.has(tag)) {
      ruledOut.push({ tag, basis: 'observed_positive', sessions_seen: count });
    }
  });

  asArray(swingProfile?.strengths).slice(0, 5).forEach((strength) => {
    const text = typeof strength === 'string' ? strength : strength?.text || '';
    classifyText(text, FAULT_TAGS, { maxTags: 1 }).forEach(({ tag }) => {
      if (!negativeEver.has(tag) && !ruledOut.some((entry) => entry.tag === tag)) {
        ruledOut.push({ tag, basis: 'profile_strength', sessions_seen: null });
      }
    });
  });

  return ruledOut.slice(0, 5);
}

function buildHeldStreak(entries) {
  if (!entries.length) {
    return null;
  }
  const latest = entries[entries.length - 1];
  if (!latest.priority) {
    return null;
  }
  const tag = latest.priority;
  let count = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].priority === tag) {
      count += 1;
    } else {
      break;
    }
  }
  const since = entries[entries.length - count];
  return {
    tag,
    consecutive_sessions: count,
    since_date: since?.date || null,
    since_swing: since?.swing || null,
  };
}

/**
 * Build the longitudinal coaching ledger.
 *
 * @param {object}   input
 * @param {Array}    input.swings        Records from getLastAnalyzedSwings (any order).
 * @param {object}   [input.swingProfile] Record from swingProfileRepository.getProfile.
 * @param {Array}    [input.chatTurns]    Turns from chatRepository.getRecentTurns.
 * @param {number}   [input.maxSessions=12]
 * @param {object}   [input.metricDirections] Per-metric overrides:
 *                   { metric_name: 'lower_is_better' | 'higher_is_better' }.
 * @returns {object} Structured ledger (see docs/memory-challenger-ledger.md).
 */
function buildLedger({
  swings,
  swingProfile = null,
  chatTurns = [],
  maxSessions = DEFAULT_MAX_SESSIONS,
  metricDirections = {},
} = {}) {
  const ordered = orderSwingsChronologically(swings).slice(-Math.max(1, maxSessions));
  const summaries = ordered.map((swing) => summarizeSwing(swing));

  const entries = summaries.map((summary, index) => {
    const previous = index > 0 ? summaries[index - 1] : null;
    const previousPriority = previous?.priority?.tag || null;

    const carryover = previousPriority
      ? (() => {
        const diff = diffTag(previousPriority, previous, summary, { metricDirections });
        return { tag: diff.tag, status: diff.status, basis: diff.basis };
      })()
      : null;

    const evidence = summary.priority ? summary.evidenceByTag[summary.priority.tag] || null : null;

    return {
      session: index + 1,
      date: summary.date,
      swing: summary.analysisId,
      priority: summary.priority?.tag || null,
      phase: summary.priority?.phase || null,
      evidence: evidence
        ? {
          phase: evidence.phase,
          confidence: evidence.confidence,
          severity: round(summary.severities[summary.priority.tag], 2),
          markers: evidence.markers,
          source: evidence.source,
        }
        : null,
      prescribed: summary.prescribed,
      cues: summary.cues.map((cue) => cue.slice(0, 60)),
      carryover,
      metric_moves: previous
        ? diffMetrics(previous.metrics, summary.metrics, { metricDirections })
          .filter((entry) => entry.status !== 'unchanged')
          .slice(0, 3)
        : [],
    };
  });

  const patterns = buildPatterns(summaries);
  const ruledOut = buildRuledOut(summaries, swingProfile);
  const stated = extractStatedFacts(chatTurns);

  const firstDate = summaries.length ? summaries[0].date : null;
  const lastDate = summaries.length ? summaries[summaries.length - 1].date : null;

  return {
    version: LEDGER_VERSION,
    player: {
      sessions_logged: entries.length,
      total_swings_analyzed: isFiniteNumber(swingProfile?.total_swings_analyzed)
        ? swingProfile.total_swings_analyzed
        : entries.length,
      first_session_date: firstDate,
      last_session_date: lastDate,
      span_days: daysBetween(firstDate, lastDate),
    },
    entries,
    patterns,
    recurring_patterns: patterns.filter((pattern) => pattern.sessions_seen >= 2),
    held_streak: buildHeldStreak(entries),
    ruled_out: ruledOut,
    player_stated: stated,
    profile_focus_areas: asArray(swingProfile?.focus_areas)
      .slice(0, 3)
      .map((area) => classifyText(typeof area === 'string' ? area : '', FAULT_TAGS, { maxTags: 1 })[0]?.tag)
      .filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Rendering: token-budgeted structured facts
// ---------------------------------------------------------------------------

const CONTEXT_RULES = [
  'These are structured facts, not coaching copy. Never reuse prior wording or phrasing.',
  'Tags are canonical labels; describe them in your own words every time.',
  'Reference continuity only for facts listed here; never invent sessions, dates, or history.',
  'Current swing evidence outweighs this ledger whenever they disagree.',
];

const STATUS_LEGEND = 'carryover.status: improved|unchanged|regressed|new|unknown (vs prior session, same tag)';

function selectEntries(entries, maxEntries) {
  if (entries.length <= maxEntries) {
    return { kept: entries.slice(), omitted: 0 };
  }
  if (maxEntries <= 1) {
    return { kept: entries.slice(-1), omitted: entries.length - 1 };
  }
  // Always keep session 1 (enables "the same pattern from your first video")
  // plus the most recent window.
  const recent = entries.slice(-(maxEntries - 1));
  return { kept: [entries[0], ...recent], omitted: entries.length - maxEntries };
}

function compactEntry(entry, level, includeCueText) {
  const compact = {
    n: entry.session,
    date: entry.date,
    swing: entry.swing,
    priority: entry.priority,
  };

  if (entry.phase) {
    compact.phase = entry.phase;
  }
  if (entry.carryover) {
    compact.carryover = entry.carryover;
  }
  if (level < 3 && entry.prescribed.length) {
    compact.prescribed = entry.prescribed;
  }
  if (level < 2 && entry.evidence) {
    compact.evidence = level < 1
      ? entry.evidence
      : { severity: entry.evidence.severity, confidence: entry.evidence.confidence };
  }
  if (level < 1 && entry.metric_moves.length) {
    compact.metric_moves = entry.metric_moves.map((move) => ({
      m: move.metric,
      from: move.from,
      to: move.to,
      status: move.status,
    }));
  }
  if (includeCueText && level < 1 && entry.cues.length) {
    compact.cue_text = entry.cues.slice(0, 2);
  }

  return compact;
}

function buildPayload(ledger, { maxEntries, level, includeCueText }) {
  const { kept, omitted } = selectEntries(ledger.entries, maxEntries);

  const payload = {
    ledger_version: ledger.version,
    player: ledger.player,
    sessions: kept.map((entry) => compactEntry(entry, level, includeCueText)),
  };

  const patternLimit = level >= 3 ? 2 : level >= 1 ? 3 : 5;
  const patterns = (ledger.recurring_patterns.length ? ledger.recurring_patterns : ledger.patterns)
    .slice(0, patternLimit)
    .map((pattern) => {
      const compact = {
        tag: pattern.tag,
        sessions_seen: pattern.sessions_seen,
        first_seen: pattern.first_seen,
        trend: pattern.trend,
      };
      if (level < 2) {
        compact.severity = pattern.severity;
      }
      return compact;
    });

  if (patterns.length) {
    payload.patterns = patterns;
  }
  if (ledger.held_streak && ledger.held_streak.consecutive_sessions > 1) {
    payload.held_streak = ledger.held_streak;
  }
  if (level < 3 && ledger.ruled_out.length) {
    payload.ruled_out = ledger.ruled_out.map((entry) => entry.tag);
  }
  if (level < 3) {
    const stated = {};
    if (ledger.player_stated.goals.length) stated.goals = ledger.player_stated.goals;
    if (ledger.player_stated.misses.length) stated.misses = ledger.player_stated.misses;
    if (ledger.player_stated.constraints.length) stated.constraints = ledger.player_stated.constraints;
    if (Object.keys(stated).length) {
      payload.player_stated = stated;
    }
  }

  if (omitted > 0) {
    payload.sessions_omitted = omitted;
    payload.truncated = true;
  }

  if (!kept.length) {
    // No history yet: spend nothing on legends the model cannot use.
    return {
      ledger_version: payload.ledger_version,
      player: { sessions_logged: 0 },
      sessions: [],
      note: 'no prior coaching sessions on record',
    };
  }

  payload.legend = STATUS_LEGEND;
  payload.context_rules = level >= 4 ? CONTEXT_RULES.slice(0, 2) : CONTEXT_RULES;

  return payload;
}

/**
 * Render the ledger as a compact JSON string for injection into model context.
 * Degrades gracefully until it fits the token budget.
 *
 * @param {object} ledger  Result of buildLedger().
 * @param {object} [options]
 * @param {number} [options.maxEntries=6]
 * @param {number} [options.maxTokens=1200]
 * @param {boolean}[options.includeCueText=false] Opt-in verbatim cue snippets.
 *                 Off by default to keep prior coach wording out of context.
 * @param {boolean}[options.pretty=false]
 * @returns {string} JSON string.
 */
function renderLedgerContext(ledger, {
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxTokens = DEFAULT_MAX_TOKENS,
  includeCueText = false,
  pretty = false,
} = {}) {
  const safeLedger = ledger && Array.isArray(ledger.entries)
    ? ledger
    : buildLedger({ swings: [] });

  const stringify = (payload) => (pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload));
  const budget = Math.max(40, maxTokens);

  const entryPlan = [];
  for (let entries = Math.max(1, maxEntries); entries >= 1; entries -= 1) {
    entryPlan.push(entries);
  }

  // Shed detail before shedding history: for each session count we walk the
  // whole detail ladder before dropping another session.
  let lastRendered = null;
  for (let index = 0; index < entryPlan.length; index += 1) {
    for (let level = 0; level <= 4; level += 1) {
      const payload = buildPayload(safeLedger, {
        maxEntries: entryPlan[index],
        level,
        includeCueText,
      });
      const rendered = stringify(payload);
      lastRendered = rendered;
      if (estimateTokens(rendered) <= budget) {
        return rendered;
      }
    }
  }

  // Floor: identity + newest session only, hard-clipped to budget.
  const floorPayload = {
    ledger_version: safeLedger.version,
    player: { sessions_logged: safeLedger.player.sessions_logged },
    sessions: safeLedger.entries.slice(-1).map((entry) => ({
      n: entry.session,
      date: entry.date,
      priority: entry.priority,
    })),
    truncated: true,
    context_rules: [CONTEXT_RULES[0]],
  };
  const floor = stringify(floorPayload);
  if (estimateTokens(floor) <= budget) {
    return floor;
  }

  const maxChars = budget * CHARS_PER_TOKEN;
  return (floor.length <= maxChars ? floor : (lastRendered || floor).slice(0, maxChars));
}

/**
 * Convenience one-shot: raw repository data -> context string.
 */
function buildLedgerContext({
  swings,
  swingProfile = null,
  chatTurns = [],
  metricDirections = {},
} = {}, renderOptions = {}) {
  const ledger = buildLedger({ swings, swingProfile, chatTurns, metricDirections });
  return renderLedgerContext(ledger, renderOptions);
}

module.exports = {
  LEDGER_VERSION,
  FAULT_TAGS,
  MISS_TAGS,
  DEFAULT_MAX_TOKENS,
  buildLedger,
  renderLedgerContext,
  buildLedgerContext,
  diffSwings,
  diffTag,
  diffMetrics,
  metricDirection,
  estimateTokens,
  __private: {
    summarizeSwing,
    classifyText,
    classifyObservationTags,
    severityFromObservation,
    orderSwingsChronologically,
    extractStatedFacts,
    buildPatterns,
    buildHeldStreak,
    selectEntries,
  },
};
