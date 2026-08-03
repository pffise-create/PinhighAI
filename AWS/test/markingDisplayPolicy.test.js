const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { shouldShowMarking } = require(path.join(__dirname, '..', 'src', 'marking', 'displayPolicy.js'));

// --- fixtures ---------------------------------------------------------------

function geometry({ view = 'dtl', width = 1080, height = 1920, headR = 0.06, markings } = {}) {
  return {
    marker_version: '2.1.0',
    frame_width: width,
    frame_height: height,
    view: { label: view, confidence: 0.9, spread_ratio: 0.03 },
    facing: 'right',
    markings: markings || {
      plane_line: { x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.2, confidence: 0.66 },
      spine_line: { x1: 0.3, y1: 0.6, x2: 0.4, y2: 0.3, confidence: 0.61 },
      head_circle: { cx: 0.5, cy: 0.2, r: headR, confidence: 0.71 },
    },
  };
}

function marking({ generated = true, rendered = ['head_circle', 'plane_line', 'spine_line'], failures = [], geo = geometry() } = {}) {
  return {
    version: '2.1.0',
    generated,
    markings_rendered: rendered,
    failures,
    geometry: geo,
    frames_marked: 4,
  };
}

function frames(prefix, { marked = true, phaseHints = ['address', 'top', 'impact', 'finish'] } = {}) {
  return phaseHints.map((phaseHint, i) => ({
    phase: `frame_${String(i).padStart(3, '0')}`,
    phaseHint,
    timestamp: i * 0.3,
    key: `golf-swings/u1/${prefix}/frames/${prefix}/frame_${i}.jpg`,
    url: `https://bucket.s3.amazonaws.com/golf-swings/u1/${prefix}/frames/${prefix}/frame_${i}.jpg`,
    markedKey: marked ? `golf-swings/u1/${prefix}/frames/${prefix}/marked/frame_${i}.jpg` : null,
    markedUrl: marked ? `https://bucket.s3.amazonaws.com/golf-swings/u1/${prefix}/frames/${prefix}/marked/frame_${i}.jpg` : null,
  }));
}

function side(prefix, overrides = {}) {
  return {
    analysisId: prefix,
    capturedAt: '2026-06-03T10:00:00Z',
    anchored: true,
    marking: marking(),
    frames: frames(prefix),
    ...overrides,
  };
}

const COMPARISON = { needed: true, comparative: true, kinds: ['change_over_time'] };

// --- show / no-show ---------------------------------------------------------

test('policy: a plane question with a good plane line shows a single marked frame', () => {
  const decision = shouldShowMarking({
    question: 'Am I coming over the top on the way down?',
    markingAvailable: { current: side('a1') },
  });
  assert.equal(decision.show, true);
  assert.equal(decision.kind, 'single');
  assert.equal(decision.marking, 'plane_line');
  assert.equal(decision.frames.length, 1);
  assert.equal(decision.frames[0].role, 'current');
  assert.ok(decision.frames[0].s3_key.includes('/marked/'), 'must point at the marked variant');
});

test('policy: a comparative question about something no marking measures shows nothing', () => {
  const decision = shouldShowMarking({
    question: 'Has my tempo changed since my first video?',
    markingAvailable: { prior: side('old1'), current: side('a1') },
    comparison: COMPARISON,
  });
  assert.equal(decision.show, false);
  assert.match(decision.reason, /no marking measures/);
});

test('policy: an unrelated question never shows a marking', () => {
  const decision = shouldShowMarking({
    question: 'What should I practice this week?',
    markingAvailable: { current: side('a1') },
  });
  assert.equal(decision.show, false);
  assert.equal(decision.kind, null);
  assert.match(decision.reason, /does not ask about anything the markings answer/);
  assert.deepEqual(decision.frames, []);
});

test('policy: markings are never shown by default — the coach can veto outright', () => {
  const decision = shouldShowMarking({
    question: 'Is my swing plane too steep?',
    coachIntent: { show: false },
    markingAvailable: { current: side('a1') },
  });
  assert.equal(decision.show, false);
  assert.match(decision.reason, /coach chose not to show/);
});

test('policy: the coach can request a marking explicitly', () => {
  const decision = shouldShowMarking({
    question: 'Why do I keep slicing it?',
    coachIntent: { show: true, topic: 'plane' },
    markingAvailable: { current: side('a1') },
  });
  assert.equal(decision.show, true);
  assert.equal(decision.marking, 'plane_line');
});

test('policy: a head-movement question is answered by the head circle, not the plane line', () => {
  const decision = shouldShowMarking({
    question: 'Does my head sway off the ball in the backswing?',
    markingAvailable: { current: side('a1') },
  });
  assert.equal(decision.show, true);
  assert.equal(decision.marking, 'head_circle');
});

// --- withheld / failed markings --------------------------------------------

test('policy: a withheld marking is never shown, and the reason names the failure', () => {
  const current = side('a1', {
    marking: marking({
      rendered: ['head_circle'],
      failures: [{ marking: 'plane_line', reason: 'no ball confirmed at clubhead' }],
      geo: geometry({ markings: { head_circle: { cx: 0.5, cy: 0.2, r: 0.06, confidence: 0.71 } } }),
    }),
  });
  const decision = shouldShowMarking({ question: 'Am I on plane at the top?', markingAvailable: { current } });
  assert.equal(decision.show, false);
  assert.match(decision.reason, /plane_line was withheld/);
  assert.match(decision.reason, /no ball confirmed/);
});

test('policy: marking generated:false (failed closed upstream) is never shown', () => {
  const current = side('a1', { marking: { generated: false, reason: 'swing_marker unavailable: no module named cv2' } });
  const decision = shouldShowMarking({ question: 'Is my spine angle ok?', markingAvailable: { current } });
  assert.equal(decision.show, false);
  assert.match(decision.reason, /marking unavailable/);
});

test('policy: a low-confidence marking is below the display bar', () => {
  const current = side('a1', {
    marking: marking({
      rendered: ['plane_line'],
      geo: geometry({ markings: { plane_line: { x1: 0, y1: 0, x2: 1, y2: 1, confidence: 0.46 } } }),
    }),
  });
  const decision = shouldShowMarking({ question: 'Am I too steep?', markingAvailable: { current } });
  assert.equal(decision.show, false);
  assert.match(decision.reason, /below the 0.5 display bar/);
});

test('policy: a marking with no recorded confidence fails closed', () => {
  const current = side('a1', {
    marking: marking({
      rendered: ['plane_line'],
      geo: geometry({ markings: { plane_line: { x1: 0, y1: 0, x2: 1, y2: 1 } } }),
    }),
  });
  const decision = shouldShowMarking({ question: 'Am I too steep?', markingAvailable: { current } });
  assert.equal(decision.show, false);
  assert.match(decision.reason, /no recorded confidence/);
});

test('policy: no stored marked frame means nothing to show', () => {
  const current = side('a1', { frames: frames('a1', { marked: false }) });
  const decision = shouldShowMarking({ question: 'Am I over the top?', markingAvailable: { current } });
  assert.equal(decision.show, false);
  assert.match(decision.reason, /no marked frame is stored/);
});

// --- side by side -----------------------------------------------------------

test('policy: then-vs-now comparison shows the SAME marking on both swings at impact', () => {
  const decision = shouldShowMarking({
    question: 'Is my swing plane better than my first video?',
    markingAvailable: { prior: side('old1', { capturedAt: '2025-09-20T10:00:00Z' }), current: side('a1') },
    comparison: COMPARISON,
  });
  assert.equal(decision.show, true);
  assert.equal(decision.kind, 'side_by_side');
  assert.equal(decision.marking, 'plane_line');
  assert.equal(decision.frames.length, 2);
  assert.deepEqual(decision.frames.map((f) => f.role), ['prior', 'current']);
  assert.deepEqual(decision.frames.map((f) => f.phase_hint), ['impact', 'impact']);
  assert.ok(decision.frames.every((f) => f.s3_key.includes('/marked/')));
  assert.ok(decision.frames[0].label.includes('2025-09-20'));
});

test('policy: a comparative question with no named topic defaults to the flagship plane comparison', () => {
  const decision = shouldShowMarking({
    question: 'How does this compare to my very first video?',
    markingAvailable: { prior: side('old1'), current: side('a1') },
    comparison: COMPARISON,
  });
  assert.equal(decision.show, true);
  assert.equal(decision.kind, 'side_by_side');
  assert.equal(decision.marking, 'plane_line');
});

test('policy: side_by_side is refused when the two sessions were filmed from different views', () => {
  const decision = shouldShowMarking({
    question: 'Is my plane better than before?',
    markingAvailable: {
      prior: side('old1', { marking: marking({ geo: geometry({ view: 'face_on' }) }) }),
      current: side('a1'),
    },
    comparison: COMPARISON,
  });
  assert.equal(decision.show, false, 'half a comparison is a wrong answer, not a partial one');
  assert.equal(decision.kind, null);
  assert.match(decision.reason, /different views \(face_on vs dtl\)/);
});

test('policy: side_by_side is refused when the framing (aspect ratio) differs', () => {
  const decision = shouldShowMarking({
    question: 'Is my plane better than before?',
    markingAvailable: {
      prior: side('old1', { marking: marking({ geo: geometry({ width: 1920, height: 1080 }) }) }),
      current: side('a1'),
    },
    comparison: COMPARISON,
  });
  assert.match(decision.reason, /different framings \(1920x1080 vs 1080x1920\)/);
  assert.notEqual(decision.kind, 'side_by_side');
});

test('policy: side_by_side is refused when a session was extracted without an impact anchor', () => {
  const decision = shouldShowMarking({
    question: 'Is my plane better than before?',
    markingAvailable: {
      prior: side('old1', { anchored: false, extractionMode: 'fallback-uniform' }),
      current: side('a1'),
    },
    comparison: COMPARISON,
  });
  assert.match(decision.reason, /without an impact anchor/);
  assert.notEqual(decision.kind, 'side_by_side');
});

test('policy: side_by_side is refused when the camera distance differs too much', () => {
  const decision = shouldShowMarking({
    question: 'Is my plane better than before?',
    markingAvailable: {
      prior: side('old1', { marking: marking({ geo: geometry({ headR: 0.02 }) }) }),
      current: side('a1'),
    },
    comparison: COMPARISON,
  });
  assert.match(decision.reason, /camera distance differs too much/);
  assert.notEqual(decision.kind, 'side_by_side');
});

test('policy: side_by_side is refused when the prior swing has no marking at all', () => {
  const decision = shouldShowMarking({
    question: 'Is my plane better than my first video?',
    markingAvailable: { current: side('a1') },
    comparison: COMPARISON,
  });
  assert.equal(decision.show, false);
  assert.match(decision.reason, /prior swing has no marking record/);
});

test('policy: side_by_side is refused when only one side carries the marking type', () => {
  const decision = shouldShowMarking({
    question: 'How does my swing plane compare to before?',
    markingAvailable: {
      prior: side('old1', {
        marking: marking({
          rendered: ['head_circle'],
          failures: [{ marking: 'plane_line', reason: 'view ambiguous' }],
          geo: geometry({ markings: { head_circle: { cx: 0.5, cy: 0.2, r: 0.06, confidence: 0.7 } } }),
        }),
      }),
      current: side('a1'),
    },
    comparison: COMPARISON,
  });
  assert.notEqual(decision.kind, 'side_by_side');
  assert.match(decision.reason, /prior swing: the plane_line was withheld/);
});

// --- entitlement ------------------------------------------------------------

test('policy: entitlement is reported, not enforced', () => {
  const decision = shouldShowMarking({
    question: 'Am I over the top?',
    markingAvailable: { current: side('a1') },
    entitlementActive: false,
  });
  assert.equal(decision.show, true, 'the policy decides on evidence; the caller applies paywall policy');
  assert.equal(decision.entitlement_active, false);
});

test('policy: garbage input degrades to no-show rather than throwing', () => {
  assert.equal(shouldShowMarking().show, false);
  assert.equal(shouldShowMarking({ question: 'plane?', markingAvailable: null }).show, false);
  assert.equal(shouldShowMarking({ question: 'plane?', markingAvailable: { current: {} } }).show, false);
});
