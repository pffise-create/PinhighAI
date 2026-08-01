// ComposerBar.test.js - Component tests for chat input area
// Tests: disabled/enabled states, video preview, attachment press
import React from 'react';
import { ActivityIndicator } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import ComposerBar from '../../../src/components/chat/ComposerBar';

jest.mock('@expo/vector-icons', () => {
  const ReactMock = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name, ...props }) =>
      ReactMock.createElement(Text, props, `icon:${name}`),
  };
});

const baseProps = {
  inputText: '',
  onChangeText: jest.fn(),
  onSend: jest.fn(),
  onAttachmentPress: jest.fn(),
  isSending: false,
  selectedVideo: null,
  videoThumbnail: null,
  onClearVideo: jest.fn(),
  inputResetKey: 0,
};

const renderComposer = (overrides = {}) =>
  render(<ComposerBar {...baseProps} {...overrides} />);

const getSendButton = () =>
  screen.queryByLabelText('Send message') || screen.getByLabelText('Send video');

describe('ComposerBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('send button states', () => {
    it('is disabled when input is empty and no video selected', () => {
      renderComposer({ inputText: '   ' });
      expect(getSendButton().props.accessibilityState.disabled).toBe(true);

      fireEvent.press(getSendButton());
      expect(baseProps.onSend).not.toHaveBeenCalled();
    });

    it('is enabled when input has text', () => {
      renderComposer({ inputText: 'How do I fix my slice?' });
      expect(getSendButton().props.accessibilityState.disabled).toBe(false);

      fireEvent.press(getSendButton());
      expect(baseProps.onSend).toHaveBeenCalledTimes(1);
    });

    it('is enabled when video is selected (even without text)', () => {
      renderComposer({
        inputText: '',
        selectedVideo: { uri: 'file://swing.mov', duration: 4.2 },
      });
      const sendButton = screen.getByLabelText('Send video');
      expect(sendButton.props.accessibilityState.disabled).toBe(false);
    });

    it('is disabled while isSending is true', () => {
      renderComposer({ inputText: 'hello coach', isSending: true });
      expect(getSendButton().props.accessibilityState.disabled).toBe(true);

      fireEvent.press(getSendButton());
      expect(baseProps.onSend).not.toHaveBeenCalled();
    });

    it('shows ActivityIndicator while sending', () => {
      renderComposer({ inputText: 'hello coach', isSending: true });
      expect(screen.UNSAFE_getAllByType(ActivityIndicator).length).toBe(1);
      // The arrow-up send glyph is replaced by the spinner
      expect(screen.queryByText('icon:arrow-up')).toBeNull();
    });
  });

  describe('video preview', () => {
    const video = { uri: 'file://swing.mov', duration: 4.5 };

    it('shows video thumbnail when selectedVideo is set', () => {
      renderComposer({
        selectedVideo: video,
        videoThumbnail: 'file://thumb.jpg',
      });
      expect(screen.getByText('Swing clip ready')).toBeOnTheScreen();
      const images = screen.UNSAFE_getAllByType(require('react-native').Image);
      expect(images.some((img) => img.props.source?.uri === 'file://thumb.jpg')).toBe(true);
    });

    it('shows fallback icon when thumbnail is null', () => {
      renderComposer({ selectedVideo: video, videoThumbnail: null });
      expect(screen.getByText('Swing clip ready')).toBeOnTheScreen();
      expect(screen.getByText('icon:videocam')).toBeOnTheScreen();
    });

    it('displays duration in seconds', () => {
      renderComposer({ selectedVideo: video });
      expect(screen.getByText('4.5s')).toBeOnTheScreen();
    });

    it('calls onClearVideo when close button pressed', () => {
      renderComposer({ selectedVideo: video });
      fireEvent.press(screen.getByLabelText('Remove selected video'));
      expect(baseProps.onClearVideo).toHaveBeenCalledTimes(1);
    });
  });

  describe('interactions', () => {
    it('calls onAttachmentPress when camera button pressed', () => {
      renderComposer();
      fireEvent.press(screen.getByLabelText('Attach swing video'));
      expect(baseProps.onAttachmentPress).toHaveBeenCalledTimes(1);
    });

    it('calls onSend when send button pressed', () => {
      renderComposer({ inputText: 'Check my tempo' });
      fireEvent.press(screen.getByLabelText('Send message'));
      expect(baseProps.onSend).toHaveBeenCalledTimes(1);
    });

    it('calls onChangeText as user types', () => {
      renderComposer();
      const input = screen.getByPlaceholderText('Ask your coach anything...');
      fireEvent.changeText(input, 'What club should I use?');
      expect(baseProps.onChangeText).toHaveBeenCalledWith('What club should I use?');
    });

    it('shows contextual placeholder based on video selection', () => {
      renderComposer();
      expect(screen.getByPlaceholderText('Ask your coach anything...')).toBeOnTheScreen();

      screen.rerender(
        <ComposerBar
          {...baseProps}
          selectedVideo={{ uri: 'file://swing.mov', duration: 3.1 }}
        />
      );
      expect(screen.getByPlaceholderText('Add a note for your coach...')).toBeOnTheScreen();
    });
  });

  describe('accessibility', () => {
    const flattenStyle = (style) =>
      require('react-native').StyleSheet.flatten(style);

    it('all touch targets are at least 44px', () => {
      renderComposer({
        inputText: 'hi',
        selectedVideo: { uri: 'file://swing.mov', duration: 2.0 },
      });

      const attach = flattenStyle(screen.getByLabelText('Attach swing video').props.style);
      expect(attach.width).toBeGreaterThanOrEqual(44);
      expect(attach.height).toBeGreaterThanOrEqual(44);

      const send = flattenStyle(screen.getByLabelText('Send video').props.style);
      expect(send.width).toBeGreaterThanOrEqual(44);
      expect(send.height).toBeGreaterThanOrEqual(44);

      // Dismiss button is 30px visual but hitSlop extends the touch target to >= 44px
      const dismiss = screen.getByLabelText('Remove selected video');
      const dismissStyle = flattenStyle(dismiss.props.style);
      const hitSlop = dismiss.props.hitSlop || {};
      expect(dismissStyle.width + (hitSlop.left || 0) + (hitSlop.right || 0)).toBeGreaterThanOrEqual(44);
      expect(dismissStyle.height + (hitSlop.top || 0) + (hitSlop.bottom || 0)).toBeGreaterThanOrEqual(44);
    });

    it('send button has correct accessibilityState.disabled', () => {
      renderComposer({ inputText: '' });
      expect(getSendButton().props.accessibilityState.disabled).toBe(true);

      screen.rerender(<ComposerBar {...baseProps} inputText="hello" />);
      expect(getSendButton().props.accessibilityState.disabled).toBe(false);
    });

    it('all buttons have accessibilityLabel and accessibilityRole', () => {
      renderComposer({
        inputText: 'hi',
        selectedVideo: { uri: 'file://swing.mov', duration: 2.0 },
      });

      ['Attach swing video', 'Send video', 'Remove selected video'].forEach((label) => {
        const button = screen.getByLabelText(label);
        expect(button.props.accessibilityRole).toBe('button');
        expect(button.props.accessibilityLabel).toBe(label);
      });
    });
  });
});
