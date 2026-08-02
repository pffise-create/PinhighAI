const Module = require('module');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// chatLoop pulls in the AWS SDK transitively; stub it for these pure tests.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.startsWith('@aws-sdk/')) {
    return new Proxy({}, { get: () => class {} });
  }
  return originalLoad(request, parent, isMain);
};
const chatLoopPath = path.join(__dirname, '..', 'src', 'chat', 'chatLoop.js');
const swingRepoPath = path.join(__dirname, '..', 'src', 'data', 'swingRepository.js');
const { executeChatLoop } = require(chatLoopPath);
const swingRepository = require(swingRepoPath);
const chatRepository = require(path.join(__dirname, '..', 'src', 'data', 'chatRepository.js'));
const swingProfileRepository = require(path.join(__dirname, '..', 'src', 'data', 'swingProfileRepository.js'));
Module._load = originalLoad;

function frames(prefix) {
  return Array.from({ length: 8 }, (_, i) => ({
    phase: `frame_${String(i).padStart(3, '0')}`,
    url: `https://bucket.s3.amazonaws.com/${prefix}/frame_${i}.jpg`,
    timestamp: i * 0.25,
  }));
}

function stubHistory(n) {
  const swings = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2025, 8, 20 + i * 10)).toISOString();
    swings.push({
      analysisId: `swing-${i}`,
      capturedAt: d,
      summary: `Session ${i}: work on follow-through and tempo.`,
      metrics: {},
      visualObservations: [],
      analysisResults: { frames: frames(`swing-${i}`) },
    });
  }
  return swings.reverse(); // newest first, as the repository returns
}

function install({ swings, capture }) {
  swingRepository.getLastAnalyzedSwings = async ({ limit }) => {
    capture.limit = limit;
    return swings.slice(0, limit);
  };
  chatRepository.getRecentTurns = async () => [];
  chatRepository.recordTurn = async () => ({});
  swingProfileRepository.getProfile = async () => null;
}

async function run(message, { swings = stubHistory(30), loader = null } = {}) {
  const capture = {};
  install({ swings, capture });
  const seen = [];
  const requestOpenAi = async (payload) => {
    seen.push(payload);
    return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
  };
  await executeChatLoop({
    userId: 'u1', userMessage: message, dynamoClient: {}, requestOpenAi,
    logger: { info(){}, warn(){}, error(){} },
    visualQuestionTool: null,
    comparisonFrameLoader: loader,
  });
  return { capture, payload: seen[0] };
}

test('wiring: routine question uses a narrow history fetch', async () => {
  const { capture } = await run('What should I work on this week?');
  assert.ok(capture.limit <= 3, `expected narrow fetch, got ${capture.limit}`);
});

test('wiring: comparative question widens the history fetch', async () => {
  const { capture } = await run('Is this better than my very first video?');
  assert.ok(capture.limit > 10, `expected wide fetch, got ${capture.limit}`);
});

test('wiring: a claim about past advice widens the fetch (guard needs history)', async () => {
  const { capture } = await run('Last time you told me to shorten my backswing, why change?');
  assert.ok(capture.limit > 10, `expected wide fetch, got ${capture.limit}`);
});

test('wiring: comparison frames are attached as image parts', async () => {
  const loader = async () => ([
    { label: 'EARLIER SWING', date: '2025-09-20', images: ['data:image/jpeg;base64,AAA'] },
    { label: 'CURRENT SWING', date: '2026-06-03', images: ['data:image/jpeg;base64,BBB'] },
  ]);
  const { payload } = await run('Is my early extension better than my first video?', { loader });
  const imgs = payload.messages.flatMap((m) => Array.isArray(m.content)
    ? m.content.filter((p) => p.type === 'image_url') : []);
  assert.equal(imgs.length, 2, 'both frame groups should be attached');
  const guidance = payload.messages.find((m) => typeof m.content === 'string'
    && m.content.includes('Judge any change ONLY from what you can see'));
  assert.ok(guidance, 'must instruct the model to judge only from the images');
});

test('wiring: a failing frame loader degrades to a text answer, not an error', async () => {
  const loader = async () => { throw new Error('s3 down'); };
  const { payload } = await run('Is this better than my first video?', { loader });
  assert.ok(payload, 'chat must still produce a request');
  const imgs = payload.messages.flatMap((m) => Array.isArray(m.content)
    ? m.content.filter((p) => p.type === 'image_url') : []);
  assert.equal(imgs.length, 0);
});

test('wiring: developer context carries no change-direction language', async () => {
  const { payload } = await run('Is my early extension better than before?');
  const dev = payload.messages.find((m) => typeof m.content === 'string'
    && m.content.startsWith('Developer context:'));
  assert.ok(dev, 'developer context must be present');
  assert.equal(/\b(improved|regressed|worse)\b/i.test(dev.content), false,
    'stored context must not assert a direction of change');
});
