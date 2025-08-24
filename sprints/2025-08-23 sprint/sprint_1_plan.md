# Sprint 1: Navigation Foundation & Core Chat

**Duration:** 3-5 days  
**Goal:** Replace stack navigation with tab navigation and create the primary chat interface

## Sprint 1 Objectives
- Replace stack navigation with bottom tab navigation
- Transform ChatScreen into primary user interface
- Implement chat history limits for performance/cost control
- Create first-time user onboarding experience
- Establish conversation persistence across app sessions

## Technical Requirements
- Install `@react-navigation/bottom-tabs` dependency
- Redesign ChatScreen to handle all video upload workflows
- Implement chat message limit (50 messages max)
- Add conversation state persistence
- Create onboarding detection logic

## Files to Modify
- `AppNavigator.js` (complete redesign)
- `src/screens/ChatScreen.js` (major enhancement)
- `src/utils/theme.js` (tab bar styling)

## Files to Create
- `src/services/chatHistoryManager.js`
- `src/components/ChatHeader.js`
- `src/components/OnboardingMessage.js`

## Implementation Steps

### Step 1A: Install Dependencies & Update Navigation
```bash
# Install bottom tabs navigator
npm install @react-navigation/bottom-tabs
npm install react-native-vector-icons
```

### Step 1B: Navigation Architecture
**Claude-Code Prompt:**
```
CONTEXT: You are replacing the current stack-based navigation in a React Native golf coaching app with a clean bottom tab navigation. The current AppNavigator.js uses stack navigation between multiple screens, but we want to simplify to 4 main tabs: Chat (primary), Summary, Videos, Profile.

CURRENT NAVIGATION STRUCTURE:
- File: AppNavigator.js (stack navigator with Home, VideoRecord, Camera, Results, Chat)
- Complex flow: Home → VideoRecord → Camera → Results → Chat
- Users get lost in the navigation complexity

NEW REQUIREMENTS:
1. Bottom tab navigation with 4 tabs
2. Chat tab as default/primary interface
3. Maintain CameraScreen for video recording (modal or separate)
4. Clean, professional golf club theme
5. Icons using Ionicons from expo/vector-icons

TECHNICAL REQUIREMENTS:
- Use createBottomTabNavigator from @react-navigation/bottom-tabs
- Apply existing theme colors from src/utils/theme.js
- Tab icons: Chat (chatbubbles), Summary (stats-chart), Videos (play-circle), Profile (person)
- Professional styling consistent with golf club theme
- Remove all existing stack navigation complexity

FILES TO MODIFY:
- AppNavigator.js (complete rewrite)

DELIVERABLES:
1. Clean bottom tab navigation
2. Proper icon implementation
3. Theme integration
4. Initial routing to Chat tab
5. Remove complex stack navigation flows

SUCCESS CRITERIA:
- App opens to Chat tab by default
- Clean, professional tab bar design
- No navigation complexity from old stack system
- Tabs respond properly to user interaction
```

### Step 1C: Enhanced ChatScreen as Primary Interface
**Claude-Code Prompt:**
```
CONTEXT: You are transforming the ChatScreen to become the primary user interface for the golf coaching app. Currently, ChatScreen is a secondary screen reached after video analysis. Now it needs to be the main hub where users can chat with the AI coach, upload videos, and get all their coaching in one continuous conversation thread.

CURRENT CHATSCREEN STATE:
- File: src/screens/ChatScreen.js
- Basic chat interface for follow-up questions
- Expects analysis data from route.params
- Limited to post-analysis conversations

NEW REQUIREMENTS:
1. PRIMARY INTERFACE: First screen users see, main app interaction
2. VIDEO UPLOAD: Direct video upload capability within chat
3. CONVERSATION PERSISTENCE: Maintain chat history across app sessions
4. PROGRESSIVE ONBOARDING: Experience-first approach without tutorial screens
5. CHAT LIMITS: Implement 50-message limit for performance/cost control
6. HEADER: Custom header with video upload button and title

PROGRESSIVE ONBOARDING REQUIREMENTS:
- No tutorial screens or modal overlays
- Contextual hints that appear during interaction
- Success celebrations for first completions
- Empty state guidance that drives action
- Experience first, explain later approach

ONBOARDING MESSAGE EXAMPLES:
```javascript
const onboardingMessages = {
  firstTime: "Hi! I'm your AI golf coach. Ready to analyze your swing? Tap 📹 above to start!",
  postUpload: "Perfect! Your video is uploaded. I'm analyzing your swing now - this takes about 30 seconds...",
  firstAnalysisComplete: "🎯 Your first swing analysis is complete! Ask me anything about your technique.",
  returningUser: "Welcome back! Ready to analyze another swing or ask about your previous analysis?"
};
```

CHAT FLOW REQUIREMENTS:
- First-time users: Progressive discovery through interaction
- Returning users: Continue previous conversation
- Video upload: Trigger camera or gallery picker from chat
- Analysis responses: Display swing analysis as chat messages
- Conversation management: Auto-cleanup old messages

TECHNICAL IMPLEMENTATION:
- AsyncStorage for conversation persistence
- Video upload integration (camera + gallery)
- Message limit management with automatic cleanup
- Onboarding detection (check if user has previous conversations)
- Integration with existing videoService.js
- Contextual hint system for progressive onboarding

UI COMPONENTS NEEDED:
- Custom header with upload button
- Progressive onboarding message component
- Video upload trigger buttons
- Chat message with video analysis formatting
- Progress indicators for video processing
- Empty state guidance for other tabs

FILES TO MODIFY:
- src/screens/ChatScreen.js (major enhancement)

NEW COMPONENTS TO CREATE:
- src/components/ChatHeader.js
- src/components/ProgressiveOnboardingMessage.js
- src/components/VideoUploadButton.js

DELIVERABLES:
1. Enhanced ChatScreen as primary interface
2. Video upload capability within chat
3. Conversation persistence across sessions
4. Progressive onboarding without tutorial screens
5. Chat history management with limits
6. Integration with existing video analysis system

SUCCESS CRITERIA:
- First-time users complete video upload within 90 seconds
- Users see contextual guidance without overwhelming tutorials
- Conversation persists across app sessions
- Chat history stays under 50 messages
- Smooth integration with existing analysis backend
- First completion celebration appears appropriately
```

### Step 1D: Chat History Management Service
**Claude-Code Prompt:**
```
CONTEXT: You are creating a chat history management service for the golf coaching app. This service needs to handle conversation persistence, message limits, storage optimization, and conversation state management across app sessions.

REQUIREMENTS:
1. CONVERSATION PERSISTENCE: Save/load chat messages using AsyncStorage
2. MESSAGE LIMITS: Maintain maximum 50 messages, auto-cleanup older ones
3. STORAGE OPTIMIZATION: Efficient storage with compression for older messages
4. ONBOARDING DETECTION: Determine if user is first-time vs returning
5. VIDEO REFERENCES: Track video uploads and analysis within conversation

SERVICE STRUCTURE:
- Static methods for easy importing across components
- Error handling for storage failures
- Conversation state management
- Integration with existing video analysis flow

CORE METHODS NEEDED:
```javascript
class ChatHistoryManager {
  static async loadConversation(userId)
  static async saveMessage(userId, message)
  static async clearOldMessages(userId) // Keep only last 50
  static async isFirstTimeUser(userId)
  static async getConversationSummary(userId)
  static async addVideoReference(userId, videoId, analysisData)
}
```

STORAGE SCHEMA:
```javascript
// AsyncStorage: chat_history_{userId}
{
  messages: [
    {
      id: timestamp,
      text: "message content",
      sender: "user|coach",
      timestamp: Date,
      videoReference: "analysisId|null",
      messageType: "text|video_upload|analysis_result"
    }
  ],
  lastUpdated: Date,
  messageCount: number,
  userProfile: {
    isFirstTime: boolean,
    lastInteraction: Date
  }
}
```

ERROR HANDLING:
- AsyncStorage failures → graceful fallback to in-memory storage
- Storage quota exceeded → aggressive cleanup
- Corrupted data → reset conversation with user notification
- Network failures → queue messages for retry

PERFORMANCE REQUIREMENTS:
- Load conversation: <200ms
- Save message: <100ms
- Storage size: <100KB per user
- Memory efficient message handling

FILES TO CREATE:
- src/services/chatHistoryManager.js

DELIVERABLES:
1. Complete chat history management service
2. Conversation persistence with message limits
3. First-time user detection
4. Video reference tracking
5. Error handling and fallback mechanisms
6. Performance-optimized storage operations

SUCCESS CRITERIA:
- Conversations persist across app restarts
- Message count stays under 50 with automatic cleanup
- First-time users detected accurately
- No performance impact from storage operations
- Graceful handling of all error scenarios
```

## Sprint 1 Success Criteria
- ✅ App opens to Chat tab by default
- ✅ Bottom navigation works smoothly
- ✅ Chat conversations persist across sessions
- ✅ First-time users complete video upload within 90 seconds
- ✅ Users see contextual guidance without overwhelming tutorials
- ✅ Message history limited to 50 messages
- ✅ Users can access other tabs (even if empty with helpful guidance)
- ✅ Empty states in other tabs provide clear direction back to chat
- ✅ First completion celebration appears appropriately