// ChatScreen.test.js - Screen-level tests for ChatScreen
// Tests: empty state, history load, send/receive, welcome message, video upload, scroll
import React from 'react';
import { Alert, FlatList } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

let mockAuthValue;
let mockSubscriptionsValue;

jest.mock('@expo/vector-icons', () => {
  const ReactMock = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name, ...props }) =>
      ReactMock.createElement(Text, props, `icon:${name}`),
  };
});

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  VideoExportPreset: { HighestQuality: 1, Passthrough: 0 },
}));

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(),
}));

jest.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

jest.mock('../../src/context/SubscriptionContext', () => ({
  useSubscriptions: () => mockSubscriptionsValue,
}));

jest.mock('../../src/services/chatHistoryManager', () => ({
  __esModule: true,
  default: {
    loadConversation: jest.fn(),
    saveMessage: jest.fn(),
    updateMessage: jest.fn(),
  },
}));

jest.mock('../../src/services/chatApiService', () => ({
  __esModule: true,
  default: {
    sendMessage: jest.fn(),
  },
}));

jest.mock('../../src/services/videoService', () => ({
  __esModule: true,
  default: {
    uploadAndAnalyze: jest.fn(),
    waitForAnalysisComplete: jest.fn(),
    getAnalysisResults: jest.fn(),
    requestVideoBreakdown: jest.fn(),
    waitForBreakdownComplete: jest.fn(),
  },
}));

// VideoModal depends on expo-video native hooks — stub it out at the screen level
jest.mock('../../src/components/chat/VideoModal', () => () => null);
jest.mock('../../src/components/chat/BreakdownVideoModal', () => () => null);

// TypingIndicator runs Animated loops + phrase rotation timers. Stub with a
// deterministic marker so the screen tests assert what ChatScreen passes it.
jest.mock('../../src/components/chat/TypingIndicator', () => {
  const ReactMock = require('react');
  const { Text } = require('react-native');
  return ({ visible, message }) =>
    visible ? ReactMock.createElement(Text, null, message || 'typing-indicator') : null;
});

import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import ChatHistoryManager from '../../src/services/chatHistoryManager';
import chatApiService from '../../src/services/chatApiService';
import videoService from '../../src/services/videoService';
import ChatScreen from '../../src/screens/ChatScreen';

const WELCOME_INIT_MESSAGE =
  'Hello! I just joined Alki DivotLab. Please introduce yourself as my golf coach.';

const emptyHistory = (isFirstTime = false) => ({
  messages: [],
  userProfile: { isFirstTime },
});

const storedMessage = (overrides = {}) => ({
  id: 'stored-1',
  text: 'Welcome back! Ready to work on your swing?',
  sender: 'coach',
  timestamp: '2026-02-18T10:00:00.000Z',
  messageType: 'text',
  ...overrides,
});

const navigation = { navigate: jest.fn() };

const renderChatScreen = () => render(<ChatScreen navigation={navigation} />);

const getComposerInput = () =>
  screen.queryByPlaceholderText('Ask your coach anything...') ||
  screen.getByPlaceholderText('Add a note for your coach...');

const sendText = async (text) => {
  fireEvent.changeText(getComposerInput(), text);
  fireEvent.press(screen.getByLabelText('Send message'));
};

const pickerAsset = (overrides = {}) => ({
  uri: 'file://picked-swing.mov',
  duration: 4200, // milliseconds — ChatScreen converts to seconds
  ...overrides,
});

const selectVideo = async (asset = pickerAsset()) => {
  ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
  ImagePicker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [asset],
  });
  VideoThumbnails.getThumbnailAsync.mockResolvedValue({ uri: 'file://thumb.jpg' });

  fireEvent.press(screen.getByLabelText('Attach swing video'));
  await waitFor(() => expect(screen.getByText('Swing clip ready')).toBeOnTheScreen());
};

describe('ChatScreen', () => {
  let alertSpy;
  let scrollToOffsetSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAuthValue = {
      user: { id: 'user-1', email: 'golfer@example.com' },
      isAuthenticated: true,
      getAuthHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer token' }),
    };
    mockSubscriptionsValue = {
      entitlementActive: false,
      presentPaywall: jest.fn(),
      refreshCustomerInfo: jest.fn(),
    };

    ChatHistoryManager.loadConversation.mockResolvedValue(emptyHistory());
    ChatHistoryManager.saveMessage.mockResolvedValue(undefined);
    chatApiService.sendMessage.mockResolvedValue({ response: 'Solid question — let us dig in.' });

    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    scrollToOffsetSpy = jest
      .spyOn(FlatList.prototype, 'scrollToOffset')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    scrollToOffsetSpy.mockRestore();
  });

  describe('initial render', () => {
    it('renders ChatHeader with settings button', async () => {
      renderChatScreen();

      expect(screen.getByText('Coach')).toBeOnTheScreen();
      const settingsButton = screen.getByLabelText('Open settings');
      fireEvent.press(settingsButton);
      expect(navigation.navigate).toHaveBeenCalledWith('SettingsModal');

      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());
    });

    it('renders ComposerBar with empty input', async () => {
      renderChatScreen();

      const input = screen.getByPlaceholderText('Ask your coach anything...');
      expect(input.props.value).toBe('');
      expect(
        screen.getByLabelText('Send message').props.accessibilityState.disabled
      ).toBe(true);

      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());
    });

    it('renders empty FlatList when no history', async () => {
      renderChatScreen();

      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());
      const list = screen.UNSAFE_getByType(FlatList);
      expect(list.props.data).toHaveLength(0);
      expect(list.props.inverted).toBe(true);
    });
  });

  describe('chat history', () => {
    it('loads and displays persisted messages on mount', async () => {
      ChatHistoryManager.loadConversation.mockResolvedValue({
        messages: [
          storedMessage(),
          storedMessage({
            id: 'stored-2',
            sender: 'user',
            text: 'Yes, my driver is spraying right.',
            timestamp: '2026-02-18T10:01:00.000Z',
          }),
        ],
        userProfile: { isFirstTime: false },
      });

      renderChatScreen();

      expect(
        await screen.findByText('Welcome back! Ready to work on your swing?')
      ).toBeOnTheScreen();
      expect(screen.getByText('Yes, my driver is spraying right.')).toBeOnTheScreen();
      expect(ChatHistoryManager.loadConversation).toHaveBeenCalledWith('user-1');
    });

    it('normalizes stored message format correctly', async () => {
      ChatHistoryManager.loadConversation.mockResolvedValue({
        messages: [
          // Out of order + legacy fields: sorted by timestamp, messageType -> type,
          // unknown senders coerced to 'user'
          storedMessage({
            id: 'newer',
            sender: 'coach',
            text: 'Newer coach note',
            timestamp: '2026-02-18T11:00:00.000Z',
            messageType: 'analysis',
          }),
          storedMessage({
            id: 'older',
            sender: 'someone-else',
            text: 'Older message',
            timestamp: '2026-02-18T09:00:00.000Z',
            messageType: undefined,
          }),
        ],
        userProfile: { isFirstTime: false },
      });

      renderChatScreen();
      await screen.findByText('Newer coach note');

      // Inverted list data: newest first
      const data = screen.UNSAFE_getByType(FlatList).props.data;
      expect(data.map((m) => m.id)).toEqual(['newer', 'older']);

      const newer = data.find((m) => m.id === 'newer');
      expect(newer.type).toBe('analysis');
      expect(newer.sender).toBe('coach');
      expect(newer.createdAt).toBeInstanceOf(Date);

      const older = data.find((m) => m.id === 'older');
      expect(older.sender).toBe('user'); // non-coach senders normalize to user
      expect(older.type).toBe('text'); // missing messageType defaults to text
    });

    it('deduplicates messages by id on merge', async () => {
      ChatHistoryManager.loadConversation.mockResolvedValue({
        messages: [storedMessage(), storedMessage({ id: 'stored-2', text: 'Second message' })],
        userProfile: { isFirstTime: false },
      });

      renderChatScreen();
      await screen.findByText('Second message');
      expect(screen.UNSAFE_getByType(FlatList).props.data).toHaveLength(2);

      // Re-trigger hydration (effect depends on getAuthHeaders identity). The same
      // stored messages come back and must merge by id without duplicating.
      mockAuthValue = {
        ...mockAuthValue,
        getAuthHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer token' }),
      };
      screen.rerender(<ChatScreen navigation={navigation} />);

      await waitFor(() =>
        expect(ChatHistoryManager.loadConversation).toHaveBeenCalledTimes(2)
      );
      await waitFor(() =>
        expect(screen.UNSAFE_getByType(FlatList).props.data).toHaveLength(2)
      );
      expect(screen.getAllByText('Second message')).toHaveLength(1);
    });
  });

  describe('welcome message', () => {
    it('sends init message to API for first-time users', async () => {
      ChatHistoryManager.loadConversation.mockResolvedValue(emptyHistory(true));
      chatApiService.sendMessage.mockResolvedValue({ response: 'Hey, I am your golf coach!' });

      renderChatScreen();

      await waitFor(() =>
        expect(chatApiService.sendMessage).toHaveBeenCalledWith(
          WELCOME_INIT_MESSAGE,
          'user-1',
          { Authorization: 'Bearer token' }
        )
      );
    });

    it('displays AI greeting as first coach bubble', async () => {
      ChatHistoryManager.loadConversation.mockResolvedValue(emptyHistory(true));
      chatApiService.sendMessage.mockResolvedValue({ response: 'Hey, I am your golf coach!' });

      renderChatScreen();

      expect(await screen.findByText('Hey, I am your golf coach!')).toBeOnTheScreen();
      const data = screen.UNSAFE_getByType(FlatList).props.data;
      expect(data).toHaveLength(1);
      expect(data[0].sender).toBe('coach');
    });

    it('shows fallback welcome when API is unreachable', async () => {
      ChatHistoryManager.loadConversation.mockResolvedValue(emptyHistory(true));
      chatApiService.sendMessage.mockRejectedValue(new Error('Network request failed'));

      renderChatScreen();

      // Markdown rendering typographically converts ' to ’, so match loosely
      expect(
        await screen.findByText(
          /Welcome to Alki DivotLab! I.m your personal golf coach\. Upload a swing video or ask me anything about improving your game\./
        )
      ).toBeOnTheScreen();
    });

    it('does not send welcome for returning users', async () => {
      ChatHistoryManager.loadConversation.mockResolvedValue({
        messages: [storedMessage()],
        userProfile: { isFirstTime: false },
      });

      renderChatScreen();
      await screen.findByText('Welcome back! Ready to work on your swing?');

      expect(chatApiService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('text messaging', () => {
    it('appends user message bubble on send', async () => {
      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      await sendText('Why am I topping the ball?');

      expect(await screen.findByText('Why am I topping the ball?')).toBeOnTheScreen();
      const data = screen.UNSAFE_getByType(FlatList).props.data;
      expect(data.some((m) => m.sender === 'user' && m.text === 'Why am I topping the ball?')).toBe(true);
    });

    it('shows typing indicator while waiting for response', async () => {
      let resolveResponse;
      chatApiService.sendMessage.mockImplementation(
        () => new Promise((resolve) => { resolveResponse = resolve; })
      );

      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      await sendText('Working on my grip');

      expect(await screen.findByText('typing-indicator')).toBeOnTheScreen();

      await act(async () => {
        resolveResponse({ response: 'Grip looks fine.' });
      });

      await waitFor(() => expect(screen.queryByText('typing-indicator')).toBeNull());
    });

    it('appends coach response bubble on success', async () => {
      chatApiService.sendMessage.mockResolvedValue({ response: 'Try a neutral grip.' });

      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      await sendText('Working on my grip');

      expect(await screen.findByText('Try a neutral grip.')).toBeOnTheScreen();
      const data = screen.UNSAFE_getByType(FlatList).props.data;
      expect(data.find((m) => m.text === 'Try a neutral grip.').sender).toBe('coach');
    });

    it('shows error message on API failure', async () => {
      chatApiService.sendMessage.mockRejectedValue(new Error('API Error 500: boom'));

      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      await sendText('Hello?');

      // Markdown rendering typographically converts ' to ’, so match loosely
      expect(
        await screen.findByText(/I.m having trouble connecting right now\. Please try again soon\./)
      ).toBeOnTheScreen();
      // Error bubbles are not persisted
      const persistedSenders = ChatHistoryManager.saveMessage.mock.calls.map(
        ([, message]) => message.text
      );
      expect(persistedSenders).not.toContain(
        "I'm having trouble connecting right now. Please try again soon."
      );
    });

    it('shows auth alert on AUTHENTICATION_REQUIRED', async () => {
      chatApiService.sendMessage.mockRejectedValue(new Error('AUTHENTICATION_REQUIRED'));

      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      await sendText('Hello?');

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          'Sign in required',
          'Please sign in to continue chatting with your coach.'
        )
      );
    });

    it('persists messages to ChatHistoryManager', async () => {
      chatApiService.sendMessage.mockResolvedValue({ response: 'Keep your tempo smooth.' });

      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      await sendText('Any tempo drills?');
      await screen.findByText('Keep your tempo smooth.');

      await waitFor(() => expect(ChatHistoryManager.saveMessage).toHaveBeenCalledTimes(2));
      const saved = ChatHistoryManager.saveMessage.mock.calls.map(([userId, message]) => ({
        userId,
        sender: message.sender,
        text: message.text,
      }));
      expect(saved).toEqual([
        { userId: 'user-1', sender: 'user', text: 'Any tempo drills?' },
        { userId: 'user-1', sender: 'coach', text: 'Keep your tempo smooth.' },
      ]);
    });
  });

  describe('video upload', () => {
    it('opens image picker on attachment press', async () => {
      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      await selectVideo();

      expect(ImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
    });

    // Original todo: "opens trim editor after video selection". ChatScreen no longer
    // uses a separate trim library — it opens the picker with the system editor
    // (allowsEditing) and forces a real export preset on iOS so trims materialize.
    it('launches the picker with the system trim editor enabled', async () => {
      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      await selectVideo();

      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaTypes: ['videos'],
          allowsEditing: true,
          videoExportPreset: ImagePicker.VideoExportPreset.HighestQuality,
        })
      );
    });

    // Original todo: "falls back to raw video if trim library unavailable". There is
    // no trim library anymore; the analogous fallback is thumbnail generation failing,
    // which must still attach the selected video (with the fallback icon).
    it('falls back to attaching the video without a thumbnail when thumbnail generation fails', async () => {
      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
      ImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [pickerAsset()],
      });
      VideoThumbnails.getThumbnailAsync.mockRejectedValue(new Error('thumbnail failed'));

      fireEvent.press(screen.getByLabelText('Attach swing video'));

      expect(await screen.findByText('Swing clip ready')).toBeOnTheScreen();
      // Fallback videocam glyph renders instead of a thumbnail image
      expect(screen.getByText('icon:videocam')).toBeOnTheScreen();
      expect(screen.getByLabelText('Send video').props.accessibilityState.disabled).toBe(false);
    });

    it('generates thumbnail from selected video', async () => {
      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      await selectVideo();

      expect(VideoThumbnails.getThumbnailAsync).toHaveBeenCalledWith(
        'file://picked-swing.mov',
        { time: 500, quality: 0.7 }
      );
    });

    it('shows video preview in ComposerBar', async () => {
      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      await selectVideo();

      expect(screen.getByText('Swing clip ready')).toBeOnTheScreen();
      expect(screen.getByText('4.2s')).toBeOnTheScreen(); // 4200ms -> 4.2s
      expect(screen.getByPlaceholderText('Add a note for your coach...')).toBeOnTheScreen();
    });

    it('sends video message and starts processing pipeline', async () => {
      videoService.uploadAndAnalyze.mockResolvedValue({ jobId: 'job-123' });
      videoService.waitForAnalysisComplete.mockResolvedValue({
        status: 'completed',
        coaching_response: 'Great hip turn!',
      });

      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());
      await selectVideo();

      fireEvent.press(screen.getByLabelText('Send video'));

      await waitFor(() =>
        expect(videoService.uploadAndAnalyze).toHaveBeenCalledWith(
          'file://picked-swing.mov',
          4.2,
          expect.any(Function),
          'user-1',
          { Authorization: 'Bearer token' },
          null
        )
      );
      await waitFor(() =>
        expect(videoService.waitForAnalysisComplete).toHaveBeenCalledWith(
          'job-123',
          expect.any(Function),
          80,
          1500,
          { Authorization: 'Bearer token' }
        )
      );
    });

    it('displays processing progress messages', async () => {
      let reportProgress;
      videoService.uploadAndAnalyze.mockImplementation(
        (uri, duration, onProgress) =>
          new Promise(() => {
            reportProgress = onProgress;
          })
      );

      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());
      await selectVideo();

      fireEvent.press(screen.getByLabelText('Send video'));

      // Initial pipeline message
      expect(await screen.findByText('Teeing up your swing...')).toBeOnTheScreen();

      await act(async () => {
        reportProgress({ message: 'Uploading your swing...' });
      });
      expect(await screen.findByText('Uploading your swing...')).toBeOnTheScreen();
    });

    it('appends analysis result as coach message', async () => {
      videoService.uploadAndAnalyze.mockResolvedValue({ jobId: 'job-123' });
      videoService.waitForAnalysisComplete.mockResolvedValue({
        status: 'completed',
        coaching_response: 'Great hip turn! Work on your wrist hinge next.',
      });

      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());
      await selectVideo();

      fireEvent.press(screen.getByLabelText('Send video'));

      expect(
        await screen.findByText('Great hip turn! Work on your wrist hinge next.')
      ).toBeOnTheScreen();
      const data = screen.UNSAFE_getByType(FlatList).props.data;
      const analysis = data.find((m) => m.text.includes('Great hip turn!'));
      expect(analysis.sender).toBe('coach');
      expect(analysis.type).toBe('analysis');
    });
  });

  describe('video breakdown', () => {
    const storedAnalysisMessage = () =>
      storedMessage({
        id: 'analysis-msg-1',
        text: 'Keep your chest moving through impact.',
        messageType: 'analysis',
        jobId: 'job-123',
      });

    it('requests, polls, and persists a completed narrated breakdown', async () => {
      ChatHistoryManager.loadConversation.mockResolvedValue({
        messages: [storedAnalysisMessage()],
        userProfile: { isFirstTime: false },
      });
      videoService.requestVideoBreakdown.mockResolvedValue({
        status: 'processing',
        video_breakdown: {
          status: 'processing',
          title: 'Swing Breakdown',
          summary: 'Muted by default. Captions stay on.',
          muted_default: true,
        },
      });
      videoService.waitForBreakdownComplete.mockResolvedValue({
        status: 'completed',
        title: 'Swing Breakdown',
        summary: 'Muted by default. Captions stay on.',
        video_url: 'https://example.com/breakdown.mp4',
        poster_url: 'https://example.com/poster.jpg',
        duration_seconds: 22.1,
        muted_default: true,
        scenes: [],
      });

      renderChatScreen();

      fireEvent.press(await screen.findByLabelText('Generate Breakdown'));

      await waitFor(() =>
        expect(videoService.requestVideoBreakdown).toHaveBeenCalledWith(
          'job-123',
          { Authorization: 'Bearer token' }
        )
      );
      await waitFor(() =>
        expect(videoService.waitForBreakdownComplete).toHaveBeenCalledWith(
          'job-123',
          null,
          24,
          1500,
          { Authorization: 'Bearer token' }
        )
      );
      expect(await screen.findByText('Muted by default')).toBeOnTheScreen();
      await waitFor(() =>
        expect(ChatHistoryManager.updateMessage).toHaveBeenLastCalledWith(
          'user-1',
          'analysis-msg-1',
          expect.objectContaining({
            videoBreakdown: expect.objectContaining({
              status: 'completed',
              video_url: 'https://example.com/breakdown.mp4',
            }),
          })
        )
      );
    });

    it('restores the idle breakdown card when auth fails during generation', async () => {
      ChatHistoryManager.loadConversation.mockResolvedValue({
        messages: [storedAnalysisMessage()],
        userProfile: { isFirstTime: false },
      });
      videoService.requestVideoBreakdown.mockRejectedValue(new Error('AUTHENTICATION_REQUIRED'));

      renderChatScreen();

      fireEvent.press(await screen.findByLabelText('Generate Breakdown'));

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          'Sign in required',
          'Please sign in to generate your video breakdown.'
        )
      );
      await waitFor(() =>
        expect(screen.getByLabelText('Generate Breakdown')).toBeOnTheScreen()
      );
      expect(videoService.waitForBreakdownComplete).not.toHaveBeenCalled();
    });
  });

  describe('scroll behavior', () => {
    const scrollEvent = (y) => ({
      nativeEvent: {
        contentOffset: { x: 0, y },
        contentSize: { width: 375, height: 2000 },
        layoutMeasurement: { width: 375, height: 700 },
      },
    });

    it('auto-scrolls to bottom on new messages when near bottom', async () => {
      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      scrollToOffsetSpy.mockClear();
      await sendText('Scroll me down');
      await screen.findByText('Scroll me down');

      await waitFor(() =>
        expect(scrollToOffsetSpy).toHaveBeenCalledWith({ offset: 0, animated: false })
      );
    });

    it('shows scroll-to-bottom FAB when scrolled up', async () => {
      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      expect(screen.queryByLabelText('Scroll to latest messages')).toBeNull();

      const list = screen.UNSAFE_getByType(FlatList);
      fireEvent.scroll(list, scrollEvent(400)); // beyond the 96px threshold

      expect(screen.getByLabelText('Scroll to latest messages')).toBeOnTheScreen();

      // Scrolling back near the bottom hides it again
      fireEvent.scroll(list, scrollEvent(0));
      expect(screen.queryByLabelText('Scroll to latest messages')).toBeNull();
    });

    it('scrolls to bottom when FAB pressed', async () => {
      renderChatScreen();
      await waitFor(() => expect(ChatHistoryManager.loadConversation).toHaveBeenCalled());

      fireEvent.scroll(screen.UNSAFE_getByType(FlatList), scrollEvent(400));
      scrollToOffsetSpy.mockClear();

      fireEvent.press(screen.getByLabelText('Scroll to latest messages'));

      expect(scrollToOffsetSpy).toHaveBeenCalledWith({ offset: 0, animated: true });
      expect(screen.queryByLabelText('Scroll to latest messages')).toBeNull();
    });
  });
});
