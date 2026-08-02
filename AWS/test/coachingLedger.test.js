const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LEDGER_VERSION,
  buildLedger,
  renderLedgerContext,
  buildLedgerContext,
  diffSwings,
  diffTag,
  diffMetrics,
  metricDirection,
  estimateTokens,
  __private,
} = require('../src/memory/coachingLedger');

// ---------------------------------------------------------------------------
// Fixtures shaped exactly like swingRepository.getLastAnalyzedSwings() output.
// ---------------------------------------------------------------------------

function makeSwing({
  analysisId,
  capturedAt,
  severity = 0.7,
  metrics = {},
  observationText = 'Hips move toward the ball through impact, a clear early extension pattern.',
  phase = 'downswing',
  impact = 'negative',
  extraObservations = [],
  cues = ['Chair drill to keep the hips back through impact'],
  summary = 'Coaching prose that must never reach the model context verbatim.',
}) {
  return {
    analysisId,
    userId: 'user-1',
    status: 'AI_COMPLETED',
    createdAt: capturedAt,
    capturedAt,
    summary,
    visualObservations: [
      {
        id: 'obs_1',
        phase,
        observation: observationText,
        confidence: severity,
        impact,
        evidence: { markers: ['hips', 'belt line'] },
      },
      ...extraObservations,
    ],
    analysisResults: {
      frames_extracted: 32,
      video_duration: 4.2,
      metrics,
    },
    aiAnalysis: {
      coaching_response: summary,
      practice_recommendations: cues,
      visual_observations: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Empty history
// ---------------------------------------------------------------------------

test('buildLedger handles empty history without throwing', () => {
  const ledger = buildLedger({});

  assert.equal(ledger.version, LEDGER_VERSION);
  assert.deepEqual(ledger.entries, []);
  assert.deepEqual(ledger.patterns, []);
  assert.equal(ledger.held_streak, null);
  assert.equal(ledger.player.sessions_logged, 0);
  assert.equal(ledger.player.first_session_date, null);
  assert.equal(ledger.player.span_days, null);
});

test('renderLedgerContext on empty history yields tiny valid JSON', () => {
  const rendered = renderLedgerContext(buildLedger({ swings: [] }));
  const parsed = JSON.parse(rendered);

  assert.equal(parsed.ledger_version, LEDGER_VERSION);
  assert.deepEqual(parsed.sessions, []);
  assert.equal(parsed.player.sessions_logged, 0);
  assert.match(parsed.note, /no prior coaching sessions/);
  assert.ok(estimateTokens(rendered) < 50, `expected tiny payload, got ${estimateTokens(rendered)}`);
});

test('renderLedgerContext tolerates a null ledger', () => {
  const parsed = JSON.parse(renderLedgerContext(null));
  assert.deepEqual(parsed.sessions, []);
});

// ---------------------------------------------------------------------------
// Single swing
// ---------------------------------------------------------------------------

test('single swing produces one entry with a priority tag and no carryover', () => {
  const ledger = buildLedger({
    swings: [makeSwing({ analysisId: 'a1', capturedAt: '2026-03-01T12:00:00Z', severity: 0.8 })],
    swingProfile: { total_swings_analyzed: 1, focus_areas: ['early extension'], strengths: [] },
  });

  assert.equal(ledger.entries.length, 1);
  const [entry] = ledger.entries;
  assert.equal(entry.session, 1);
  assert.equal(entry.swing, 'a1');
  assert.equal(entry.date, '2026-03-01');
  assert.equal(entry.priority, 'early_extension');
  assert.equal(entry.carryover, null);
  assert.equal(entry.evidence.severity, 0.8);
  assert.deepEqual(entry.evidence.markers, ['hips', 'belt line']);
  assert.equal(ledger.player.span_days, 0);
  assert.deepEqual(ledger.recurring_patterns, []);
});

test('render never leaks prior coaching prose', () => {
  const prose = 'Feel like your belt buckle stays pointed down as you rotate through.';
  const ledger = buildLedger({
    swings: [makeSwing({ analysisId: 'a1', capturedAt: '2026-03-01T12:00:00Z', summary: prose })],
  });

  const rendered = renderLedgerContext(ledger);
  assert.ok(!rendered.includes('belt buckle'), 'coaching prose leaked into rendered context');
  assert.ok(!rendered.includes('Feel like'), 'coaching prose leaked into rendered context');
  assert.ok(rendered.includes('early_extension'), 'expected canonical tag in rendered context');
});

test('legacy swings without visual observations still yield tags from text', () => {
  const legacy = {
    analysisId: 'legacy-1',
    capturedAt: '2026-01-05T00:00:00Z',
    summary: 'You are coming over the top and casting the club from the top of the backswing.',
    aiAnalysis: { coaching_response: 'You are coming over the top and casting the club.' },
    analysisResults: {},
  };

  const ledger = buildLedger({ swings: [legacy] });
  assert.equal(ledger.entries.length, 1);
  assert.ok(['over_the_top', 'casting'].includes(ledger.entries[0].priority));
  assert.equal(ledger.entries[0].evidence.source, 'inferred_from_prior_text');

  const rendered = renderLedgerContext(ledger);
  assert.ok(!rendered.includes('coming over the top and casting'), 'legacy prose leaked');
});

// ---------------------------------------------------------------------------
// Multi-swing: improving
// ---------------------------------------------------------------------------

test('multi-swing improving metric is reported as improved', () => {
  // Repository returns newest-first; the ledger must re-order chronologically.
  const swings = [
    makeSwing({ analysisId: 'a3', capturedAt: '2026-05-01T00:00:00Z', severity: 0.35, metrics: { hip_sway_inches: 2.0 } }),
    makeSwing({ analysisId: 'a2', capturedAt: '2026-04-01T00:00:00Z', severity: 0.6, metrics: { hip_sway_inches: 3.4 } }),
    makeSwing({ analysisId: 'a1', capturedAt: '2026-03-01T00:00:00Z', severity: 0.85, metrics: { hip_sway_inches: 5.1 } }),
  ];

  const ledger = buildLedger({ swings, swingProfile: { total_swings_analyzed: 3 } });

  assert.deepEqual(ledger.entries.map((entry) => entry.swing), ['a1', 'a2', 'a3']);
  assert.equal(ledger.entries[0].carryover, null);
  assert.equal(ledger.entries[1].carryover.tag, 'early_extension');
  assert.equal(ledger.entries[1].carryover.status, 'improved');
  assert.equal(ledger.entries[2].carryover.status, 'improved');

  const pattern = ledger.recurring_patterns.find((entry) => entry.tag === 'early_extension');
  assert.ok(pattern, 'expected recurring early_extension pattern');
  assert.equal(pattern.sessions_seen, 3);
  assert.equal(pattern.trend, 'improving');
  assert.deepEqual(pattern.first_seen, { session: 1, date: '2026-03-01', swing: 'a1' });

  assert.deepEqual(ledger.held_streak, {
    tag: 'early_extension',
    consecutive_sessions: 3,
    since_date: '2026-03-01',
    since_swing: 'a1',
  });

  const metricMove = ledger.entries[2].metric_moves.find((move) => move.metric === 'hip_sway_inches');
  assert.equal(metricMove.status, 'improved');
  assert.equal(metricMove.from, 3.4);
  assert.equal(metricMove.to, 2);

  // Pipeline metrics must never surface as swing progress.
  const rendered = renderLedgerContext(ledger);
  assert.ok(!rendered.includes('frames_extracted'));
  assert.ok(!rendered.includes('video_duration'));
});

// ---------------------------------------------------------------------------
// Multi-swing: regressing
// ---------------------------------------------------------------------------

test('multi-swing regressing severity is reported as regressed', () => {
  const swings = [
    makeSwing({ analysisId: 'b1', capturedAt: '2026-03-01T00:00:00Z', severity: 0.3, metrics: { hip_sway_inches: 2.0 } }),
    makeSwing({ analysisId: 'b2', capturedAt: '2026-04-01T00:00:00Z', severity: 0.9, metrics: { hip_sway_inches: 5.5 } }),
  ];

  const ledger = buildLedger({ swings });

  assert.equal(ledger.entries[1].carryover.status, 'regressed');
  assert.match(ledger.entries[1].carryover.basis, /^severity 0\.3->0\.9$/);
  assert.equal(ledger.recurring_patterns[0].trend, 'worsening');

  const move = ledger.entries[1].metric_moves.find((entry) => entry.metric === 'hip_sway_inches');
  assert.equal(move.status, 'regressed');
});

test('a metric with no known direction is reported as unknown, not guessed', () => {
  const diffs = diffMetrics({ mystery_index: 10 }, { mystery_index: 20 });
  assert.equal(diffs[0].status, 'unknown');
  assert.equal(diffs[0].direction, 'unknown');

  const overridden = diffMetrics({ mystery_index: 10 }, { mystery_index: 20 }, {
    metricDirections: { mystery_index: 'higher_is_better' },
  });
  assert.equal(overridden[0].status, 'improved');
});

test('metricDirection infers direction from metric naming', () => {
  assert.equal(metricDirection('hip_sway_inches'), 'lower_is_better');
  assert.equal(metricDirection('shoulder_turn_deg'), 'higher_is_better');
  assert.equal(metricDirection('foo_bar'), 'unknown');
  assert.equal(metricDirection('foo_bar', { foo_bar: 'lower_is_better' }), 'lower_is_better');
});

test('diffTag distinguishes new, unchanged, and absent patterns', () => {
  const previous = __private.summarizeSwing(makeSwing({
    analysisId: 'p1', capturedAt: '2026-03-01T00:00:00Z', severity: 0.7,
  }));
  const sameish = __private.summarizeSwing(makeSwing({
    analysisId: 'p2', capturedAt: '2026-04-01T00:00:00Z', severity: 0.65,
  }));
  const clean = __private.summarizeSwing(makeSwing({
    analysisId: 'p3',
    capturedAt: '2026-05-01T00:00:00Z',
    observationText: 'Tempo is smooth and the transition is unhurried.',
    phase: 'swing_general',
    impact: 'positive',
    severity: 0.8,
  }));

  assert.equal(diffTag('early_extension', previous, sameish).status, 'unchanged');
  assert.equal(diffTag('early_extension', previous, clean).status, 'improved');
  assert.equal(diffTag('early_extension', previous, clean).basis, 'not_observed_this_session');
  assert.equal(diffTag('tempo', previous, clean).status, 'new');
  assert.equal(diffTag('early_extension', null, clean).status, 'unknown');
});

test('diffSwings accepts raw repository shapes', () => {
  const diff = diffSwings({
    previous: makeSwing({ analysisId: 'x1', capturedAt: '2026-03-01T00:00:00Z', severity: 0.8, metrics: { hip_sway_inches: 5 } }),
    current: makeSwing({ analysisId: 'x2', capturedAt: '2026-04-01T00:00:00Z', severity: 0.4, metrics: { hip_sway_inches: 2 } }),
  });

  assert.equal(diff.previous, 'x1');
  assert.equal(diff.current, 'x2');
  assert.equal(diff.tags.find((tag) => tag.tag === 'early_extension').status, 'improved');
  assert.equal(diff.metrics[0].status, 'improved');
  assert.deepEqual(diffSwings({}), { previous: null, current: null, tags: [], metrics: [] });
});

// ---------------------------------------------------------------------------
// Durable facts
// ---------------------------------------------------------------------------

test('chat turns contribute durable player-stated facts', () => {
  const ledger = buildLedger({
    swings: [makeSwing({ analysisId: 'a1', capturedAt: '2026-03-01T00:00:00Z' })],
    chatTurns: [
      { role: 'user', content: 'I keep hitting a slice off the tee and I have a bad back.' },
      { role: 'assistant', content: 'Let us look at your path — never mine assistant text.' },
      { role: 'user', content: 'I want to stop the early extension for good.' },
    ],
  });

  assert.ok(ledger.player_stated.misses.includes('slice'));
  assert.ok(ledger.player_stated.goals.includes('early_extension'));
  assert.ok(ledger.player_stated.constraints.includes('bad back'));
});

test('strengths that never appear as faults are ruled out, not treated as patterns', () => {
  const swings = [
    makeSwing({
      analysisId: 'a1',
      capturedAt: '2026-03-01T00:00:00Z',
      extraObservations: [{
        id: 'obs_2',
        phase: 'setup',
        observation: 'Posture at address and alignment are consistently solid.',
        confidence: 0.85,
        impact: 'positive',
        evidence: { markers: ['stance'] },
      }],
    }),
  ];

  const ledger = buildLedger({ swings, swingProfile: { strengths: ['great ball position and stance width'] } });

  assert.ok(ledger.ruled_out.some((entry) => entry.tag === 'setup_alignment'));
  assert.ok(!ledger.patterns.some((pattern) => pattern.tag === 'setup_alignment'));
});

// ---------------------------------------------------------------------------
// Token budget / truncation
// ---------------------------------------------------------------------------

function makeLongHistory(count) {
  const swings = [];
  for (let index = 0; index < count; index += 1) {
    const month = String((index % 12) + 1).padStart(2, '0');
    swings.push(makeSwing({
      analysisId: `analysis-00000000-0000-4000-8000-00000000000${index}`,
      capturedAt: `2026-${month}-15T00:00:00Z`,
      severity: 0.9 - index * 0.05,
      metrics: { hip_sway_inches: 6 - index * 0.3, shoulder_turn_deg: 70 + index * 2 },
      cues: [
        'Chair drill to keep the hips back through impact and hold posture all the way to the finish',
        'Slow motion rehearsals focused on tempo and rhythm before every full swing',
      ],
      summary: `Session ${index} coaching prose that is deliberately long so that the payload has real weight and must be trimmed.`,
    }));
  }
  return swings;
}

test('render respects maxEntries and flags truncation', () => {
  const ledger = buildLedger({ swings: makeLongHistory(10), maxSessions: 12 });
  assert.equal(ledger.entries.length, 10);

  const parsed = JSON.parse(renderLedgerContext(ledger, { maxEntries: 4, maxTokens: 4000 }));

  assert.equal(parsed.sessions.length, 4);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.sessions_omitted, 6);
  // Session 1 is always retained so "the same pattern as your first video" works.
  assert.equal(parsed.sessions[0].n, 1);
  assert.equal(parsed.sessions[parsed.sessions.length - 1].n, 10);
});

test('render stays inside the default ~1200 token budget for a long history', () => {
  const ledger = buildLedger({ swings: makeLongHistory(10) });
  const rendered = renderLedgerContext(ledger);

  assert.ok(estimateTokens(rendered) <= 1200, `expected <=1200 tokens, got ${estimateTokens(rendered)}`);
  const parsed = JSON.parse(rendered);
  assert.ok(parsed.sessions.length > 0);
});

test('render degrades under tight token budgets and stays valid JSON', () => {
  const ledger = buildLedger({ swings: makeLongHistory(10) });

  [600, 400, 250, 150, 80].forEach((maxTokens) => {
    const rendered = renderLedgerContext(ledger, { maxEntries: 8, maxTokens });
    assert.ok(
      estimateTokens(rendered) <= maxTokens,
      `budget ${maxTokens} exceeded: got ${estimateTokens(rendered)}`
    );
    const parsed = JSON.parse(rendered);
    assert.equal(parsed.ledger_version, LEDGER_VERSION);
    assert.ok(Array.isArray(parsed.sessions));
    assert.ok(parsed.sessions.length >= 1, 'at least the newest session must survive');
  });
});

test('tighter budgets never render more detail than looser ones', () => {
  const ledger = buildLedger({ swings: makeLongHistory(10) });
  const loose = renderLedgerContext(ledger, { maxEntries: 8, maxTokens: 1200 }).length;
  const tight = renderLedgerContext(ledger, { maxEntries: 8, maxTokens: 400 }).length;
  assert.ok(tight <= loose, 'tight budget produced a larger payload than the loose budget');
});

test('cue text is excluded by default and opt-in only', () => {
  const swings = [makeSwing({
    analysisId: 'a1',
    capturedAt: '2026-03-01T00:00:00Z',
    cues: ['Chair drill: keep the hips back'],
  })];
  const ledger = buildLedger({ swings });

  assert.ok(!renderLedgerContext(ledger).includes('Chair drill'));
  assert.ok(renderLedgerContext(ledger, { includeCueText: true }).includes('Chair drill'));
});

// ---------------------------------------------------------------------------
// Ordering + convenience wrapper
// ---------------------------------------------------------------------------

test('swings without dates fall back to newest-first input ordering', () => {
  const swings = [
    { analysisId: 'newest', visualObservations: [], analysisResults: {}, summary: 'over the top' },
    { analysisId: 'oldest', visualObservations: [], analysisResults: {}, summary: 'casting the club' },
  ];

  const ledger = buildLedger({ swings });
  assert.deepEqual(ledger.entries.map((entry) => entry.swing), ['oldest', 'newest']);
});

test('buildLedgerContext is a one-shot wrapper returning a context string', () => {
  const rendered = buildLedgerContext({
    swings: [makeSwing({ analysisId: 'a1', capturedAt: '2026-03-01T00:00:00Z' })],
    swingProfile: { total_swings_analyzed: 4 },
    chatTurns: [],
  }, { maxEntries: 3 });

  const parsed = JSON.parse(rendered);
  assert.equal(parsed.player.total_swings_analyzed, 4);
  assert.equal(parsed.sessions[0].swing, 'a1');
});

test('estimateTokens approximates 4 characters per token', () => {
  assert.equal(estimateTokens('12345678'), 2);
  assert.equal(estimateTokens(''), 0);
});
