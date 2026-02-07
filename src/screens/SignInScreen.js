import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { colors, typography, spacing, borderRadius, shadows, radius } from '../utils/theme';

WebBrowser.maybeCompleteAuthSession();

const { height, width } = Dimensions.get('window');

const inspirationalHeadlines = [
  'Tour-level coaching. On your schedule.',
  'Instant video feedback. Powered by AI.',
  'Fix the root cause. Not just the miss.',
  'Tour insights. Built for real golfers.',
  'Built by golfers obsessed with improvement.',
];

const backgroundImages = [
  require('../../assets/photoes/AdobeStock_129880508.jpeg'),
  require('../../assets/photoes/AdobeStock_35052199.jpeg'),
  require('../../assets/photoes/AdobeStock_383710061.jpeg'),
  require('../../assets/photoes/AdobeStock_60009105.jpeg'),
  require('../../assets/photoes/AdobeStock_624175698.jpeg'),
  require('../../assets/photoes/AdobeStock_676798439.jpeg'),
];

const SignInScreen = ({ navigation }) => {
  const [isLoading, setIsLoading] = useState(false);
  const { isAuthenticated, isLoading: authLoading, checkAuthState } = useAuth();
  const [headlineIndex, setHeadlineIndex] = useState(0);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [nextImageIndex, setNextImageIndex] = useState(1);
  const [imagesPreloaded, setImagesPreloaded] = useState(false);

  const currentOpacity = useRef(new Animated.Value(1)).current;
  const nextOpacity = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;

  // Preload all images on mount
  useEffect(() => {
    const preloadImages = async () => {
      try {
        await Promise.all(
          backgroundImages.map((image) =>
            Image.prefetch(Image.resolveAssetSource(image).uri)
          )
        );
        setImagesPreloaded(true);
      } catch (error) {
        console.log('Image preload error:', error);
        setImagesPreloaded(true); // Continue anyway
      }
    };
    preloadImages();
  }, []);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigation.replace('Chat');
    }
  }, [authLoading, isAuthenticated, navigation]);

  useEffect(() => {
    const headlineTimer = setInterval(() => {
      setHeadlineIndex((prev) => (prev + 1) % inspirationalHeadlines.length);
    }, 5000);

    return () => clearInterval(headlineTimer);
  }, []);

  // Smooth Ken Burns effect animation
  useEffect(() => {
    if (!imagesPreloaded) return;

    const kenBurnsAnimation = () => {
      // Subtle, slow zoom and pan
      const randomScale = 1.05 + Math.random() * 0.08; // 1.05 to 1.13 scale (more subtle)
      const randomX = (Math.random() - 0.5) * 20; // -10 to 10 translation (less movement)
      const randomY = (Math.random() - 0.5) * 20;

      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: randomScale,
          duration: 12000, // Slower, more relaxed (12 seconds)
          useNativeDriver: true,
        }),
        Animated.timing(translateXAnim, {
          toValue: randomX,
          duration: 12000,
          useNativeDriver: true,
        }),
        Animated.timing(translateYAnim, {
          toValue: randomY,
          duration: 12000,
          useNativeDriver: true,
        }),
      ]).start();
    };

    kenBurnsAnimation();

    // Change image every 10 seconds (more relaxed pace)
    const imageTimer = setInterval(() => {
      setCurrentImageIndex((prevIndex) => {
        const nextIndex = (prevIndex + 1) % backgroundImages.length;
        setNextImageIndex((nextIndex + 1) % backgroundImages.length);

        // Smooth crossfade (1.5 seconds for relaxed feel)
        Animated.parallel([
          Animated.timing(currentOpacity, {
            toValue: 0,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(nextOpacity, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
        ]).start(() => {
          // Reset opacities
          currentOpacity.setValue(1);
          nextOpacity.setValue(0);

          // Reset transforms for new image
          scaleAnim.setValue(1);
          translateXAnim.setValue(0);
          translateYAnim.setValue(0);

          // Start Ken Burns for new image
          kenBurnsAnimation();
        });

        return nextIndex;
      });
    }, 10000);

    return () => clearInterval(imageTimer);
  }, [imagesPreloaded, currentOpacity, nextOpacity, scaleAnim, translateXAnim, translateYAnim]);

  const exchangeCodeForTokens = async (authorizationCode) => {
    try {
      const cognitoDomain = 'golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com';
      const clientId = '2ngu9n6gdcbab01r89qbjh88ns';
      const redirectUri = 'golfcoach://';

      const tokenResponse = await fetch(`https://${cognitoDomain}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: [
          'grant_type=authorization_code',
          `client_id=${clientId}`,
          `code=${authorizationCode}`,
          `redirect_uri=${encodeURIComponent(redirectUri)}`,
        ].join('&'),
      });

      const tokens = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error('Token exchange failed:', tokens);
        throw new Error(tokens.error_description || 'Failed to get authentication tokens');
      }

      await AsyncStorage.setItem(
        'amplify-signin-tokens',
        JSON.stringify({
          accessToken: tokens.access_token,
          idToken: tokens.id_token,
          refreshToken: tokens.refresh_token,
          tokenType: tokens.token_type,
          expiresIn: tokens.expires_in,
        })
      );

      await checkAuthState();
      navigation.replace('Chat');
    } catch (error) {
      console.error('Token exchange error:', error);
      throw new Error('Failed to complete sign-in. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);

      const cognitoDomain = 'golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com';
      const clientId = '2ngu9n6gdcbab01r89qbjh88ns';
      const redirectUri = 'golfcoach://';

      const oauthUrl =
        `https://${cognitoDomain}/oauth2/authorize?` +
        `identity_provider=Google&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `client_id=${clientId}&` +
        `scope=openid+email+profile&` +
        `state=golf-coach-oauth`;

      const result = await WebBrowser.openAuthSessionAsync(oauthUrl, redirectUri);

      if (result.type === 'success' && result.url) {
        const urlObject = new URL(result.url);
        const error = urlObject.searchParams.get('error');
        const code = urlObject.searchParams.get('code');

        if (error) {
          throw new Error(error);
        }

        if (code) {
          await exchangeCodeForTokens(code);
        }
      } else if (result.type === 'cancel') {
        Alert.alert('Sign-In Cancelled', 'Google sign-in was cancelled.');
      } else {
        Alert.alert('Sign-In Failed', 'Unable to complete Google sign-in.');
      }
    } catch (error) {
      console.error('Google Sign-In error:', error);
      Alert.alert('Sign-In Error', error.message || 'Unable to sign in with Google.');
      setIsLoading(false);
    }
  };

  if (authLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.textInverse} />
        <Text style={styles.loadingText}>Checking your profile…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <View style={styles.backgroundLayer}>
        {/* Current Image */}
        <Animated.Image
          source={backgroundImages[currentImageIndex]}
          style={[
            styles.backgroundImage,
            {
              opacity: currentOpacity,
              transform: [
                { scale: scaleAnim },
                { translateX: translateXAnim },
                { translateY: translateYAnim },
              ],
            },
          ]}
          resizeMode="cover"
        />

        {/* Next Image (for smooth crossfade) */}
        <Animated.Image
          source={backgroundImages[nextImageIndex]}
          style={[
            styles.backgroundImage,
            {
              opacity: nextOpacity,
            },
          ]}
          resizeMode="cover"
        />

        <LinearGradient
          colors={['rgba(0,0,0,0.65)', 'rgba(0,0,0,0.8)']}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.branding}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoEmoji}>✨</Text>
            </View>
            <Text style={styles.appTitle}>PinHigh AI</Text>
          </View>

          <View style={styles.headlineContainer}>
            <Text style={styles.headline}>{inspirationalHeadlines[headlineIndex]}</Text>
          </View>

          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
              onPress={handleGoogleSignIn}
              activeOpacity={0.85}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <>
                  <View style={styles.googleIcon}>
                    <Text style={styles.googleIconText}>G</Text>
                  </View>
                  <Text style={styles.primaryButtonLabel}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.badge}>
              <Text style={styles.badgeText}>Precision Golf Coaching</Text>
            </View>
          </View>

          <Text style={styles.legal}>
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.brandForest,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  backgroundImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: width,
    height: height,
  },
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 80,
    minHeight: height,
  },
  branding: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(201, 166, 84, 0.3)',
    borderWidth: 1,
    borderColor: 'rgba(201, 166, 84, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoEmoji: {
    fontSize: 24,
  },
  appTitle: {
    color: colors.textInverse,
    fontSize: 24,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  headlineContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 32,
    minHeight: 52,
    justifyContent: 'center',
  },
  headline: {
    color: colors.textInverse,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 340,
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 20,
    padding: 32,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    maxWidth: 380,
    width: '100%',
    alignSelf: 'center',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.brandFern,
    ...shadows.sm,
  },
  primaryButtonLabel: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  googleIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconText: {
    color: colors.brandForest,
    fontWeight: '700',
    fontSize: 14,
  },
  badge: {
    marginTop: 24,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(201, 166, 84, 0.2)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(201, 166, 84, 0.4)',
  },
  badgeText: {
    color: colors.brandGold,
    fontSize: 14,
    fontWeight: '600',
  },
  legal: {
    marginTop: 24,
    paddingHorizontal: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.brandForest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: colors.textInverse,
    fontSize: 16,
  },
});

export default SignInScreen;




