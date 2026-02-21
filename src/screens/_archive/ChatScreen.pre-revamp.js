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
import Markdown from 'react-native-markdown-display';
import { colors, typography, spacing, borderRadius } from '../utils/theme';

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
    color: colors.primary,
  },
  bullet_list: {
    marginBottom: spacing.xs,
    marginLeft: spacing.sm,
  },
  list_item: {
    marginBottom: spacing.xs,
  },
  ordered_list: {
    marginBottom: spacing.xs,
    marginLeft: spacing.sm,
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
  const [sendProgressMessage, setSendProgressMessage] = useState('');
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoThumbnail, setVideoThumbnail] = useState(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const typingIntervalRef = useRef(null);
  const sendProgressTimeoutRef = useRef(null);
  const flatListRef = useRef(null);
  const prevMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    let isMounted = true;

    const hydrate = async () => {
      try {
        const history = await ChatHistoryManager.loadConversation(userId);
        if (!isMounted) {
          return;
        }
        const normalized = normalizeStoredMessages(history?.messages || []);
        setMessages((prev) => mergeMessageLists(prev, normalized));
      } catch (error) {
        console.warn('Failed to load chat history:', error);
      }
    };

    hydrate();

    return () => {
      isMounted = false;
    };
  }, [userId]);

  useEffect(() => () => stopTypingIndicator(), []);

  // Make "something is happening" obvious while a send is in flight, even if the
  // user is scrolled away from the bottom or the list header/footer is off-screen.
  useEffect(() => {
    if (!isSending) {
      setSendProgressMessage('');
      if (sendProgressTimeoutRef.current) {
        clearTimeout(sendProgressTimeoutRef.current);
        sendProgressTimeoutRef.current = null;
      }
      return;
    }

    setSendProgressMessage('Sending your question...');
    if (sendProgressTimeoutRef.current) {
      clearTimeout(sendProgressTimeoutRef.current);
    }
    sendProgressTimeoutRef.current = setTimeout(() => {
      setSendProgressMessage('Coach is thinking (this can take a few seconds)...');
    }, 2500);

    return () => {
      if (sendProgressTimeoutRef.current) {
        clearTimeout(sendProgressTimeoutRef.current);
        sendProgressTimeoutRef.current = null;
      }
    };
  }, [isSending]);

  // With an inverted FlatList, new messages naturally appear at the visual
  // bottom (offset 0). We only need to nudge the scroll when a new message
  // arrives and the user is already near the bottom.
  useLayoutEffect(() => {
    const hasNewMessage = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (hasNewMessage && isNearBottomRef.current) {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [messages]);

  // In an inverted list, the visual bottom is offset 0.
  const scrollToBottom = () => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
  };

  // In an inverted list, the visual bottom is at contentOffset.y === 0.
  const handleScroll = (event) => {
    try {
      const { contentOffset } = event.nativeEvent || {};
      if (!contentOffset) {
        return;
      }
      const nearBottom = contentOffset.y <= SCROLL_THRESHOLD;
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

    // When the user actively sends, we should always keep them at the latest
    // messages. Otherwise the reply can land off-screen and look like "no response".
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);

    const userMessage = createMessage({ sender: 'user', text: trimmed });
    appendMessage(userMessage);
    setInputText('');
    setIsSending(true);
    startTypingIndicator();
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    });

    try {
      const headers = await getAuthHeaders();
      const result = await chatApiService.sendMessage(trimmed, userId, headers, (message) => {
        if (typeof message === 'string' && message.trim().length > 0) {
          setSendProgressMessage(message);
        }
      });
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

  const handleAttachmentPress = () => selectFromLibrary();

  const selectFromLibrary = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Photo library access is required to upload swings.');
        return;
      }
      // allowsEditing forces UIImagePickerController which has native video trim UI.
      // The returned uri and duration already reflect the trimmed video.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: true,
        videoMaxDuration: MAX_VIDEO_LENGTH_SECONDS,
        quality: 0.8,
        preferredAssetRepresentationMode: 'current',
      });
      if (result.canceled || !result.assets?.length) {
        return;
      }
      const video = result.assets[0];
      const durationSeconds = video.duration ? video.duration / 1000 : 0;

      try {
        const thumbnail = await VideoThumbnails.getThumbnailAsync(video.uri, {
          time: 500,
          quality: 0.7,
        });
        setSelectedVideo({ uri: video.uri, duration: durationSeconds });
        setVideoThumbnail(thumbnail.uri);
      } catch (error) {
        console.error('Thumbnail generation failed:', error);
        setSelectedVideo({ uri: video.uri, duration: durationSeconds });
        setVideoThumbnail(null);
      }
    } catch (error) {
      console.error('Video selection failed:', error);
      Alert.alert('Error', 'Unable to select that video. Please try another clip.');
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
        </View>
      );
    }

    return (
      <View style={styles.coachMessageWrapper}>
        {renderCoachContent(item.text)}
      </View>
    );
  };

  // Inverted FlatList renders index 0 at the visual bottom, so we reverse
  // the chronologically-sorted messages so newest appears first in the array.
  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

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
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => navigation.navigate('SettingsModal')}
              accessibilityLabel="Open settings"
              accessibilityRole="button"
            >
              <Ionicons name="settings-outline" size={22} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <FlatList
          ref={flatListRef}
          data={invertedMessages}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesListContent}
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={ListFooterComponent}
        />

        {showScrollToBottom && (
          <TouchableOpacity
            style={styles.scrollToBottomButton}
            onPress={scrollToBottom}
            accessibilityLabel="Scroll to latest messages"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-down" size={18} color={colors.white} />
          </TouchableOpacity>
        )}

        {(isSending || isProcessingVideo) && (
          <View style={styles.progressBanner} pointerEvents="none">
            <ActivityIndicator
              size="small"
              color={isProcessingVideo ? colors.primary : colors.coachAccent}
            />
            <Text style={styles.progressBannerText} numberOfLines={2}>
              {isProcessingVideo
                ? (processingMessage || 'Processing your swing...')
                : (sendProgressMessage || typingPhrase || 'Sending...')}
            </Text>
          </View>
        )}

        <View style={styles.inputContainer}>
          {selectedVideo && (
            <View style={styles.videoSelectedRow}>
              {videoThumbnail ? (
                <Image source={{ uri: videoThumbnail }} style={styles.videoSelectedThumb} />
              ) : (
                <View style={[styles.videoSelectedThumb, styles.videoFallback]}>
                  <Ionicons name="videocam" size={20} color={colors.white} />
                </View>
              )}
              <View style={styles.videoMeta}>
                <Text style={styles.videoMetaTitle}>Swing clip ready</Text>
                <Text style={styles.videoMetaSubtitle}>{selectedVideo.duration.toFixed(1)}s</Text>
              </View>
              <TouchableOpacity
                onPress={clearSelectedVideo}
                accessibilityLabel="Remove selected video"
                accessibilityRole="button"
              >
                <Ionicons name="close-circle" size={24} color={colors.error} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.composerRow}>
            <TouchableOpacity
              style={styles.composerButton}
              onPress={handleAttachmentPress}
              accessibilityLabel="Attach swing video"
              accessibilityRole="button"
            >
              <Ionicons name="camera" size={22} color={colors.primary} />
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              value={inputText}
              placeholder={selectedVideo ? 'Add a note for your coach...' : 'Ask your coach anything...'}
              placeholderTextColor={colors.textSecondary} // Higher contrast placeholder
              onChangeText={setInputText}
              multiline
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!inputText.trim() && !selectedVideo) ? styles.sendButtonDisabled : styles.sendButtonActive,
              ]}
              onPress={handleSend}
              disabled={(!inputText.trim() && !selectedVideo) || isSending}
              accessibilityLabel={selectedVideo ? "Send video" : "Send message"}
              accessibilityRole="button"
              accessibilityState={{ disabled: (!inputText.trim() && !selectedVideo) || isSending }}
            >
              {isSending ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Ionicons
                  name="arrow-up"
                  size={18}
                  color={colors.white}
                />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.bold,
    letterSpacing: -0.2,
    color: colors.primary, // Theme token: brandForest
  },
  headerSubtitle: {
    fontSize: 15,
    color: colors.textSecondary, // Theme token: textSecondary
    marginTop: spacing.xs,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    width: 42, // Slimmer but still accessible
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle, // Softer outline for contrast
    marginLeft: spacing.sm,
  },
  messagesList: {
    flex: 1,
  },
  messagesListContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  userMessageWrapper: {
    marginBottom: spacing.lg,
    alignSelf: 'flex-end',
    maxWidth: '90%',
  },
  userMessageCard: {
    backgroundColor: colors.primary, // Theme token: brandForest
    padding: spacing.base,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(30,58,42,0.35)',
  },
  userMessageText: {
    color: colors.white,
    fontSize: typography.fontSizes.base,
    lineHeight: typography.lineHeights.normal * typography.fontSizes.base,
  },
  coachMessageWrapper: {
    marginBottom: spacing.lg,
    alignSelf: 'stretch',
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
  },
  timestampText: {
    marginTop: spacing.xs,
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary, // Theme token: textSecondary
    alignSelf: 'flex-end',
  },
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  typingText: {
    marginLeft: spacing.sm,
    color: colors.textLight, // Theme token: textSecondary
    fontStyle: 'italic',
  },
  statusMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  statusMessageText: {
    marginLeft: spacing.sm,
    color: colors.textLight, // Theme token: textSecondary
  },
  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  progressBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  progressBannerText: {
    marginLeft: spacing.sm,
    flex: 1,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 140,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginHorizontal: spacing.md,
    color: colors.text,
    fontSize: typography.fontSizes.base,
  },
  composerButton: {
    width: 44, // Accessibility: minimum touch target
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonActive: {
    backgroundColor: colors.primary,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  videoSelectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  videoSelectedThumb: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.md,
    marginRight: spacing.md,
  },
  videoFallback: {
    backgroundColor: colors.textLight, // Theme token: muted bg
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoMeta: {
    flex: 1,
  },
  videoMetaTitle: {
    fontWeight: typography.fontWeights.semibold,
    fontSize: typography.fontSizes.base,
    color: colors.text, // Theme token: textPrimary
  },
  videoMetaSubtitle: {
    fontSize: typography.fontSizes.sm,
    color: colors.textLight, // Theme token: textSecondary
  },
  videoPreview: {
    width: '100%',
    height: 180,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
  },
  scrollToBottomButton: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing['4xl'],
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary, // Theme token: brandForest
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default ChatScreen;









