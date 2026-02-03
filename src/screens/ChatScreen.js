// ChatScreen.js - Modern golf chat experience
import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import ChatHistoryManager from '../services/chatHistoryManager';
import chatApiService from '../services/chatApiService';
import videoService from '../services/videoService';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Audio } from 'expo-av';
import Markdown from 'react-native-markdown-display';
import { colors, typography, spacing } from '../utils/theme';

const TYPING_PHRASES = [
  'Checking the wind...',
  'Fixing divots...',
  'Reading the green...',
  'Picking the right club...',
  'Visualizing the shot...'
];

const UPLOAD_STATUS_MESSAGES = [
  'Teeing up your swing...',
  'Grooving tempo...',
  'Tracing swing plane...',
  'Studying impact...',
  'Prepping insights...'
];

const SCROLL_THRESHOLD = 96;
const MAX_VIDEO_LENGTH_SECONDS = 5;

const markdownStyles = {
  body: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    lineHeight: typography.lineHeights.relaxed * typography.fontSizes.base,
    fontFamily: typography.fontFamily,
  },
  heading1: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    marginBottom: spacing.sm,
    marginTop: spacing.base,
  },
  heading2: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  heading3: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.coachAccent,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  paragraph: {
    marginBottom: spacing.sm,
  },
  strong: {
    fontWeight: typography.fontWeights.bold,
    color: colors.coachAccent,
  },
  bullet_list: {
    marginBottom: spacing.sm,
  },
  list_item: {
    marginBottom: spacing.xs,
  },
};

const createMessage = ({
  id,
  sender,
  text,
  type = 'text',
  createdAt = new Date(),
  videoThumbnail,
  videoDuration,
}) => ({
  id: id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  sender,
  text,
  type,
  createdAt,
  videoThumbnail,
  videoDuration,
});


const normalizeStoredMessages = (storedMessages = []) => (
  storedMessages
    .filter(Boolean)
    .map((msg) =>
      createMessage({
        id: msg.id,
        sender: msg.sender === 'coach' ? 'coach' : 'user',
        text: msg.text,
        type: msg.messageType || msg.type || 'text',
        createdAt: msg.timestamp ? new Date(msg.timestamp) : new Date(),
        videoThumbnail: msg.videoThumbnail,
        videoDuration: msg.videoDuration,
      })
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
);

const mergeMessageLists = (current = [], incoming = []) => {
  if (!incoming.length) {
    return current;
  }
  if (!current.length) {
    return incoming;
  }
  const map = new Map();
  [...current, ...incoming].forEach((msg) => {
    if (!msg || !msg.id) {
      return;
    }
    map.set(msg.id, msg);
  });
  const withoutIds = [...current, ...incoming].filter((msg) => !msg?.id);
  const merged = Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );
  return withoutIds.length ? [...merged, ...withoutIds] : merged;
};

const ChatScreen = ({ navigation, route }) => {
  const { user, isAuthenticated, getAuthHeaders } = useAuth();
  const userId = user?.id || 'guest';

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [typingPhrase, setTypingPhrase] = useState(null);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoThumbnail, setVideoThumbnail] = useState(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const typingIntervalRef = useRef(null);
  const flatListRef = useRef(null);
  const initialScrollHandled = useRef(false);
  const prevMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    initialScrollHandled.current = false;
  }, [userId]);

  useEffect(() => {
    let isMounted = true;
    hasHydratedRef.current = false;

    const hydrate = async () => {
      try {
        const history = await ChatHistoryManager.loadConversation(userId);
        if (!isMounted) {
          return;
        }
        const normalized = normalizeStoredMessages(history?.messages || []);
        setMessages((prev) => mergeMessageLists(prev, normalized));
        hasHydratedRef.current = true;
      } catch (error) {
        console.warn('Failed to load chat history:', error);
      }
    };

    hydrate();

    return () => {
      isMounted = false;
    };
  }, [userId]);

  useEffect(() => {
    const recordedVideo = route.params?.recordedVideo;
    if (recordedVideo) {
      navigation.setParams({ recordedVideo: null });
      handleVideoSelected(recordedVideo);
    }
  }, [route.params?.recordedVideo, navigation]);

  useEffect(() => () => stopTypingIndicator(), []);

  useLayoutEffect(() => {
    const listRef = flatListRef.current;
    if (!listRef) {
      prevMessageCountRef.current = messages.length;
      return;
    }

    if (!messages.length) {
      prevMessageCountRef.current = 0;
      return;
    }

    const prevCount = prevMessageCountRef.current;
    const isInitialScroll = !initialScrollHandled.current;
    const hasNewMessage = messages.length > prevCount;

    prevMessageCountRef.current = messages.length;

    const shouldAutoScroll = isInitialScroll || (hasNewMessage && isNearBottomRef.current);
    if (!shouldAutoScroll) {
      return;
    }

    try {
      listRef.scrollToEnd?.({ animated: false });
      initialScrollHandled.current = true;
    } catch (scrollError) {
      console.warn('Auto-scroll failed:', scrollError?.message);
    }
  }, [messages]);

  const scrollToBottom = () => {
    flatListRef.current?.scrollToEnd({ animated: true });
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
  };

  const handleScroll = (event) => {
    try {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent || {};
      if (!contentOffset || !layoutMeasurement || !contentSize) {
        return;
      }
      const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      const nearBottom = distanceFromBottom <= SCROLL_THRESHOLD;
      isNearBottomRef.current = nearBottom;
      setShowScrollToBottom(!nearBottom);
    } catch (error) {
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
    }
  };

  const randomGolfPhrase = () => TYPING_PHRASES[Math.floor(Math.random() * TYPING_PHRASES.length)];

  const startTypingIndicator = () => {
    if (typingIntervalRef.current) {
      return;
    }
    setTypingPhrase(randomGolfPhrase());
    typingIntervalRef.current = setInterval(() => {
      setTypingPhrase(randomGolfPhrase());
    }, 3500);
  };

  const stopTypingIndicator = () => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    setTypingPhrase(null);
  };

  const appendMessage = (message, persist = true) => {
    setMessages((prev) => [...prev, message]);
    if (persist) {
      ChatHistoryManager.saveMessage(userId, {
        id: message.id,
        text: message.text,
        sender: message.sender === 'coach' ? 'coach' : 'user',
        timestamp: message.createdAt?.toISOString?.() || new Date().toISOString(),
        messageType: message.type,
        videoThumbnail: message.videoThumbnail,
        videoDuration: message.videoDuration,
      }).catch((err) => console.warn('Failed to persist message', err));
    }
  };

  const handleAuthRequired = async () => {
    Alert.alert('Sign in required', 'Please sign in to continue chatting with your coach.');
    appendMessage(
      createMessage({
        sender: 'coach',
        text: 'Please sign in to continue the conversation.',
        type: 'auth_required',
      }),
      false
    );
  };

  const sendTextMessage = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isSending) {
      return;
    }

    const userMessage = createMessage({ sender: 'user', text: trimmed });
    appendMessage(userMessage);
    setInputText('');
    setIsSending(true);
    startTypingIndicator();

    try {
      const headers = await getAuthHeaders();
      const result = await chatApiService.sendMessage(trimmed, userId, headers);
      stopTypingIndicator();
      const coachMessage = createMessage({
        sender: 'coach',
        text: result.response || 'I had trouble processing that. Please try again.',
        type: result.fallback ? 'fallback' : 'response',
      });
      appendMessage(coachMessage);
    } catch (error) {
      stopTypingIndicator();
      if (error?.message === 'AUTHENTICATION_REQUIRED') {
        await handleAuthRequired();
      } else {
        console.error('Chat send failed:', error);
        appendMessage(
          createMessage({
            sender: 'coach',
            text: "I\'m having trouble connecting right now. Please try again soon.",
            type: 'error',
          }),
          false
        );
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleAttachmentPress = () => {
    Alert.alert('Add swing', 'Choose how to share your swing', [
      { text: 'Camera', onPress: () => navigation.navigate('Camera', { returnTo: 'Chat' }) },
      { text: 'Photo Library', onPress: selectFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const selectFromLibrary = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Photo library access is required to upload swings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsMultipleSelection: false,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) {
        return;
      }
      handleVideoSelected(result.assets[0]);
    } catch (error) {
      console.error('Video selection failed:', error);
      Alert.alert('Error', 'Unable to select that video. Please try another clip.');
    }
  };

  const handleVideoSelected = async (video) => {
    let actualDurationSeconds = 0;

    try {
      // Load the actual video file to get real duration (metadata can be stale)
      console.log('Loading video file to check actual duration...');
      const { sound } = await Audio.Sound.createAsync(
        { uri: video.uri },
        { shouldPlay: false }
      );

      const status = await sound.getStatusAsync();

      if (status.isLoaded && status.durationMillis) {
        actualDurationSeconds = status.durationMillis / 1000;
        console.log(`Actual video duration: ${actualDurationSeconds.toFixed(2)}s`);
      } else {
        // Fallback to metadata
        actualDurationSeconds = video.duration ? video.duration / 1000 : 0;
        console.log(`Using metadata duration: ${actualDurationSeconds.toFixed(2)}s`);
      }

      await sound.unloadAsync(); // Clean up

    } catch (error) {
      console.warn('Could not load video for duration check, using metadata:', error);
      actualDurationSeconds = video.duration ? video.duration / 1000 : 0;
    }

    if (actualDurationSeconds > MAX_VIDEO_LENGTH_SECONDS) {
      Alert.alert(
        'Video Too Long',
        `This video is ${actualDurationSeconds.toFixed(1)} seconds. Please trim it to ${MAX_VIDEO_LENGTH_SECONDS} seconds or less.\n\nHow to trim:\n1. Open your Photos app\n2. Select the video\n3. Tap "Edit"\n4. Use the trim handles to shorten it\n5. Save and return here to upload`,
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      const thumbnail = await VideoThumbnails.getThumbnailAsync(video.uri, {
        time: 1000,
        quality: 0.7,
      });
      setSelectedVideo({ uri: video.uri, duration: actualDurationSeconds });
      setVideoThumbnail(thumbnail.uri);
    } catch (error) {
      console.error('Thumbnail generation failed:', error);
      setSelectedVideo({ uri: video.uri, duration: actualDurationSeconds });
      setVideoThumbnail(null);
    }
  };

  const clearSelectedVideo = () => {
    setSelectedVideo(null);
    setVideoThumbnail(null);
  };

  const sendVideoMessage = async () => {
    if (!selectedVideo) {
      return;
    }
    appendMessage(
      createMessage({
        sender: 'user',
        text: inputText.trim() || undefined,
        type: 'video',
        videoThumbnail,
        videoDuration: selectedVideo.duration,
      })
    );
    setInputText('');
    const videoUri = selectedVideo.uri;
    const videoDuration = selectedVideo.duration;
    clearSelectedVideo();
    await processVideoUpload(videoUri, videoDuration);
  };

  const processVideoUpload = async (videoUri, videoDuration) => {
    setIsProcessingVideo(true);
    setProcessingMessage('Teeing up your swing...');
    startTypingIndicator();

    let headers;
    try {
      headers = await getAuthHeaders();
    } catch (error) {
      setIsProcessingVideo(false);
      stopTypingIndicator();
      if (error?.message === 'AUTHENTICATION_REQUIRED') {
        await handleAuthRequired();
      }
      return;
    }

    try {
      const uploadResult = await videoService.uploadAndAnalyze(
        videoUri,
        videoDuration,
        (progress) => {
          const index = Math.min(UPLOAD_STATUS_MESSAGES.length - 1, Math.floor(progress * UPLOAD_STATUS_MESSAGES.length));
          setProcessingMessage(UPLOAD_STATUS_MESSAGES[index]);
        },
        '',
        userId,
        headers
      );

      const analysisResult = await videoService.waitForAnalysisComplete(
        uploadResult.jobId,
        (progressInfo) => {
          const index = Math.min(UPLOAD_STATUS_MESSAGES.length - 1, Math.floor((progressInfo.progress || 0) * UPLOAD_STATUS_MESSAGES.length));
          setProcessingMessage(UPLOAD_STATUS_MESSAGES[index]);
        },
        60,
        5000,
        headers,
      );

      stopTypingIndicator();
      setIsProcessingVideo(false);
      setProcessingMessage('');

      const aiResponse = analysisResult?.coaching_response || analysisResult?.analysis?.coaching_response;
      if (aiResponse) {
        appendMessage(
          createMessage({
            sender: 'coach',
            text: aiResponse,
            type: 'analysis',
          })
        );
      } else {
        appendMessage(
          createMessage({
            sender: 'coach',
            text: 'Your swing has been processed, but I was unable to retrieve the analysis details. Please try again shortly.',
            type: 'error',
          })
        );
      }
    } catch (error) {
      console.error('Video processing failed:', error);
      stopTypingIndicator();
      setIsProcessingVideo(false);
      setProcessingMessage('');
      appendMessage(
        createMessage({
          sender: 'coach',
          text: 'Sorry, there was an issue analyzing that swing. Please try another upload.',
          type: 'error',
        })
      );
    }
  };

  const handleSend = async () => {
    if (selectedVideo) {
      await sendVideoMessage();
      return;
    }
    await sendTextMessage();
  };

  const renderCoachContent = (text) => (
    <Markdown style={markdownStyles}>{text || ''}</Markdown>
  );

  const renderMessage = ({ item }) => {
    if (item.type === 'status') {
      return (
        <View style={styles.statusMessageRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.statusMessageText}>{item.text}</Text>
        </View>
      );
    }

    if (item.sender === 'user') {
      return (
        <View style={styles.userMessageWrapper}>
          {item.videoThumbnail && (
            <Image source={{ uri: item.videoThumbnail }} style={styles.videoPreview} />
          )}
          {item.text ? (
            <View style={styles.userMessageCard}>
              <Text style={styles.userMessageText}>{item.text}</Text>
            </View>
          ) : null}
          <Text style={styles.timestampText}>{formatTimestamp(item.createdAt)}</Text>
        </View>
      );
    }

    return (
      <View style={styles.coachMessageWrapper}>
        <View style={styles.coachMessageCard}>
          {renderCoachContent(item.text)}
        </View>
        <Text style={styles.timestampText}>{formatTimestamp(item.createdAt)}</Text>
      </View>
    );
  };

  const ListFooterComponent = useMemo(() => (
    <>
      {typingPhrase && (
        <View style={styles.typingIndicator}>
          <ActivityIndicator size="small" color={colors.coachAccent} />
          <Text style={styles.typingText}>{typingPhrase}</Text>
        </View>
      )}
      {isProcessingVideo && processingMessage ? (
        <View style={styles.typingIndicator}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.typingText}>{processingMessage}</Text>
        </View>
      ) : null}
      <View style={{ height: 24 }} />
    </>
  ), [typingPhrase, isProcessingVideo, processingMessage]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Your Coach</Text>
            <Text style={styles.headerSubtitle}>Ask anything about your swing</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.headerButton} onPress={handleAttachmentPress}>
              <Ionicons name="camera" size={22} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerButton} onPress={() => navigation.navigate('SettingsModal')}>
              <Ionicons name="settings-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesListContent}
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={ListFooterComponent}
        />

        {showScrollToBottom && (
          <TouchableOpacity style={styles.scrollToBottomButton} onPress={scrollToBottom}>
            <Ionicons name="chevron-down" size={20} color="#fff" />
          </TouchableOpacity>
        )}

        <View style={styles.inputContainer}>
          {selectedVideo && (
            <View style={styles.videoSelectedRow}>
              {videoThumbnail ? (
                <Image source={{ uri: videoThumbnail }} style={styles.videoSelectedThumb} />
              ) : (
                <View style={[styles.videoSelectedThumb, styles.videoFallback]}>
                  <Ionicons name="videocam" size={20} color="#fff" />
                </View>
              )}
              <View style={styles.videoMeta}>
                <Text style={styles.videoMetaTitle}>Swing clip ready</Text>
                <Text style={styles.videoMetaSubtitle}>{selectedVideo.duration.toFixed(1)}s</Text>
              </View>
              <TouchableOpacity onPress={clearSelectedVideo}>
                <Ionicons name="close-circle" size={22} color={colors.error || '#FF6B6B'} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.composerRow}>
            <TouchableOpacity style={styles.composerButton} onPress={handleAttachmentPress}>
              <Ionicons name="attach" size={20} color={colors.coachAccent} />
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              value={inputText}
              placeholder={selectedVideo ? 'Add a note for your coach...' : 'Ask your coach anything...'}
              placeholderTextColor="#8F9BA8"
              onChangeText={setInputText}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendButton, (!!inputText.trim() || selectedVideo) && styles.sendButtonActive]}
              onPress={handleSend}
              disabled={(!inputText.trim() && !selectedVideo) || isSending}
            >
              {isSending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="arrow-up" size={18} color={(!!inputText.trim() || selectedVideo) ? '#fff' : '#A0AEC0'} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const formatTimestamp = (date) => {
  try {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    return '';
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7FAFC',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1B4332',
  },
  headerSubtitle: {
    color: '#4A5568',
    marginTop: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E6FFFA',
    marginLeft: 10,
  },
  messagesList: {
    flex: 1,
  },
  messagesListContent: {
    paddingHorizontal: 16,
  },
  userMessageWrapper: {
    marginBottom: 18,
    alignSelf: 'flex-end',
    maxWidth: '90%',
  },
  userMessageCard: {
    backgroundColor: '#1B4332',
    padding: 16,
    borderRadius: 16,
  },
  userMessageText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
  },
  coachMessageWrapper: {
    marginBottom: 18,
    alignSelf: 'stretch',
  },
  coachMessageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  timestampText: {
    marginTop: 6,
    fontSize: 12,
    color: '#A0AEC0',
  },
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  typingText: {
    marginLeft: 8,
    color: '#4A5568',
    fontStyle: 'italic',
  },
  statusMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusMessageText: {
    marginLeft: 8,
    color: '#4A5568',
  },
  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 140,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#EDF2F7',
    marginHorizontal: 12,
    color: colors.text,
  },
  composerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E9D8FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonActive: {
    backgroundColor: '#805AD5',
  },
  videoSelectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  videoSelectedThumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    marginRight: 12,
  },
  videoFallback: {
    backgroundColor: '#4A5568',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoMeta: {
    flex: 1,
  },
  videoMetaTitle: {
    fontWeight: '600',
    color: '#2D3748',
  },
  videoMetaSubtitle: {
    color: '#718096',
  },
  videoPreview: {
    width: '100%',
    height: 180,
    borderRadius: 16,
    marginBottom: 8,
  },
  scrollToBottomButton: {
    position: 'absolute',
    right: 24,
    bottom: 140,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
});

export default ChatScreen;









