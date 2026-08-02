const swingRepository = require('../data/swingRepository');
const chatRepository = require('../data/chatRepository');
const swingProfileRepository = require('../data/swingProfileRepository');
const {
  SYSTEM_PROMPT,
  buildDeveloperContext,
  buildChatResponseContractPrompt,
} = require('../prompts/coachingSystemPrompt');
const swingMemory = require('../memory/swingMemory');
const { detectAssertion } = require('../memory/prescriptionGuard');
// Coaching memory: retrieval + prescription guard + visual-comparison planning.
// Beat the prior recency-window context 170-125 across 9 probes
// (docs/memory-head-to-head-2026-08-02.md). Disable to fall back.
const SWING_MEMORY_ENABLED = process.env.SWING_MEMORY_ENABLED !== 'false';
// Full-history reranking only pays for itself when the question reaches into
// the past; a wide fetch on every turn would add ~1s and megabytes of frame
// metadata to routine questions.
const HISTORY_SWINGS_WIDE = Math.max(10, parseInt(process.env.MAX_HISTORY_SWINGS || '80', 10));
const CHAT_MODEL = process.env.CHAT_LOOP_MODEL || 'gpt-4o-mini';
const MAX_TOOL_ITERATIONS = parseInt(process.env.CHAT_LOOP_MAX_TOOL_RUNS || '2', 10);
const TOOL_TIMEOUT_MS = parseInt(process.env.CHAT_LOOP_TOOL_TIMEOUT_MS || '8000', 10);
const VISUAL_KEYWORDS = [
  'look',
  'see',
  'color',
  'shirt',
  'shoes',
  'hat',
  'stance',
  'posture',
  'where was',
  'did you notice',
  'was that better',
  'did that look better',
  'last video',
  'last swing',
  'last upload',
  'video i uploaded',
  'video i just uploaded',
];
const TECHNICAL_KEYWORDS = [
  'path',
  'clubface',
  'face-to-path',
  'impact',
  'transition',
  'rotation',
  'wrist',
  'shaft',
  'numbers',
  'degrees',
  'analysis',
  'breakdown',
  'over the top',
  'ott',
  'shallow',
  'steep',
  'on plane',
  'backswing',
  'downswing',
  'follow through',
  'follow-through',
  'body',
  'pivot',
  'sequence',
  'sequencing',
  'release',
  'overrotate',
  'pitch shot',
];
const COMPARISON_KEYWORDS = [
  'improvement',
  'improved',
  'better than',
  'worse than',
  'vs my last',
  'versus my last',
  'compared to',
  'compare',
  'last one',
  'previous swing',
  'prior swing',
  'before',
  'progress',
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasKeyword(message, keyword) {
  if (!keyword.includes(' ')) {
    return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(message);
  }
  return message.includes(keyword);
}

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
  {
    type: 'function',
    function: {
      name: 'answer_visual_question',
      description: 'Use a targeted frame re-check on the latest or specified swing only when stored visual observations are insufficient to answer a visual follow-up.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The visual follow-up question to answer.' },
          analysis_id: { type: 'string', description: 'Optional analysis identifier. Defaults to latest analyzed swing.' },
          user_id: { type: 'string', description: 'User identifier (defaults to authenticated user).' },
        },
        required: ['question'],
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

function detectResponseMode(userMessage) {
  const lower = (userMessage || '').toLowerCase();

  if (COMPARISON_KEYWORDS.some((keyword) => hasKeyword(lower, keyword))) {
    return 'swing_comparison';
  }

  if (VISUAL_KEYWORDS.some((keyword) => hasKeyword(lower, keyword))) {
    return 'visual_fact_check';
  }

  if (TECHNICAL_KEYWORDS.some((keyword) => hasKeyword(lower, keyword))) {
    return 'technical_breakdown';
  }

  return 'conversational';
}

function buildResponseModeInstruction(responseMode) {
  if (responseMode === 'swing_comparison') {
    return (
      'Compare the latest uploaded swing against the previous uploaded swing. ' +
      'Use both video contexts when available: coaching summaries, visual observations, metrics, and any supplied frame re-review. ' +
      'Answer whether it improved directly, then name what got better, what regressed or stayed uncertain, and one practical next focus. ' +
      'If only one swing is available, say that clearly and analyze the latest swing instead.'
    );
  }

  return buildChatResponseContractPrompt({ responseMode });
}

function compactText(value, maxLength = 1200) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function summarizeSwingForVideoContext(swing, label) {
  if (!swing) {
    return null;
  }

  const visualObservations = Array.isArray(swing.visualObservations)
    ? swing.visualObservations.slice(0, 8).map((obs) => ({
        phase: obs.phase || null,
        observation: compactText(obs.observation, 350),
        confidence: typeof obs.confidence === 'number' ? obs.confidence : null,
        impact: obs.impact || null,
      }))
    : [];

  return {
    label,
    analysis_id: swing.analysisId || swing.analysis_id || null,
    status: swing.status || null,
    created_at: swing.createdAt || swing.created_at || null,
    captured_at: swing.capturedAt || swing.captured_at || null,
    summary: compactText(swing.summary || swing.aiAnalysis?.coaching_response || swing.aiAnalysis?.response, 1600),
    metrics: swing.metrics || swing.analysisResults?.metrics || null,
    video: {
      duration_seconds: swing.analysisResults?.video_duration || null,
      fps: swing.analysisResults?.fps || null,
      frames_extracted: swing.analysisResults?.frames_extracted || swing.analysisResults?.total_frames || null,
    },
    visual_observations: visualObservations,
    uncertainties: Array.isArray(swing.aiAnalysis?.vision_facts?.uncertainties)
      ? swing.aiAnalysis.vision_facts.uncertainties.slice(0, 5)
      : [],
  };
}

function buildLoadedVideoContext({ swings, responseMode }) {
  const requiredCount = responseMode === 'swing_comparison' ? 2 : 1;
  const selected = Array.isArray(swings) ? swings.slice(0, requiredCount) : [];
  const contexts = selected
    .map((swing, index) => summarizeSwingForVideoContext(swing, index === 0 ? 'latest_uploaded_swing' : 'previous_uploaded_swing'))
    .filter(Boolean);

  return {
    response_mode: responseMode,
    latest_video_available: contexts.length >= 1,
    comparison_video_available: contexts.length >= 2,
    loaded_video_context: contexts,
    rules: [
      'The loaded_video_context entries are from this authenticated user’s uploaded swing videos.',
      'If loaded_video_context is present, do not claim you cannot access or reference the uploaded video.',
      'You may say you cannot confirm details that are not visible in the stored frames or observations.',
      'For comparison questions, compare latest_uploaded_swing against previous_uploaded_swing when both are present.',
    ],
  };
}

async function executeToolCall(toolCall, { userId, dynamoClient, logger, visualQuestionTool }) {
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
        const profile = await swingProfileRepository.getProfile({ userId: effectiveUserId, client: dynamoClient });
        if (!profile) {
          return { status: 'not_found', profile: null };
        }
        return { status: 'ok', profile };
      }
      case 'answer_visual_question': {
        if (typeof args.question !== 'string' || !args.question.trim()) {
          return { error: 'question is required' };
        }
        if (typeof visualQuestionTool !== 'function') {
          return { error: 'visual question tool is not configured' };
        }
        return await visualQuestionTool({
          userId: effectiveUserId,
          question: args.question.trim(),
          analysisId: typeof args.analysis_id === 'string' ? args.analysis_id : null,
          dynamoClient,
          logger: safeLog,
        });
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

async function runChatCompletionLoop({ messages, userId, dynamoClient, requestOpenAi, logger, visualQuestionTool }) {
  const safeLog = logger || console;
  let iterations = 0;
  const conversation = [...messages];

  while (iterations < MAX_TOOL_ITERATIONS) {
    const payload = {
      model: CHAT_MODEL,
      messages: conversation,
      tools: TOOL_DEFINITIONS,
      temperature: 0.6,
      max_completion_tokens: 450,
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
          executeToolCall(toolCall, { userId, dynamoClient, logger: safeLog, visualQuestionTool }),
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

async function executeChatLoop({ userId, userMessage, dynamoClient, requestOpenAi, logger, visualQuestionTool, comparisonFrameLoader }) {
  if (!userMessage || !userMessage.trim()) {
    throw new Error('User message is required');
  }

  const safeLog = logger || console;
  const message = userMessage.trim();
  const responseMode = detectResponseMode(message);
  safeLog.info?.('CHAT_LOOP_ROUTING', {
    userId,
    responseMode,
    frameFirstEligible: typeof visualQuestionTool === 'function' &&
      (responseMode === 'visual_fact_check' || responseMode === 'technical_breakdown' || responseMode === 'swing_comparison'),
    messagePreview: message.slice(0, 120),
  });

  const turn = await chatRepository.recordTurn({
    userId,
    role: 'user',
    content: message,
    client: dynamoClient,
  });

  safeLog.debug?.('Recorded user turn', turn);

  // Frame-first follow-up path: re-review frames directly for visual/technical swing questions.
  if (
    typeof visualQuestionTool === 'function' &&
    (responseMode === 'visual_fact_check' || responseMode === 'technical_breakdown' || responseMode === 'swing_comparison')
  ) {
    safeLog.info?.('CHAT_LOOP_FRAME_REREVIEW_ATTEMPT', { userId, responseMode });
    const frameReview = await visualQuestionTool({
      userId,
      question: message,
      analysisId: null,
      responseMode,
      compareCount: responseMode === 'swing_comparison' ? 2 : 1,
      dynamoClient,
      logger: safeLog,
    });

    safeLog.info?.('CHAT_LOOP_FRAME_REREVIEW_RESULT', {
      userId,
      status: frameReview?.status || 'unknown',
      analysisId: frameReview?.analysis_id || null,
      framesUsed: Array.isArray(frameReview?.frames_used) ? frameReview.frames_used : [],
      durationMs: frameReview?.duration_ms || null,
    });

    if (frameReview && frameReview.status === 'ok' && typeof frameReview.answer === 'string' && frameReview.answer.trim()) {
      const reply = frameReview.answer.trim();
      await chatRepository.recordTurn({
        userId,
        role: 'assistant',
        content: reply,
        metadata: {
          source: 'frame_rereview',
          analysis_id: frameReview.analysis_id || null,
          frames_used: frameReview.frames_used || [],
          duration_ms: frameReview.duration_ms || null,
        },
        client: dynamoClient,
      });
      return {
        reply,
        rawResponse: {
          source: 'frame_rereview',
          frameReview,
        },
      };
    }

    safeLog.warn?.('Frame-first follow-up path unavailable, falling back to standard chat loop', frameReview?.status || 'unknown');
  }

  const recentTurns = await chatRepository.getRecentTurns({ userId, client: dynamoClient });

  // Widen the history fetch only when the message actually reaches into the
  // past — a comparison, or a claim about what was previously advised.
  // detectComparativeIntent returns an object even when it finds nothing, so
  // read the flag — truthiness of the object itself is always true.
  const comparativeIntent = SWING_MEMORY_ENABLED
    ? swingMemory.detectComparativeIntent(message)
    : null;
  const reachesIntoPast = SWING_MEMORY_ENABLED
    && (comparativeIntent?.comparative === true || !!detectAssertion(message));
  const swingLimit = reachesIntoPast
    ? HISTORY_SWINGS_WIDE
    : (responseMode === 'swing_comparison' ? 3 : 2);

  const swings = await swingRepository.getLastAnalyzedSwings({
    userId,
    limit: swingLimit,
    client: dynamoClient,
  });
  const swingProfileRecord = await swingProfileRepository.getProfile({ userId, client: dynamoClient });
  const swingProfile = swingProfileRecord
    ? Object.fromEntries(Object.entries(swingProfileRecord).filter(([key]) => key !== 'user_id'))
    : null;

  let developerContext;
  let comparisonPlan = null;
  if (SWING_MEMORY_ENABLED) {
    try {
      const memory = swingMemory.buildSwingMemory({
        question: message,
        currentSwing: swings[0] || null,
        swings,
        chatTurns: recentTurns,
        swingProfile,
      });
      developerContext = memory.context;
      comparisonPlan = memory.comparisonPlan;
      safeLog.info?.('SWING_MEMORY', {
        userId,
        swingsFetched: swings.length,
        reachesIntoPast,
        guard: memory.verification ? memory.verification.found : null,
        comparisonPlanned: !!(comparisonPlan && comparisonPlan.needed),
      });
    } catch (error) {
      // Memory assembly must never take down chat; fall back to the prior context.
      safeLog.error?.('SWING_MEMORY_ERROR', error?.message || error);
      developerContext = null;
    }
  }
  if (!developerContext) {
    developerContext = buildDeveloperContext({
      swings,
      swingProfile,
      includeSummaries: true,
      includeVisualObservations: true,
    });
  }
  const loadedVideoContext = buildLoadedVideoContext({ swings, responseMode });
  const responseModeInstruction = buildResponseModeInstruction(responseMode);

  const baseMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `Developer context: ${developerContext}` },
    { role: 'system', content: `Loaded video context: ${JSON.stringify(loadedVideoContext)}` },
    { role: 'system', content: `Response mode: ${responseMode}. ${responseModeInstruction}` },
    ...toAssistantMessages(recentTurns),
  ];

  // Visual comparison: when the memory layer planned a then-vs-now comparison,
  // attach the actual frames. The direction of change must come from the model
  // looking at these images — never from a stored score.
  if (comparisonPlan && comparisonPlan.needed && typeof comparisonFrameLoader === 'function') {
    try {
      const groups = await comparisonFrameLoader(comparisonPlan);
      const parts = [];
      for (const group of (groups || [])) {
        if (!group?.images?.length) continue;
        parts.push({ type: 'text', text: `--- ${group.label}${group.date ? ` (${group.date})` : ''} ---` });
        for (const image of group.images) {
          parts.push({ type: 'image_url', image_url: { url: image } });
        }
      }
      if (parts.length) {
        baseMessages.push({
          role: 'system',
          content: 'Frames from an earlier swing and the current swing are attached for comparison. '
            + 'Judge any change ONLY from what you can see in these images. If the views are not '
            + 'comparable or the needed moment is missing, say so and state what to capture instead.',
        });
        baseMessages.push({ role: 'user', content: parts });
        safeLog.info?.('SWING_MEMORY_COMPARISON_ATTACHED', {
          userId,
          groups: groups.length,
          images: parts.filter((p) => p.type === 'image_url').length,
        });
      }
    } catch (error) {
      // A failed comparison must degrade to a text answer, not a failed turn.
      safeLog.warn?.('SWING_MEMORY_COMPARISON_FAILED', error?.message || error);
    }
  }

  const result = await runChatCompletionLoop({
    messages: baseMessages,
    userId,
    dynamoClient,
    requestOpenAi,
    logger: safeLog,
    visualQuestionTool,
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
  __private: {
    detectResponseMode,
    buildResponseModeInstruction,
    buildLoadedVideoContext,
    summarizeSwingForVideoContext,
  },
};
