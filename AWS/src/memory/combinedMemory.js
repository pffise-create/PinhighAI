'use strict';

// Combined Coaching Memory ("Challenger C")
// ----------------------------------------------------------------------------
// Fuses the two challengers measured in docs/memory-evaluation-2026-08-01.md and
// adds the guard that evaluation said no context architecture supplies:
//
//   1. RETRIEVAL SUBSTRATE  — relevanceRetrieval.selectRelevantHistory decides
//      WHICH sessions are relevant to the current message. (Retrieval scored
//      139/200, recall 31/40 — the best at finding the right history.)
//
//   2. LEDGER PRESENTATION  — coachingLedger's diffing/status logic is run over
//      the RETRIEVED set plus the adjacent sessions needed for a valid diff, so
//      the model receives improved/unchanged/regressed/held-N-sessions about the
//      sessions retrieval chose, not merely about the newest two. (Ledger scored
//      131/200 but won change-detection 25 and usefulness 30 — exactly where
//      retrieval scored lowest.)
//
//   3. PRESCRIPTION-VERIFICATION GUARD — new. All three evaluated arms accepted
//      the embedded false premise "Last time you told me to shorten my backswing"
//      (verified 0 of 68 sessions) while all three correctly refused the same
//      falsehood asked directly. The difference is conversational pressure to
//      reconcile. So the claim is extracted, canonicalized, checked against the
//      record, and a FACTUAL VERDICT is placed in context before the model reads
//      the player's framing.
//
// Constraints preserved from both parents:
//   * Additive only. The champion path and both challenger modules are untouched.
//   * Anti-template-poisoning (Feb 2026): prior coach prose — summaries,
//     coaching_response, drill/cue wording, assistant chat turns — is READ for
//     classification and matching, and is NEVER rendered into model context.
//     Chat turns are surfaced as canonical tags only.
//   * Pure, synchronous, zero dependencies.

const retrieval = require('./relevanceRetrieval');
const ledgerModule = require('./coachingLedger');

const COMBINED_VERSION = 'combined.v1';

const DEFAULT_BUDGET_TOKENS = 1200;
const DEFAULT_MAX_SWINGS = 3;
const DEFAULT_MAX_TURN_TAGS = 3;
// Share of the budget handed to the retrieval pass. The remainder pays for the
// change-status block, the verification verdict and the envelope.
const RETRIEVAL_BUDGET_SHARE = 0.6;
const MAX_EVIDENCE_ITEMS = 4;
const CLAIM_CHAR_LIMIT = 90;

const { estimateTokens } = retrieval;

// ---------------------------------------------------------------------------
// Prescription lexicon
// ---------------------------------------------------------------------------
// Both parent modules describe FAULTS ("early extension", "overswing"). A player
// asserting prior advice describes an INSTRUCTION ("you told me to shorten my
// backswing"). Neither parent vocabulary matches that phrasing, so the guard
// carries its own imperative lexicon and maps it onto the ledger's canonical tag
// space. Phrases are matched after normalization (articles/possessives dropped),
// so "shorten my backswing" and "shorten the backswing" both hit.

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

// retrievalFaultKey -> coachingLedger tag. Where the taxonomies disagree, the
// ledger tag wins because ledger entries/patterns are keyed by it.
const RETRIEVAL_TO_LEDGER_TAG = {
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
  // Direct question forms first — they are more specific than the assertion forms
  // and would otherwise be swallowed by them.
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

/** Keyword scan over the ledger's public canonical taxonomy. */
function matchLedgerTag(text) {
  const haystack = typeof text === 'string' ? text.toLowerCase() : '';
  if (!haystack) {
    return null;
  }
  let best = null;
  ledgerModule.FAULT_TAGS.forEach((entry) => {
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
 * Map a free-text claim onto a canonical ledger tag.
 * @returns {{canonical: string|null, matchedPhrase: string|null, source: string}}
 */
function canonicalizeClaim(claim) {
  const prescription = matchPrescriptionTag(claim);
  if (prescription) {
    return { canonical: prescription.tag, matchedPhrase: prescription.phrase, source: 'prescription_lexicon' };
  }

  const ledgerTag = matchLedgerTag(claim);
  if (ledgerTag) {
    return { canonical: ledgerTag, matchedPhrase: null, source: 'ledger_taxonomy' };
  }

  const faults = retrieval.extractFaults(claim);
  for (let index = 0; index < faults.length; index += 1) {
    const mapped = RETRIEVAL_TO_LEDGER_TAG[faults[index]];
    if (mapped) {
      return { canonical: mapped, matchedPhrase: null, source: 'retrieval_vocabulary' };
    }
  }

  return { canonical: null, matchedPhrase: null, source: 'unmatched' };
}

// ---------------------------------------------------------------------------
// Evidence search
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

function orderChronologically(swings) {
  const list = asArray(swings).filter((swing) => swing && typeof swing === 'object');
  if (list.length <= 1) {
    return list.slice();
  }
  const stamps = list.map((swing) => toTimestamp(getCapturedAt(swing)));
  if (stamps.every((value) => value !== null)) {
    return list
      .map((swing, index) => ({ swing, timestamp: stamps[index], index }))
      .sort((a, b) => (a.timestamp - b.timestamp) || (a.index - b.index))
      .map((entry) => entry.swing);
  }
  // getLastAnalyzedSwings returns newest-first; without dates we trust that.
  return list.slice().reverse();
}

/**
 * Search the record for a prescription of `canonical`.
 * Prose is read here; only tags, dates and ids escape.
 */
function findPrescriptionEvidence({ canonical, ledger, chatTurns, swingProfile }) {
  const prescribed = [];
  const observed = [];

  if (!canonical) {
    return { prescribed, observed };
  }

  asArray(ledger && ledger.entries).forEach((entry) => {
    if (asArray(entry.prescribed).includes(canonical)) {
      prescribed.push({ date: entry.date, swing: entry.swing, session: entry.session, basis: 'session_cue_tag' });
      return;
    }
    if (entry.priority === canonical) {
      prescribed.push({ date: entry.date, swing: entry.swing, session: entry.session, basis: 'session_priority' });
      return;
    }
    const cueHit = asArray(entry.cues).some((cue) => {
      const hit = matchPrescriptionTag(cue);
      return hit && hit.tag === canonical;
    });
    if (cueHit) {
      prescribed.push({ date: entry.date, swing: entry.swing, session: entry.session, basis: 'session_cue_text' });
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
          session: null,
          basis: 'coach_message',
        });
      }
    });

  asArray(swingProfile && swingProfile.focus_areas).forEach((area) => {
    const text = typeof area === 'string' ? area : (area && area.text) || '';
    const hit = matchPrescriptionTag(text) || (matchLedgerTag(text) ? { tag: matchLedgerTag(text) } : null);
    if (hit && hit.tag === canonical) {
      prescribed.push({
        date: toIsoDate(swingProfile.last_analysis_at) || null,
        swing: swingProfile.last_analysis_id || null,
        session: null,
        basis: 'profile_focus_area',
      });
    }
  });

  // Observation-only evidence: the pattern exists in the record but was never
  // handed to the player as advice. Materially different from "never happened".
  asArray(ledger && ledger.patterns)
    .filter((pattern) => pattern.tag === canonical)
    .forEach((pattern) => {
      observed.push({
        date: pattern.first_seen && pattern.first_seen.date,
        swing: pattern.first_seen && pattern.first_seen.swing,
        session: pattern.first_seen && pattern.first_seen.session,
        sessions_seen: pattern.sessions_seen,
        basis: 'observed_in_analysis',
      });
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
 * @param {string} input.question   the player's current message
 * @param {Array}  [input.swings]   all available swings (used when no ledger is supplied)
 * @param {object} [input.ledger]   result of coachingLedger.buildLedger
 * @param {Array}  [input.chatTurns]
 * @param {object} [input.swingProfile]
 * @returns {object|null} verdict, or null when the message asserts nothing about history
 */
function verifyAssertedPrescription({
  question = '',
  swings = [],
  ledger = null,
  chatTurns = [],
  swingProfile = null,
} = {}) {
  const assertion = detectAssertion(question);
  if (!assertion) {
    return null;
  }

  const activeLedger = ledger && Array.isArray(ledger.entries)
    ? ledger
    : ledgerModule.buildLedger({
      swings,
      swingProfile,
      chatTurns,
      maxSessions: Math.max(12, asArray(swings).length),
    });

  const { canonical, matchedPhrase, source } = canonicalizeClaim(assertion.claim);
  const sessionsChecked = asArray(activeLedger.entries).length;

  if (!canonical) {
    return {
      asserted: true,
      form: assertion.form,
      claim: assertion.claim,
      canonical: null,
      canonical_label: null,
      found: null,
      matched_via: source,
      sessions_checked: sessionsChecked,
      evidence: 'the claim could not be matched to any coaching topic in the record, so it is unverified',
      evidence_items: [],
      instruction: 'This recollection is unverified — it maps to no topic in the stored record. Do not confirm that you gave this advice. Ask what they are referring to, or answer the underlying question without endorsing the memory.',
    };
  }

  const { prescribed, observed } = findPrescriptionEvidence({
    canonical,
    ledger: activeLedger,
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
    evidence = `no session prescribes "${label}"; it was observed in analysis ${observed[0].sessions_seen || 1} time(s), first on ${when}, but never given as advice`;
    instruction = `There is no record of advising this. "${label}" was noted as an observation (${when}) but never prescribed. Do not confirm the advice. Say plainly you don't have a record of telling them that, note what the record does show, then help with the underlying question.`;
  } else {
    evidence = `no session in the retrieved or ledger history prescribes this (${sessionsChecked} session(s) checked)`;
    instruction = assertion.form === 'negated_assertion'
      ? `Correct — the record contains no such advice across ${sessionsChecked} session(s). Confirm the absence rather than inventing a reason.`
      : "The player's recollection is not supported by the record. Do not confirm it. Say plainly you don't have a record of advising that, then help with the underlying question.";
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
    evidence,
    evidence_items: (found ? prescribed : observed).slice(0, MAX_EVIDENCE_ITEMS),
    instruction,
  };
}

// ---------------------------------------------------------------------------
// Ledger status over the retrieved set
// ---------------------------------------------------------------------------

function pickTagDiff(diff, tag) {
  const tags = asArray(diff && diff.tags);
  return tags.find((entry) => entry.tag === tag) || null;
}

function heldAsPriorityRun(entries, session, tag) {
  if (!tag || !Number.isFinite(session)) {
    return 0;
  }
  const index = entries.findIndex((entry) => entry.session === session);
  if (index < 0 || entries[index].priority !== tag) {
    return 0;
  }
  let count = 1;
  for (let i = index - 1; i >= 0 && entries[i].priority === tag; i -= 1) {
    count += 1;
  }
  for (let i = index + 1; i < entries.length && entries[i].priority === tag; i += 1) {
    count += 1;
  }
  return count;
}

/**
 * Change-status for ONE retrieved session, computed with the ledger's diff logic
 * against the adjacent sessions required for a valid comparison:
 *   at_session  = retrieved session vs its immediate predecessor  ("what changed then")
 *   since_then  = retrieved session vs the newest session          ("what changed since")
 */
function buildChangeStatus({ chronological, index, ledger, metricDirections }) {
  const swing = chronological[index];
  const analysisId = getAnalysisId(swing);
  const entries = asArray(ledger && ledger.entries);
  const entry = entries.find((item) => item.swing === analysisId) || null;
  const tag = entry ? entry.priority : null;

  if (!tag) {
    return {
      tag: null,
      status: 'unknown',
      basis: 'no classified priority for this session',
    };
  }

  const status = { tag };
  const pattern = asArray(ledger && ledger.patterns).find((item) => item.tag === tag);

  if (index > 0) {
    const diff = ledgerModule.diffSwings({
      previous: chronological[index - 1],
      current: swing,
      metricDirections,
    });
    const tagDiff = pickTagDiff(diff, tag);
    status.at_session = tagDiff
      ? { status: tagDiff.status, basis: tagDiff.basis, vs_date: toIsoDate(getCapturedAt(chronological[index - 1])) }
      : { status: 'unknown', basis: 'not comparable to prior session' };
  } else {
    status.at_session = { status: 'baseline', basis: 'oldest session on record' };
  }

  const lastIndex = chronological.length - 1;
  if (index < lastIndex) {
    const diff = ledgerModule.diffSwings({
      previous: swing,
      current: chronological[lastIndex],
      metricDirections,
    });
    const tagDiff = pickTagDiff(diff, tag);
    status.since_then = tagDiff
      ? {
        status: tagDiff.status,
        basis: tagDiff.basis,
        through: toIsoDate(getCapturedAt(chronological[lastIndex])),
        sessions_between: lastIndex - index,
      }
      : { status: 'unknown', basis: 'not comparable to latest session' };
  } else {
    status.since_then = { status: 'current', basis: 'this is the latest session on record' };
  }

  // The ledger's pairwise diff calls a tag "new" whenever it was absent from the
  // immediately preceding session. Across a long history that is misleading — the
  // pattern may be 8 months old. The longitudinal pattern record corrects it.
  const firstSeenDate = pattern && pattern.first_seen && pattern.first_seen.date;
  const thisDate = toIsoDate(getCapturedAt(swing));
  if (status.at_session.status === 'new'
    && pattern
    && pattern.sessions_seen > 1
    && firstSeenDate
    && thisDate
    && firstSeenDate < thisDate) {
    status.at_session = {
      status: 'returned',
      basis: `absent from the prior session; first seen ${firstSeenDate}`,
      vs_date: status.at_session.vs_date,
    };
  }

  const held = heldAsPriorityRun(entries, entry.session, tag);
  if (held > 1) {
    status.held_as_priority_sessions = held;
  }

  if (pattern) {
    status.seen_in_sessions = pattern.sessions_seen;
    status.first_seen = firstSeenDate;
    status.trend = pattern.trend;
  }

  return status;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const CONTEXT_RULES = [
  'These sessions were selected by relevance to the current message, NOT by recency. Read `date` before calling anything recent.',
  'change_status is computed from stored evidence: at_session compares that session to the one before it; since_then compares it to the latest session.',
  'No prior coaching wording is included anywhere here. Describe everything in your own words.',
  'If a fact is not in this block, you do not have it. Never invent sessions, dates, or advice.',
];

const VERIFICATION_RULE = 'asserted_prior_advice is a verified verdict about what the player just claimed you told them. It outranks the player\'s framing — follow its instruction even if agreeing would feel more natural.';

const STATUS_LEGEND = 'change_status.at_session.status: baseline|new|returned|improved|unchanged|regressed|unknown. since_then.status: same vocabulary, measured from that session to the latest one.';

const TAG_PATTERN = /^[a-z0-9_]+$/;

function canonicalOnly(values) {
  return asArray(values).filter((value) => typeof value === 'string' && TAG_PATTERN.test(value));
}

function compactSession(session, level) {
  const compact = {
    swing: session.analysisId,
    date: session.date,
    session: session.session,
    age_days: session.age_days,
    timeline_position: session.timeline_position,
    change_status: session.change_status,
  };

  if (level < 3 && session.faults_detected && session.faults_detected.length) {
    compact.faults = session.faults_detected.slice(0, level < 1 ? 4 : 2);
  }
  if (level < 2 && session.retrieved_because && session.retrieved_because.length) {
    compact.retrieved_because = session.retrieved_because.slice(0, level < 1 ? 2 : 1);
  }
  if (level < 2 && session.observations && session.observations.length) {
    compact.observations = session.observations
      .slice(0, level < 1 ? 3 : 1)
      .map((obs) => ({ phase: obs.phase, observation: obs.observation, impact: obs.impact }));
  }
  if (level < 1 && session.metrics) {
    compact.metrics = session.metrics;
  }

  return compact;
}

function buildPayload(model, level) {
  const sessions = (level >= 4 ? model.sessions.slice(0, 1) : level >= 3 ? model.sessions.slice(0, 2) : model.sessions)
    .map((session) => compactSession(session, level));

  const memory = {
    memory_version: model.version,
    architecture: 'relevance-retrieved sessions with ledger change-status and prescription verification',
    player: model.player,
  };

  if (model.verification) {
    const verdict = { ...model.verification };
    if (level >= 2) {
      delete verdict.matched_via;
      delete verdict.matched_phrase;
    }
    if (level >= 3) {
      verdict.evidence_items = asArray(verdict.evidence_items).slice(0, 1);
    }
    memory.asserted_prior_advice = verdict;
  }

  memory.selection = model.selection;
  memory.sessions = sessions;

  if (level < 3 && sessions.length) {
    memory.status_legend = STATUS_LEGEND;
  }

  if (level < 4 && model.patterns.length) {
    memory.patterns = model.patterns.slice(0, level >= 2 ? 2 : 4);
  }
  if (level < 2 && model.heldStreak) {
    memory.held_streak = model.heldStreak;
  }
  if (level < 2 && model.ruledOut.length) {
    memory.ruled_out = model.ruledOut;
  }
  if (level < 2 && Object.keys(model.playerStated).length) {
    memory.player_stated = model.playerStated;
  }
  if (level < 1 && model.conversationTags.length) {
    memory.conversation_tags = model.conversationTags;
  }
  if (model.sessionsOmitted > 0 || level > 0) {
    memory.detail_level = level;
  }
  if (!sessions.length) {
    memory.note = 'no prior coaching sessions on record for this player';
  }

  memory.rules = model.verification
    ? [VERIFICATION_RULE].concat(level >= 3 ? CONTEXT_RULES.slice(0, 2) : CONTEXT_RULES)
    : (level >= 3 ? CONTEXT_RULES.slice(0, 2) : CONTEXT_RULES);

  return { coaching_memory: memory };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Build the combined coaching-memory context block.
 *
 * @param {object} input
 * @param {string} [input.question]      the player's current message
 * @param {object} [input.currentSwing]  swing under discussion (excluded from results)
 * @param {Array}  [input.swings]        ALL available past swings
 * @param {Array}  [input.chatTurns]     chat history turns
 * @param {object} [input.swingProfile]  swing profile record
 * @param {number} [input.budgetTokens=1200]
 * @param {number} [input.maxSwings=3]
 * @param {object} [input.metricDirections]
 * @param {number} [input.now]
 * @returns {{context: string, verification: object|null, rationale: object}}
 */
function buildCombinedContext({
  question = '',
  currentSwing = null,
  swings = [],
  chatTurns = [],
  swingProfile = null,
  budgetTokens = DEFAULT_BUDGET_TOKENS,
  maxSwings = DEFAULT_MAX_SWINGS,
  metricDirections = {},
  now = Date.now(),
} = {}) {
  const budget = Number.isFinite(budgetTokens) && budgetTokens > 0 ? budgetTokens : DEFAULT_BUDGET_TOKENS;
  const chronological = orderChronologically(swings);

  // --- 1. retrieval substrate ------------------------------------------------
  const selection = retrieval.selectRelevantHistory({
    question,
    currentSwing,
    swings,
    chatTurns,
    swingProfile,
    budgetTokens: Math.max(200, Math.floor(budget * RETRIEVAL_BUDGET_SHARE)),
    maxSwings,
    maxTurns: DEFAULT_MAX_TURN_TAGS,
    now,
  });

  // --- 2. ledger presentation over the retrieved set -------------------------
  // The ledger is built over the FULL history so session numbers, patterns,
  // first_seen dates and held streaks are true, not window-relative.
  const ledger = ledgerModule.buildLedger({
    swings,
    swingProfile,
    chatTurns,
    maxSessions: Math.max(12, chronological.length),
    metricDirections,
  });

  const indexById = new Map();
  chronological.forEach((swing, index) => {
    const id = getAnalysisId(swing);
    if (id && !indexById.has(id)) {
      indexById.set(id, index);
    }
  });
  const entryById = new Map();
  asArray(ledger.entries).forEach((entry) => {
    if (entry.swing) {
      entryById.set(entry.swing, entry);
    }
  });

  const renderedSwings = asArray(selection.rationale && selection.rationale.rendered && selection.rationale.rendered.swings);
  const sessions = renderedSwings.map((rendered) => {
    const index = indexById.has(rendered.analysisId) ? indexById.get(rendered.analysisId) : -1;
    const entry = entryById.get(rendered.analysisId) || null;
    return {
      analysisId: rendered.analysisId,
      date: toIsoDate(rendered.capturedAt),
      session: entry ? entry.session : null,
      age_days: rendered.age_days,
      timeline_position: rendered.timeline_position,
      faults_detected: rendered.faults_detected,
      observations: rendered.observations,
      metrics: rendered.metrics,
      retrieved_because: rendered.retrieved_because,
      change_status: index >= 0
        ? buildChangeStatus({ chronological, index, ledger, metricDirections })
        : { tag: null, status: 'unknown', basis: 'session not found in the full history' },
    };
  });

  // --- 3. prescription-verification guard -----------------------------------
  const verification = verifyAssertedPrescription({
    question,
    swings,
    ledger,
    chatTurns,
    swingProfile,
  });

  // Chat memory as canonical tags only — never as text.
  const conversationTags = asArray(selection.selectedTurns)
    .map((turn) => {
      const content = typeof turn.content === 'string' ? turn.content : '';
      const tags = Array.from(new Set([
        matchLedgerTag(content),
        ...retrieval.extractFaults(content).map((key) => RETRIEVAL_TO_LEDGER_TAG[key]),
      ].filter(Boolean)));
      if (!tags.length) {
        return null;
      }
      return {
        when: toIsoDate(turn.timestamp || turn.created_at || turn.createdAt),
        role: turn.role === 'assistant' ? 'coach' : 'player',
        tags: tags.slice(0, 3),
      };
    })
    .filter(Boolean)
    .slice(0, DEFAULT_MAX_TURN_TAGS);

  const selectionRationale = selection.rationale || {};
  const model = {
    version: COMBINED_VERSION,
    player: {
      sessions_on_record: asArray(ledger.entries).length,
      first_session: ledger.player ? ledger.player.first_session_date : null,
      latest_session: ledger.player ? ledger.player.last_session_date : null,
      span_days: ledger.player ? ledger.player.span_days : null,
    },
    selection: {
      basis: selectionRationale.strategy || 'recency-dominant',
      query_topics: asArray(selectionRationale.queryFaults).slice(0, 4),
      temporal_cue: (selectionRationale.temporal && selectionRationale.temporal.cue) || null,
      considered: (selectionRationale.candidatesConsidered && selectionRationale.candidatesConsidered.swings) || 0,
    },
    sessions,
    sessionsOmitted: Math.max(0, chronological.length - sessions.length),
    patterns: asArray(ledger.recurring_patterns).length
      ? ledger.recurring_patterns.map((pattern) => ({
        tag: pattern.tag,
        sessions_seen: pattern.sessions_seen,
        first_seen: pattern.first_seen && pattern.first_seen.date,
        trend: pattern.trend,
      }))
      : [],
    heldStreak: ledger.held_streak && ledger.held_streak.consecutive_sessions > 1
      ? {
        tag: ledger.held_streak.tag,
        consecutive_sessions: ledger.held_streak.consecutive_sessions,
        since_date: ledger.held_streak.since_date,
      }
      : null,
    ruledOut: canonicalOnly(asArray(ledger.ruled_out).map((entry) => entry.tag)).slice(0, 4),
    playerStated: (() => {
      const stated = {};
      const goals = canonicalOnly(ledger.player_stated && ledger.player_stated.goals);
      const misses = canonicalOnly(ledger.player_stated && ledger.player_stated.misses);
      if (goals.length) stated.goals = goals.slice(0, 3);
      if (misses.length) stated.misses = misses.slice(0, 3);
      return stated;
    })(),
    conversationTags,
    verification,
  };

  // --- render under budget ---------------------------------------------------
  let context = null;
  let usedLevel = 0;
  for (let level = 0; level <= 4; level += 1) {
    const rendered = JSON.stringify(buildPayload(model, level));
    context = rendered;
    usedLevel = level;
    if (estimateTokens(rendered) <= budget) {
      break;
    }
  }

  const renderedTokens = estimateTokens(context);
  if (renderedTokens > budget) {
    // Floor: the verdict and the single most relevant session, nothing else.
    // The verdict itself is irreducible — a budget smaller than the verdict is
    // not honoured, because dropping it is the one failure mode C exists to fix.
    const floor = {
      coaching_memory: {
        memory_version: COMBINED_VERSION,
        player: model.player,
        ...(model.verification ? { asserted_prior_advice: {
          claim: model.verification.claim,
          canonical: model.verification.canonical,
          found: model.verification.found,
          instruction: model.verification.instruction,
        } } : {}),
        sessions: model.sessions.slice(0, 1).map((session) => ({
          swing: session.analysisId,
          date: session.date,
          change_status: session.change_status,
        })),
        truncated: true,
        rules: [CONTEXT_RULES[3]],
      },
    };
    context = JSON.stringify(floor);
    usedLevel = 5;
  }

  return {
    context,
    verification,
    rationale: {
      version: COMBINED_VERSION,
      strategy: selectionRationale.strategy || null,
      queryFaults: asArray(selectionRationale.queryFaults),
      temporal: selectionRationale.temporal || null,
      historySpan: selectionRationale.historySpan || null,
      sessionsRetrieved: sessions.map((session) => ({
        analysisId: session.analysisId,
        date: session.date,
        session: session.session,
        timeline_position: session.timeline_position,
        change_status: session.change_status,
      })),
      ledger: {
        sessions_logged: asArray(ledger.entries).length,
        recurring_patterns: asArray(ledger.recurring_patterns).map((pattern) => pattern.tag),
        held_streak: ledger.held_streak || null,
      },
      verification,
      budget: {
        budgetTokens: budget,
        renderedTokens: estimateTokens(context),
        detailLevel: usedLevel,
        truncated: usedLevel > 0,
      },
      retrieval: selectionRationale,
    },
  };
}

module.exports = {
  COMBINED_VERSION,
  DEFAULT_BUDGET_TOKENS,
  PRESCRIPTION_LEXICON,
  RETRIEVAL_TO_LEDGER_TAG,
  buildCombinedContext,
  verifyAssertedPrescription,
  detectAssertion,
  canonicalizeClaim,
  estimateTokens,
  __private: {
    normalizePhrase,
    matchLedgerTag,
    matchPrescriptionTag,
    findPrescriptionEvidence,
    buildChangeStatus,
    orderChronologically,
    firstClause,
    buildPayload,
  },
};
