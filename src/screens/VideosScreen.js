import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  Modal,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';
import { useAuth } from '../context/AuthContext';
import VideoVaultManager from '../services/videoVaultManager';
import VideoMetadataHelpers from '../utils/videoMetadataHelpers';
import VideoFilterModal from '../components/VideoFilterModal';

export default function VideosScreen({ navigation }) {
  const { user } = useAuth();
  const [videos, setVideos] = useState([]);
  const [filteredVideos, setFilteredVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [playerVisible, setPlayerVisible] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [filters, setFilters] = useState({
    scoreRange: { min: null, max: null },
    dateRange: { start: null, end: null },
    themes: []
  });
  
  const userId = user?.email || 'guest';

  useEffect(() => {
    loadVideos();
  }, [userId]);

  useEffect(() => {
    applyFilters();
  }, [videos, searchQuery, filters]);

  const loadVideos = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      await VideoVaultManager.syncWithChatHistory(userId);
      const videoTimeline = await VideoVaultManager.getVideoTimeline(userId);
      setVideos(videoTimeline);
    } catch (error) {
      console.error('Failed to load videos:', error);
      Alert.alert('Error', 'Failed to load videos. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const applyFilters = useCallback(() => {
    let filtered = [...videos];

    if (searchQuery.trim()) {
      filtered = VideoMetadataHelpers.searchVideosText(filtered, searchQuery);
    }

    if (filters.scoreRange.min !== null || filters.scoreRange.max !== null) {
      filtered = VideoMetadataHelpers.filterVideosByScore(
        filtered, 
        filters.scoreRange.min, 
        filters.scoreRange.max
      );
    }

    if (filters.dateRange.start || filters.dateRange.end) {
      const start = filters.dateRange.start ? new Date(filters.dateRange.start) : null;
      const end = filters.dateRange.end ? new Date(filters.dateRange.end) : null;
      
      filtered = filtered.filter(video => {
        const videoDate = new Date(video.uploadDate);
        if (start && videoDate < start) return false;
        if (end && videoDate > end) return false;
        return true;
      });
    }

    if (filters.themes.length > 0) {
      filtered = filtered.filter(video => {
        const videoThemes = [
          ...(video.analysisData?.coachingThemes || []),
          ...(video.tags || [])
        ];
        return filters.themes.some(theme => videoThemes.includes(theme));
      });
    }

    setFilteredVideos(filtered);
  }, [videos, searchQuery, filters]);

  const handleRefresh = () => {
    loadVideos(true);
  };

  const handleVideoPress = (video) => {
    setSelectedVideo(video);
    setPlayerVisible(true);
  };

  const handleSearchChange = (text) => {
    setSearchQuery(text);
  };

  const clearFilters = () => {
    setFilters({
      scoreRange: { min: null, max: null },
      dateRange: { start: null, end: null },
      themes: []
    });
    setSearchQuery('');
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="videocam-outline" size={80} color={colors.textSecondary} />
      <Text style={styles.emptyTitle}>No Videos Yet</Text>
      <Text style={styles.emptyDescription}>
        Your analyzed swing videos will appear here. Start by uploading a video in the Chat tab!
      </Text>
      <TouchableOpacity 
        style={styles.startButton}
        onPress={() => navigation.navigate('Chat')}
        activeOpacity={0.8}
      >
        <Ionicons name="videocam" size={20} color={colors.surface} />
        <Text style={styles.startButtonText}>Upload First Video</Text>
      </TouchableOpacity>
    </View>
  );

  const renderVideoCard = (video, index) => {
    const keyInsights = VideoMetadataHelpers.extractKeyInsights(video.analysisData);
    const scoreColor = VideoMetadataHelpers.getScoreColor(video.analysisData?.overallScore, colors);
    const formattedDate = VideoMetadataHelpers.formatDate(video.uploadDate);
    const videoTitle = VideoMetadataHelpers.generateVideoTitle(video.analysisData, video.uploadDate, index + 1);

    return (
      <TouchableOpacity
        key={video.videoId}
        style={styles.videoCard}
        onPress={() => handleVideoPress(video)}
        activeOpacity={0.8}
      >
        <View style={styles.videoHeader}>
          <View style={styles.videoInfo}>
            <Text style={styles.videoTitle}>{videoTitle}</Text>
            <Text style={styles.videoDate}>{formattedDate}</Text>
          </View>
          
          <View style={styles.scoreSection}>
            <View style={[styles.scoreCircle, { borderColor: scoreColor }]}>
              <Text style={[styles.scoreText, { color: scoreColor }]}>
                {video.analysisData?.overallScore?.toFixed(1) || '—'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.insightsSection}>
          {keyInsights.map((insight, idx) => (
            <View key={idx} style={styles.insightItem}>
              <Ionicons 
                name={insight.icon} 
                size={16} 
                color={insight.type === 'strength' ? colors.success : colors.primary} 
              />
              <Text style={styles.insightText} numberOfLines={1}>
                {insight.text}
              </Text>
            </View>
          ))}
        </View>

        {video.tags && video.tags.length > 0 && (
          <View style={styles.tagsSection}>
            {video.tags.slice(0, 3).map((tag, idx) => (
              <View key={idx} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.videoFooter}>
          <View style={styles.videoStats}>
            <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.statText}>
              {VideoMetadataHelpers.formatDuration(video.videoMetrics?.duration)}
            </Text>
          </View>
          
          <TouchableOpacity style={styles.playButton}>
            <Ionicons name="play" size={16} color={colors.primary} />
            <Text style={styles.playButtonText}>Watch</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading your video vault...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Video Vault</Text>
        <Text style={styles.subtitle}>
          {videos.length === 0 ? 'Your journey starts here' :
           videos.length === 1 ? '1 swing analyzed' :
           `${videos.length} swings analyzed`}
        </Text>
        
        {videos.length > 0 && (
          <View style={styles.searchSection}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={20} color={colors.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search videos..."
                placeholderTextColor={colors.textSecondary}
                value={searchQuery}
                onChangeText={handleSearchChange}
                returnKeyType="search"
              />
              {(searchQuery || Object.values(filters).some(f => 
                Array.isArray(f) ? f.length > 0 : Object.values(f).some(v => v !== null)
              )) && (
                <TouchableOpacity onPress={clearFilters} style={styles.clearButton}>
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
            
            <TouchableOpacity 
              style={styles.filterButton}
              onPress={() => setFilterModalVisible(true)}
            >
              <Ionicons name="options" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {videos.length === 0 ? (
        renderEmptyState()
      ) : (
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
          {filteredVideos.length === 0 && videos.length > 0 ? (
            <View style={styles.noResultsState}>
              <Ionicons name="search" size={60} color={colors.textSecondary} />
              <Text style={styles.noResultsTitle}>No videos found</Text>
              <Text style={styles.noResultsDescription}>
                Try adjusting your search or filters
              </Text>
            </View>
          ) : (
            filteredVideos.map((video, index) => renderVideoCard(video, index))
          )}
        </ScrollView>
      )}

      <Modal
        visible={playerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPlayerVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Video Analysis</Text>
            <TouchableOpacity
              onPress={() => setPlayerVisible(false)}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          
          {selectedVideo && (
            <ScrollView style={styles.modalContent}>
              <View style={styles.videoPlayerPlaceholder}>
                <Ionicons name="play-circle" size={80} color={colors.primary} />
                <Text style={styles.placeholderText}>Video Player Coming Soon</Text>
              </View>
              
              <View style={styles.analysisOverlay}>
                <Text style={styles.analysisTitle}>Analysis Results</Text>
                
                <View style={styles.scoreDisplay}>
                  <Text style={styles.scoreValue}>
                    {selectedVideo.analysisData?.overallScore?.toFixed(1) || '—'}
                  </Text>
                  <Text style={styles.scoreLabel}>Overall Score</Text>
                </View>
                
                {selectedVideo.analysisData?.strengths && (
                  <View style={styles.analysisSection}>
                    <Text style={styles.analysisSectionTitle}>Strengths</Text>
                    {selectedVideo.analysisData.strengths.map((strength, idx) => (
                      <Text key={idx} style={styles.analysisItem}>• {strength}</Text>
                    ))}
                  </View>
                )}
                
                {selectedVideo.analysisData?.improvements && (
                  <View style={styles.analysisSection}>
                    <Text style={styles.analysisSectionTitle}>Areas to Improve</Text>
                    {selectedVideo.analysisData.improvements.map((improvement, idx) => (
                      <Text key={idx} style={styles.analysisItem}>• {improvement}</Text>
                    ))}
                  </View>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      <VideoFilterModal
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        filters={filters}
        onFiltersChange={setFilters}
        availableThemes={[...new Set(videos.flatMap(v => [...(v.analysisData?.coachingThemes || []), ...(v.tags || [])]))]}
        totalVideos={videos.length}
      />
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
    marginBottom: spacing.base,
  },
  searchSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.base,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.base,
    height: 44,
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  clearButton: {
    padding: spacing.xs,
  },
  filterButton: {
    width: 44,
    height: 44,
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
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
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
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
    marginBottom: spacing.xl,
  },
  startButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    ...shadows.sm,
  },
  startButtonText: {
    color: colors.surface,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  videoCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.base,
    ...shadows.base,
  },
  videoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.base,
  },
  videoInfo: {
    flex: 1,
  },
  videoTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  videoDate: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  scoreSection: {
    alignItems: 'center',
  },
  scoreCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreText: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.bold,
    fontFamily: typography.fontFamily,
  },
  insightsSection: {
    marginBottom: spacing.base,
  },
  insightItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  insightText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
    flex: 1,
  },
  tagsSection: {
    flexDirection: 'row',
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
  videoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  videoStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.xs,
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.base,
  },
  playButtonText: {
    fontSize: typography.fontSizes.sm,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    marginLeft: spacing.xs,
  },
  noResultsState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  noResultsTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginTop: spacing.base,
    marginBottom: spacing.sm,
  },
  noResultsDescription: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  closeButton: {
    padding: spacing.xs,
  },
  modalContent: {
    flex: 1,
  },
  videoPlayerPlaceholder: {
    height: 200,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    margin: spacing.lg,
    borderRadius: borderRadius.lg,
  },
  placeholderText: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginTop: spacing.sm,
  },
  analysisOverlay: {
    padding: spacing.lg,
  },
  analysisTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.base,
  },
  scoreDisplay: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.base,
  },
  scoreValue: {
    fontSize: typography.fontSizes['3xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
  },
  scoreLabel: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginTop: spacing.xs,
  },
  analysisSection: {
    backgroundColor: colors.surface,
    padding: spacing.base,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.base,
  },
  analysisSectionTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.sm,
  },
  analysisItem: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
    lineHeight: 20,
    marginBottom: spacing.xs,
  },
});