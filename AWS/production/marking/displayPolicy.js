// Mode 2 display decision layer for the swing marking tool.
//
// Mode 1 (silent grounding) puts marked frames in front of the vision model and
// never tells the player. Mode 2 shows a marked frame to the player as visual
// evidence. This module decides WHEN that is allowed. It is pure: no I/O, no
// env reads, no S3 — the caller supplies everything and applies the result.
//
// The governing rules (docs/backlog/swing-marking-tool.md, "Scope of work" 6-7
// and the risks section):
//   * The coach decides. A marking is NEVER shown by default.
//   * Show only when the player asked something the marking directly answers
//     (plane / posture / head movement), or asked for a then-vs-now comparison.
//   * The marking must actually exist for the swing(s) in question, must be the
//     type that answers the question, and must clear a display confidence bar
//     that is stricter than the generator's own fail-closed gates.
//   * A withheld / failed / low-confidence marking is never shown. "A wrong
//     line is worse than no line" applies twice as hard when the player sees it.
//   * side_by_side is refused when the two sessions' framing is not comparable
//     (the backlog's biggest Mode 2 risk: a plane line only means the same thing
//     across swings if the camera geometry does).
//
// entitlementActive is accepted and echoed but NOT enforced here — whether Mode 2
// is a paid-tier differentiator is still an open product question, so the caller
// applies that policy on top of a decision that stays purely about evidence.

'use strict';

// The generator's own gates are plane 0.45, spine 0.40, head 0.35 — those decide
// whether a marking is trustworthy enough to feed a model. Showing a line to a
// human is a higher bar, so display sits one notch above the strictest of them.
// Tune once the production confidence distribution is known.
const DEFAULT_MIN_DISPLAY_CONFIDENCE = 0.5;

// Question topic -> the marking that actually answers it. A question about the
// head is not answered by a plane line, so the mapping is strict.
const TOPIC_MARKING = {
  plane: 'plane_line',
  posture: 'spine_line',
  head: 'head_circle',
};

const TOPIC_PATTERNS = [
  [
    'plane',
    /\b(plane|over ?the ?top|steep|shallow|shallowing|laid ?off|across ?the ?line|shaft angle|club ?path|casting|over-?the-?top)\b/i,
  ],
  [
    'posture',
    /\b(posture|spine|spine angle|side ?bend|hunch|hunched|slouch|standing ?up|stand ?up|early ?extension|tilt|bend(ing)? over|c-?posture)\b/i,
  ],
  [
    'head',
    /\b(head|sway|swaying|swayed|slide|sliding|off ?the ?ball|stay(ing)? ?centered|centred|lateral movement|move(ment)? off|dip(ping)?|lift(ing)? up)\b/i,
  ],
];

// Topics that are unmistakably NOT what a plane line, spine line or head circle
// measures. A comparative question about one of these gets no marking: the
// flagship "impact against the plane, now vs then" default only applies when the
// player has not named a different subject.
const NON_MARKING_TOPIC_RE = /\b(tempo|rhythm|timing|grip|distance|yardage|carry|ball ?flight|mental|routine|drill|practice plan|putting|chipping|bunker)\b/i;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

function detectTopics(question) {
  const text = str(question);
  if (!text.trim()) {
    return [];
  }
  return TOPIC_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic);
}

// coachIntent may be:
//   null/undefined            -> no opinion, fall back to the question
//   'plane' | 'show_plane'    -> a topic hint
//   { show: false }           -> explicit veto (always wins)
//   { show: true, topic: 'plane' | topics: [...] } -> explicit request
function readCoachIntent(coachIntent) {
  if (!coachIntent) {
    return { veto: false, requested: false, topics: [] };
  }
  if (typeof coachIntent === 'string') {
    return { veto: false, requested: false, topics: detectTopics(coachIntent) };
  }
  if (typeof coachIntent !== 'object') {
    return { veto: false, requested: false, topics: [] };
  }
  const explicit = coachIntent.show === true || coachIntent.showMarking === true;
  const veto = coachIntent.show === false || coachIntent.showMarking === false;
  const topics = [
    ...asArray(coachIntent.topics).map(str),
    str(coachIntent.topic),
    ...detectTopics(str(coachIntent.reason)),
  ].filter((topic) => Object.prototype.hasOwnProperty.call(TOPIC_MARKING, topic));
  return { veto, requested: explicit, topics: Array.from(new Set(topics)) };
}

// Accepts the raw analysis_results.marking record written by the extractor, or a
// side wrapper { marking, frames, analysisId, capturedAt }.
function normalizeSide(side) {
  if (!side || typeof side !== 'object') {
    return null;
  }
  const marking = side.marking && typeof side.marking === 'object' ? side.marking : side;
  const frames = asArray(side.frames);
  return {
    analysisId: side.analysisId || side.analysis_id || marking.analysis_id || null,
    capturedAt: side.capturedAt || side.captured_at || null,
    extractionMode: side.extractionMode || side.extraction_mode || null,
    anchored: side.anchored === undefined ? null : !!side.anchored,
    marking,
    frames,
  };
}

function normalizeAvailability(markingAvailable) {
  if (!markingAvailable || typeof markingAvailable !== 'object') {
    return { current: null, prior: null };
  }
  // A bare marking record (has `generated`) is treated as the current swing's.
  if (Object.prototype.hasOwnProperty.call(markingAvailable, 'generated')) {
    return { current: normalizeSide({ marking: markingAvailable }), prior: null };
  }
  return {
    current: normalizeSide(markingAvailable.current),
    prior: normalizeSide(markingAvailable.prior),
  };
}

function markingConfidence(side, markingType) {
  const markings = side?.marking?.geometry?.markings;
  if (!markings || typeof markings !== 'object') {
    return null;
  }
  const entry = markings[markingType];
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const confidence = Number(entry.confidence);
  return Number.isFinite(confidence) ? confidence : null;
}

// A marking is usable for display when it was generated, was actually rendered
// (not withheld into `failures`), and clears the display confidence bar.
function evaluateMarking(side, markingType, minConfidence) {
  if (!side) {
    return { usable: false, reason: 'no marking record for that swing' };
  }
  const marking = side.marking || {};
  if (marking.generated !== true) {
    const why = str(marking.reason) || 'marking was not generated';
    return { usable: false, reason: `marking unavailable (${why})` };
  }
  const rendered = asArray(marking.markings_rendered).map(str);
  if (!rendered.includes(markingType)) {
    const failure = asArray(marking.failures).find((entry) => entry && entry.marking === markingType);
    const why = failure ? str(failure.reason) : 'it was not rendered for this swing';
    return { usable: false, reason: `the ${markingType} was withheld (${why})` };
  }
  const confidence = markingConfidence(side, markingType);
  if (confidence === null) {
    // Rendered but no confidence recorded: treat as untrustworthy rather than
    // assuming the best. Fail closed on display.
    return { usable: false, reason: `the ${markingType} has no recorded confidence` };
  }
  if (confidence < minConfidence) {
    return {
      usable: false,
      reason: `the ${markingType} confidence ${confidence.toFixed(2)} is below the ${minConfidence} display bar`,
    };
  }
  return { usable: true, confidence, reason: null };
}

function frameHasMarked(frame) {
  return !!(frame && (frame.markedKey || frame.marked_key || frame.markedUrl || frame.marked_url));
}

function frameOut(frame, { role, label, kind, analysisId, capturedAt, markingTypes }) {
  return {
    role,
    label,
    kind,
    analysis_id: analysisId || frame.analysisId || frame.analysis_id || null,
    captured_at: capturedAt || null,
    phase: frame.phase || frame.sourcePhase || null,
    phase_hint: frame.phaseHint || frame.phase_hint || null,
    timestamp: Number.isFinite(Number(frame.timestamp)) ? Number(frame.timestamp) : null,
    s3_key: frame.markedKey || frame.marked_key || null,
    url: frame.markedUrl || frame.marked_url || null,
    plain_s3_key: frame.key || frame.s3_key || null,
    plain_url: frame.url || null,
    markings: markingTypes.slice(),
  };
}

const PHASE_PRIORITY = ['impact', 'top', 'address', 'finish'];

function pickFrame(frames, preferredHint) {
  const marked = asArray(frames).filter(frameHasMarked);
  if (!marked.length) {
    return null;
  }
  if (preferredHint) {
    const exact = marked.find((frame) => (frame.phaseHint || frame.phase_hint) === preferredHint);
    if (exact) {
      return exact;
    }
  }
  for (const hint of PHASE_PRIORITY) {
    const match = marked.find((frame) => (frame.phaseHint || frame.phase_hint) === hint);
    if (match) {
      return match;
    }
  }
  return marked[Math.floor(marked.length / 2)];
}

// Cross-session camera variance is the backlog's biggest Mode 2 risk. Two plane
// lines are only comparable when they were drawn on comparable framing, so this
// checks every signal we actually have and names the one that failed.
function framingComparable(prior, current) {
  const priorGeo = prior?.marking?.geometry || {};
  const currentGeo = current?.marking?.geometry || {};

  const priorView = str(priorGeo.view?.label);
  const currentView = str(currentGeo.view?.label);
  if (!priorView || !currentView) {
    return { comparable: false, reason: 'the camera view of one of the sessions was never classified' };
  }
  if (priorView !== currentView) {
    return {
      comparable: false,
      reason: `the two sessions were filmed from different views (${priorView} vs ${currentView})`,
    };
  }
  if (priorGeo.facing && currentGeo.facing && priorGeo.facing !== currentGeo.facing) {
    return { comparable: false, reason: 'the player faces opposite directions in the two clips' };
  }

  const priorW = Number(priorGeo.frame_width);
  const priorH = Number(priorGeo.frame_height);
  const currentW = Number(currentGeo.frame_width);
  const currentH = Number(currentGeo.frame_height);
  if (![priorW, priorH, currentW, currentH].every((value) => Number.isFinite(value) && value > 0)) {
    return { comparable: false, reason: 'frame dimensions are missing for one of the sessions' };
  }
  const priorAspect = priorW / priorH;
  const currentAspect = currentW / currentH;
  if (Math.abs(priorAspect - currentAspect) > 0.02 * Math.max(priorAspect, currentAspect)) {
    return {
      comparable: false,
      reason: `the two clips were shot in different framings (${priorW}x${priorH} vs ${currentW}x${currentH})`,
    };
  }

  // Legacy uniform extraction rarely captures impact, so an impact-vs-impact
  // comparison against those frames is not the comparison we claim to show.
  const anchored = (side) => (side.anchored !== null && side.anchored !== undefined
    ? side.anchored
    : /event-anchored/i.test(str(side.extractionMode)));
  if (!anchored(prior) || !anchored(current)) {
    return {
      comparable: false,
      reason: 'one of the sessions was extracted without an impact anchor, so the two frames are not the same moment',
    };
  }

  // Apparent player scale: the head circle radius is normalized by frame width,
  // so a large mismatch means the camera was at a very different distance and a
  // plane line drawn on one does not measure the same thing on the other.
  const priorHead = priorGeo.markings?.head_circle?.r;
  const currentHead = currentGeo.markings?.head_circle?.r;
  if (Number.isFinite(Number(priorHead)) && Number.isFinite(Number(currentHead))) {
    const ratio = Number(priorHead) / Number(currentHead);
    if (ratio > 1.5 || ratio < 1 / 1.5) {
      return {
        comparable: false,
        reason: 'the camera distance differs too much between the sessions for the two lines to measure the same thing',
      };
    }
  }

  return { comparable: true, reason: null };
}

function deny(reason, extra = {}) {
  return { show: false, kind: null, reason, frames: [], ...extra };
}

/**
 * Decide whether a marked frame may be shown to the player.
 *
 * @param {object}   input
 * @param {string}   input.question           the player's message
 * @param {object|string} [input.coachIntent] the coach's own call: { show, topic } or a topic string
 * @param {object}   input.markingAvailable   { current: side, prior: side }, side =
 *                                            { marking, frames, analysisId, capturedAt, extractionMode, anchored }
 *                                            where marking is analysis_results.marking and each frame may carry
 *                                            markedKey / markedUrl / phaseHint
 * @param {object}   [input.comparison]       swingMemory's planVisualComparison result
 * @param {boolean}  [input.entitlementActive] echoed, never enforced here
 * @param {number}   [input.minConfidence]    display confidence bar override
 * @returns {{show: boolean, kind: 'single'|'side_by_side'|null, reason: string, frames: object[], topic?: string, marking?: string, entitlementActive?: boolean}}
 */
function shouldShowMarking({
  question = '',
  coachIntent = null,
  markingAvailable = null,
  comparison = null,
  entitlementActive = undefined,
  minConfidence = DEFAULT_MIN_DISPLAY_CONFIDENCE,
} = {}) {
  const bar = Number.isFinite(Number(minConfidence)) ? Number(minConfidence) : DEFAULT_MIN_DISPLAY_CONFIDENCE;
  const echo = { entitlement_active: entitlementActive === undefined ? null : !!entitlementActive };

  const intent = readCoachIntent(coachIntent);
  if (intent.veto) {
    return deny('the coach chose not to show a marking for this turn', echo);
  }

  const { current, prior } = normalizeAvailability(markingAvailable);
  const comparisonPlanned = !!(comparison && comparison.needed);

  const questionTopics = detectTopics(question);
  const topics = Array.from(new Set([...intent.topics, ...questionTopics]));

  if (!topics.length && !comparisonPlanned) {
    return deny('the question does not ask about anything the markings answer', echo);
  }
  if (!topics.length && NON_MARKING_TOPIC_RE.test(str(question))) {
    return deny('the comparison the player asked for is about something no marking measures', echo);
  }

  // A comparative question with no named topic still gets the flagship treatment:
  // impact against the plane line, current vs old.
  const orderedTopics = topics.length ? topics : ['plane'];

  if (!current) {
    return deny('no marking record for the current swing', echo);
  }

  // --- side-by-side (then vs now) ------------------------------------------
  if (comparisonPlanned) {
    if (!prior) {
      return deny('a comparison was planned but the prior swing has no marking record', echo);
    }
    const framing = framingComparable(prior, current);
    const attempts = [];
    if (framing.comparable) {
      for (const topic of orderedTopics) {
        const markingType = TOPIC_MARKING[topic];
        const currentCheck = evaluateMarking(current, markingType, bar);
        const priorCheck = evaluateMarking(prior, markingType, bar);
        if (!currentCheck.usable) {
          attempts.push(`current swing: ${currentCheck.reason}`);
          continue;
        }
        if (!priorCheck.usable) {
          attempts.push(`prior swing: ${priorCheck.reason}`);
          continue;
        }
        // The SAME marking type on comparable frames of both swings.
        const currentFrame = pickFrame(current.frames, 'impact');
        const priorFrame = pickFrame(prior.frames, 'impact');
        if (!currentFrame || !priorFrame) {
          attempts.push('no marked frame is stored for one of the two swings');
          continue;
        }
        const currentHint = currentFrame.phaseHint || currentFrame.phase_hint || null;
        const priorHint = priorFrame.phaseHint || priorFrame.phase_hint || null;
        if (currentHint && priorHint && currentHint !== priorHint) {
          attempts.push(`the two marked frames are different moments (${priorHint} vs ${currentHint})`);
          continue;
        }
        const label = (side, when) => `${side}${when ? ` (${when})` : ''}${priorHint ? ` — ${priorHint}` : ''}`;
        return {
          show: true,
          kind: 'side_by_side',
          topic,
          marking: markingType,
          reason: `then-vs-now comparison on the ${markingType}; both sessions carry it and the framing is comparable`,
          frames: [
            frameOut(priorFrame, {
              role: 'prior',
              label: label('EARLIER SWING', prior.capturedAt ? String(prior.capturedAt).slice(0, 10) : null),
              kind: 'side_by_side',
              analysisId: prior.analysisId,
              capturedAt: prior.capturedAt,
              markingTypes: [markingType],
            }),
            frameOut(currentFrame, {
              role: 'current',
              label: label('CURRENT SWING', current.capturedAt ? String(current.capturedAt).slice(0, 10) : null),
              kind: 'side_by_side',
              analysisId: current.analysisId,
              capturedAt: current.capturedAt,
              markingTypes: [markingType],
            }),
          ],
          ...echo,
        };
      }
    }

    const blocked = framing.comparable
      ? `no marking answers it on both sides (${attempts.join('; ') || 'nothing usable'})`
      : framing.reason;
    // No single-frame fallback here on purpose: the player asked a then-vs-now
    // question, and showing one marked swing in answer reads as the comparison
    // itself. Half a comparison is a wrong answer, not a partial one.
    return deny(`side-by-side refused because ${blocked}`, echo);
  }

  // --- single frame ---------------------------------------------------------
  return trySingle({ current, topics: orderedTopics, bar, echo });
}

function trySingle({ current, topics, bar, echo }) {
  const reasons = [];
  for (const topic of topics) {
    const markingType = TOPIC_MARKING[topic];
    const check = evaluateMarking(current, markingType, bar);
    if (!check.usable) {
      reasons.push(check.reason);
      continue;
    }
    const frame = pickFrame(current.frames, topic === 'head' ? 'impact' : null);
    if (!frame) {
      reasons.push('no marked frame is stored for the current swing');
      continue;
    }
    return {
      show: true,
      kind: 'single',
      topic,
      marking: markingType,
      reason: `the question is about ${topic} and the ${markingType} answers it directly (confidence ${check.confidence.toFixed(2)})`,
      frames: [
        frameOut(frame, {
          role: 'current',
          label: `YOUR SWING${frame.phaseHint ? ` — ${frame.phaseHint}` : ''}`,
          kind: 'single',
          analysisId: current.analysisId,
          capturedAt: current.capturedAt,
          markingTypes: [markingType],
        }),
      ],
      ...echo,
    };
  }
  return deny(reasons.join('; ') || 'no marking answers this question', echo);
}

module.exports = {
  shouldShowMarking,
  DEFAULT_MIN_DISPLAY_CONFIDENCE,
  TOPIC_MARKING,
  __private: {
    detectTopics,
    framingComparable,
    evaluateMarking,
    pickFrame,
  },
};
