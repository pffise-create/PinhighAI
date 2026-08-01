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

function isEntitled(accessRecord) {
  if (!accessRecord || typeof accessRecord !== 'object') return false;

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
  if (!isGatingEnabled() || !isOneTimeLockedResultEnabled()) {
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

  const accessRecord = await getAccessRecord({ userId, client });
  if (isEntitled(accessRecord)) {
    return { gatingEnabled: true, entitled: true, allowFullResult: true, accessRecord };
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
  __private: {
    getAccessRecordKey,
    isEntitled,
    parseJsonMaybe,
  },
};
