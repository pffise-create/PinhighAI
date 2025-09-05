import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, typography, spacing, borderRadius } from '../utils/theme';
import { useAuth } from '../context/AuthContext';
import ConversationContextService from '../services/conversationContext';
import CoachingDashboard from '../components/CoachingDashboard';
import CoachingDashboardSkeleton from '../components/CoachingDashboardSkeleton';
import WelcomeFlow from '../components/WelcomeFlow';

const HomeScreen = ({ navigation }) => {
  const { user, isAuthenticated } = useAuth();
  
  // Coaching data state
  const [coachingOverview, setCoachingOverview] = useState(null);
  const [recentAnalyses, setRecentAnalyses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isOffline, setIsOffline] = useState(false);

  // Cache keys
  const getCacheKey = (suffix) => `homescreen_${user?.id || 'guest'}_${suffix}`;

  // Load cached data
  const loadCachedData = async () => {
    if (!isAuthenticated || !user?.id) return null;
    
    try {
      const [cachedOverview, cachedAnalyses] = await Promise.all([
        AsyncStorage.getItem(getCacheKey('overview')),
        AsyncStorage.getItem(getCacheKey('analyses'))
      ]);

      if (cachedOverview) {
        const overview = JSON.parse(cachedOverview);
        setCoachingOverview(overview);
        console.log('📦 Loaded cached coaching overview');
      }

      if (cachedAnalyses) {
        const analyses = JSON.parse(cachedAnalyses);
        setRecentAnalyses(analyses);
        console.log('📦 Loaded cached recent analyses');
      }

      return cachedOverview ? JSON.parse(cachedOverview) : null;
    } catch (error) {
      console.error('❌ Failed to load cached data:', error);
      return null;
    }
  };

  // Save data to cache
  const saveCachedData = async (overview, analyses) => {
    if (!isAuthenticated || !user?.id) return;
    
    try {
      await Promise.all([
        AsyncStorage.setItem(getCacheKey('overview'), JSON.stringify(overview)),
        AsyncStorage.setItem(getCacheKey('analyses'), JSON.stringify(analyses)),
        AsyncStorage.setItem(getCacheKey('timestamp'), Date.now().toString())
      ]);
      console.log('💾 Cached coaching dashboard data');
    } catch (error) {
      console.error('❌ Failed to cache data:', error);
    }
  };

  // Check if cached data is fresh (less than 5 minutes old)
  const isCachedDataFresh = async () => {
    try {
      const timestamp = await AsyncStorage.getItem(getCacheKey('timestamp'));
      if (!timestamp) return false;
      
      const age = Date.now() - parseInt(timestamp);
      return age < 5 * 60 * 1000; // 5 minutes
    } catch (error) {
      return false;
    }
  };

  // Load coaching data for authenticated users
  useEffect(() => {
    const loadCoachingData = async () => {
      if (!isAuthenticated || !user?.id) {
        // Guest user - show welcome flow
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        setIsOffline(false);
        
        console.log('🏠 Loading coaching dashboard data for:', user.email);
        
        // Load cached data first for immediate display
        const cachedData = await loadCachedData();
        const isFresh = await isCachedDataFresh();
        
        if (cachedData && isFresh) {
          console.log('⚡ Using fresh cached data');
          setLoading(false);
          return;
        }
        
        if (cachedData) {
          console.log('📱 Using cached data while fetching updates');
          setLoading(false); // Show cached data immediately
        }

        // Load coaching context from service
        const context = await ConversationContextService.assembleCoachingContext(user.email);
        
        // Transform context into overview format
        const overview = {
          sessionCount: context.session_metadata?.total_sessions || 0,
          currentFocus: context.coaching_themes?.active_focus_areas?.[0]?.focus || null,
          lastActivity: context.coaching_themes?.last_updated,
          hasActiveConversation: context.recent_conversations?.length > 0,
          progressSummary: {
            improvementAreas: context.coaching_themes?.active_focus_areas?.map(area => area.focus) || [],
            recentMilestones: [] // TODO: Add milestone tracking
          }
        };
        
        // Load recent analyses (mock data for now - would come from API)
        const mockRecentAnalyses = [
          {
            analysisId: 'recent_1',
            date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
            focusArea: context.coaching_themes?.active_focus_areas?.[0]?.focus || 'setup_consistency',
            overallScore: 7.2,
            hasFollowupChat: true,
            keyImprovement: 'Weight shift timing'
          },
          {
            analysisId: 'recent_2', 
            date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
            focusArea: 'impact_position',
            overallScore: 6.8,
            hasFollowupChat: false,
            keyImprovement: 'Hand position at impact'
          }
        ];
        
        // Update state with fresh data
        setCoachingOverview(overview);
        setRecentAnalyses(mockRecentAnalyses);
        
        // Cache the fresh data
        await saveCachedData(overview, mockRecentAnalyses);
        
        console.log('✅ Coaching dashboard data loaded and cached:', overview);
        
      } catch (error) {
        console.error('❌ Failed to load coaching data:', error);
        setError(error.message);
        setIsOffline(true);
        
        // Try to load cached data as fallback
        const cachedData = await loadCachedData();
        if (!cachedData) {
          // Continue with empty state if no cache available
          setCoachingOverview({ sessionCount: 0 });
        }
      } finally {
        setLoading(false);
      }
    };
    
    loadCoachingData();
  }, [isAuthenticated, user?.id]);

  // Navigation to ChatScreen with context
  const handleContinueCoaching = (context) => {
    console.log('🚀 Navigating to coaching chat with context:', !!context);
    
    navigation.navigate('Chat', {
      coachingContext: context,
      initialMessage: context?.sessionCount > 0 
        ? `Let's continue our coaching conversation. How can I help you improve today?`
        : `Welcome to Pin High coaching! I'm here to help you improve your golf game. What would you like to work on?`
    });
  };

  // Handle loading state
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <CoachingDashboardSkeleton />
      </SafeAreaView>
    );
  }

  // Handle error state with fallback
  if (error && !coachingOverview) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>
            {isOffline ? 'You\'re offline' : 'Unable to load coaching data'}
          </Text>
          <Text style={styles.errorSubtext}>
            {isOffline ? 'Some features may be limited' : 'Check your connection and try again'}
          </Text>
          <WelcomeFlow navigation={navigation} />
        </View>
      </SafeAreaView>
    );
  }

  // Show appropriate screen based on user state
  return (
    <SafeAreaView style={styles.container}>
      {/* Offline indicator */}
      {isOffline && coachingOverview && (
        <View style={styles.offlineIndicator}>
          <Text style={styles.offlineText}>📱 Using offline data</Text>
        </View>
      )}
      
      {coachingOverview && coachingOverview.sessionCount > 0 ? (
        <CoachingDashboard 
          overview={coachingOverview}
          recentAnalyses={recentAnalyses}
          navigation={navigation}
          onContinueCoaching={handleContinueCoaching}
          loading={loading}
        />
      ) : (
        <WelcomeFlow navigation={navigation} />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },

  errorText: {
    fontSize: typography.fontSizes.xl,
    color: colors.text,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },

  errorSubtext: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },

  offlineIndicator: {
    backgroundColor: colors.warning,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.base,
    alignItems: 'center',
  },

  offlineText: {
    fontSize: typography.fontSizes.sm,
    color: colors.surface,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
});

export default HomeScreen;