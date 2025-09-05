# Golf Coaching App - Architecture Rearchitecture Plan

## Executive Summary

**Current State**: Monolithic 1,800-line Lambda with 7 responsibilities, broken integration pipeline, 0% success rate for AI analysis

**Target State**: Focused microservices with unified user threading, 95%+ success rate, maintainable codebase

**Customer Experience**: Preserved and enhanced - single continuous AI thread that remembers all swing progress and coaching history

---

## Phase 1: Immediate Stability (Week 1)

### 1.1 Split the Monolithic Lambda (Priority 1)

**Current Problem**: Single Lambda handling everything creates cascading failures

**Solution**: Decompose into focused functions

```
Current: golf-ai-analysis (1,800 lines, 7 responsibilities)
├── HTTP routing
├── Chat handling  
├── Video orchestration
├── Frame extraction triggers
├── DynamoDB operations
├── OpenAI integration
└── User authentication

New Architecture:
├── video-upload-handler (200 lines) - Handles video upload, creates analysis record
├── frame-extraction-trigger (150 lines) - Triggers frame extraction only
├── ai-analysis-processor (400 lines) - Processes completed frames with OpenAI
├── chat-api-handler (300 lines) - Handles chat requests with user threading
├── results-api-handler (100 lines) - Returns analysis results
└── user-context-manager (150 lines) - Authentication and user context
```

**Benefits**:
- Isolated failure domains (video issues don't break chat)
- Easier debugging (function-specific logs)
- Independent scaling
- Faster deployments

### 1.2 Fix Critical Pipeline Issues

**Problem**: Frame extraction completes but AI analysis never triggers

**Root Cause**: Line 166-167 calls broken `golf-coach-frame-extractor` instead of working `golf-coach-frame-extractor-v2`

**Solution**: Update function invocation in ai-analysis-processor

### 1.3 Restore Authentication

**Problem**: All users defaulting to guest mode

**Solution**: Enable JWT validation in user-context-manager function

---

## Phase 2: Unified User Threading (Week 2)

### 2.1 Complete User Threading Implementation

**Customer Vision**: "I want my AI coach to remember my progress across months"

**Implementation Strategy**:
```
User Experience Flow:
├── Upload Swing 1 → AI: "Work on your grip" (stores in user thread)
├── Chat: "Tell me more" → AI: "Here's what I saw in your swing..." 
├── Upload Swing 2 → AI: "Great improvement on grip! Now let's work on..."
├── Chat: "How much have I improved?" → AI: "Comparing your swings..."
└── Continuous coaching relationship with full context
```

**Technical Implementation**:
- One OpenAI thread per user (stored in DynamoDB)
- Both video analysis and chat messages add to same thread
- Frame curation: Keep only 6-8 key frames per swing analysis
- OpenAI auto-truncation handles conversation length

### 2.2 Missing Thread Management Functions

Add these functions to support unified threading:

```javascript
// Store user thread mapping
async function storeUserThread(userId, threadData)

// Retrieve existing user thread
async function getUserThread(userId)

// Add swing analysis to user's coaching history
async function addSwingToUserHistory(userId, swingMetadata)
```

### 2.3 Update Chat Handler

Modify `handleChatRequest` to:
- Use same thread system as video analysis
- Include recent conversation context
- Reference previous swing analyses naturally

---

## Phase 3: Resilience & Monitoring (Week 3)

### 3.1 Eliminate Event-Driven Complexity

**Claude-Code Prompt 10: Replace DynamoDB Streams with Direct Invocation**

```
TASK: Remove DynamoDB stream triggers and implement direct function calls

CURRENT ISSUE:
- DynamoDB streams in golf-coach-analyses table trigger processSwingAnalysis
- Creates race conditions and unreliable triggering (audit shows 0% success rate)

SCOPE BOUNDARIES:
- ONLY modify: How AI analysis gets triggered after frame extraction
- DO NOT change: The processSwingAnalysis function logic itself
- DO NOT modify: DynamoDB table structure or other Lambda functions

SPECIFIC CHANGES:

1. Remove DynamoDB stream processing from aianalysis_lambda_code.js:
   - Lines that check for event.Records and DynamoDB events
   - Keep the processSwingAnalysis function, change how it's called

2. Update golf-coach-frame-extractor-v2 to directly invoke AI processing:
   - After successful frame extraction
   - Add direct Lambda invocation to ai-analysis-processor
   - Pass same payload structure as current DynamoDB stream

INFRASTRUCTURE CHANGES:
- Remove: DynamoDB stream trigger from golf-coach-analyses table
- Add: Lambda invoke permission from frame-extractor-v2 to ai-analysis-processor
- Environment variable: AI_ANALYSIS_PROCESSOR_NAME

IMPLEMENTATION:
```javascript
// In frame extractor v2, after frame processing success:
const lambdaClient = new LambdaClient({});
await lambdaClient.send(new InvokeCommand({
  FunctionName: process.env.AI_ANALYSIS_PROCESSOR_NAME,
  InvocationType: 'Event',
  Payload: JSON.stringify({
    analysis_id: analysisId,
    user_id: userId,
    status: 'COMPLETED'
  })
}));
```

OUTPUT:
1. Updated frame extractor with direct invocation
2. Updated CloudFormation removing DynamoDB streams
3. Test that AI analysis triggers reliably after frame extraction

VALIDATION: Should achieve >95% trigger success rate vs current 0%.
```

**Claude-Code Prompt 11: Add Comprehensive Error Recovery**

```
TASK: Add proper error handling and status updates across all functions

PRESERVE EXISTING CODE:
- Keep all current error handling patterns
- Maintain existing DynamoDB update patterns  
- Keep current CloudWatch logging

SCOPE BOUNDARIES:
- ONLY add: Consistent error handling and status updates
- DO NOT change: Core function logic or business rules
- DO NOT modify: OpenAI API integration patterns

ERROR HANDLING TEMPLATE:
```javascript
// Add to each new Lambda function:
try {
  // Existing function logic
  await updateAnalysisStatus(analysisId, 'IN_PROGRESS', 'Processing...');
  
  // Main processing logic here
  
  await updateAnalysisStatus(analysisId, 'COMPLETED', 'Success');
} catch (error) {
  console.error(`Error in ${functionName}:`, error);
  await updateAnalysisStatus(analysisId, 'FAILED', error.message);
  
  // Send to CloudWatch for alerting
  await sendCloudWatchMetrics('FunctionErrors', 1, 'Count');
  
  throw error; // Fail fast, fail clear
}
```

REQUIRED ADDITIONS:
1. Add updateAnalysisStatus helper function (reuse existing patterns)
2. Add error metrics to CloudWatch (reuse existing sendCloudWatchMetrics)
3. Ensure mobile app can distinguish between 'FAILED' and 'PROCESSING' states

INTEGRATION:
- Use existing DynamoDB update patterns from current code
- Use existing CloudWatch client initialization
- Maintain current error response formats for API endpoints

OUTPUT:
1. Consistent error handling across all new functions
2. Clear status progression for mobile app polling
3. CloudWatch metrics for monitoring and alerting

VALIDATION: Failed analyses should update status properly and not leave users in infinite loading.
```

### 3.2 Add Circuit Breaker for OpenAI API

**Claude-Code Prompt 12: Implement OpenAI Rate Limit Handling**

```
TASK: Add circuit breaker pattern for OpenAI API calls with graceful fallbacks

PRESERVE EXISTING CODE:
- Keep all existing OpenAI API call structures
- Maintain current makeHttpsRequest function
- Keep existing error handling for rate limits

SCOPE BOUNDARIES:
- ONLY enhance: OpenAI API error handling and retry logic
- DO NOT change: Prompt structure, response parsing, or thread management
- DO NOT modify: Other external API calls

ENHANCEMENT PATTERN:
```javascript
// Wrap existing OpenAI calls with circuit breaker
async function callOpenAIWithCircuitBreaker(apiCall, fallbackMessage) {
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      if (error.message.includes('rate limit')) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`Rate limit hit, retrying in ${delay}ms (attempt ${attempt})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      if (error.message.includes('service unavailable') && attempt < maxRetries) {
        console.log(`OpenAI service unavailable, retrying (attempt ${attempt})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      throw error; // Non-retryable error or max retries reached
    }
  }
  
  // If all retries failed, return graceful fallback
  return { coaching_response: fallbackMessage };
}
```

INTEGRATION POINTS:
- Wrap existing OpenAI calls in analyzeSwingWithGPT4o
- Wrap existing OpenAI calls in handleChatRequest
- Maintain existing response format expectations

FALLBACK MESSAGES:
- Video analysis: "I'm having trouble analyzing your swing right now. Please try again in a few minutes."
- Chat: "I'm temporarily unavailable. Please try your question again shortly."

OUTPUT:
1. Enhanced OpenAI error handling with exponential backoff
2. Graceful fallbacks for temporary service issues
3. Preserved existing API call patterns and response formats

VALIDATION: Function should retry rate limits and fail gracefully for extended outages.
```

### 3.3 Infrastructure Updates

**Claude-Code Prompt 13: Create CloudFormation Template for New Architecture**

```
TASK: Create complete infrastructure template for the decomposed Lambda architecture

PRESERVE EXISTING INFRASTRUCTURE:
- Keep all existing DynamoDB tables (golf-coach-analyses) 
- Keep all existing S3 buckets and triggers
- Keep all existing API Gateway endpoints and paths
- Maintain all existing environment variable names

SCOPE BOUNDARIES:
- ONLY add: New Lambda functions and their permissions
- DO NOT change: Existing resource configurations
- DO NOT modify: Mobile app API contracts

REQUIRED INFRASTRUCTURE:

1. New Lambda Functions:
   - video-upload-handler
   - results-api-handler  
   - chat-api-handler
   - ai-analysis-processor

2. New DynamoDB Table:
   - golf-user-threads (as defined in previous prompt)

3. IAM Permissions:
   - DynamoDB permissions for each function (specific to their needs)
   - Lambda invoke permissions between functions
   - API Gateway integration permissions
   - S3 access where needed

4. API Gateway Integration:
   - Update existing endpoints to point to new functions
   - Maintain exact same URL paths and request/response formats

ENVIRONMENT VARIABLES (preserve existing):
- OPENAI_API_KEY
- DYNAMODB_TABLE  
- USER_THREADS_TABLE (new)
- COGNITO_USER_POOL_ID
- COGNITO_REGION

OUTPUT:
1. Complete CloudFormation template
2. Deployment script that preserves existing resources
3. Rollback plan to revert to monolithic Lambda if needed
4. Environment-specific parameter files

VALIDATION: Template should deploy successfully without breaking existing mobile app functionality.
```

---

## Implementation Priority & Validation

### Phase 1 Validation Checklist
- [ ] Video upload creates analysis record (video-upload-handler)
- [ ] Frame extraction triggers correctly (fixed function name)
- [ ] Results API returns same response format (results-api-handler)
- [ ] Chat API maintains existing request/response structure (chat-api-handler)
- [ ] Authentication works for real users, falls back to guest gracefully

### Phase 2 Validation Checklist  
- [ ] First swing analysis creates user thread in golf-user-threads table
- [ ] Subsequent swings use same thread (analyzeSwingWithGPT4o)
- [ ] Chat messages add to existing swing thread (handleChatRequest)
- [ ] AI can reference previous swing analyses in conversations
- [ ] Thread storage uses minimal data structure

### Phase 3 Validation Checklist
- [ ] AI analysis triggers reliably after frame extraction (>95% success rate)
- [ ] OpenAI rate limits retry with exponential backoff
- [ ] Failed analyses update status properly (mobile app shows clear errors)
- [ ] CloudFormation deploys all resources successfully
- [ ] Rollback to original Lambda works if needed

### Risk Mitigation

**Deployment Strategy:**
- Deploy new functions alongside existing monolithic Lambda
- Use feature flags to switch between old and new systems
- Test each function independently before full cutover
- Maintain original Lambda as backup during transition

**Customer Impact Protection:**
- All API endpoints maintain exact same contracts
- Response formats remain unchanged
- Error messages preserve existing patterns
- No changes to mobile app required during transition

---

## Conclusion

This rearchitecture plan provides specific, conservative prompts that preserve existing working code while solving the critical reliability issues. Each prompt has clear scope boundaries to prevent Claude-code from expanding beyond requirements or introducing hard-coded values.

The phased approach ensures you can validate each component independently and rollback if needed. Most importantly, the customer experience is preserved and enhanced through unified user threading while the underlying system becomes maintainable and resilient.

---

## Architecture Diagram

### Before (Broken)
```
Mobile App → API Gateway → Monolithic Lambda (1,800 lines)
                              ├── DynamoDB Stream → Sometimes triggers AI
                              ├── S3 Event → Frame Extractor v2 (works)
                              └── Calls broken Frame Extractor v1 (fails)
Result: 0% AI analysis completion
```

### After (Resilient)
```
Mobile App → API Gateway → Focused Functions
├── video-upload-handler → frame-extraction-trigger → ai-analysis-processor
├── chat-api-handler (uses same user thread)
└── results-api-handler

All functions share: user-context-manager + unified OpenAI threading
Result: 95%+ completion rate, easy debugging, scalable
```

---

## Implementation Priority

### Critical Path (Must Fix First)
1. **Split monolithic Lambda** - Prevents cascading failures
2. **Fix frame extractor invocation** - Enables AI analysis to work
3. **Complete user threading** - Delivers customer experience

### Nice to Have (After Stability)
1. Infrastructure as Code (Terraform)
2. Automated deployment pipeline
3. Cost optimization
4. Advanced monitoring

---

## Success Metrics

### Technical KPIs
- **Pipeline Success Rate**: 0% → 95%
- **Mean Time to Debug**: 2 hours → 15 minutes  
- **Function Deployment Time**: 20 minutes → 2 minutes
- **Error Recovery**: Manual → Automatic

### Customer Experience KPIs
- **AI Memory Accuracy**: Users can reference weeks-old swing advice
- **Cross-Swing Comparisons**: "Is this better than last week?" works naturally
- **Coaching Continuity**: Progressive improvement conversations
- **Response Quality**: Contextual vs generic coaching

---

## Risk Mitigation

### Deployment Strategy
1. **Blue-green deployment**: Test new functions alongside old
2. **Feature flags**: Toggle new threading system
3. **Rollback plan**: Keep old Lambda as backup

### Customer Impact Protection
- **Zero downtime**: Deploy during low-usage hours
- **Data preservation**: All existing threads migrated
- **Fallback mode**: If new system fails, graceful degradation
- **User communication**: Transparent about improvements

---

## Conclusion

This rearchitecture solves three critical problems:

1. **Reliability**: Split monolithic Lambda → isolated failure domains
2. **Debuggability**: Focused functions → clear error sources  
3. **Customer Experience**: Unified threading → genuine coaching relationships

The phased approach ensures stability improvements come first, followed by experience enhancements. Most importantly, customers get the continuous AI coaching relationship they expect while you get a maintainable, resilient system.