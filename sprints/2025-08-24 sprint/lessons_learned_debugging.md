# Golf Coach AI - Debugging Lessons Learned

**Date:** August 26, 2025  
**Purpose:** Document critical debugging lessons to help future developers identify and resolve common issues  
**Context:** Root cause discovery and fix for structured AI response bug + unified prompt system

---

## 🚨 MAJOR DEBUGGING BREAKTHROUGH (August 26)

### **📍 THE SMOKING GUN DISCOVERY**

**❌ SYMPTOM:** AI responses always came back structured ("1. Setup, 2. Backswing") despite removing all structured prompts  
**🔍 ROOT CAUSE:** Source code vs deployed code mismatch - we were editing one file but a different file was actually running on AWS  
**⚡ LESSON:** Always verify which code is actually deployed, not just which code you're editing

**Critical Files Mismatch:**
```bash
# What we were editing:
AWS/aianalysis_lambda_code.js ← Source file ✅

# What was actually deployed and running:  
AWS/lambda-deployment/aianalysis_lambda_code.js ← Deployed file ❌
```

**The deployed file contained OLD structured prompts:**
```javascript
// DEPLOYED VERSION - CAUSING STRUCTURED RESPONSES:
const prompt = `Format your response as JSON with the following structure:
{
  "coaching_response": "Detailed coaching feedback",
  "symptoms_detected": [...],
  "root_cause": "Main issue", 
  "confidence_score": 85,
  "practice_recommendations": [...]
}`;
```

**🔧 PREVENTION:**
- Always check which files are in deployment folders vs source folders
- Use git to track deployment artifacts separately from source code  
- Add deployment verification: log a unique identifier from source to confirm deployment
- Consider CI/CD to eliminate manual file copying

---

### **📍 UNIFIED SYSTEM ANTI-PATTERN**

**❌ SYMPTOM:** 5 different prompt-building functions across codebase with duplicate logic  
**🔍 ROOT CAUSE:** Feature development without consolidation - each fix added another function instead of refactoring  
**⚡ LESSON:** When you see duplicate code patterns, stop and consolidate before adding more

**Duplicative Functions Found:**
```javascript
buildPromptForChat()
buildPromptForVideo()  
buildContextualPrompt()
buildCoachingPrompt()
buildSystemPrompt()
// All doing similar things with slight variations
```

**🔧 PREVENTION:**
- Refactor duplicates immediately when you see them
- Use single source of truth for all prompt logic
- Write functions that accept options rather than creating new functions

---

### **📍 DUMMY DATA ASSUMPTIONS**

**❌ SYMPTOM:** Code making assumptions about user types and providing fallback dummy data  
**🔍 ROOT CAUSE:** Developer assumptions instead of letting AI handle context intelligently  
**⚡ LESSON:** Let AI be smart with raw context - don't force structure or make assumptions

**Example Issues Found:**
```javascript
// BAD - Making assumptions:
conversationHistory = []  // What if there IS conversation history?
hasSwingData: false       // What if user DOES have swing data?
if (userId !== 'guest')   // Assumes only guests lack data

// GOOD - Handle reality:
const history = conversationHistory || [];
const context = await getActualUserContext(userId);
// Pass raw context to AI, let it decide relevance
```

**🔧 PREVENTION:**
- Query for actual data instead of assuming
- Remove all hardcoded default values that could override real data
- Let AI handle context intelligence rather than pre-processing

---

## 🚨 CRITICAL FAULT LINES IDENTIFIED

### **1. Mock Data vs Real Implementation**

**❌ SYMPTOM:** Video analysis worked but returned placeholder/generic responses  
**🔍 ROOT CAUSE:** Lambda was using simulation code instead of calling real Docker Lambda  
**⚡ LESSON:** Always verify data flows are using real integrations, not fallbacks

**Example Code Issue:**
```javascript
// BAD - Found in production:
const simulatedResults = {
  frame_urls: mockFrameUrls,
  analysis_complete: true
};

// GOOD - After fix:
const frameExtractionResult = await lambda.invoke({
  FunctionName: 'golf-coach-frame-extractor-v2',
  Payload: JSON.stringify(extractionPayload)
}).promise();
```

**🔧 PREVENTION:**
- Add explicit logging: `console.log('USING REAL LAMBDA CALL - NOT SIMULATION')`
- Never commit simulation code to main branches
- Add integration tests that verify real API calls

---

### **2. React useEffect Dependency Cycles**

**❌ SYMPTOM:** Infinite duplicate key errors, app "wigging out", thousands of error messages  
**🔍 ROOT CAUSE:** useEffect dependent on state it modifies creates infinite re-render loops  
**⚡ LESSON:** Extremely careful with useEffect dependencies - they can create cascading failures

**Example Code Issue:**
```javascript
// BAD - Creates infinite loop:
const [isInitialized, setIsInitialized] = useState(false);

useEffect(() => {
  if (!isInitialized) {
    initializePrimaryChat();
    setIsInitialized(true); // ← Triggers useEffect again!
  }
}, [isInitialized]); // ← Depends on state it modifies

// GOOD - After fix:
useEffect(() => {
  if (!isInitialized) {
    initializePrimaryChat();
  }
}, [userId, isAuthenticated]); // ← Remove isInitialized dependency
```

**🔧 PREVENTION:**
- Never include state in useEffect dependencies if the effect modifies that state
- Use React Developer Tools to monitor re-renders
- Add guards: `if (isProcessing) return;` to prevent multiple simultaneous runs

---

### **3. Message Processing State Pollution**

**❌ SYMPTOM:** Duplicate messages, processing messages appearing in chat history  
**🔍 ROOT CAUSE:** Temporary UI state being saved to persistent storage  
**⚡ LESSON:** Distinguish between UI state and persistent data - they have different lifecycles

**Example Code Issue:**
```javascript
// BAD - Saving temporary processing messages:
const processingMessage = {
  id: `processing_${Date.now()}`,
  messageType: 'processing',
  text: 'Analyzing swing...'
};
setMessages(prev => [...prev, processingMessage]);
await ChatHistoryManager.saveMessage(userId, processingMessage); // ← Don't save UI state!

// GOOD - After fix:
const [isProcessingVideo, setIsProcessingVideo] = useState(false);
const [processingMessage, setProcessingMessage] = useState('');
// Use separate state for UI indicators, don't save to history
```

**🔧 PREVENTION:**
- Separate concerns: UI state vs persistent data
- Use naming conventions: `ui_` prefix for temporary state
- Filter temporary data before saving: `messageType !== 'processing'`

---

### **4. Lambda Request Format Mismatches**

**❌ SYMPTOM:** API Error 500: "Failed to retrieve analysis. Please try back in a few minutes"  
**🔍 ROOT CAUSE:** Mobile app sending wrong request format; Lambda expecting different fields  
**⚡ LESSON:** API contracts must be explicitly defined and validated

**Example Code Issue:**
```javascript
// Mobile app sending:
{
  message: "text",
  userId: "guest", 
  messageType: "general_coaching", // ← Lambda doesn't expect this
  conversationHistory: [...]
}

// Lambda expecting:
const { message, context, jobId, conversationHistory } = body;
//                ↑        ↑ 
//             Missing required fields
```

**🔧 PREVENTION:**
- Document API contracts explicitly in code comments
- Add request validation at Lambda entry points
- Use TypeScript interfaces for request/response schemas
- Test with exact production request formats

---

### **5. Null/Empty Data Crashes**

**❌ SYMPTOM:** Lambda crashing silently, 500 errors with no clear cause  
**🔍 ROOT CAUSE:** Conversation history containing `null` content values crashes processing  
**⚡ LESSON:** Always validate and sanitize user data before processing

**Example Code Issue:**
```javascript
// BAD - Crashes Lambda:
conversationHistory: [
  {"role": "user", "content": "Hello"},
  {"role": "user", "content": null}, // ← Crashes when processed
  {"role": "user", "content": ""}    // ← Also problematic
]

// GOOD - After fix:
.filter(msg => msg.text && msg.text.trim()) // Filter out null/empty
.map(msg => ({
  role: 'user',
  content: msg.text.trim()
}))
```

**🔧 PREVENTION:**
- Always filter null/undefined/empty values before API calls
- Add data validation at service boundaries
- Use optional chaining: `msg?.text?.trim()`
- Log data shapes before processing: `console.log('Data structure:', typeof data, Object.keys(data))`

---

### **6. Rate Limiting Masquerading as Connection Issues**

**❌ SYMPTOM:** "I'm having trouble connecting right now. Please try again in a few minutes"  
**🔍 ROOT CAUSE:** Rate limiting (10 requests/hour) returning 429, but error handling made it look like connection failure  
**⚡ LESSON:** Rate limit errors can be confusing - always check for 429 status codes specifically

**Example Code Issue:**
```javascript
// BAD - Generic error handling hides rate limits:
} catch (error) {
  return this.getFallbackResponse(message, error);
  // ↑ All errors look the same to users
}

// GOOD - Specific handling:
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  return `Rate limit exceeded. Try again at ${new Date(retryAfter)}`;
}
```

**🔧 PREVENTION:**
- Handle rate limiting (429) explicitly with clear user messages
- Include retry time information from response headers
- Consider implementing client-side backoff strategies
- Log specific HTTP status codes, not just "error occurred"

---

## 🏗️ INFRASTRUCTURE RELIABILITY IMPROVEMENTS

### **1. Lambda-to-Lambda Communication**

**Current Issue:** Lambda functions calling each other without proper IAM permissions  
**Improvement:** Explicit IAM policies for Lambda invocation

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["lambda:InvokeFunction"],
      "Resource": ["arn:aws:lambda:us-east-1:*:function:golf-coach-*"]
    }
  ]
}
```

**Recommendation:** Create service-specific IAM roles instead of broad permissions

### **2. DynamoDB Stream Reliability**

**Current Issue:** Streams can appear "enabled" but not trigger Lambda functions  
**Improvement:** Add explicit stream monitoring and alerting

```javascript
// Add to Lambda functions:
console.log(`DynamoDB stream event received: ${JSON.stringify(event.Records.length)} records`);

// Monitor stream metrics:
- StreamRecords processed per hour
- Lambda invocation count correlation  
- Failed record processing alerts
```

### **3. Error Propagation & Observability**

**Current Issue:** Generic error messages hide root causes  
**Improvement:** Structured error logging with correlation IDs

```javascript
const correlationId = `golf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

console.log(`[${correlationId}] Processing video analysis for user: ${userId}`);
console.error(`[${correlationId}] Frame extraction failed:`, error);

// Return correlation ID to client for support debugging
return {
  error: "Processing failed",
  correlationId: correlationId,
  userMessage: "Please contact support with reference ID: " + correlationId
};
```

---

## 🔧 CODE RELIABILITY PATTERNS

### **1. Defensive Data Processing**

```javascript
// Always validate data shapes before processing:
function processConversationHistory(messages) {
  if (!Array.isArray(messages)) {
    console.warn('Expected array, got:', typeof messages);
    return [];
  }
  
  return messages
    .filter(msg => msg && typeof msg === 'object')
    .filter(msg => msg.text && typeof msg.text === 'string')
    .filter(msg => msg.text.trim().length > 0)
    .map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text.trim()
    }));
}
```

### **2. State Management Guards**

```javascript
// Prevent multiple simultaneous operations:
const [isProcessing, setIsProcessing] = useState(false);

const processVideo = async () => {
  if (isProcessing) {
    console.warn('Video processing already in progress');
    return;
  }
  
  setIsProcessing(true);
  try {
    // ... processing logic
  } finally {
    setIsProcessing(false); // Always reset, even on error
  }
};
```

### **3. API Request Resilience**

```javascript
// Include timeout and retry logic:
const fetchWithRetry = async (url, options, retries = 3) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok && retries > 0) {
      console.warn(`Request failed, ${retries} retries remaining`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return fetchWithRetry(url, options, retries - 1);
    }
    
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout after 15 seconds');
    }
    throw error;
  }
};
```

---

## 📊 DEBUGGING METHODOLOGY LESSONS

### **1. Systematic Error Isolation**

**What Worked:**
1. **Test smallest possible case first** - Simple API calls before complex workflows
2. **Binary search debugging** - Disable half the code to isolate issues
3. **Data shape logging** - Always log data structures before processing
4. **External validation** - Test APIs with curl before debugging app code

**Example Process:**
```
Issue: Chat API failing
Step 1: Test simplest possible request with curl ✅ Works
Step 2: Test with minimal mobile app data ✅ Works  
Step 3: Test with actual mobile app data ❌ Fails
Step 4: Binary search - remove half the fields
Step 5: Found conversationHistory with null content was the issue
```

### **2. Error Message Interpretation**

**Generic errors often mask specific causes:**
- "Failed to retrieve analysis" → Could be rate limiting, null data, or missing fields
- "Connection timeout" → Could be rate limiting, server overload, or infinite processing
- "Duplicate key error" → Could be infinite loops, state pollution, or ID collisions

**Better error handling:**
```javascript
try {
  // risky operation
} catch (error) {
  console.error('Specific context:', {
    operation: 'video_analysis',
    userId: userId,
    dataShape: typeof data,
    timestamp: new Date().toISOString(),
    errorType: error.constructor.name,
    errorMessage: error.message,
    stackTrace: error.stack
  });
  
  throw new Error(`Video analysis failed for user ${userId}: ${error.message}`);
}
```

### **3. State vs Side Effects**

**Key insight:** Many bugs came from confusing UI state with persistent data
- Processing messages should be UI state, not saved messages
- Conversation history should be fetched from backend, not maintained on frontend
- Temporary flags (isLoading, isProcessing) should never be persisted

---

## 🎯 FUTURE RELIABILITY RECOMMENDATIONS

### **1. Add Comprehensive Logging**

```javascript
// Create centralized logging utility:
const Logger = {
  info: (context, message, data) => {
    console.log(`[${context}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  
  error: (context, error, additionalData) => {
    console.error(`[${context}] ERROR:`, error.message);
    console.error(`[${context}] Stack:`, error.stack);
    if (additionalData) {
      console.error(`[${context}] Additional:`, JSON.stringify(additionalData, null, 2));
    }
  }
};

// Usage:
Logger.info('VIDEO_UPLOAD', 'Starting video processing', { userId, videoSize, duration });
Logger.error('CHAT_API', error, { requestPayload, responseStatus });
```

### **2. Implement Health Checks**

```javascript
// Add endpoint health monitoring:
const HealthChecker = {
  async checkVideoAPI() {
    try {
      const response = await fetch('/api/video/health');
      return response.ok;
    } catch {
      return false;
    }
  },
  
  async checkChatAPI() {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'health-check', userId: 'system' })
      });
      return response.ok;
    } catch {
      return false;
    }
  }
};
```

### **3. Add Data Validation Schemas**

```javascript
// Use schema validation for API boundaries:
const ChatRequestSchema = {
  message: { type: 'string', required: true, minLength: 1 },
  userId: { type: 'string', required: true },
  conversationHistory: { 
    type: 'array', 
    required: false,
    items: {
      role: { type: 'string', enum: ['user', 'assistant'] },
      content: { type: 'string', required: true, minLength: 1 }
    }
  }
};

function validateChatRequest(data) {
  // Validation logic
  return { valid: boolean, errors: string[] };
}
```

### **4. Implement Circuit Breaker Pattern**

```javascript
// Prevent cascading failures:
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureCount = 0;
    this.threshold = threshold;
    this.timeout = timeout;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.nextAttempt = Date.now();
  }
  
  async call(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
    }
  }
}
```

---

## 📋 DEBUGGING CHECKLIST FOR FUTURE ISSUES

### **When AI Responses Don't Match Expected Behavior:**
- [ ] **CRITICAL: Verify deployed code matches source code** - Check deployment folder vs source files
- [ ] Look for duplicate prompt functions and consolidate them
- [ ] Remove all structured formatting requirements (JSON, numbered lists) 
- [ ] Check if code makes assumptions about user data instead of querying actual data
- [ ] Verify AI gets raw context, not pre-processed assumptions
- [ ] Test with actual user data, not placeholder/dummy values

### **When Chat API Fails:**
- [ ] Check specific HTTP status code (not just "error")
- [ ] Test with curl using exact same request format
- [ ] Verify no null/empty values in conversationHistory
- [ ] Check rate limiting (429 status)
- [ ] Validate all required fields are present
- [ ] Ensure conversation history contains only user messages (no assistant messages)

### **When Video Processing Fails:**
- [ ] Verify Lambda is calling real services (not simulations)
- [ ] Check IAM permissions for Lambda-to-Lambda calls
- [ ] Validate DynamoDB stream is actually triggering (not just enabled)
- [ ] Confirm frame extraction URLs are being saved correctly
- [ ] Check for JavaScript variable reference errors

### **When Mobile App "Wigs Out":**
- [ ] Check for infinite useEffect loops (dependencies on modified state)
- [ ] Look for duplicate React keys in console
- [ ] Verify processing state is not being saved to persistent storage
- [ ] Check for multiple simultaneous operations without guards
- [ ] Validate message ID uniqueness

### **General Debugging:**
- [ ] Add correlation IDs to trace requests across services
- [ ] Log data shapes before processing: `console.log(typeof data, Object.keys(data))`
- [ ] Test with minimal data first, then add complexity
- [ ] Use binary search to isolate problematic code sections
- [ ] Always check CloudWatch logs for Lambda errors

---

**Next Developer:** Use this document as a reference when encountering similar symptoms. The patterns identified here will save significant debugging time and prevent repeat issues.