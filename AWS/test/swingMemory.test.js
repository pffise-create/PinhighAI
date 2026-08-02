'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSwingMemory,
  planVisualComparison,
  selectComparableFrames,
  detectComparativeIntent,
} = require('../src/memory/swingMemory');
const { estimateTokens } = require('../src/memory/relevanceRetrieval');

const NOW = Date.parse('2026-06-10T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

// The words the rendered context may never contain. "severity" is included
// because the rejected ledger design leaked graded change through it.
const CHANGE_DIRECTION_RE = /\b(?:improved?|improving|improvement|worse|worsened|regressed|regression|better|severity)\b/i;

function iso(daysAgo) {
  return new Date(NOW - daysAgo * DAY).toISOString();
}

function frame(analysisId, index, timestamp) {
  const stamp = timestamp.toFixed(2);
  return {
    phase: `frame_${String(index).padStart(3, '0')}`,
    url: `https://golf-bucket.s3.amazonaws.com/golf-swings/u1/${analysisId}/frames/${analysisId}/frame_${String(index).padStart(3, '0')}_Frame_at_${stamp}s.jpg`,
    timestamp,
    description: `Frame at ${stamp}s`,
    frame_number: index,
  };
}

function makeSwing({
  id,
  daysAgo,
  anchorTime = null,
  frameTimes = [],
  observations = [],
  cues = [],
  priorityFix = null,
  summary = null,
}) {
  const analysisResults = {
    frames: frameTimes.map((timestamp, index) => frame(id, index, timestamp)),
    frames_extracted: frameTimes.length,
    video_duration: frameTimes.length ? Math.max(...frameTimes) + 0.25 : 0,
    swing_detected: true,
  };

  if (anchorTime !== null) {
    analysisResults.extraction = {
      version: 'anchored.v3',
      mode: 'event-anchored',
      anchor_time: String(anchorTime),
      anchor_method: 'audio_peak',
      candidate_swings: 1,
    };
  } else if (frameTimes.length) {
    analysisResults.extraction = {
      version: 'anchored.v3',
      mode: 'fallback-uniform',
      anchor_time: null,
      anchor_method: 'no_confident_anchor',
      candidate_swings: 0,
    };
  }

  return {
    analysisId: id,
    userId: 'u1',
    status: 'COMPLETED',
    capturedAt: iso(daysAgo),
    createdAt: iso(daysAgo),
    analysisResults,
    summary,
    aiAnalysis: {
      coaching_response: summary,
      visual_observations: observations,
      practice_recommendations: cues,
      priority_fix: priorityFix,
    },
    visualObservations: observations,
  };
}

// A small but realistic history: an old face-on capture, a mid legacy capture,
// and a recent event-anchored capture.
function buildHistory() {
  return [
    makeSwing({
      id: 'swing-oldest',
      daysAgo: 260,
      anchorTime: null,
      frameTimes: [0.0, 0.35, 0.7, 1.05, 1.4, 1.75, 2.1, 2.45, 2.8, 3.15],
      observations: [
        { phase: 'downswing', observation: 'Hips move toward the ball through the strike, a classic early extension pattern.', confidence: 0.7, impact: 'inconsistent strike' },
        { phase: 'backswing', observation: 'Club travels past parallel at the top with the lead arm folding.', confidence: 0.6 },
      ],
      cues: ['Slow the transition down and count to three at the top.'],
      priorityFix: 'tempo',
      summary: 'SENTINEL_COACH_PROSE_OLDEST — long coaching paragraph the model must never echo.',
    }),
    makeSwing({
      id: 'swing-middle',
      daysAgo: 120,
      anchorTime: null,
      frameTimes: [0.0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8],
      observations: [
        { phase: 'transition', observation: 'Shaft steepens early in the downswing with the trail shoulder moving out.', confidence: 0.55 },
      ],
      cues: ['Feel the club drop inside on the way down.'],
      summary: 'SENTINEL_COACH_PROSE_MIDDLE — more prose.',
    }),
    makeSwing({
      id: 'swing-newest',
      daysAgo: 2,
      anchorTime: 2.0,
      frameTimes: [0.0, 0.5, 1.0, 1.5, 1.8, 1.95, 2.05, 2.1, 2.4, 2.8],
      observations: [
        { phase: 'downswing', observation: 'Pelvis holds its distance from the ball into the strike.', confidence: 0.8 },
      ],
      cues: ['Keep the chest covering the ball through impact.'],
      summary: 'SENTINEL_COACH_PROSE_NEWEST — more prose.',
    }),
  ];
}

// ---------------------------------------------------------------------------
// Comparative detection + planning
// ---------------------------------------------------------------------------

test('comparative question produces a visual comparison plan naming both sides', () => {
  const swings = buildHistory();
  const current = swings[swings.length - 1];

  const plan = planVisualComparison({
    question: 'Is my early extension any different than it was in my first video?',
    currentSwing: current,
    swings,
    now: NOW,
  });

  assert.ok(plan, 'a comparative question must yield a plan');
  assert.equal(plan.needed, true);
  assert.ok(plan.kinds.length > 0);
  assert.ok(plan.priorSwing.analysisId);
  assert.notEqual(plan.priorSwing.analysisId, 'swing-newest');
  assert.equal(plan.currentSwing.analysisId, 'swing-newest');
  assert.ok(plan.priorFrameKeys.length > 0, 'prior frames must be named');
  assert.ok(plan.currentFrameKeys.length > 0, 'current frames must be named');
  assert.ok(plan.lookFor.length > 0);
  assert.ok(
    plan.lookFor.some((item) => item.topic === 'camera view match'),
    'every plan must check that the two clips share a camera view'
  );
});

test('"my first video" routes the comparison to the oldest session, not the most recent', () => {
  const swings = buildHistory();
  const plan = planVisualComparison({
    question: 'How does this compare to my very first swing video?',
    currentSwing: swings[2],
    swings,
    now: NOW,
  });

  assert.ok(plan);
  assert.equal(plan.priorSwing.analysisId, 'swing-oldest');
});

test('non-comparative questions produce no plan at all', () => {
  const swings = buildHistory();
  const questions = [
    'What should I work on next?',
    'How do I stop slicing my driver?',
    'What drill helps with early extension?',
    'Can you look at this swing for me?',
    'Should I change my grip?',
  ];

  questions.forEach((question) => {
    const plan = planVisualComparison({ question, currentSwing: swings[2], swings, now: NOW });
    assert.equal(plan, null, `"${question}" must not be treated as comparative`);
  });
});

test('persistence phrasing counts as comparative, unrelated "still" does not', () => {
  assert.equal(detectComparativeIntent('Am I still standing up through impact?').comparative, true);
  assert.equal(detectComparativeIntent('Am I still doing that thing with my hips?').comparative, true);
  assert.equal(detectComparativeIntent('I still do not understand the drill you gave me.').comparative, false);
});

test('a comparative question with no prior swing on record returns needed:false, not a fabricated plan', () => {
  const only = makeSwing({ id: 'swing-only', daysAgo: 1, anchorTime: 1.5, frameTimes: [0.5, 1.0, 1.4, 1.6, 2.3] });
  const plan = planVisualComparison({
    question: 'Is this any different than last time?',
    currentSwing: only,
    swings: [only],
    now: NOW,
  });

  assert.ok(plan);
  assert.equal(plan.needed, false);
  assert.equal(plan.priorSwing, null);
  assert.match(plan.reason, /no prior swing/i);
});

test('the plan never asserts a direction of change', () => {
  const swings = buildHistory();
  const plan = planVisualComparison({
    question: 'Has my early extension gotten any better since my first video?',
    currentSwing: swings[2],
    swings,
    now: NOW,
  });

  assert.ok(plan);
  const planJson = JSON.stringify({
    lookFor: plan.lookFor,
    gaps: plan.gaps,
    priorSwing: plan.priorSwing,
    currentSwing: plan.currentSwing,
  });
  assert.equal(CHANGE_DIRECTION_RE.test(planJson), false, `plan leaked change-direction language: ${planJson}`);
});

// ---------------------------------------------------------------------------
// Frame selection
// ---------------------------------------------------------------------------

test('anchor-based frame selection picks frames around impact', () => {
  const swing = makeSwing({
    id: 'swing-anchored',
    daysAgo: 1,
    anchorTime: 2.0,
    frameTimes: [0.0, 0.5, 1.0, 1.5, 1.8, 1.95, 2.05, 2.1, 2.4, 2.8],
  });

  const frames = selectComparableFrames(swing, { maxFrames: 4 });
  assert.equal(frames.length, 4);

  const hints = frames.map((item) => item.phaseHint);
  assert.deepEqual(hints.slice().sort(), ['finish', 'impact', 'pre_impact', 'top_transition']);

  const impact = frames.find((item) => item.phaseHint === 'impact');
  assert.ok(Math.abs(impact.timestamp - 2.1) < 0.06, `impact frame should sit near anchor+0.1s, got ${impact.timestamp}`);

  const preImpact = frames.find((item) => item.phaseHint === 'pre_impact');
  assert.ok(Math.abs(preImpact.timestamp - 1.8) < 0.06);

  const top = frames.find((item) => item.phaseHint === 'top_transition');
  assert.ok(Math.abs(top.timestamp - 1.0) < 0.06);

  // chronological order, and S3 keys derived from the frame urls
  const stamps = frames.map((item) => item.timestamp);
  assert.deepEqual(stamps, stamps.slice().sort((a, b) => a - b));
  frames.forEach((item) => {
    assert.match(item.key, /^golf-swings\/u1\/swing-anchored\/frames\//);
  });
});

test('legacy uniform records fall back to evenly spaced frames flagged approximate', () => {
  const swing = makeSwing({
    id: 'swing-legacy',
    daysAgo: 200,
    anchorTime: null,
    frameTimes: [0.0, 0.35, 0.7, 1.05, 1.4, 1.75, 2.1, 2.45, 2.8, 3.15],
  });

  const frames = selectComparableFrames(swing, { maxFrames: 4 });
  assert.equal(frames.length, 4);
  frames.forEach((item) => assert.equal(item.phaseHint, 'approximate'));
  assert.equal(frames[0].timestamp, 0.0);
  assert.equal(frames[frames.length - 1].timestamp, 3.15);

  const stamps = frames.map((item) => item.timestamp);
  assert.deepEqual(stamps, stamps.slice().sort((a, b) => a - b));
});

test('frame reading handles snake_case records and a JSON-string analysis_results', () => {
  const swing = makeSwing({ id: 'swing-json', daysAgo: 5, anchorTime: 1.6, frameTimes: [0.2, 0.6, 1.0, 1.4, 1.7, 1.75, 2.4] });
  const snake = {
    analysis_id: 'swing-json',
    captured_at: swing.capturedAt,
    analysis_results: JSON.stringify(swing.analysisResults),
  };

  const frames = selectComparableFrames(snake, { maxFrames: 4 });
  assert.equal(frames.length, 4);
  assert.ok(frames.some((item) => item.phaseHint === 'impact'));
  const impact = frames.find((item) => item.phaseHint === 'impact');
  assert.ok(Math.abs(impact.timestamp - 1.7) < 0.06);
});

test('a swing with no frames yields no frames and blocks the comparison honestly', () => {
  const bare = { analysisId: 'swing-bare', capturedAt: iso(30) };
  assert.deepEqual(selectComparableFrames(bare), []);

  const swings = [bare, makeSwing({ id: 'swing-now', daysAgo: 1, anchorTime: 1.2, frameTimes: [0.4, 0.9, 1.1, 1.3, 2.0] })];
  const plan = planVisualComparison({
    question: 'Is this the same as it was last time?',
    currentSwing: swings[1],
    swings,
    now: NOW,
  });

  assert.ok(plan);
  assert.equal(plan.needed, false);
  assert.match(plan.reason, /no stored frames/i);
});

// ---------------------------------------------------------------------------
// Prescription-verification guard
// ---------------------------------------------------------------------------

test('guard refutes a prescription that was never given', () => {
  const swings = buildHistory();
  const result = buildSwingMemory({
    question: 'Last time you told me to shorten my backswing, so why is it still long?',
    currentSwing: swings[2],
    swings,
    chatTurns: [],
    budgetTokens: 1200,
    now: NOW,
  });

  assert.ok(result.verification, 'the guard must fire on an asserted prescription');
  assert.equal(result.verification.asserted, true);
  assert.equal(result.verification.canonical, 'backswing_length');
  assert.equal(result.verification.found, false);
  assert.match(result.verification.instruction, /not supported by the record|no record/i);
  assert.match(result.context, /asserted_prior_advice/);
  assert.match(result.context, /supported_by_record":false/);
});

test('guard confirms a prescription that the record does contain', () => {
  const swings = buildHistory();
  swings[1].aiAnalysis.practice_recommendations = ['Stay in posture through the strike — hold your spine angle.'];

  const result = buildSwingMemory({
    question: 'You told me to stay in posture. Is that still the main thing?',
    currentSwing: swings[2],
    swings,
    now: NOW,
  });

  assert.ok(result.verification);
  assert.equal(result.verification.canonical, 'early_extension');
  assert.equal(result.verification.found, true);
  assert.ok(result.verification.evidence_items.length > 0);
});

test('guard distinguishes "observed but never prescribed" from "never happened"', () => {
  const swings = buildHistory();
  const result = buildSwingMemory({
    question: 'You told me to stop standing up through the ball, remember?',
    currentSwing: swings[2],
    swings,
    now: NOW,
  });

  assert.ok(result.verification);
  assert.equal(result.verification.canonical, 'early_extension');
  assert.equal(result.verification.found, false);
  assert.equal(result.verification.observed_only, true);
  assert.match(result.verification.instruction, /observation/i);
});

test('a question that asserts nothing about prior advice leaves verification null', () => {
  const swings = buildHistory();
  const result = buildSwingMemory({
    question: 'What should I work on this week?',
    currentSwing: swings[2],
    swings,
    now: NOW,
  });

  assert.equal(result.verification, null);
  assert.equal(result.comparisonPlan, null);
  assert.equal(result.rationale.guard.asserted, false);
});

// ---------------------------------------------------------------------------
// Rendering invariants
// ---------------------------------------------------------------------------

test('rendered context never carries a direction or degree of change', () => {
  const swings = buildHistory();
  // Plant graded change language everywhere a prior session could carry it.
  swings[0].aiAnalysis.visual_observations.push({
    phase: 'downswing',
    observation: 'Early extension is much better than it was and the severity has improved a lot.',
    confidence: 0.9,
  });
  swings[0].visualObservations = swings[0].aiAnalysis.visual_observations;
  swings[1].summary = 'Your swing has improved; the early extension is far better and much less severe.';

  const chatTurns = [
    { role: 'assistant', content: 'Great news, your early extension has improved a lot since last month.', timestamp: iso(20) },
    { role: 'user', content: 'It feels better than it did in March.', timestamp: iso(20) },
  ];

  const result = buildSwingMemory({
    question: 'Has my early extension improved since my first video?',
    currentSwing: swings[2],
    swings,
    chatTurns,
    budgetTokens: 1200,
    now: NOW,
  });

  assert.equal(
    CHANGE_DIRECTION_RE.test(result.context),
    false,
    `rendered context leaked change-direction language: ${result.context}`
  );
  assert.equal(/"severity"/i.test(result.context), false);
  assert.equal(result.rationale.safety.severityEmitted, false);
  // The comparative question still gets a plan; only the graded claims are gone.
  assert.ok(result.comparisonPlan);
  assert.match(result.context, /visual_comparison_plan/);
  assert.match(result.context, /direction_policy/);
});

test('coach prose is read for classification but never rendered into context', () => {
  const swings = buildHistory();
  const chatTurns = [
    { role: 'assistant', content: 'SENTINEL_ASSISTANT_TURN — hold your spine angle and stay in posture through the ball.', timestamp: iso(15) },
    { role: 'user', content: 'SENTINEL_PLAYER_TURN — my slice is killing me off the tee.', timestamp: iso(15) },
  ];

  const result = buildSwingMemory({
    question: 'You told me to stay in posture — is that still the priority for my early extension?',
    currentSwing: swings[2],
    swings,
    chatTurns,
    budgetTokens: 1200,
    now: NOW,
  });

  ['SENTINEL_COACH_PROSE_OLDEST', 'SENTINEL_COACH_PROSE_MIDDLE', 'SENTINEL_COACH_PROSE_NEWEST', 'SENTINEL_ASSISTANT_TURN']
    .forEach((sentinel) => {
      assert.equal(result.context.includes(sentinel), false, `${sentinel} leaked into rendered context`);
    });

  // The assistant turn was still READ: it is what verifies the claim.
  assert.ok(result.verification);
  assert.equal(result.verification.found, true);
  assert.ok(result.verification.evidence_items.some((item) => item.basis === 'coach_message'));
});

test('context stays inside the token budget and compacts when the budget shrinks', () => {
  const swings = buildHistory().concat([
    makeSwing({ id: 'swing-extra-1', daysAgo: 40, anchorTime: 1.9, frameTimes: [0.3, 0.9, 1.4, 1.7, 2.0, 2.6], observations: [{ phase: 'impact', observation: 'Trail heel stays down into the strike.', confidence: 0.5 }] }),
    makeSwing({ id: 'swing-extra-2', daysAgo: 70, anchorTime: 2.2, frameTimes: [0.4, 1.0, 1.6, 2.0, 2.3, 3.0], observations: [{ phase: 'top', observation: 'Lead wrist is cupped at the top of the backswing.', confidence: 0.6 }] }),
    makeSwing({ id: 'swing-extra-3', daysAgo: 95, anchorTime: 2.4, frameTimes: [0.5, 1.1, 1.7, 2.2, 2.5, 3.2], observations: [{ phase: 'downswing', observation: 'Pelvis slides ahead of the ball before the strike.', confidence: 0.6 }] }),
  ]);

  const question = 'Compared to my first video, am I still early extending and did we ever work on my tempo?';
  const chatTurns = Array.from({ length: 8 }, (unused, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Turn ${index}: a long message about early extension, tempo and how the range session went this week.`,
    timestamp: iso(30 + index),
  }));

  const generous = buildSwingMemory({ question, currentSwing: swings[2], swings, chatTurns, budgetTokens: 1200, now: NOW });
  assert.ok(estimateTokens(generous.context) <= 1200, `expected <=1200 tokens, got ${estimateTokens(generous.context)}`);
  assert.equal(generous.rationale.budget.withinBudget, true);

  const tight = buildSwingMemory({ question, currentSwing: swings[2], swings, chatTurns, budgetTokens: 600, now: NOW });
  assert.ok(estimateTokens(tight.context) <= 600, `expected <=600 tokens, got ${estimateTokens(tight.context)}`);
  assert.equal(tight.rationale.budget.withinBudget, true);
  assert.ok(tight.rationale.budget.compactionLevel > generous.rationale.budget.compactionLevel);

  // The load-bearing pieces survive compaction.
  assert.match(tight.context, /visual_comparison_plan/);
  assert.match(tight.context, /direction_policy/);
});

test('buildSwingMemory returns the documented shape and degrades on an empty history', () => {
  const result = buildSwingMemory({ question: 'How is my swing looking?', swings: [], now: NOW });

  assert.equal(typeof result.context, 'string');
  assert.equal(result.verification, null);
  assert.equal(result.comparisonPlan, null);
  assert.equal(typeof result.rationale, 'object');

  const parsed = JSON.parse(result.context);
  assert.equal(parsed.swing_memory.version, 'swing_memory.v1');
  assert.deepEqual(parsed.swing_memory.relevant_history, []);
  assert.match(parsed.swing_memory.note, /No prior coaching history/i);
});

test('analysis-time use (no question) still renders history without coach prose', () => {
  const swings = buildHistory();
  const result = buildSwingMemory({
    question: '',
    currentSwing: swings[2],
    swings,
    chatTurns: [{ role: 'assistant', content: 'SENTINEL_ANALYSIS_TIME — prior coaching paragraph.', timestamp: iso(3) }],
    budgetTokens: 1200,
    now: NOW,
  });

  assert.equal(result.comparisonPlan, null);
  assert.equal(result.verification, null);
  assert.equal(result.context.includes('SENTINEL_ANALYSIS_TIME'), false);
  const parsed = JSON.parse(result.context);
  assert.ok(parsed.swing_memory.relevant_history.length > 0);
});
