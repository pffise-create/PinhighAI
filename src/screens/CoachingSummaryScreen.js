import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  SafeAreaView, 
  ScrollView,
  RefreshControl,
  ActivityIndicator 
} from 'react-native';
import { colors, typography, spacing, borderRadius, shadows, globalStyles } from '../utils/theme';
import { useAuth } from '../context/AuthContext';
import CoachingInsightsAggregator from '../services/coachingInsightsAggregator';
import ChatHistoryManager from '../services/chatHistoryManager';

// Import components
import StrengthsCard from '../components/StrengthsCard';
import ImprovementAreasCard from '../components/ImprovementAreasCard';
import RecommendedDrillsCard from '../components/RecommendedDrillsCard';
import ProgressVisualization from '../components/ProgressVisualization';
import NewUserPreview from '../components/NewUserPreview';
import FirstSwingInsights from '../components/FirstSwingInsights';

export default function CoachingSummaryScreen({ navigation }) {
  const { user, isAuthenticated } = useAuth();
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [videoCount, setVideoCount] = useState(0);
  const [firstAnalysisData, setFirstAnalysisData] = useState(null);
  
  const userId = user?.email || 'guest';

  // Enhanced header with coaching context
  const renderHeader = () => (
    <View style={globalStyles.screenHeader}>
      <Text style={globalStyles.screenTitle}>Your Progress</Text>
      <Text style={globalStyles.screenSubtitle}>Coaching insights & achievements</Text>
    </View>
  );

  useEffect(() => {
    loadCoachingInsights();
  }, [userId]);

  const loadCoachingInsights = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      // Get conversation summary to determine video count
      const summary = await ChatHistoryManager.getConversationSummary(userId);
      setVideoCount(summary.analysisCount);

      if (summary.analysisCount === 0) {
        // New user - no insights yet
        setInsights(null);
      } else if (summary.analysisCount === 1) {
        // First analysis - get the analysis data
        const conversation = await ChatHistoryManager.loadConversation(userId);
        const analysisMessage = conversation.messages.find(msg => 
          msg.messageType === 'analysis_result' && msg.analysisData
        );
        
        if (analysisMessage) {
          setFirstAnalysisData(analysisMessage.analysisData);
        }
        
        // Generate basic insights for single analysis
        setInsights(await CoachingInsightsAggregator.generateCoachingSummary(userId));
      } else {
        // Multiple analyses - full insights
        setInsights(await CoachingInsightsAggregator.generateCoachingSummary(userId));
      }

    } catch (error) {
      console.error('Failed to load coaching insights:', error);
      // Show fallback insights
      setInsights(CoachingInsightsAggregator.getFallbackSummary());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    loadCoachingInsights(true);
  };

  const handleStartJourney = () => {
    navigation.navigate('Chat');
  };

  const handleAnalyzeAnother = () => {
    navigation.navigate('Chat');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading your coaching insights...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}

      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* New user experience */}
        {videoCount === 0 && (
          <NewUserPreview onStartJourney={handleStartJourney} />
        )}

        {/* First swing insights */}
        {videoCount === 1 && firstAnalysisData && (
          <FirstSwingInsights 
            analysis={firstAnalysisData}
            encouragement="More videos will unlock detailed progress tracking!"
            onAnalyzeAnother={handleAnalyzeAnother}
          />
        )}

        {/* Full coaching insights for multiple videos */}
        {videoCount > 1 && insights && (
          <>
            {/* Progress Overview */}
            <ProgressVisualization 
              progressData={insights.progressMetrics}
            />

            {/* Strengths */}
            <StrengthsCard 
              strengths={insights.topStrengths}
              onPress={() => console.log('View all strengths')}
            />

            {/* Improvement Areas */}
            <ImprovementAreasCard 
              improvements={insights.topImprovements}
              onPress={() => console.log('View all improvements')}
            />

            {/* Recommended Drills */}
            <RecommendedDrillsCard 
              drills={insights.recommendedDrills}
              onPress={() => console.log('View all drills')}
            />

            {/* Coaching Journey Status */}
            <View style={styles.journeyCard}>
              <Text style={styles.journeyTitle}>Your Coaching Journey</Text>
              <View style={styles.journeyStats}>
                <View style={styles.journeyStat}>
                  <Text style={styles.journeyStatValue}>
                    {insights.sessionData.totalSessions}
                  </Text>
                  <Text style={styles.journeyStatLabel}>Sessions</Text>
                </View>
                <View style={styles.journeyStat}>
                  <Text style={styles.journeyStatValue}>
                    {insights.sessionData.videosAnalyzed}
                  </Text>
                  <Text style={styles.journeyStatLabel}>Videos</Text>
                </View>
                <View style={styles.journeyStat}>
                  <Text style={styles.journeyStatValue}>
                    {insights.sessionData.engagementLevel === 'highly_engaged' ? '🔥' :
                     insights.sessionData.engagementLevel === 'engaged' ? '💪' : '🌱'}
                  </Text>
                  <Text style={styles.journeyStatLabel}>Momentum</Text>
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
  },
  subtitle: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginTop: spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginTop: spacing.base,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  journeyCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginTop: spacing.base,
    ...shadows.base,
  },
  journeyTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.base,
  },
  journeyStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  journeyStat: {
    alignItems: 'center',
  },
  journeyStatValue: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  journeyStatLabel: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
});