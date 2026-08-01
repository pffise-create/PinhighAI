const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('node:path');

const gatePath = path.join(__dirname, '..', 'src', 'access', 'entitlementGate.js');

// The AWS SDK is provided by the Lambda runtime and is not installed locally;
// the gate only needs the command classes, which carry constructor names.
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
const libDynamoMock = { GetCommand, UpdateCommand };

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@aws-sdk/lib-dynamodb') return libDynamoMock;
  return originalLoad(request, parent, isMain);
};

function loadGate(env = {}) {
  const managedKeys = [
    'SUBSCRIPTION_GATING_ENABLED',
    'ONE_TIME_LOCKED_RESULT_ENABLED',
    'REVENUECAT_SECRET_API_KEY',
    'USER_ACCESS_TABLE',
    'DYNAMODB_TABLE',
  ];
  const previous = {};
  for (const key of managedKeys) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  process.env.DYNAMODB_TABLE = 'golf-coach-analyses';
  Object.assign(process.env, env);

  delete require.cache[require.resolve(gatePath)];
  const gate = require(gatePath);

  return {
    gate,
    restore: () => {
      for (const key of managedKeys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    },
  };
}

function fakeClient({ accessItem = null } = {}) {
  const sends = [];
  return {
    sends,
    send: async (command) => {
      sends.push(command);
      const name = command?.constructor?.name || '';
      if (name === 'GetCommand') return { Item: accessItem };
      return { Attributes: {} };
    },
  };
}

function stubFetch(impl) {
  const original = global.fetch;
  global.fetch = impl;
  return () => {
    global.fetch = original;
  };
}

test('gating disabled returns full access without touching DynamoDB', async () => {
  const { gate, restore } = loadGate();
  const client = fakeClient();
  try {
    const decision = await gate.evaluateAccessForLockedResult({
      userId: 'user-1',
      client,
      previewType: 'video_analysis',
      resultRef: 'analysis-1',
    });
    assert.equal(decision.allowFullResult, true);
    assert.equal(decision.gatingEnabled, false);
    assert.equal(client.sends.length, 0);
  } finally {
    restore();
  }
});

test('non-entitled user gets a teaser on every result in default mode', async () => {
  const { gate, restore } = loadGate({ SUBSCRIPTION_GATING_ENABLED: 'true' });
  const client = fakeClient({ accessItem: null });
  try {
    for (const ref of ['analysis-1', 'analysis-2', 'analysis-3']) {
      const decision = await gate.evaluateAccessForLockedResult({
        userId: 'user-1',
        client,
        previewType: 'video_analysis',
        resultRef: ref,
      });
      assert.equal(decision.allowFullResult, false);
      assert.equal(decision.allowLockedResult, true, `teaser expected for ${ref}`);
      assert.equal(decision.teaserMode, 'always');
    }
  } finally {
    restore();
  }
});

test('one-time mode still limits teasers to a single result', async () => {
  const { gate, restore } = loadGate({
    SUBSCRIPTION_GATING_ENABLED: 'true',
    ONE_TIME_LOCKED_RESULT_ENABLED: 'true',
  });
  const client = fakeClient({ accessItem: null });
  try {
    const decision = await gate.evaluateAccessForLockedResult({
      userId: 'user-1',
      client,
      previewType: 'video_analysis',
      resultRef: 'analysis-1',
    });
    assert.equal(decision.allowLockedResult, true);
    assert.equal(decision.firstLockedResult, true);
  } finally {
    restore();
  }
});

test('missing userId is locked with no teaser when gating is on', async () => {
  const { gate, restore } = loadGate({ SUBSCRIPTION_GATING_ENABLED: 'true' });
  try {
    const decision = await gate.evaluateAccessForLockedResult({
      userId: null,
      client: fakeClient(),
      previewType: 'video_analysis',
      resultRef: 'analysis-1',
    });
    assert.equal(decision.allowFullResult, false);
    assert.equal(decision.allowLockedResult, false);
    assert.equal(decision.reason, 'missing_user_id');
  } finally {
    restore();
  }
});

test('RevenueCat lookup unlocks a user with an active entitlement and persists it', async () => {
  const { gate, restore } = loadGate({
    SUBSCRIPTION_GATING_ENABLED: 'true',
    REVENUECAT_SECRET_API_KEY: 'sk_test',
  });
  const client = fakeClient({ accessItem: null });
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  const restoreFetch = stubFetch(async (url, options) => {
    assert.ok(String(url).includes('/subscribers/user-1'));
    assert.equal(options.headers.Authorization, 'Bearer sk_test');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        subscriber: {
          entitlements: {
            'DivotLab Unlimited': { expires_date: expiresAt },
          },
        },
      }),
    };
  });

  try {
    const decision = await gate.evaluateAccessForLockedResult({
      userId: 'user-1',
      client,
      previewType: 'video_analysis',
      resultRef: 'analysis-1',
    });
    assert.equal(decision.allowFullResult, true);
    assert.equal(decision.entitled, true);

    // Write-through: entitlement cached on the access record
    const update = client.sends.find((c) => c?.constructor?.name === 'UpdateCommand');
    assert.ok(update, 'expected entitlement persist UpdateCommand');
    assert.equal(update.input.ExpressionAttributeValues[':active'], true);
    assert.equal(update.input.ExpressionAttributeValues[':expiresAt'], expiresAt);
  } finally {
    restoreFetch();
    restore();
  }
});

test('RevenueCat 404 (unknown subscriber) stays locked', async () => {
  const { gate, restore } = loadGate({
    SUBSCRIPTION_GATING_ENABLED: 'true',
    REVENUECAT_SECRET_API_KEY: 'sk_test',
  });
  const restoreFetch = stubFetch(async () => ({ ok: false, status: 404 }));

  try {
    const decision = await gate.evaluateAccessForLockedResult({
      userId: 'user-1',
      client: fakeClient({ accessItem: null }),
      previewType: 'video_analysis',
      resultRef: 'analysis-1',
    });
    assert.equal(decision.allowFullResult, false);
    assert.equal(decision.allowLockedResult, true);
  } finally {
    restoreFetch();
    restore();
  }
});

test('RevenueCat outage grants grace to a previously active record', async () => {
  const { gate, restore } = loadGate({
    SUBSCRIPTION_GATING_ENABLED: 'true',
    REVENUECAT_SECRET_API_KEY: 'sk_test',
  });
  const restoreFetch = stubFetch(async () => {
    throw new Error('ECONNRESET');
  });

  try {
    const decision = await gate.evaluateAccessForLockedResult({
      userId: 'user-1',
      client: fakeClient({
        accessItem: {
          entitlement_active: true,
          entitlement_expires_at: new Date(Date.now() - 60_000).toISOString(),
        },
      }),
      previewType: 'video_analysis',
      resultRef: 'analysis-1',
    });
    assert.equal(decision.allowFullResult, true, 'lapsed payer keeps access during RC outage');
  } finally {
    restoreFetch();
    restore();
  }
});

test('buildLockedContent extracts a teaser without leaking the full analysis', () => {
  const { gate, restore } = loadGate();
  try {
    const locked = gate.buildLockedContent({
      aiAnalysis: JSON.stringify({
        coaching_response: 'Line one of the coaching.\nDeep detail that should stay locked.',
        root_cause: 'Over-the-top move',
        practice_recommendations: [{ title: 'Headcover drill' }],
      }),
    });
    assert.equal(locked.locked, true);
    assert.equal(locked.preview_summary, 'Line one of the coaching.');
    assert.equal(locked.preview_key_issue, 'Over-the-top move');
    assert.equal(locked.preview_one_tip, 'Headcover drill');
    assert.equal(locked.cta_action, 'start_trial');
    assert.equal(JSON.stringify(locked).includes('Deep detail'), false);
  } finally {
    restore();
  }
});
