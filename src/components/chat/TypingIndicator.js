// TypingIndicator.js - Claude Code style spinner + rotating golf-themed text
// Maps to actual pipeline stages. Rotates message variants every ~3.5s within current stage.
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  const pulse = useRef(new Animated.Value(0.2)).current;

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

  useEffect(() => {
    if (!visible) return undefined;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 550,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.2,
          duration: 550,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [visible, pulse]);

  if (!visible) return null;

  const displayText = message || CHAT_PHRASES[phraseIndex];
  const indicatorColor = isVideoProcessing ? colors.primary : colors.coachAccent;

  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Ionicons name="sparkles" size={13} color={indicatorColor} />
      </View>
      <View style={styles.card}>
        <Text style={styles.text}>{displayText}</Text>
        <View style={styles.dotsRow}>
          <Animated.View style={[styles.dot, { opacity: pulse }]} />
          <Animated.View style={[styles.dot, { opacity: pulse.interpolate({
            inputRange: [0.2, 1],
            outputRange: [0.5, 1],
          }) }]} />
          <Animated.View style={[styles.dot, styles.dotLast, { opacity: pulse }]} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginRight: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 14,
    borderTopLeftRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 150,
  },
  text: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
    fontStyle: 'italic',
  },
  dotsRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    marginRight: spacing.xs,
  },
  dotLast: {
    marginRight: 0,
  },
});

export default React.memo(TypingIndicator);
