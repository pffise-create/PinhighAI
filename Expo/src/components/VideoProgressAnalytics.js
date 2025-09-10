import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';
import VideoMetadataHelpers from '../utils/videoMetadataHelpers';
import VideoVaultManager from '../services/videoVaultManager';

const { width } = Dimensions.get('window');

export default function VideoProgressAnalytics({ 
  videos, 
  userId,
  onVideoSelect = () => {},
  showDetailedAnalysis = true 
}) {
  const [progressData, setProgressData] = useState(null);
  const [selectedMetric, setSelectedMetric] = useState('overall');
  const [timeRange, setTimeRange] = useState('all'); // 'week', 'month', '3months', 'all'

  useEffect(() => {
    if (videos && videos.length >= 2) {
      generateProgressAnalytics();
    }
  }, [videos, timeRange]);

  const generateProgressAnalytics = async () => {
    try {
      const filteredVideos = filterVideosByTimeRange(videos, timeRange);
      
      if (filteredVideos.length < 2) {
        setProgressData(null);
        return;
      }

      const sortedVideos = VideoMetadataHelpers.sortVideosByDate(filteredVideos, true);
      const stats = VideoMetadataHelpers.getVideoStats(filteredVideos);
      
      // Generate detailed progress analysis
      const progressAnalysis = {
        overall: calculateOverallProgress(sortedVideos),
        categories: analyzeCategoryProgress(sortedVideos),
        timeline: generateProgressTimeline(sortedVideos),
        milestones: identifyMilestones(sortedVideos),
        streaks: calculateStreaks(sortedVideos),
        improvement: analyzeImprovementAreas(sortedVideos),
        consistency: analyzeConsistency(sortedVideos),
        recommendations: generateRecommendations(sortedVideos)
      };

      setProgressData({
        ...progressAnalysis,
        stats,
        totalVideos: filteredVideos.length,
        timespan: VideoMetadataHelpers.calculateTimespan(
          sortedVideos[0].uploadDate,
          sortedVideos[sortedVideos.length - 1].uploadDate
        )
      });
    } catch (error) {
      console.error('Failed to generate progress analytics:', error);
      setProgressData(null);
    }
  };

  const filterVideosByTimeRange = (videos, range) => {
    if (range === 'all') return videos;
    
    const now = new Date();
    const cutoffDate = new Date();
    
    switch (range) {
      case 'week':
        cutoffDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        cutoffDate.setMonth(now.getMonth() - 1);
        break;
      case '3months':
        cutoffDate.setMonth(now.getMonth() - 3);
        break;
      default:
        return videos;
    }
    
    return videos.filter(video => new Date(video.uploadDate) >= cutoffDate);
  };

  const calculateOverallProgress = (sortedVideos) => {
    const firstScore = sortedVideos[0].analysisData?.overallScore || 0;
    const latestScore = sortedVideos[sortedVideos.length - 1].analysisData?.overallScore || 0;
    const improvement = latestScore - firstScore;
    
    const trend = improvement > 0.3 ? 'improving' : 
                 improvement < -0.3 ? 'declining' : 'stable';
    
    return {
      firstScore,
      latestScore,
      improvement,
      trend,
      improvementPercentage: firstScore > 0 ? ((improvement / firstScore) * 100) : 0
    };
  };

  const analyzeCategoryProgress = (sortedVideos) => {
    const categories = {
      'Setup': [],
      'Backswing': [],
      'Impact': [],
      'Follow Through': [],
      'Balance': [],
      'Tempo': []
    };
    
    // This would ideally parse more detailed swing analysis data
    // For now, we'll simulate category scoring based on overall trends
    sortedVideos.forEach(video => {
      const score = video.analysisData?.overallScore || 0;
      const variation = (Math.random() - 0.5) * 2; // Add some realistic variation
      
      Object.keys(categories).forEach(category => {
        categories[category].push(Math.max(0, Math.min(10, score + variation)));
      });
    });
    
    return Object.entries(categories).map(([name, scores]) => {
      const improvement = scores[scores.length - 1] - scores[0];
      const trend = improvement > 0.2 ? 'improving' : 
                   improvement < -0.2 ? 'declining' : 'stable';
      
      return {
        name,
        currentScore: scores[scores.length - 1],
        improvement,
        trend,
        scores
      };
    });
  };

  const generateProgressTimeline = (sortedVideos) => {
    return sortedVideos.map((video, index) => ({
      date: video.uploadDate,
      score: video.analysisData?.overallScore || 0,
      video,
      index,
      daysSinceStart: index === 0 ? 0 : 
        Math.floor((new Date(video.uploadDate) - new Date(sortedVideos[0].uploadDate)) / (1000 * 60 * 60 * 24))
    }));
  };

  const identifyMilestones = (sortedVideos) => {
    const milestones = [];
    let personalBest = 0;
    
    sortedVideos.forEach((video, index) => {
      const score = video.analysisData?.overallScore || 0;
      
      if (score > personalBest) {
        personalBest = score;
        milestones.push({
          type: 'personal_best',
          score,
          video,
          index,
          achieved: true,
          description: `New personal best: ${score.toFixed(1)}`
        });
      }
      
      // Add threshold milestones
      const thresholds = [6, 7, 8, 9];
      thresholds.forEach(threshold => {
        if (score >= threshold && !milestones.some(m => m.type === 'threshold' && m.threshold === threshold)) {
          milestones.push({
            type: 'threshold',
            threshold,
            score,
            video,
            index,
            achieved: true,
            description: `Reached ${threshold}+ score`
          });
        }
      });
    });
    
    return milestones.sort((a, b) => b.score - a.score);
  };

  const calculateStreaks = (sortedVideos) => {
    let currentStreak = 0;
    let longestStreak = 0;
    let previousScore = 0;
    
    sortedVideos.forEach(video => {
      const score = video.analysisData?.overallScore || 0;
      
      if (score >= previousScore) {
        currentStreak++;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
      
      previousScore = score;
    });
    
    return {
      current: currentStreak,
      longest: longestStreak,
      isImproving: currentStreak > 0
    };
  };

  const analyzeImprovementAreas = (sortedVideos) => {
    const allImprovements = {};
    
    sortedVideos.forEach((video, index) => {
      const improvements = video.analysisData?.improvements || [];
      improvements.forEach(improvement => {
        if (!allImprovements[improvement]) {
          allImprovements[improvement] = {
            appearances: [],
            resolved: false
          };
        }
        allImprovements[improvement].appearances.push(index);
      });
    });
    
    return Object.entries(allImprovements).map(([improvement, data]) => {
      const lastAppearance = Math.max(...data.appearances);
      const isRecent = lastAppearance >= sortedVideos.length - 2;
      const frequency = data.appearances.length;
      
      return {
        area: improvement,
        frequency,
        isRecent,
        resolved: !isRecent && frequency < sortedVideos.length * 0.3,
        consistency: Math.round((frequency / sortedVideos.length) * 100)
      };
    }).sort((a, b) => {
      if (a.isRecent && !b.isRecent) return -1;
      if (!a.isRecent && b.isRecent) return 1;
      return b.frequency - a.frequency;
    });
  };

  const analyzeConsistency = (sortedVideos) => {
    const scores = sortedVideos.map(v => v.analysisData?.overallScore || 0);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
    const standardDeviation = Math.sqrt(variance);
    
    const consistency = Math.max(0, 100 - (standardDeviation * 20)); // Scale to 0-100
    
    return {
      score: Math.round(consistency),
      standardDeviation,
      interpretation: consistency > 80 ? 'Very Consistent' :
                     consistency > 60 ? 'Consistent' :
                     consistency > 40 ? 'Somewhat Variable' :
                     'Highly Variable'
    };
  };

  const generateRecommendations = (sortedVideos) => {
    const recommendations = [];
    const latestVideo = sortedVideos[sortedVideos.length - 1];
    const progress = calculateOverallProgress(sortedVideos);
    
    if (progress.trend === 'declining') {
      recommendations.push({
        type: 'warning',
        title: 'Recent Decline',
        description: 'Focus on fundamentals and consider reviewing your recent swing changes',
        priority: 'high'
      });
    }
    
    if (progress.trend === 'stable' && sortedVideos.length > 5) {
      recommendations.push({
        type: 'suggestion',
        title: 'Break Through Plateau',
        description: 'Try focusing on a specific area for improvement or work with a coach',
        priority: 'medium'
      });
    }
    
    const improvements = analyzeImprovementAreas(sortedVideos);
    const persistentIssue = improvements.find(i => i.frequency > sortedVideos.length * 0.5 && i.isRecent);
    
    if (persistentIssue) {
      recommendations.push({
        type: 'focus',
        title: 'Persistent Area',
        description: `Focus on improving your ${persistentIssue.area.toLowerCase()}`,
        priority: 'high'
      });
    }
    
    return recommendations;
  };

  const renderProgressChart = () => {
    if (!progressData?.timeline) return null;
    
    const maxScore = Math.max(...progressData.timeline.map(p => p.score));
    const minScore = Math.min(...progressData.timeline.map(p => p.score));
    const range = Math.max(maxScore - minScore, 1);
    
    return (
      <View style={styles.chartContainer}>
        <Text style={styles.sectionTitle}>Progress Over Time</Text>
        
        <View style={styles.timeRangeSelector}>
          {[
            { key: 'week', label: '7D' },
            { key: 'month', label: '30D' },
            { key: '3months', label: '3M' },
            { key: 'all', label: 'All' }
          ].map(option => (
            <TouchableOpacity
              key={option.key}
              style={[styles.timeRangeButton, timeRange === option.key && styles.activeTimeRangeButton]}
              onPress={() => setTimeRange(option.key)}
            >
              <Text style={[
                styles.timeRangeButtonText,
                timeRange === option.key && styles.activeTimeRangeButtonText
              ]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        
        <View style={styles.chart}>
          {progressData.timeline.map((point, index) => {
            const height = ((point.score - minScore) / range) * 80;
            
            return (
              <TouchableOpacity
                key={index}
                style={styles.chartPoint}
                onPress={() => onVideoSelect(point.video)}
                activeOpacity={0.7}
              >
                <View style={styles.chartBar}>
                  <View 
                    style={[
                      styles.chartBarFill,
                      {
                        height: Math.max(height, 4),
                        backgroundColor: VideoMetadataHelpers.getScoreColor(point.score, colors)
                      }
                    ]}
                  />
                </View>
                <Text style={styles.chartLabel}>
                  {new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
                <Text style={styles.chartScore}>{point.score.toFixed(1)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  const renderOverallStats = () => {
    if (!progressData?.overall) return null;
    
    return (
      <View style={styles.statsContainer}>
        <Text style={styles.sectionTitle}>Overall Progress</Text>
        
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {progressData.overall.improvement > 0 ? '+' : ''}{progressData.overall.improvement.toFixed(1)}
            </Text>
            <Text style={styles.statLabel}>Improvement</Text>
            <View style={styles.trendIndicator}>
              <Ionicons 
                name={VideoMetadataHelpers.getTrendIcon(progressData.overall.trend)} 
                size={16} 
                color={VideoMetadataHelpers.getTrendColor(progressData.overall.trend, colors)} 
              />
              <Text style={[
                styles.trendText,
                { color: VideoMetadataHelpers.getTrendColor(progressData.overall.trend, colors) }
              ]}>
                {progressData.overall.trend.charAt(0).toUpperCase() + progressData.overall.trend.slice(1)}
              </Text>
            </View>
          </View>
          
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{progressData.consistency.score}%</Text>
            <Text style={styles.statLabel}>Consistency</Text>
            <Text style={styles.consistencyText}>{progressData.consistency.interpretation}</Text>
          </View>
          
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{progressData.streaks.current}</Text>
            <Text style={styles.statLabel}>Current Streak</Text>
            <Text style={styles.streakText}>
              Best: {progressData.streaks.longest}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderMilestones = () => {
    if (!progressData?.milestones || progressData.milestones.length === 0) return null;
    
    return (
      <View style={styles.milestonesContainer}>
        <Text style={styles.sectionTitle}>Achievements</Text>
        
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.milestonesScroll}
        >
          {progressData.milestones.slice(0, 5).map((milestone, index) => (
            <View key={index} style={styles.milestoneCard}>
              <View style={styles.milestoneIcon}>
                <Ionicons 
                  name={milestone.type === 'personal_best' ? 'trophy' : 'medal'} 
                  size={24} 
                  color={colors.accent} 
                />
              </View>
              <Text style={styles.milestoneTitle}>{milestone.description}</Text>
              <Text style={styles.milestoneDate}>
                {VideoMetadataHelpers.formatDate(milestone.video.uploadDate)}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  };

  const renderRecommendations = () => {
    if (!progressData?.recommendations || progressData.recommendations.length === 0) return null;
    
    return (
      <View style={styles.recommendationsContainer}>
        <Text style={styles.sectionTitle}>Recommendations</Text>
        
        {progressData.recommendations.map((rec, index) => {
          const iconName = rec.type === 'warning' ? 'warning' :
                          rec.type === 'suggestion' ? 'lightbulb' : 'target';
          const iconColor = rec.priority === 'high' ? colors.error :
                           rec.priority === 'medium' ? colors.warning : colors.primary;
          
          return (
            <View key={index} style={styles.recommendationCard}>
              <View style={[styles.recommendationIcon, { backgroundColor: iconColor + '20' }]}>
                <Ionicons name={iconName} size={20} color={iconColor} />
              </View>
              <View style={styles.recommendationContent}>
                <Text style={styles.recommendationTitle}>{rec.title}</Text>
                <Text style={styles.recommendationDescription}>{rec.description}</Text>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  if (!videos || videos.length < 2) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="analytics-outline" size={64} color={colors.textSecondary} />
        <Text style={styles.emptyTitle}>Not Enough Data</Text>
        <Text style={styles.emptyDescription}>
          Upload at least 2 videos to see progress analytics
        </Text>
      </View>
    );
  }

  if (!progressData) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="time-outline" size={64} color={colors.textSecondary} />
        <Text style={styles.emptyTitle}>No Data in Selected Range</Text>
        <Text style={styles.emptyDescription}>
          Try selecting a different time range
        </Text>
      </View>
    );
  }

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {renderProgressChart()}
      {renderOverallStats()}
      {renderMilestones()}
      {renderRecommendations()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.base,
  },
  chartContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.base,
    ...shadows.base,
  },
  timeRangeSelector: {
    flexDirection: 'row',
    marginBottom: spacing.base,
    backgroundColor: colors.background,
    borderRadius: borderRadius.base,
    padding: spacing.xs,
  },
  timeRangeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: borderRadius.sm,
  },
  activeTimeRangeButton: {
    backgroundColor: colors.primary,
  },
  timeRangeButtonText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  activeTimeRangeButtonText: {
    color: colors.surface,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    height: 120,
    marginTop: spacing.base,
  },
  chartPoint: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  chartBar: {
    width: '80%',
    height: 80,
    justifyContent: 'flex-end',
    marginBottom: spacing.xs,
  },
  chartBarFill: {
    width: '100%',
    borderRadius: borderRadius.sm,
    minHeight: 4,
  },
  chartLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  chartScore: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  statsContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.base,
    ...shadows.base,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statCard: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  statLabel: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  trendIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trendText: {
    fontSize: typography.fontSizes.xs,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.xs,
  },
  consistencyText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  streakText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  milestonesContainer: {
    marginBottom: spacing.base,
  },
  milestonesScroll: {
    paddingRight: spacing.lg,
  },
  milestoneCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginRight: spacing.base,
    alignItems: 'center',
    width: 120,
    ...shadows.sm,
  },
  milestoneIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  milestoneTitle: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  milestoneDate: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  recommendationsContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    ...shadows.base,
  },
  recommendationCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.base,
    paddingBottom: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  recommendationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.base,
  },
  recommendationContent: {
    flex: 1,
  },
  recommendationTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  recommendationDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: 18,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  emptyDescription: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    lineHeight: 22,
  },
});