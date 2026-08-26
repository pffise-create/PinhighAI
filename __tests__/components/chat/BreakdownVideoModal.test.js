import React from 'react';
import { View, Text } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

import BreakdownVideoModal from '../../../src/components/chat/BreakdownVideoModal';

const listenerMap = new Map();
const mockPlayer = {
  loop: false,
  muted: false,
  currentTime: 0,
  timeUpdateEventInterval: 0,
  play: jest.fn(),
  pause: jest.fn(),
  replay: jest.fn(),
  addListener: jest.fn((eventName, handler) => {
    listenerMap.set(eventName, handler);
    return {
      remove: () => listenerMap.delete(eventName),
    };
  }),
};
let mockHasInitializedPlayer = false;

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, ...props }) => {
    const ReactMock = require('react');
    const { Text: RNText } = require('react-native');
    return ReactMock.createElement(RNText, props, `icon:${name}`);
  },
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }) => children,
}));

jest.mock('@react-native-community/slider', () => {
  const ReactMock = require('react');
  const { View: RNView } = require('react-native');
  return ({ children, ...props }) => ReactMock.createElement(RNView, props, children);
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }) => children,
}));

jest.mock('expo-video', () => ({
  useVideoPlayer: (_source, setup) => {
    if (!mockHasInitializedPlayer) {
      setup?.(mockPlayer);
      mockHasInitializedPlayer = true;
    }
    return mockPlayer;
  },
  VideoView: ({ onFirstFrameRender }) => {
    const ReactMock = require('react');
    const { View: RNView } = require('react-native');
    ReactMock.useEffect(() => {
      onFirstFrameRender?.();
    }, [onFirstFrameRender]);
    return ReactMock.createElement(RNView, { accessibilityLabel: 'Breakdown video surface' });
  },
}));

const breakdown = {
  title: 'Swing Breakdown',
  summary: 'Muted by default. Captions stay on.',
  video_url: 'https://example.com/breakdown.mp4',
  poster_url: 'https://example.com/poster.jpg',
  duration_seconds: 21.6,
  muted_default: true,
  scenes: [
    {
      id: 'scene_1',
      phase: 'setup',
      headline: 'Set the Base',
      caption: 'Your setup looks balanced here.',
      narration: 'Your setup looks balanced here.',
      start_seconds: 0,
      end_seconds: 5.2,
    },
    {
      id: 'scene_2',
      phase: 'transition',
      headline: 'Club Settles',
      caption: 'The club starts to shallow into transition.',
      narration: 'The club starts to shallow into transition.',
      start_seconds: 5.2,
      end_seconds: 10.8,
    },
  ],
};

describe('BreakdownVideoModal', () => {
  beforeEach(() => {
    listenerMap.clear();
    jest.clearAllMocks();
    mockHasInitializedPlayer = false;
    mockPlayer.currentTime = 0;
    mockPlayer.muted = false;
  });

  it('opens on a quiet-first start state and starts muted playback on demand', () => {
    render(
      <BreakdownVideoModal
        visible
        breakdown={breakdown}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText('Watch the key moments first')).toBeOnTheScreen();
    expect(screen.getByText('Starts muted')).toBeOnTheScreen();

    fireEvent.press(screen.getByLabelText('Start narrated swing breakdown'));

    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayer.muted).toBe(true);
  });

  it('lets the user jump chapters from the control deck', () => {
    render(
      <BreakdownVideoModal
        visible
        breakdown={breakdown}
        onClose={jest.fn()}
      />
    );

    fireEvent.press(screen.getByLabelText('Jump to Club Settles'));

    expect(mockPlayer.currentTime).toBe(5.2);
  });

  it('surfaces playback errors and updates the active cue with time events', () => {
    render(
      <BreakdownVideoModal
        visible
        breakdown={breakdown}
        onClose={jest.fn()}
      />
    );

    act(() => {
      listenerMap.get('timeUpdate')?.({ currentTime: 6, bufferedPosition: 9 });
    });
    expect(screen.getByText('The club starts to shallow into transition.')).toBeOnTheScreen();

    act(() => {
      listenerMap.get('statusChange')?.({
        status: 'error',
        error: { message: 'Bad stream' },
      });
    });

    expect(screen.getByText('Playback hit a snag')).toBeOnTheScreen();
    expect(screen.getByText('Bad stream')).toBeOnTheScreen();
  });
});
