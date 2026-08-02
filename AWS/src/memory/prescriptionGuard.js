'use strict';

// Prescription-verification guard.
//
// VENDORED from the `combined` memory challenger (claude/memory-combined ->
// AWS/src/memory/combinedMemory.js). The four-way memory evaluation
// (docs/memory-architecture-decision-2026-08-02.md) rejected that module's
// change-detection layer wholesale — its severity scoring, `since_then` and
// `trend` fields fabricated "improved" by comparing a hardcoded 0.6 default
// against the mere absence of a fault. What survived the evaluation, at 2/2 on
// false premises with zero false positives across the other six probes, was
// this guard: detect that the player asserted prior advice, canonicalize the
// claim, look for the advice in the record, and hand the model a verdict.
//
// Differences from the original:
//   * The ledger dependency is gone. Evidence is read straight off the swing
//     records, chat turns and swing profile. Nothing numeric is computed —
//     no severity, no trend, no graded change of any kind.
//   * FAULT_TAGS is vendored as a KEYWORD TAXONOMY only (the tag/keyword table
//     from coachingLedger). None of the ledger's scoring travels with it.
//
// Prose handling: coaching prose (assistant turns, session summaries, cue text)
// is READ here to classify a claim. Only tags, dates and ids leave this module —
// never the prose itself. That preserves the Feb 2026 anti-template-poisoning
// rule when the verdict is rendered into model context.

const retrieval = require('./relevanceRetrieval');

const CLAIM_CHAR_LIMIT = 90;
const MAX_EVIDENCE_ITEMS = 4;

// ---------------------------------------------------------------------------
// Canonical tag space (keyword taxonomy, vendored from coachingLedger)
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

// ---------------------------------------------------------------------------
// Prescription lexicon
// ---------------------------------------------------------------------------
// Both parent modules describe FAULTS ("early extension", "overswing"). A player
// asserting prior advice describes an INSTRUCTION ("you told me to shorten my
// backswing"). Neither fault vocabulary matches that phrasing, so the guard
// carries its own imperative lexicon and maps it onto the canonical tag space.

const PRESCRIPTION_LEXICON = {
  backswing_length: [
    'shorten backswing', 'shorter backswing', 'shorten swing', 'shorten it up',
    'shorten arm swing', 'stop overswinging', 'stop over swinging', 'not go past parallel',
    'three quarter backswing', 'three-quarter backswing', 'compact backswing',
    'make backswing shorter', 'lengthen backswing', 'longer backswing', 'wider backswing',
  ],
  early_extension: [
    'stay in posture', 'hold posture', 'keep posture', 'maintain posture',
    'keep spine angle', 'hold spine angle', 'stop standing up', 'stay down',
    'keep hips back', 'sit into it', 'stop early extension',
  ],
  casting: [
    'stop casting', 'stop flipping', 'hold angle', 'hold lag', 'stop scooping',
    'keep wrist angle longer', 'release later',
  ],
  over_the_top: [
    'stop coming over top', 'stop going over top', 'drop it inside', 'drop club inside',
    'swing from inside', 'shallow shaft', 'shallow it out', 'stop cutting across',
    'flatten downswing',
  ],
  lag_wrist_angle: [
    'flat lead wrist', 'bow wrist', 'bow lead wrist', 'flatten wrist', 'set wrists earlier',
    'stop cupping wrist',
  ],
  weight_shift: [
    'shift weight', 'get weight forward', 'move pressure forward', 'pressure into lead side',
    'stop hanging back', 'finish on front foot', 'transfer weight',
  ],
  body_rotation: [
    'rotate through', 'clear hips', 'turn through', 'keep turning', 'stop stalling',
    'more shoulder turn', 'more hip turn', 'open hips through impact',
  ],
  head_movement: [
    'keep head still', 'keep head down', 'stop head moving', 'quiet head', 'stop lifting head',
  ],
  setup_alignment: [
    'ball position', 'move ball back', 'move ball forward', 'widen stance', 'narrow stance',
    'check alignment', 'square up feet', 'fix aim', 'stand closer', 'stand further away',
  ],
  grip: [
    'strengthen grip', 'weaken grip', 'change grip', 'fix grip', 'neutral grip',
    'lighten grip pressure', 'soften grip',
  ],
  tempo: [
    'slow down', 'slow tempo', 'smoother tempo', 'smooth it out', 'stop rushing',
    'count to three', 'even tempo', 'slower transition',
  ],
  takeaway: [
    'one piece takeaway', 'low and slow', 'keep club outside hands', 'keep club in front',
    'wider takeaway',
  ],
  lateral_sway: [
    'stop swaying', 'turn dont sway', 'stay centered', 'stop sliding off ball',
    'keep weight inside trail foot',
  ],
  path_in_to_out: [
    'swing more in to out', 'swing more inside out', 'stop getting stuck', 'get club out in front',
  ],
  face_control: [
    'square face', 'close face', 'stop leaving face open', 'control face', 'rotate face through',
  ],
  chicken_wing: [
    'extend through impact', 'stop chicken winging', 'keep lead arm straight',
    'stop lead arm breaking down',
  ],
  low_point: [
    'hit ball first', 'ball first contact', 'compress ball', 'move low point forward',
    'stop hitting it fat', 'stop hitting behind ball',
  ],
  impact_position: [
    'hands ahead at impact', 'forward shaft lean', 'lean shaft forward', 'stop flipping at impact',
  ],
  balance_finish: [
    'finish in balance', 'hold finish', 'stop falling back', 'balanced finish',
  ],
  reverse_pivot: [
    'stop reverse pivot', 'stop leaning toward target at top', 'fix reverse pivot',
  ],
  swing_plane: [
    'stay on plane', 'get on plane', 'flatten plane', 'steepen plane',
  ],
};

// relevanceRetrieval fault key -> canonical tag. Where the taxonomies disagree,
// the canonical tag wins because evidence is keyed by it.
const RETRIEVAL_TO_CANONICAL_TAG = {
  early_extension: 'early_extension',
  casting: 'casting',
  over_the_top: 'over_the_top',
  sway: 'lateral_sway',
  slide: 'lateral_sway',
  chicken_wing: 'chicken_wing',
  reverse_pivot: 'reverse_pivot',
  hanging_back: 'weight_shift',
  over_swing: 'backswing_length',
  flat_shoulder_plane: 'swing_plane',
  steep_shaft: 'over_the_top',
  shallow_shaft: 'path_in_to_out',
  laid_off: 'backswing_length',
  across_the_line: 'backswing_length',
  cupped_wrist: 'lag_wrist_angle',
  bowed_wrist: 'lag_wrist_angle',
  grip: 'grip',
  head_movement: 'head_movement',
  stalled_rotation: 'body_rotation',
  tempo: 'tempo',
  setup_posture: 'setup_alignment',
  alignment: 'setup_alignment',
  face_control: 'face_control',
  contact: 'low_point',
  ball_flight: null,
};

const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'my', 'your', 'his', 'her', 'their', 'our', 'that', 'this',
  'to', 'of', 'is', 'was', 'be', 'been', 'am', 'i', 'me', 'we', 'you', 'and',
  'on', 'at', 'in', 'it', 'so', 'do', 'does', 'did', 'more', 'some', 'just',
  'really', 'kind', 'sort', 'bit', 'little', 'lot',
]);

function normalizePhrase(input) {
  if (typeof input !== 'string') {
    return '';
  }
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/'/g, '')
    .split(/[\s\-]+/)
    .filter((word) => word && !FILLER_WORDS.has(word))
    .join(' ')
    .trim();
}

const NORMALIZED_PRESCRIPTIONS = Object.entries(PRESCRIPTION_LEXICON).map(([tag, phrases]) => ({
  tag,
  phrases: phrases.map((phrase) => normalizePhrase(phrase)).filter(Boolean),
}));

function humanizeTag(tag) {
  return typeof tag === 'string' ? tag.replace(/_/g, ' ') : null;
}

// ---------------------------------------------------------------------------
// Assertion detection
// ---------------------------------------------------------------------------

const NEGATED_TRIGGER = /\byou\s+(?:never|have\s+never|had\s+never)\s+(?:told|said|asked|mentioned|had)\b/i;

const ASSERTION_TRIGGERS = [
  // Direct question forms first — they are more specific than the assertion
  // forms and would otherwise be swallowed by them.
  { form: 'direct_question', re: /\b(?:did|have)\s+you\s+ever\s+(?:tell|told|say|said)\s+(?:me\s+)?(?:that\s+)?(?:to\s+)?(?:i\s+(?:had|have|was|am|were)\s+)?(.+)/i },
  { form: 'direct_question', re: /\bdid(?:n'?t)?\s+you\s+(?:tell|ask)\s+me\s+(?:to\s+)?(?:that\s+)?(?:i\s+(?:had|have|was|should)\s+)?(.+)/i },
  { form: 'direct_question', re: /\bdid(?:n'?t)?\s+you\s+say\s+(?:that\s+)?(?:i\s+(?:had|have|was|should)\s+)?(.+)/i },
  { form: 'direct_question', re: /\bhave\s+(?:we|i)\s+ever\s+worked\s+on\s+(.+)/i },
  // Embedded assertions — the failure mode the evaluation found.
  { form: 'embedded_assertion', re: /\byou\s+(?:told|asked)\s+me\s+(?:to\s+)?(?:that\s+)?(?:i\s+(?:should|need\s+to|had\s+to|have\s+to|was|were)\s+)?(.+)/i },
  { form: 'embedded_assertion', re: /\byou\s+said\s+(?:that\s+)?(?:i\s+(?:should|need\s+to|had\s+to|have\s+to|was|am|were)\s+)?(.+)/i },
  { form: 'embedded_assertion', re: /\byou\s+had\s+me\s+(?:working\s+on|work\s+on|doing|do|focus(?:ing)?\s+on)\s+(.+)/i },
  { form: 'embedded_assertion', re: /\byou\s+wanted\s+me\s+to\s+(.+)/i },
  { form: 'embedded_assertion', re: /\byou\s+(?:suggested|recommended|prescribed|advised|mentioned)\s+(?:that\s+)?(?:i\s+(?:should|need\s+to)\s+)?(.+)/i },
  { form: 'embedded_assertion', re: /\byou(?:'ve|\s+have)\s+(?:been\s+)?(?:telling|having)\s+me\s+(?:to\s+)?(.+)/i },
  { form: 'embedded_assertion', re: /\bwe(?:'ve|\s+have)\s+been\s+working\s+on\s+(.+)/i },
  { form: 'embedded_assertion', re: /\byour\s+(?:advice|instruction|tip|cue|note)\s+(?:to|about|on|was)\s+(.+)/i },
  { form: 'embedded_assertion', re: /\b(?:like|as)\s+you\s+(?:said|told\s+me|suggested)[,:]?\s*(?:to\s+)?(.+)/i },
  { form: 'embedded_assertion', re: /\bper\s+your\s+advice[,:]?\s*(?:to\s+)?(.+)/i },
  { form: 'embedded_assertion', re: /\bsince\s+you\s+(?:told|asked)\s+me\s+to\s+(.+)/i },
];

const CLAUSE_STOP = /\s*(?:[,;.!?–—]|\s-\s|\bbut\b|\bhowever\b|\band\s+now\b|\bso\s+now\b|\bnow\s+(?:i|you)\b|\band\s+i\b|\bwhy\b|\byet\b|\bthough\b|\bis\s+that\s+still\b)/i;

function firstClause(text) {
  if (typeof text !== 'string') {
    return '';
  }
  const match = text.match(CLAUSE_STOP);
  const clause = match ? text.slice(0, match.index) : text;
  return clause.trim().replace(/\s+/g, ' ').slice(0, CLAIM_CHAR_LIMIT);
}

/**
 * Find the strongest prior-advice assertion in the player's message.
 * @returns {{claim: string, form: string, trigger: string}|null}
 */
function detectAssertion(question) {
  const text = typeof question === 'string' ? question.trim() : '';
  if (!text) {
    return null;
  }

  const negated = NEGATED_TRIGGER.test(text);

  for (let index = 0; index < ASSERTION_TRIGGERS.length; index += 1) {
    const { re, form } = ASSERTION_TRIGGERS[index];
    const match = text.match(re);
    if (match && match[1]) {
      const claim = firstClause(match[1]);
      if (claim.length >= 3) {
        return {
          claim,
          form: negated ? 'negated_assertion' : form,
          trigger: match[0].slice(0, match[0].length - match[1].length).trim(),
        };
      }
    }
  }

  if (negated) {
    const tail = text.slice(text.search(NEGATED_TRIGGER)).replace(NEGATED_TRIGGER, '');
    const claim = firstClause(tail.replace(/^\s*(?:me\s+)?(?:to\s+)?(?:that\s+)?/i, ''));
    if (claim.length >= 3) {
      return { claim, form: 'negated_assertion', trigger: 'you never told me' };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

/** Keyword scan over the canonical taxonomy. */
function matchCanonicalTag(text) {
  const haystack = typeof text === 'string' ? text.toLowerCase() : '';
  if (!haystack) {
    return null;
  }
  let best = null;
  FAULT_TAGS.forEach((entry) => {
    let score = 0;
    entry.keywords.forEach((keyword) => {
      if (haystack.includes(keyword)) {
        score += keyword.length;
      }
    });
    if (score > 0 && (!best || score > best.score)) {
      best = { tag: entry.tag, score };
    }
  });
  return best ? best.tag : null;
}

/** Prescription-lexicon scan (imperative phrasings), normalization-insensitive. */
function matchPrescriptionTag(text) {
  const normalized = normalizePhrase(text);
  if (!normalized) {
    return null;
  }
  let best = null;
  NORMALIZED_PRESCRIPTIONS.forEach(({ tag, phrases }) => {
    phrases.forEach((phrase) => {
      if (phrase && normalized.includes(phrase)) {
        if (!best || phrase.length > best.length) {
          best = { tag, phrase, length: phrase.length };
        }
      }
    });
  });
  return best;
}

/**
 * Map a free-text claim onto a canonical tag.
 * @returns {{canonical: string|null, matchedPhrase: string|null, source: string}}
 */
function canonicalizeClaim(claim) {
  const prescription = matchPrescriptionTag(claim);
  if (prescription) {
    return { canonical: prescription.tag, matchedPhrase: prescription.phrase, source: 'prescription_lexicon' };
  }

  const taxonomyTag = matchCanonicalTag(claim);
  if (taxonomyTag) {
    return { canonical: taxonomyTag, matchedPhrase: null, source: 'fault_taxonomy' };
  }

  const faults = retrieval.extractFaults(claim);
  for (let index = 0; index < faults.length; index += 1) {
    const mapped = RETRIEVAL_TO_CANONICAL_TAG[faults[index]];
    if (mapped) {
      return { canonical: mapped, matchedPhrase: null, source: 'retrieval_vocabulary' };
    }
  }

  return { canonical: null, matchedPhrase: null, source: 'unmatched' };
}

// ---------------------------------------------------------------------------
// Record readers (no ledger, no scoring)
// ---------------------------------------------------------------------------

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toTimestamp(value) {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDate(value) {
  const timestamp = toTimestamp(value);
  return timestamp === null ? null : new Date(timestamp).toISOString().slice(0, 10);
}

function getAnalysisId(swing) {
  return (swing && (swing.analysisId || swing.analysis_id)) || null;
}

function getCapturedAt(swing) {
  if (!swing || typeof swing !== 'object') {
    return null;
  }
  return swing.capturedAt || swing.captured_at || swing.createdAt || swing.created_at || null;
}

/** Advice handed to the player: drills, focus areas, practice recommendations. */
function readCues(swing) {
  const ai = (swing && (swing.aiAnalysis || swing.ai_analysis)) || {};
  const results = (swing && (swing.analysisResults || swing.analysis_results)) || {};
  const candidates = [
    ...asArray(swing && swing.cues),
    ...asArray(ai.practice_recommendations),
    ...asArray(ai.drill_plan),
    ...asArray(ai.focus_areas),
    ...asArray(results && results.focus_areas),
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
    .map((cue) => cue.trim());
}

/** The session's headline fix, if the analysis named one. */
function readPriorityText(swing) {
  const ai = (swing && (swing.aiAnalysis || swing.ai_analysis)) || {};
  const results = (swing && (swing.analysisResults || swing.analysis_results)) || {};
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

/** Observations recorded by the vision pass — noted, but never handed over as advice. */
function readObservationTexts(swing) {
  const ai = (swing && (swing.aiAnalysis || swing.ai_analysis)) || {};
  const list = asArray(swing && swing.visualObservations).length
    ? asArray(swing && swing.visualObservations)
    : asArray(ai.visual_observations);

  return list
    .map((obs) => {
      if (typeof obs === 'string') {
        return obs;
      }
      return obs && typeof obs === 'object' ? obs.observation || obs.text || null : null;
    })
    .filter((text) => typeof text === 'string' && text.trim());
}

/**
 * Search the record for a prescription of `canonical`.
 * Prose is read here; only tags, dates and ids escape.
 */
function findPrescriptionEvidence({ canonical, swings, chatTurns, swingProfile }) {
  const prescribed = [];
  const observed = [];

  if (!canonical) {
    return { prescribed, observed };
  }

  asArray(swings)
    .filter((swing) => swing && typeof swing === 'object')
    .forEach((swing) => {
      const date = toIsoDate(getCapturedAt(swing));
      const analysisId = getAnalysisId(swing);

      const cueHit = readCues(swing).some((cue) => {
        const hit = matchPrescriptionTag(cue);
        return hit && hit.tag === canonical;
      });
      if (cueHit) {
        prescribed.push({ date, swing: analysisId, basis: 'session_cue_text' });
        return;
      }

      const priority = readPriorityText(swing);
      if (priority) {
        const hit = matchPrescriptionTag(priority);
        const tag = (hit && hit.tag) || matchCanonicalTag(priority);
        if (tag === canonical) {
          prescribed.push({ date, swing: analysisId, basis: 'session_priority' });
          return;
        }
      }

      const observedHit = readObservationTexts(swing).some((text) => matchCanonicalTag(text) === canonical);
      if (observedHit) {
        observed.push({ date, swing: analysisId, basis: 'observed_in_analysis' });
      }
    });

  // Assistant chat turns: the most likely place a spoken prescription lives.
  asArray(chatTurns)
    .filter((turn) => turn && typeof turn === 'object')
    .filter((turn) => String(turn.role || '').toLowerCase() === 'assistant')
    .forEach((turn) => {
      const content = typeof turn.content === 'string' ? turn.content : '';
      if (!content) {
        return;
      }
      const hit = matchPrescriptionTag(content);
      if (hit && hit.tag === canonical) {
        prescribed.push({
          date: toIsoDate(turn.timestamp || turn.created_at || turn.createdAt),
          swing: null,
          basis: 'coach_message',
        });
      }
    });

  asArray(swingProfile && swingProfile.focus_areas).forEach((area) => {
    const text = typeof area === 'string' ? area : (area && (area.text || area.title)) || '';
    const hit = matchPrescriptionTag(text);
    const tag = (hit && hit.tag) || matchCanonicalTag(text);
    if (tag === canonical) {
      prescribed.push({
        date: toIsoDate(swingProfile.last_analysis_at) || null,
        swing: swingProfile.last_analysis_id || null,
        basis: 'profile_focus_area',
      });
    }
  });

  const dedupe = (items) => {
    const seen = new Set();
    return items.filter((item) => {
      const key = `${item.basis}|${item.swing || ''}|${item.date || ''}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  };

  return { prescribed: dedupe(prescribed), observed: dedupe(observed) };
}

function describeDates(items) {
  const dates = items.map((item) => item.date).filter(Boolean);
  if (!dates.length) {
    return 'no dated record';
  }
  const unique = Array.from(new Set(dates)).sort();
  if (unique.length === 1) {
    return unique[0];
  }
  return `${unique[0]} through ${unique[unique.length - 1]}`;
}

/**
 * Verify a player's assertion about prior coaching advice against the record.
 *
 * @param {object} input
 * @param {string} input.question    the player's current message
 * @param {Array}  [input.swings]    all available swings (swingRepository shape)
 * @param {Array}  [input.chatTurns] chat_history turns
 * @param {object} [input.swingProfile]
 * @returns {object|null} verdict, or null when the message asserts nothing about history
 */
function verifyAssertedPrescription({
  question = '',
  swings = [],
  chatTurns = [],
  swingProfile = null,
} = {}) {
  const assertion = detectAssertion(question);
  if (!assertion) {
    return null;
  }

  const { canonical, matchedPhrase, source } = canonicalizeClaim(assertion.claim);
  const sessionsChecked = asArray(swings).filter((swing) => swing && typeof swing === 'object').length;
  const messagesChecked = asArray(chatTurns).filter(
    (turn) => turn && String(turn.role || '').toLowerCase() === 'assistant'
  ).length;

  if (!canonical) {
    return {
      asserted: true,
      form: assertion.form,
      claim: assertion.claim,
      canonical: null,
      canonical_label: null,
      found: null,
      observed_only: false,
      matched_via: source,
      matched_phrase: null,
      sessions_checked: sessionsChecked,
      messages_checked: messagesChecked,
      evidence: 'the claim could not be matched to any coaching topic in the record, so it is unverified',
      evidence_items: [],
      instruction: 'This recollection is unverified — it maps to no topic in the stored record. Do not confirm that you gave this advice. Ask what they are referring to, or answer the underlying question without endorsing the memory.',
    };
  }

  const { prescribed, observed } = findPrescriptionEvidence({
    canonical,
    swings,
    chatTurns,
    swingProfile,
  });

  const label = humanizeTag(canonical);
  const found = prescribed.length > 0;
  const observedOnly = !found && observed.length > 0;

  let evidence;
  let instruction;

  if (found) {
    const when = describeDates(prescribed);
    evidence = `prescribed in ${prescribed.length} session/message(s) on ${when} (${Array.from(new Set(prescribed.map((item) => item.basis))).join(', ')})`;
    instruction = assertion.form === 'negated_assertion'
      ? `The record does contain this advice (${when}). The player believes it was never given. Correct that gently and specifically, citing the date.`
      : `The player's recollection is supported by the record. Confirm it and anchor the answer to the dated evidence (${when}), then address the underlying question.`;
  } else if (observedOnly) {
    const when = describeDates(observed);
    evidence = `no session prescribes "${label}"; it appears in analysis observations (first on ${when}) but was never given as advice`;
    instruction = `There is no record of advising this. "${label}" was noted as an observation (${when}) but never prescribed. Do not confirm the advice. Say plainly you have no record of telling them that, note what the record does show, then help with the underlying question.`;
  } else {
    evidence = `no session or coach message in the record prescribes this (${sessionsChecked} session(s), ${messagesChecked} coach message(s) checked)`;
    instruction = assertion.form === 'negated_assertion'
      ? `Correct — the record contains no such advice across ${sessionsChecked} session(s). Confirm the absence rather than inventing a reason.`
      : "The player's recollection is not supported by the record. Do not confirm it. Say plainly you have no record of advising that, then help with the underlying question.";
  }

  return {
    asserted: true,
    form: assertion.form,
    claim: assertion.claim,
    canonical,
    canonical_label: label,
    found,
    observed_only: observedOnly,
    matched_via: source,
    matched_phrase: matchedPhrase,
    sessions_checked: sessionsChecked,
    messages_checked: messagesChecked,
    evidence,
    evidence_items: (found ? prescribed : observed).slice(0, MAX_EVIDENCE_ITEMS),
    instruction,
  };
}

module.exports = {
  verifyAssertedPrescription,
  detectAssertion,
  canonicalizeClaim,
  findPrescriptionEvidence,
  PRESCRIPTION_LEXICON,
  FAULT_TAGS,
  RETRIEVAL_TO_CANONICAL_TAG,
  __private: {
    normalizePhrase,
    matchPrescriptionTag,
    matchCanonicalTag,
    readCues,
    readPriorityText,
    readObservationTexts,
    describeDates,
    humanizeTag,
  },
};
