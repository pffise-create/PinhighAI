const Module = require('module');
const test = require('node:test');
const assert = require('node:assert/strict');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@aws-sdk/client-dynamodb') {
    return { DynamoDBClient: class {} };
  }
  if (request === '@aws-sdk/lib-dynamodb') {
    return {
      DynamoDBDocumentClient: { from: () => ({ send: async () => ({}) }) },
      GetCommand: class {},
      PutCommand: class {},
    };
  }
  return originalLoad(request, parent, isMain);
};

const repository = require('../src/data/swingProfileRepository');
Module._load = originalLoad;
const { sanitizeAnalysisResults, buildProfileItem } = repository.__private;

test('sanitizeAnalysisResults removes frames and extracts metrics', () => {
  const input = {
    frames: [{ id: 1 }],
    metrics: { path_deg: 1.5, tempo: 2 },
    focus_areas: ['Club path'],
    strengths: ['Great tempo'],
    improvements: ['Work on grip'],
    user_context: { handicap: 10 },
    summary: 'Strong tempo with slight OTT move.',
  };

  const result = sanitizeAnalysisResults(input);
  assert.deepEqual(result.metricsSnapshot, { path_deg: 1.5, tempo: 2 });
  assert.deepEqual(result.focusAreas, ['Club path']);
  assert.deepEqual(result.strengths, ['Great tempo']);
  assert.deepEqual(result.cautions, ['Work on grip']);
  assert.deepEqual(result.userContext, { handicap: 10 });
  assert.equal(result.summary, 'Strong tempo with slight OTT move.');
});

test('buildProfileItem merges existing profile metadata', () => {
  const timestamp = new Date('2025-10-12T00:00:00.000Z');
  const existing = {
    total_swings_analyzed: 5,
    recent_analysis_ids: ['analysis-old'],
    summary: 'Keep working on club path.',
  };

  const profile = buildProfileItem({
    userId: 'user-1',
    analysisId: 'analysis-123',
    aiAnalysis: { coaching_response: 'Focus on your grip pressure.' },
    analysisResults: {
      metrics: { path_deg: 2.1 },
      focus_areas: ['Grip'],
      strengths: ['Tempo'],
      user_context: { handicap: 8 },
    },
    existingProfile: existing,
    timestamp,
  });

  assert.equal(profile.user_id, 'user-1');
  assert.equal(profile.last_analysis_id, 'analysis-123');
  assert.equal(profile.last_coaching_response, 'Focus on your grip pressure.');
  assert.deepEqual(profile.metrics_snapshot, { path_deg: 2.1 });
  assert.deepEqual(profile.focus_areas, ['Grip']);
  assert.equal(profile.total_swings_analyzed, 6);
  assert.deepEqual(profile.recent_analysis_ids, ['analysis-123', 'analysis-old']);
  assert.equal(profile.last_analysis_at, timestamp.toISOString());
});
