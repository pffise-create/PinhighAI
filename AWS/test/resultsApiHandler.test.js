const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('node:path');

function loadHandlerWithMocks({ item, aiFunctionName = 'golf-ai-analysis-processor' }) {
  const originalLoad = Module._load;
  const calls = {
    dynamo: [],
    lambda: [],
  };

  let GetCommand;
  let UpdateCommand;
  let InvokeCommand;

  Module._load = function (request, parent, isMain) {
    if (request === '@aws-sdk/client-dynamodb') {
      return { DynamoDBClient: class {} };
    }

    if (request === '@aws-sdk/lib-dynamodb') {
      GetCommand = class {
        constructor(input) {
          this.input = input;
        }
      };

      UpdateCommand = class {
        constructor(input) {
          this.input = input;
        }
      };

      return {
        DynamoDBDocumentClient: {
          from: () => ({
            send: async (command) => {
              calls.dynamo.push(command);
              if (command instanceof GetCommand) {
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
    }

    if (request === '@aws-sdk/client-lambda') {
      InvokeCommand = class {
        constructor(input) {
          this.input = input;
        }
      };

      return {
        LambdaClient: class {
          async send(command) {
            calls.lambda.push(command);
            return { StatusCode: 202 };
          }
        },
        InvokeCommand,
      };
    }

    return originalLoad(request, parent, isMain);
  };

  process.env.DYNAMODB_TABLE = 'golf-coach-analyses';
  if (aiFunctionName) {
    process.env.AI_ANALYSIS_PROCESSOR_FUNCTION_NAME = aiFunctionName;
  } else {
    delete process.env.AI_ANALYSIS_PROCESSOR_FUNCTION_NAME;
  }

  const handlerPath = path.join(__dirname, '..', 'src', 'api-handlers', 'results-api-handler.js');

  try {
    delete require.cache[require.resolve(handlerPath)];
    const moduleExports = require(handlerPath);
    return {
      handler: moduleExports.handler,
      calls,
      classes: {
        GetCommand,
        UpdateCommand,
        InvokeCommand,
      },
    };
  } finally {
    Module._load = originalLoad;
  }
}

test('results handler retries AI analysis for stalled completed uploads', async () => {
  const staleUpdatedAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const { handler, calls, classes } = loadHandlerWithMocks({
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
});

test('results handler does not retry when AI analysis is already completed', async () => {
  const { handler, calls } = loadHandlerWithMocks({
    item: {
      analysis_id: 'analysis-2',
      status: 'AI_COMPLETED',
      ai_analysis_completed: true,
      ai_analysis: JSON.stringify({ coaching_response: 'Great transition.' }),
      progress_message: 'AI coaching analysis completed successfully',
      user_id: 'user-2',
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
  });

  const response = await handler({
    httpMethod: 'GET',
    pathParameters: { jobId: 'analysis-2' },
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.status, 'completed');
  assert.equal(calls.lambda.length, 0);
});
