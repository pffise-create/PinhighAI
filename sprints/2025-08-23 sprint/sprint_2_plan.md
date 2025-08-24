# Sprint 2: In-Chat Video Upload & Analysis

**Duration:** 4-6 days  
**Goal:** Enable video upload directly within chat and receive analysis responses in the chat thread

## Sprint 2 Objectives
- Add video upload capability directly in chat interface
- Integrate camera functionality seamlessly
- Display analysis results as chat messages
- Implement progress indicators for video processing
- Maintain conversation flow during analysis

## Technical Requirements
- Video upload button in chat header
- Camera modal integration
- Gallery picker integration
- Progress tracking for upload/analysis
- Analysis results as formatted chat messages

## Files to Modify
- `src/screens/ChatScreen.js` (video upload integration)
- `src/screens/CameraScreen.js` (adapt for modal use)
- `src/services/videoService.js` (chat integration)

## Files to Create
- `src/components/VideoUploadButton.js`
- `src/components/VideoProgressMessage.js`
- `src/components/AnalysisResultMessage.js`
- `src/components/FirstAnalysisCelebration.js`
- `src/services/chatVideoIntegration.js`

## Implementation Steps

### Step 2A: Video Upload Interface in Chat
**Claude-Code Prompt:**
```
CONTEXT: You are adding video upload capability directly within the ChatScreen. Users should be able to upload videos for analysis without leaving the chat interface. This includes camera recording and gallery selection, with the entire process happening within the conversation flow.

CURRENT CHATSCREEN STATE:
- Enhanced chat interface from Sprint 1
- Conversation persistence and history management
- Basic chat functionality working

NEW REQUIREMENTS:
1. VIDEO UPLOAD BUTTON: Prominent button in chat header
2. UPLOAD OPTIONS: Camera recording or gallery selection
3. MODAL INTEGRATION: CameraScreen as modal overlay
4. PROGRESS INDICATORS: Show upload/analysis progress in chat
5. CONVERSATION FLOW: Maintain chat context during video processing

UPLOAD FLOW:
1. User taps video upload button in chat header
2. Modal with options: "Record Video" or "Choose from Gallery"
3. Camera recording → return video to chat
4. Gallery selection → return video to chat
5. Upload progress shown as chat message
6. Analysis results appear as formatted chat response

TECHNICAL IMPLEMENTATION:
- Video upload button in custom chat header
- Modal presentation for upload options
- Integration with existing CameraScreen
- Progress message components for chat
- VideoService integration for upload/analysis

UI COMPONENTS:
```jsx
<ChatHeader>
  <VideoUploadButton onPress={showUploadOptions} />
</ChatHeader>

<UploadModal>
  <Option onPress={openCamera}>Record Video</Option>
  <Option onPress={openGallery}>Choose from Gallery</Option>
</UploadModal>
```

FILES TO MODIFY:
- src/screens/ChatScreen.js (add video upload integration)

FILES TO CREATE:
- src/components/VideoUploadButton.js
- src/components/UploadOptionsModal.js
- src/components/VideoProgressMessage.js

DELIVERABLES:
1. Video upload button in chat header
2. Upload options modal (camera vs gallery)
3. Integration with CameraScreen as modal
4. Gallery picker integration
5. Progress indicators within chat conversation
6. Seamless conversation flow during upload

SUCCESS CRITERIA:
- Users can record videos without leaving chat
- Gallery selection works smoothly
- Upload progress clearly communicated
- Chat conversation continues naturally after upload
- All existing chat functionality preserved
```

### Step 2B: Analysis Results as Chat Messages
**Claude-Code Prompt:**
```
CONTEXT: You are creating a system to display golf swing analysis results as formatted chat messages within the conversation. Analysis results should feel like natural coach responses while being visually distinct and informative, with a focus on Day 1 retention through positive-first presentation.

CURRENT SYSTEM:
- Video upload working in chat
- Analysis pipeline (videoService.js) returns analysis data
- Need to format analysis as chat messages

REQUIREMENTS:
1. ANALYSIS MESSAGE FORMAT: Visually distinct from regular chat
2. POSITIVE-FIRST COACHING: Results start with genuine positives and celebrations
3. PROGRESSIVE DISCLOSURE: Summary first, details on tap
4. VISUAL HIERARCHY: Strengths, improvements, drills clearly organized
5. CONVERSATION INTEGRATION: Feels like natural coach response
6. DAY 1 RETENTION FOCUS: First analysis feels like an achievement

DAY 1 RETENTION OPTIMIZATION:
- Analysis results must start with genuine positives from actual analysis
- Use enthusiastic but professional coaching tone  
- Provide clear, immediate next actions
- Celebrate the completion of first analysis
- No preliminary or fake analysis feedback

ANALYSIS MESSAGE STRUCTURE:
```jsx
<AnalysisResultMessage>
  <CoachResponse>
    "🎯 Great swing analysis complete! Here's what I noticed..."
  </CoachResponse>
  
  <AnalysisSummary>
    <CelebrationHeader>First Analysis Complete!</CelebrationHeader>
    <OverallScore>7.5/10</OverallScore>
    <KeyStrengths>
      <Strength>Consistent setup position</Strength>
      <Strength>Good tempo rhythm</Strength>
    </KeyStrengths>
    <ImprovementFocus>
      <PrimaryArea>Weight shift timing</PrimaryArea>
      <NextStep>Try focusing on this in your next swing</NextStep>
    </ImprovementFocus>
  </AnalysisSummary>
  
  <ExpandableDetails>
    <DrillRecommendations>...</DrillRecommendations>
    <TechnicalAnalysis>...</TechnicalAnalysis>
  </ExpandableDetails>
</AnalysisResultMessage>
```

COACHING RESPONSE STRUCTURE:
1. Celebration: "Your first swing analysis is complete! 🎯"
2. Strengths first: Lead with 2-3 genuine positives from analysis
3. One key improvement: Focus on single most impactful area
4. Clear next step: "Try another swing focusing on [specific tip]"
5. Encouragement: "You're on the right track!"

DESIGN REQUIREMENTS:
- Distinct background/border for analysis messages
- Golf club theme colors and styling
- Expandable sections for detailed information
- Coach celebration indicator for first analysis
- Clear visual hierarchy with golf iconography

DATA TRANSFORMATION:
- Extract genuine positives from technical analysis data
- Identify single most impactful improvement area
- Format practice recommendations clearly
- Maintain encouraging coaching relationship tone
- Celebrate completion milestones

FILES TO CREATE:
- src/components/AnalysisResultMessage.js
- src/components/CoachingResponseCard.js
- src/components/ExpandableAnalysisDetails.js
- src/components/FirstAnalysisCelebration.js
- src/utils/analysisFormatter.js

DELIVERABLES:
1. Formatted analysis result message component
2. Positive-first coaching tone integration
3. Progressive disclosure for detailed analysis
4. First analysis celebration system
5. Visual design consistent with golf theme
6. Integration with chat message flow
7. Data transformation utilities for positive presentation

SUCCESS CRITERIA:
- Analysis results feel like natural coach responses
- First analysis completion feels like an achievement
- Results lead with genuine positives from actual analysis
- Clear visual distinction from regular chat messages
- Information hierarchy helps user understanding
- Expandable details work smoothly
- Encouraging coaching tone consistent throughout
- Users receive clear next action after first analysis
```

### Step 2C: Video Processing Integration
**Claude-Code Prompt:**
```
CONTEXT: You are integrating the existing video analysis pipeline with the new chat interface. Videos uploaded in chat need to be processed through the AWS backend and results returned as chat messages, with proper progress tracking and error handling.

CURRENT SYSTEM:
- ChatScreen with video upload capability
- Existing videoService.js with upload/analysis pipeline
- AWS backend: S3 upload → frame extraction → AI analysis
- Analysis results formatting for chat messages

INTEGRATION REQUIREMENTS:
1. CHAT-AWARE VIDEO SERVICE: Modify videoService for chat integration
2. PROGRESS TRACKING: Real-time progress updates in chat
3. ERROR HANDLING: Chat-appropriate error messages
4. RESULT FORMATTING: Transform analysis data for chat display
5. CONVERSATION CONTINUITY: Maintain chat flow during processing

PROCESSING FLOW:
1. Video selected in chat
2. Upload progress message appears in chat
3. "Analyzing your swing..." message shows processing
4. Analysis complete → formatted result message
5. User can ask follow-up questions in same chat thread

PROGRESS MESSAGE EXAMPLES:
```javascript
const progressMessages = {
  uploading: "Uploading your swing video... 45%",
  processing: "Analyzing your swing with AI coach...",
  extracting: "Extracting key swing positions...",
  analyzing: "Generating personalized coaching...",
  complete: "Analysis complete! Here's your coaching:"
};
```

ERROR HANDLING:
- Network failures → retry options in chat
- Analysis failures → helpful error messages with suggestions
- Timeout handling → "Taking longer than expected" messages
- Graceful degradation with coaching tone maintained

TECHNICAL IMPLEMENTATION:
- Modify videoService.js for chat integration
- Add progress callback functions
- Create chat message types for different states
- Error handling with user-friendly messages
- Integration with ChatHistoryManager

FILES TO MODIFY:
- src/services/videoService.js (chat integration)
- src/services/chatHistoryManager.js (video message types)

FILES TO CREATE:
- src/services/chatVideoIntegration.js
- src/components/VideoProcessingMessage.js
- src/utils/chatMessageTypes.js

DELIVERABLES:
1. Chat-integrated video processing pipeline
2. Real-time progress updates in chat
3. Error handling with chat-appropriate messages
4. Analysis result integration with chat
5. Conversation continuity during processing
6. User feedback for all processing states

SUCCESS CRITERIA:
- Video upload progress clearly shown in chat
- Processing states communicated effectively
- Analysis results appear as formatted chat messages
- Error scenarios handled gracefully
- Chat conversation maintains context throughout
- Users understand what's happening at each step
```

## Sprint 2 Success Criteria
- ✅ Users can upload videos directly in chat
- ✅ Video processing progress shown in conversation
- ✅ Analysis results appear as formatted coach messages
- ✅ Analysis results lead with positive observations
- ✅ First analysis completion feels like an achievement
- ✅ Users receive clear next action after first analysis
- ✅ Chat conversation continues seamlessly
- ✅ Error handling maintains coaching tone
- ✅ Both camera and gallery uploads work