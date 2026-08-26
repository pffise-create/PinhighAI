const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('node:path');

function loadHandlerWithMocks({
  item,
  accessItem = null,
  aiFunctionName = 'golf-ai-analysis-processor',
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

  // Memoized module mocks: the handler AND the entitlement gate both require
  // these packages, and instanceof checks break if each require gets fresh
  // class identities.
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
          if (command instanceof UpdateCommand) {
            return { Attributes: {} };
          }
          throw new Error(`Unexpected DynamoDB command: ${command?.constructor?.name}`);
        },
      }),
    },
    GetCommand,
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

  process.env.DYNAMODB_TABLE = 'golf-coach-analyses';
  if (aiFunctionName) {
    process.env.AI_ANALYSIS_PROCESSOR_FUNCTION_NAME = aiFunctionName;
  } else {
    delete process.env.AI_ANALYSIS_PROCESSOR_FUNCTION_NAME;
  }

  const managedEnvKeys = ['SUBSCRIPTION_GATING_ENABLED', 'ONE_TIME_LOCKED_RESULT_ENABLED', 'REVENUECAT_SECRET_API_KEY'];
  const previousEnv = {};
  for (const key of managedEnvKeys) {
    previousEnv[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, env);

  const handlerPath = path.join(__dirname, '..', 'src', 'api-handlers', 'results-api-handler.js');
  const gatePath = path.join(__dirname, '..', 'src', 'access', 'entitlementGate.js');

  try {
    delete require.cache[require.resolve(handlerPath)];
    delete require.cache[require.resolve(gatePath)];
    const moduleExports = require(handlerPath);
    return {
      handler: moduleExports.handler,
      calls,
      classes: {
        GetCommand,
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
  analysis_id: 'analysis-2',
  status: 'AI_COMPLETED',
  ai_analysis_completed: true,
  ai_analysis: JSON.stringify({
    coaching_response: 'Great transition. Your hips clear early and the club shallows nicely.',
    root_cause: 'Early extension through impact',
    symptoms_detected: ['Standing up at impact'],
    practice_recommendations: [{ title: 'Wall drill', description: 'Keep glutes on the wall.' }],
  }),
  analysis_results: { frames_extracted: 12 },
  progress_message: 'AI coaching analysis completed successfully',
  user_id: 'user-2',
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  ...overrides,
});

test('results handler retries AI analysis for stalled completed uploads', async () => {
  const staleUpdatedAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const { handler, calls, classes, restoreEnv } = loadHandlerWithMocks({
    item: {
      analysis_id: 'analysis-1',
      status: 'COMPLETED',
      ai_analysis_completed: false,
      analysis_results: { frames_extracted: 12 },
      progress_message: 'Frame extraction completed.',
      user_id: 'user-1',
      updated_at: staleUpdatedAt,
      created_at: staleUpdatedAt,
    },
  });

  try {
    const response = await handler({
      httpMethod: 'GET',
      pathParameters: { jobId: 'analysis-1' },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'analyzing');
    assert.equal(calls.lambda.length, 1);

    const invokePayload = JSON.parse(calls.lambda[0].input.Payload);
    assert.equal(invokePayload.analysis_id, 'analysis-1');
    assert.equal(invokePayload.user_id, 'user-1');

    const updateCalls = calls.dynamo.filter((command) => command instanceof classes.UpdateCommand);
    assert.equal(updateCalls.length, 1);
  } finally {
    restoreEnv();
  }
});

test('results handler does not retry when AI analysis is already completed', async () => {
  const { handler, calls, restoreEnv } = loadHandlerWithMocks({
    item: completedItem(),
  });

  try {
    const response = await handler({
      httpMethod: 'GET',
      pathParameters: { jobId: 'analysis-2' },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'completed');
    assert.equal(calls.lambda.length, 0);
  } finally {
    restoreEnv();
  }
});

test('results handler returns full analysis when gating is disabled', async () => {
  const { handler, restoreEnv } = loadHandlerWithMocks({
    item: completedItem({
      video_breakdown: {
        status: 'completed',
        title: 'Swing Breakdown',
        summary: 'Muted by default. Captions stay on.',
        video_url: 'https://example.com/breakdown.mp4',
        poster_url: 'https://example.com/poster.jpg',
        muted_default: true,
        scenes: [
          {
            id: 'scene_1',
            caption: 'Chest keeps moving through impact.',
            start_seconds: 0,
            end_seconds: 4.1,
          },
        ],
      },
    }),
  });

  try {
    const response = await handler({
      httpMethod: 'GET',
      pathParameters: { jobId: 'analysis-2' },
    });

    const body = JSON.parse(response.body);
    assert.equal(body.locked, undefined);
    assert.ok(body.ai_analysis);
    assert.equal(body.ai_analysis.coaching_response.includes('Great transition'), true);
    assert.equal(body.video_breakdown.status, 'completed');
    assert.equal(body.video_breakdown.video_url, 'https://example.com/breakdown.mp4');
    assert.equal(body.video_breakdown.scenes.length, 1);
  } finally {
    restoreEnv();
  }
});

test('results handler locks analysis into a teaser for non-entitled users', async () => {
  const { handler, restoreEnv } = loadHandlerWithMocks({
    item: completedItem(),
    accessItem: null, // no access record => not entitled
    env: { SUBSCRIPTION_GATING_ENABLED: 'true' },
  });

  try {
    const response = await handler({
      httpMethod: 'GET',
      pathParameters: { jobId: 'analysis-2' },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'completed');
    assert.equal(body.locked, true);
    assert.equal(body.lock_reason, 'subscription_required');
    assert.equal(body.ai_analysis, undefined);
    assert.equal(body.analysis_results, undefined);
    assert.equal(body.locked_analysis.locked, true);
    assert.ok(body.locked_analysis.preview_summary);
    assert.equal(body.locked_analysis.cta_action, 'start_trial');
    // Teaser must not leak the full coaching response
    assert.equal(JSON.stringify(body).includes('Keep glutes on the wall'), false);
  } finally {
    restoreEnv();
  }
});

test('results handler returns full analysis for entitled users when gating is on', async () => {
  const { handler, restoreEnv } = loadHandlerWithMocks({
    item: completedItem(),
    accessItem: {
      analysis_id: 'access#user-2',
      entitlement_active: true,
      entitlement_expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    },
    env: { SUBSCRIPTION_GATING_ENABLED: 'true' },
  });

  try {
    const response = await handler({
      httpMethod: 'GET',
      pathParameters: { jobId: 'analysis-2' },
    });

    const body = JSON.parse(response.body);
    assert.equal(body.locked, undefined);
    assert.ok(body.ai_analysis);
  } finally {
    restoreEnv();
  }
});

test('results handler re-locks when the entitlement expiry has passed', async () => {
  const { handler, restoreEnv } = loadHandlerWithMocks({
    item: completedItem(),
    accessItem: {
      analysis_id: 'access#user-2',
      entitlement_active: true,
      entitlement_expires_at: new Date(Date.now() - 60_000).toISOString(),
    },
    env: { SUBSCRIPTION_GATING_ENABLED: 'true' },
  });

  try {
    const response = await handler({
      httpMethod: 'GET',
      pathParameters: { jobId: 'analysis-2' },
    });

    const body = JSON.parse(response.body);
    assert.equal(body.locked, true);
    assert.equal(body.ai_analysis, undefined);
  } finally {
    restoreEnv();
  }
});

test('results handler denies access when the verified requester does not own the analysis', async () => {
  const { handler, calls, restoreEnv } = loadHandlerWithMocks({
    item: completedItem({
      user_id: 'owner-user',
    }),
  });

  try {
    const response = await handler({
      httpMethod: 'GET',
      pathParameters: { jobId: 'analysis-2' },
      requestContext: {
        authorizer: {
          jwt: {
            claims: { sub: 'different-user' },
          },
        },
      },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(JSON.parse(response.body).error, 'Forbidden');
    assert.equal(calls.lambda.length, 0);
  } finally {
    restoreEnv();
  }
});
