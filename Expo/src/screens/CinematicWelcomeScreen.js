// CinematicWelcomeScreen.js - Premium Golf Coach Onboarding
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Dimensions,
  Animated,
  StatusBar,
} from 'react-native';
import { colors, typography, spacing, borderRadius } from '../utils/theme';

const { width, height } = Dimensions.get('window');

const CinematicWelcomeScreen = ({ navigation }) => {
  // Animation values
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(1));
  const [translateXAnim] = useState(new Animated.Value(0));
  const [overlayFade] = useState(new Animated.Value(0));
  const [contentSlide] = useState(new Animated.Value(50));
  const [messageOpacity] = useState(new Animated.Value(1));

  // Cinematic scenes with inspiring messages
  const inspiringScenes = [
    {
      id: 1,
      message: "Every great round starts with a single swing",
      gradientColors: [colors.primaryLight, colors.primary, colors.accent],
    },
    {
      id: 2, 
      message: "Master the fundamentals, master the game",
      gradientColors: [colors.primary, colors.primaryLight, colors.accent],
    },
    {
      id: 3,
      message: "Transform your swing, transform your scores",
      gradientColors: [colors.accent, colors.primaryLight, colors.primary],
    }
  ];

  useEffect(() => {
    // Initial entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.timing(overlayFade, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
      Animated.timing(contentSlide, {
        toValue: 0,
        duration: 800,
        delay: 500,
        useNativeDriver: true,
      }),
    ]).start();

    // Start cinematic background animation
    startCinematicLoop();

    // Change scenes every 6 seconds
    const sceneInterval = setInterval(() => {
      changeScene();
    }, 6000);

    return () => clearInterval(sceneInterval);
  }, []);

  const startCinematicLoop = () => {
    const animateScene = () => {
      // Ken Burns effect: slow zoom and pan
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 1.15,
          duration: 12000,
          useNativeDriver: true,
        }),
        Animated.timing(translateXAnim, {
          toValue: -30,
          duration: 12000,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Reset for next cycle
        scaleAnim.setValue(1);
        translateXAnim.setValue(0);
        animateScene();
      });
    };

    animateScene();
  };

  const changeScene = () => {
    // Fade out message
    Animated.timing(messageOpacity, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      // Change scene
      setCurrentImageIndex((prev) => (prev + 1) % inspiringScenes.length);
      
      // Fade in new message
      Animated.timing(messageOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    });
  };

  const AnimatedButton = ({ onPress, children, style, textStyle }) => {
    const [buttonScale] = useState(new Animated.Value(1));

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
      <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
        <TouchableOpacity
          style={[styles.button, style]}
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={0.9}
        >
          <Text style={[styles.buttonText, textStyle]}>{children}</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const currentScene = inspiringScenes[currentImageIndex];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primary} />
      
      {/* Cinematic Background with Ken Burns Effect */}
      <Animated.View 
        style={[
          styles.backgroundContainer,
          {
            opacity: fadeAnim,
            transform: [
              { scale: scaleAnim },
              { translateX: translateXAnim }
            ]
          }
        ]}
      >
        {/* Gradient background (simulating video) */}
        <View style={[
          styles.backgroundGradient,
          { backgroundColor: currentScene.gradientColors[1] }
        ]} />
        
        {/* Dark overlay for text readability */}
        <Animated.View 
          style={[
            styles.overlay,
            { opacity: overlayFade }
          ]} 
        />
      </Animated.View>

      {/* Content Overlay */}
      <Animated.View 
        style={[
          styles.contentContainer,
          {
            opacity: overlayFade,
            transform: [{ translateY: contentSlide }]
          }
        ]}
      >
        {/* App Branding */}
        <View style={styles.brandSection}>
          <Text style={styles.logoText}>Golf Coach AI</Text>
          <Text style={styles.tagline}>Where precision meets passion</Text>
        </View>

        {/* Inspirational Message */}
        <View style={styles.messageSection}>
          <Animated.Text 
            style={[
              styles.inspirationalText,
              { opacity: messageOpacity }
            ]}
          >
            {currentScene.message}
          </Animated.Text>
          <Text style={styles.subMessage}>
            Join thousands of golfers improving their game with AI-powered coaching
          </Text>
        </View>

        {/* Authentication Actions */}
        <View style={styles.authSection}>
          <AnimatedButton 
            onPress={() => {
              // Navigate to signup/onboarding
              navigation.navigate('Signup');
            }}
            style={styles.primaryButton}
            textStyle={styles.primaryButtonText}
          >
            Start Your Journey
          </AnimatedButton>

          <AnimatedButton 
            onPress={() => {
              // Navigate to login
              navigation.navigate('Login');
            }}
            style={styles.secondaryButton}
            textStyle={styles.secondaryButtonText}
          >
            I Have an Account
          </AnimatedButton>
        </View>

        {/* Trust Signal */}
        <View style={styles.trustSection}>
          <Text style={styles.trustText}>
            "I dropped 4 strokes in my first month. This actually works."
          </Text>
          <Text style={styles.trustAuthor}>— Michael R., Club Champion</Text>
        </View>

        {/* Scene Indicators */}
        <View style={styles.indicators}>
          {inspiringScenes.map((_, index) => (
            <View
              key={index}
              style={[
                styles.indicator,
                index === currentImageIndex && styles.activeIndicator
              ]}
            />
          ))}
        </View>
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  backgroundContainer: {
    position: 'absolute',
    top: -height * 0.1,
    left: -width * 0.1,
    width: width * 1.2,
    height: height * 1.2,
  },
  backgroundGradient: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['3xl'] * 2,
    paddingBottom: spacing['2xl'],
  },
  
  // Brand Section
  brandSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoText: {
    fontSize: typography.fontSizes['4xl'],
    fontWeight: typography.fontWeights.light,
    color: colors.surface,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  tagline: {
    fontSize: typography.fontSizes.lg,
    color: colors.surface,
    opacity: 0.9,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    fontStyle: 'italic',
  },

  // Message Section
  messageSection: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing['2xl'],
  },
  inspirationalText: {
    fontSize: typography.fontSizes['3xl'],
    fontWeight: typography.fontWeights.light,
    color: colors.surface,
    textAlign: 'center',
    lineHeight: 38,
    marginBottom: spacing.lg,
    fontFamily: typography.fontFamily,
  },
  subMessage: {
    fontSize: typography.fontSizes.lg,
    color: colors.surface,
    opacity: 0.8,
    textAlign: 'center',
    lineHeight: 24,
    fontFamily: typography.fontFamily,
  },

  // Auth Section
  authSection: {
    gap: spacing.lg,
    marginBottom: spacing['2xl'],
  },
  button: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing['2xl'],
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  buttonText: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
  },
  primaryButtonText: {
    color: colors.surface,
  },
  secondaryButtonText: {
    color: colors.surface,
  },

  // Trust Section
  trustSection: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xl,
  },
  trustText: {
    fontSize: typography.fontSizes.lg,
    color: colors.surface,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: spacing.sm,
    fontFamily: typography.fontFamily,
  },
  trustAuthor: {
    fontSize: typography.fontSizes.base,
    color: colors.surface,
    opacity: 0.8,
    fontFamily: typography.fontFamily,
  },

  // Scene Indicators
  indicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  activeIndicator: {
    backgroundColor: colors.accent,
    transform: [{ scale: 1.2 }],
  },
});

export default CinematicWelcomeScreen;