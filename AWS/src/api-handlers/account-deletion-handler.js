const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} = require('@aws-sdk/client-s3');

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});
const REVENUECAT_API_BASE = process.env.REVENUECAT_API_BASE || 'https://api.revenuecat.com/v1';
const REVENUECAT_HTTP_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.REVENUECAT_HTTP_TIMEOUT_MS || '5000', 10)
);

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
  },
  body: JSON.stringify(body),
});

const getUserId = (event) =>
  event?.requestContext?.authorizer?.jwt?.claims?.sub ||
  event?.requestContext?.authorizer?.claims?.sub ||
  null;

const chunk = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

async function findAnalysisKeys(userId, client = documentClient) {
  const tableName = process.env.DYNAMODB_TABLE;
  if (!tableName) throw new Error('DYNAMODB_TABLE is required');

  const keys = [];
  let exclusiveStartKey;
  do {
    const result = await client.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'user_id = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      ProjectionExpression: 'analysis_id',
      ExclusiveStartKey: exclusiveStartKey,
    }));
    for (const item of result.Items || []) {
      if (item.analysis_id) keys.push({ analysis_id: item.analysis_id });
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  // Entitlement state is stored in the analyses table but may not include user_id.
  keys.push({ analysis_id: `access#${userId}` });
  return keys;
}

async function deleteAnalysisRecords(keys, client = documentClient) {
  const tableName = process.env.DYNAMODB_TABLE;
  for (const keyBatch of chunk(keys, 25)) {
    let pending = keyBatch.map((Key) => ({ DeleteRequest: { Key } }));
    do {
      const result = await client.send(new BatchWriteCommand({
        RequestItems: { [tableName]: pending },
      }));
      pending = result.UnprocessedItems?.[tableName] || [];
    } while (pending.length);
  }
}

async function deleteDirectRecords(userId, client = documentClient) {
  const configuredTables = process.env.USER_RECORD_TABLES;
  const tableNames = configuredTables
    ? configuredTables.split(',').map((name) => name.trim()).filter(Boolean)
    : [
        process.env.USER_THREADS_TABLE || 'golf-user-threads',
        ...(process.env.SWING_PROFILE_TABLES || process.env.SWING_PROFILE_TABLE || 'golf-coach-swing-profiles')
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean),
      ];

  for (const tableName of [...new Set(tableNames)]) {
    await client.send(new DeleteCommand({
      TableName: tableName,
      Key: { user_id: userId },
    }));
  }
}

async function deleteUserObjects(userId, client = s3Client) {
  const bucket = process.env.VIDEO_BUCKET || process.env.EXPO_PUBLIC_VIDEO_BUCKET;
  if (!bucket) throw new Error('VIDEO_BUCKET is required');

  const prefix = `golf-swings/${userId}/`;
  let continuationToken;
  do {
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const objects = (listed.Contents || []).map(({ Key }) => ({ Key })).filter(({ Key }) => Key);
    if (objects.length) {
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects, Quiet: true },
      }));
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function deleteRevenueCatCustomer(userId, fetchImpl = fetch) {
  const secretKey = process.env.REVENUECAT_SECRET_API_KEY;
  if (!secretKey) throw new Error('REVENUECAT_SECRET_API_KEY is required');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVENUECAT_HTTP_TIMEOUT_MS);
  try {
    const result = await fetchImpl(
      `${REVENUECAT_API_BASE}/subscribers/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      }
    );
    if (!result.ok && result.status !== 404) {
      throw new Error(`RevenueCat deletion failed: ${result.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function handler(event) {
  if (event?.requestContext?.http?.method === 'OPTIONS' || event?.httpMethod === 'OPTIONS') {
    return response(204, {});
  }

  const userId = getUserId(event);
  if (!userId) return response(401, { message: 'Authentication required' });

  try {
    // Delete the external customer first so a retry remains possible if it fails.
    await deleteRevenueCatCustomer(userId);
    const analysisKeys = await findAnalysisKeys(userId);
    await deleteUserObjects(userId);
    await deleteAnalysisRecords(analysisKeys);
    await deleteDirectRecords(userId);
    return response(200, { deleted: true });
  } catch (error) {
    console.error('Account deletion failed', { userId, error });
    return response(500, { message: 'Account deletion could not be completed' });
  }
}

module.exports = {
  handler,
  __private: {
    chunk,
    getUserId,
    findAnalysisKeys,
    deleteAnalysisRecords,
    deleteDirectRecords,
    deleteUserObjects,
    deleteRevenueCatCustomer,
  },
};
