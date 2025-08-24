// Enhanced HomeScreen.js - Clean Premium Experience
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Animated,
  Easing,
} from 'react-native';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

const HomeScreen = ({ navigation }) => {
  // Animation values
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));
  const [scaleAnim] = useState(new Animated.Value(0.95));

  useEffect(() => {
    // Clean entrance animations
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        easing: Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 60,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Clean button animation component
  const AnimatedButton = ({ style, onPress, children, delay = 0 }) => {
    const [buttonSlide] = useState(new Animated.Value(30));
    const [buttonFade] = useState(new Animated.Value(0));
    const [buttonScale] = useState(new Animated.Value(1));
    
    useEffect(() => {
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(buttonFade, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.spring(buttonSlide, {
            toValue: 0,
            tension: 80,
            friction: 8,
            useNativeDriver: true,
          }),
        ]).start();
      }, delay);
    }, []);

    const handlePressIn = () => {
      Animated.spring(buttonScale, {
        toValue: 0.96,
        tension: 300,
        friction: 10,
        useNativeDriver: true,
      }).start();
    };

    const handlePressOut = () => {
      Animated.spring(buttonScale, {
        toValue: 1,
        tension: 300,
        friction: 10,
        useNativeDriver: true,
      }).start();
    };

    return (
      <Animated.View 
        style={{ 
          opacity: buttonFade,
          transform: [
            { translateY: buttonSlide },
            { scale: buttonScale }
          ] 
        }}
      >
        <TouchableOpacity
          style={style}
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
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Clean header */}
        <Animated.View 
          style={[
            styles.headerSection,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }]
            }
          ]}
        >
          <Text style={styles.title}>Golf Swing Coach</Text>
          <Text style={styles.subtitle}>
            AI-powered analysis for the modern golfer
          </Text>
          
          {/* Simple golf icon */}
          <Animated.View 
            style={[
              styles.iconContainer,
              { transform: [{ scale: scaleAnim }] }
            ]}
          >
            <View style={styles.golfIconBackground}>
              <Text style={styles.golfIcon}>Golf</Text>
            </View>
          </Animated.View>
        </Animated.View>

        {/* Primary action buttons */}
        <View style={styles.buttonContainer}>
          <AnimatedButton 
            style={styles.primaryButton}
            onPress={() => navigation.navigate('VideoRecord')}
            delay={400}
          >
            <Text style={styles.buttonText}>Analyze Swing Video</Text>
          </AnimatedButton>
          
          <AnimatedButton
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('Chat')}
            delay={600}
          >
            <Text style={styles.secondaryButtonText}>Ask Golf Coach</Text>
          </AnimatedButton>
        </View>

        {/* Simple info */}
        <Animated.View 
          style={[
            styles.infoContainer,
            { 
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }] 
            }
          ]}
        >
          <Text style={styles.infoText}>
            Record 30-60 seconds of your swing for detailed analysis
          </Text>
          <Text style={styles.infoText}>
            Get personalized coaching and improvement recommendations
          </Text>
          <Text style={styles.infoText}>
            Ask follow-up questions about your technique
          </Text>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  headerSection: {
    alignItems: 'center',
    marginTop: spacing['3xl'],
  },
  title: {
    fontSize: typography.fontSizes['3xl'],
    fontWeight: typography.fontWeights.light,
    color: colors.primary,
    marginBottom: spacing.sm,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    fontFamily: typography.fontFamily,
    marginBottom: spacing['2xl'],
  },
  iconContainer: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  golfIconBackground: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.lg,
  },
  golfIcon: {
    fontSize: typography.fontSizes['2xl'],
    color: colors.accent,
    fontWeight: typography.fontWeights.light,
    fontFamily: typography.fontFamily,
  },
  buttonContainer: {
    gap: spacing.lg,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing['2xl'],
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    ...shadows.lg,
  },
  buttonText: {
    color: colors.background,
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing['2xl'],
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.accent,
    ...shadows.base,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
  },
  infoContainer: {
    marginTop: spacing['2xl'],
    paddingHorizontal: spacing.lg,
  },
  infoText: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 22,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
});

export default HomeScreen;