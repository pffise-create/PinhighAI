import AsyncStorage from '@react-native-async-storage/async-storage';
import ChatHistoryManager from './chatHistoryManager';

const VIDEO_VAULT_PREFIX = 'video_vault_';
const VIDEO_METADATA_PREFIX = 'video_metadata_';

export class VideoVaultManager {
  static async storeVideoMetadata(videoData) {
    try {
      const videoMetadata = {
        videoId: videoData.videoId || Date.now().toString(),
        userId: videoData.userId || 'default',
        uploadDate: videoData.uploadDate || new Date().toISOString(),
        videoUrl: videoData.videoUrl,
        thumbnailUrl: videoData.thumbnailUrl,
        analysisId: videoData.analysisId,
        analysisData: videoData.analysisData || {},
        videoMetrics: {
          duration: videoData.duration || 0,
          frameCount: videoData.frameCount || 0,
          fileSize: videoData.fileSize || '0MB',
          ...videoData.videoMetrics
        },
        tags: videoData.tags || [],
        notes: videoData.notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const metadataKey = `${VIDEO_METADATA_PREFIX}${videoMetadata.videoId}`;
      await AsyncStorage.setItem(metadataKey, JSON.stringify(videoMetadata));

      await this._addToVaultIndex(videoMetadata.userId, videoMetadata.videoId, videoMetadata.uploadDate);

      return videoMetadata;
    } catch (error) {
      console.error('Failed to store video metadata:', error);
      throw error;
    }
  }

  static async getVideosByDateRange(userId, startDate = null, endDate = null) {
    try {
      const timeline = await this.getVideoTimeline(userId);
      
      if (!startDate && !endDate) {
        return timeline;
      }

      const start = startDate ? new Date(startDate) : new Date('1900-01-01');
      const end = endDate ? new Date(endDate) : new Date('2099-12-31');

      return timeline.filter(video => {
        const videoDate = new Date(video.uploadDate);
        return videoDate >= start && videoDate <= end;
      });
    } catch (error) {
      console.error('Failed to get videos by date range:', error);
      return [];
    }
  }

  static async getVideosByCoachingTheme(userId, theme) {
    try {
      const timeline = await this.getVideoTimeline(userId);
      
      return timeline.filter(video => {
        const analysisThemes = video.analysisData?.coachingThemes || [];
        const videoTags = video.tags || [];
        
        return analysisThemes.includes(theme) || 
               videoTags.includes(theme) ||
               (video.analysisData?.strengths || []).includes(theme) ||
               (video.analysisData?.improvements || []).includes(theme);
      });
    } catch (error) {
      console.error('Failed to get videos by coaching theme:', error);
      return [];
    }
  }

  static async getVideoTimeline(userId) {
    try {
      const vaultIndex = await this._getVaultIndex(userId);
      const videoPromises = vaultIndex.videos.map(async (videoRef) => {
        const metadataKey = `${VIDEO_METADATA_PREFIX}${videoRef.videoId}`;
        const metadataJson = await AsyncStorage.getItem(metadataKey);
        
        if (!metadataJson) {
          console.warn(`Metadata not found for video ${videoRef.videoId}`);
          return null;
        }
        
        return JSON.parse(metadataJson);
      });

      const videos = await Promise.all(videoPromises);
      const validVideos = videos.filter(video => video !== null);

      return validVideos.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
    } catch (error) {
      console.error('Failed to get video timeline:', error);
      return [];
    }
  }

  static async compareVideos(userId, videoIds) {
    try {
      if (!videoIds || videoIds.length < 2) {
        throw new Error('At least 2 videos required for comparison');
      }

      const videoPromises = videoIds.map(async (videoId) => {
        const metadataKey = `${VIDEO_METADATA_PREFIX}${videoId}`;
        const metadataJson = await AsyncStorage.getItem(metadataKey);
        return metadataJson ? JSON.parse(metadataJson) : null;
      });

      const videos = await Promise.all(videoPromises);
      const validVideos = videos.filter(video => video !== null);

      if (validVideos.length < 2) {
        throw new Error('Insufficient valid videos for comparison');
      }

      const comparison = {
        videos: validVideos.sort((a, b) => new Date(a.uploadDate) - new Date(b.uploadDate)),
        progressAnalysis: this._analyzeProgress(validVideos),
        timelineData: this._generateTimelineData(validVideos),
        improvementAreas: this._identifyImprovements(validVideos),
        consistentStrengths: this._findConsistentStrengths(validVideos)
      };

      return comparison;
    } catch (error) {
      console.error('Failed to compare videos:', error);
      throw error;
    }
  }

  static async searchVideos(userId, searchCriteria) {
    try {
      const timeline = await this.getVideoTimeline(userId);
      
      if (!searchCriteria || Object.keys(searchCriteria).length === 0) {
        return timeline;
      }

      let filteredVideos = timeline;

      if (searchCriteria.dateRange) {
        filteredVideos = await this.getVideosByDateRange(
          userId, 
          searchCriteria.dateRange.start, 
          searchCriteria.dateRange.end
        );
      }

      if (searchCriteria.theme) {
        filteredVideos = filteredVideos.filter(video => {
          const analysisThemes = video.analysisData?.coachingThemes || [];
          const videoTags = video.tags || [];
          return analysisThemes.includes(searchCriteria.theme) || videoTags.includes(searchCriteria.theme);
        });
      }

      if (searchCriteria.minScore !== undefined) {
        filteredVideos = filteredVideos.filter(video => 
          (video.analysisData?.overallScore || 0) >= searchCriteria.minScore
        );
      }

      if (searchCriteria.maxScore !== undefined) {
        filteredVideos = filteredVideos.filter(video => 
          (video.analysisData?.overallScore || 10) <= searchCriteria.maxScore
        );
      }

      if (searchCriteria.tags && searchCriteria.tags.length > 0) {
        filteredVideos = filteredVideos.filter(video => {
          const videoTags = video.tags || [];
          return searchCriteria.tags.some(tag => videoTags.includes(tag));
        });
      }

      if (searchCriteria.textQuery) {
        const query = searchCriteria.textQuery.toLowerCase();
        filteredVideos = filteredVideos.filter(video => {
          const searchableText = [
            video.notes,
            ...(video.analysisData?.strengths || []),
            ...(video.analysisData?.improvements || []),
            ...(video.analysisData?.coachingThemes || []),
            ...(video.tags || [])
          ].join(' ').toLowerCase();
          
          return searchableText.includes(query);
        });
      }

      return filteredVideos;
    } catch (error) {
      console.error('Failed to search videos:', error);
      return [];
    }
  }

  static async updateVideoMetadata(videoId, updates) {
    try {
      const metadataKey = `${VIDEO_METADATA_PREFIX}${videoId}`;
      const existingMetadataJson = await AsyncStorage.getItem(metadataKey);
      
      if (!existingMetadataJson) {
        throw new Error(`Video metadata not found for ${videoId}`);
      }

      const existingMetadata = JSON.parse(existingMetadataJson);
      const updatedMetadata = {
        ...existingMetadata,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      await AsyncStorage.setItem(metadataKey, JSON.stringify(updatedMetadata));
      return updatedMetadata;
    } catch (error) {
      console.error('Failed to update video metadata:', error);
      throw error;
    }
  }

  static async deleteVideo(videoId) {
    try {
      const metadataKey = `${VIDEO_METADATA_PREFIX}${videoId}`;
      const metadataJson = await AsyncStorage.getItem(metadataKey);
      
      if (!metadataJson) {
        throw new Error(`Video metadata not found for ${videoId}`);
      }

      const metadata = JSON.parse(metadataJson);
      await AsyncStorage.removeItem(metadataKey);
      await this._removeFromVaultIndex(metadata.userId, videoId);

      return true;
    } catch (error) {
      console.error('Failed to delete video:', error);
      throw error;
    }
  }

  static async syncWithChatHistory(userId) {
    try {
      const conversation = await ChatHistoryManager.loadConversation(userId);
      const analysisMessages = conversation.messages.filter(msg => 
        msg.messageType === 'analysis_result' && msg.analysisData && msg.videoReference
      );

      for (const message of analysisMessages) {
        const existingMetadataKey = `${VIDEO_METADATA_PREFIX}${message.videoReference}`;
        const existingMetadata = await AsyncStorage.getItem(existingMetadataKey);

        if (!existingMetadata) {
          const videoData = {
            videoId: message.videoReference,
            userId: userId,
            uploadDate: message.timestamp,
            analysisId: message.id,
            analysisData: message.analysisData,
            tags: this._extractTagsFromAnalysis(message.analysisData),
            notes: `Analysis from ${new Date(message.timestamp).toLocaleDateString()}`
          };

          await this.storeVideoMetadata(videoData);
        }
      }

      return await this.getVideoTimeline(userId);
    } catch (error) {
      console.error('Failed to sync with chat history:', error);
      return [];
    }
  }

  static async _addToVaultIndex(userId, videoId, uploadDate) {
    try {
      const vaultIndex = await this._getVaultIndex(userId);
      
      const videoRef = {
        videoId,
        uploadDate,
        addedAt: new Date().toISOString()
      };

      vaultIndex.videos.push(videoRef);
      vaultIndex.totalVideos = vaultIndex.videos.length;
      vaultIndex.lastUpdated = new Date().toISOString();

      const indexKey = `${VIDEO_VAULT_PREFIX}${userId}`;
      await AsyncStorage.setItem(indexKey, JSON.stringify(vaultIndex));
    } catch (error) {
      console.error('Failed to add to vault index:', error);
      throw error;
    }
  }

  static async _removeFromVaultIndex(userId, videoId) {
    try {
      const vaultIndex = await this._getVaultIndex(userId);
      vaultIndex.videos = vaultIndex.videos.filter(v => v.videoId !== videoId);
      vaultIndex.totalVideos = vaultIndex.videos.length;
      vaultIndex.lastUpdated = new Date().toISOString();

      const indexKey = `${VIDEO_VAULT_PREFIX}${userId}`;
      await AsyncStorage.setItem(indexKey, JSON.stringify(vaultIndex));
    } catch (error) {
      console.error('Failed to remove from vault index:', error);
      throw error;
    }
  }

  static async _getVaultIndex(userId) {
    try {
      const indexKey = `${VIDEO_VAULT_PREFIX}${userId}`;
      const indexJson = await AsyncStorage.getItem(indexKey);
      
      if (!indexJson) {
        return {
          userId,
          videos: [],
          totalVideos: 0,
          createdAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString()
        };
      }

      return JSON.parse(indexJson);
    } catch (error) {
      console.error('Failed to get vault index:', error);
      return {
        userId,
        videos: [],
        totalVideos: 0,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };
    }
  }

  static _analyzeProgress(videos) {
    if (videos.length < 2) return null;

    const sortedVideos = videos.sort((a, b) => new Date(a.uploadDate) - new Date(b.uploadDate));
    const firstScore = sortedVideos[0].analysisData?.overallScore || 0;
    const latestScore = sortedVideos[sortedVideos.length - 1].analysisData?.overallScore || 0;
    
    const improvement = latestScore - firstScore;
    const trend = improvement > 0.5 ? 'improving' : improvement < -0.5 ? 'declining' : 'stable';

    return {
      totalImprovement: improvement,
      trend,
      firstScore,
      latestScore,
      videoCount: videos.length,
      timespan: this._calculateTimespan(sortedVideos[0].uploadDate, sortedVideos[sortedVideos.length - 1].uploadDate)
    };
  }

  static _generateTimelineData(videos) {
    const sortedVideos = videos.sort((a, b) => new Date(a.uploadDate) - new Date(b.uploadDate));
    
    return sortedVideos.map(video => ({
      date: video.uploadDate,
      score: video.analysisData?.overallScore || 0,
      key: video.videoId,
      strengths: video.analysisData?.strengths?.length || 0,
      improvements: video.analysisData?.improvements?.length || 0
    }));
  }

  static _identifyImprovements(videos) {
    const allImprovements = {};
    
    videos.forEach(video => {
      const improvements = video.analysisData?.improvements || [];
      improvements.forEach(improvement => {
        allImprovements[improvement] = (allImprovements[improvement] || 0) + 1;
      });
    });

    return Object.entries(allImprovements)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([improvement, count]) => ({
        area: improvement,
        frequency: count,
        percentage: Math.round((count / videos.length) * 100)
      }));
  }

  static _findConsistentStrengths(videos) {
    const allStrengths = {};
    
    videos.forEach(video => {
      const strengths = video.analysisData?.strengths || [];
      strengths.forEach(strength => {
        allStrengths[strength] = (allStrengths[strength] || 0) + 1;
      });
    });

    return Object.entries(allStrengths)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([strength, count]) => ({
        area: strength,
        frequency: count,
        percentage: Math.round((count / videos.length) * 100)
      }));
  }

  static _extractTagsFromAnalysis(analysisData) {
    const tags = [];
    
    if (analysisData?.coachingThemes) {
      tags.push(...analysisData.coachingThemes);
    }
    
    if (analysisData?.overallScore >= 8) tags.push('high_score');
    if (analysisData?.overallScore <= 5) tags.push('needs_work');
    
    return [...new Set(tags)];
  }

  static _calculateTimespan(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffInDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    
    if (diffInDays < 7) return `${diffInDays} days`;
    if (diffInDays < 30) return `${Math.ceil(diffInDays / 7)} weeks`;
    if (diffInDays < 365) return `${Math.ceil(diffInDays / 30)} months`;
    return `${Math.ceil(diffInDays / 365)} years`;
  }
}

export default VideoVaultManager;