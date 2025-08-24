# Sprint 1B: Mobile Context Service with Local Storage Management

**CONTEXT:** You are creating a React Native service to manage coaching conversation context locally on mobile devices. This service will bridge the gap between swing analysis results and ongoing coaching conversations while managing storage efficiently.

**CURRENT MOBILE APP STRUCTURE:**
- React Native with Expo
- Screens: HomeScreen, VideoRecordScreen, CameraScreen, ResultsScreen, ChatScreen
- API calls to: https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod
- No existing conversation state management
- AsyncStorage available for local storage

**IMPLEMENTATION REQUIREMENTS:**

## 1. CREATE CONVERSATION CONTEXT SERVICE:
- File: src/services/conversationContext.js
- Implement ConversationContextService class with static methods
- Handle conversation state assembly, storage, and retrieval
- Manage coaching themes and progress tracking locally

## 2. CORE SERVICE METHODS:

### a) assembleCoachingContext(userId, currentSwingId = null)
- Fetch current swing analysis if swingId provided
- Retrieve recent conversation messages (last 10)
- Get coaching themes and progress data
- Assemble context summary for AI API calls
- Return structured context object under 1,000 tokens

### b) storeConversationMessage(userId, message, swingId = null)
- Store messages with metadata (timestamp, swing reference, context type)
- Implement automatic cleanup (keep only last 15 messages)
- Track conversation themes and patterns
- Handle storage errors gracefully

### c) getCoachingThemes(userId) / updateCoachingThemes(userId, message)
- Extract and maintain coaching focus areas
- Track session count and progress indicators
- Manage coaching relationship metadata
- Implement theme compression for efficiency

## 3. LOCAL STORAGE MANAGEMENT:
- Use AsyncStorage with structured keys: conversation_{userId}, coaching_themes_{userId}
- Implement storage size limits (50KB per user maximum)
- Add automatic cleanup of old data
- Handle storage quota exceeded scenarios
- Implement data compression for efficiency

## 4. ERROR HANDLING & RESILIENCE:
- Graceful handling of AsyncStorage failures
- Fallback to in-memory storage when needed
- Data validation and sanitization
- Corrupt data recovery mechanisms
- User-friendly error messaging

## 5. CONTEXT ASSEMBLY OPTIMIZATION:
- Parallel data retrieval operations
- Caching of frequently accessed data
- Smart context prioritization (recent vs historical)
- Token-efficient context summarization
- Performance monitoring (<500ms assembly time)

## 6. API INTEGRATION HELPERS:
- Methods to fetch swing analysis data from API
- Context summarization for API calls
- Response processing and storage
- Network error handling and retries

**TECHNICAL REQUIREMENTS:**
- TypeScript-compatible implementation (use JSDoc if not TS)
- Async/await pattern throughout
- Comprehensive error handling
- Performance optimizations for mobile
- Memory-efficient data structures

**STORAGE SCHEMA:**
```javascript
// AsyncStorage structure
conversation_{userId}: [
  {
    id: "msg_123",
    text: "message content",
    sender: "user|coach",
    timestamp: "ISO_string",
    swing_reference: "swing_id|null",
    context_type: "swing_followup|general_coaching"
  }
]

coaching_themes_{userId}: {
  active_focus_areas: [
    {
      focus: "weight_shift_timing",
      priority: 1,
      sessions_worked: 3,
      progress_level: "developing", // developing|improving|competent|maintenance
      last_assessment: "2025-08-20T10:00:00Z"
    },
    {
      focus: "setup_consistency", 
      priority: 2,
      sessions_worked: 2,
      progress_level: "developing",
      last_assessment: "2025-08-18T14:00:00Z"
    }
  ],
  graduated_areas: ["grip_pressure", "stance_width"],
  session_count: 5,
  last_updated: "ISO_string",
  focus_change_log: [
    {
      date: "2025-08-15",
      action: "graduated",
      area: "grip_pressure",
      reason: "consistent_improvement_across_sessions"
    }
  ]
}
```

**PERFORMANCE TARGETS:**
- Context assembly: <500ms
- Storage operations: <100ms
- Memory usage: <5MB per active conversation
- Storage size: <50KB per user

**FILES TO CREATE:**
- src/services/conversationContext.js

**DELIVERABLES:**
1. Complete ConversationContextService implementation
2. JSDoc documentation for all methods
3. Error handling test scenarios
4. Storage management utilities
5. Performance optimization guidelines

**SUCCESS CRITERIA:**
- Service handles all conversation context operations reliably
- Storage stays within size limits
- Performance meets target benchmarks
- Graceful error handling in all scenarios
- Clean, maintainable code architecture