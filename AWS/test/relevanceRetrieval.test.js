const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectRelevantHistory,
  renderRetrievedContext,
  scoreRelevance,
  analyzeQuery,
  detectTemporalCue,
  extractFaults,
  extractPhases,
  estimateTokens,
} = require('../src/memory/relevanceRetrieval');

const NOW = Date.parse('2026-08-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days) {
  return new Date(NOW - days * DAY).toISOString();
}

function makeSwing({ id, days, observations = [], metrics = null, summary = null }) {
  return {
    analysisId: id,
    userId: 'user-1',
    status: 'AI_COMPLETED',
    capturedAt: daysAgo(days),
    createdAt: daysAgo(days),
    summary,
    metrics,
    visualObservations: observations.map((obs, index) => ({
      id: `obs_${index + 1}`,
      phase: obs.phase || 'swing_general',
      observation: obs.text,
      confidence: obs.confidence != null ? obs.confidence : 0.8,
      impact: obs.impact || 'negative',
    })),
    aiAnalysis: {
      coaching_response: summary || 'Coaching response text.',
      visual_observations: [],
    },
  };
}

// Oldest -> newest. The "first video" is 210 days old and is about early extension.
const OLDEST_SWING = makeSwing({
  id: 'swing-oldest',
  days: 210,
  metrics: { tempo_ratio: 2.6, video_duration: 4.1 },
  summary: 'Baseline swing from the very first upload.',
  observations: [
    { phase: 'impact', text: 'Clear early extension: the hips push toward the ball and the spine angle rises through impact.' },
    { phase: 'setup', text: 'Setup posture is athletic with neutral spine angle.', impact: 'positive' },
  ],
});

const MIDDLE_SWING = makeSwing({
  id: 'swing-middle',
  days: 60,
  metrics: { tempo_ratio: 2.9, video_duration: 4.3 },
  summary: 'Mid-season check-in.',
  observations: [
    { phase: 'transition', text: 'The club works over the top from the top of the backswing, producing an out to in path.' },
    { phase: 'backswing', text: 'Backswing length is under control at the top.', impact: 'neutral' },
  ],
});

const NEWEST_SWING = makeSwing({
  id: 'swing-newest',
  days: 2,
  metrics: { tempo_ratio: 3.0, video_duration: 4.0 },
  summary: 'Most recent session.',
  observations: [
    { phase: 'downswing', text: 'Some casting shows up: the wrist angle releases early on the way down.' },
    { phase: 'follow_through', text: 'Finish is balanced and full.', impact: 'positive' },
  ],
});

const ALL_SWINGS = [NEWEST_SWING, MIDDLE_SWING, OLDEST_SWING]; // repository order: newest first

const CHAT_TURNS = [
  { role: 'user', content: 'What should I work on with my early extension?', timestamp: daysAgo(200) },
  { role: 'assistant', content: 'Focus on keeping your pelvis back through the strike.', timestamp: daysAgo(200) },
  { role: 'user', content: 'How is my tempo looking these days?', timestamp: daysAgo(5) },
  { role: 'assistant', content: 'Tempo is steady around a 3 to 1 ratio.', timestamp: daysAgo(5) },
];

// ---------------------------------------------------------------------------

test('temporal cue "first swing" retrieves the OLDEST swing, not the newest', () => {
  const selection = selectRelevantHistory({
    question: 'Is this better than my first video?',
    swings: ALL_SWINGS,
    chatTurns: [],
    now: NOW,
  });

  assert.equal(selection.rationale.temporal.cue, 'oldest');
  assert.equal(selection.selectedSwings[0].analysisId, 'swing-oldest');
  assert.equal(selection.selectedSwings[0].relevance.timelinePosition, 'oldest_on_record');
  assert.equal(selection.rationale.strategy, 'temporal:oldest');
});

test('"earliest" and "when I started" also resolve to the oldest cue', () => {
  assert.equal(detectTemporalCue('show me my earliest upload', NOW).cue, 'oldest');
  assert.equal(detectTemporalCue('how does this compare to when I started', NOW).cue, 'oldest');
});

test('fault synonyms match stored coach vocabulary ("standing up" -> early extension)', () => {
  assert.deepEqual(extractFaults('am I still standing up through it?'), ['early_extension']);
  assert.ok(extractFaults('hips push toward the ball and the spine angle rises').includes('early_extension'));

  const selection = selectRelevantHistory({
    question: 'Am I still standing up through it?',
    swings: ALL_SWINGS,
    chatTurns: [],
    now: NOW,
  });

  assert.deepEqual(selection.rationale.queryFaultKeys, ['early_extension']);
  assert.equal(
    selection.selectedSwings[0].analysisId,
    'swing-oldest',
    'the months-old early-extension swing must outrank the two newer swings'
  );
  assert.ok(
    selection.selectedSwings[0].relevance.reasons.some((reason) => reason.includes('early extension')),
    'rationale should name the matched fault'
  );
});

test('other fault synonyms map to their canonical faults', () => {
  assert.ok(extractFaults('I keep coming over the top').includes('over_the_top'));
  assert.ok(extractFaults('feels like I am losing lag and flipping it').includes('casting'));
  assert.ok(extractFaults('my lead arm chicken wings at impact').includes('chicken_wing'));
  assert.ok(extractFaults('there is a reverse pivot at the top').includes('reverse_pivot'));
  assert.ok(extractFaults('my hips sway off the ball').includes('sway'));
  assert.ok(extractPhases('what happens through impact').includes('impact'));
});

test('"did I ever fix my early extension" scans the whole history, not just the newest', () => {
  const selection = selectRelevantHistory({
    question: 'Did I ever fix my early extension?',
    swings: ALL_SWINGS,
    chatTurns: CHAT_TURNS,
    now: NOW,
  });

  assert.equal(selection.rationale.temporal.cue, 'span');
  const ids = selection.selectedSwings.map((swing) => swing.analysisId);
  assert.ok(ids.includes('swing-oldest'), 'the early-extension swing must be retrieved');
  assert.equal(ids[0], 'swing-oldest');
});

test('recency still wins for a generic question with no cues', () => {
  const selection = selectRelevantHistory({
    question: 'What should I work on next?',
    swings: ALL_SWINGS,
    chatTurns: [],
    now: NOW,
  });

  assert.equal(selection.rationale.temporal.cue, null);
  assert.equal(selection.rationale.strategy, 'recency-dominant');
  assert.equal(selection.rationale.weights.temporal, 0);
  assert.equal(selection.selectedSwings[0].analysisId, 'swing-newest');
});

test('a "last month" question prefers swings inside the window', () => {
  const selection = selectRelevantHistory({
    question: 'How did my swing look in the last month?',
    swings: ALL_SWINGS,
    now: NOW,
  });

  assert.equal(selection.rationale.temporal.cue, 'window');
  assert.equal(selection.selectedSwings[0].analysisId, 'swing-newest');
});

test('budget truncation drops low-ranked items and reports it', () => {
  const selection = selectRelevantHistory({
    question: 'Am I still standing up through it?',
    swings: ALL_SWINGS,
    chatTurns: CHAT_TURNS,
    budgetTokens: 90,
    now: NOW,
  });

  assert.equal(selection.selectedSwings.length, 1, 'only the top swing survives a tight budget');
  assert.equal(selection.selectedSwings[0].analysisId, 'swing-oldest');
  assert.ok(selection.rationale.budget.truncated);
  assert.ok(selection.rationale.budget.droppedSwings >= 1);

  const generous = selectRelevantHistory({
    question: 'Am I still standing up through it?',
    swings: ALL_SWINGS,
    chatTurns: CHAT_TURNS,
    budgetTokens: 1200,
    now: NOW,
  });
  assert.ok(generous.selectedSwings.length > selection.selectedSwings.length);
});

test('rendered context stays inside the ~1200 token target', () => {
  const selection = selectRelevantHistory({
    question: 'Did I ever fix my early extension?',
    swings: ALL_SWINGS,
    chatTurns: CHAT_TURNS,
    budgetTokens: 1200,
    now: NOW,
  });

  const rendered = renderRetrievedContext(selection);
  assert.equal(typeof rendered, 'string');
  assert.ok(estimateTokens(rendered) < 1200, `rendered context too large: ${estimateTokens(rendered)}`);
  const parsed = JSON.parse(rendered);
  assert.ok(Array.isArray(parsed.retrieved_history.swings));
  assert.ok(parsed.retrieved_history.swings[0].capturedAt);
  assert.ok(parsed.retrieved_history.swings[0].timeline_position);
  assert.ok(parsed.retrieved_history.rules.some((rule) => /not by recency/i.test(rule)));
});

test('a large verbose history still renders inside the token budget', () => {
  const verbose = 'The hips push toward the ball through impact and the spine angle rises noticeably, which forces the hands to work up and out of the way to save the strike. '.repeat(2);
  const bigHistory = [];
  for (let i = 0; i < 12; i += 1) {
    bigHistory.push(makeSwing({
      id: `bulk-${i}`,
      days: i * 25,
      metrics: { tempo_ratio: 2.8, video_duration: 4.2, fps: 30 },
      summary: 'x'.repeat(800),
      observations: [
        { phase: 'impact', text: verbose },
        { phase: 'downswing', text: verbose },
        { phase: 'setup', text: verbose },
        { phase: 'transition', text: verbose },
        { phase: 'follow_through', text: verbose },
      ],
    }));
  }
  const bulkTurns = [];
  for (let i = 0; i < 24; i += 1) {
    bulkTurns.push({
      role: i % 2 ? 'assistant' : 'user',
      content: `long message ${i} about early extension and tempo `.repeat(6),
      timestamp: daysAgo(24 - i),
    });
  }

  ['Am I still standing up through it?', 'Is this better than my first video?', 'What should I work on next?'].forEach((question) => {
    const selection = selectRelevantHistory({
      question,
      swings: bigHistory,
      chatTurns: bulkTurns,
      budgetTokens: 1200,
      now: NOW,
    });
    const actual = estimateTokens(renderRetrievedContext(selection));
    assert.ok(actual <= 1200, `"${question}" rendered ${actual} tokens, over budget`);
    assert.equal(selection.rationale.budget.truncated, true);
    assert.ok(selection.selectedSwings.length >= 1);
  });
});

test('empty history is safe and produces an explicit no-history note', () => {
  const selection = selectRelevantHistory({
    question: 'Is this better than my first video?',
    swings: [],
    chatTurns: [],
    now: NOW,
  });

  assert.deepEqual(selection.selectedSwings, []);
  assert.deepEqual(selection.selectedTurns, []);
  assert.equal(selection.rationale.empty, true);
  assert.equal(selection.rationale.historySpan, null);

  const rendered = JSON.parse(renderRetrievedContext(selection));
  assert.equal(rendered.retrieved_history.swings.length, 0);
  assert.match(rendered.retrieved_history.note, /No prior coaching history/);

  // Fully defensive: no arguments at all.
  const bare = selectRelevantHistory();
  assert.deepEqual(bare.selectedSwings, []);
  assert.equal(typeof renderRetrievedContext(null), 'string');
});

test('analysis mode never emits prior coaching prose (no template poisoning)', () => {
  const selection = selectRelevantHistory({
    question: '',
    currentSwing: NEWEST_SWING,
    swings: ALL_SWINGS,
    chatTurns: CHAT_TURNS,
    now: NOW,
  });

  const rendered = renderRetrievedContext(selection, { mode: 'analysis' });
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.retrieved_history.conversation_excerpts.length, 0);
  assert.ok(!/coaching response text/i.test(rendered));
  assert.ok(!/Focus on keeping your pelvis back/i.test(rendered));
  assert.ok(!/Mid-season check-in/i.test(rendered));
  // The current swing is never retrieved as its own history.
  assert.ok(!selection.selectedSwings.some((swing) => swing.analysisId === 'swing-newest'));
});

test('chat mode may include older conversation excerpts, de-prioritizing the live window', () => {
  const manyTurns = [];
  for (let i = 0; i < 20; i += 1) {
    manyTurns.push({ role: 'user', content: `filler message about putting number ${i}`, timestamp: daysAgo(30 - i) });
  }
  const turns = [
    { role: 'user', content: 'My early extension is killing my irons', timestamp: daysAgo(180) },
    ...manyTurns,
  ];

  const selection = selectRelevantHistory({
    question: 'Am I still standing up through it?',
    swings: ALL_SWINGS,
    chatTurns: turns,
    liveWindowTurns: 12,
    now: NOW,
  });

  const rendered = JSON.parse(renderRetrievedContext(selection, { mode: 'chat' }));
  assert.ok(rendered.retrieved_history.conversation_excerpts.length > 0);
  assert.match(rendered.retrieved_history.conversation_excerpts[0].text, /early extension/i);
});

test('scoreRelevance is directly callable and exposes its signals', () => {
  const query = analyzeQuery({ question: 'am I still standing up through it?', now: NOW });
  const hit = scoreRelevance({ query, candidate: OLDEST_SWING, now: NOW, ordinal: 0, total: 3 });
  const miss = scoreRelevance({ query, candidate: NEWEST_SWING, now: NOW, ordinal: 2, total: 3 });

  assert.ok(hit.score > miss.score);
  assert.equal(hit.signals.fault, 1);
  assert.equal(miss.signals.fault, 0);
  assert.ok(typeof hit.signals.recency === 'number');
  assert.ok(Array.isArray(hit.reasons));
});

test('metric proximity is used when a current swing is supplied', () => {
  const query = analyzeQuery({ question: 'how does this compare', now: NOW });
  const scored = scoreRelevance({
    query,
    candidate: MIDDLE_SWING,
    currentSwing: NEWEST_SWING,
    now: NOW,
    ordinal: 1,
    total: 3,
  });
  assert.ok(scored.signals.metric > 0.9, 'similar tempo ratios should score high proximity');
});

test('text rendering format is available for prompt debugging', () => {
  const selection = selectRelevantHistory({
    question: 'Is this better than my first video?',
    swings: ALL_SWINGS,
    now: NOW,
  });
  const text = renderRetrievedContext(selection, { format: 'text' });
  assert.match(text, /Retrieved coaching history/);
  assert.match(text, /swing-oldest/);
});
