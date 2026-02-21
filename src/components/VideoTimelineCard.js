import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';
import VideoMetadataHelpers from '../utils/videoMetadataHelpers';

export default function VideoTimelineCard({ 
  video, 
  onPress, 
  showProgressComparison = false,
  progressData = null,
  index = 0 
}) {
  const keyInsights = VideoMetadataHelpers.extractKeyInsights(video.analysisData);
  const scoreColor = VideoMetadataHelpers.getScoreColor(video.analysisData?.overallScore, colors);
  const formattedDate = VideoMetadataHelpers.formatDate(video.uploadDate);
  const videoTitle = VideoMetadataHelpers.generateVideoTitle(video.analysisData, video.uploadDate, index + 1);
  const scoreGrade = VideoMetadataHelpers.getScoreGrade(video.analysisData?.overallScore);

  const renderThumbnail = () => {
    if (video.thumbnailUrl) {
      return (
        <Image 
          source={{ uri: video.thumbnailUrl }} 
          style={styles.thumbnail}
          resizeMode="cover"
        />
      );
    }
    
    return (
      <View style={styles.thumbnailPlaceholder}>
        <Ionicons name="videocam" size={32} color={colors.textSecondary} />
      </View>
    );
  };

  const renderProgressIndicator = () => {
    if (!showProgressComparison || !progressData) return null;

    const { improvement, trend } = progressData;
    const trendIcon = VideoMetadataHelpers.getTrendIcon(trend);
    const trendColor = VideoMetadataHelpers.getTrendColor(trend, colors);
    const changeText = VideoMetadataHelpers.formatProgressChange(
      progressData.previousScore, 
      video.analysisData?.overallScore
    );

    return (
      <View style={styles.progressIndicator}>
        <View style={[styles.progressBadge, { backgroundColor: trendColor + '20' }]}>
          <Ionicons name={trendIcon} size={12} color={trendColor} />
          {changeText && (
            <Text style={[styles.progressText, { color: trendColor }]}>
              {changeText}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(video)}
      activeOpacity={0.8}
    >
      {/* Timeline connector */}
      <View style={styles.timelineSection}>
        <View style={styles.timelineDot} />
        {index > 0 && <View style={styles.timelineLine} />}
      </View>

      {/* Card content */}
      <View style={styles.cardContent}>
        {/* Header with thumbnail and basic info */}
        <View style={styles.cardHeader}>
          <View style={styles.thumbnailContainer}>
            {renderThumbnail()}
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>
                {VideoMetadataHelpers.formatDuration(video.videoMetrics?.duration)}
              </Text>
            </View>
          </View>

          <View style={styles.headerInfo}>
            <View style={styles.titleRow}>
              <Text style={styles.videoTitle} numberOfLines={2}>
                {videoTitle}
              </Text>
              {renderProgressIndicator()}
            </View>
            
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.videoDate}>{formattedDate}</Text>
              
              <View style={styles.scoreContainer}>
                <View style={[styles.scoreCircle, { borderColor: scoreColor }]}>
                  <Text style={[styles.scoreText, { color: scoreColor }]}>
                    {video.analysisData?.overallScore?.toFixed(1) || '—'}
                  </Text>
                </View>
                <Text style={styles.gradeText}>{scoreGrade}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Insights section */}
        {keyInsights.length > 0 && (
          <View style={styles.insightsSection}>
            {keyInsights.map((insight, idx) => (
              <View key={idx} style={styles.insightItem}>
                <View style={[
                  styles.insightIcon, 
                  { backgroundColor: insight.type === 'strength' ? colors.success + '20' : colors.primary + '20' }
                ]}>
                  <Ionicons 
                    name={insight.icon} 
                    size={14} 
                    color={insight.type === 'strength' ? colors.success : colors.primary} 
                  />
                </View>
                <Text style={styles.insightText} numberOfLines={1}>
                  {insight.text}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Tags section */}
        {video.tags && video.tags.length > 0 && (
          <View style={styles.tagsSection}>
            {video.tags.slice(0, 3).map((tag, idx) => (
              <View key={idx} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
            {video.tags.length > 3 && (
              <Text style={styles.moreTagsText}>+{video.tags.length - 3} more</Text>
            )}
          </View>
        )}

        {/* Footer actions */}
        <View style={styles.cardFooter}>
          <View style={styles.videoStats}>
            <Ionicons name="analytics-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.statText}>
              {video.analysisData?.strengths?.length || 0} strengths
            </Text>
            <Ionicons name="trending-up-outline" size={14} color={colors.textSecondary} style={styles.statIcon} />
            <Text style={styles.statText}>
              {video.analysisData?.improvements?.length || 0} areas
            </Text>
          </View>
          
          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.actionButton}>
              <Ionicons name="share-outline" size={16} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.playButton}>
              <Ionicons name="play" size={14} color={colors.surface} />
              <Text style={styles.playButtonText}>Watch</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Notes preview */}
        {video.notes && (
          <View style={styles.notesSection}>
            <Ionicons name="document-text-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.notesText} numberOfLines={2}>
              {video.notes}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
  },
  timelineSection: {
    width: 24,
    alignItems: 'center',
    marginRight: spacing.base,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
    marginTop: 20,
    zIndex: 1,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  cardContent: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    ...shadows.base,
  },
  cardHeader: {
    flexDirection: 'row',
    marginBottom: spacing.base,
  },
  thumbnailContainer: {
    position: 'relative',
    marginRight: spacing.base,
  },
  thumbnail: {
    width: 80,
    height: 60,
    borderRadius: borderRadius.base,
    backgroundColor: colors.background,
  },
  thumbnailPlaceholder: {
    width: 80,
    height: 60,
    borderRadius: borderRadius.base,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  durationBadge: {
    position: 'absolute',
    bottom: spacing.xs,
    right: spacing.xs,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  durationText: {
    fontSize: typography.fontSizes.xs,
    color: colors.surface,
    fontFamily: typography.fontFamily,
  },
  headerInfo: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  videoTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    flex: 1,
    marginRight: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  videoDate: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.xs,
    flex: 1,
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scoreCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.xs,
  },
  scoreText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.bold,
    fontFamily: typography.fontFamily,
  },
  gradeText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  progressIndicator: {
    alignItems: 'flex-end',
  },
  progressBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  progressText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.xs,
  },
  insightsSection: {
    marginBottom: spacing.base,
  },
  insightItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  insightIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  insightText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
    flex: 1,
  },
  tagsSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: spacing.base,
  },
  tag: {
    backgroundColor: colors.primary + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  tagText: {
    fontSize: typography.fontSizes.xs,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  moreTagsText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    fontStyle: 'italic',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  videoStats: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.xs,
    marginRight: spacing.sm,
  },
  statIcon: {
    marginLeft: spacing.sm,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.base,
  },
  playButtonText: {
    fontSize: typography.fontSizes.sm,
    color: colors.surface,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    marginLeft: spacing.xs,
  },
  notesSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.background,
    padding: spacing.sm,
    borderRadius: borderRadius.base,
    marginTop: spacing.xs,
  },
  notesText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
    flex: 1,
    lineHeight: 18,
  },
});