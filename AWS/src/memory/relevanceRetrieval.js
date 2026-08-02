'use strict';

// Relevance Retrieval — query-aware coaching memory selection.
//
// CHALLENGER to the champion path (buildDeveloperContext + getLastAnalyzedSwings),
// which always injects the N most RECENT swings. That is the wrong slice when the
// player asks "is this better than my first video?" or "did I ever fix my early
// extension?" — the relevant swing may be months old.
//
// This module scores EVERY available past swing/turn against the current question
// (or, when there is no question, against the current swing's observations) using
// lexical + structural signals only. No embeddings, no network calls, no new
// dependencies, no new DynamoDB tables. It reads the existing shapes emitted by
// swingRepository.normalizeAnalysisItem / buildAnalysisReport, swingProfileRepository,
// and chatRepository chat_history turns.
//
// IMPORTANT (Feb 2026 template-poisoning rule): renderRetrievedContext({ mode: 'analysis' })
// never emits prior coaching prose (summaries / assistant turns). Coaching text is used
// for MATCHING only; what gets injected is factual observations, metrics and timestamps.

const DEFAULT_BUDGET_TOKENS = 1200;
const DEFAULT_MAX_SWINGS = 4;
const DEFAULT_MAX_TURNS = 4;
const DEFAULT_LIVE_WINDOW_TURNS = 12; // chatRepository.MAX_CHAT_TURNS — already in the prompt
const RECENCY_HALF_LIFE_DAYS = 45;
const SWING_BUDGET_SHARE = 0.72;
const MAX_OBSERVATIONS_PER_SWING = 3;
const OBSERVATION_CHAR_LIMIT = 170;
const TURN_CHAR_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Golf fault vocabulary
// ---------------------------------------------------------------------------
// Canonical fault -> player-language + coach-language surface forms. This is what
// lets "am I still standing up through it?" match a stored "early extension"
// observation without any embedding model.

const FAULT_VOCABULARY = {
  early_extension: {
    label: 'early extension',
    phrases: [
      'early extension', 'extending early', 'extends early', 'extend early',
      'standing up', 'stands up', 'stand up', 'stood up', 'straightening up',
      'straightens up', 'straighten up', 'coming up out of it', 'coming out of posture',
      'out of posture', 'losing posture', 'lose posture', 'lost posture', 'loss of posture',
      'losing spine angle', 'lose spine angle', 'loss of spine angle', 'spine angle changes',
      'hips toward the ball', 'hips into the ball', 'hips move toward the ball',
      'hips push toward the ball', 'push toward the ball', 'pushing toward the ball',
      'pelvis toward the ball', 'pelvis moves toward the ball', 'pelvis pushes toward the ball',
      'spine angle rises', 'spine angle raises', 'spine angle increases', 'hips thrust',
      'thrusting', 'thrust', 'goat hump', 'rising through impact', 'lifting out of posture',
      'raising up', 'popping up',
    ],
  },
  casting: {
    label: 'casting',
    phrases: [
      'casting', 'cast', 'casts', 'early release', 'releasing early', 'released early',
      'releases early', 'losing lag', 'lose lag', 'loss of lag', 'lost lag', 'no lag',
      'scooping', 'scoop', 'scoops', 'flipping', 'flip', 'flips', 'flippy',
      'throwaway', 'throw away', 'unhinging early', 'wrists unhinge', 'angle released early',
    ],
  },
  over_the_top: {
    label: 'over the top',
    phrases: [
      'over the top', 'over-the-top', 'out to in', 'out-to-in', 'outside in', 'outside-in',
      'coming across it', 'coming across the ball', 'cutting across', 'across the ball',
      'shoulders start the downswing', 'upper body starts the downswing',
      'arms take over from the top', 'steep transition', 'over it from the top',
      'slice path', 'slicing path',
    ],
  },
  sway: {
    label: 'sway',
    phrases: [
      'sway', 'swaying', 'sways', 'swayed', 'hip sway', 'swaying off the ball',
      'sliding off the ball', 'moving off the ball', 'lateral move back',
      'moving away from the target', 'drifting back', 'weight goes outside the trail foot',
    ],
  },
  slide: {
    label: 'lateral slide',
    phrases: [
      'slide', 'slides', 'sliding', 'slid', 'hip slide', 'hips slide', 'lateral slide',
      'sliding through impact', 'sliding toward the target', 'lower body slide',
      'slides ahead of the ball',
    ],
  },
  chicken_wing: {
    label: 'chicken wing',
    phrases: [
      'chicken wing', 'chicken wings', 'chicken winging', 'chicken-wing', 'chickenwing',
      'bent lead arm', 'lead arm collapse',
      'lead arm breaks down', 'lead elbow bends', 'lead elbow breaking down',
      'folded lead arm', 'left arm bending', 'left elbow flying', 'arm breakdown through impact',
    ],
  },
  reverse_pivot: {
    label: 'reverse pivot',
    phrases: [
      'reverse pivot', 'reverse weight shift', 'reverse tilt',
      'weight on the lead foot at the top', 'weight on the front foot at the top',
      'leaning toward the target at the top', 'tilting toward the target',
      'backwards weight shift',
    ],
  },
  hanging_back: {
    label: 'hanging back / weight shift',
    phrases: [
      'hanging back', 'hangs back', 'hang back', 'falling back', 'falls back',
      'stuck on the back foot', 'stuck on the trail foot', 'weight on the back foot at impact',
      'weight shift', 'weight transfer', 'pressure shift', 'not transferring weight',
      'no weight shift', 'back foot at impact',
    ],
  },
  over_swing: {
    label: 'overswing',
    phrases: [
      'overswing', 'over swing', 'overswinging', 'too long at the top', 'past parallel',
      'club goes past parallel', 'arms collapse at the top', 'backswing too long',
    ],
  },
  flat_shoulder_plane: {
    label: 'flat shoulder plane',
    phrases: [
      'flat shoulder plane', 'shoulders too flat', 'flat turn', 'shoulder plane too flat',
      'level shoulders at the top',
    ],
  },
  steep_shaft: {
    label: 'steep shaft / steep attack',
    phrases: [
      'too steep', 'steep shaft', 'steepening', 'steepens', 'shaft steepens',
      'chopping down', 'digging', 'steep angle of attack', 'steep downswing', 'steep',
    ],
  },
  shallow_shaft: {
    label: 'shallow / stuck',
    phrases: [
      'too shallow', 'shallowing', 'shallows', 'stuck behind', 'stuck inside',
      'trapped behind the body', 'from the inside too much', 'in to out too much',
      'in-to-out path', 'club gets stuck',
    ],
  },
  laid_off: {
    label: 'laid off at the top',
    phrases: ['laid off', 'laid-off', 'shaft points left at the top', 'club points left at the top'],
  },
  across_the_line: {
    label: 'across the line',
    phrases: ['across the line', 'crossing the line at the top', 'club points right at the top'],
  },
  cupped_wrist: {
    label: 'cupped lead wrist',
    phrases: [
      'cupped', 'cupping', 'cupped lead wrist', 'cupped left wrist', 'extended lead wrist',
      'wrist extension at the top',
    ],
  },
  bowed_wrist: {
    label: 'bowed lead wrist',
    phrases: ['bowed wrist', 'bowing the wrist', 'bowed lead wrist', 'flexed lead wrist'],
  },
  grip: {
    label: 'grip',
    phrases: [
      'strong grip', 'weak grip', 'neutral grip', 'grip position', 'how i hold the club',
      'knuckles showing', 'grip pressure',
    ],
  },
  head_movement: {
    label: 'head movement',
    phrases: [
      'head movement', 'head moves', 'head dip', 'dipping', 'dips', 'head rise',
      'head comes up', 'moving my head', 'steady head', 'head drops',
    ],
  },
  stalled_rotation: {
    label: 'stalled rotation',
    phrases: [
      'hips stall', 'body stall', 'stalling', 'stalls', 'rotation stalls',
      'hips not clearing', 'not clearing the hips', 'blocked hips', 'stopped rotating',
      'not rotating through', 'body stops turning',
    ],
  },
  tempo: {
    label: 'tempo',
    phrases: [
      'tempo', 'rhythm', 'rushing', 'rushed', 'quick transition', 'too fast from the top',
      'too quick', 'smooth transition', 'tempo ratio', 'jerky', 'swinging too hard',
    ],
  },
  setup_posture: {
    label: 'setup posture',
    phrases: [
      'posture at address', 'setup posture', 'hunched', 'slouched', 'rounded shoulders at address',
      'spine angle at setup', 'too bent over', 'too upright at address', 'stance width',
      'ball position', 'ball too far forward', 'ball too far back',
    ],
  },
  alignment: {
    label: 'alignment',
    phrases: [
      'alignment', 'aim', 'aiming', 'aimed', 'open stance', 'closed stance',
      'shoulders open at address', 'shoulders closed at address', 'feet aligned',
    ],
  },
  face_control: {
    label: 'clubface control',
    phrases: [
      'clubface', 'club face', 'face angle', 'open face', 'closed face', 'face control',
      'face is open at the top', 'shut face', 'face rotation',
    ],
  },
  contact: {
    label: 'strike quality',
    phrases: [
      'fat', 'chunked', 'chunking', 'thin', 'thinned', 'topped', 'topping', 'heel strike',
      'toe strike', 'off the toe', 'off the heel', 'low point', 'ground contact',
    ],
  },
  ball_flight: {
    label: 'ball flight',
    phrases: [
      'slice', 'slicing', 'sliced', 'hook', 'hooking', 'hooked', 'pull', 'pulling',
      'push', 'pushing', 'fade', 'draw', 'block', 'blocking', 'two way miss',
      'ball flight', 'starting left', 'starting right', 'low flight', 'ballooning',
    ],
  },
};

// ---------------------------------------------------------------------------
// Swing phase vocabulary
// ---------------------------------------------------------------------------

const PHASE_VOCABULARY = {
  setup: ['setup', 'set up', 'address', 'at address', 'stance', 'posture at address', 'starting position'],
  takeaway: ['takeaway', 'take away', 'first move back', 'first move away', 'early backswing'],
  backswing: ['backswing', 'back swing', 'going back', 'the way back', 'turn back', 'at the top', 'top of the swing', 'top of the backswing'],
  transition: ['transition', 'from the top', 'change of direction', 'start of the downswing'],
  downswing: ['downswing', 'down swing', 'coming down', 'on the way down', 'delivery', 'shaft plane coming down'],
  impact: ['impact', 'at impact', 'through impact', 'strike', 'contact', 'through the ball', 'through it', 'at the ball'],
  follow_through: ['follow through', 'follow-through', 'followthrough', 'finish', 'finish position', 'after impact', 'extension through', 'release into the finish'],
  swing_general: ['overall', 'whole swing', 'in general', 'general'],
};

const STOPWORDS = new Set([
  'a', 'about', 'again', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been',
  'being', 'but', 'by', 'can', 'did', 'do', 'does', 'doing', 'done', 'for', 'from', 'get',
  'got', 'had', 'has', 'have', 'he', 'her', 'here', 'him', 'his', 'how', 'i', 'if', 'im',
  'in', 'into', 'is', 'it', 'its', 'just', 'like', 'me', 'more', 'most', 'my', 'no', 'not',
  'of', 'on', 'one', 'or', 'our', 'out', 'over', 'own', 's', 'same', 'she', 'should', 'so',
  'some', 'still', 't', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'up', 'very', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with', 'would',
  'you', 'your', 'yours', 'ive', 'youre', 'thats', 'dont', 'doesnt', 'didnt', 'am',
]);

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

const UNIT_DAYS = { day: 1, week: 7, month: 30.4, year: 365 };

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPhraseMatchers(vocabulary) {
  const matchers = [];
  Object.entries(vocabulary).forEach(([key, entry]) => {
    const phrases = Array.isArray(entry) ? entry : entry.phrases;
    phrases.forEach((phrase) => {
      const pattern = phrase
        .trim()
        .split(/\s+/)
        .map((word) => escapeRegExp(word))
        .join('[\\s\\-]+');
      matchers.push({ key, phrase, re: new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i') });
    });
  });
  return matchers;
}

const FAULT_MATCHERS = buildPhraseMatchers(FAULT_VOCABULARY);
const PHASE_MATCHERS = buildPhraseMatchers(PHASE_VOCABULARY);

function normalizeText(input) {
  if (typeof input !== 'string') {
    return '';
  }
  return input.toLowerCase().replace(/[^a-z0-9'\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(input) {
  const normalized = normalizeText(input).replace(/'/g, '');
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/[\s\-]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

/** Canonical fault keys present in a blob of text. */
function extractFaults(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }
  const found = new Map();
  FAULT_MATCHERS.forEach(({ key, phrase, re }) => {
    if (found.has(key)) {
      return;
    }
    if (re.test(normalized)) {
      found.set(key, phrase);
    }
  });
  return Array.from(found.keys());
}

/** Canonical swing phases referenced by a blob of text. */
function extractPhases(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }
  const found = new Set();
  PHASE_MATCHERS.forEach(({ key, re }) => {
    if (!found.has(key) && re.test(normalized)) {
      found.add(key);
    }
  });
  return Array.from(found);
}

// ---------------------------------------------------------------------------
// Shape adapters (work with existing repository outputs, camel or snake)
// ---------------------------------------------------------------------------

function getAnalysisId(swing) {
  if (!swing || typeof swing !== 'object') {
    return null;
  }
  return swing.analysisId || swing.analysis_id || null;
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

function getVisualObservations(swing) {
  if (!swing || typeof swing !== 'object') {
    return [];
  }
  const candidates = [
    swing.visualObservations,
    swing.visual_observations,
    swing.aiAnalysis && swing.aiAnalysis.visual_observations,
    swing.ai_analysis && swing.ai_analysis.visual_observations,
  ];
  const found = candidates.find((value) => Array.isArray(value) && value.length > 0);
  return Array.isArray(found) ? found.filter((obs) => obs && typeof obs === 'object') : [];
}

function getMetrics(swing) {
  if (!swing || typeof swing !== 'object') {
    return {};
  }
  const source = swing.metrics
    || (swing.analysisResults && swing.analysisResults.metrics)
    || (swing.analysis_results && swing.analysis_results.metrics)
    || null;
  if (!source || typeof source !== 'object') {
    return {};
  }
  const metrics = {};
  Object.entries(source).forEach(([key, value]) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      metrics[key] = value;
    }
  });
  return metrics;
}

function getCues(swing) {
  if (!swing || typeof swing !== 'object') {
    return [];
  }
  const lists = [
    swing.cues,
    swing.focusAreas,
    swing.focus_areas,
    swing.analysisResults && swing.analysisResults.focus_areas,
    swing.analysis_results && swing.analysis_results.focus_areas,
    swing.aiAnalysis && swing.aiAnalysis.focus_areas,
    swing.aiAnalysis && swing.aiAnalysis.practice_recommendations,
  ];
  const out = [];
  lists.forEach((list) => {
    if (Array.isArray(list)) {
      list.forEach((entry) => {
        if (typeof entry === 'string') {
          out.push(entry);
        } else if (entry && typeof entry === 'object' && typeof entry.focus === 'string') {
          out.push(entry.focus);
        }
      });
    }
  });
  return out.filter((value, index, self) => self.indexOf(value) === index).slice(0, 8);
}

/**
 * All searchable text for a swing. Coaching prose IS used here — matching only.
 * It is never emitted by renderRetrievedContext in analysis mode.
 */
function buildSwingSearchText(swing) {
  if (!swing || typeof swing !== 'object') {
    return '';
  }
  const parts = [];
  const observations = getVisualObservations(swing);
  observations.forEach((obs) => {
    if (typeof obs.observation === 'string') {
      parts.push(obs.observation);
    }
    if (typeof obs.phase === 'string') {
      parts.push(obs.phase.replace(/_/g, ' '));
    }
    if (Array.isArray(obs.evidence_markers)) {
      parts.push(obs.evidence_markers.filter((m) => typeof m === 'string').join(' '));
    }
  });
  getCues(swing).forEach((cue) => parts.push(cue));
  if (typeof swing.summary === 'string') {
    parts.push(swing.summary);
  }
  const ai = swing.aiAnalysis || swing.ai_analysis;
  if (ai && typeof ai === 'object') {
    ['coaching_response', 'response', 'root_causes', 'priority_fix'].forEach((key) => {
      const value = ai[key];
      if (typeof value === 'string') {
        parts.push(value);
      } else if (Array.isArray(value)) {
        parts.push(value.filter((v) => typeof v === 'string').join(' '));
      }
    });
  }
  return parts.join(' \n ');
}

function getTurnText(turn) {
  if (!turn || typeof turn !== 'object') {
    return '';
  }
  return typeof turn.content === 'string' ? turn.content : '';
}

function getTurnTimestamp(turn) {
  if (!turn || typeof turn !== 'object') {
    return null;
  }
  return turn.timestamp || turn.created_at || turn.createdAt || null;
}

// ---------------------------------------------------------------------------
// Query analysis
// ---------------------------------------------------------------------------

const OLDEST_CUE_RE = /(^|[^a-z0-9])(first|1st|earliest|very first|original|initial|beginning|when i started|when i first|started out|starting out|back when|day one)([^a-z0-9]|$)/i;
const NEWEST_CUE_RE = /(^|[^a-z0-9])(latest|most recent|newest|today|just now|this one|this swing|current swing|last swing|last video|my last)([^a-z0-9]|$)/i;
const SPAN_CUE_RE = /(^|[^a-z0-9])(ever|always|over time|so far|history|progress|trend|trending|since|compared to|compare|versus|vs|used to|any better|getting better|improved|improving|improvement|fixed|fix(?:ed)? it|still)([^a-z0-9]|$)/i;
const RELATIVE_WINDOW_RE = /(^|[^a-z0-9])(?:in the )?(?:last|past)\s+(?:(\d+|a|an|couple(?: of)?|few)\s+)?(day|week|month|year)s?([^a-z0-9]|$)/i;
const AGO_RE = /(^|[^a-z0-9])(?:(\d+|a|an|couple(?: of)?|few)\s+)?(day|week|month|year)s?\s+ago([^a-z0-9]|$)/i;
const SINCE_MONTH_RE = /(^|[^a-z0-9])since\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)([^a-z0-9]|$)/i;

function parseCount(raw) {
  if (!raw) {
    return 1;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'a' || normalized === 'an') {
    return 1;
  }
  if (normalized === 'few') {
    return 3;
  }
  if (normalized.startsWith('couple')) {
    return 2;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Classify explicit temporal cues in the question.
 * Priority: window > oldest > span > newest.
 */
function detectTemporalCue(question, now) {
  const text = typeof question === 'string' ? question : '';
  if (!text.trim()) {
    return { cue: null, window: null, matched: [] };
  }

  const matched = [];
  const nowMs = Number.isFinite(now) ? now : Date.now();

  const relative = text.match(RELATIVE_WINDOW_RE);
  if (relative) {
    const count = parseCount(relative[2]);
    const unitDays = UNIT_DAYS[relative[3].toLowerCase()] || 30.4;
    const spanDays = count * unitDays;
    matched.push(relative[0].trim());
    return {
      cue: 'window',
      window: { start: nowMs - spanDays * DAY_MS, end: nowMs, spanDays },
      matched,
    };
  }

  const ago = text.match(AGO_RE);
  if (ago) {
    const count = parseCount(ago[2]);
    const unitDays = UNIT_DAYS[ago[3].toLowerCase()] || 30.4;
    const center = nowMs - count * unitDays * DAY_MS;
    const tolerance = Math.max(unitDays * DAY_MS * 0.6, 3 * DAY_MS);
    matched.push(ago[0].trim());
    return {
      cue: 'window',
      window: { start: center - tolerance, end: center + tolerance, spanDays: (tolerance * 2) / DAY_MS },
      matched,
    };
  }

  const sinceMonth = text.match(SINCE_MONTH_RE);
  if (sinceMonth) {
    const monthIndex = MONTHS[sinceMonth[2].toLowerCase()];
    const reference = new Date(nowMs);
    let year = reference.getUTCFullYear();
    if (monthIndex > reference.getUTCMonth()) {
      year -= 1;
    }
    matched.push(sinceMonth[0].trim());
    return {
      cue: 'window',
      window: { start: Date.UTC(year, monthIndex, 1), end: nowMs, spanDays: null },
      matched,
    };
  }

  const oldest = text.match(OLDEST_CUE_RE);
  if (oldest) {
    matched.push(oldest[2].trim());
    return { cue: 'oldest', window: null, matched };
  }

  const span = text.match(SPAN_CUE_RE);
  if (span) {
    matched.push(span[2].trim());
    return { cue: 'span', window: null, matched };
  }

  const newest = text.match(NEWEST_CUE_RE);
  if (newest) {
    matched.push(newest[2].trim());
    return { cue: 'newest', window: null, matched };
  }

  return { cue: null, window: null, matched: [] };
}

/**
 * Build the retrieval query. Falls back to the current swing's observations and
 * the profile focus areas when the player asked nothing (analysis-time use).
 */
function analyzeQuery({ question, currentSwing, swingProfile, now } = {}) {
  const questionText = typeof question === 'string' ? question.trim() : '';
  const temporal = detectTemporalCue(questionText, now);

  const fallbackParts = [];
  if (currentSwing) {
    fallbackParts.push(buildSwingSearchText(currentSwing));
  }
  if (swingProfile && typeof swingProfile === 'object') {
    ['focus_areas', 'cautions', 'strengths'].forEach((key) => {
      if (Array.isArray(swingProfile[key])) {
        fallbackParts.push(swingProfile[key].filter((v) => typeof v === 'string').join(' '));
      }
    });
  }
  const fallbackText = fallbackParts.join(' \n ');

  const questionFaults = extractFaults(questionText);
  const questionPhases = extractPhases(questionText);
  const derivedFaults = extractFaults(fallbackText);
  const derivedPhases = extractPhases(fallbackText);

  const faults = questionFaults.length > 0 ? questionFaults : derivedFaults;
  const phases = questionPhases.length > 0 ? questionPhases : derivedPhases;

  const questionTokens = tokenize(questionText);
  const tokens = questionTokens.length > 0 ? questionTokens : tokenize(fallbackText).slice(0, 60);

  return {
    question: questionText,
    hasQuestion: questionText.length > 0,
    usedFallbackText: questionFaults.length === 0 && questionTokens.length === 0,
    tokens,
    tokenSet: new Set(tokens),
    faults,
    faultSet: new Set(faults),
    phases,
    phaseSet: new Set(phases),
    temporal,
    isGeneric: faults.length === 0 && temporal.cue === null,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function buildCorpusStats(documents) {
  const docCount = documents.length;
  const documentFrequency = new Map();
  documents.forEach((doc) => {
    new Set(doc).forEach((token) => {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    });
  });
  return {
    docCount,
    idf(token) {
      const df = documentFrequency.get(token) || 0;
      return Math.log((docCount + 1) / (df + 1)) + 1;
    },
  };
}

function lexicalScore(queryTokens, docTokenSet, corpusStats) {
  if (!queryTokens.length || !docTokenSet || docTokenSet.size === 0) {
    return 0;
  }
  let matched = 0;
  let total = 0;
  new Set(queryTokens).forEach((token) => {
    const weight = corpusStats ? corpusStats.idf(token) : 1;
    total += weight;
    if (docTokenSet.has(token)) {
      matched += weight;
    }
  });
  return total > 0 ? Math.min(1, matched / total) : 0;
}

function setOverlapScore(querySet, docSet) {
  if (!querySet || querySet.size === 0 || !docSet || docSet.size === 0) {
    return 0;
  }
  let hits = 0;
  querySet.forEach((value) => {
    if (docSet.has(value)) {
      hits += 1;
    }
  });
  return hits / querySet.size;
}

function metricProximityScore(currentMetrics, candidateMetrics) {
  const sharedKeys = Object.keys(currentMetrics || {}).filter((key) => (
    typeof candidateMetrics[key] === 'number' && Number.isFinite(candidateMetrics[key])
  ));
  if (sharedKeys.length === 0) {
    return null;
  }
  const total = sharedKeys.reduce((sum, key) => {
    const a = currentMetrics[key];
    const b = candidateMetrics[key];
    const denominator = Math.abs(a) + Math.abs(b);
    if (denominator === 0) {
      return sum + 1;
    }
    return sum + Math.max(0, 1 - Math.abs(a - b) / denominator);
  }, 0);
  return total / sharedKeys.length;
}

function recencyScore(timestamp, now) {
  if (!Number.isFinite(timestamp)) {
    return 0.25;
  }
  const ageDays = Math.max(0, (now - timestamp) / DAY_MS);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

function temporalScore({ temporal, timestamp, ordinal, total, now }) {
  const cue = temporal && temporal.cue;
  if (!cue) {
    return null;
  }

  // ordinal: 0 = oldest ... total-1 = newest
  const spread = total > 1 ? (total - 1) : 1;
  const oldestRank = total > 1 ? 1 - (ordinal / spread) : 1;
  const newestRank = total > 1 ? ordinal / spread : 1;

  if (cue === 'oldest') {
    return ordinal === 0 ? 1 : oldestRank * 0.7;
  }
  if (cue === 'newest') {
    return ordinal === total - 1 ? 1 : newestRank * 0.7;
  }
  if (cue === 'span') {
    // Both ends of the timeline matter for "have I improved since ...".
    return Math.max(oldestRank, newestRank) * 0.9;
  }
  if (cue === 'window' && temporal.window) {
    if (!Number.isFinite(timestamp)) {
      return 0.1;
    }
    const { start, end } = temporal.window;
    if (timestamp >= start && timestamp <= end) {
      return 1;
    }
    const distance = timestamp < start ? start - timestamp : timestamp - end;
    const span = Math.max(end - start, 7 * DAY_MS);
    return Math.max(0, 1 - distance / span) * 0.8;
  }
  return null;
}

const BASE_WEIGHTS = {
  fault: 0.30,
  lexical: 0.13,
  phase: 0.09,
  metric: 0.10,
  temporal: 0.34,
  recency: 0.15,
};

function resolveWeights({ hasTemporalCue }) {
  const weights = { ...BASE_WEIGHTS };
  if (hasTemporalCue) {
    // An explicit temporal cue means "newest" is an assumption, not an answer.
    weights.recency = 0.06;
  } else {
    weights.temporal = 0;
    weights.recency = 0.40;
  }
  return weights;
}

/**
 * Score one candidate (swing or turn) against the analyzed query.
 * Signals that are not applicable are dropped and the remaining weights
 * are renormalized, so scores stay comparable across candidates.
 */
function scoreRelevance({
  query,
  candidate,
  currentSwing = null,
  corpusStats = null,
  now = Date.now(),
  ordinal = 0,
  total = 1,
  weights = null,
} = {}) {
  const activeQuery = query && query.tokenSet ? query : analyzeQuery({ question: typeof query === 'string' ? query : '' });
  const resolvedWeights = weights || resolveWeights({ hasTemporalCue: Boolean(activeQuery.temporal && activeQuery.temporal.cue) });

  const text = candidate && candidate.searchText !== undefined
    ? candidate.searchText
    : buildSwingSearchText(candidate);
  const docTokens = candidate && candidate.tokens ? candidate.tokens : tokenize(text);
  const docTokenSet = new Set(docTokens);
  const docFaults = candidate && candidate.faults ? candidate.faults : extractFaults(text);
  const docPhases = candidate && candidate.phases ? candidate.phases : extractPhases(text);
  const timestamp = candidate && candidate.timestamp !== undefined
    ? candidate.timestamp
    : toTimestamp(getCapturedAt(candidate));

  const signals = {};
  const reasons = [];

  if (activeQuery.faultSet.size > 0) {
    const value = setOverlapScore(activeQuery.faultSet, new Set(docFaults));
    signals.fault = value;
    if (value > 0) {
      const shared = activeQuery.faults.filter((fault) => docFaults.includes(fault));
      reasons.push(`fault match: ${shared.map((key) => (FAULT_VOCABULARY[key] ? FAULT_VOCABULARY[key].label : key)).join(', ')}`);
    }
  }

  if (activeQuery.tokens.length > 0) {
    signals.lexical = lexicalScore(activeQuery.tokens, docTokenSet, corpusStats);
  }

  if (activeQuery.phaseSet.size > 0) {
    const value = setOverlapScore(activeQuery.phaseSet, new Set(docPhases));
    signals.phase = value;
    if (value > 0) {
      const shared = activeQuery.phases.filter((phase) => docPhases.includes(phase));
      reasons.push(`phase match: ${shared.join(', ')}`);
    }
  }

  if (currentSwing && candidate && candidate.kind !== 'turn') {
    const proximity = metricProximityScore(getMetrics(currentSwing), getMetrics(candidate));
    if (proximity !== null) {
      signals.metric = proximity;
      if (proximity > 0.85) {
        reasons.push('metrics close to the current swing');
      }
    }
  }

  const temporal = temporalScore({
    temporal: activeQuery.temporal,
    timestamp,
    ordinal,
    total,
    now,
  });
  if (temporal !== null) {
    signals.temporal = temporal;
    if (temporal >= 0.9) {
      reasons.push(`temporal cue "${activeQuery.temporal.matched[0] || activeQuery.temporal.cue}" points here`);
    }
  }

  signals.recency = recencyScore(timestamp, now);

  let weightedSum = 0;
  let weightTotal = 0;
  Object.entries(signals).forEach(([key, value]) => {
    const weight = resolvedWeights[key] || 0;
    if (weight <= 0) {
      return;
    }
    weightedSum += weight * value;
    weightTotal += weight;
  });

  const score = weightTotal > 0 ? weightedSum / weightTotal : 0;

  if (reasons.length === 0) {
    if (signals.recency >= 0.8) {
      reasons.push('most recent work');
    } else {
      reasons.push('general history');
    }
  }

  return {
    score: Number(score.toFixed(6)),
    signals,
    reasons,
    weights: resolvedWeights,
  };
}

// ---------------------------------------------------------------------------
// Candidate preparation
// ---------------------------------------------------------------------------

function prepareSwingCandidates(swings, { excludeAnalysisId } = {}) {
  const list = Array.isArray(swings) ? swings.filter((s) => s && typeof s === 'object') : [];
  const filtered = excludeAnalysisId
    ? list.filter((swing) => getAnalysisId(swing) !== excludeAnalysisId)
    : list;

  const prepared = filtered.map((swing) => {
    const searchText = buildSwingSearchText(swing);
    return {
      kind: 'swing',
      swing,
      analysisId: getAnalysisId(swing),
      capturedAt: getCapturedAt(swing),
      timestamp: toTimestamp(getCapturedAt(swing)),
      searchText,
      tokens: tokenize(searchText),
      faults: extractFaults(searchText),
      phases: extractPhases(searchText),
      metrics: getMetrics(swing),
      observations: getVisualObservations(swing),
    };
  });

  // Oldest first so ordinal 0 == oldest on record.
  prepared.sort((a, b) => {
    const at = Number.isFinite(a.timestamp) ? a.timestamp : 0;
    const bt = Number.isFinite(b.timestamp) ? b.timestamp : 0;
    return at - bt;
  });
  prepared.forEach((candidate, index) => {
    candidate.ordinal = index;
  });
  return prepared;
}

function prepareTurnCandidates(chatTurns, { liveWindowTurns }) {
  const list = Array.isArray(chatTurns) ? chatTurns.filter((t) => t && typeof t === 'object') : [];
  const total = list.length;
  const windowSize = Number.isFinite(liveWindowTurns) ? liveWindowTurns : DEFAULT_LIVE_WINDOW_TURNS;

  const prepared = list.map((turn, index) => {
    const searchText = getTurnText(turn);
    return {
      kind: 'turn',
      turn,
      index,
      role: typeof turn.role === 'string' ? turn.role : 'user',
      capturedAt: getTurnTimestamp(turn),
      timestamp: toTimestamp(getTurnTimestamp(turn)),
      searchText,
      tokens: tokenize(searchText),
      faults: extractFaults(searchText),
      phases: extractPhases(searchText),
      // Turns already inside the live chat window are redundant with the prompt.
      alreadyInPrompt: index >= total - windowSize,
    };
  });

  prepared.sort((a, b) => {
    const at = Number.isFinite(a.timestamp) ? a.timestamp : a.index;
    const bt = Number.isFinite(b.timestamp) ? b.timestamp : b.index;
    return at - bt;
  });
  prepared.forEach((candidate, index) => {
    candidate.ordinal = index;
  });
  return prepared;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function positionLabel(candidate, total) {
  if (total <= 1) {
    return 'only_swing_on_record';
  }
  if (candidate.ordinal === 0) {
    return 'oldest_on_record';
  }
  if (candidate.ordinal === total - 1) {
    return 'most_recent_on_record';
  }
  return `swing_${candidate.ordinal + 1}_of_${total}`;
}

function ageDays(timestamp, now) {
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.max(0, Math.round((now - timestamp) / DAY_MS));
}

function pickObservations(candidate, query) {
  const scored = candidate.observations
    .filter((obs) => typeof obs.observation === 'string' && obs.observation.trim())
    .map((obs) => {
      const faults = extractFaults(obs.observation);
      const phase = typeof obs.phase === 'string' ? obs.phase : 'swing_general';
      let relevance = 0;
      faults.forEach((fault) => {
        if (query.faultSet.has(fault)) {
          relevance += 2;
        }
      });
      if (query.phaseSet.has(phase)) {
        relevance += 1;
      }
      if (typeof obs.confidence === 'number') {
        relevance += obs.confidence * 0.5;
      }
      return { obs, phase, relevance };
    });

  scored.sort((a, b) => b.relevance - a.relevance);

  return scored.slice(0, MAX_OBSERVATIONS_PER_SWING).map(({ obs, phase }) => ({
    phase,
    observation: obs.observation.trim().slice(0, OBSERVATION_CHAR_LIMIT),
    impact: typeof obs.impact === 'string' ? obs.impact : null,
    confidence: typeof obs.confidence === 'number' ? obs.confidence : null,
  }));
}

function limitMetrics(metrics) {
  const entries = Object.entries(metrics || {}).slice(0, 6);
  if (entries.length === 0) {
    return null;
  }
  return Object.fromEntries(entries);
}

function renderSwingEntry(candidate, scoreInfo, query, now, total) {
  return {
    analysisId: candidate.analysisId,
    capturedAt: candidate.capturedAt,
    age_days: ageDays(candidate.timestamp, now),
    timeline_position: positionLabel(candidate, total),
    faults_detected: candidate.faults.map((key) => (FAULT_VOCABULARY[key] ? FAULT_VOCABULARY[key].label : key)).slice(0, 5),
    observations: pickObservations(candidate, query),
    metrics: limitMetrics(candidate.metrics),
    retrieved_because: scoreInfo.reasons.slice(0, 3),
    relevance: Number(scoreInfo.score.toFixed(3)),
  };
}

function renderTurnEntry(candidate, scoreInfo) {
  return {
    when: candidate.capturedAt,
    role: candidate.role,
    text: candidate.searchText.trim().slice(0, TURN_CHAR_LIMIT),
    retrieved_because: scoreInfo.reasons.slice(0, 2),
    relevance: Number(scoreInfo.score.toFixed(3)),
  };
}

const CONTEXT_RULES = [
  'These items were selected by relevance to the current question, NOT by recency. Check capturedAt/age_days before calling anything "your latest swing".',
  'Use them as factual history: what was observed, when, and what changed since.',
  'Do not reuse or imitate prior coaching wording. Describe the change in your own words.',
  'If a retrieved swing does not actually answer the question, say so instead of forcing a comparison.',
];

// Fixed cost of the JSON envelope (keys, rules, span header) that wraps the
// selected items. Subtracted from budgetTokens so the RENDERED string — not just
// the item list — respects the caller's budget.
const ENVELOPE_TOKEN_RESERVE = estimateTokens(JSON.stringify({
  retrieved_history: {
    selection_basis: 'query-aware relevance retrieval (lexical/structural, recency is one signal among several)',
    query_faults: ['aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa'],
    query_phases: ['aaaaaaaaaa'],
    temporal_cue: 'aaaaaaaa',
    history_span: {
      swings_available: 0,
      oldest_captured_at: '2026-01-01T00:00:00.000Z',
      newest_captured_at: '2026-01-01T00:00:00.000Z',
    },
    swings: [],
    conversation_excerpts: [],
    rules: CONTEXT_RULES,
  },
}));

/**
 * Render the selection as a compact JSON string for injection as developer context.
 * mode 'analysis' strips ALL prior coaching prose (conversation excerpts) to preserve
 * the Feb 2026 anti-template-poisoning guarantee at analysis time.
 */
function renderRetrievedContext(selection, { mode = 'chat', format = 'json' } = {}) {
  const safeSelection = selection && typeof selection === 'object' ? selection : {};
  const rationale = safeSelection.rationale || {};
  const rendered = rationale.rendered || {};

  const payload = {
    retrieved_history: {
      selection_basis: 'query-aware relevance retrieval (lexical/structural, recency is one signal among several)',
      query_faults: rationale.queryFaults || [],
      query_phases: rationale.queryPhases || [],
      temporal_cue: (rationale.temporal && rationale.temporal.cue) || null,
      history_span: rationale.historySpan || null,
      swings: Array.isArray(rendered.swings) ? rendered.swings : [],
      conversation_excerpts: mode === 'analysis'
        ? []
        : (Array.isArray(rendered.turns) ? rendered.turns : []),
      rules: CONTEXT_RULES,
    },
  };

  if (!payload.retrieved_history.swings.length && !payload.retrieved_history.conversation_excerpts.length) {
    payload.retrieved_history.note = 'No prior coaching history available for this player yet.';
  }

  if (format === 'text') {
    const lines = [];
    lines.push('Retrieved coaching history (selected by relevance, not recency):');
    payload.retrieved_history.swings.forEach((swing) => {
      lines.push(`- ${swing.analysisId} | ${swing.capturedAt || 'unknown date'} | ${swing.timeline_position} | ${swing.faults_detected.join(', ') || 'no named faults'} | why: ${swing.retrieved_because.join('; ')}`);
      swing.observations.forEach((obs) => lines.push(`    [${obs.phase}] ${obs.observation}`));
    });
    payload.retrieved_history.conversation_excerpts.forEach((turn) => {
      lines.push(`- (${turn.role} @ ${turn.when || 'unknown'}) ${turn.text}`);
    });
    if (!payload.retrieved_history.swings.length && !payload.retrieved_history.conversation_excerpts.length) {
      lines.push('- none available');
    }
    CONTEXT_RULES.forEach((rule) => lines.push(`* ${rule}`));
    return lines.join('\n');
  }

  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {string} [input.question] player's current message
 * @param {object} [input.currentSwing] swing being discussed/analyzed (excluded from results)
 * @param {Array} [input.swings] ALL available past swings (swingRepository shape)
 * @param {Array} [input.chatTurns] chat_history turns (chatRepository shape)
 * @param {object} [input.swingProfile] swingProfileRepository profile record
 * @param {number} [input.budgetTokens=1200]
 * @returns {{selectedSwings: Array, selectedTurns: Array, rationale: object}}
 */
function selectRelevantHistory({
  question = '',
  currentSwing = null,
  swings = [],
  chatTurns = [],
  swingProfile = null,
  budgetTokens = DEFAULT_BUDGET_TOKENS,
  maxSwings = DEFAULT_MAX_SWINGS,
  maxTurns = DEFAULT_MAX_TURNS,
  liveWindowTurns = DEFAULT_LIVE_WINDOW_TURNS,
  now = Date.now(),
} = {}) {
  const budget = Number.isFinite(budgetTokens) && budgetTokens > 0 ? budgetTokens : DEFAULT_BUDGET_TOKENS;
  const query = analyzeQuery({ question, currentSwing, swingProfile, now });
  const weights = resolveWeights({ hasTemporalCue: Boolean(query.temporal.cue) });

  const swingCandidates = prepareSwingCandidates(swings, {
    excludeAnalysisId: getAnalysisId(currentSwing),
  });
  const turnCandidates = prepareTurnCandidates(chatTurns, { liveWindowTurns });

  const corpusStats = buildCorpusStats(
    swingCandidates.map((c) => c.tokens).concat(turnCandidates.map((c) => c.tokens))
  );

  const totalSwings = swingCandidates.length;
  const scoredSwings = swingCandidates.map((candidate) => {
    const scoreInfo = scoreRelevance({
      query,
      candidate,
      currentSwing,
      corpusStats,
      now,
      ordinal: candidate.ordinal,
      total: totalSwings,
      weights,
    });
    return { candidate, scoreInfo };
  });

  const totalTurns = turnCandidates.length;
  const scoredTurns = turnCandidates.map((candidate) => {
    const scoreInfo = scoreRelevance({
      query,
      candidate,
      currentSwing: null,
      corpusStats,
      now,
      ordinal: candidate.ordinal,
      total: totalTurns,
      weights,
    });
    // Turns already inside the live chat window are redundant with the prompt.
    const adjusted = candidate.alreadyInPrompt ? scoreInfo.score * 0.35 : scoreInfo.score;
    return {
      candidate,
      scoreInfo: { ...scoreInfo, score: Number(adjusted.toFixed(6)), rawScore: scoreInfo.score },
    };
  });

  const byScore = (a, b) => {
    if (b.scoreInfo.score !== a.scoreInfo.score) {
      return b.scoreInfo.score - a.scoreInfo.score;
    }
    const at = Number.isFinite(a.candidate.timestamp) ? a.candidate.timestamp : 0;
    const bt = Number.isFinite(b.candidate.timestamp) ? b.candidate.timestamp : 0;
    return bt - at;
  };

  const rankedSwings = scoredSwings.slice().sort(byScore);
  const rankedTurns = scoredTurns
    .slice()
    .filter((entry) => entry.scoreInfo.score > 0)
    .sort(byScore);

  // --- budget packing -------------------------------------------------------
  // Reserve the envelope cost so the rendered string honours budgetTokens.
  const packBudget = Math.max(40, budget - ENVELOPE_TOKEN_RESERVE);
  const swingBudget = Math.floor(packBudget * SWING_BUDGET_SHARE);
  const selectedSwings = [];
  const renderedSwings = [];
  let usedSwingTokens = 0;
  let droppedSwings = 0;

  rankedSwings.slice(0, maxSwings).forEach((entry, index) => {
    const rendered = renderSwingEntry(entry.candidate, entry.scoreInfo, query, now, totalSwings);
    const cost = estimateTokens(JSON.stringify(rendered));
    const mustKeep = index === 0; // never return empty-handed when history exists
    if (!mustKeep && usedSwingTokens + cost > swingBudget) {
      droppedSwings += 1;
      return;
    }
    usedSwingTokens += cost;
    renderedSwings.push(rendered);
    selectedSwings.push({
      ...entry.candidate.swing,
      relevance: {
        score: entry.scoreInfo.score,
        signals: entry.scoreInfo.signals,
        reasons: entry.scoreInfo.reasons,
        timelinePosition: rendered.timeline_position,
      },
    });
  });
  droppedSwings += Math.max(0, rankedSwings.length - maxSwings);

  const turnBudget = Math.max(0, packBudget - usedSwingTokens);
  const selectedTurns = [];
  const renderedTurns = [];
  let usedTurnTokens = 0;
  let droppedTurns = 0;

  rankedTurns.slice(0, maxTurns).forEach((entry) => {
    const rendered = renderTurnEntry(entry.candidate, entry.scoreInfo);
    const cost = estimateTokens(JSON.stringify(rendered));
    if (usedTurnTokens + cost > turnBudget) {
      droppedTurns += 1;
      return;
    }
    usedTurnTokens += cost;
    renderedTurns.push(rendered);
    selectedTurns.push({
      ...entry.candidate.turn,
      relevance: {
        score: entry.scoreInfo.score,
        signals: entry.scoreInfo.signals,
        reasons: entry.scoreInfo.reasons,
        alreadyInPrompt: entry.candidate.alreadyInPrompt,
      },
    });
  });
  droppedTurns += Math.max(0, rankedTurns.length - maxTurns);

  const oldest = swingCandidates[0];
  const newest = swingCandidates[swingCandidates.length - 1];

  const rationale = {
    strategy: query.temporal.cue ? `temporal:${query.temporal.cue}` : (query.faults.length > 0 ? 'fault-match' : 'recency-dominant'),
    queryFaults: query.faults.map((key) => (FAULT_VOCABULARY[key] ? FAULT_VOCABULARY[key].label : key)),
    queryFaultKeys: query.faults,
    queryPhases: query.phases,
    temporal: query.temporal,
    usedFallbackText: query.usedFallbackText,
    weights,
    historySpan: swingCandidates.length > 0
      ? {
          swings_available: swingCandidates.length,
          oldest_captured_at: oldest ? oldest.capturedAt : null,
          newest_captured_at: newest ? newest.capturedAt : null,
        }
      : null,
    candidatesConsidered: {
      swings: swingCandidates.length,
      turns: turnCandidates.length,
    },
    scoredSwings: rankedSwings.map((entry) => ({
      analysisId: entry.candidate.analysisId,
      capturedAt: entry.candidate.capturedAt,
      score: entry.scoreInfo.score,
      signals: entry.scoreInfo.signals,
      reasons: entry.scoreInfo.reasons,
    })),
    budget: {
      budgetTokens: budget,
      envelopeReserveTokens: ENVELOPE_TOKEN_RESERVE,
      usedTokens: usedSwingTokens + usedTurnTokens,
      renderedTokensEstimate: usedSwingTokens + usedTurnTokens + ENVELOPE_TOKEN_RESERVE,
      swingTokens: usedSwingTokens,
      turnTokens: usedTurnTokens,
      droppedSwings,
      droppedTurns,
      truncated: droppedSwings > 0 || droppedTurns > 0,
    },
    rendered: {
      swings: renderedSwings,
      turns: renderedTurns,
    },
    empty: swingCandidates.length === 0 && turnCandidates.length === 0,
  };

  return { selectedSwings, selectedTurns, rationale };
}

module.exports = {
  // primary API
  selectRelevantHistory,
  renderRetrievedContext,
  scoreRelevance,
  // supporting API (useful for harnesses / debugging)
  analyzeQuery,
  detectTemporalCue,
  extractFaults,
  extractPhases,
  estimateTokens,
  FAULT_VOCABULARY,
  PHASE_VOCABULARY,
  DEFAULT_BUDGET_TOKENS,
  ENVELOPE_TOKEN_RESERVE,
  __private: {
    tokenize,
    buildSwingSearchText,
    prepareSwingCandidates,
    prepareTurnCandidates,
    buildCorpusStats,
    lexicalScore,
    metricProximityScore,
    recencyScore,
    temporalScore,
    resolveWeights,
  },
};
