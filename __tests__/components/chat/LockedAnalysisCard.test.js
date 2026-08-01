// LockedAnalysisCard.test.js - Teaser paywall card for gated analysis content
// Tests: headline + CTA rendering, onUnlock press, busy-state guarding, null handling
import React from 'react';
import { ActivityIndicator } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

import LockedAnalysisCard from '../../../src/components/chat/LockedAnalysisCard';

jest.mock('@expo/vector-icons', () => {
  const ReactMock = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name, ...props }) =>
      ReactMock.createElement(Text, props, `icon:${name}`),
  };
});

describe('LockedAnalysisCard', () => {
  const lockedAnalysis = {
    headline: 'Your backswing is costing you distance',
    cta_label: 'Unlock full analysis',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders headline and CTA from lockedAnalysis', () => {
    render(<LockedAnalysisCard lockedAnalysis={lockedAnalysis} onUnlock={jest.fn()} />);

    expect(screen.getByText('Your backswing is costing you distance')).toBeOnTheScreen();
    expect(screen.getByText('Unlock full analysis')).toBeOnTheScreen();
    expect(screen.getByLabelText('Locked analysis')).toBeOnTheScreen();
    expect(screen.getByText('icon:lock-closed')).toBeOnTheScreen();
  });

  it('falls back to default headline and CTA label when fields are missing', () => {
    render(<LockedAnalysisCard lockedAnalysis={{}} onUnlock={jest.fn()} />);

    expect(screen.getByText('See the full swing breakdown')).toBeOnTheScreen();
    expect(screen.getByText('Start 7-Day Free Trial')).toBeOnTheScreen();
  });

  it('calls onUnlock when the CTA is pressed', async () => {
    const onUnlock = jest.fn().mockResolvedValue(undefined);
    render(<LockedAnalysisCard lockedAnalysis={lockedAnalysis} onUnlock={onUnlock} />);

    fireEvent.press(screen.getByLabelText('Unlock full analysis'));

    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  });

  it('busy state shows a spinner and blocks repeat presses until onUnlock settles', async () => {
    let resolveUnlock;
    const onUnlock = jest.fn(
      () => new Promise((resolve) => { resolveUnlock = resolve; })
    );
    render(<LockedAnalysisCard lockedAnalysis={lockedAnalysis} onUnlock={onUnlock} />);

    const cta = screen.getByLabelText('Unlock full analysis');
    fireEvent.press(cta);

    // Busy: CTA label replaced by spinner, button disabled
    expect(screen.UNSAFE_getAllByType(ActivityIndicator).length).toBe(1);
    expect(screen.queryByText('Unlock full analysis')).toBeNull();

    // Repeat presses while busy do not re-trigger the unlock flow
    fireEvent.press(cta);
    fireEvent.press(cta);
    expect(onUnlock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUnlock();
    });

    // Busy state clears once the unlock promise settles
    expect(screen.getByText('Unlock full analysis')).toBeOnTheScreen();
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator).length).toBe(0);
  });

  it('renders nothing when lockedAnalysis is null', () => {
    render(<LockedAnalysisCard lockedAnalysis={null} onUnlock={jest.fn()} />);

    expect(screen.toJSON()).toBeNull();
  });
});
