const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const lambdaNodeModules = path.join(__dirname, '..', 'lambda-deployment', 'node_modules');
const lambdaRequire = createRequire(path.join(lambdaNodeModules, 'package.json'));
const { QueryCommand, GetCommand } = lambdaRequire('@aws-sdk/lib-dynamodb');
const {
  getLastAnalyzedSwings,
  getSwingAnalysis,
  compareSwings,
  __private,
} = require('../src/data/swingRepository');

function createMockClient({ onQuery, onGet }) {
  return {
    async send(command) {
      if (command instanceof QueryCommand) {
        if (!onQuery) {
          throw new Error('Unexpected QueryCommand');
        }
        return onQuery(command);
      }

      if (command instanceof GetCommand) {
        if (!onGet) {
          throw new Error('Unexpected GetCommand');
        }
        return onGet(command);
      }

      throw new Error(`Unsupported command type: ${command.constructor?.name}`);
    },
  };
}

test('getLastAnalyzedSwings returns the newest analyzed swings with parsed summaries', async () => {
  const mockClient = createMockClient({
    onQuery: () => ({
      Items: [
        {
          analysis_id: 'analysis-003',
          user_id: 'user-123',
          status: 'AI_COMPLETED',
          created_at: '2025-10-10T12:00:00Z',
          ai_analysis: JSON.stringify({ coaching_response: 'Latest swing looks solid.' }),
          analysis_results: {
            frames_extracted: 14,
            metrics: { path_deg: 1.5, face_deg: -0.3 },
          },
        },
        {
          analysis_id: 'analysis-002',
          user_id: 'user-123',
          status: 'COMPLETED',
          created_at: '2025-10-09T12:00:00Z',
          ai_analysis: JSON.stringify({ coaching_response: 'Previous swing had OTT issues.' }),
          analysis_results: {
            frames_extracted: 12,
            metrics: { path_deg: 3.1 },
          },
        },
        {
          analysis_id: 'analysis-001',
          user_id: 'user-123',
          status: 'PROCESSING',
          created_at: '2025-10-08T12:00:00Z',
          ai_analysis: null,
        },
      ],
    }),
  });

  const swings = await getLastAnalyzedSwings({ userId: 'user-123', limit: 2, client: mockClient });
  assert.equal(swings.length, 2);
  assert.equal(swings[0].analysisId, 'analysis-003');
  assert.equal(swings[1].analysisId, 'analysis-002');
  assert.equal(swings[0].summary, 'Latest swing looks solid.');
  assert.equal(swings[0].analysisResults.frames_extracted, 14);
});

test('getLastAnalyzedSwings throws when userId is missing', async () => {
  await assert.rejects(() => getLastAnalyzedSwings({}), /userId is required/);
});

test('getSwingAnalysis returns normalized report with metrics and cues', async () => {
  const mockClient = createMockClient({
    onGet: () => ({
      Item: {
        analysis_id: 'analysis-010',
        user_id: 'user-555',
        status: 'AI_COMPLETED',
        created_at: '2025-10-10T10:00:00Z',
        ai_analysis: JSON.stringify({
          coaching_response: 'Maintain the smoother takeaway.',
          practice_recommendations: ['Slow-motion takeaway drill'],
        }),
        analysis_results: {
          frames_extracted: 15,
          video_duration: 3.2,
          metrics: { path_deg: 1.9 },
        },
      },
    }),
  });

  const report = await getSwingAnalysis({ analysisId: 'analysis-010', client: mockClient });
  assert.equal(report.analysisId, 'analysis-010');
  assert.deepEqual(report.metrics, {
    frames_extracted: 15,
    video_duration: 3.2,
    path_deg: 1.9,
  });
  assert.deepEqual(report.cues, ['Slow-motion takeaway drill']);
});

test('getSwingAnalysis returns null when no record exists', async () => {
  const mockClient = createMockClient({
    onGet: () => ({ Item: undefined }),
  });

  const report = await getSwingAnalysis({ analysisId: 'analysis-missing', client: mockClient });
  assert.equal(report, null);
});

test('compareSwings calculates numeric deltas across shared metrics', () => {
  const comparison = compareSwings({
    current: {
      analysisId: 'analysis-100',
      analysisResults: {
        frames_extracted: 16,
        video_duration: 3.5,
        metrics: { path_deg: 1.4, face_deg: -0.6 },
      },
    },
    previous: {
      analysisId: 'analysis-090',
      analysisResults: {
        frames_extracted: 14,
        video_duration: 3.3,
        metrics: { path_deg: 2.1, face_deg: -0.6 },
      },
    },
  });

  assert.equal(comparison.current, 'analysis-100');
  assert.equal(comparison.previous, 'analysis-090');
  assert.equal(comparison.deltas.frames_extracted, 2);
  assert.equal(comparison.deltas.video_duration, 0.2);
  assert.equal(comparison.deltas.path_deg, -0.7);
  assert.ok(comparison.summary.length >= 1);
});

test('compareSwings throws when data is missing', () => {
  assert.throws(() => compareSwings({ current: null, previous: {} }), /required/);
});

test('parseAiAnalysis throws on invalid JSON to surface data issues', () => {
  assert.throws(
    () => __private.parseAiAnalysis('not-json', { analysisId: 'broken-analysis' }),
    /Failed to parse ai_analysis/
  );
});
