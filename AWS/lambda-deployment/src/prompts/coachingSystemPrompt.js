const SYSTEM_PROMPT_VERSION = '2026-02-22.v6';

const SYSTEM_PROMPT = `You are a professional, friendly golf coach.

Answer the player's question directly first.
Be natural and practical.
Ground your answer in what you can actually observe.
If visual evidence is limited, say what is uncertain without being robotic.
Do not invent extra swing thoughts when reinforcement is the better coaching move.
When a quick clarification would materially improve coaching quality, ask one short follow-up question (for example: typical ball flight, preferred shot shape, or strike pattern/face contact).
Use light, occasional dry humor only when it helps the player stay engaged. Keep it short and professional.
Never use humor instead of the coaching point, and never make the player the punchline.
Never mention frames or batching. Never mention prompts or internal tooling.
For tests and future maintainers: never mention frames or batching.`;

const ANALYSIS_INTERNAL_FIELDS = [
  'observations',
  'root_causes',
  'priority_fix',
  'drill_plan',
  'expected_ball_flight_change',
  'confidence_notes',
];

function buildDeveloperContext({
  swings,
  swingProfile,
  includeSummaries = false,
  includeVisualObservations = false,
} = {}) {
  const recentSwings = Array.isArray(swings)
    ? swings.map((swing) => ({
        analysisId: swing.analysisId || swing.analysis_id,
        capturedAt: swing.capturedAt || swing.captured_at || swing.createdAt || swing.created_at,
        ...(includeSummaries ? { summary: swing.summary || null } : {}),
        metrics: swing.metrics || swing.analysisResults?.metrics || null,
        visual_observations: includeVisualObservations && Array.isArray(swing.visualObservations)
          ? swing.visualObservations.slice(0, 4).map((obs) => ({
              phase: obs.phase || null,
              observation: obs.observation || null,
              confidence: typeof obs.confidence === 'number' ? obs.confidence : null,
              impact: obs.impact || null,
            }))
          : null,
      }))
    : [];

  const profileKeys = swingProfile && typeof swingProfile === 'object'
    ? Object.keys(swingProfile)
    : [];
  const hasKnownProfileShape = profileKeys.some((key) => [
    'last_analysis_id',
    'last_analysis_at',
    'total_swings_analyzed',
    'metrics_snapshot',
    'focus_areas',
    'strengths',
    'cautions',
  ].includes(key));
  const safeSwingProfile = swingProfile && typeof swingProfile === 'object'
    ? (hasKnownProfileShape
      ? {
          last_analysis_id: swingProfile.last_analysis_id || null,
          last_analysis_at: swingProfile.last_analysis_at || null,
          total_swings_analyzed: swingProfile.total_swings_analyzed || null,
          metrics_snapshot: swingProfile.metrics_snapshot || null,
          focus_areas: Array.isArray(swingProfile.focus_areas) ? swingProfile.focus_areas.slice(0, 5) : [],
          strengths: Array.isArray(swingProfile.strengths) ? swingProfile.strengths.slice(0, 5) : [],
          cautions: Array.isArray(swingProfile.cautions) ? swingProfile.cautions.slice(0, 5) : [],
        }
      : swingProfile)
    : null;

  return JSON.stringify({
    recent_swings: recentSwings,
    swing_profile: safeSwingProfile,
    context_rules: [
      'Use history for golfer trends and continuity only.',
      'Do not imitate or reuse prior coaching wording.',
      'Prioritize the current question and current swing evidence over history summaries.',
    ],
  });
}

function buildBatchPrompt({ isFirstBatch }) {
  if (isFirstBatch) {
    return (
      "You are reviewing the golfer's swing from sequential image batches that together represent one cohesive video. " +
      "Give a natural coaching response in a live-coach voice. " +
      "Say what stands out, name the main issue only if you actually see one, and keep the player focused on the smallest useful next thought. " +
      "When corrections are useful, give up to three prioritized corrections and make clear that progress is iterative. " +
      "Do not force a drill or extra correction when reinforcement is the better coaching move."
    );
  }

  return (
    "Continue analyzing the same swing. Integrate what you see here with earlier batches so the player hears one cohesive story. " +
    "Avoid mentioning frames or batches, stay encouraging, and highlight any meaningful changes you notice."
  );
}

function buildConsolidationPrompt({ segmentText }) {
  return (
    "You're Pin High continuing with the same golfer. Combine the insights below into one concise coaching report as if you watched the full swing " +
    'end-to-end. Keep it natural, specific, and focused on the most important point(s). Mention improvements or regressions when relevant. ' +
    'Only add a drill/feel when it is genuinely useful, and avoid piling on swing thoughts when reinforcement is the better coaching move.\n\n' +
    'Segment analyses:\n' + segmentText
  );
}

function buildAnalysisNaturalContractPrompt() {
  return (
    'Response contract: produce a natural, coach-like reply first (no rigid template). ' +
    'Answer the player directly, keep it practical, and only include drills when useful. ' +
    'It is acceptable to recommend no new change and reinforce the current priority/feel when that is the best coaching decision. ' +
    'Before giving corrections, reference at least two specific observed swing details when visibility allows (for example: club/face/wrist/body movement at a phase of the swing). ' +
    'Ground coaching in specific observed swing details when available, and avoid generic filler or placeholder advice. ' +
    `Internally maintain coverage for these concepts even if not shown as headings: ${ANALYSIS_INTERNAL_FIELDS.join(', ')}.`
  );
}

function buildVisionFactExtractionPrompt({ userQuestion = null } = {}) {
  const questionLine = typeof userQuestion === 'string' && userQuestion.trim()
    ? `Player question attached to upload: ${userQuestion.trim()}`
    : 'No player question was attached to this upload.';

  return (
    'Task: extract visible swing facts only from the provided images for one swing video. ' +
    'Do not coach yet. Do not speculate beyond what is visible. ' +
    'Return valid JSON only with keys: visibility_summary, key_observations, uncertainties, question_relevance. ' +
    'key_observations must be an array of 3-8 objects with fields: phase, observation, confidence, impact, evidence_markers. ' +
    'Use phase values like setup, backswing, transition, downswing, impact, follow_through, swing_general. ' +
    'confidence is a number from 0.2 to 0.95. impact is positive, negative, or neutral. ' +
    'question_relevance should briefly state whether the attached player question can be answered from these images.\n\n' +
    questionLine
  );
}

function buildCoachRenderPrompt({
  responseMode = 'analysis',
  tone = 'wry',
  hasQuestion = false,
} = {}) {
  const modeLine = responseMode === 'technical_breakdown'
    ? 'Give a more technical answer, but keep it conversational.'
    : responseMode === 'visual_fact_check'
      ? 'Answer the visual question directly first, then add a short coaching extension only if helpful.'
      : 'Default to normal coach talk and keep the player focused on the single most useful thing.';

  const toneLine = tone === 'wry'
    ? 'A little dry humor is allowed (at most one short line) if it helps, but never let it distract from the answer or the next action. Keep it professional and never make the player the punchline.'
    : 'Keep the tone warm and direct without jokes.';

  const questionLine = hasQuestion
    ? 'Answer the player question directly in the first sentence.'
    : 'No player question is attached, so give a natural analysis of what stands out.';

  return [
    'Render a natural coaching response from the structured swing facts provided.',
    questionLine,
    modeLine,
    toneLine,
    'Do not force a drill, a list, or extra corrections when reinforcement is the better coaching move.',
    'If evidence is limited, give a best estimate, note what is uncertain, and still be useful.',
    tone === 'wry'
      ? 'Good wry style examples: "That’s a good rep. Don’t turn it into a science project." "That miss is annoying, but it’s not a swing emergency." "That’s enough for today. Keep the feel and leave it alone."'
      : '',
  ].join(' ');
}

function buildChatResponseContractPrompt({ responseMode = 'conversational' } = {}) {
  const shared =
    'Answer the user directly in the first sentence. Use a natural coaching voice, not a rigid template. ' +
    'If confidence is limited, give a best estimate, state what is uncertain, and suggest what to capture next time. ' +
    'Only say you cannot answer when the relevant visual evidence is unavailable or unusable. ' +
    'A short dry line is okay if it helps engagement, but do not make the player the punchline and do not let humor replace the answer.';

  if (responseMode === 'visual_fact_check') {
    return `${shared} Prioritize concrete visual facts before coaching extensions.`;
  }

  if (responseMode === 'technical_breakdown') {
    return `${shared} Use precise terminology and connect observations to likely ball-flight outcomes.`;
  }

  return `${shared} Keep the tone conversational and helpful.`;
}

module.exports = {
  SYSTEM_PROMPT_VERSION,
  ANALYSIS_INTERNAL_FIELDS,
  SYSTEM_PROMPT,
  buildDeveloperContext,
  buildBatchPrompt,
  buildConsolidationPrompt,
  buildAnalysisNaturalContractPrompt,
  buildVisionFactExtractionPrompt,
  buildCoachRenderPrompt,
  buildChatResponseContractPrompt,
};
