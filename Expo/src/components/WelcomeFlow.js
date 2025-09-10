/**
 * WelcomeFlow - First-time user experience
 * 
 * Provides welcome experience for new users or when coaching
 * data is not available, with clear onboarding flow.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, ScrollView } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../utils/theme';

const WelcomeFlow = ({ navigation }) => {
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(30));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const PrimaryButton = ({ onPress, children, style = {} }) => {
    const [scale] = useState(new Animated.Value(1));

    const handlePressIn = () => {
      Animated.spring(scale, { toValue: 0.98, useNativeDriver: true }).start();
    };

    const handlePressOut = () => {
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
    };

    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <TouchableOpacity
          style={[styles.primaryButton, style]}
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={0.9}
        >
          {children}
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const SecondaryButton = ({ onPress, children, style = {} }) => {
    const [scale] = useState(new Animated.Value(1));

    const handlePressIn = () => {
      Animated.spring(scale, { toValue: 0.98, useNativeDriver: true }).start();
    };

    const handlePressOut = () => {
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
    };

    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <TouchableOpacity
          style={[styles.secondaryButton, style]}
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={0.9}
        >
          {children}
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <ScrollView 
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View 
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }]
          }
        ]}
      >
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <View style={styles.heroContent}>
            <Text style={styles.heroTitle}>
              Master Every{'\n'}Approach
            </Text>
            <Text style={styles.heroSubtitle}>
              AI-powered analysis that identifies root causes,{'\n'}
              not just symptoms. Get precision coaching that{'\n'}
              gets you pin high every time.
            </Text>
          </View>
          
          {/* Visual Element */}
          <View style={styles.visualElement}>
            <View style={styles.swingPath}>
              <View style={[styles.swingDot, styles.dot1]} />
              <View style={[styles.swingDot, styles.dot2]} />
              <View style={[styles.swingDot, styles.dot3]} />
              <View style={[styles.swingDot, styles.dot4]} />
              <View style={[styles.swingDot, styles.dot5]} />
            </View>
            <Text style={styles.visualLabel}>P1-P10 Analysis</Text>
          </View>
        </View>

        {/* Primary Action */}
        <View style={styles.primarySection}>
          <PrimaryButton onPress={() => navigation.navigate('VideoRecord')}>
            <Text style={styles.primaryButtonText}>Analyze Your Swing</Text>
            <Text style={styles.primaryButtonSubtext}>Upload or record a video</Text>
          </PrimaryButton>
        </View>

        {/* Value Props */}
        <View style={styles.valueSection}>
          <View style={styles.valueItem}>
            <View style={styles.valueIcon}>
              <View style={styles.iconCircle}>
                <Text style={styles.iconText}>AI</Text>
              </View>
            </View>
            <View style={styles.valueContent}>
              <Text style={styles.valueTitle}>Root Cause Analysis</Text>
              <Text style={styles.valueDescription}>
                Fix one fundamental, improve three swing flaws
              </Text>
            </View>
          </View>

          <View style={styles.valueItem}>
            <View style={styles.valueIcon}>
              <View style={styles.iconCircle}>
                <Text style={styles.iconText}>P10</Text>
              </View>
            </View>
            <View style={styles.valueContent}>
              <Text style={styles.valueTitle}>Professional Breakdown</Text>
              <Text style={styles.valueDescription}>
                Complete P1-P10 position analysis
              </Text>
            </View>
          </View>

          <View style={styles.valueItem}>
            <View style={styles.valueIcon}>
              <View style={styles.iconCircle}>
                <Text style={styles.iconText}>30s</Text>
              </View>
            </View>
            <View style={styles.valueContent}>
              <Text style={styles.valueTitle}>Instant Coaching</Text>
              <Text style={styles.valueDescription}>
                Get personalized advice in seconds
              </Text>
            </View>
          </View>
        </View>

        {/* Secondary Actions */}
        <View style={styles.secondarySection}>
          <SecondaryButton onPress={() => navigation.navigate('Chat')}>
            <Text style={styles.secondaryButtonText}>Ask Your Coach</Text>
          </SecondaryButton>
        </View>

        {/* Trust Signal */}
        <View style={styles.trustSection}>
          <Text style={styles.trustText}>
            "Pin High transformed my approach shots.{'\n'}
            I'm hitting greens like never before."
          </Text>
          <Text style={styles.trustAuthor}>— Sarah M., 14 handicap</Text>
        </View>
      </Animated.View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },

  scrollContent: {
    flexGrow: 1,
  },

  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  
  // Hero Section
  heroSection: {
    paddingTop: spacing['2xl'],
    paddingBottom: spacing['3xl'],
  },

  heroContent: {
    marginBottom: spacing['2xl'],
  },

  heroTitle: {
    fontSize: typography.fontSizes['4xl'],
    fontWeight: typography.fontWeights.light,
    color: colors.primary,
    lineHeight: 38,
    marginBottom: spacing.lg,
    fontFamily: typography.fontFamily,
  },

  heroSubtitle: {
    fontSize: typography.fontSizes.lg,
    color: colors.textSecondary,
    lineHeight: 26,
    fontFamily: typography.fontFamily,
  },
  
  // Visual Element
  visualElement: {
    alignItems: 'center',
    marginVertical: spacing.xl,
  },

  swingPath: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },

  swingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
  },

  dot1: { backgroundColor: colors.accent, opacity: 0.3 },
  dot2: { backgroundColor: colors.accent, opacity: 0.5 },
  dot3: { backgroundColor: colors.accent, opacity: 0.7 },
  dot4: { backgroundColor: colors.accent, opacity: 0.9 },
  dot5: { backgroundColor: colors.accent, opacity: 1 },

  visualLabel: {
    fontSize: typography.fontSizes.sm,
    color: colors.textLight,
    fontFamily: typography.fontFamily,
  },

  // Primary Section
  primarySection: {
    marginBottom: spacing['3xl'],
  },

  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing['2xl'],
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },

  primaryButtonText: {
    color: colors.background,
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },

  primaryButtonSubtext: {
    color: colors.background,
    fontSize: typography.fontSizes.base,
    opacity: 0.9,
    fontFamily: typography.fontFamily,
  },

  // Value Section
  valueSection: {
    marginBottom: spacing['3xl'],
  },

  valueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },

  valueIcon: {
    marginRight: spacing.lg,
  },

  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.accent,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  iconText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.bold,
    color: colors.accent,
    fontFamily: typography.fontFamily,
  },

  valueContent: {
    flex: 1,
  },

  valueTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    marginBottom: spacing.xs,
    fontFamily: typography.fontFamily,
  },

  valueDescription: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    lineHeight: 22,
    fontFamily: typography.fontFamily,
  },

  // Secondary Section
  secondarySection: {
    marginBottom: spacing['3xl'],
  },

  secondaryButton: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing['2xl'],
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },

  secondaryButtonText: {
    color: colors.primary,
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },

  // Trust Section
  trustSection: {
    backgroundColor: colors.surface,
    padding: spacing.xl,
    borderRadius: borderRadius.xl,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    marginBottom: spacing['2xl'],
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },

  trustText: {
    fontSize: typography.fontSizes.lg,
    color: colors.text,
    fontStyle: 'italic',
    lineHeight: 26,
    marginBottom: spacing.sm,
    fontFamily: typography.fontFamily,
  },

  trustAuthor: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
});

export default WelcomeFlow;