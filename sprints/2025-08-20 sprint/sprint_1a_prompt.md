# Sprint 1A: Enhanced AI Prompting with Cost & Error Protection

**CONTEXT:** You are updating a golf coaching app's AI analysis system to provide conversational, context-aware coaching responses. The current system in aianalysis_lambda_code.js treats each swing analysis as isolated. We need to add coaching continuity while implementing strict cost and error controls.

**CURRENT SYSTEM OVERVIEW:**
- File: aianalysis_lambda_code.js (AWS Lambda function)
- DynamoDB table: golf-coach-analyses (existing)
- Current AI prompts are clinical and don't reference previous sessions
- No cost controls or sophisticated error handling

**IMPLEMENTATION REQUIREMENTS:**

## 1. COST PROTECTION (CRITICAL):
- Implement hard limit: maximum 1,200 tokens per GPT-4o request
- Add pre-request token calculation and blocking
- Create CloudWatch metrics for token usage monitoring
- Add rate limiting: maximum 10 coaching requests per user per hour
- Implement graceful cost limit messaging for users

## 2. FETCH USER COACHING HISTORY:
- Create fetchUserCoachingHistory(userId, currentAnalysisId) function
- Query last 5 sessions from golf-coach-analyses table
- Extract coaching themes, focus areas, and timeline
- Implement query optimization to avoid full table scans
- Add error handling for DynamoDB failures

## 3. CONTEXT-AWARE PROMPTING WITH FOCUS MANAGEMENT:
- Replace buildGolfCoachingPrompt() with buildContextAwarePrompt()
- Include coaching relationship context (session count, previous focus, timeline)
- **IMPLEMENT COACHING FOCUS DISCIPLINE:**
  * Maximum 3 active coaching focus areas at any time
  * Focus areas can only change when:
    a) Player demonstrates competency in current area (graduation)
    b) New swing fault identified with HIGH confidence as higher priority
  * Resist urge to constantly change coaching direction
  * Maintain focus persistence across sessions
- Make prompts conversational and relationship-building
- Differentiate first-time vs returning user experiences
- Keep total context under 1,000 tokens for cost efficiency

**COACHING FOCUS MANAGEMENT LOGIC:**
```javascript
// Focus area change criteria
const focusChangeRules = {
  GRADUATION: {
    trigger: "Player shows consistent improvement in focus area across 2+ sessions",
    action: "Move to maintenance mode, introduce new focus area"
  },
  HIGH_PRIORITY_OVERRIDE: {
    trigger: "New swing fault with confidence >90% and impact >current focus areas",
    action: "Replace lowest-priority current focus area"
  },
  STAY_COURSE: {
    trigger: "Incremental progress or no clear improvement yet",
    action: "Continue current focus areas, adjust approach/drills"
  }
};
```

**ENHANCED AI PROMPT INSTRUCTIONS:**
```
COACHING PHILOSOPHY (CRITICAL):
- ALWAYS START WITH GENUINE POSITIVES - Find specific things they're doing well
- BE CONVERSATIONAL, WARM, AND ENCOURAGING - Like a supportive coach, not a clinical analyst
- BALANCE PROBLEMS WITH STRENGTHS - "Here's what's working well, here's what we can improve"
- BUILD CONFIDENCE WHILE TEACHING - Make them feel capable of improvement

COACHING FOCUS DISCIPLINE (CRITICAL):
Current focus areas: ${currentFocusAreas}
- ONLY change focus if player has mastered current area OR new issue is definitively higher priority
- Resist the urge to introduce new concepts when current work is still progressing
- Better to deepen current focus with new drills than scatter attention
- If suggesting new focus area, EXPLICITLY explain why it takes priority over current work
- Maximum 3 focus areas total - if adding new one, explain what graduates to maintenance

FEEL-BASED COACHING INTEGRATION:
- Balance technical instruction with swing "feels" that golfers can actually use
- For each technical coaching point, provide a relatable feel or sensation
- Use analogies and imagery that translate to course performance
- Examples:
  * Technical: "Shift weight to front foot in downswing"
  * Feel: "Feel like you're stepping into a throw or pushing off your back foot"
  * Technical: "Maintain spine angle in backswing" 
  * Feel: "Feel like you're reaching into your back pocket with your trail shoulder"
- Feels should be:
  * Actionable during the swing (not complex thoughts)
  * Relatable to common movements (throwing, stepping, turning)
  * Connected to the specific technical improvement needed

Focus Change Decision Tree:
1. Has player mastered current focus? → Graduate and add new focus
2. Is new issue definitely higher priority? → Replace lowest current focus  
3. Otherwise → Continue current focus with refined approach

COACHING RESPONSE STRUCTURE:
1. Acknowledge progress and reference coaching relationship
2. Identify 1-2 key technical observations
3. Provide feels/sensations for each technical point
4. Connect to overall improvement journey
5. Give specific drills that reinforce both technique and feel
```

## 4. ERROR HANDLING & RESILIENCE:
- Comprehensive try-catch blocks around all operations
- Intelligent fallback responses that use available context
- Graceful degradation when coaching history unavailable
- Retry logic for transient failures with exponential backoff
- User-friendly error messages that maintain coaching tone

## 5. ENHANCED RESPONSE PARSING:
- Update parseGPT4oResponse() to handle coaching continuity fields
- Add coaching session metadata (session number, previous focus)
- Implement response validation and sanitization
- Handle malformed GPT-4o responses gracefully

## 6. MONITORING & ALERTING:
- CloudWatch metrics for token usage, request counts, error rates
- Cost threshold alarms ($10/day limit recommended)
- Performance monitoring (target: <3 seconds response time)
- Error rate alerting (>5% error rate triggers alert)

**TECHNICAL CONSTRAINTS:**
- Maintain backward compatibility with existing golf-coach-analyses table
- Use existing DynamoDB permissions (don't create new resources)
- Preserve all existing functionality while adding coaching context
- Implement incremental rollout capability (environment variable feature flag)

**SECURITY REQUIREMENTS:**
- Validate all user inputs (userId, analysisId parameters)
- Sanitize coaching history data before including in prompts
- Log security-relevant events without exposing sensitive data
- Implement basic input validation and sanitization

**FILES TO MODIFY:**
- aianalysis_lambda_code.js (main implementation)

**DELIVERABLES:**
1. Updated Lambda function with coaching context capability
2. CloudWatch dashboard configuration for monitoring
3. Documentation of new environment variables needed
4. Error handling test scenarios and responses
5. Cost protection implementation guide

**SUCCESS CRITERIA:**
- AI responses reference previous sessions when available
- Token usage stays under 1,200 per request
- Response time remains under 3 seconds
- Error rate stays under 5%
- Graceful handling of all failure scenarios