const Module = require('module');
const test = require('node:test');
const assert = require('node:assert/strict');

const originalLoad = Module._load;
const DYNAMO_ATTR_KEYS = new Set(['S', 'N', 'BOOL', 'NULL', 'M', 'L', 'SS', 'NS', 'BS', 'B']);

function decodeDynamoValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => decodeDynamoValue(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const keys = Object.keys(value);
  const isAttrValue = keys.length > 0 && keys.every((key) => DYNAMO_ATTR_KEYS.has(key));
  if (isAttrValue) {
    if (Object.prototype.hasOwnProperty.call(value, 'S')) return value.S;
    if (Object.prototype.hasOwnProperty.call(value, 'N')) return Number(value.N);
    if (Object.prototype.hasOwnProperty.call(value, 'BOOL')) return Boolean(value.BOOL);
    if (Object.prototype.hasOwnProperty.call(value, 'NULL')) return null;
    if (Object.prototype.hasOwnProperty.call(value, 'M')) return decodeDynamoValue(value.M);
    if (Object.prototype.hasOwnProperty.call(value, 'L')) {
      return Array.isArray(value.L) ? value.L.map((entry) => decodeDynamoValue(entry)) : [];
    }
    return null;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, decodeDynamoValue(entry)])
  );
}

Module._load = function (request, parent, isMain) {
  if (request === '@aws-sdk/client-dynamodb') {
    return { DynamoDBClient: class {} };
  }

  if (request === '@aws-sdk/lib-dynamodb') {
    return {
      DynamoDBDocumentClient: { from: () => ({ send: async () => ({}) }) },
      GetCommand: class {},
      UpdateCommand: class {},
      PutCommand: class {},
    };
  }

  if (request === '@aws-sdk/util-dynamodb') {
    return {
      unmarshall: (value) => decodeDynamoValue(value),
    };
  }

  if (request === '@aws-sdk/client-s3') {
    return {
      S3Client: class {},
      GetObjectCommand: class {},
    };
  }

  if (request === '@aws-sdk/client-secrets-manager') {
    return {
      SecretsManagerClient: class {},
      GetSecretValueCommand: class {},
    };
  }

  return originalLoad(request, parent, isMain);
};

const swingRepository = require('../src/data/swingRepository');
const processor = require('../src/ai-analysis/ai-analysis-processor.js');
Module._load = originalLoad;

const { gatherDeveloperContext, normalizeDynamoItem, extractFrameData } = processor.__private;

function withStubbedSwingRepo(method, stub, fn) {
  const original = swingRepository[method];
  swingRepository[method] = stub;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      swingRepository[method] = original;
    });
}

test('gatherDeveloperContext returns JSON string when prior swings exist', async () => {
  await withStubbedSwingRepo('getLastAnalyzedSwings', async () => ([
    {
      analysisId: 'analysis-current',
      summary: 'Current swing summary',
      analysisResults: {
        metrics: { path_deg: 1.2 },
      },
    },
    {
      analysisId: 'analysis-prior',
      summary: 'Prior swing summary',
      analysisResults: {
        metrics: { path_deg: 2.0 },
        user_context: { handicap: 12 },
      },
    },
  ]), async () => {
    const contextString = await gatherDeveloperContext({
      userId: 'user-1',
      analysisId: 'analysis-current',
      dynamoClient: null,
    });

    assert.ok(contextString, 'context string should be returned');
    const parsed = JSON.parse(contextString);
    assert.equal(parsed.recent_swings.length, 1);
    assert.equal(parsed.recent_swings[0].analysisId, 'analysis-prior');
    assert.deepEqual(parsed.swing_profile, { handicap: 12 });
  });
});

test('gatherDeveloperContext returns null when no user or swings', async () => {
  const resultNoUser = await gatherDeveloperContext({ userId: null, analysisId: 'analysis', dynamoClient: null });
  assert.equal(resultNoUser, null);

  await withStubbedSwingRepo('getLastAnalyzedSwings', async () => ([]), async () => {
    const result = await gatherDeveloperContext({ userId: 'user-2', analysisId: 'analysis', dynamoClient: null });
    assert.equal(result, null);
  });
});

test('normalizeDynamoItem and extractFrameData handle DynamoDB-typed analysis_results', () => {
  const rawItem = {
    analysis_results: {
      M: {
        fps: { N: '4' },
        video_duration: { N: '8.25' },
        frames: {
          L: [
            {
              M: {
                phase: { S: 'frame_000' },
                url: { S: 'https://example.com/frame_000.jpg' },
                frame_number: { N: '0' },
              },
            },
          ],
        },
      },
    },
  };

  const normalized = normalizeDynamoItem(rawItem);
  const { analysisResults, frames } = extractFrameData(normalized);

  assert.equal(analysisResults.fps, 4);
  assert.equal(analysisResults.video_duration, 8.25);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].phase, 'frame_000');
  assert.equal(frames[0].url, 'https://example.com/frame_000.jpg');
});

// ── Model-family controls ─────────────────────────────────────────────────
// Regression guard: reasoning_effort used to be chosen by prefix-matching
// gpt-5.1/gpt-5.2, so every newer release fell through to 'minimal' and the
// API rejected it with a 400. Any model the app might be upgraded to must
// produce a value that model actually accepts.
const {
  getGpt5Minor,
  applyModelSpecificControls,
  createOpenAiRetryPayload,
} = processor.__private;

test('getGpt5Minor parses the GPT-5 minor version across naming styles', () => {
  assert.equal(getGpt5Minor('gpt-5'), 0);
  assert.equal(getGpt5Minor('gpt-5.1'), 1);
  assert.equal(getGpt5Minor('gpt-5.2'), 2);
  assert.equal(getGpt5Minor('gpt-5.4-mini'), 4);
  assert.equal(getGpt5Minor('gpt-5.6-terra'), 6);
  assert.equal(getGpt5Minor('gpt-5.6-luna'), 6);
  assert.equal(getGpt5Minor('gpt-4o'), null);
  assert.equal(getGpt5Minor('gpt-4o-mini'), null);
  assert.equal(getGpt5Minor(undefined), null);
});

test('only the original gpt-5 gets reasoning_effort "minimal"', () => {
  const original = applyModelSpecificControls({ model: 'gpt-5', temperature: 0.4 });
  assert.equal(original.reasoning_effort, 'minimal');
  assert.equal('temperature' in original, false, 'gpt-5 family rejects temperature');

  for (const model of ['gpt-5.1', 'gpt-5.2', 'gpt-5.4-mini', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    const request = applyModelSpecificControls({ model, temperature: 0.4 });
    assert.equal(request.reasoning_effort, 'low', `${model} must not use 'minimal'`);
    assert.equal('temperature' in request, false, `${model} rejects temperature`);
  }
});

test('non-GPT-5 models keep temperature and get no reasoning_effort', () => {
  const request = applyModelSpecificControls({ model: 'gpt-4o' }, { temperature: 0.35 });
  assert.equal(request.temperature, 0.35);
  assert.equal(request.reasoning_effort, undefined);
});

test('an explicit reasoning_effort is never overwritten', () => {
  const request = applyModelSpecificControls({ model: 'gpt-5.6-terra', reasoning_effort: 'high' });
  assert.equal(request.reasoning_effort, 'high');
});

test('retry payload downgrades effort to none for 5.1+ only', () => {
  assert.equal(createOpenAiRetryPayload({ model: 'gpt-5.6-terra' }, 900).reasoning_effort, 'none');
  assert.equal(createOpenAiRetryPayload({ model: 'gpt-5.4-mini' }, 900).reasoning_effort, 'none');
  assert.equal(createOpenAiRetryPayload({ model: 'gpt-5' }, 900).reasoning_effort, undefined);
  assert.equal(createOpenAiRetryPayload({ model: 'gpt-4o' }, 900).reasoning_effort, undefined);
  assert.equal(createOpenAiRetryPayload({ model: 'gpt-5.2' }, 900).max_completion_tokens, 900);
});
