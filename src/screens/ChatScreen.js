// ChatScreen.js - Primary chat interface for Alki DivotLab golf coaching
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
import { useSubscriptions } from '../context/SubscriptionContext';
import ChatHistoryManager from '../services/chatHistoryManager';
import chatApiService from '../services/chatApiService';
import videoService from '../services/videoService';
import {
  createVideoPickerOptions,
  getDurationSecondsFromAsset,
  MAX_VIDEO_LENGTH_SECONDS,
  MIN_VIDEO_LENGTH_SECONDS,
} from '../utils/videoAttachmentFlow';

import ChatHeader from '../components/chat/ChatHeader';
import MessageBubble from '../components/chat/MessageBubble';
import VideoModal from '../components/chat/VideoModal';
import BreakdownVideoModal from '../components/chat/BreakdownVideoModal';
import TypingIndicator from '../components/chat/TypingIndicator';
import ComposerBar from '../components/chat/ComposerBar';

import { colors, spacing } from '../utils/theme';

// ─── Constants ──────────────────────────────────────────────────────────────
const SCROLL_THRESHOLD = 96;
const BREAKDOWN_TARGET_POLL_SECONDS = 24;
const BREAKDOWN_FALLBACK_SUMMARY = 'Muted by default. Captions stay on.';
const CHAT_SUMMARY_MAX_CHARS = 220;

const stripMarkdownForSummary = (text) => (
  typeof text === 'string'
    ? text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/[*_`>#]/g, '')
      .replace(/^\s*[-+]\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
    : ''
);

const summarizeAnalysisForChat = (text) => {
  const clean = stripMarkdownForSummary(text);
  if (!clean) return 'Your swing is ready. The quick coach summary is below.';

  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const joined = (sentences.slice(0, 2).join(' ') || clean).trim();
  const shouldTruncate = joined.length > CHAT_SUMMARY_MAX_CHARS;
  const truncated = shouldTruncate
    ? `${joined.slice(0, CHAT_SUMMARY_MAX_CHARS - 1).trimEnd()}…`
    : joined;
  if (!shouldTruncate && truncated.length < clean.length) {
    return `${truncated.replace(/[.!?]\s*$/, '').trimEnd()}…`;
  }

  return truncated;
};

const seedBreakdownState = (current, status = 'queued', extra = {}) => ({
  ...(current || {}),
  status,
  title: current?.title || 'Swing Breakdown',
  summary: current?.summary || BREAKDOWN_FALLBACK_SUMMARY,
  muted_default: current?.muted_default !== false,
  ...extra,
});

// ─── Message Factory ────────────────────────────────────────────────────────
const createMessage = ({
  id,
  sender,
  text,
  type = 'text',
  createdAt,
  videoUri,
  videoThumbnail,
  videoDuration,
  videoTrimData,
  lockedAnalysis,
  jobId,
  videoBreakdown,
}) => ({
  id: id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  sender,
  text,
  type,
  createdAt: createdAt || new Date(),
  videoUri,
  videoThumbnail,
  videoDuration,
  videoTrimData: videoTrimData || null,
  lockedAnalysis: lockedAnalysis || null,
  jobId: jobId || null,
  videoBreakdown: videoBreakdown || null,
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
        videoUri: msg.videoUri,
        videoThumbnail: msg.videoThumbnail,
        videoDuration: msg.videoDuration,
        videoTrimData: msg.videoTrimData || null,
        lockedAnalysis: msg.lockedAnalysis || null,
        jobId: msg.jobId || null,
        videoBreakdown: msg.videoBreakdown || msg.video_breakdown || null,
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
  const { user, isAuthenticated, getAuthHeaders } = useAuth();
  const { presentPaywall, refreshCustomerInfo, entitlementActive } = useSubscriptions();
  const userId = user?.id;

  // Core state
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoThumbnail, setVideoThumbnail] = useState(null);
  const [inputResetKey, setInputResetKey] = useState(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [playbackVideoUri, setPlaybackVideoUri] = useState(null);
  const [playbackTrimData, setPlaybackTrimData] = useState(null);
  const [playbackBreakdown, setPlaybackBreakdown] = useState(null);

  // Refs
  const flatListRef = useRef(null);
  const messagesRef = useRef([]);
  const prevMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Define persistence callbacks before effects that reference them. Production
  // web bundles preserve const temporal-dead-zone semantics more strictly than
  // the Jest transform, so dependency arrays cannot reference later callbacks.
  const appendMessage = useCallback((message, persist = true) => {
    setMessages((prev) => {
      const nextMessages = [...prev, message];
      messagesRef.current = nextMessages;
      return nextMessages;
    });
    if (persist) {
      ChatHistoryManager.saveMessage(userId, {
        id: message.id,
        text: message.text,
        sender: message.sender,
        timestamp: message.createdAt?.toISOString?.() || new Date().toISOString(),
        messageType: message.type,
        videoUri: message.videoUri,
        videoThumbnail: message.videoThumbnail,
        videoDuration: message.videoDuration,
        videoTrimData: message.videoTrimData || null,
        lockedAnalysis: message.lockedAnalysis || null,
        jobId: message.jobId || null,
        videoBreakdown: message.videoBreakdown || null,
      }).catch((err) => console.warn('Failed to persist message', err));
    }
  }, [userId]);

  const replaceMessage = useCallback((messageId, updater) => {
    const currentMessages = messagesRef.current;
    let nextMessage = null;
    const nextMessages = currentMessages.map((msg) => {
      if (msg.id !== messageId) return msg;
      nextMessage = updater(msg);
      return nextMessage;
    });

    if (!nextMessage) return;

    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    Promise.resolve(ChatHistoryManager.updateMessage(userId, messageId, nextMessage)).catch(
      (err) => console.warn('Failed to update persisted message', err)
    );
  }, [userId]);

  // ─── Load Chat History ──────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return; // No authenticated user yet — skip hydration

    let mounted = true;

    const hydrate = async () => {
      try {
        const history = await ChatHistoryManager.loadConversation(userId);
        if (!mounted) return;
        const normalized = normalizeStoredMessages(history?.messages || []);
        setMessages((prev) => {
          const merged = mergeMessageLists(prev, normalized);
          messagesRef.current = merged;
          return merged;
        });

        // Welcome message: if first-time user, auto-send init to get AI greeting
        if (history?.userProfile?.isFirstTime && normalized.length === 0) {
          await sendWelcome();
        }
      } catch (error) {
        console.warn('Failed to load chat history:', error);
      }
    };

    // Inline welcome sender — references closed-over `mounted` directly (not by value)
    const sendWelcome = async () => {
      setIsSending(true);
      try {
        const headers = await getAuthHeaders();
        const result = await chatApiService.sendMessage(
          'Hello! I just joined Alki DivotLab. Please introduce yourself as my golf coach.',
          userId,
          headers,
        );
        if (!mounted) return;
        appendMessage(
          createMessage({
            sender: 'coach',
            text: result.response || "Welcome to Alki DivotLab! I'm your personal golf coach. Upload a swing video or ask me anything about your game.",
          })
        );
      } catch {
        if (!mounted) return;
        appendMessage(
          createMessage({
            sender: 'coach',
            text: "Welcome to Alki DivotLab! I'm your personal golf coach. Upload a swing video or ask me anything about improving your game.",
          })
        );
      } finally {
        if (mounted) setIsSending(false);
      }
    };

    hydrate();
    return () => { mounted = false; };
  }, [userId, appendMessage, getAuthHeaders]);

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

  const showScrollRef = useRef(false);
  const handleScroll = useCallback((event) => {
    const y = event.nativeEvent?.contentOffset?.y ?? 0;
    const nearBottom = y <= SCROLL_THRESHOLD;
    isNearBottomRef.current = nearBottom;
    const shouldShow = !nearBottom;
    if (shouldShow !== showScrollRef.current) {
      showScrollRef.current = shouldShow;
      setShowScrollToBottom(shouldShow);
    }
  }, []);

  const runBreakdownFlow = useCallback(async (
    messageId,
    jobId,
    currentBreakdown = null,
    {
      shouldRequest = true,
      shouldAlertOnAuth = true,
    } = {},
  ) => {
    if (!messageId || !jobId) return;

    const previousBreakdown = currentBreakdown || null;
    const seededStatus = currentBreakdown?.status === 'processing' ? 'processing' : 'queued';

    replaceMessage(messageId, (current) => ({
      ...current,
      videoBreakdown: seedBreakdownState(
        current.videoBreakdown || previousBreakdown,
        seededStatus
      ),
    }));

    try {
      const headers = await getAuthHeaders();
      const existingReady = currentBreakdown?.status === 'completed' && currentBreakdown?.video_url;
      if (existingReady) {
        return;
      }

      let requestedBreakdown = currentBreakdown || null;

      if (shouldRequest) {
        const requested = await videoService.requestVideoBreakdown(jobId, headers);
        requestedBreakdown = requested.video_breakdown || requestedBreakdown;

        replaceMessage(messageId, (current) => ({
          ...current,
          videoBreakdown: requestedBreakdown || current.videoBreakdown,
        }));

        if (requested.status === 'completed' && requested.video_breakdown?.video_url) {
          return;
        }
      }

      const completed = await videoService.waitForBreakdownComplete(
        jobId,
        null,
        BREAKDOWN_TARGET_POLL_SECONDS,
        1500,
        headers,
      );

      replaceMessage(messageId, (current) => ({
        ...current,
        videoBreakdown: completed,
      }));
    } catch (error) {
      if (error?.message === 'AUTHENTICATION_REQUIRED') {
        if (previousBreakdown) {
          replaceMessage(messageId, (current) => ({
            ...current,
            videoBreakdown: previousBreakdown,
          }));
        } else {
          replaceMessage(messageId, (current) => ({
            ...current,
            videoBreakdown: seedBreakdownState(current.videoBreakdown, 'failed', {
              error_message: 'Sign in again to finish your narrated breakdown.',
            }),
          }));
        }

        if (shouldAlertOnAuth) {
          Alert.alert('Sign in required', 'Please sign in to generate your video breakdown.');
        }
        return;
      }

      console.error('Video breakdown generation failed:', error);
      replaceMessage(messageId, (current) => ({
        ...current,
        videoBreakdown: seedBreakdownState(current.videoBreakdown, 'failed', {
          error_message: 'The breakdown did not finish this time. Try again.',
        }),
      }));
    }
  }, [getAuthHeaders, replaceMessage]);

  // ─── Paywall Unlock Flow ───────────────────────────────────────────────
  // CTA on a locked teaser: present the RevenueCat paywall; on purchase or
  // restore, refetch gated results so teasers become full analyses.
  const handleUnlockRequest = useCallback(async (message) => {
    try {
      const result = await presentPaywall();
      if (!result?.purchasedOrRestored) return;

      if (message.jobId) {
        const headers = await getAuthHeaders();
        const fullResult = await videoService.getAnalysisResults(message.jobId, headers);
        const fullText =
          fullResult?.coaching_response || fullResult?.analysis?.coaching_response;
        if (fullText && !fullResult?.locked) {
          replaceMessage(message.id, (msg) => ({
            ...msg,
            text: fullText,
            type: 'analysis',
            lockedAnalysis: null,
          }));
          return;
        }
      }

      // Chat teasers (no jobId) just drop the CTA; future replies are full.
      replaceMessage(message.id, (msg) => ({ ...msg, lockedAnalysis: null }));
    } catch (error) {
      if (error?.code === 'REVENUECAT_UNAVAILABLE') {
        Alert.alert(
          'Subscriptions unavailable',
          'Purchases need a development or TestFlight build.'
        );
        return;
      }
      console.error('Unlock flow failed:', error);
    }
  }, [presentPaywall, getAuthHeaders, replaceMessage]);

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
    setInputResetKey((key) => key + 1);
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
          lockedAnalysis: result.locked ? result.locked_analysis : null,
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

      const pickerOptions = createVideoPickerOptions({ allowsEditing: true });
      if (Platform.OS === 'ios') {
        // Expo iOS can return the original full-size asset when export preset is passthrough.
        // Force a real export so edited (trimmed) media is materialized to a new file URI.
        // Cap at 1080p: clips can now run to 60s, and a 4K minute-long upload is
        // hundreds of MB on cellular for no analysis benefit (frames render at 720p).
        const exportPreset =
          ImagePicker.VideoExportPreset?.Preset1920x1080 ??
          ImagePicker.VideoExportPreset?.HighestQuality;
        if (exportPreset !== undefined) {
          pickerOptions.videoExportPreset = exportPreset;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      const durationSeconds = getDurationSecondsFromAsset(asset);

      try {
        const thumb = await VideoThumbnails.getThumbnailAsync(asset.uri, {
          time: 500,
          quality: 0.7,
        });
        setSelectedVideo({
          uri: asset.uri,
          duration: durationSeconds,
          trimData: null,
        });
        setVideoThumbnail(thumb.uri);
      } catch {
        setSelectedVideo({
          uri: asset.uri,
          duration: durationSeconds,
          trimData: null,
        });
        setVideoThumbnail(null);
      }
    } catch (error) {
      console.error('Video selection failed:', error);
      Alert.alert('Error', 'Unable to select that video. Please try another clip.');
    }
  }, []);

  const showTooLongVideoAlert = useCallback((durationSeconds) => {
    const displayDuration = Number.isFinite(durationSeconds) ? durationSeconds.toFixed(1) : 'unknown';
    Alert.alert(
      'Clip too long',
      `This clip is ${displayDuration}s. Please keep it under ${MAX_VIDEO_LENGTH_SECONDS}s.`,
      [
        { text: 'Choose Another', onPress: () => handleAttachmentPress() },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, [handleAttachmentPress]);

  const showTooShortVideoAlert = useCallback((durationSeconds) => {
    const displayDuration = Number.isFinite(durationSeconds) ? durationSeconds.toFixed(1) : 'unknown';
    Alert.alert(
      'Clip too short',
      `This clip is ${displayDuration}s. Aim for at least ${MIN_VIDEO_LENGTH_SECONDS}s so your setup and finish are in frame.`,
      [
        { text: 'Choose Another', onPress: () => handleAttachmentPress() },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, [handleAttachmentPress]);
  const clearSelectedVideo = useCallback(() => {
    setSelectedVideo(null);
    setVideoThumbnail(null);
  }, []);

  // ─── Send Video Message ────────────────────────────────────────────────
  const sendVideoMessage = useCallback(async () => {
    if (!selectedVideo) return;
    if (Number.isFinite(selectedVideo.duration) && selectedVideo.duration > 0) {
      if (selectedVideo.duration > MAX_VIDEO_LENGTH_SECONDS) {
        showTooLongVideoAlert(selectedVideo.duration);
        return;
      }
      if (selectedVideo.duration < MIN_VIDEO_LENGTH_SECONDS) {
        showTooShortVideoAlert(selectedVideo.duration);
        return;
      }
    }

    // Capture values before clearing state to avoid stale closure reads
    const videoUri = selectedVideo.uri;
    const videoDuration = selectedVideo.duration;
    const trimData = selectedVideo.trimData || null;

    appendMessage(
      createMessage({
        sender: 'user',
        text: inputText.trim() || undefined,
        type: 'video',
        videoUri,
        videoThumbnail,
        videoDuration,
        videoTrimData: trimData,
      })
    );
    setInputText('');
    setInputResetKey((key) => key + 1);
    clearSelectedVideo();

    // Process upload + analysis pipeline
    setIsProcessingVideo(true);
    setProcessingMessage('Teeing up your swing...');

    try {
      const headers = await getAuthHeaders();

      const uploadResult = await videoService.uploadAndAnalyze(
        videoUri,
        videoDuration,
        (progress) => setProcessingMessage(progress.message),
        userId,
        headers,
        trimData,
      );

      const analysisResult = await videoService.waitForAnalysisComplete(
        uploadResult.jobId,
        (progress) => setProcessingMessage(progress.message),
        80,
        1500,
        headers,
      );

      setIsProcessingVideo(false);
      setProcessingMessage('');

      const aiResponse = analysisResult?.coaching_response || analysisResult?.analysis?.coaching_response;
      const isLocked = Boolean(analysisResult?.locked);
      const seededBreakdown = !isLocked && aiResponse
        ? seedBreakdownState(
          analysisResult?.video_breakdown,
          analysisResult?.video_breakdown?.status === 'processing' ? 'processing' : 'queued'
        )
        : (analysisResult?.video_breakdown || null);
      const coachMessage = createMessage({
        sender: 'coach',
        text: aiResponse
          ? (isLocked ? aiResponse : summarizeAnalysisForChat(aiResponse))
          : 'Your swing has been processed, but I was unable to retrieve the analysis. Please try again.',
        type: aiResponse ? (isLocked ? 'locked_analysis' : 'analysis') : 'error',
        lockedAnalysis: isLocked ? analysisResult.locked_analysis : null,
        jobId: uploadResult.jobId,
        videoBreakdown: seededBreakdown,
      });

      appendMessage(coachMessage);

      if (!isLocked && aiResponse) {
        const breakdownStatus = analysisResult?.video_breakdown?.status || null;
        const shouldRequestBreakdown = !['queued', 'processing', 'completed'].includes(breakdownStatus);

        void runBreakdownFlow(
          coachMessage.id,
          uploadResult.jobId,
          analysisResult?.video_breakdown || null,
          {
            shouldRequest: shouldRequestBreakdown,
            shouldAlertOnAuth: false,
          },
        );
      }
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
  }, [
    selectedVideo,
    showTooLongVideoAlert,
    showTooShortVideoAlert,
    inputText,
    videoThumbnail,
    userId,
    appendMessage,
    clearSelectedVideo,
    getAuthHeaders,
  ]);

  const handleGenerateBreakdown = useCallback(async (message) => {
    if (!message?.jobId) return;
    if (
      message?.videoBreakdown?.status === 'queued' ||
      message?.videoBreakdown?.status === 'processing'
    ) {
      return;
    }
    await runBreakdownFlow(message.id, message.jobId, message.videoBreakdown, {
      shouldRequest: true,
      shouldAlertOnAuth: true,
    });
  }, [runBreakdownFlow]);

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

  const handleVideoPress = useCallback((videoUri, trimData) => {
    if (!videoUri) return;
    setPlaybackVideoUri(videoUri);
    setPlaybackTrimData(trimData || null);
  }, []);

  const handleOpenBreakdown = useCallback((breakdown) => {
    if (!breakdown?.video_url) return;
    setPlaybackBreakdown(breakdown);
  }, []);

  const renderMessage = useCallback(({ item }) => (
    <MessageBubble
      message={item}
      onVideoPress={handleVideoPress}
      onUnlock={entitlementActive ? null : handleUnlockRequest}
      onGenerateBreakdown={handleGenerateBreakdown}
      onOpenBreakdown={handleOpenBreakdown}
    />
  ), [
    handleVideoPress,
    entitlementActive,
    handleUnlockRequest,
    handleGenerateBreakdown,
    handleOpenBreakdown,
  ]);

  const keyExtractor = useCallback((item, index) => item?.id || `message-${index}`, []);

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

  // Auth is required — AppNavigator gates this, but guard against race conditions
  if (!isAuthenticated || !userId) return null;

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
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
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
          inputResetKey={inputResetKey}
        />

        {/* Single video playback modal — shared across all messages */}
        <VideoModal
          visible={!!playbackVideoUri}
          videoUri={playbackVideoUri}
          trimData={playbackTrimData}
          onClose={() => {
            setPlaybackVideoUri(null);
            setPlaybackTrimData(null);
          }}
        />

        <BreakdownVideoModal
          visible={!!playbackBreakdown}
          breakdown={playbackBreakdown}
          onClose={() => setPlaybackBreakdown(null)}
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default ChatScreen;
