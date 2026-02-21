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

