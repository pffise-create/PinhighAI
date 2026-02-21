export const VideoMetadataHelpers = {
  formatDate(dateString) {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffInSeconds = Math.floor((now - date) / 1000);

      if (diffInSeconds < 60) return 'Just now';
      if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
      if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
      if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;

      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Unknown';
    }
  },

  formatDuration(durationInSeconds) {
    if (!durationInSeconds || durationInSeconds <= 0) return '0:00';
    
    const minutes = Math.floor(durationInSeconds / 60);
    const seconds = Math.floor(durationInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  },

  formatFileSize(sizeString) {
    if (!sizeString) return '0 MB';
    
    if (typeof sizeString === 'string' && sizeString.includes('MB')) {
      return sizeString;
    }
    
    const sizeInBytes = parseFloat(sizeString);
    if (isNaN(sizeInBytes)) return '0 MB';
    
    const sizeInMB = sizeInBytes / (1024 * 1024);
    return `${sizeInMB.toFixed(1)} MB`;
  },

  getScoreColor(score, colors) {
    if (!score || score <= 0) return colors.textSecondary;
    if (score >= 8.5) return colors.success;
    if (score >= 7.5) return colors.accent;
    if (score >= 6.5) return colors.warning;
    if (score >= 5.5) return colors.primary;
    return colors.error;
  },

  getScoreGrade(score) {
    if (!score || score <= 0) return 'N/A';
    if (score >= 9) return 'A+';
    if (score >= 8.5) return 'A';
    if (score >= 8) return 'A-';
    if (score >= 7.5) return 'B+';
    if (score >= 7) return 'B';
    if (score >= 6.5) return 'B-';
    if (score >= 6) return 'C+';
    if (score >= 5.5) return 'C';
    if (score >= 5) return 'C-';
    return 'D';
  },

  getTrendIcon(trend) {
    switch (trend?.toLowerCase()) {
      case 'improving':
        return 'trending-up';
      case 'declining':
        return 'trending-down';
      case 'stable':
        return 'remove';
      default:
        return 'analytics';
    }
  },

  getTrendColor(trend, colors) {
    switch (trend?.toLowerCase()) {
      case 'improving':
        return colors.success;
      case 'declining':
        return colors.error;
      case 'stable':
        return colors.warning;
      default:
        return colors.textSecondary;
    }
  },

  formatProgressChange(oldScore, newScore) {
    if (!oldScore || !newScore) return null;
    
    const change = newScore - oldScore;
    const sign = change > 0 ? '+' : '';
    return `${sign}${change.toFixed(1)}`;
  },

  categorizeScore(score) {
    if (!score || score <= 0) return 'unscored';
    if (score >= 8.5) return 'excellent';
    if (score >= 7.5) return 'good';
    if (score >= 6.5) return 'average';
    if (score >= 5.5) return 'needs_work';
    return 'poor';
  },

  extractKeyInsights(analysisData, maxInsights = 3) {
    const insights = [];
    
    if (analysisData?.strengths?.length > 0) {
      insights.push({
        type: 'strength',
        text: analysisData.strengths[0],
        icon: 'checkmark-circle'
      });
    }
    
    if (analysisData?.improvements?.length > 0) {
      insights.push({
        type: 'improvement',
        text: analysisData.improvements[0],
        icon: 'trending-up'
      });
    }
    
    if (analysisData?.coachingThemes?.length > 0) {
      insights.push({
        type: 'theme',
        text: analysisData.coachingThemes[0],
        icon: 'golf'
      });
    }
    
    return insights.slice(0, maxInsights);
  },

  generateVideoTitle(analysisData, uploadDate, index = null) {
    try {
      const date = new Date(uploadDate);
      const dateStr = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
      
      if (analysisData?.strengths?.length > 0) {
        return `${dateStr} - ${analysisData.strengths[0]}`;
      }
      
      if (analysisData?.coachingThemes?.length > 0) {
        return `${dateStr} - Working on ${analysisData.coachingThemes[0]}`;
      }
      
      return `${dateStr} - Swing Analysis${index ? ` #${index}` : ''}`;
    } catch (error) {
      return `Swing Analysis${index ? ` #${index}` : ''}`;
    }
  },

  sortVideosByDate(videos, ascending = false) {
    return [...videos].sort((a, b) => {
      const dateA = new Date(a.uploadDate);
      const dateB = new Date(b.uploadDate);
      return ascending ? dateA - dateB : dateB - dateA;
    });
  },

  groupVideosByMonth(videos) {
    const groups = {};
    
    videos.forEach(video => {
      try {
        const date = new Date(video.uploadDate);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthLabel = date.toLocaleDateString('en-US', { 
          month: 'long', 
          year: 'numeric' 
        });
        
        if (!groups[monthKey]) {
          groups[monthKey] = {
            key: monthKey,
            label: monthLabel,
            videos: []
          };
        }
        
        groups[monthKey].videos.push(video);
      } catch (error) {
        console.error('Error grouping video by month:', error);
      }
    });
    
    return Object.values(groups).sort((a, b) => b.key.localeCompare(a.key));
  },

  calculateVideoProgress(videos) {
    if (!videos || videos.length < 2) return null;
    
    const sortedVideos = this.sortVideosByDate(videos, true);
    const firstVideo = sortedVideos[0];
    const latestVideo = sortedVideos[sortedVideos.length - 1];
    
    const firstScore = firstVideo.analysisData?.overallScore || 0;
    const latestScore = latestVideo.analysisData?.overallScore || 0;
    
    return {
      improvement: latestScore - firstScore,
      firstScore,
      latestScore,
      videoCount: videos.length,
      timespan: this.calculateTimespan(firstVideo.uploadDate, latestVideo.uploadDate)
    };
  },

  calculateTimespan(startDate, endDate) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffInDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      
      if (diffInDays === 0) return 'Same day';
      if (diffInDays < 7) return `${diffInDays} day${diffInDays > 1 ? 's' : ''}`;
      if (diffInDays < 30) return `${Math.ceil(diffInDays / 7)} week${Math.ceil(diffInDays / 7) > 1 ? 's' : ''}`;
      if (diffInDays < 365) return `${Math.ceil(diffInDays / 30)} month${Math.ceil(diffInDays / 30) > 1 ? 's' : ''}`;
      return `${Math.ceil(diffInDays / 365)} year${Math.ceil(diffInDays / 365) > 1 ? 's' : ''}`;
    } catch (error) {
      return 'Unknown timespan';
    }
  },

  filterVideosByScore(videos, minScore = null, maxScore = null) {
    return videos.filter(video => {
      const score = video.analysisData?.overallScore;
      if (!score) return false;
      
      if (minScore !== null && score < minScore) return false;
      if (maxScore !== null && score > maxScore) return false;
      
      return true;
    });
  },

  searchVideosText(videos, query) {
    if (!query || !query.trim()) return videos;
    
    const searchQuery = query.toLowerCase().trim();
    
    return videos.filter(video => {
      const searchableFields = [
        video.notes,
        video.analysisData?.strengths?.join(' '),
        video.analysisData?.improvements?.join(' '),
        video.analysisData?.coachingThemes?.join(' '),
        video.tags?.join(' ')
      ].filter(Boolean).join(' ').toLowerCase();
      
      return searchableFields.includes(searchQuery);
    });
  },

  getVideoStats(videos) {
    if (!videos || videos.length === 0) {
      return {
        totalVideos: 0,
        averageScore: 0,
        bestScore: 0,
        latestScore: 0,
        totalImprovement: 0,
        topStrengths: [],
        topImprovements: []
      };
    }

    const validScores = videos
      .map(v => v.analysisData?.overallScore)
      .filter(score => score && score > 0);

    const allStrengths = videos
      .flatMap(v => v.analysisData?.strengths || [])
      .reduce((acc, strength) => {
        acc[strength] = (acc[strength] || 0) + 1;
        return acc;
      }, {});

    const allImprovements = videos
      .flatMap(v => v.analysisData?.improvements || [])
      .reduce((acc, improvement) => {
        acc[improvement] = (acc[improvement] || 0) + 1;
        return acc;
      }, {});

    const sortedVideos = this.sortVideosByDate(videos, true);
    const firstScore = sortedVideos[0]?.analysisData?.overallScore || 0;
    const latestScore = sortedVideos[sortedVideos.length - 1]?.analysisData?.overallScore || 0;

    return {
      totalVideos: videos.length,
      averageScore: validScores.length > 0 ? 
        validScores.reduce((a, b) => a + b, 0) / validScores.length : 0,
      bestScore: validScores.length > 0 ? Math.max(...validScores) : 0,
      latestScore,
      totalImprovement: latestScore - firstScore,
      topStrengths: Object.entries(allStrengths)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([strength, count]) => ({ strength, count })),
      topImprovements: Object.entries(allImprovements)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([improvement, count]) => ({ improvement, count }))
    };
  }
};

export default VideoMetadataHelpers;