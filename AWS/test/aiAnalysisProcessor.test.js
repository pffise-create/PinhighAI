const test = require('node:test');
const assert = require('node:assert/strict');
const swingRepository = require('../src/data/swingRepository');
const processor = require('../src/ai-analysis/ai-analysis-processor.js');

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
