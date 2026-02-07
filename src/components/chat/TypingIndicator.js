// TypingIndicator.js - Claude Code style spinner + rotating golf-themed text
// Maps to actual pipeline stages. Rotates message variants every ~3.5s within current stage.
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, typography, spacing } from '../../utils/theme';

// Golf-themed phrases for text-only chat (no pipeline stage)
const CHAT_PHRASES = [
  'Reading the green...',
  'Picking the right club...',
  'Visualizing the shot...',
  'Checking the wind...',
  'Fixing divots...',
];

const ROTATE_INTERVAL_MS = 3500;

const TypingIndicator = ({ visible, message, isVideoProcessing = false }) => {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const intervalRef = useRef(null);

  // Rotate chat phrases when no explicit message is provided
  useEffect(() => {
    if (!visible) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Only rotate if we're using default chat phrases (no video pipeline message)
    if (!isVideoProcessing && !message) {
      setPhraseIndex(Math.floor(Math.random() * CHAT_PHRASES.length));
      intervalRef.current = setInterval(() => {
        setPhraseIndex((prev) => (prev + 1) % CHAT_PHRASES.length);
      }, ROTATE_INTERVAL_MS);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible, isVideoProcessing, message]);

  if (!visible) return null;

  const displayText = message || CHAT_PHRASES[phraseIndex];
  const indicatorColor = isVideoProcessing ? colors.primary : colors.coachAccent;

  return (
    <View style={styles.container}>
      <ActivityIndicator size="small" color={indicatorColor} />
      <Text style={styles.text}>{displayText}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  text: {
    marginLeft: spacing.sm,
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
    fontStyle: 'italic',
    flex: 1,
  },
});

export default React.memo(TypingIndicator);
