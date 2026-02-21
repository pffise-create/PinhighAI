const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.SWING_PROFILE_TABLE || 'golf-coach-swing-profiles';
let sharedDocumentClient = null;

function getDocumentClient(overrides) {
  if (overrides) {
    return overrides;
  }

  if (!sharedDocumentClient) {
    const client = new DynamoDBClient({});
    sharedDocumentClient = DynamoDBDocumentClient.from(client);
  }

  return sharedDocumentClient;
}

function extractNumericMetrics(source) {
  if (!source || typeof source !== 'object') {
    return {};
  }

  const metrics = {};
  const candidates = source.metrics && typeof source.metrics === 'object'
    ? { ...source.metrics }
    : { ...source };

  Object.entries(candidates).forEach(([key, value]) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      metrics[key] = value;
    }
  });

  return metrics;
}

function sanitizeAnalysisResults(analysisResults) {
  if (!analysisResults || typeof analysisResults !== 'object') {
    return {
      metricsSnapshot: {},
      focusAreas: [],
      strengths: [],
      cautions: [],
      userContext: null,
    };
  }

  const {
    frames, // omit heavy frame data
    metrics,
    focus_areas: focusAreas,
    strengths,
    improvements,
    cautions,
    user_context: userContext,
    ...rest
  } = analysisResults;

  const metricsSnapshot = extractNumericMetrics({ ...metrics });

  return {
    metricsSnapshot,
    focusAreas: Array.isArray(focusAreas) ? focusAreas.slice(0, 5) : [],
    strengths: Array.isArray(strengths) ? strengths.slice(0, 5) : [],
    cautions: Array.isArray(cautions) ? cautions.slice(0, 5)
      : Array.isArray(improvements) ? improvements.slice(0, 5)
      : [],
    userContext: userContext || null,
    summary: typeof rest.summary === 'string' ? rest.summary : null,
  };
}

function buildProfileItem({ userId, analysisId, aiAnalysis, analysisResults, existingProfile, timestamp }) {
  const isoTimestamp = (timestamp instanceof Date ? timestamp : new Date()).toISOString();
  const sanitized = sanitizeAnalysisResults(analysisResults);
  const previous = existingProfile || {};
  const recentIds = [analysisId, ...(previous.recent_analysis_ids || [])]
    .filter(Boolean)
    .filter((value, index, self) => self.indexOf(value) === index)
    .slice(0, 5);

  const coachingResponse = typeof aiAnalysis?.coaching_response === 'string'
    ? aiAnalysis.coaching_response
    : (typeof aiAnalysis?.response === 'string' ? aiAnalysis.response : null);

  return {
    user_id: userId,
    last_analysis_id: analysisId,
    last_analysis_at: isoTimestamp,
    updated_at: isoTimestamp,
    last_coaching_response: coachingResponse ? coachingResponse.slice(0, 4000) : null,
    metrics_snapshot: sanitized.metricsSnapshot,
    focus_areas: sanitized.focusAreas,
    strengths: sanitized.strengths,
    cautions: sanitized.cautions,
    user_context: sanitized.userContext,
    summary: sanitized.summary || previous.summary || null,
    total_swings_analyzed: (previous.total_swings_analyzed || 0) + 1,
    recent_analysis_ids: recentIds,
  };
}

async function getProfile({ userId, client } = {}) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const documentClient = getDocumentClient(client);
  const command = new GetCommand({
    TableName: TABLE_NAME,
    Key: { user_id: userId },
  });

  const response = await documentClient.send(command);
  return response.Item || null;
}

async function upsertFromAnalysis({ userId, analysisId, aiAnalysis, analysisResults, client, timestamp } = {}) {
  if (!userId) {
    throw new Error('userId is required');
  }
  if (!analysisId) {
    throw new Error('analysisId is required');
  }

  const documentClient = getDocumentClient(client);
  const existingProfile = await getProfile({ userId, client: documentClient });
  const profileItem = buildProfileItem({
    userId,
    analysisId,
    aiAnalysis,
    analysisResults,
    existingProfile,
    timestamp,
  });

  await documentClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: profileItem,
  }));

  return profileItem;
}

module.exports = {
  getProfile,
  upsertFromAnalysis,
  __private: {
    sanitizeAnalysisResults,
    buildProfileItem,
  },
};
