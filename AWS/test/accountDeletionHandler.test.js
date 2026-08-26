const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function loadHandler() {
  const originalLoad = Module._load;
  const calls = { dynamo: [], s3: [], revenueCat: [] };

  class ScanCommand { constructor(input) { this.input = input; } }
  class BatchWriteCommand { constructor(input) { this.input = input; } }
  class DeleteCommand { constructor(input) { this.input = input; } }
  class ListObjectsV2Command { constructor(input) { this.input = input; } }
  class DeleteObjectsCommand { constructor(input) { this.input = input; } }

  const documentClient = {
    send: async (command) => {
      calls.dynamo.push(command);
      if (command instanceof ScanCommand) {
        return { Items: [{ analysis_id: 'analysis-1' }] };
      }
      if (command instanceof BatchWriteCommand) return { UnprocessedItems: {} };
      if (command instanceof DeleteCommand) return {};
      throw new Error(`Unexpected DynamoDB command ${command.constructor.name}`);
    },
  };
  const s3Client = {
    send: async (command) => {
      calls.s3.push(command);
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [{ Key: 'golf-swings/user-1/swing.mov' }], IsTruncated: false };
      }
      if (command instanceof DeleteObjectsCommand) return {};
      throw new Error(`Unexpected S3 command ${command.constructor.name}`);
    },
  };

  Module._load = function (request, parent, isMain) {
    if (request === '@aws-sdk/client-dynamodb') return { DynamoDBClient: class {} };
    if (request === '@aws-sdk/lib-dynamodb') {
      return {
        DynamoDBDocumentClient: { from: () => documentClient },
        ScanCommand,
        BatchWriteCommand,
        DeleteCommand,
      };
    }
    if (request === '@aws-sdk/client-s3') {
      return {
        S3Client: class { send(command) { return s3Client.send(command); } },
        ListObjectsV2Command,
        DeleteObjectsCommand,
      };
    }
    return originalLoad(request, parent, isMain);
  };

  process.env.DYNAMODB_TABLE = 'analyses';
  process.env.USER_RECORD_TABLES = 'threads,profiles,profiles-dev,users';
  process.env.VIDEO_BUCKET = 'videos';
  process.env.REVENUECAT_SECRET_API_KEY = 'sk_test';
  global.fetch = async (url, options) => {
    calls.revenueCat.push({ url, options });
    return { ok: true, status: 200 };
  };

  const handlerPath = path.join(__dirname, '..', 'src', 'api-handlers', 'account-deletion-handler.js');
  try {
    delete require.cache[require.resolve(handlerPath)];
    const loaded = require(handlerPath);
    return { ...loaded, calls, classes: { ScanCommand, BatchWriteCommand, DeleteCommand, ListObjectsV2Command, DeleteObjectsCommand } };
  } finally {
    Module._load = originalLoad;
  }
}

test('rejects requests without an authenticated Cognito subject', async () => {
  const { handler, calls } = loadHandler();
  const result = await handler({ requestContext: { http: { method: 'DELETE' } } });

  assert.equal(result.statusCode, 401);
  assert.equal(calls.dynamo.length, 0);
  assert.equal(calls.s3.length, 0);
  assert.equal(calls.revenueCat.length, 0);
});

test('deletes user objects, analyses, access, chat, and profile records', async () => {
  const { handler, calls, classes } = loadHandler();
  const result = await handler({
    requestContext: {
      http: { method: 'DELETE' },
      authorizer: { jwt: { claims: { sub: 'user-1' } } },
    },
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { deleted: true });

  assert.equal(calls.revenueCat.length, 1);
  assert.equal(calls.revenueCat[0].url, 'https://api.revenuecat.com/v1/subscribers/user-1');
  assert.equal(calls.revenueCat[0].options.method, 'DELETE');
  assert.equal(calls.revenueCat[0].options.headers.Authorization, 'Bearer sk_test');

  const list = calls.s3.find((call) => call instanceof classes.ListObjectsV2Command);
  assert.equal(list.input.Prefix, 'golf-swings/user-1/');
  assert.ok(calls.s3.some((call) => call instanceof classes.DeleteObjectsCommand));

  const batch = calls.dynamo.find((call) => call instanceof classes.BatchWriteCommand);
  assert.deepEqual(
    batch.input.RequestItems.analyses.map((item) => item.DeleteRequest.Key.analysis_id),
    ['analysis-1', 'access#user-1']
  );

  const directTables = calls.dynamo
    .filter((call) => call instanceof classes.DeleteCommand)
    .map((call) => call.input.TableName);
  assert.deepEqual(directTables, ['threads', 'profiles', 'profiles-dev', 'users']);
});

test('does not remove app data when RevenueCat deletion fails', async () => {
  const { handler, calls } = loadHandler();
  global.fetch = async (url, options) => {
    calls.revenueCat.push({ url, options });
    return { ok: false, status: 503 };
  };

  const result = await handler({
    requestContext: {
      http: { method: 'DELETE' },
      authorizer: { jwt: { claims: { sub: 'user-1' } } },
    },
  });

  assert.equal(result.statusCode, 500);
  assert.equal(calls.revenueCat.length, 1);
  assert.equal(calls.dynamo.length, 0);
  assert.equal(calls.s3.length, 0);
});

test('treats an already absent RevenueCat customer as deleted', async () => {
  const { handler, calls } = loadHandler();
  global.fetch = async (url, options) => {
    calls.revenueCat.push({ url, options });
    return { ok: false, status: 404 };
  };

  const result = await handler({
    requestContext: {
      http: { method: 'DELETE' },
      authorizer: { jwt: { claims: { sub: 'user-1' } } },
    },
  });

  assert.equal(result.statusCode, 200);
  assert.ok(calls.dynamo.length > 0);
  assert.ok(calls.s3.length > 0);
});
