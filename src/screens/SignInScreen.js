// Cinematic Sign In Screen for Golf Coach App
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  Animated,
  Dimensions,
  StatusBar,
} from 'react-native';
import { Video } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuth } from '../context/AuthContext';
import { colors } from '../utils/theme';

const { width, height } = Dimensions.get('window');

// Inspirational messages that rotate with videos
const inspirationalMessages = [
  "Every great approach starts with precision",
  "Master your distance, master the green", 
  "Transform your accuracy, land it pin high"
];

// Cinematic golf video backgrounds with debugging
const videoSources = [
  require('../../assets/videos/golf-background-1.mp4'),
  require('../../assets/videos/golf-background-2.mp4'),
  require('../../assets/videos/golf-background-3.mp4'),
];

// Debug video sources
console.log('Video sources loaded:', videoSources.map((source, index) => ({
  index,
  source: typeof source === 'object' ? 'bundled' : source
})));

const SignInScreen = ({ navigation }) => {
  const [isLoading, setIsLoading] = useState(false);
  const { isAuthenticated, isLoading: authLoading, checkAuthState } = useAuth();
  
  // Simplified video state
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [currentMessage, setCurrentMessage] = useState(0);
  
  // Animation references
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideUpAnim = useRef(new Animated.Value(30)).current;
  const messageOpacity = useRef(new Animated.Value(1)).current;

  // Auto-navigate to Main if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigation.replace('Main');
    }
  }, [isAuthenticated, authLoading, navigation]);

  // Initialize entrance animations
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.timing(slideUpAnim, {
        toValue: 0,
        duration: 800,
        delay: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Videos already have cinematic movement - no additional effects needed

  // Super simple video cycling - no complex animations
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('Switching from video', currentVideoIndex + 1, 'to video', ((currentVideoIndex + 1) % videoSources.length) + 1);
      
      // Just update the indices - let React handle the rest
      setCurrentVideoIndex((prev) => (prev + 1) % videoSources.length);
      setCurrentMessage((prev) => (prev + 1) % inspirationalMessages.length);
    }, 15000); // 15 seconds per video for testing

    return () => clearInterval(interval);
  }, []);

  const exchangeCodeForTokens = async (authorizationCode) => {
    try {
      console.log('Exchanging authorization code for tokens...');
      
      const cognitoDomain = 'golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com';
      const clientId = '2ngu9n6gdcbab01r89qbjh88ns';
      const redirectUri = 'golfcoach://';
      
      // Exchange code for tokens using Cognito token endpoint
      const tokenResponse = await fetch(`https://${cognitoDomain}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `grant_type=authorization_code&client_id=${clientId}&code=${authorizationCode}&redirect_uri=${encodeURIComponent(redirectUri)}`
      });
      
      const tokens = await tokenResponse.json();
      console.log('Token exchange response:', tokens);
      
      if (tokens.access_token) {
        console.log('Successfully received tokens');
        // TODO: Store tokens and update auth state
        Alert.alert('Success', 'Google Sign-In completed successfully!');
        
        // Refresh auth state to pick up the new tokens
        await checkAuthState();
        
        // Navigate to main app
        navigation.replace('Main');
      } else {
        console.error('Token exchange failed:', tokens);
        Alert.alert('Error', 'Failed to complete sign-in. Please try again.');
      }
      
    } catch (error) {
      console.error('Token exchange error:', error);
      Alert.alert('Error', 'Failed to complete sign-in. Please try again.');
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      console.log('Starting Google Sign-In...');

      // For now, let's use a simple OAuth URL approach
      // This will open the Cognito hosted UI in the browser
      const cognitoDomain = 'golf-coach-auth-1755756500.auth.us-east-1.amazoncognito.com';
      const clientId = '2ngu9n6gdcbab01r89qbjh88ns';
      const redirectUri = 'golfcoach://';
      
      const oauthUrl = `https://${cognitoDomain}/oauth2/authorize?identity_provider=Google&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&client_id=${clientId}&scope=openid+email+profile`;
      
      console.log('Opening OAuth URL:', oauthUrl);
      
      // Open OAuth URL in WebBrowser
      const result = await WebBrowser.openAuthSessionAsync(oauthUrl, redirectUri);
      
      console.log('WebBrowser result:', result);
      
      if (result.type === 'success' && result.url) {
        // Extract authorization code from the callback URL
        const url = new URL(result.url);
        const code = url.searchParams.get('code');
        
        if (code) {
          console.log('Authorization code received:', code);
          
          // Exchange authorization code for tokens
          await exchangeCodeForTokens(code);
        }
      } else if (result.type === 'cancel') {
        console.log('User cancelled the OAuth flow');
      }
      
    } catch (error) {
      console.error('Google Sign-In error:', error);
      
      let errorMessage = 'Failed to sign in with Google. Please try again.';
      
      Alert.alert('Sign In Error', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinueAsGuest = () => {
    // Navigate to the main app without authentication
    // This maintains backward compatibility
    navigation.replace('Main');
  };

  // Show loading screen while checking authentication
  if (authLoading) {
    return (
      <View style={styles.cinematicContainer}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        
        {/* Background Gradient */}
        <LinearGradient
          colors={['#1B4332', '#2D5940', '#40916C']}
          style={StyleSheet.absoluteFillObject}
        />
        
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingText}>Pin High</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.cinematicContainer}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* Ultra Simple Video Background */}
      <View style={styles.videoBackground}>
        {/* Always-visible background gradient */}
        <LinearGradient
          colors={['#1B4332', '#2D5940', '#40916C']}
          style={StyleSheet.absoluteFillObject}
        />
        
        <Video
          key={`video-${currentVideoIndex}-${Date.now()}`} // Force fresh mount every time
          source={videoSources[currentVideoIndex]}
          style={styles.backgroundVideo}
          shouldPlay={true}
          isLooping={true} // Simple looping
          isMuted={true}
          resizeMode="cover"
          useNativeControls={false}
          onError={(error) => {
            console.error('Video error for index', currentVideoIndex, ':', error);
          }}
          onLoadStart={() => {
            console.log('Loading video index:', currentVideoIndex, 'file:', currentVideoIndex + 1);
          }}
          onLoad={(status) => {
            console.log('Video loaded index:', currentVideoIndex, 'duration:', status.durationMillis);
          }}
        />
      </View>

      {/* Enhanced Dark Overlay for Better Contrast */}
      <LinearGradient
        colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.9)']}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {/* Main Content */}
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideUpAnim }]
          }
        ]}
      >
        {/* Inspirational Message */}
        <View style={styles.messageContainer}>
          <Text style={styles.inspirationalMessage}>
            {inspirationalMessages[currentMessage]}
          </Text>
        </View>

        {/* App Title with Reduced Blur */}
        <View style={styles.titleContainer}>
          <BlurView intensity={12} style={styles.titleBlur}>
            <Text style={styles.cinematicTitle}>Pin High</Text>
          </BlurView>
        </View>

        {/* Authentication Card with Reduced Blur */}
        <View style={styles.authCard}>
          <BlurView intensity={15} style={styles.authCardBlur}>
            <View style={styles.authCardContent}>
              
              {/* Google Sign In Button */}
              <TouchableOpacity
                style={[styles.cinematicGoogleButton, isLoading && styles.buttonDisabled]}
                onPress={handleGoogleSignIn}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <View style={styles.googleIcon}>
                      <Text style={styles.googleIconText}>G</Text>
                    </View>
                    <Text style={styles.cinematicGoogleButtonText}>Continue with Google</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Divider */}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Guest Button */}
              <TouchableOpacity
                style={styles.cinematicGuestButton}
                onPress={handleContinueAsGuest}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                <Text style={styles.cinematicGuestButtonText}>Continue as Guest</Text>
              </TouchableOpacity>
              
            </View>
          </BlurView>
        </View>

        {/* Premium Badge */}
        <View style={styles.premiumBadge}>
          <Text style={styles.premiumBadgeText}>Precision Golf Coaching</Text>
        </View>

      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Main container
  cinematicContainer: {
    flex: 1,
    backgroundColor: '#000',
  },

  // Video background
  videoBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },

  backgroundVideo: {
    width: width,
    height: height,
    position: 'absolute',
    top: 0,
    left: 0,
  },

  // Main content container
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingTop: StatusBar.currentHeight || 44,
    zIndex: 3,
  },

  // Inspirational message
  messageContainer: {
    position: 'absolute',
    top: 120,
    left: 30,
    right: 30,
    alignItems: 'center',
  },

  inspirationalMessage: {
    fontSize: 18,
    fontWeight: '400',
    color: '#fff',
    textAlign: 'center',
    fontStyle: 'italic',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    lineHeight: 24,
  },

  // Title with glassmorphism
  titleContainer: {
    marginBottom: 60,
    borderRadius: 20,
    overflow: 'hidden',
  },

  titleBlur: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },

  cinematicTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },

  // Authentication card with glassmorphism
  authCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },

  authCardBlur: {
    backgroundColor: 'rgba(255,255,255,0.2)', // Slightly more opaque with darker overlay
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)', // More visible border
    borderRadius: 24,
  },

  authCardContent: {
    padding: 32,
    alignItems: 'center',
  },

  // Cinematic Google button
  cinematicGoogleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingVertical: 18,
    paddingHorizontal: 32,
    borderRadius: 16,
    width: '100%',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
  },

  cinematicGoogleButtonText: {
    color: '#333',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 12,
  },

  googleIcon: {
    width: 24,
    height: 24,
    backgroundColor: '#4285f4',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },

  googleIconText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },

  // Divider
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
    width: '100%',
  },

  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },

  dividerText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 16,
    fontWeight: '500',
    marginHorizontal: 16,
  },

  // Cinematic guest button
  cinematicGuestButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    width: '100%',
    alignItems: 'center',
  },

  cinematicGuestButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // Premium badge
  premiumBadge: {
    marginTop: 40,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: 'rgba(184,134,11,0.2)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(184,134,11,0.4)',
  },

  premiumBadgeText: {
    color: '#B8860B',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },

  // Button states
  buttonDisabled: {
    opacity: 0.6,
  },

  // Loading screen
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },

  loadingText: {
    marginTop: 20,
    fontSize: 24,
    fontWeight: '600',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

export default SignInScreen;