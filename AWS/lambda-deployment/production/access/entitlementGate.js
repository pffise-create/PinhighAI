const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ACCESS_RECORD_PREFIX = process.env.USER_ACCESS_RECORD_PREFIX || 'access#';
const DEFAULT_ENTITLEMENT_KEY = process.env.SUBSCRIPTION_ENTITLEMENT_KEY || 'DivotLab Unlimited';

function getAccessTableName() {
  return process.env.USER_ACCESS_TABLE || process.env.DYNAMODB_TABLE || null;
}

function getAccessRecordKey(userId) {
  if (!userId) {
    throw new Error('userId is required');
  }
  return { analysis_id: `${ACCESS_RECORD_PREFIX}${userId}` };
}

function parseJsonMaybe(value) {
  if (!value || typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function hasUnexpiredEntitlement(accessRecord) {
  const expiresAt = accessRecord?.entitlement_expires_at;
  if (!expiresAt) return null;
  const expiresMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return null;
  return expiresMs > Date.now();
}

function isEntitled(accessRecord) {
  if (!accessRecord || typeof accessRecord !== 'object') return false;

  // An explicit expiry always wins over stale boolean flags so lapsed
  // subscriptions re-lock without waiting for a record rewrite.
  const unexpired = hasUnexpiredEntitlement(accessRecord);
  if (unexpired === true) return true;
  if (unexpired === false) return false;

  if (accessRecord.entitlement_active === true) return true;
  if (accessRecord.subscription_active === true) return true;
  if (accessRecord.has_active_subscription === true) return true;

  const entitlements = parseJsonMaybe(accessRecord.entitlements);
  if (entitlements && typeof entitlements === 'object') {
    const keyed = entitlements[DEFAULT_ENTITLEMENT_KEY];
    if (keyed === true || keyed?.isActive === true) return true;
  }

  const status = String(accessRecord.subscription_status || accessRecord.entitlement_status || '').toLowerCase();
  return status === 'active' || status === 'trialing';
}

function isGatingEnabled() {
  return process.env.SUBSCRIPTION_GATING_ENABLED === 'true';
}

function isOneTimeLockedResultEnabled() {
  return process.env.ONE_TIME_LOCKED_RESULT_ENABLED === 'true';
}

const REVENUECAT_API_BASE = process.env.REVENUECAT_API_BASE || 'https://api.revenuecat.com/v1';
const REVENUECAT_HTTP_TIMEOUT_MS = Math.max(1000, parseInt(process.env.REVENUECAT_HTTP_TIMEOUT_MS || '3000', 10));

function getRevenueCatSecretKey() {
  return process.env.REVENUECAT_SECRET_API_KEY || null;
}

// Server-side entitlement lookup against the RevenueCat REST API. The app
// logs users into RevenueCat with their Cognito user id, so the subscriber
// id here matches the userId we gate on. This removes the hard dependency on
// webhook delivery for unlocking after purchase.
async function fetchRevenueCatEntitlement(userId) {
  const secretKey = getRevenueCatSecretKey();
  if (!secretKey || !userId) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVENUECAT_HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${REVENUECAT_API_BASE}/subscribers/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      // 404 = subscriber unknown to RevenueCat (never launched the app with
      // this id); treat as not entitled rather than an error.
      if (response.status === 404) return { active: false };
      throw new Error(`RevenueCat lookup failed: ${response.status}`);
    }
    const payload = await response.json();
    const entitlement = payload?.subscriber?.entitlements?.[DEFAULT_ENTITLEMENT_KEY];
    if (!entitlement) return { active: false };

    const expiresDate = entitlement.expires_date || null;
    const active = !expiresDate || new Date(expiresDate).getTime() > Date.now();
    return { active, expiresAt: expiresDate };
  } finally {
    clearTimeout(timer);
  }
}

async function persistEntitlement({ userId, client, expiresAt }) {
  const tableName = getAccessTableName();
  if (!tableName || !userId) return;

  await client.send(new UpdateCommand({
    TableName: tableName,
    Key: getAccessRecordKey(userId),
    UpdateExpression: [
      'SET #record_type = if_not_exists(#record_type, :recordType)',
      '#user_id = if_not_exists(#user_id, :userId)',
      '#entitlement_active = :active',
      '#entitlement_expires_at = :expiresAt',
      '#entitlement_source = :source',
      '#updated_at = :now',
    ].join(', '),
    ExpressionAttributeNames: {
      '#record_type': 'record_type',
      '#user_id': 'user_id',
      '#entitlement_active': 'entitlement_active',
      '#entitlement_expires_at': 'entitlement_expires_at',
      '#entitlement_source': 'entitlement_source',
      '#updated_at': 'updated_at',
    },
    ExpressionAttributeValues: {
      ':recordType': 'user_access',
      ':userId': userId,
      ':active': true,
      ':expiresAt': expiresAt || null,
      ':source': 'revenuecat_api',
      ':now': new Date().toISOString(),
    },
  }));
}

// Entitlement resolution order: access record first (webhook- or previously
// cached), then live RevenueCat lookup with write-through on success. On a
// RevenueCat outage, a user whose record says they once paid keeps access
// (grace) rather than being locked out mid-subscription.
async function resolveEntitlement({ userId, client }) {
  const accessRecord = await getAccessRecord({ userId, client });
  if (isEntitled(accessRecord)) {
    return { entitled: true, accessRecord };
  }

  try {
    const rc = await fetchRevenueCatEntitlement(userId);
    if (rc?.active) {
      try {
        await persistEntitlement({ userId, client, expiresAt: rc.expiresAt });
      } catch (persistError) {
        console.error('ENTITLEMENT_PERSIST_ERROR:', persistError);
      }
      return { entitled: true, accessRecord, source: 'revenuecat_api' };
    }
  } catch (error) {
    console.error('REVENUECAT_LOOKUP_ERROR:', error);
    if (accessRecord?.entitlement_active === true) {
      // Expired-looking record + RC unreachable: grace, don't lock out a payer.
      return { entitled: true, accessRecord, source: 'grace' };
    }
  }

  return { entitled: false, accessRecord };
}

async function getAccessRecord({ userId, client }) {
  const tableName = getAccessTableName();
  if (!tableName || !userId) {
    return null;
  }

  const response = await client.send(new GetCommand({
    TableName: tableName,
    Key: getAccessRecordKey(userId),
  }));

  return response.Item || null;
}

function buildLockedContent({
  aiAnalysis,
  lockContext = 'video_analysis',
  headline = 'See the full swing breakdown',
  body = 'Start your 7-day free trial to unlock the complete analysis.',
}) {
  const parsed = parseJsonMaybe(aiAnalysis);
  const coachingResponse = typeof parsed?.coaching_response === 'string'
    ? parsed.coaching_response.trim()
    : (typeof parsed?.response === 'string' ? parsed.response.trim() : '');

  const previewSummary = coachingResponse
    ? coachingResponse.split(/\n+/).map((line) => line.trim()).filter(Boolean)[0]?.slice(0, 280) || coachingResponse.slice(0, 280)
    : 'Your swing has a few key opportunities to improve. Unlock the complete analysis to see the full breakdown.';

  const rootCause = typeof parsed?.root_cause === 'string' ? parsed.root_cause.trim() : null;
  const firstSymptom = Array.isArray(parsed?.symptoms_detected) ? parsed.symptoms_detected.find((v) => typeof v === 'string' && v.trim()) : null;
  const previewKeyIssue = rootCause || firstSymptom || null;

  const firstTip = Array.isArray(parsed?.practice_recommendations)
    ? parsed.practice_recommendations.find((rec) => {
        if (typeof rec === 'string') return rec.trim();
        if (rec && typeof rec === 'object') {
          return rec.title || rec.name || rec.drill || rec.description;
        }
        return null;
      })
    : null;

  let previewOneTip = null;
  if (typeof firstTip === 'string') {
    previewOneTip = firstTip.trim();
  } else if (firstTip && typeof firstTip === 'object') {
    previewOneTip = firstTip.title || firstTip.name || firstTip.drill || firstTip.description || null;
  }

  return {
    locked: true,
    lock_context: lockContext,
    headline,
    body,
    cta_label: 'Start 7-Day Free Trial',
    cta_action: 'start_trial',
    preview_summary: previewSummary || null,
    preview_key_issue: previewKeyIssue || null,
    preview_one_tip: previewOneTip || null,
  };
}

function shouldAllowLockedResult(accessRecord, resultRef) {
  if (!accessRecord || !resultRef) return false;
  return accessRecord.locked_result_ref === String(resultRef);
}

async function claimOneTimeLockedResult({ userId, client, previewType, resultRef }) {
  const tableName = getAccessTableName();
  if (!tableName || !userId) {
    return { claimed: false, reason: 'missing_table_or_user' };
  }

  const now = new Date().toISOString();
  const ref = String(resultRef || '');

  try {
    await client.send(new UpdateCommand({
      TableName: tableName,
      Key: getAccessRecordKey(userId),
      UpdateExpression: [
        'SET #record_type = if_not_exists(#record_type, :recordType)',
        '#user_id = if_not_exists(#user_id, :userId)',
        '#updated_at = :now',
        '#locked_result_used_at = if_not_exists(#locked_result_used_at, :now)',
        '#locked_result_type = if_not_exists(#locked_result_type, :previewType)',
        '#locked_result_ref = if_not_exists(#locked_result_ref, :resultRef)',
      ].join(', '),
      ConditionExpression: 'attribute_not_exists(#locked_result_used_at) OR #locked_result_ref = :resultRef',
      ExpressionAttributeNames: {
        '#record_type': 'record_type',
        '#user_id': 'user_id',
        '#updated_at': 'updated_at',
        '#locked_result_used_at': 'locked_result_used_at',
        '#locked_result_type': 'locked_result_type',
        '#locked_result_ref': 'locked_result_ref',
      },
      ExpressionAttributeValues: {
        ':recordType': 'user_access',
        ':userId': userId,
        ':now': now,
        ':previewType': previewType || 'unknown',
        ':resultRef': ref,
      },
    }));

    return { claimed: true };
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      return { claimed: false, reason: 'already_used_for_different_result' };
    }
    throw error;
  }
}

async function evaluateAccessForLockedResult({ userId, client, previewType, resultRef }) {
  if (!isGatingEnabled()) {
    return { gatingEnabled: false, entitled: true, allowFullResult: true };
  }

  if (!userId) {
    return {
      gatingEnabled: true,
      entitled: false,
      allowFullResult: false,
      allowLockedResult: false,
      reason: 'missing_user_id',
    };
  }

  const { entitled, accessRecord } = await resolveEntitlement({ userId, client });
  if (entitled) {
    return { gatingEnabled: true, entitled: true, allowFullResult: true, accessRecord };
  }

  // Default mode: every result for a non-entitled user is a teaser.
  // ONE_TIME_LOCKED_RESULT_ENABLED opts into the stricter one-teaser-ever mode.
  if (!isOneTimeLockedResultEnabled()) {
    return {
      gatingEnabled: true,
      entitled: false,
      allowFullResult: false,
      allowLockedResult: true,
      accessRecord,
      teaserMode: 'always',
    };
  }

  if (shouldAllowLockedResult(accessRecord, resultRef)) {
    return {
      gatingEnabled: true,
      entitled: false,
      allowFullResult: false,
      allowLockedResult: true,
      accessRecord,
      reusedLockedResult: true,
    };
  }

  const claim = await claimOneTimeLockedResult({ userId, client, previewType, resultRef });
  if (claim.claimed) {
    return {
      gatingEnabled: true,
      entitled: false,
      allowFullResult: false,
      allowLockedResult: true,
      firstLockedResult: true,
    };
  }

  return {
    gatingEnabled: true,
    entitled: false,
    allowFullResult: false,
    allowLockedResult: false,
    reason: claim.reason || 'locked_result_unavailable',
  };
}

module.exports = {
  buildLockedContent,
  evaluateAccessForLockedResult,
  resolveEntitlement,
  __private: {
    getAccessRecordKey,
    isEntitled,
    parseJsonMaybe,
    fetchRevenueCatEntitlement,
  },
};
