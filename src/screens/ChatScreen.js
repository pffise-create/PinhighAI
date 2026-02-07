// ChatScreen.js - Primary chat interface for PinHigh AI golf coaching
// Claude/ChatGPT-style: borderless coach messages, user bubbles, inverted FlatList.
// Composes: ChatHeader, MessageBubble, TypingIndicator, ComposerBar, VideoPlayer.
import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
} from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { useAuth } from '../context/AuthContext';
import ChatHistoryManager from '../services/chatHistoryManager';
import chatApiService from '../services/chatApiService';
import videoService from '../services/videoService';
import useVideoTrim from '../hooks/useVideoTrim';

import ChatHeader from '../components/chat/ChatHeader';
import MessageBubble from '../components/chat/MessageBubble';
import TypingIndicator from '../components/chat/TypingIndicator';
import ComposerBar from '../components/chat/ComposerBar';

import { colors, spacing } from '../utils/theme';

// ─── Constants ──────────────────────────────────────────────────────────────
const SCROLL_THRESHOLD = 96;

// ─── Message Factory ────────────────────────────────────────────────────────
const createMessage = ({ id, sender, text, type = 'text', createdAt, videoThumbnail, videoDuration }) => ({
  id: id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  sender,
  text,
  type,
  createdAt: createdAt || new Date(),
  videoThumbnail,
  videoDuration,
});

// ─── Storage Helpers ────────────────────────────────────────────────────────
// Normalize stored messages into the app's message shape
const normalizeStoredMessages = (stored = []) =>
  stored
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
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

// Merge two message lists, deduplicating by id
const mergeMessageLists = (current = [], incoming = []) => {
  if (!incoming.length) return current;
  if (!current.length) return incoming;
  const map = new Map();
  [...current, ...incoming].forEach((msg) => {
    if (msg?.id) map.set(msg.id, msg);
  });
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );
};

// ─── ChatScreen Component ───────────────────────────────────────────────────
const ChatScreen = ({ navigation }) => {
  const { user, getAuthHeaders } = useAuth();
  const userId = user.id;

  // Core state
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoThumbnail, setVideoThumbnail] = useState(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // Refs
  const flatListRef = useRef(null);
  const prevMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

  // Video trim hook
  const { trimVideo } = useVideoTrim();

  // ─── Load Chat History ──────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const hydrate = async () => {
      try {
        const history = await ChatHistoryManager.loadConversation(userId);
        if (!mounted) return;
        const normalized = normalizeStoredMessages(history?.messages || []);
        setMessages((prev) => mergeMessageLists(prev, normalized));

        // Welcome message: if first-time user, auto-send init to get AI greeting
        if (history?.userProfile?.isFirstTime && normalized.length === 0) {
          sendWelcomeMessage();
        }
      } catch (error) {
        console.warn('Failed to load chat history:', error);
      }
    };

    hydrate();
    return () => { mounted = false; };
  }, [userId]);

  // ─── Welcome Message Flow ──────────────────────────────────────────────
  // Silently sends an init message to /api/chat to get the AI's greeting.
  const sendWelcomeMessage = async () => {
    setIsSending(true);
    try {
      const headers = await getAuthHeaders();
      const result = await chatApiService.sendMessage(
        'Hello! I just joined PinHigh AI. Please introduce yourself as my golf coach.',
        userId,
        headers,
      );
      const welcomeMsg = createMessage({
        sender: 'coach',
        text: result.response || "Welcome to PinHigh AI! I'm your personal golf coach. Upload a swing video or ask me anything about your game.",
      });
      appendMessage(welcomeMsg);
    } catch {
      // Fallback welcome if API is unreachable
      appendMessage(
        createMessage({
          sender: 'coach',
          text: "Welcome to PinHigh AI! I'm your personal golf coach. Upload a swing video or ask me anything about improving your game.",
        })
      );
    } finally {
      setIsSending(false);
    }
  };

  // ─── Scroll Management (Inverted FlatList) ─────────────────────────────
  // In an inverted list: visual bottom = offset 0
  useLayoutEffect(() => {
    const hasNewMessage = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (hasNewMessage && isNearBottomRef.current) {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
  }, []);

  const handleScroll = useCallback((event) => {
    const y = event.nativeEvent?.contentOffset?.y ?? 0;
    const nearBottom = y <= SCROLL_THRESHOLD;
    isNearBottomRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom);
  }, []);

  // ─── Message Persistence ───────────────────────────────────────────────
  const appendMessage = useCallback((message, persist = true) => {
    setMessages((prev) => [...prev, message]);
    if (persist) {
      ChatHistoryManager.saveMessage(userId, {
        id: message.id,
        text: message.text,
        sender: message.sender,
        timestamp: message.createdAt?.toISOString?.() || new Date().toISOString(),
        messageType: message.type,
        videoThumbnail: message.videoThumbnail,
        videoDuration: message.videoDuration,
      }).catch((err) => console.warn('Failed to persist message', err));
    }
  }, [userId]);

  // ─── Send Text Message ─────────────────────────────────────────────────
  const sendTextMessage = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isSending) return;

    // Keep user at bottom when they actively send
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);

    const userMessage = createMessage({ sender: 'user', text: trimmed });
    appendMessage(userMessage);
    setInputText('');
    setIsSending(true);

    requestAnimationFrame(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    });

    try {
      const headers = await getAuthHeaders();
      const result = await chatApiService.sendMessage(trimmed, userId, headers);
      appendMessage(
        createMessage({
          sender: 'coach',
          text: result.response || 'I had trouble processing that. Please try again.',
        })
      );
    } catch (error) {
      if (error?.message === 'AUTHENTICATION_REQUIRED') {
        Alert.alert('Sign in required', 'Please sign in to continue chatting with your coach.');
      } else {
        console.error('Chat send failed:', error);
        appendMessage(
          createMessage({
            sender: 'coach',
            text: "I'm having trouble connecting right now. Please try again soon.",
            type: 'error',
          }),
          false
        );
      }
    } finally {
      setIsSending(false);
    }
  }, [inputText, isSending, userId, appendMessage, getAuthHeaders]);

  // ─── Video Selection → Trim → Thumbnail ───────────────────────────────
  const handleAttachmentPress = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Photo library access is required to upload swings.');
        return;
      }

      // Pick video without editing (trim happens via react-native-video-trim)
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 0.8,
        preferredAssetRepresentationMode: 'current',
      });

      if (result.canceled || !result.assets?.length) return;
      const video = result.assets[0];

      // Open native trim editor (max 5s enforced by useVideoTrim)
      let trimmedUri;
      try {
        trimmedUri = await trimVideo(video.uri);
      } catch {
        // If trim library not available (Expo Go), fall back to raw video
        trimmedUri = video.uri;
      }

      if (!trimmedUri) return; // User cancelled trim

      // Generate thumbnail from trimmed video
      const durationSeconds = video.duration ? video.duration / 1000 : 0;
      try {
        const thumb = await VideoThumbnails.getThumbnailAsync(trimmedUri, {
          time: 500,
          quality: 0.7,
        });
        setSelectedVideo({ uri: trimmedUri, duration: Math.min(durationSeconds, 5) });
        setVideoThumbnail(thumb.uri);
      } catch {
        setSelectedVideo({ uri: trimmedUri, duration: Math.min(durationSeconds, 5) });
        setVideoThumbnail(null);
      }
    } catch (error) {
      console.error('Video selection failed:', error);
      Alert.alert('Error', 'Unable to select that video. Please try another clip.');
    }
  }, [trimVideo]);

  const clearSelectedVideo = useCallback(() => {
    setSelectedVideo(null);
    setVideoThumbnail(null);
  }, []);

  // ─── Send Video Message ────────────────────────────────────────────────
  const sendVideoMessage = useCallback(async () => {
    if (!selectedVideo) return;

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
    clearSelectedVideo();

    // Process upload + analysis pipeline
    setIsProcessingVideo(true);
    setProcessingMessage('Teeing up your swing...');

    try {
      const headers = await getAuthHeaders();

      const uploadResult = await videoService.uploadAndAnalyze(
        videoUri,
        selectedVideo.duration,
        (progress) => setProcessingMessage(progress.message),
        userId,
        headers,
      );

      const analysisResult = await videoService.waitForAnalysisComplete(
        uploadResult.jobId,
        (progress) => setProcessingMessage(progress.message),
        60,
        5000,
        headers,
      );

      setIsProcessingVideo(false);
      setProcessingMessage('');

      const aiResponse = analysisResult?.coaching_response || analysisResult?.analysis?.coaching_response;
      appendMessage(
        createMessage({
          sender: 'coach',
          text: aiResponse || 'Your swing has been processed, but I was unable to retrieve the analysis. Please try again.',
          type: aiResponse ? 'analysis' : 'error',
        })
      );
    } catch (error) {
      console.error('Video processing failed:', error);
      setIsProcessingVideo(false);
      setProcessingMessage('');

      if (error?.message === 'AUTHENTICATION_REQUIRED') {
        Alert.alert('Sign in required', 'Please sign in to continue.');
      } else {
        appendMessage(
          createMessage({
            sender: 'coach',
            text: 'Sorry, there was an issue analyzing that swing. Please try another upload.',
            type: 'error',
          })
        );
      }
    }
  }, [selectedVideo, inputText, videoThumbnail, userId, appendMessage, clearSelectedVideo, getAuthHeaders]);

  // ─── Unified Send Handler ──────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (selectedVideo) {
      await sendVideoMessage();
    } else {
      await sendTextMessage();
    }
  }, [selectedVideo, sendVideoMessage, sendTextMessage]);

  // ─── Render ────────────────────────────────────────────────────────────
  // Inverted FlatList: newest first in array = visual bottom
  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

  const renderMessage = useCallback(({ item }) => (
    <MessageBubble message={item} />
  ), []);

  const keyExtractor = useCallback((item) => item.id, []);

  // Typing/processing indicator sits in ListHeaderComponent (top of inverted list = visual bottom)
  const ListHeader = useMemo(() => (
    <View style={styles.listHeaderSpacer}>
      <TypingIndicator
        visible={isSending || isProcessingVideo}
        message={isProcessingVideo ? processingMessage : null}
        isVideoProcessing={isProcessingVideo}
      />
    </View>
  ), [isSending, isProcessingVideo, processingMessage]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ChatHeader onSettingsPress={() => navigation.navigate('SettingsModal')} />

        <FlatList
          ref={flatListRef}
          data={invertedMessages}
          inverted
          keyExtractor={keyExtractor}
          renderItem={renderMessage}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={ListHeader}
        />

        {/* Scroll-to-bottom FAB */}
        {showScrollToBottom && (
          <TouchableOpacity
            style={styles.scrollFab}
            onPress={scrollToBottom}
            accessibilityLabel="Scroll to latest messages"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-down" size={18} color={colors.white} />
          </TouchableOpacity>
        )}

        <ComposerBar
          inputText={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          onAttachmentPress={handleAttachmentPress}
          isSending={isSending || isProcessingVideo}
          selectedVideo={selectedVideo}
          videoThumbnail={videoThumbnail}
          onClearVideo={clearSelectedVideo}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  listHeaderSpacer: {
    minHeight: spacing.lg,
  },
  scrollFab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing['4xl'],
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default ChatScreen;
