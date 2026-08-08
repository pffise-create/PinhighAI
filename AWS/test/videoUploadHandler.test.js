const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('node:path');

function loadHandlerWithMocks({
  item,
  accessItem = null,
  breakdownFunctionName = 'golf-video-breakdown-processor',
  env = {},
}) {
  const originalLoad = Module._load;
  const calls = {
    dynamo: [],
    lambda: [],
  };

  class GetCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class PutCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class UpdateCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class InvokeCommand {
    constructor(input) {
      this.input = input;
    }
  }

  const libDynamoMock = {
    DynamoDBDocumentClient: {
      from: () => ({
        send: async (command) => {
          calls.dynamo.push(command);
          if (command instanceof GetCommand) {
            const key = command.input?.Key?.analysis_id || '';
            if (String(key).startsWith('access#')) {
              return { Item: accessItem };
            }
            return { Item: item };
          }
          if (command instanceof PutCommand || command instanceof UpdateCommand) {
            return {};
          }
          throw new Error(`Unexpected DynamoDB command: ${command?.constructor?.name}`);
        },
      }),
    },
    GetCommand,
    PutCommand,
    UpdateCommand,
  };

  const clientDynamoMock = { DynamoDBClient: class {} };

  const clientLambdaMock = {
    LambdaClient: class {
      async send(command) {
        calls.lambda.push(command);
        return { StatusCode: 202 };
      }
    },
    InvokeCommand,
  };

  Module._load = function (request, parent, isMain) {
    if (request === '@aws-sdk/client-dynamodb') return clientDynamoMock;
    if (request === '@aws-sdk/lib-dynamodb') return libDynamoMock;
    if (request === '@aws-sdk/client-lambda') return clientLambdaMock;
    return originalLoad(request, parent, isMain);
  };

  const managedEnvKeys = [
    'DYNAMODB_TABLE',
    'VIDEO_BREAKDOWN_PROCESSOR_FUNCTION_NAME',
    'SUBSCRIPTION_GATING_ENABLED',
    'ONE_TIME_LOCKED_RESULT_ENABLED',
    'REVENUECAT_SECRET_API_KEY',
  ];
  const previousEnv = {};
  for (const key of managedEnvKeys) {
    previousEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.DYNAMODB_TABLE = 'golf-coach-analyses';
  process.env.VIDEO_BREAKDOWN_PROCESSOR_FUNCTION_NAME = breakdownFunctionName;
  Object.assign(process.env, env);

  const handlerPath = path.join(__dirname, '..', 'src', 'api-handlers', 'video-upload-handler.js');
  const gatePath = path.join(__dirname, '..', 'src', 'access', 'entitlementGate.js');

  try {
    delete require.cache[require.resolve(handlerPath)];
    delete require.cache[require.resolve(gatePath)];
    const moduleExports = require(handlerPath);
    return {
      startVideoBreakdownWorkflow: moduleExports.__private.startVideoBreakdownWorkflow,
      calls,
      classes: {
        GetCommand,
        PutCommand,
        UpdateCommand,
        InvokeCommand,
      },
      restoreEnv: () => {
        for (const key of managedEnvKeys) {
          if (previousEnv[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = previousEnv[key];
          }
        }
      },
    };
  } finally {
    Module._load = originalLoad;
  }
}

const completedItem = (overrides = {}) => ({
  analysis_id: 'analysis-1',
  status: 'AI_COMPLETED',
  ai_analysis_completed: true,
  user_id: 'user-1',
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  ...overrides,
});

test('breakdown workflow denies access for non-entitled users when gating is enabled', async () => {
  const { startVideoBreakdownWorkflow, calls, classes, restoreEnv } = loadHandlerWithMocks({
    item: completedItem(),
    accessItem: null,
    env: { SUBSCRIPTION_GATING_ENABLED: 'true' },
  });

  try {
    const response = await startVideoBreakdownWorkflow('analysis-1', { userId: 'user-1' });
    assert.equal(response.statusCode, 403);
    assert.equal(JSON.parse(response.body).code, 'SUBSCRIPTION_REQUIRED');
    assert.equal(calls.lambda.length, 0);

    const updateCalls = calls.dynamo.filter((command) => command instanceof classes.UpdateCommand);
    assert.equal(updateCalls.length, 0);
  } finally {
    restoreEnv();
  }
});

test('breakdown workflow queues rendering for entitled users', async () => {
  const { startVideoBreakdownWorkflow, calls, classes, restoreEnv } = loadHandlerWithMocks({
    item: completedItem(),
    accessItem: {
      analysis_id: 'access#user-1',
      entitlement_active: true,
      entitlement_expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    },
    env: { SUBSCRIPTION_GATING_ENABLED: 'true' },
  });

  try {
    const response = await startVideoBreakdownWorkflow('analysis-1', { userId: 'user-1' });
    assert.equal(response.statusCode, 202);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'queued');
    assert.equal(body.video_breakdown.status, 'queued');
    assert.equal(body.video_breakdown.muted_default, true);
    assert.equal(calls.lambda.length, 1);

    const updateCalls = calls.dynamo.filter((command) => command instanceof classes.UpdateCommand);
    assert.equal(updateCalls.length, 1);
  } finally {
    restoreEnv();
  }
});

test('breakdown workflow returns an existing completed asset for entitled users', async () => {
  const { startVideoBreakdownWorkflow, calls, restoreEnv } = loadHandlerWithMocks({
    item: completedItem({
      video_breakdown: {
        status: 'completed',
        title: 'Swing Breakdown',
        video_url: 'https://example.com/breakdown.mp4',
        poster_url: 'https://example.com/poster.jpg',
        muted_default: true,
        scenes: [],
      },
    }),
    accessItem: {
      analysis_id: 'access#user-1',
      entitlement_active: true,
      entitlement_expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    },
    env: { SUBSCRIPTION_GATING_ENABLED: 'true' },
  });

  try {
    const response = await startVideoBreakdownWorkflow('analysis-1', { userId: 'user-1' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'completed');
    assert.equal(body.video_breakdown.video_url, 'https://example.com/breakdown.mp4');
    assert.equal(calls.lambda.length, 0);
  } finally {
    restoreEnv();
  }
});
