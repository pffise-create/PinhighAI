const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCombinedContext,
  verifyAssertedPrescription,
  detectAssertion,
  canonicalizeClaim,
  estimateTokens,
} = require('../src/memory/combinedMemory');

// ---------------------------------------------------------------------------
// Fixture: 8 sessions, 2025-09-21 -> 2026-06-03.
//
// Every piece of COACH PROSE carries a sentinel token (ZQSUMMARY*, ZQCUE*,
// ZQCOACHTURN*). Nothing with a sentinel may ever appear in rendered context —
// that is the anti-template-poisoning guarantee, tested by grep below.
//
// Ground truth built into the fixture:
//   early_extension  : prescribed (sessions 1, 2, 6, 8 + coach message + profile)
//   over_the_top     : session 3 only
//   casting          : session 4 only
//   tempo            : session 5 only
//   grip             : session 7 only
//   head_movement    : OBSERVED in session 5, never prescribed
//   backswing_length : 0 of 8 — the embedded-false-premise trap
//   reverse_pivot    : 0 of 8 — the direct-false-premise trap
// ---------------------------------------------------------------------------

function swing({ id, date, obs, cues, summary, metrics }) {
  return {
    analysisId: id,
    capturedAt: `${date}T17:00:00.000Z`,
    summary,
    metrics,
    visualObservations: obs,
    aiAnalysis: { practice_recommendations: cues, coaching_response: summary },
  };
}

const SWINGS = [
  swing({
    id: 'a_2025_09_21',
    date: '2025-09-21',
    summary: 'ZQSUMMARYONE You stand up out of your posture through the ball. Chair drill tonight.',
    metrics: { spine_angle_loss_deg: 12.5, hip_turn_deg: 34 },
    obs: [
      { phase: 'downswing', observation: 'Hips push toward the ball and the spine angle rises before impact.', confidence: 0.85, impact: 'negative', evidence_markers: ['pelvis'] },
      { phase: 'setup', observation: 'Athletic address position with good width.', confidence: 0.7, impact: 'positive' },
    ],
    cues: ['ZQCUEONE Chair drill to hold posture through the strike'],
  }),
  swing({
    id: 'b_2025_10_15',
    date: '2025-10-15',
    summary: 'ZQSUMMARYTWO Still losing posture, but less.',
    metrics: { spine_angle_loss_deg: 11.0, hip_turn_deg: 36 },
    obs: [{ phase: 'downswing', observation: 'Loss of posture is still visible through impact.', confidence: 0.75, impact: 'negative' }],
    cues: ['ZQCUETWO Keep the chest down through the ball'],
  }),
  swing({
    id: 'c_2025_11_20',
    date: '2025-11-20',
    summary: 'ZQSUMMARYTHREE Coming over the top on the way down.',
    metrics: { spine_angle_loss_deg: 9.5, hip_turn_deg: 38 },
    obs: [{ phase: 'transition', observation: 'The club moves out to in from the top and cuts across the ball.', confidence: 0.8, impact: 'negative' }],
    cues: ['ZQCUETHREE Pump drill to drop it inside'],
  }),
  swing({
    id: 'd_2026_01_10',
    date: '2026-01-10',
    summary: 'ZQSUMMARYFOUR Early release showing up.',
    metrics: { spine_angle_loss_deg: 9.0, hip_turn_deg: 39 },
    obs: [{ phase: 'downswing', observation: 'Early release of the wrists with a scoop into the ball.', confidence: 0.7, impact: 'negative' }],
    cues: ['ZQCUEFOUR Hold the angle a beat longer'],
  }),
  swing({
    id: 'e_2026_02_14',
    date: '2026-02-14',
    summary: 'ZQSUMMARYFIVE Rhythm is rushed.',
    metrics: { spine_angle_loss_deg: 8.5, hip_turn_deg: 40 },
    obs: [
      { phase: 'transition', observation: 'Tempo is rushed from the top of the swing.', confidence: 0.65, impact: 'negative' },
      { phase: 'swing_general', observation: 'The head dips slightly during the transition.', confidence: 0.4, impact: 'negative' },
    ],
    cues: ['ZQCUEFIVE Count a smooth two count'],
  }),
  swing({
    id: 'f_2026_03_30',
    date: '2026-03-30',
    summary: 'ZQSUMMARYSIX Posture is holding better.',
    metrics: { spine_angle_loss_deg: 6.0, hip_turn_deg: 42 },
    obs: [{ phase: 'downswing', observation: 'Some loss of posture remains but it is milder than before.', confidence: 0.5, impact: 'negative' }],
    cues: ['ZQCUESIX Same chair feel, hold posture'],
  }),
  swing({
    id: 'g_2026_05_01',
    date: '2026-05-01',
    summary: 'ZQSUMMARYSEVEN Grip is a touch strong.',
    metrics: { spine_angle_loss_deg: 5.5, hip_turn_deg: 43 },
    obs: [{ phase: 'setup', observation: 'The grip shows three knuckles on the lead hand at address.', confidence: 0.6, impact: 'negative' }],
    cues: ['ZQCUESEVEN Rotate the lead hand to a neutral grip'],
  }),
  swing({
    id: 'h_2026_06_03',
    date: '2026-06-03',
    summary: 'ZQSUMMARYEIGHT Much better through impact.',
    metrics: { spine_angle_loss_deg: 3.5, hip_turn_deg: 45 },
    obs: [
      { phase: 'downswing', observation: 'Only a slight rise in spine angle late; posture is far more stable.', confidence: 0.35, impact: 'negative' },
      { phase: 'follow_through', observation: 'Balanced finish held to completion.', confidence: 0.8, impact: 'positive' },
    ],
    cues: ['ZQCUEEIGHT Keep the same posture feel'],
  }),
];

const TURNS = [
  { role: 'user', content: 'I keep slicing it off the tee and I want to stop standing up.', timestamp: '2026-05-02T10:00:00.000Z' },
  { role: 'assistant', content: 'ZQCOACHTURNONE Stay in posture and let the chest cover the ball.', timestamp: '2026-05-02T10:00:30.000Z' },
];

const PROFILE = {
  focus_areas: ['hold posture through impact'],
  strengths: ['balanced finish'],
  total_swings_analyzed: 8,
  last_analysis_id: 'h_2026_06_03',
  last_analysis_at: '2026-06-03T17:00:00.000Z',
};

const NOW = Date.parse('2026-06-10T12:00:00.000Z');

const PROSE_SENTINELS = ['ZQSUMMARY', 'ZQCUE', 'ZQCOACHTURN'];

function build(question, overrides = {}) {
  return buildCombinedContext({
    question,
    swings: SWINGS,
    chatTurns: TURNS,
    swingProfile: PROFILE,
    now: NOW,
    ...overrides,
  });
}

function sessionByDate(result, date) {
  return result.rationale.sessionsRetrieved.find((entry) => entry.date === date) || null;
}

// ---------------------------------------------------------------------------
// 1. Retrieval + ledger fusion
// ---------------------------------------------------------------------------

test('retrieval selects an old session and the ledger supplies its change status', () => {
  const result = build('Am I still standing up through it like I was when I first started?');

  const oldest = sessionByDate(result, '2025-09-21');
  assert.ok(oldest, 'the months-old early-extension session should be retrieved');
  assert.equal(oldest.timeline_position, 'oldest_on_record');

  const status = oldest.change_status;
  assert.equal(status.tag, 'early_extension');
  assert.equal(status.at_session.status, 'baseline');
  assert.equal(status.since_then.status, 'improved');
  assert.equal(status.since_then.through, '2026-06-03');
  assert.equal(status.since_then.sessions_between, 7);
  assert.equal(status.first_seen, '2025-09-21');
  assert.equal(status.trend, 'improving');
});

test('change status for a retrieved old session is rendered into the context, not only the rationale', () => {
  const result = build('Am I still standing up through it like I was when I first started?');
  const parsed = JSON.parse(result.context);
  const sessions = parsed.coaching_memory.sessions;

  const oldest = sessions.find((entry) => entry.date === '2025-09-21');
  assert.ok(oldest, 'oldest session should be present in rendered context');
  assert.equal(oldest.change_status.since_then.status, 'improved');
  assert.match(oldest.change_status.since_then.basis, /0\.85->0\.35/);
  assert.ok(parsed.coaching_memory.status_legend.includes('improved'));
});

test('a mid-history session gets a real pairwise diff against its own predecessor', () => {
  const result = build('Has my loss of posture changed at all since last autumn?');
  const second = sessionByDate(result, '2025-10-15');
  assert.ok(second, 'the second early-extension session should be retrieved');
  assert.equal(second.change_status.at_session.vs_date, '2025-09-21');
  assert.match(second.change_status.at_session.basis, /severity/);
  assert.ok(['unchanged', 'improved', 'regressed'].includes(second.change_status.at_session.status));
});

test('a recurring tag absent from the prior session reads as returned, not new', () => {
  const result = build('What should I work on this week?');
  const latest = sessionByDate(result, '2026-06-03');
  assert.ok(latest);
  // early_extension was not in the 2026-05-01 session (grip), but it is 8 months old.
  assert.equal(latest.change_status.at_session.status, 'returned');
  assert.match(latest.change_status.at_session.basis, /first seen 2025-09-21/);
  assert.ok(latest.change_status.seen_in_sessions >= 2);
});

test('held-as-priority streaks are reported for retrieved sessions', () => {
  const result = build('Am I still standing up through it like I was when I first started?');
  const oldest = sessionByDate(result, '2025-09-21');
  assert.equal(oldest.change_status.held_as_priority_sessions, 2);
});

// ---------------------------------------------------------------------------
// 2. Prescription-verification guard
// ---------------------------------------------------------------------------

test('guard returns found:false for a prescription that never happened', () => {
  const result = build('Last time you told me to shorten my backswing, so why are we changing it now?');
  const verdict = result.verification;

  assert.ok(verdict, 'an embedded assertion must produce a verdict');
  assert.equal(verdict.asserted, true);
  assert.equal(verdict.form, 'embedded_assertion');
  assert.equal(verdict.claim, 'shorten my backswing');
  assert.equal(verdict.canonical, 'backswing_length');
  assert.equal(verdict.found, false);
  assert.equal(verdict.observed_only, false);
  assert.equal(verdict.sessions_checked, 8);
  assert.match(verdict.evidence, /no session .* prescribes this/);
  assert.match(verdict.instruction, /Do not confirm it/);
  assert.deepEqual(verdict.evidence_items, []);
});

test('guard returns found:true with dates when the prescription did happen', () => {
  const result = build('You told me to stay in posture. Is that still the priority?');
  const verdict = result.verification;

  assert.ok(verdict);
  assert.equal(verdict.canonical, 'early_extension');
  assert.equal(verdict.found, true);
  assert.ok(verdict.evidence_items.length > 0, 'found:true must carry dated evidence');
  verdict.evidence_items.forEach((item) => {
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(typeof item.basis === 'string' && item.basis.length > 0);
  });
  assert.ok(verdict.evidence_items.some((item) => item.date === '2025-09-21'));
  assert.match(verdict.evidence, /2025-09-21/);
  assert.match(verdict.instruction, /supported by the record/);
});

test('guard separates observed-but-never-prescribed from never-happened', () => {
  const result = build('You told me to keep my head still last time.');
  const verdict = result.verification;

  assert.equal(verdict.canonical, 'head_movement');
  assert.equal(verdict.found, false, 'head movement was observed, never prescribed');
  assert.equal(verdict.observed_only, true);
  assert.match(verdict.evidence, /never given as advice/);
  assert.match(verdict.instruction, /no record of advising this/i);
  assert.equal(verdict.evidence_items[0].date, '2026-02-14');
});

test('guard also fires on the direct false-premise question form', () => {
  const result = build('Did you ever tell me I had a reverse pivot?');
  const verdict = result.verification;

  assert.ok(verdict);
  assert.equal(verdict.form, 'direct_question');
  assert.equal(verdict.canonical, 'reverse_pivot');
  assert.equal(verdict.found, false);
});

test('guard handles a negated assertion by verifying the absence', () => {
  const verdict = verifyAssertedPrescription({
    question: 'You never told me to shorten my backswing.',
    swings: SWINGS,
    chatTurns: TURNS,
  });

  assert.ok(verdict);
  assert.equal(verdict.form, 'negated_assertion');
  assert.equal(verdict.canonical, 'backswing_length');
  assert.equal(verdict.found, false);
  assert.match(verdict.instruction, /Correct/);
});

test('guard reports found:null when the claim cannot be canonicalized', () => {
  const verdict = verifyAssertedPrescription({
    question: 'You told me to think about my left pinky finger.',
    swings: SWINGS,
  });

  assert.ok(verdict);
  assert.equal(verdict.canonical, null);
  assert.equal(verdict.found, null);
  assert.match(verdict.instruction, /unverified/);
});

test('questions that assert nothing about history produce verification:null', () => {
  ['What should I work on this week?',
    'Why do I slice my driver?',
    'Should I shorten my backswing?',
    'I told you my back is stiff.',
    'Is my hip turn any better?'].forEach((question) => {
    const result = build(question);
    assert.equal(result.verification, null, `"${question}" should not trip the guard`);
    assert.ok(!result.context.includes('asserted_prior_advice'));
  });
});

test('verifyAssertedPrescription works standalone with raw swings and no prebuilt ledger', () => {
  const verdict = verifyAssertedPrescription({
    question: 'Last time you told me to shorten my backswing.',
    swings: SWINGS,
  });
  assert.equal(verdict.canonical, 'backswing_length');
  assert.equal(verdict.found, false);
  assert.equal(verdict.sessions_checked, 8);
});

test('assertion detection and canonicalization are exposed and normalization-insensitive', () => {
  assert.equal(detectAssertion('what is my tempo like?'), null);
  assert.equal(detectAssertion('you had me working on holding my posture').form, 'embedded_assertion');
  ['shorten my backswing', 'shorten the backswing', 'shorten your backswing']
    .forEach((claim) => {
      assert.equal(canonicalizeClaim(claim).canonical, 'backswing_length', claim);
    });
});

test('the verdict is rendered into the context together with a rule that outranks the player framing', () => {
  const result = build('Last time you told me to shorten my backswing, why the change?');
  const parsed = JSON.parse(result.context);
  const verdict = parsed.coaching_memory.asserted_prior_advice;

  assert.ok(verdict, 'the verdict must reach the model, not just the caller');
  assert.equal(verdict.found, false);
  assert.equal(verdict.canonical, 'backswing_length');
  assert.ok(parsed.coaching_memory.rules.some((rule) => rule.includes('outranks')));
});

// ---------------------------------------------------------------------------
// 3. Budget enforcement
// ---------------------------------------------------------------------------

test('rendered context stays under the default 1200-token budget', () => {
  ['Am I still standing up through it like I was when I first started?',
    'Last time you told me to shorten my backswing, so why are we changing it now?',
    'You told me to stay in posture. Is that still the priority?',
    'What should I work on this week?',
    'Have I improved since September?'].forEach((question) => {
    const result = build(question);
    const tokens = estimateTokens(result.context);
    assert.ok(tokens <= 1200, `"${question}" rendered ${tokens} tokens`);
    assert.equal(result.rationale.budget.renderedTokens, tokens);
  });
});

test('a tight budget degrades detail but still fits and keeps the verdict', () => {
  const result = build('Last time you told me to shorten my backswing, why the change?', { budgetTokens: 420 });
  const tokens = estimateTokens(result.context);

  assert.ok(tokens <= 420, `rendered ${tokens} tokens against a 420 budget`);
  assert.ok(result.rationale.budget.detailLevel > 0, 'detail should have been shed');
  const parsed = JSON.parse(result.context);
  assert.ok(parsed.coaching_memory.asserted_prior_advice, 'the verdict is never dropped for budget');
  assert.equal(parsed.coaching_memory.asserted_prior_advice.found, false);
  assert.ok(parsed.coaching_memory.sessions.length >= 1);
});

test('an extreme budget falls through to the floor payload without crashing', () => {
  const full = build('You told me to stay in posture, right?');
  const result = build('You told me to stay in posture, right?', { budgetTokens: 120 });
  const tokens = estimateTokens(result.context);
  const parsed = JSON.parse(result.context);

  // The verdict is irreducible: a budget smaller than the verdict is deliberately
  // not honoured, because dropping the verdict is the exact failure C exists to fix.
  assert.ok(tokens < estimateTokens(full.context), `floor rendered ${tokens} tokens`);
  assert.ok(tokens <= 300, `floor rendered ${tokens} tokens`);
  assert.ok(parsed.coaching_memory.asserted_prior_advice);
  assert.equal(parsed.coaching_memory.truncated, true);
  assert.equal(parsed.coaching_memory.sessions.length, 1);
});

// ---------------------------------------------------------------------------
// 4. Anti-template-poisoning
// ---------------------------------------------------------------------------

test('no prior coach prose leaks into the rendered context', () => {
  const questions = [
    'Am I still standing up through it like I was when I first started?',
    'Last time you told me to shorten my backswing, so why are we changing it now?',
    'You told me to stay in posture. Is that still the priority?',
    'What should I work on this week?',
    'Did you ever tell me I had a reverse pivot?',
    'Have I improved since September?',
    'What did my very first video look like?',
  ];

  questions.forEach((question) => {
    const context = build(question).context;
    PROSE_SENTINELS.forEach((sentinel) => {
      assert.ok(
        !context.includes(sentinel),
        `coach prose sentinel ${sentinel} leaked for question: ${question}`
      );
    });
    // Belt and braces: no verbatim summary, cue or coach-turn sentence.
    SWINGS.forEach((entry) => {
      assert.ok(!context.includes(entry.summary));
      entry.aiAnalysis.practice_recommendations.forEach((cue) => {
        assert.ok(!context.includes(cue));
      });
    });
    TURNS.forEach((turn) => {
      assert.ok(!context.includes(turn.content), 'no chat turn text may be rendered');
    });
  });
});

test('conversation memory is rendered as canonical tags only', () => {
  const result = build('Am I still standing up like I told you in chat?');
  const parsed = JSON.parse(result.context);
  const tags = parsed.coaching_memory.conversation_tags || [];

  assert.ok(!result.context.includes('slicing'), 'raw player wording must not be rendered');
  tags.forEach((entry) => {
    assert.ok(['player', 'coach'].includes(entry.role));
    entry.tags.forEach((tag) => assert.match(tag, /^[a-z0-9_]+$/));
    assert.equal(Object.keys(entry).sort().join(','), 'role,tags,when');
  });
});

test('player-stated facts are canonical tags, never free text fragments', () => {
  const result = build('What should I work on this week?');
  const parsed = JSON.parse(result.context);
  const stated = parsed.coaching_memory.player_stated || {};
  Object.values(stated).forEach((values) => {
    values.forEach((value) => assert.match(value, /^[a-z0-9_]+$/));
  });
});

// ---------------------------------------------------------------------------
// 5. Degenerate inputs
// ---------------------------------------------------------------------------

test('an empty history renders a note and still verifies assertions', () => {
  const result = buildCombinedContext({
    question: 'Last time you told me to shorten my backswing.',
    swings: [],
    chatTurns: [],
    now: NOW,
  });
  const parsed = JSON.parse(result.context);

  assert.equal(parsed.coaching_memory.sessions.length, 0);
  assert.match(parsed.coaching_memory.note, /no prior coaching sessions/);
  assert.equal(result.verification.found, false);
  assert.equal(result.verification.sessions_checked, 0);
});

test('missing input produces a valid, budgeted, prose-free context', () => {
  const result = buildCombinedContext();
  assert.equal(typeof result.context, 'string');
  assert.equal(result.verification, null);
  assert.ok(estimateTokens(result.context) <= 1200);
  JSON.parse(result.context);
});

test('the current swing is excluded from retrieved history', () => {
  const result = build('Is this better than before?', { currentSwing: SWINGS[7] });
  assert.ok(!result.rationale.sessionsRetrieved.some((entry) => entry.analysisId === 'h_2026_06_03'));
});
