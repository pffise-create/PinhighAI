# Sprint 4: Video Vault & Historical Tracking

**Duration:** 3-4 days  
**Goal:** Build video repository for users to track swing changes over time

## Sprint 4 Objectives
- Create VideoVaultScreen with timestamped video browsing
- Implement video playback and comparison features
- Show progress over time through video chronology
- Integrate with existing video analyses
- Add search/filter capabilities for videos

## Technical Requirements
- Video metadata storage and retrieval
- Chronological video browsing interface
- Video playback with analysis overlay
- Progress tracking through video comparison
- Efficient video loading and caching

## Files to Create
- `src/screens/VideoVaultScreen.js`
- `src/services/videoVaultManager.js`
- `src/components/VideoTimelineCard.js`
- `src/components/VideoPlayerModal.js`
- `src/components/ProgressComparison.js`
- `src/utils/videoMetadataHelpers.js`

## Implementation Steps

### Step 4A: Video Vault Manager Service
**Claude-Code Prompt:**
```
CONTEXT: You are creating a VideoVaultManager service that handles video metadata storage, retrieval, and organization for the Video Vault screen. This service needs to track all user videos with timestamps and analysis data for historical viewing.

REQUIREMENTS:
1. VIDEO METADATA STORAGE: Store video information with timestamps and analysis data
2. CHRONOLOGICAL RETRIEVAL: Get videos organized by date/time
3. ANALYSIS INTEGRATION: Link videos with their coaching analysis results
4. PROGRESS TRACKING: Compare videos over time for improvement visualization
5. SEARCH/FILTER: Enable filtering by date range, focus areas, etc.

VIDEO METADATA SCHEMA:
```javascript
const videoMetadata = {
  videoId: "unique_video_identifier",
  userId: "user_identifier", 
  uploadDate: "2025-08-20T14:30:00Z",
  videoUrl: "s3_presigned_url",
  thumbnailUrl: "s3_thumbnail_url",
  analysisId: "analysis_result_id",
  analysisData: {
    overallScore: 7.5,
    strengths: ["setup", "tempo"],
    improvements: ["impact", "follow_through"],
    coachingThemes: ["weight_shift"]
  },
  videoMetrics: {
    duration: 45, // seconds
    frameCount: 1350,
    fileSize: "15.2MB"
  },
  tags: ["driver", "practice_range"],
  notes: "Working on weight shift timing"
};
```

CORE SERVICE METHODS:
```javascript
class VideoVaultManager {
  static async storeVideoMetadata(videoData)
  static async getVideosByDateRange(userId, startDate, endDate)
  static async getVideosByCoachingTheme(userId, theme)
  static async getVideoTimeline(userId) // Chronological order
  static async compareVideos(userId, videoIds) // Progress comparison
  static async searchVideos(userId, searchCriteria)
  static async updateVideoMetadata(videoId, updates)
  static async deleteVideo(videoId)
}
```

STORAGE IMPLEMENTATION:
- AsyncStorage for local metadata caching
- API integration for server-side storage
- Efficient data structures for chronological access
- Search indexing for quick filtering
- Progress calculation algorithms

INTEGRATION POINTS:
- Chat video uploads → automatically add to vault
- Video analysis completion → update metadata
- Coaching insights → tag videos with themes
- Progress tracking → enable video comparisons

ERROR HANDLING:
- Handle missing video files gracefully
- Validate metadata integrity
- Provide fallbacks for network failures
- Recover from corrupted local storage
- User-friendly error messages

FILES TO CREATE:
- src/services/videoVaultManager.js
- src/utils/videoMetadataHelpers.js
- src/utils/videoComparison.js

DELIVERABLES:
1. Complete video vault management service
2. Video metadata storage and retrieval
3. Chronological organization capabilities
4. Search and filter functionality
5. Progress comparison algorithms
6. Integration with existing video systems

SUCCESS CRITERIA:
- All uploaded videos automatically stored in vault
- Fast retrieval of videos by date range
- Accurate metadata linking with analyses
- Smooth search and filter operations
- Progress comparisons provide meaningful insights
```

### Step 4B: Video Vault Screen Interface
**Claude-Code Prompt:**
```
CONTEXT: You are creating the VideoVaultScreen that displays all user videos in a chronological timeline format. Users should be able to browse their swing evolution over time, see progress, and easily access any previous video with its analysis.

SCREEN LAYOUT REQUIREMENTS:
1. CHRONOLOGICAL TIMELINE: Videos organized by date with visual timeline
2. VIDEO PREVIEW CARDS: Thumbnail, date, score, key insights
3. QUICK FILTERS: Filter by date range, coaching themes, scores
4. PROGRESS INDICATORS: Visual progress between videos
5. SEARCH FUNCTIONALITY: Find specific videos or themes

VISUAL DESIGN:
- Timeline layout showing swing evolution
- Video cards with key information
- Progress indicators between timeline points
- Professional golf theme styling
- Easy navigation and video selection

COMPONENT STRUCTURE:
```jsx
<VideoVaultScreen>
  <VaultHeader>
    <SearchBar onSearch={handleSearch} />
    <FilterOptions>
      <DateRangeFilter />
      <ThemeFilter />
      <ScoreFilter />
    </FilterOptions>
  </VaultHeader>
  
  <VideoTimeline>
    {videos.map(video => (
      <VideoTimelineCard 
        key={video.id}
        video={video}
        onPress={() => openVideoPlayer(video)}
        showProgressComparison={shouldShowProgress(video)}
      />
    ))}
  </VideoTimeline>
  
  <VideoPlayerModal 
    visible={playerVisible}
    video={selectedVideo}
    onClose={closePlayer}
  />
</VideoVaultScreen>
```

VIDEO TIMELINE CARD:
```jsx
<VideoTimelineCard>
  <VideoThumbnail source={video.thumbnailUrl} />
  <VideoInfo>
    <UploadDate>{formatDate(video.uploadDate)}</UploadDate>
    <OverallScore score={video.analysisData.overallScore} />
    <KeyInsights insights={video.analysisData.strengths} />
    <CoachingThemes themes={video.analysisData.coachingThemes} />
  </VideoInfo>
  <ProgressIndicator 
    improvement={video.progressData}
    visible={hasComparison(video)}
  />
</VideoTimelineCard>
```

FEATURES:
- Pull-to-refresh for latest videos
- Infinite scroll for large video collections
- Quick video preview on long press
- Swipe actions for video options
- Progress visualization between videos

DATA LOADING:
- Load videos in chronological order
- Lazy loading for performance
- Cache video metadata locally
- Background sync with server
- Handle large video collections efficiently

NAVIGATION:
- Tap video → open full player with analysis
- Long press → quick preview
- Swipe → video options (share, delete, notes)
- Pull down → refresh video list
- Search → filter timeline

FILES TO CREATE:
- src/screens/VideoVaultScreen.js
- src/components/VideoTimelineCard.js
- src/components/VideoPlayerModal.js
- src/components/ProgressComparison.js

DELIVERABLES:
1. Complete VideoVaultScreen with timeline layout
2. Video timeline cards with key information
3. Search and filter functionality
4. Video player modal with analysis overlay
5. Progress comparison between videos
6. Professional golf theme visual design

SUCCESS CRITERIA:
- Clear chronological view of all user videos
- Easy browsing and video selection
- Quick access to video analysis information
- Visual progress indicators show improvement
- Search and filter work efficiently
- Smooth performance with many videos
```

### Step 4C: Video Player with Analysis Overlay
**Claude-Code Prompt:**
```
CONTEXT: You are creating a video player modal that displays videos with their coaching analysis overlays. Users should be able to watch their swing while seeing the AI coach's insights, frame analysis, and improvement recommendations.

PLAYER REQUIREMENTS:
1. FULL-SCREEN VIDEO PLAYBACK: High-quality video display with controls
2. ANALYSIS OVERLAY: Show coaching insights without blocking video
3. FRAME ANALYSIS: P1-P10 position markers if available
4. COACHING INSIGHTS: Display strengths, improvements, recommendations
5. COMPARISON MODE: Compare current video with previous videos

VIDEO PLAYER FEATURES:
- Full video playback controls (play, pause, seek, speed)
- Coaching analysis overlay that can be toggled
- Frame-by-frame navigation for swing positions
- Analysis annotations on specific swing phases
- Comparison split-screen with other videos

OVERLAY DESIGN:
```jsx
<VideoPlayerModal>
  <VideoPlayer 
    source={video.videoUrl}
    ref={playerRef}
    controls={true}
    resizeMode="contain"
  />
  
  <AnalysisOverlay visible={showAnalysis}>
    <CoachingInsights>
      <OverallScore score={analysis.overallScore} />
      <KeyStrengths strengths={analysis.strengths} />
      <ImprovementAreas areas={analysis.improvements} />
    </CoachingInsights>
    
    <SwingPositions>
      {analysis.frameData?.map(frame => (
        <PositionMarker 
          key={frame.position}
          position={frame.position}
          timestamp={frame.timestamp}
          onPress={() => seekToPosition(frame.timestamp)}
        />
      ))}
    </SwingPositions>
  </AnalysisOverlay>
  
  <PlayerControls>
    <ToggleAnalysisButton />
    <ComparisonButton />
    <ShareButton />
    <CloseButton />
  </PlayerControls>
</VideoPlayerModal>
```

ANALYSIS INTEGRATION:
- Load analysis data with video
- Display coaching insights as overlay
- Show P1-P10 frame markers if available
- Enable seeking to specific swing positions
- Toggle between video-only and analysis modes

COMPARISON FEATURES:
- Side-by-side video comparison
- Progress indicators between videos
- Synchronized playback for comparison
- Analysis diff showing improvements
- Timeline scrubbing for both videos

PERFORMANCE:
- Efficient video loading and caching
- Smooth overlay animations
- Responsive video controls
- Memory management for large videos
- Background loading for comparisons

INTERACTION:
- Tap to show/hide analysis overlay
- Double-tap to toggle full-screen
- Pinch to zoom (if needed)
- Swipe gestures for video navigation
- Long-press for additional options

FILES TO CREATE:
- src/components/VideoPlayerModal.js
- src/components/AnalysisOverlay.js
- src/components/SwingPositionMarkers.js
- src/components/VideoComparison.js

DEPENDENCIES:
```bash
npm install react-native-video
```

DELIVERABLES:
1. Full-featured video player modal
2. Coaching analysis overlay system
3. Swing position markers and navigation
4. Video comparison capabilities
5. Professional video player controls
6. Performance-optimized video handling

SUCCESS CRITERIA:
- Videos play smoothly with high quality
- Analysis overlay provides clear coaching insights
- Frame markers enable precise swing review
- Comparison mode shows clear progress
- Player controls are intuitive and responsive
- Performance remains smooth with large videos
```

## Sprint 4 Success Criteria
- ✅ Video Vault displays chronological video timeline
- ✅ Users can browse and search historical videos
- ✅ Video player shows analysis overlays
- ✅ Progress comparison between videos works
- ✅ Professional video browsing experience
- ✅ Fast loading and smooth video playback