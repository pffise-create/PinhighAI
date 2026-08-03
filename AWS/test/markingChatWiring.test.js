// Mode 2 chat wiring: marked frames are attached and surfaced only when the
// display policy says show, and never when the flag is off.
const Module = require('module');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const HANDLER_PATH = path.join(__dirname, '..', 'src', 'api-handlers', 'chat-api-handler.js');
const CHAT_LOOP_PATH = path.join(__dirname, '..', 'src', 'chat', 'chatLoop.js');

// Every S3 GetObject the handler makes, in order, so a test can assert WHICH
// frame variant was fetched.
const s3Requests = [];

const originalLoad = Module._load;
function withAwsStubs(fn) {
  Module._load = function (request, parent, isMain) {
    if (request === '@aws-sdk/client-s3') {
      return {
        S3Client: class {
          async send(command) {
            s3Requests.push(command.input.Key);
            return {
              Body: (async function* () {
                yield Buffer.from('jpeg-bytes');
              })(),
            };
          }
        },
        GetObjectCommand: class {
          constructor(input) {
            this.input = input;
          }
        },
      };
    }
    if (request.startsWith('@aws-sdk/')) {
      return new Proxy({}, { get: () => class {} });
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    return fn();
  } finally {
    Module._load = originalLoad;
  }
}

// The display flag is read once at module load, so each mode needs its own
// module instance.
function loadHandler({ displayEnabled }) {
  const previous = process.env.SWING_MARKING_DISPLAY_ENABLED;
  if (displayEnabled) {
    process.env.SWING_MARKING_DISPLAY_ENABLED = 'true';
  } else {
    delete process.env.SWING_MARKING_DISPLAY_ENABLED;
  }
  return withAwsStubs(() => {
    for (const key of Object.keys(require.cache)) {
      if (key.includes(`${path.sep}AWS${path.sep}src${path.sep}`)) {
        delete require.cache[key];
      }
    }
    const handler = require(HANDLER_PATH);
    if (previous === undefined) {
      delete process.env.SWING_MARKING_DISPLAY_ENABLED;
    } else {
      process.env.SWING_MARKING_DISPLAY_ENABLED = previous;
    }
    return handler;
  });
}

// --- fixtures ---------------------------------------------------------------

const GEOMETRY = {
  marker_version: '2.1.0',
  frame_width: 1080,
  frame_height: 1920,
  view: { label: 'dtl', confidence: 0.9, spread_ratio: 0.03 },
  facing: 'right',
  markings: {
    plane_line: { x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.2, confidence: 0.66 },
    head_circle: { cx: 0.5, cy: 0.2, r: 0.06, confidence: 0.71 },
  },
};

function storedFrames(analysisId, { marked = true } = {}) {
  return [0, 1, 2, 3].map((i) => {
    const key = `golf-swings/u1/${analysisId}/frames/${analysisId}/frame_${String(i).padStart(3, '0')}.jpg`;
    const frame = {
      phase: `frame_${String(i).padStart(3, '0')}`,
      url: `https://bucket.s3.amazonaws.com/${key}`,
      timestamp: i * 0.3,
    };
    if (marked) {
      const markedKey = `golf-swings/u1/${analysisId}/frames/${analysisId}/marked/frame_${String(i).padStart(3, '0')}.jpg`;
      frame.marked_key = markedKey;
      frame.marked_url = `https://bucket.s3.amazonaws.com/${markedKey}`;
    }
    return frame;
  });
}

function swing(analysisId, { marked = true, generated = true, capturedAt = '2026-06-03T10:00:00Z' } = {}) {
  return {
    analysisId,
    capturedAt,
    analysisResults: {
      frames: storedFrames(analysisId, { marked }),
      extraction: { version: '2.0', mode: 'event-anchored', anchor_time: '3.12' },
      marking: generated
        ? {
            version: '2.1.0',
            generated: true,
            markings_rendered: ['head_circle', 'plane_line'],
            failures: [],
            geometry: GEOMETRY,
            frames_marked: 4,
          }
        : { version: '2.1.0', generated: false, reason: 'swing_marker unavailable', markings_rendered: [], failures: [] },
    },
  };
}

function planFrames(analysisId) {
  return ['address', 'top', 'impact', 'finish'].map((phaseHint, i) => ({
    url: `https://bucket.s3.amazonaws.com/golf-swings/u1/${analysisId}/frames/${analysisId}/frame_${String(i).padStart(3, '0')}.jpg`,
    key: `golf-swings/u1/${analysisId}/frames/${analysisId}/frame_${String(i).padStart(3, '0')}.jpg`,
    timestamp: i * 0.3,
    phaseHint,
    sourcePhase: `frame_${String(i).padStart(3, '0')}`,
  }));
}

function plan({ prior = 'old1', current = 'a1' } = {}) {
  return {
    needed: true,
    comparative: true,
    kinds: ['change_over_time'],
    priorSwing: { analysisId: prior, capturedAt: '2025-09-20T10:00:00Z', extractionMode: 'event-anchored' },
    currentSwing: { analysisId: current, capturedAt: '2026-06-03T10:00:00Z', extractionMode: 'event-anchored' },
    priorFrames: planFrames(prior),
    currentFrames: planFrames(current),
  };
}

// --- loadComparisonFrames ---------------------------------------------------

test('chat wiring: marked frames are used and reported when the policy says show', async () => {
  const handler = loadHandler({ displayEnabled: true });
  s3Requests.length = 0;
  const result = await withAwsStubs(() => handler.__private.loadComparisonFrames(plan(), {
    swings: [swing('a1'), swing('old1', { capturedAt: '2025-09-20T10:00:00Z' })],
    question: 'Is my swing plane better than my first video?',
  }));

  assert.equal(result.groups.length, 2, 'both halves of the comparison are attached');
  assert.equal(s3Requests.length, 2, 'one marked frame per side, not the whole sequence');
  assert.ok(s3Requests.every((key) => key.includes('/marked/')), `expected marked keys, got ${s3Requests}`);
  assert.equal(result.display_frames.length, 2);
  assert.deepEqual(result.display_frames.map((f) => f.role), ['prior', 'current']);
  assert.equal(result.display_frames[0].kind, 'side_by_side');
  assert.ok(result.display_frames[0].s3_key.includes('/marked/'));
  assert.equal(result.display_meta.kind, 'side_by_side');
  assert.equal(result.display_meta.marking, 'plane_line');
});

test('chat wiring: plain frames are used when the display flag is off', async () => {
  const handler = loadHandler({ displayEnabled: false });
  s3Requests.length = 0;
  const result = await withAwsStubs(() => handler.__private.loadComparisonFrames(plan(), {
    swings: [swing('a1'), swing('old1')],
    question: 'Is my swing plane better than my first video?',
  }));

  assert.equal(result.groups.length, 2);
  assert.ok(s3Requests.length > 2, 'the plain path attaches the whole comparable sequence');
  assert.ok(s3Requests.every((key) => !key.includes('/marked/')), `expected plain keys, got ${s3Requests}`);
  assert.deepEqual(result.display_frames, []);
  assert.equal(result.display_meta, null);
});

test('chat wiring: plain frames are used when the question is unrelated to any marking', async () => {
  const handler = loadHandler({ displayEnabled: true });
  s3Requests.length = 0;
  const result = await withAwsStubs(() => handler.__private.loadComparisonFrames(plan(), {
    swings: [swing('a1'), swing('old1')],
    question: 'Has my tempo changed since my first video?',
  }));
  assert.deepEqual(result.display_frames, []);
  assert.ok(s3Requests.every((key) => !key.includes('/marked/')));
  assert.equal(result.groups.length, 2, 'the comparison itself still happens on plain frames');
});

test('chat wiring: a swing whose marking failed closed falls back to plain frames', async () => {
  const handler = loadHandler({ displayEnabled: true });
  s3Requests.length = 0;
  const result = await withAwsStubs(() => handler.__private.loadComparisonFrames(plan(), {
    swings: [swing('a1'), swing('old1', { generated: false, marked: false })],
    question: 'Is my swing plane better than my first video?',
  }));
  assert.deepEqual(result.display_frames, []);
  assert.ok(s3Requests.every((key) => !key.includes('/marked/')));
});

test('chat wiring: a plan that is not needed loads nothing', async () => {
  const handler = loadHandler({ displayEnabled: true });
  s3Requests.length = 0;
  const result = await withAwsStubs(() => handler.__private.loadComparisonFrames({ needed: false }, { swings: [], question: 'x' }));
  assert.deepEqual(result.groups, []);
  assert.deepEqual(result.display_frames, []);
  assert.equal(s3Requests.length, 0);
});

test('chat wiring: the marked-frame cross-link survives frames stored without an explicit key', async () => {
  const handler = loadHandler({ displayEnabled: true });
  const annotated = handler.__private.annotateFramesWithMarked(planFrames('a1'), swing('a1'));
  assert.equal(annotated.length, 4);
  assert.ok(annotated.every((frame) => frame.markedKey && frame.markedKey.includes('/marked/')));
});

// --- single-frame display (frame re-review path) ----------------------------

test('chat wiring: a plane question about one swing selects a marked frame to show', () => {
  const handler = loadHandler({ displayEnabled: true });
  const decision = handler.__private.decideSingleMarkingDisplay({
    swing: swing('a1'),
    question: 'Am I coming over the top?',
  });
  assert.equal(decision.show, true);
  assert.equal(decision.kind, 'single');
  assert.equal(decision.frames.length, 1);
  assert.ok(decision.frames[0].s3_key.includes('/marked/'));
  assert.ok(decision.frames[0].plain_url, 'the plain URL is carried so the loader can swap it');
});

test('chat wiring: the single-frame path shows nothing when the flag is off', () => {
  const handler = loadHandler({ displayEnabled: false });
  const decision = handler.__private.decideSingleMarkingDisplay({
    swing: swing('a1'),
    question: 'Am I coming over the top?',
  });
  assert.equal(decision.show, false);
  assert.match(decision.reason, /SWING_MARKING_DISPLAY_ENABLED/);
});

test('chat wiring: the single-frame path shows nothing for an unmarked swing', () => {
  const handler = loadHandler({ displayEnabled: true });
  const decision = handler.__private.decideSingleMarkingDisplay({
    swing: swing('a1', { generated: false, marked: false }),
    question: 'Am I coming over the top?',
  });
  assert.equal(decision.show, false);
});

// --- payload ----------------------------------------------------------------

test('chat wiring: the response payload carries display_frames', async () => {
  const handler = loadHandler({ displayEnabled: true });
  const displayFrames = [{ role: 'prior', kind: 'side_by_side', s3_key: 'a/marked/b.jpg', label: 'EARLIER SWING' }];
  const payload = await handler.__private.buildChatSuccessPayload({
    userContext: {},
    userMessage: 'is my plane better?',
    coachReply: 'Here is what changed.',
    extra: { display_frames: displayFrames, display_frames_meta: { kind: 'side_by_side', marking: 'plane_line' } },
  });
  assert.equal(payload.success, true);
  assert.deepEqual(payload.display_frames, displayFrames);
  assert.equal(payload.display_frames_meta.kind, 'side_by_side');
});

// --- chatLoop ---------------------------------------------------------------

test('chat wiring: chatLoop passes swings + question to the loader and returns display frames', async () => {
  const loaded = withAwsStubs(() => {
    for (const key of Object.keys(require.cache)) {
      if (key.includes(`${path.sep}AWS${path.sep}src${path.sep}`)) {
        delete require.cache[key];
      }
    }
    const chatLoop = require(CHAT_LOOP_PATH);
    const swingRepository = require(path.join(__dirname, '..', 'src', 'data', 'swingRepository.js'));
    const chatRepository = require(path.join(__dirname, '..', 'src', 'data', 'chatRepository.js'));
    const swingProfileRepository = require(path.join(__dirname, '..', 'src', 'data', 'swingProfileRepository.js'));
    return { chatLoop, swingRepository, chatRepository, swingProfileRepository };
  });

  const history = [swing('a1'), swing('old1', { capturedAt: '2025-09-20T10:00:00Z' })];
  loaded.swingRepository.getLastAnalyzedSwings = async ({ limit }) => history.slice(0, limit);
  loaded.chatRepository.getRecentTurns = async () => [];
  loaded.chatRepository.recordTurn = async () => ({});
  loaded.swingProfileRepository.getProfile = async () => null;

  let loaderArgs = null;
  const payloads = [];
  const result = await loaded.chatLoop.executeChatLoop({
    userId: 'u1',
    userMessage: 'Is my swing plane better than my first video?',
    dynamoClient: {},
    requestOpenAi: async (payload) => {
      payloads.push(payload);
      return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    visualQuestionTool: null,
    comparisonFrameLoader: async (plan_, context) => {
      loaderArgs = { plan: plan_, context };
      return {
        groups: [
          { label: 'EARLIER SWING', date: '2025-09-20', images: ['data:image/jpeg;base64,AAA'] },
          { label: 'CURRENT SWING', date: '2026-06-03', images: ['data:image/jpeg;base64,BBB'] },
        ],
        display_frames: [
          { role: 'prior', kind: 'side_by_side', s3_key: 'old1/marked/f.jpg', label: 'EARLIER SWING' },
          { role: 'current', kind: 'side_by_side', s3_key: 'a1/marked/f.jpg', label: 'CURRENT SWING' },
        ],
        display_meta: { kind: 'side_by_side', marking: 'plane_line', reason: 'ok' },
      };
    },
  });

  assert.ok(loaderArgs, 'the loader must be called for a comparative question');
  assert.ok(Array.isArray(loaderArgs.context.swings), 'the loader needs the swing records to read marking data');
  assert.equal(loaderArgs.context.question, 'Is my swing plane better than my first video?');
  assert.equal(result.displayFrames.length, 2);
  assert.equal(result.displayMeta.kind, 'side_by_side');

  const imgs = payloads[0].messages.flatMap((m) => (Array.isArray(m.content)
    ? m.content.filter((p) => p.type === 'image_url') : []));
  assert.equal(imgs.length, 2);
  const permission = payloads[0].messages.find((m) => typeof m.content === 'string'
    && m.content.includes('You may refer to what is drawn'));
  assert.ok(permission, 'when frames are shown, the Mode 1 silence rule is lifted for that turn');
});

test('chat wiring: a legacy array-returning loader still works and shows nothing', async () => {
  const loaded = withAwsStubs(() => {
    for (const key of Object.keys(require.cache)) {
      if (key.includes(`${path.sep}AWS${path.sep}src${path.sep}`)) {
        delete require.cache[key];
      }
    }
    const chatLoop = require(CHAT_LOOP_PATH);
    const swingRepository = require(path.join(__dirname, '..', 'src', 'data', 'swingRepository.js'));
    const chatRepository = require(path.join(__dirname, '..', 'src', 'data', 'chatRepository.js'));
    const swingProfileRepository = require(path.join(__dirname, '..', 'src', 'data', 'swingProfileRepository.js'));
    return { chatLoop, swingRepository, chatRepository, swingProfileRepository };
  });

  loaded.swingRepository.getLastAnalyzedSwings = async ({ limit }) => [swing('a1'), swing('old1')].slice(0, limit);
  loaded.chatRepository.getRecentTurns = async () => [];
  loaded.chatRepository.recordTurn = async () => ({});
  loaded.swingProfileRepository.getProfile = async () => null;

  const payloads = [];
  const result = await loaded.chatLoop.executeChatLoop({
    userId: 'u1',
    userMessage: 'Is my swing plane better than my first video?',
    dynamoClient: {},
    requestOpenAi: async (payload) => {
      payloads.push(payload);
      return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    visualQuestionTool: null,
    comparisonFrameLoader: async () => ([
      { label: 'EARLIER SWING', date: '2025-09-20', images: ['data:image/jpeg;base64,AAA'] },
      { label: 'CURRENT SWING', date: '2026-06-03', images: ['data:image/jpeg;base64,BBB'] },
    ]),
  });

  assert.deepEqual(result.displayFrames, []);
  const imgs = payloads[0].messages.flatMap((m) => (Array.isArray(m.content)
    ? m.content.filter((p) => p.type === 'image_url') : []));
  assert.equal(imgs.length, 2, 'the legacy shape still attaches frames to the model');
});
