# Claude Code Prompt: ChatGPT-Style Golf Coaching Interface

**CONTEXT:** Transform the golf coaching app into a clean, ChatGPT-style interface with video upload capabilities. Strip away all complexity - no grades, no emojis, no celebration cards, no structured analysis layouts. Focus on conversational coaching with seamless video integration.

**TARGET EXPERIENCE:**
- Clean chat interface identical to ChatGPT's simplicity
- Camera button for video uploads (like ChatGPT's attachment button)
- Video thumbnails appear inline in chat messages
- AI coaching responses as natural conversation text
- Zero interface chrome or decorative elements

**CURRENT COMPLEXITY TO REMOVE:**
- ❌ Coaching cards with scores and structured layouts
- ❌ Celebration modals and achievement banners  
- ❌ Onboarding messages and progress indicators
- ❌ Emojis and decorative icons throughout interface
- ❌ Analysis result cards with sections and scores
- ❌ Purple left borders and "coaching presence" indicators
- ❌ Complex message types and special rendering

**CLEAN CHATGPT-STYLE DESIGN:**

## 1. MINIMAL HEADER
```javascript
// Clean header like ChatGPT
const ChatHeader = () => (
  <View style={styles.header}>
    <Text style={styles.title}>Golf Coach</Text>
  </View>
);
```

## 2. SIMPLE MESSAGE RENDERING
```javascript
// Only two message types: user and assistant (like ChatGPT)
const renderMessage = ({ item }) => {
  if (item.sender === 'user') {
    return (
      <View style={styles.userMessageContainer}>
        {item.hasVideo && (
          <TouchableOpacity style={styles.videoThumbnail}>
            <Image source={{ uri: item.videoThumbnail }} style={styles.thumbnailImage} />
            <View style={styles.playOverlay}>
              <Ionicons name="play" size={20} color="white" />
            </View>
          </TouchableOpacity>
        )}
        {item.text && <Text style={styles.userText}>{item.text}</Text>}
      </View>
    );
  }
  
  return (
    <View style={styles.assistantMessageContainer}>
      <Text style={styles.assistantText}>{item.text}</Text>
    </View>
  );
};
```

## 3. CLEAN VIDEO UPLOAD INTEGRATION
```javascript
// Simple camera button in input area (like ChatGPT attachment)
const ChatInput = () => (
  <View style={styles.inputContainer}>
    <TouchableOpacity style={styles.cameraButton} onPress={handleVideoUpload}>
      <Ionicons name="camera" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
    <TextInput 
      style={styles.input}
      placeholder="Message Golf Coach..."
      value={inputText}
      onChangeText={setInputText}
    />
    <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
      <Ionicons name="send" size={18} color={colors.primary} />
    </TouchableOpacity>
  </View>
);
```

## 4. VIDEO ANALYSIS FLOW
```javascript
// When video uploaded, show in user message with thumbnail
const handleVideoAnalysis = async (videoUri) => {
  // 1. Add user message with video thumbnail
  const userMessage = {
    id: generateId(),
    sender: 'user', 
    text: null,
    hasVideo: true,
    videoUri: videoUri,
    videoThumbnail: await generateThumbnail(videoUri),
    timestamp: new Date()
  };
  
  addMessage(userMessage);
  
  // 2. Show simple loading message
  const loadingMessage = {
    id: generateId(),
    sender: 'assistant',
    text: 'Analyzing your swing...',
    isLoading: true,
    timestamp: new Date()
  };
  
  addMessage(loadingMessage);
  
  // 3. Replace with natural coaching response (no structured cards)
  const analysis = await analyzeVideo(videoUri);
  
  updateMessage(loadingMessage.id, {
    text: generateNaturalCoachingResponse(analysis),
    isLoading: false
  });
};
```

## 5. NATURAL COACHING RESPONSES
```javascript
// Convert technical analysis to conversational coaching
const generateNaturalCoachingResponse = (analysis) => {
  // Instead of structured cards, return natural coaching text
  return `I can see some really good things in your swing! Your setup position looks solid and you're maintaining good balance throughout. 

The main area I'd focus on is your weight transfer timing - you're getting a bit ahead of yourself in the downswing. Try feeling like you're stepping into the shot with your lead foot. This will help with both power and consistency.

Want to try another swing focusing on that weight shift feeling?`;
};
```

## 6. MINIMAL STYLING (ChatGPT-inspired)
```javascript
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF', // Pure white like ChatGPT
  },
  
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
  },
  
  messagesList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  
  // User messages (right-aligned, simple)
  userMessageContainer: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    marginBottom: 16,
    marginTop: 8,
  },
  
  userText: {
    fontSize: 16,
    color: '#000000',
    lineHeight: 22,
  },
  
  // Assistant messages (left-aligned, simple)  
  assistantMessageContainer: {
    alignSelf: 'flex-start',
    maxWidth: '80%',
    marginBottom: 16,
    marginTop: 8,
  },
  
  assistantText: {
    fontSize: 16,
    color: '#000000',
    lineHeight: 22,
  },
  
  // Video thumbnail in user messages
  videoThumbnail: {
    width: 200,
    height: 112,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 8,
    position: 'relative',
  },
  
  thumbnailImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F0F0F0',
  },
  
  playOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -15 }, { translateY: -15 }],
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Simple input area
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  
  cameraButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 20,
    maxHeight: 100,
  },
  
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
});
```

## 7. SIMPLIFIED MESSAGE TYPES
```javascript
// Only two message types needed
const MessageTypes = {
  USER: 'user',
  ASSISTANT: 'assistant'
};

// Message structure
const createMessage = (sender, text, options = {}) => ({
  id: generateId(),
  sender,
  text,
  timestamp: new Date(),
  hasVideo: options.hasVideo || false,
  videoUri: options.videoUri || null,
  videoThumbnail: options.videoThumbnail || null,
  isLoading: options.isLoading || false,
});
```

## 8. REMOVE ALL COMPLEX COMPONENTS
Files to delete/simplify:
- ❌ `FirstAnalysisCelebration.js` 
- ❌ `ProgressiveOnboardingMessage.js`
- ❌ `AnalysisResultMessage.js` 
- ❌ `VideoProgressMessage.js`
- ❌ Complex coaching-specific styling
- ❌ Achievement and scoring logic

**IMPLEMENTATION GOALS:**
1. **Ultra-clean interface** - Looks exactly like ChatGPT with video capability
2. **Natural conversations** - AI responds conversationally, no structured data
3. **Seamless video flow** - Upload video, get coaching response, continue chatting
4. **Zero complexity** - Remove all decorative elements and special UI states
5. **Fast and smooth** - Minimal re-renders, simple message types

**SUCCESS CRITERIA:**
- Interface feels like ChatGPT with video uploads
- Video thumbnails appear cleanly in chat flow  
- Coaching responses read like natural conversation
- No complex UI elements or structured layouts
- Users can upload videos and get coaching without any learning curve

Please implement this stripped-down, ChatGPT-style interface focusing on conversational simplicity with seamless video integration.