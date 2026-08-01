const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@aws-sdk/client-dynamodb') {
    return { DynamoDBClient: class {} };
  }
  if (request === '@aws-sdk/lib-dynamodb') {
    return {
      DynamoDBDocumentClient: { from: () => ({ send: async () => ({}) }) },
      GetCommand: class {},
      PutCommand: class {},
    };
  }
  return originalLoad(request, parent, isMain);
};

const test = require('node:test');
const assert = require('node:assert/strict');

const { executeChatLoop } = require('../src/chat/chatLoop');
const chatRepository = require('../src/data/chatRepository');
const swingRepository = require('../src/data/swingRepository');
const swingProfileRepository = require('../src/data/swingProfileRepository');

Module._load = originalLoad;

function createStubLogger() {
  return {
    debug: () => {},
    warn: () => {},
    error: () => {},
  };
}

test('executeChatLoop integrates developer context summary', async () => {
  const turns = [];
  const originalRecordTurn = chatRepository.recordTurn;
  const originalGetRecentTurns = chatRepository.getRecentTurns;
  const originalGetLastSwings = swingRepository.getLastAnalyzedSwings;
  const originalGetProfile = swingProfileRepository.getProfile;

  try {
    chatRepository.recordTurn = async ({ role, content }) => {
      turns.push({ role, content });
      return { role, content };
    };
    chatRepository.getRecentTurns = async () => turns;
    swingRepository.getLastAnalyzedSwings = async () => [
      {
        analysisId: 'analysis-current',
        summary: 'Current swing summary',
        analysisResults: {
          metrics: { path_deg: 1.0 },
        },
      },
      {
        analysisId: 'analysis-prior',
        summary: 'Prior swing summary',
        analysisResults: {
          metrics: { path_deg: 3.0 },
        },
      },
    ];
    swingProfileRepository.getProfile = async () => ({
      user_id: 'user-with-history',
      last_analysis_id: 'analysis-prior',
      focus_areas: ['Grip'],
      strengths: ['Tempo'],
      cautions: ['Club path'],
      metrics_snapshot: { path_deg: 3.0 },
      updated_at: new Date().toISOString(),
    });

    const requestOpenAi = async () => ({
      choices: [
        {
          message: {
            content: 'Path is trending in; keep rehearsing that shallow transition.',
          },
        },
      ],
    });

    const result = await executeChatLoop({
      userId: 'user-with-history',
      userMessage: 'Compare my last two swings.',
      dynamoClient: null,
      requestOpenAi,
      logger: createStubLogger(),
    });

    assert.equal(result.reply, 'Path is trending in; keep rehearsing that shallow transition.');
  } finally {
    chatRepository.recordTurn = originalRecordTurn;
    chatRepository.getRecentTurns = originalGetRecentTurns;
    swingRepository.getLastAnalyzedSwings = originalGetLastSwings;
    swingProfileRepository.getProfile = originalGetProfile;
  }
});

test('executeChatLoop returns assistant reply when model responds without tool calls', async () => {
  const turns = [];
  const originalRecordTurn = chatRepository.recordTurn;
  const originalGetRecentTurns = chatRepository.getRecentTurns;
  const originalGetLastSwings = swingRepository.getLastAnalyzedSwings;
  const originalGetProfile = swingProfileRepository.getProfile;

  try {
    chatRepository.recordTurn = async ({ role, content }) => {
      turns.push({ role, content });
      return { role, content };
    };
    chatRepository.getRecentTurns = async () => turns;
    swingRepository.getLastAnalyzedSwings = async () => [];
    swingProfileRepository.getProfile = async () => null;

    const requestOpenAi = async () => ({
      choices: [
        {
          message: {
            content: 'You are on plane. Keep rehearsing that smooth transition.',
          },
        },
      ],
    });

    const result = await executeChatLoop({
      userId: 'user-1',
      userMessage: 'How was that last swing?',
      dynamoClient: null,
      requestOpenAi,
      logger: createStubLogger(),
    });

    assert.equal(result.reply, 'You are on plane. Keep rehearsing that smooth transition.');
    assert.equal(turns.length, 2);
  } finally {
    chatRepository.recordTurn = originalRecordTurn;
    chatRepository.getRecentTurns = originalGetRecentTurns;
    swingRepository.getLastAnalyzedSwings = originalGetLastSwings;
    swingProfileRepository.getProfile = originalGetProfile;
  }
});

test('executeChatLoop resolves tool calls before returning final reply', async () => {
  const turns = [];
  const originalRecordTurn = chatRepository.recordTurn;
  const originalGetRecentTurns = chatRepository.getRecentTurns;
  const originalGetLastSwings = swingRepository.getLastAnalyzedSwings;
  const originalGetSwingAnalysis = swingRepository.getSwingAnalysis;
  const originalCompareSwings = swingRepository.compareSwings;
  const originalGetProfile = swingProfileRepository.getProfile;

  try {
    chatRepository.recordTurn = async ({ role, content }) => {
      turns.push({ role, content });
      return { role, content };
    };
    chatRepository.getRecentTurns = async () => turns;
    swingRepository.getLastAnalyzedSwings = async () => [
      {
        analysisId: 'analysis-new',
        summary: 'Latest swing summary',
        analysisResults: {
          metrics: { path_deg: 1.0 },
        },
      },
    ];
    swingRepository.getSwingAnalysis = async ({ analysisId }) => ({
      analysisId,
      summary: 'Detailed summary',
      analysisResults: {
        metrics: { path_deg: analysisId === 'analysis-new' ? 1.0 : 2.5 },
      },
    });
    swingRepository.compareSwings = async () => ({
      summary: ['path_deg: -1.5 (decrease)'],
    });
    swingProfileRepository.getProfile = async () => null;

    let callCount = 0;
    const requestOpenAi = async ({ tools }) => {
      if (callCount === 0) {
        callCount += 1;
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'tool_1',
                    type: 'function',
                    function: {
                      name: 'compare_swings',
                      arguments: JSON.stringify({
                        current_analysis_id: 'analysis-new',
                        baseline_analysis_id: 'analysis-baseline',
                      }),
                    },
                  },
                ],
              },
            },
          ],
        };
      }

      return {
        choices: [
          {
            message: {
              content: 'Compared the latest swing against your baseline and highlighted the delta.',
            },
          },
        ],
      };
    };

    const result = await executeChatLoop({
      userId: 'user-compare',
      userMessage: 'How did this swing compare to my baseline?',
      dynamoClient: null,
      requestOpenAi,
      logger: createStubLogger(),
    });

    assert.equal(result.reply, 'Compared the latest swing against your baseline and highlighted the delta.');
    assert.equal(turns.length, 2);
  } finally {
    chatRepository.recordTurn = originalRecordTurn;
    chatRepository.getRecentTurns = originalGetRecentTurns;
    swingRepository.getLastAnalyzedSwings = originalGetLastSwings;
    swingRepository.getSwingAnalysis = originalGetSwingAnalysis;
    swingRepository.compareSwings = originalCompareSwings;
    swingProfileRepository.getProfile = originalGetProfile;
  }
});

test('executeChatLoop routes visual follow-ups through latest video frame context', async () => {
  const turns = [];
  const originalRecordTurn = chatRepository.recordTurn;
  const originalGetRecentTurns = chatRepository.getRecentTurns;
  const originalGetLastSwings = swingRepository.getLastAnalyzedSwings;
  const originalGetProfile = swingProfileRepository.getProfile;

  try {
    chatRepository.recordTurn = async ({ role, content, metadata }) => {
      turns.push({ role, content, metadata });
      return { role, content, metadata };
    };
    chatRepository.getRecentTurns = async () => turns;
    swingRepository.getLastAnalyzedSwings = async () => [];
    swingProfileRepository.getProfile = async () => null;

    let requestOpenAiCalled = false;
    let visualToolArgs = null;
    const result = await executeChatLoop({
      userId: 'user-video',
      userMessage: 'Can you see the video I just uploaded?',
      dynamoClient: null,
      requestOpenAi: async () => {
        requestOpenAiCalled = true;
        return { choices: [{ message: { content: 'should not be used' } }] };
      },
      visualQuestionTool: async (args) => {
        visualToolArgs = args;
        return {
          status: 'ok',
          answer: 'Yes, I can reference your latest uploaded swing video from the extracted frames.',
          analysis_id: 'analysis-latest',
          frames_used: ['latest_uploaded_swing:frame_000'],
          duration_ms: 12,
        };
      },
      logger: createStubLogger(),
    });

    assert.equal(requestOpenAiCalled, false);
    assert.equal(visualToolArgs.responseMode, 'visual_fact_check');
    assert.equal(visualToolArgs.compareCount, 1);
    assert.equal(result.reply, 'Yes, I can reference your latest uploaded swing video from the extracted frames.');
    assert.equal(turns[1].metadata.source, 'frame_rereview');
    assert.equal(turns[1].metadata.analysis_id, 'analysis-latest');
  } finally {
    chatRepository.recordTurn = originalRecordTurn;
    chatRepository.getRecentTurns = originalGetRecentTurns;
    swingRepository.getLastAnalyzedSwings = originalGetLastSwings;
    swingProfileRepository.getProfile = originalGetProfile;
  }
});

test('executeChatLoop routes improvement questions through two-swing comparison context', async () => {
  const turns = [];
  const originalRecordTurn = chatRepository.recordTurn;
  const originalGetRecentTurns = chatRepository.getRecentTurns;
  const originalGetLastSwings = swingRepository.getLastAnalyzedSwings;
  const originalGetProfile = swingProfileRepository.getProfile;

  try {
    chatRepository.recordTurn = async ({ role, content, metadata }) => {
      turns.push({ role, content, metadata });
      return { role, content, metadata };
    };
    chatRepository.getRecentTurns = async () => turns;
    swingRepository.getLastAnalyzedSwings = async () => [];
    swingProfileRepository.getProfile = async () => null;

    let visualToolArgs = null;
    const result = await executeChatLoop({
      userId: 'user-compare-video',
      userMessage: 'Is this swing an improvement vs. my last one?',
      dynamoClient: null,
      requestOpenAi: async () => ({ choices: [{ message: { content: 'should not be used' } }] }),
      visualQuestionTool: async (args) => {
        visualToolArgs = args;
        return {
          status: 'ok',
          answer: 'Yes, compared with the previous upload, the latest swing has a better finish and more stable posture.',
          analysis_id: 'analysis-latest',
          analysis_ids: ['analysis-latest', 'analysis-previous'],
          frames_used: ['latest_uploaded_swing:frame_000', 'previous_uploaded_swing:frame_000'],
          duration_ms: 20,
        };
      },
      logger: createStubLogger(),
    });

    assert.equal(visualToolArgs.responseMode, 'swing_comparison');
    assert.equal(visualToolArgs.compareCount, 2);
    assert.equal(result.reply, 'Yes, compared with the previous upload, the latest swing has a better finish and more stable posture.');
    assert.deepEqual(turns[1].metadata.frames_used, [
      'latest_uploaded_swing:frame_000',
      'previous_uploaded_swing:frame_000',
    ]);
  } finally {
    chatRepository.recordTurn = originalRecordTurn;
    chatRepository.getRecentTurns = originalGetRecentTurns;
    swingRepository.getLastAnalyzedSwings = originalGetLastSwings;
    swingProfileRepository.getProfile = originalGetProfile;
  }
});

test('executeChatLoop injects loaded video context into standard chat prompts', async () => {
  const turns = [];
  const originalRecordTurn = chatRepository.recordTurn;
  const originalGetRecentTurns = chatRepository.getRecentTurns;
  const originalGetLastSwings = swingRepository.getLastAnalyzedSwings;
  const originalGetProfile = swingProfileRepository.getProfile;

  try {
    chatRepository.recordTurn = async ({ role, content, metadata }) => {
      turns.push({ role, content, metadata });
      return { role, content, metadata };
    };
    chatRepository.getRecentTurns = async () => turns;
    swingRepository.getLastAnalyzedSwings = async () => [
      {
        analysisId: 'analysis-latest',
        status: 'AI_COMPLETED',
        summary: 'Latest swing summary with hands dropping in front.',
        analysisResults: {
          video_duration: 2,
          fps: 4,
          frames_extracted: 8,
          metrics: { path_deg: 1.0 },
        },
        visualObservations: [
          {
            phase: 'downswing',
            observation: 'Hands drop in front of the body.',
            confidence: 0.7,
            impact: 'positive',
          },
        ],
      },
    ];
    swingProfileRepository.getProfile = async () => null;

    let capturedMessages = null;
    const result = await executeChatLoop({
      userId: 'user-context',
      userMessage: 'What should I practice today?',
      dynamoClient: null,
      requestOpenAi: async ({ messages }) => {
        capturedMessages = messages;
        return {
          choices: [
            {
              message: {
                content: 'Practice the same hands-in-front feel from your latest upload.',
              },
            },
          ],
        };
      },
      logger: createStubLogger(),
    });

    const loadedContextMessage = capturedMessages.find((message) =>
      message.role === 'system' && message.content.startsWith('Loaded video context:')
    );
    assert.ok(loadedContextMessage, 'loaded video context should be injected');
    assert.match(loadedContextMessage.content, /analysis-latest/);
    assert.match(loadedContextMessage.content, /Latest swing summary/);
    assert.match(loadedContextMessage.content, /Hands drop in front/);
    assert.match(loadedContextMessage.content, /do not claim you cannot access or reference the uploaded video/i);
    assert.equal(result.reply, 'Practice the same hands-in-front feel from your latest upload.');
  } finally {
    chatRepository.recordTurn = originalRecordTurn;
    chatRepository.getRecentTurns = originalGetRecentTurns;
    swingRepository.getLastAnalyzedSwings = originalGetLastSwings;
    swingProfileRepository.getProfile = originalGetProfile;
  }
});

