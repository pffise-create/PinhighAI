const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SYSTEM_PROMPT,
  buildBatchPrompt,
  buildConsolidationPrompt,
} = require('../src/prompts/coachingSystemPrompt');

test('SYSTEM_PROMPT keeps key coaching constraints', () => {
  assert.ok(SYSTEM_PROMPT.includes('professional, friendly golf coach'));
  assert.ok(SYSTEM_PROMPT.includes('never mention frames or batching'));
});

test('buildBatchPrompt covers first batch instructions', () => {
  const prompt = buildBatchPrompt({ isFirstBatch: true });
  assert.ok(prompt.includes('cohesive video'));
  assert.ok(prompt.includes("up to three prioritized corrections"));
  assert.ok(prompt.includes('progress is iterative'));
});

test('buildBatchPrompt covers continuation guidance', () => {
  const prompt = buildBatchPrompt({ isFirstBatch: false });
  assert.ok(prompt.includes('Integrate what you see here with earlier batches'));
  assert.ok(prompt.includes("Avoid mentioning frames or batches"));
});

test('buildConsolidationPrompt embeds segment text', () => {
  const segmentText = 'Segment 1 analysis:\nScores';
  const prompt = buildConsolidationPrompt({ segmentText });
  assert.ok(prompt.includes('Combine the insights below into one concise coaching report'));
  assert.ok(prompt.endsWith(`Segment analyses:\n${segmentText}`));
});
