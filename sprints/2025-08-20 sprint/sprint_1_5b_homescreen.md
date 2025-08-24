# Sprint 1.5B: Enhanced HomeScreen Navigation

**Project:** Golf Coach AI - Smart Coaching Conversation Architecture  
**Sprint:** 1.5B  
**Duration:** Week 1.5, Part B  
**Dependencies:** Sprint 1A (Enhanced AI Prompting), Sprint 1B (Context Service)

## 🎯 Customer Problem Statement

**Current Pain Points:**
- HomeScreen is just a basic landing page with no awareness of user's coaching journey
- Users with coaching history can't easily access previous analyses or continue conversations
- No sense of coaching progress or relationship continuity from the home screen
- Users must remember where they left off in their coaching journey

**Customer Value:**
- Immediate coaching context and progress visibility upon app open
- Easy access to continue coaching conversations and view previous work
- Sense of ongoing coaching relationship from the moment they open the app
- Clear navigation paths based on their coaching history and current focus

## 📋 Implementation Requirements

### 1. COACHING STATUS OVERVIEW
- Display current coaching session number and focus area
- Show last activity date and coaching progress
- Provide prominent "Continue Coaching Chat" button
- Handle both first-time users and returning users

### 2. RECENT SWING ANALYSES SECTION
- Display last 3-5 swing analyses with thumbnails
- Show analysis date, focus area, and overall score
- Provide navigation to specific ResultsScreen for each analysis
- Enable follow-up questions on specific swings

### 3. COACHING FOCUS SUMMARY
- Display 2-3 bullet points of current coaching priorities
- Clear, action-oriented language (not technical jargon)
- Visual progress indicators for each focus area
- "What we're working on this month" summary

### 4. NAVIGATION ACTIONS
```jsx
// Required navigation options
<ActionButtons>
  <ContinueCoachingButton onPress={() => navigateToCoachingChat()}>
    Continue Coaching Chat
  </ContinueCoachingButton>
  
  <UploadNewVideoButton onPress={() => navigation.navigate('VideoRecord')}>
    Analyze New Swing
  </UploadNewVideoButton>
  
  <AskCoachButton onPress={() => navigateToGeneralChat()}>
    Ask Coach Anything
  </AskCoachButton>
</ActionButtons>
```

### 5. DATA INTEGRATION
- Load coaching overview using ConversationContextService
- Fetch recent analyses from API
- Cache data for offline access and quick loading
- Handle loading states and error scenarios

### 6. USER EXPERIENCE STATES
- **First-time user:** Welcome flow with onboarding
- **Returning user:** Coaching dashboard with history
- **Loading states:** Skeleton screens and progressive loading
- **Error states:** Graceful fallbacks with cached data

## 🔧 Technical Implementation Details

### API Integration Required
```javascript
// New API endpoints needed
GET /api/user/coaching-overview
Response: {
  sessionCount: 12,
  currentFocus: "weight_shift_timing",
  lastActivity: "2025-08-18T10:30:00Z",
  hasActiveConversation: true,
  progressSummary: {
    improvementAreas: ["setup", "tempo"],
    recentMilestones: ["consistent_setup_achieved"]
  }
}

GET /api/user/recent-analyses?limit=5
Response: [
  {
    analysisId: "swing_123",
    date: "2025-08-18",
    focusArea: "setup_consistency",
    overallScore: 7.5,
    hasFollowupChat: true,
    thumbnailUrl: "s3://..."
  }
]
```

### Navigation Flow Examples
1. User opens app → HomeScreen coaching dashboard
2. Sees "Session 12 - Working on weight shift"
3. Options:
   - "Continue Coaching Chat" → ChatScreen with full context
   - Click recent analysis → ResultsScreen for that swing
   - "Analyze New Swing" → VideoRecordScreen

### Component Architecture
```jsx
// HomeScreen.js structure
const HomeScreen = ({ navigation }) => {
  const [coachingOverview, setCoachingOverview] = useState(null);
  const [recentAnalyses, setRecentAnalyses] = useState([]);
  const [loading, setLoading] = useState(true);
  
  return (
    <SafeAreaView style={styles.container}>
      {loading ? (
        <CoachingDashboardSkeleton />
      ) : coachingOverview ? (
        <CoachingDashboard 
          overview={coachingOverview}
          recentAnalyses={recentAnalyses}
          navigation={navigation}
        />
      ) : (
        <WelcomeFlow navigation={navigation} />
      )}
    </SafeAreaView>
  );
};
```

## 📁 Files to Modify

### Primary Implementation
- **src/screens/HomeScreen.js** - Complete redesign as coaching dashboard

### New Components to Create
- **src/components/CoachingDashboard.js** - Main dashboard container
- **src/components/CoachingStatusCard.js** - Session progress display
- **src/components/RecentAnalysisCard.js** - Individual analysis preview
- **src/components/ProgressIndicator.js** - Visual progress display
- **src/components/CoachingDashboardSkeleton.js** - Loading states

### Component Details
```jsx
// CoachingStatusCard.js
const CoachingStatusCard = ({ sessionCount, currentFocus, lastActivity }) => {
  return (
    <View style={styles.statusCard}>
      <Text style={styles.sessionTitle}>Session {sessionCount}</Text>
      <Text style={styles.focusText}>Working on: {currentFocus}</Text>
      <Text style={styles.lastActivity}>Last session: {lastActivity}</Text>
      <ProgressIndicator areas={["setup", "tempo", "impact"]} />
    </View>
  );
};

// RecentAnalysisCard.js
const RecentAnalysisCard = ({ analysis, onPress }) => {
  return (
    <TouchableOpacity style={styles.analysisCard} onPress={onPress}>
      <Text style={styles.date}>{analysis.date}</Text>
      <Text style={styles.score}>Score: {analysis.overallScore}/10</Text>
      <Text style={styles.focus}>Focus: {analysis.focusArea}</Text>
      {analysis.hasFollowupChat && (
        <Text style={styles.chatIndicator}>💬 Has chat</Text>
      )}
    </TouchableOpacity>
  );
};
```

## 🎯 Success Criteria

### Technical Success
- Dashboard loads in <1 second with cached data
- Graceful handling of API failures with cached content
- Smooth navigation between all coaching contexts
- Progressive loading with skeleton screens

### User Experience Success
- Users immediately understand their coaching progress on app open
- Clear navigation paths to continue coaching or start new analysis
- First-time users get appropriate welcome experience
- Returning users feel coaching continuity from the home screen

### Engagement Metrics
- 70% of returning users use "Continue Coaching Chat" button
- 50% increase in session-to-session retention
- 30% reduction in time to find previous analyses
- 85%+ user satisfaction with home screen experience

## 🔍 Testing Scenarios

### User State Tests
1. **First-time user** - Welcome flow displays correctly
2. **User with 1 analysis** - Simplified dashboard with encouragement
3. **Regular user** - Full dashboard with coaching progress
4. **Power user** - Dashboard with extensive history management

### Loading & Error Tests
1. **Cold app start** - Skeleton loading → dashboard transition
2. **Network failure** - Cached data displays with offline indicator
3. **API timeout** - Graceful fallback to basic navigation
4. **Corrupt cached data** - Reset to welcome flow

### Navigation Tests
1. **Continue coaching** - Context passes to ChatScreen correctly
2. **Recent analysis** - Navigation to specific ResultsScreen
3. **New analysis** - Standard VideoRecordScreen flow
4. **Deep linking** - Handle external links to dashboard

## 📊 Performance Targets

- **Dashboard Load:** <1 second with cached data
- **API Calls:** <500ms for coaching overview
- **Component Render:** <100ms for dashboard display
- **Memory Usage:** <10MB for dashboard data
- **Cache Efficiency:** 90% cache hit rate for returning users

## 🚀 Implementation Order

1. **Create CoachingDashboard component** with basic layout
2. **Implement CoachingStatusCard** with session display
3. **Create RecentAnalysisCard** with navigation
4. **Add loading states** and skeleton screens
5. **Integrate ConversationContextService** for data
6. **Implement navigation handlers** for all action buttons
7. **Add caching and offline handling**
8. **Polish UX and error states**

## 🔄 Navigation Flow Updates

### From HomeScreen
- **Continue Coaching Chat** → ChatScreen with full context
- **Recent Analysis** → ResultsScreen with swing context
- **Analyze New Swing** → VideoRecordScreen (existing flow)
- **Ask Coach Anything** → ChatScreen without swing context

### To HomeScreen  
- All screens should have option to return to coaching dashboard
- Context should be preserved for quick resume
- Back navigation should feel natural and expected

---

**Next Sprint:** Sprint 2A - Enhanced ResultsScreen with Context Awareness