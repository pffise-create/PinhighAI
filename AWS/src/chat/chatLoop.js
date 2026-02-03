const swingRepository = require('../data/swingRepository');
const chatRepository = require('../data/chatRepository');
const swingProfileRepository = require('../data/swingProfileRepository');
const { SYSTEM_PROMPT, buildDeveloperContext } = require('../prompts/coachingSystemPrompt');
const CHAT_MODEL = process.env.CHAT_LOOP_MODEL || 'gpt-4o-mini';
const MAX_TOOL_ITERATIONS = parseInt(process.env.CHAT_LOOP_MAX_TOOL_RUNS || '4', 10);
const TOOL_TIMEOUT_MS = parseInt(process.env.CHAT_LOOP_TOOL_TIMEOUT_MS || '8000', 10);

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_last_swing',
      description: 'Return the most recent analyzed swing for this user. Optional limit (default 1).',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User identifier (defaults to authenticated user).' },
          limit: { type: 'integer', minimum: 1, maximum: 3, description: 'How many recent swings to include.' }
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_swing_analysis',
      description: 'Fetch the stored coaching analysis for a swing (summary, metrics, cues).',
      parameters: {
        type: 'object',
        properties: {
          analysis_id: { type: 'string', description: 'Analysis identifier.' }
        },
        required: ['analysis_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_swings',
      description: 'Compare two swings and return metric deltas.',
      parameters: {
        type: 'object',
        properties: {
          current_analysis_id: { type: 'string' },
          baseline_analysis_id: { type: 'string' }
        },
        required: ['current_analysis_id', 'baseline_analysis_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_user_swing_profile',
      description: 'Retrieve the golfer\'s swing profile snapshot if maintained.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User identifier (defaults to authenticated user).' }
        }
      },
    },
  },
];

function toAssistantMessages(turns) {
  if (!Array.isArray(turns)) {
    return [];
  }
  return turns
    .filter((turn) => turn && typeof turn.content === 'string' && turn.content.trim().length > 0)
    .map((turn) => ({
      role: turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.content,
    }));
}

async function executeToolCall(toolCall, { userId, dynamoClient, logger }) {
  const safeLog = logger || console;
  const { name, arguments: argsString } = toolCall.function || {};
  let args;
  try {
    args = argsString ? JSON.parse(argsString) : {};
  } catch (error) {
    safeLog.warn(`Failed to parse tool arguments for ${name}:`, error.message);
    return { error: 'Invalid tool arguments' };
  }

  const effectiveUserId = args.user_id || userId;

  try {
    switch (name) {
      case 'get_last_swing': {
        const limit = Math.min(Math.max(parseInt(args.limit || '1', 10), 1), 3);
        const swings = await swingRepository.getLastAnalyzedSwings({ userId: effectiveUserId, limit, client: dynamoClient });
        return { swings };
      }
      case 'get_swing_analysis': {
        const analysisId = args.analysis_id;
        if (!analysisId) {
          return { error: 'analysis_id is required' };
        }
        const analysis = await swingRepository.getSwingAnalysis({ analysisId, client: dynamoClient });
        if (!analysis) {
          return { error: 'Analysis not found' };
        }
        return { analysis };
      }
      case 'compare_swings': {
        const currentId = args.current_analysis_id;
        const baselineId = args.baseline_analysis_id;
        if (!currentId || !baselineId) {
          return { error: 'Both current_analysis_id and baseline_analysis_id are required' };
        }
        const [current, baseline] = await Promise.all([
          swingRepository.getSwingAnalysis({ analysisId: currentId, client: dynamoClient }),
          swingRepository.getSwingAnalysis({ analysisId: baselineId, client: dynamoClient }),
        ]);
        if (!current || !baseline) {
          return { error: 'Unable to fetch both swings for comparison' };
        }
        const comparison = swingRepository.compareSwings({ current, previous: baseline });
        return { comparison };
      }
      case 'get_user_swing_profile': {
        return { status: 'not_available', message: 'Swing profile storage not yet implemented.' };
      }
      default:
        safeLog.warn('Unsupported tool requested:', name);
        return { error: `Unsupported tool: ${name}` };
    }
  } catch (error) {
    safeLog.error(`Tool ${name} failed:`, error.message);
    return { error: error.message || 'Tool execution failed' };
  }
}

async function runChatCompletionLoop({ messages, userId, dynamoClient, requestOpenAi, logger }) {
  const safeLog = logger || console;
  let iterations = 0;
  const conversation = [...messages];

  while (iterations < MAX_TOOL_ITERATIONS) {
    const payload = {
      model: CHAT_MODEL,
      messages: conversation,
      tools: TOOL_DEFINITIONS,
      temperature: 0.6,
    };

    const response = await requestOpenAi(payload);
    const choice = response?.choices?.[0];
    if (!choice) {
      throw new Error('OpenAI chat completion returned no choices');
    }

    const assistantMessage = choice.message || {};
    const toolCalls = assistantMessage.tool_calls || [];

    if (toolCalls.length > 0) {
      conversation.push({
        role: 'assistant',
        content: assistantMessage.content || '',
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const result = await Promise.race([
          executeToolCall(toolCall, { userId, dynamoClient, logger: safeLog }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Tool execution timeout')), TOOL_TIMEOUT_MS)),
        ]).catch((error) => ({ error: error.message || 'Tool execution failed' }));

        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      iterations += 1;
      continue;
    }

    const answer = (assistantMessage.content || '').trim();
    return {
      assistantText: answer,
      rawResponse: response,
    };
  }

  throw new Error('Chat loop exceeded maximum tool iterations');
}

async function executeChatLoop({ userId, userMessage, dynamoClient, requestOpenAi, logger }) {
  if (!userMessage || !userMessage.trim()) {
    throw new Error('User message is required');
  }

  const safeLog = logger || console;
  const message = userMessage.trim();

  const turn = await chatRepository.recordTurn({
    userId,
    role: 'user',
    content: message,
    client: dynamoClient,
  });

  safeLog.debug?.('Recorded user turn', turn);

  const recentTurns = await chatRepository.getRecentTurns({ userId, client: dynamoClient });
  const swings = await swingRepository.getLastAnalyzedSwings({ userId, limit: 2, client: dynamoClient });
  const swingProfileRecord = await swingProfileRepository.getProfile({ userId, client: dynamoClient });
  const swingProfile = swingProfileRecord
    ? Object.fromEntries(Object.entries(swingProfileRecord).filter(([key]) => key !== 'user_id'))
    : null;

  const developerContext = buildDeveloperContext({ swings, swingProfile });

  const baseMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `Developer context: ${developerContext}` },
    ...toAssistantMessages(recentTurns),
  ];

  const result = await runChatCompletionLoop({
    messages: baseMessages,
    userId,
    dynamoClient,
    requestOpenAi,
    logger: safeLog,
  });

  const assistantText = result.assistantText || '';
  if (assistantText.trim().length > 0) {
    await chatRepository.recordTurn({
      userId,
      role: 'assistant',
      content: assistantText.trim(),
      client: dynamoClient,
    });
  }

  return {
    reply: assistantText.trim(),
    rawResponse: result.rawResponse,
  };
}

module.exports = {
  executeChatLoop,
  TOOL_DEFINITIONS,
};
