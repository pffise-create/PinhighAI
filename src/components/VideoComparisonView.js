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

const { width } = Dimensions.get('window');

export default function VideoComparisonView({ 
  videos, 
  onClose, 
  onVideoSelect 
}) {
  const [comparisonData, setComparisonData] = useState(null);
  const [selectedVideoIndex, setSelectedVideoIndex] = useState(0);

  useEffect(() => {
    if (videos && videos.length >= 2) {
      generateComparisonData();
    }
  }, [videos]);

  const generateComparisonData = () => {
    const sortedVideos = VideoMetadataHelpers.sortVideosByDate(videos, true);
    const progress = VideoMetadataHelpers.calculateVideoProgress(videos);
    const stats = VideoMetadataHelpers.getVideoStats(videos);

    const scoreProgression = sortedVideos.map(video => ({
      date: new Date(video.uploadDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      score: video.analysisData?.overallScore || 0,
      video: video
    }));

    const strengthsComparison = analyzeStrengthsProgression(sortedVideos);
    const improvementsComparison = analyzeImprovementsProgression(sortedVideos);

    setComparisonData({
      videos: sortedVideos,
      progress,
      stats,
      scoreProgression,
      strengthsComparison,
      improvementsComparison
    });
  };

  const analyzeStrengthsProgression = (sortedVideos) => {
    const allStrengths = {};
    
    sortedVideos.forEach((video, index) => {
      const strengths = video.analysisData?.strengths || [];
      strengths.forEach(strength => {
        if (!allStrengths[strength]) {
          allStrengths[strength] = [];
        }
        allStrengths[strength].push(index);
      });
    });

    return Object.entries(allStrengths)
      .map(([strength, appearances]) => ({
        strength,
        frequency: appearances.length,
        consistency: Math.round((appearances.length / sortedVideos.length) * 100),
        trend: appearances[appearances.length - 1] === sortedVideos.length - 1 ? 'current' : 'past'
      }))
      .sort((a, b) => b.frequency - a.frequency);
  };

  const analyzeImprovementsProgression = (sortedVideos) => {
    const allImprovements = {};
    
    sortedVideos.forEach((video, index) => {
      const improvements = video.analysisData?.improvements || [];
      improvements.forEach(improvement => {
        if (!allImprovements[improvement]) {
          allImprovements[improvement] = [];
        }
        allImprovements[improvement].push(index);
      });
    });

    return Object.entries(allImprovements)
      .map(([improvement, appearances]) => {
        const isRecent = appearances.includes(sortedVideos.length - 1);
        const isResolved = appearances[0] === 0 && !isRecent && appearances.length < sortedVideos.length;
        
        return {
          improvement,
          frequency: appearances.length,
          consistency: Math.round((appearances.length / sortedVideos.length) * 100),
          status: isResolved ? 'resolved' : isRecent ? 'ongoing' : 'past',
          trend: isRecent ? 'current' : 'past'
        };
      })
      .sort((a, b) => {
        if (a.status === 'ongoing' && b.status !== 'ongoing') return -1;
        if (b.status === 'ongoing' && a.status !== 'ongoing') return 1;
        return b.frequency - a.frequency;
      });
  };

  const renderProgressChart = () => {
    if (!comparisonData?.scoreProgression) return null;

    const maxScore = Math.max(...comparisonData.scoreProgression.map(p => p.score));
    const minScore = Math.min(...comparisonData.scoreProgression.map(p => p.score));
    const range = maxScore - minScore || 1;

    return (
      <View style={styles.chartContainer}>
        <Text style={styles.sectionTitle}>Score Progression</Text>
        <View style={styles.chart}>
          {comparisonData.scoreProgression.map((point, index) => {
            const height = ((point.score - minScore) / range) * 100;
            const isSelected = index === selectedVideoIndex;
            
            return (
              <TouchableOpacity
                key={index}
                style={styles.chartPoint}
                onPress={() => setSelectedVideoIndex(index)}
                activeOpacity={0.7}
              >
                <View style={styles.chartBar}>
                  <View 
                    style={[
                      styles.chartBarFill,
                      {
                        height: `${Math.max(height, 10)}%`,
                        backgroundColor: isSelected ? colors.primary : colors.primary + '60'
                      }
                    ]}
                  />
                </View>
                <Text style={styles.chartLabel}>{point.date}</Text>
                <Text style={styles.chartScore}>{point.score.toFixed(1)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  const renderVideoComparison = () => {
    if (!comparisonData?.videos || comparisonData.videos.length < 2) return null;

    const selectedVideo = comparisonData.videos[selectedVideoIndex];
    const previousVideo = selectedVideoIndex > 0 ? comparisonData.videos[selectedVideoIndex - 1] : null;

    return (
      <View style={styles.comparisonContainer}>
        <Text style={styles.sectionTitle}>Video Analysis</Text>
        
        <View style={styles.videoComparisonCard}>
          <View style={styles.videoHeader}>
            <Text style={styles.videoTitle}>
              {VideoMetadataHelpers.generateVideoTitle(
                selectedVideo.analysisData, 
                selectedVideo.uploadDate, 
                selectedVideoIndex + 1
              )}
            </Text>
            <View style={styles.scoreComparison}>
              <Text style={styles.currentScore}>
                {selectedVideo.analysisData?.overallScore?.toFixed(1) || '—'}
              </Text>
              {previousVideo && (
                <View style={styles.scoreChange}>
                  <Ionicons 
                    name={selectedVideo.analysisData?.overallScore > previousVideo.analysisData?.overallScore ? 
                          'trending-up' : 'trending-down'} 
                    size={14} 
                    color={selectedVideo.analysisData?.overallScore > previousVideo.analysisData?.overallScore ? 
                           colors.success : colors.error} 
                  />
                  <Text style={styles.changeText}>
                    {VideoMetadataHelpers.formatProgressChange(
                      previousVideo.analysisData?.overallScore,
                      selectedVideo.analysisData?.overallScore
                    )}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Strengths comparison */}
          <View style={styles.analysisSection}>
            <Text style={styles.analysisSectionTitle}>Current Strengths</Text>
            {(selectedVideo.analysisData?.strengths || []).map((strength, idx) => (
              <View key={idx} style={styles.analysisItem}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={styles.analysisText}>{strength}</Text>
              </View>
            ))}
          </View>

          {/* Improvements comparison */}
          <View style={styles.analysisSection}>
            <Text style={styles.analysisSectionTitle}>Focus Areas</Text>
            {(selectedVideo.analysisData?.improvements || []).map((improvement, idx) => (
              <View key={idx} style={styles.analysisItem}>
                <Ionicons name="trending-up" size={16} color={colors.primary} />
                <Text style={styles.analysisText}>{improvement}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  };

  const renderStrengthsProgression = () => {
    if (!comparisonData?.strengthsComparison) return null;

    return (
      <View style={styles.progressionContainer}>
        <Text style={styles.sectionTitle}>Strengths Over Time</Text>
        {comparisonData.strengthsComparison.slice(0, 5).map((item, index) => (
          <View key={index} style={styles.progressionItem}>
            <View style={styles.progressionHeader}>
              <Text style={styles.progressionText}>{item.strength}</Text>
              <View style={styles.progressionBadge}>
                <Text style={styles.consistencyText}>{item.consistency}%</Text>
                {item.trend === 'current' && (
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                )}
              </View>
            </View>
            <View style={styles.progressionBar}>
              <View 
                style={[
                  styles.progressionBarFill,
                  { 
                    width: `${item.consistency}%`,
                    backgroundColor: item.trend === 'current' ? colors.success : colors.textSecondary
                  }
                ]}
              />
            </View>
          </View>
        ))}\n      </View>\n    );\n  };\n\n  const renderImprovementsProgression = () => {\n    if (!comparisonData?.improvementsComparison) return null;\n\n    return (\n      <View style={styles.progressionContainer}>\n        <Text style={styles.sectionTitle}>Improvement Areas Progress</Text>\n        {comparisonData.improvementsComparison.slice(0, 5).map((item, index) => {\n          const statusColor = item.status === 'resolved' ? colors.success :\n                              item.status === 'ongoing' ? colors.warning :\n                              colors.textSecondary;\n          const statusIcon = item.status === 'resolved' ? 'checkmark-circle' :\n                            item.status === 'ongoing' ? 'time' :\n                            'checkmark-done-circle';\n\n          return (\n            <View key={index} style={styles.progressionItem}>\n              <View style={styles.progressionHeader}>\n                <Text style={styles.progressionText}>{item.improvement}</Text>\n                <View style={styles.progressionBadge}>\n                  <Ionicons name={statusIcon} size={14} color={statusColor} />\n                  <Text style={[styles.statusText, { color: statusColor }]}>\n                    {item.status.charAt(0).toUpperCase() + item.status.slice(1)}\n                  </Text>\n                </View>\n              </View>\n              <View style={styles.progressionBar}>\n                <View \n                  style={[\n                    styles.progressionBarFill,\n                    { \n                      width: `${item.consistency}%`,\n                      backgroundColor: statusColor + '40'\n                    }\n                  ]}\n                />\n              </View>\n            </View>\n          );\n        })}\n      </View>\n    );\n  };\n\n  const renderOverallStats = () => {\n    if (!comparisonData?.stats) return null;\n\n    return (\n      <View style={styles.statsContainer}>\n        <Text style={styles.sectionTitle}>Overall Progress</Text>\n        <View style={styles.statsGrid}>\n          <View style={styles.statItem}>\n            <Text style={styles.statValue}>{comparisonData.stats.totalVideos}</Text>\n            <Text style={styles.statLabel}>Total Videos</Text>\n          </View>\n          <View style={styles.statItem}>\n            <Text style={styles.statValue}>{comparisonData.stats.averageScore.toFixed(1)}</Text>\n            <Text style={styles.statLabel}>Avg Score</Text>\n          </View>\n          <View style={styles.statItem}>\n            <Text style={styles.statValue}>{comparisonData.stats.bestScore.toFixed(1)}</Text>\n            <Text style={styles.statLabel}>Best Score</Text>\n          </View>\n          <View style={styles.statItem}>\n            <Text style={[styles.statValue, { \n              color: comparisonData.stats.totalImprovement > 0 ? colors.success : \n                     comparisonData.stats.totalImprovement < 0 ? colors.error : colors.textSecondary \n            }]}>\n              {comparisonData.stats.totalImprovement > 0 ? '+' : ''}\n              {comparisonData.stats.totalImprovement.toFixed(1)}\n            </Text>\n            <Text style={styles.statLabel}>Improvement</Text>\n          </View>\n        </View>\n      </View>\n    );\n  };\n\n  if (!videos || videos.length < 2) {\n    return (\n      <View style={styles.container}>\n        <View style={styles.header}>\n          <Text style={styles.title}>Video Comparison</Text>\n          <TouchableOpacity onPress={onClose} style={styles.closeButton}>\n            <Ionicons name=\"close\" size={24} color={colors.text} />\n          </TouchableOpacity>\n        </View>\n        <View style={styles.emptyState}>\n          <Ionicons name=\"analytics-outline\" size={64} color={colors.textSecondary} />\n          <Text style={styles.emptyTitle}>Not Enough Videos</Text>\n          <Text style={styles.emptyDescription}>\n            You need at least 2 videos to compare progress. Upload more swing videos to unlock comparison features!\n          </Text>\n        </View>\n      </View>\n    );\n  }\n\n  return (\n    <View style={styles.container}>\n      <View style={styles.header}>\n        <Text style={styles.title}>Video Comparison</Text>\n        <TouchableOpacity onPress={onClose} style={styles.closeButton}>\n          <Ionicons name=\"close\" size={24} color={colors.text} />\n        </TouchableOpacity>\n      </View>\n\n      <ScrollView \n        style={styles.content}\n        contentContainerStyle={styles.scrollContent}\n        showsVerticalScrollIndicator={false}\n      >\n        {renderProgressChart()}\n        {renderVideoComparison()}\n        {renderOverallStats()}\n        {renderStrengthsProgression()}\n        {renderImprovementsProgression()}\n      </ScrollView>\n    </View>\n  );\n}\n\nconst styles = StyleSheet.create({\n  container: {\n    flex: 1,\n    backgroundColor: colors.background,\n  },\n  header: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    justifyContent: 'space-between',\n    paddingHorizontal: spacing.lg,\n    paddingVertical: spacing.base,\n    borderBottomWidth: 1,\n    borderBottomColor: colors.border,\n    backgroundColor: colors.surface,\n  },\n  title: {\n    fontSize: typography.fontSizes.xl,\n    fontWeight: typography.fontWeights.bold,\n    color: colors.primary,\n    fontFamily: typography.fontFamily,\n  },\n  closeButton: {\n    padding: spacing.xs,\n  },\n  content: {\n    flex: 1,\n  },\n  scrollContent: {\n    padding: spacing.lg,\n  },\n  sectionTitle: {\n    fontSize: typography.fontSizes.lg,\n    fontWeight: typography.fontWeights.semibold,\n    color: colors.primary,\n    fontFamily: typography.fontFamily,\n    marginBottom: spacing.base,\n  },\n  chartContainer: {\n    backgroundColor: colors.surface,\n    borderRadius: borderRadius.lg,\n    padding: spacing.lg,\n    marginBottom: spacing.base,\n    ...shadows.base,\n  },\n  chart: {\n    flexDirection: 'row',\n    alignItems: 'flex-end',\n    justifyContent: 'space-around',\n    height: 120,\n    marginTop: spacing.base,\n  },\n  chartPoint: {\n    flex: 1,\n    alignItems: 'center',\n    marginHorizontal: spacing.xs,\n  },\n  chartBar: {\n    width: '100%',\n    height: 80,\n    justifyContent: 'flex-end',\n    marginBottom: spacing.xs,\n  },\n  chartBarFill: {\n    width: '100%',\n    borderRadius: borderRadius.sm,\n    minHeight: 8,\n  },\n  chartLabel: {\n    fontSize: typography.fontSizes.xs,\n    color: colors.textSecondary,\n    fontFamily: typography.fontFamily,\n    textAlign: 'center',\n    marginBottom: spacing.xs,\n  },\n  chartScore: {\n    fontSize: typography.fontSizes.sm,\n    fontWeight: typography.fontWeights.semibold,\n    color: colors.primary,\n    fontFamily: typography.fontFamily,\n    textAlign: 'center',\n  },\n  comparisonContainer: {\n    marginBottom: spacing.base,\n  },\n  videoComparisonCard: {\n    backgroundColor: colors.surface,\n    borderRadius: borderRadius.lg,\n    padding: spacing.lg,\n    ...shadows.base,\n  },\n  videoHeader: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    justifyContent: 'space-between',\n    marginBottom: spacing.base,\n    paddingBottom: spacing.base,\n    borderBottomWidth: 1,\n    borderBottomColor: colors.border,\n  },\n  videoTitle: {\n    fontSize: typography.fontSizes.base,\n    fontWeight: typography.fontWeights.semibold,\n    color: colors.text,\n    fontFamily: typography.fontFamily,\n    flex: 1,\n  },\n  scoreComparison: {\n    alignItems: 'center',\n  },\n  currentScore: {\n    fontSize: typography.fontSizes.xl,\n    fontWeight: typography.fontWeights.bold,\n    color: colors.primary,\n    fontFamily: typography.fontFamily,\n  },\n  scoreChange: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    marginTop: spacing.xs,\n  },\n  changeText: {\n    fontSize: typography.fontSizes.sm,\n    fontWeight: typography.fontWeights.medium,\n    fontFamily: typography.fontFamily,\n    marginLeft: spacing.xs,\n  },\n  analysisSection: {\n    marginBottom: spacing.base,\n  },\n  analysisSectionTitle: {\n    fontSize: typography.fontSizes.base,\n    fontWeight: typography.fontWeights.semibold,\n    color: colors.text,\n    fontFamily: typography.fontFamily,\n    marginBottom: spacing.sm,\n  },\n  analysisItem: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    marginBottom: spacing.xs,\n  },\n  analysisText: {\n    fontSize: typography.fontSizes.sm,\n    color: colors.text,\n    fontFamily: typography.fontFamily,\n    marginLeft: spacing.sm,\n    flex: 1,\n  },\n  progressionContainer: {\n    backgroundColor: colors.surface,\n    borderRadius: borderRadius.lg,\n    padding: spacing.lg,\n    marginBottom: spacing.base,\n    ...shadows.base,\n  },\n  progressionItem: {\n    marginBottom: spacing.base,\n  },\n  progressionHeader: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    justifyContent: 'space-between',\n    marginBottom: spacing.xs,\n  },\n  progressionText: {\n    fontSize: typography.fontSizes.sm,\n    color: colors.text,\n    fontFamily: typography.fontFamily,\n    flex: 1,\n  },\n  progressionBadge: {\n    flexDirection: 'row',\n    alignItems: 'center',\n  },\n  consistencyText: {\n    fontSize: typography.fontSizes.xs,\n    color: colors.textSecondary,\n    fontFamily: typography.fontFamily,\n    marginRight: spacing.xs,\n  },\n  statusText: {\n    fontSize: typography.fontSizes.xs,\n    fontFamily: typography.fontFamily,\n    marginLeft: spacing.xs,\n    textTransform: 'capitalize',\n  },\n  progressionBar: {\n    height: 6,\n    backgroundColor: colors.border,\n    borderRadius: 3,\n    overflow: 'hidden',\n  },\n  progressionBarFill: {\n    height: '100%',\n    borderRadius: 3,\n  },\n  statsContainer: {\n    backgroundColor: colors.surface,\n    borderRadius: borderRadius.lg,\n    padding: spacing.lg,\n    marginBottom: spacing.base,\n    ...shadows.base,\n  },\n  statsGrid: {\n    flexDirection: 'row',\n    justifyContent: 'space-around',\n  },\n  statItem: {\n    alignItems: 'center',\n    flex: 1,\n  },\n  statValue: {\n    fontSize: typography.fontSizes.xl,\n    fontWeight: typography.fontWeights.bold,\n    color: colors.primary,\n    fontFamily: typography.fontFamily,\n    marginBottom: spacing.xs,\n  },\n  statLabel: {\n    fontSize: typography.fontSizes.xs,\n    color: colors.textSecondary,\n    fontFamily: typography.fontFamily,\n    textAlign: 'center',\n  },\n  emptyState: {\n    flex: 1,\n    justifyContent: 'center',\n    alignItems: 'center',\n    paddingHorizontal: spacing.lg,\n  },\n  emptyTitle: {\n    fontSize: typography.fontSizes.xl,\n    fontWeight: typography.fontWeights.semibold,\n    color: colors.text,\n    fontFamily: typography.fontFamily,\n    marginTop: spacing.lg,\n    marginBottom: spacing.sm,\n  },\n  emptyDescription: {\n    fontSize: typography.fontSizes.base,\n    color: colors.textSecondary,\n    fontFamily: typography.fontFamily,\n    textAlign: 'center',\n    lineHeight: 22,\n  },\n});