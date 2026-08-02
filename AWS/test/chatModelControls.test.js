const Module = require('module');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// The chat handler pulls in the AWS SDK at module load; stub it so these
// pure-function tests can run without the Lambda runtime.
const originalLoad = Module._load;
const stub = (exports) => exports;
Module._load = function (request, parent, isMain) {
  if (request.startsWith('@aws-sdk/')) {
    return new Proxy({}, { get: () => class {} });
  }
  return originalLoad(request, parent, isMain);
};
const handlerPath = path.join(__dirname, '..', 'src', 'api-handlers', 'chat-api-handler.js');
const { getGpt5Minor, applyModelSpecificControls } = require(handlerPath).__private;
Module._load = originalLoad;

// Regression guard: the chat handler carries its OWN copy of the model
// controls. It had the same prefix-matching bug as the analysis processor,
// which would have 400'd every chat turn on any model past gpt-5.2.
test('chat: getGpt5Minor parses GPT-5 minor versions', () => {
  assert.equal(getGpt5Minor('gpt-5'), 0);
  assert.equal(getGpt5Minor('gpt-5.2'), 2);
  assert.equal(getGpt5Minor('gpt-5.6-terra'), 6);
  assert.equal(getGpt5Minor('gpt-5.6-luna'), 6);
  assert.equal(getGpt5Minor('gpt-4o-mini'), null);
});

test('chat: only original gpt-5 gets "minimal"; 5.1+ gets "low"', () => {
  assert.equal(applyModelSpecificControls({ model: 'gpt-5', temperature: 0.6 }).reasoning_effort, 'minimal');
  for (const model of ['gpt-5.1', 'gpt-5.2', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    const out = applyModelSpecificControls({ model, temperature: 0.6 });
    assert.equal(out.reasoning_effort, 'low', `${model} must not send 'minimal'`);
    assert.equal('temperature' in out, false, `${model} rejects temperature`);
  }
});

test('chat: non-GPT-5 models keep temperature untouched', () => {
  const out = applyModelSpecificControls({ model: 'gpt-4o-mini', temperature: 0.6 });
  assert.equal(out.temperature, 0.6);
  assert.equal(out.reasoning_effort, undefined);
});

test('chat: chatLoop temperature 0.6 is stripped for terra', () => {
  // chatLoop.js builds { model, messages, tools, temperature: 0.6, max_completion_tokens }
  const payload = { model: 'gpt-5.6-terra', messages: [], tools: [], temperature: 0.6, max_completion_tokens: 450 };
  const out = applyModelSpecificControls(payload);
  assert.equal('temperature' in out, false);
  assert.equal(out.max_completion_tokens, 450);
  assert.deepEqual(out.tools, []);
});

// Verified against the live API: gpt-5.6-terra returns HTTP 400 for function
// tools sent with any reasoning_effort other than 'none' on
// /v1/chat/completions. The chat loop ALWAYS sends tools.
test('chat: tool-calling requests force reasoning_effort "none" on 5.1+', () => {
  const tools = [{ type: 'function', function: { name: 'answer_visual_question' } }];
  for (const model of ['gpt-5.1', 'gpt-5.2', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    const out = applyModelSpecificControls({ model, tools, temperature: 0.6 });
    assert.equal(out.reasoning_effort, 'none', `${model} with tools must send 'none'`);
  }
});

test('chat: tool-free requests keep the normal effort level', () => {
  assert.equal(applyModelSpecificControls({ model: 'gpt-5.6-terra' }).reasoning_effort, 'low');
  assert.equal(applyModelSpecificControls({ model: 'gpt-5.6-terra', tools: [] }).reasoning_effort, 'low');
  assert.equal(applyModelSpecificControls({ model: 'gpt-5' , tools: [{}] }).reasoning_effort, 'minimal');
});
