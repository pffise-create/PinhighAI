// MessageBubble.test.js - Component tests for chat message rendering
// Coach messages: avatar + surfaced markdown card (left-aligned, full-width row).
// User messages: brandForest (colors.primary) bubble, right-aligned, max 85% width.
// Video messages show a tappable VideoPlayer thumbnail.
// Locked coach messages render the LockedAnalysisCard teaser when onUnlock is provided.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import MessageBubble from '../../../src/components/chat/MessageBubble';
import { colors } from '../../../src/utils/theme';

jest.mock('@expo/vector-icons', () => {
  const ReactMock = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name, ...props }) =>
      ReactMock.createElement(Text, props, `icon:${name}`),
  };
});

const coachMessage = (overrides = {}) => ({
  id: 'coach-1',
  sender: 'coach',
  text: 'Nice tempo on that swing.',
  type: 'text',
  createdAt: new Date('2026-02-18T10:30:00Z'),
  ...overrides,
});

const userMessage = (overrides = {}) => ({
  id: 'user-1',
  sender: 'user',
  text: 'How was my follow-through?',
  type: 'text',
  createdAt: new Date('2026-02-18T10:29:00Z'),
  ...overrides,
});

describe('MessageBubble', () => {
  describe('coach messages', () => {
    // NOTE: original todo said "borderless markdown (no bubble background)".
    // The component has since moved to a surfaced assistant card with an avatar,
    // so we assert the current design: markdown inside a surface-colored card
    // that never uses the user's brandForest bubble color.
    it('renders markdown in a surfaced coach card, not a user-style bubble', () => {
      render(<MessageBubble message={coachMessage()} />);

      expect(screen.getByText('Nice tempo on that swing.')).toBeOnTheScreen();
      expect(screen.getByLabelText('Coach')).toBeOnTheScreen(); // avatar
      expect(screen.getByText('icon:sparkles')).toBeOnTheScreen();

      // No element in the coach tree uses the dark user-bubble background
      const tree = screen.toJSON();
      const collectBackgrounds = (node, acc = []) => {
        if (!node || typeof node !== 'object') return acc;
        const style = StyleSheet.flatten(node.props?.style) || {};
        if (style.backgroundColor) acc.push(style.backgroundColor);
        (node.children || []).forEach((child) => collectBackgrounds(child, acc));
        return acc;
      };
      expect(collectBackgrounds(tree)).not.toContain(colors.primary);
    });

    it('renders full-width left-aligned row', () => {
      render(<MessageBubble message={coachMessage()} />);

      const row = screen.toJSON();
      const rowStyle = StyleSheet.flatten(row.props.style);
      expect(rowStyle.width).toBe('100%');
      expect(rowStyle.flexDirection).toBe('row');
      expect(rowStyle.alignItems).toBe('flex-start');
      // Coach content is never right-aligned like the user bubble
      expect(rowStyle.alignItems).not.toBe('flex-end');
    });

    it('handles markdown formatting (bold, lists, headings)', () => {
      const markdown = [
        '# Swing Review',
        'Your **tempo** looks great.',
        '- Keep your head still',
        '- Rotate through impact',
      ].join('\n');
      render(<MessageBubble message={coachMessage({ text: markdown })} />);

      // Markdown is parsed: heading and list text render, markers are stripped
      expect(screen.getByText('Swing Review')).toBeOnTheScreen();
      expect(screen.getByText('tempo')).toBeOnTheScreen();
      expect(screen.getByText('Keep your head still')).toBeOnTheScreen();
      expect(screen.getByText('Rotate through impact')).toBeOnTheScreen();
      expect(screen.queryByText(/\*\*tempo\*\*/)).toBeNull();
      expect(screen.queryByText('# Swing Review')).toBeNull();
    });

    it('renders empty string gracefully', () => {
      expect(() =>
        render(<MessageBubble message={coachMessage({ text: '' })} />)
      ).not.toThrow();
      // Still renders the coach row scaffolding without crashing
      expect(screen.getByLabelText('Coach')).toBeOnTheScreen();
    });

    it('renders LockedAnalysisCard for a locked coach message when onUnlock is provided', () => {
      const onUnlock = jest.fn();
      const message = coachMessage({
        lockedAnalysis: { headline: 'Unlock your full breakdown', cta_label: 'Start Free Trial' },
      });
      render(<MessageBubble message={message} onUnlock={onUnlock} />);

      expect(screen.getByLabelText('Locked analysis')).toBeOnTheScreen();
      expect(screen.getByText('Unlock your full breakdown')).toBeOnTheScreen();

      fireEvent.press(screen.getByLabelText('Start Free Trial'));
      expect(onUnlock).toHaveBeenCalledWith(message);
    });

    it('does not render LockedAnalysisCard without onUnlock (entitled user)', () => {
      const message = coachMessage({
        lockedAnalysis: { headline: 'Unlock your full breakdown' },
      });
      render(<MessageBubble message={message} onUnlock={null} />);

      expect(screen.queryByLabelText('Locked analysis')).toBeNull();
      expect(screen.queryByText('Unlock your full breakdown')).toBeNull();
    });
  });

  describe('user messages', () => {
    const findByBackground = (node, color) => {
      if (!node || typeof node !== 'object') return null;
      const style = StyleSheet.flatten(node.props?.style) || {};
      if (style.backgroundColor === color) return node;
      for (const child of node.children || []) {
        const match = findByBackground(child, color);
        if (match) return match;
      }
      return null;
    };

    it('renders with brandForest background bubble', () => {
      render(<MessageBubble message={userMessage()} />);

      expect(screen.getByText('How was my follow-through?')).toBeOnTheScreen();
      const bubble = findByBackground(screen.toJSON(), colors.primary);
      expect(bubble).toBeTruthy();
    });

    it('renders right-aligned with max 85% width', () => {
      render(<MessageBubble message={userMessage()} />);

      const row = screen.toJSON();
      const rowStyle = StyleSheet.flatten(row.props.style);
      expect(rowStyle.alignItems).toBe('flex-end');

      const content = row.children[0];
      const contentStyle = StyleSheet.flatten(content.props.style);
      expect(contentStyle.width).toBe('85%');
    });

    it('renders white text on dark bubble', () => {
      render(<MessageBubble message={userMessage()} />);

      const text = screen.getByText('How was my follow-through?');
      const textStyle = StyleSheet.flatten(text.props.style);
      expect(textStyle.color).toBe(colors.white);
    });

    it('renders text-only message without video thumbnail', () => {
      render(<MessageBubble message={userMessage()} />);

      expect(screen.queryByLabelText(/Play swing video/)).toBeNull();
    });
  });

  describe('video messages', () => {
    const videoMessage = (overrides = {}) =>
      userMessage({
        id: 'video-1',
        type: 'video',
        videoUri: 'file://swing.mov',
        videoThumbnail: 'file://thumb.jpg',
        videoDuration: 4.2,
        videoTrimData: { startTimeMs: 0, endTimeMs: 4200, durationMs: 4200 },
        ...overrides,
      });

    it('renders VideoPlayer thumbnail when videoThumbnail exists', () => {
      render(<MessageBubble message={videoMessage({ text: undefined })} />);

      const player = screen.getByLabelText('Play swing video, 4.2 seconds');
      expect(player).toBeOnTheScreen();
      const images = screen.UNSAFE_getAllByType(require('react-native').Image);
      expect(images.some((img) => img.props.source?.uri === 'file://thumb.jpg')).toBe(true);
    });

    it('renders text below video thumbnail when both present', () => {
      render(<MessageBubble message={videoMessage({ text: 'Check this one' })} />);

      expect(screen.getByLabelText('Play swing video, 4.2 seconds')).toBeOnTheScreen();
      expect(screen.getByText('Check this one')).toBeOnTheScreen();
    });

    it('calls onVideoPress when thumbnail tapped', () => {
      const onVideoPress = jest.fn();
      const message = videoMessage();
      render(<MessageBubble message={message} onVideoPress={onVideoPress} />);

      fireEvent.press(screen.getByLabelText('Play swing video, 4.2 seconds'));
      expect(onVideoPress).toHaveBeenCalledWith(message.videoUri, message.videoTrimData);
    });
  });
});
