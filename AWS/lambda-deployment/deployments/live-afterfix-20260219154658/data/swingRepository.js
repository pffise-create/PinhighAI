// Shared helpers for swing data access and comparison.
// Keep these functions dependency-light and production-ready so Lambdas can reuse them without duplication.

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ANALYSES_TABLE = process.env.DYNAMODB_TABLE || 'golf-coach-analyses';
const USER_ANALYSES_INDEX = process.env.USER_ANALYSES_INDEX || 'user-timestamp-index';
const DEFAULT_RECENT_LIMIT = 2;
const MAX_RECENT_LIMIT = 10;
const ANALYZED_STATUSES = new Set(['AI_COMPLETED', 'COMPLETED']);

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

function parseAiAnalysis(rawValue, context) {
  if (!rawValue) {
    return null;
  }

  if (typeof rawValue === 'object') {
    return rawValue;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    const analysisId = context?.analysisId || 'unknown-analysis';
    throw new Error(`Failed to parse ai_analysis for ${analysisId}: ${error.message}`);
  }
}

function normalizeAnalysisItem(item) {
  if (!item) {
    return null;
  }

  const aiAnalysis = parseAiAnalysis(item.ai_analysis, { analysisId: item.analysis_id });
  const analysisResults = item.analysis_results || null;

  return {
    analysisId: item.analysis_id,
    userId: item.user_id,
    status: item.status,
    createdAt: item.created_at || null,
    updatedAt: item.updated_at || null,
    capturedAt: item.captured_at || null,
    aiAnalysis,
    analysisResults,
    summary: aiAnalysis?.coaching_response || aiAnalysis?.response || null,
  };
}

function isValidNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function extractNumericMetrics(source) {
  if (!source || typeof source !== 'object') {
    return {};
  }

  const metrics = {};
  const directKeys = ['frames_extracted', 'video_duration', 'fps'];

  directKeys.forEach((key) => {
    const value = source[key];
    if (isValidNumber(value)) {
      metrics[key] = value;
    }
  });

  if (source.metrics && typeof source.metrics === 'object') {
    Object.entries(source.metrics).forEach(([key, value]) => {
      if (isValidNumber(value)) {
        metrics[key] = value;
      }
    });
  }

  return metrics;
}

function buildAnalysisReport(item) {
  if (!item) {
    return null;
  }

  const normalized = normalizeAnalysisItem(item);
  if (!normalized) {
    return null;
  }

  const metrics = extractNumericMetrics(normalized.analysisResults);
  const cues = Array.isArray(normalized.aiAnalysis?.practice_recommendations)
    ? normalized.aiAnalysis.practice_recommendations
    : (normalized.aiAnalysis?.focus_areas || []);

  return {
    analysisId: normalized.analysisId,
    userId: normalized.userId,
    status: normalized.status,
    createdAt: normalized.createdAt,
    capturedAt: normalized.capturedAt,
    summary: normalized.summary,
    metrics,
    cues,
    analysisResults: normalized.analysisResults,
    aiAnalysis: normalized.aiAnalysis,
  };
}

async function getLastAnalyzedSwings({ userId, limit = DEFAULT_RECENT_LIMIT, client } = {}) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const requestedLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_RECENT_LIMIT);
  const documentClient = getDocumentClient(client);

  const query = new QueryCommand({
    TableName: ANALYSES_TABLE,
    IndexName: USER_ANALYSES_INDEX,
    KeyConditionExpression: 'user_id = :userId',
    ExpressionAttributeValues: {
      ':userId': userId,
    },
    ScanIndexForward: false,
    Limit: Math.max(requestedLimit * 3, requestedLimit),
  });

  const response = await documentClient.send(query);
  const items = Array.isArray(response.Items) ? response.Items : [];

  return items
    .filter((item) => ANALYZED_STATUSES.has(item.status))
    .map((item) => normalizeAnalysisItem(item))
    .filter((item) => item && item.aiAnalysis)
    .slice(0, requestedLimit);
}

async function getSwingAnalysis({ analysisId, client } = {}) {
  if (!analysisId) {
    throw new Error('analysisId is required');
  }

  const documentClient = getDocumentClient(client);
  const command = new GetCommand({
    TableName: ANALYSES_TABLE,
    Key: {
      analysis_id: analysisId,
    },
  });

  const response = await documentClient.send(command);
  if (!response.Item) {
    return null;
  }

  return buildAnalysisReport(response.Item);
}

function compareSwings({ current, previous }) {
  if (!current || !previous) {
    throw new Error('current and previous swing data are required');
  }

  const currentMetrics = extractNumericMetrics(current.analysisResults || current.analysis_results);
  const previousMetrics = extractNumericMetrics(previous.analysisResults || previous.analysis_results);
  const sharedKeys = Object.keys(currentMetrics).filter((key) => isValidNumber(previousMetrics[key]));

  const deltas = {};
  sharedKeys.forEach((key) => {
    const delta = currentMetrics[key] - previousMetrics[key];
    deltas[key] = Number(Number.parseFloat(delta).toFixed(4));
  });

  const summaries = Object.entries(deltas).map(([key, value]) => {
    const direction = value > 0 ? 'increase' : value < 0 ? 'decrease' : 'no change';
    return `${key}: ${value} (${direction})`;
  });

  return {
    current: current.analysisId || current.analysis_id || null,
    previous: previous.analysisId || previous.analysis_id || null,
    deltas,
    summary: summaries,
  };
}

module.exports = {
  getLastAnalyzedSwings,
  getSwingAnalysis,
  compareSwings,
  __private: {
    parseAiAnalysis,
    normalizeAnalysisItem,
    extractNumericMetrics,
  },
};
