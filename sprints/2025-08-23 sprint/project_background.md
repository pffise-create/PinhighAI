# Golf Coach AI - Project Background Document

## Project Overview

**Golf Coach AI** is a mobile app that provides personalized golf swing coaching through AI-powered video analysis and conversational coaching. The app uses computer vision to analyze golf swings and GPT-4o to provide conversational, relationship-building coaching responses that focus on root causes rather than just symptoms.

### Core Value Proposition
**"Fix one fundamental, improve three swing flaws"** - Unlike traditional golf apps that show swing data without context, Golf Coach AI identifies underlying swing fundamentals and provides conversational coaching that builds genuine relationships with users over time.

## Key Differentiators

### 1. Root Cause Coaching Philosophy
- **Traditional approach**: "You're coming over the top and have early extension"
- **Golf Coach AI approach**: "Your over-the-top move and early extension are both caused by poor weight shift. Fix that fundamental and both problems will improve."

### 2. P1-P10 Professional Analysis
Uses the complete P1-P10 golf instruction sequence for comprehensive swing analysis:
- P1: Address/Setup → P2: Takeaway → P3: Backswing Parallel → P4: Top of Backswing
- P5: Transition → P6: Downswing Parallel → P7: Impact → P8: Early Follow-through  
- P9: Finish Position → P10: Complete Finish

### 3. Conversational AI Coaching
- Builds genuine coaching relationships through persistent conversation history
- Uses encouraging, supportive tone vs. clinical analysis
- Provides "feel-based" coaching that combines technical instruction with relatable sensations
- Maintains coaching context across sessions for progressive improvement

### 4. Chat-Centric User Experience
- Primary interface is continuous conversation with AI coach
- Video upload and analysis integrated seamlessly into chat flow
- Results presented as natural coach responses, not separate analysis screens
- Progressive onboarding through interaction rather than tutorials

## Target Market

### Primary Users
- **8-25 handicap golfers** who want to improve but lack consistent professional instruction
- **Pain point**: Traditional golf apps show swing data but don't provide actionable coaching
- **User personas**: Weekend golfers, driving range practitioners, golfers preparing for tournaments

### Market Positioning
- **Premium positioning**: AI coaching justifies higher pricing vs basic swing apps
- **Competitive moat**: Root cause methodology and conversational coaching relationship
- **Viral potential**: Quality coaching drives word-of-mouth growth

## Technical Architecture

### Frontend Stack
```
React Native (Expo SDK ~49.0.0)
├── Navigation: Bottom tabs (4 tabs: Chat, Summary, Videos, Profile)
├── UI Framework: Custom components with golf club theme
├── Camera Integration: expo-camera for video recording
├── Storage: AsyncStorage for conversation persistence
└── API Integration: REST calls to AWS backend
```

### Backend Stack (AWS Serverless)
```
AWS Infrastructure (Region: us-east-1, Account: 458252603969)
├── API Gateway: t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod
├── Lambda Functions:
│   ├── golf-presigned-url-generator (video uploads)
│   ├── golf-ai-analysis (swing analysis + chat)
│   └── golf-coach-frame-extractor-container (OpenCV processing)
├── Storage:
│   ├── S3: golf-coach-videos-1753203601 (videos + frame images)
│   └── DynamoDB: golf-coach-analyses (analysis results)
└── AI: OpenAI GPT-4o API integration
```

### Video Analysis Pipeline
1. **Upload**: Mobile app → S3 presigned URLs
2. **Frame Extraction**: OpenCV extracts P1-P10 key positions
3. **AI Analysis**: GPT-4o analyzes frames with coaching context
4. **Results**: Conversational coaching returned to mobile app

### Cost Structure
- **~$0.03 per swing analysis** (S3 + Lambda + OpenAI costs)
- **Target**: <$5 per user per day for all AI operations
- **Scalability**: Serverless architecture auto-scales with demand

## Current Development Status

### ✅ Working Components
- **React Native UI/UX**: Professional golf club theme, navigation shell
- **AWS Backend**: Complete video processing pipeline (S3 → OpenCV → GPT-4o)
- **AI Analysis**: P1-P10 frame extraction with root cause coaching responses
- **Video Processing**: 30-60 second analysis time with 14 swing phases

### ❌ Missing Integration
- **Mobile-Backend Connection**: React Native app cannot actually upload videos
- **Real Chat Functionality**: Current chat is mock interface
- **Data Flow**: No connection between mobile UI and AWS analysis pipeline

### Current Architecture Gap
The app exists as two working but disconnected pieces:
1. **Frontend**: Beautiful React Native interface with mock functionality
2. **Backend**: Fully functional AWS video analysis pipeline

**Immediate objective**: Connect these pieces to create end-to-end user experience

## App Architecture Redesign

### New 4-Tab Structure
Based on UX research showing 86% effectiveness for bottom navigation:

1. **Chat Tab (Primary)**
   - Continuous conversation with AI coach
   - Video upload directly within chat
   - Analysis results as formatted coach messages
   - 50-message history limit for performance

2. **Summary Tab**
   - Top Strengths (what user does well)
   - Top 3 Improvement Areas (focus for practice)  
   - Top 3 Recommended Drills (specific exercises)
   - Progress visualization and trends

3. **Videos Tab**
   - Chronological timeline of all user videos
   - Video playback with analysis overlays
   - Progress comparison between videos
   - Search and filter capabilities

4. **Profile Tab**
   - Personal goals setting and tracking
   - Coaching preferences and app settings
   - Account management and data control

### User Flow Transformation
**Current Complex Flow**: Home → VideoRecord → Camera → Results → Chat
**New Simplified Flow**: Chat (with integrated video upload) ↔ Other tabs for reference

## Key Technical Constraints

### Performance Requirements
- App startup: <2 seconds to first interaction
- Video analysis: Complete in 30-60 seconds
- Chat message limit: 50 messages with auto-cleanup
- Memory efficiency: <15MB for conversation state

### Cost Controls
- Token limit: 1,500 tokens per GPT-4o request
- Rate limiting: 15 requests per user per hour
- Daily limits: $5 per user, $100 system-wide
- Conversation compression for storage efficiency

### Mobile Optimization
- Offline capability: Queue messages and videos for later sync
- Background processing: Continue analysis when app backgrounded
- Network resilience: Retry mechanisms and graceful degradation
- Battery efficiency: Optimize camera and upload processes

## Business Objectives

### Technical Goals
- **End-to-end functionality**: Complete video upload → analysis → results flow
- **Production readiness**: 99.5% uptime with robust error handling
- **Scalability**: Support 1000+ active coaching relationships
- **Performance**: 30-second analysis time, <3 second API responses

### User Experience Goals
- **Day 1 retention optimization**: 60-second path to first video analysis
- **Coaching relationship feel**: AI remembers previous sessions naturally
- **Progressive onboarding**: Learn through interaction, not tutorials
- **Positive-first coaching**: Build confidence while teaching

### Business Metrics
- **User engagement**: 40% increase in session continuation rates
- **Retention**: 30% improvement in return usage for multiple analyses
- **Premium conversion**: Coaching relationship drives subscription upgrades
- **Viral growth**: Quality coaching drives organic word-of-mouth

## Development Approach

### Sprint-Based Implementation
5 focused sprints to transform the current mock interface into a fully functional coaching app:

1. **Sprint 1**: Navigation foundation + core chat with progressive onboarding
2. **Sprint 2**: In-chat video upload + analysis integration with positive-first results
3. **Sprint 3**: Coaching summary with insights aggregation and new user experience
4. **Sprint 4**: Video vault with historical tracking and progress visualization
5. **Sprint 5**: Profile management with goals + final production polish

### Code Quality Standards
- **Production-ready code**: Not prototype quality, built for scale
- **Comprehensive error handling**: Graceful fallbacks maintaining coaching tone
- **Performance optimization**: Memory management, efficient data structures
- **Security**: Input validation, rate limiting, secure API integration

### Integration Philosophy
- **Mobile-first**: All features designed for thumb-friendly interaction
- **AI-native**: GPT-4o integration feels natural, not bolted-on
- **Golf-authentic**: Professional golf club aesthetic and terminology
- **Relationship-building**: Every interaction strengthens user-coach connection

## Success Definition

The project succeeds when:
1. **Users can record golf swings and receive AI coaching within 60 seconds of app launch**
2. **AI coaching feels like genuine relationship with persistent memory across sessions**
3. **Root cause coaching methodology demonstrably helps users improve faster**
4. **App achieves premium positioning in golf coaching market**
5. **Technical architecture scales to support business growth**

This foundation provides the context for implementing a mobile golf coaching app that differentiates through AI-powered root cause analysis and genuine coaching relationship building.