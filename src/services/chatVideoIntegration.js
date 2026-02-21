// ChatVideoIntegration.js - Handles video processing within chat flow
import ChatHistoryManager from './chatHistoryManager';
import VideoVaultManager from './videoVaultManager';

export class ChatVideoIntegration {
  // Process video upload and analysis within chat context
  static async processVideoInChat(userId, videoData, onProgressUpdate) {
    try {
      const videoId = `video_${Date.now()}`;
      
      // Add initial processing message
      await this.addProcessingMessage(userId, videoId, 'uploading');
      
      // Simulate upload with progress updates
      if (onProgressUpdate) {
        for (let progress = 10; progress <= 100; progress += 20) {
          await new Promise(resolve => setTimeout(resolve, 300));
          onProgressUpdate('uploading', progress);
        }
      }
      
      // Processing stages
      const stages = ['processing', 'extracting', 'analyzing'];
      
      for (const stage of stages) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        await this.updateProcessingMessage(userId, videoId, stage);
        if (onProgressUpdate) {
          onProgressUpdate(stage, 0);
        }
      }
      
      // Complete analysis
      await new Promise(resolve => setTimeout(resolve, 2000));
      const analysisData = this.generateAnalysisData();
      
      await this.addAnalysisResult(userId, videoId, analysisData);
      
      // Store video metadata in vault
      await this.storeVideoInVault(userId, videoId, analysisData, videoData);
      
      return {
        success: true,
        videoId,
        analysisData,
      };
      
    } catch (error) {
      console.error('Video processing failed:', error);
      
      await ChatHistoryManager.saveMessage(userId, {
        text: 'Sorry, there was an issue processing your video. Please try recording another swing.',
        sender: 'coach',
        messageType: 'error',
        timestamp: new Date(),
      });
      
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  // Add processing message to chat
  static async addProcessingMessage(userId, videoId, stage) {
    const message = {
      text: this.getStageMessage(stage),
      sender: 'coach',
      messageType: 'video_processing',
      videoId,
      stage,
      timestamp: new Date(),
    };
    
    return await ChatHistoryManager.saveMessage(userId, message);
  }
  
  // Update processing message stage
  static async updateProcessingMessage(userId, videoId, stage) {
    // In a real implementation, you'd update the existing message
    // For now, we'll add a new message for each stage
    return await this.addProcessingMessage(userId, videoId, stage);
  }
  
  // Add analysis result to chat
  static async addAnalysisResult(userId, videoId, analysisData) {
    const summary = await ChatHistoryManager.getConversationSummary(userId);
    const isFirstAnalysis = summary.analysisCount === 0;
    
    const message = {
      text: this.formatAnalysisForChat(analysisData),
      sender: 'coach',
      messageType: 'analysis_result',
      videoId,
      analysisData,
      isFirstAnalysis,
      timestamp: new Date(),
    };
    
    return await ChatHistoryManager.saveMessage(userId, message);
  }
  
  // Get stage-specific message
  static getStageMessage(stage) {
    const messages = {
      uploading: 'Uploading your swing video...',
      processing: 'Processing video and preparing for analysis...',
      extracting: 'Extracting key swing positions (P1-P10)...',
      analyzing: 'AI coach is analyzing your technique...',
      complete: 'Analysis complete! Here are your insights...',
    };
    
    return messages[stage] || 'Processing your swing...';
  }
  
  // Format analysis data for chat display
  static formatAnalysisForChat(analysisData) {
    const { overallScore, strengths, improvements, coachingResponse } = analysisData;
    
    let chatText = `🎯 Your swing analysis is complete! Overall score: ${overallScore}/10\n\n`;
    
    if (strengths && strengths.length > 0) {
      chatText += `✅ **Your Strengths:**\n${strengths.slice(0, 2).map(s => `• ${s}`).join('\n')}\n\n`;
    }
    
    if (improvements && improvements.length > 0) {
      chatText += `🎯 **Key Focus Area:**\n• ${improvements[0]}\n\n`;
    }
    
    if (coachingResponse) {
      chatText += coachingResponse;
    }
    
    return chatText;
  }
  
  // Generate realistic analysis data
  static generateAnalysisData() {
    const overallScores = [6.8, 7.2, 7.5, 7.8, 8.1];
    const strengthOptions = [
      'Consistent setup and address position',
      'Good tempo and swing rhythm',
      'Solid balance throughout the swing',
      'Nice shoulder rotation in backswing',
      'Good impact position fundamentals',
      'Smooth follow-through sequence',
      'Proper weight distribution at address',
      'Consistent swing plane',
    ];
    
    const improvementOptions = [
      'Weight shift timing in transition',
      'Hip rotation sequence in downswing',
      'Wrist hinge consistency at top',
      'Shoulder plane in backswing',
      'Early extension control',
      'Club path through impact zone',
      'Tempo consistency between swings',
      'Follow-through completion',
    ];
    
    const drillOptions = [
      'Slow motion swings focusing on weight transfer',
      'Hip turn drill with alignment stick',
      'Impact bag training for better contact',
      'Towel drill for connection and timing',
      'Step-through drill for weight shift',
      'Wall drill for proper swing plane',
      'Tempo training with metronome',
      'Balance drill on one foot',
    ];
    
    const coachingResponses = [
      'Great swing foundation! Focus on your weight shift timing and you\'ll see improvement across multiple areas.',
      'I can see you have natural talent! Your primary focus should be hip rotation - this will unlock more power and consistency.',
      'Solid fundamentals in place! Working on your transition timing will help everything else fall into line.',
      'Nice work! Your setup is excellent. Let\'s focus on maintaining that tempo throughout the entire swing.',
    ];
    
    return {
      overallScore: overallScores[Math.floor(Math.random() * overallScores.length)],
      strengths: this.shuffleArray(strengthOptions).slice(0, 3),
      improvements: this.shuffleArray(improvementOptions).slice(0, 2),
      practiceRecommendations: this.shuffleArray(drillOptions).slice(0, 3),
      coachingResponse: coachingResponses[Math.floor(Math.random() * coachingResponses.length)],
    };
  }
  
  // Helper to shuffle array
  static shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
  
  // Get video processing progress message for UI
  static getProgressMessage(stage, progress) {
    switch (stage) {
      case 'uploading':
        return `Uploading swing video... ${progress}%`;
      case 'processing':
        return 'Processing video and preparing for analysis...';
      case 'extracting':
        return 'Extracting key swing positions (P1-P10)...';
      case 'analyzing':
        return 'AI coach is analyzing your technique...';
      case 'complete':
        return 'Analysis complete! Preparing your coaching insights...';
      default:
        return 'Processing your swing video...';
    }
  }
  
  // Check if user qualifies for first analysis celebration
  static async shouldShowFirstAnalysisCelebration(userId) {
    try {
      const summary = await ChatHistoryManager.getConversationSummary(userId);
      return summary.analysisCount === 0;
    } catch (error) {
      console.error('Error checking first analysis status:', error);
      return false;
    }
  }

  // Store video metadata in vault for historical tracking
  static async storeVideoInVault(userId, videoId, analysisData, videoData = {}) {
    try {
      const videoMetadata = {
        videoId,
        userId,
        uploadDate: new Date().toISOString(),
        videoUrl: videoData.videoUrl || null,
        thumbnailUrl: videoData.thumbnailUrl || null,
        analysisId: `analysis_${videoId}`,
        analysisData: {
          ...analysisData,
          coachingThemes: this.extractCoachingThemes(analysisData)
        },
        videoMetrics: {
          duration: videoData.duration || 30,
          frameCount: videoData.frameCount || 900,
          fileSize: videoData.fileSize || '12.5MB'
        },
        tags: this.generateTagsFromAnalysis(analysisData),
        notes: `Uploaded via chat on ${new Date().toLocaleDateString()}`
      };

      return await VideoVaultManager.storeVideoMetadata(videoMetadata);
    } catch (error) {
      console.error('Failed to store video in vault:', error);
      // Don't throw error to avoid breaking the chat flow
      return null;
    }
  }

  // Extract coaching themes from analysis data
  static extractCoachingThemes(analysisData) {
    const themes = [];
    
    // Extract themes from improvements
    if (analysisData.improvements) {
      analysisData.improvements.forEach(improvement => {
        if (improvement.includes('weight shift')) themes.push('weight_shift');
        if (improvement.includes('hip rotation')) themes.push('hip_rotation');
        if (improvement.includes('tempo')) themes.push('tempo');
        if (improvement.includes('swing plane')) themes.push('swing_plane');
        if (improvement.includes('impact')) themes.push('impact');
        if (improvement.includes('setup') || improvement.includes('address')) themes.push('setup');
        if (improvement.includes('backswing')) themes.push('backswing');
        if (improvement.includes('follow')) themes.push('follow_through');
        if (improvement.includes('balance')) themes.push('balance');
        if (improvement.includes('wrist') || improvement.includes('hinge')) themes.push('wrist_action');
      });
    }

    // Extract themes from strengths
    if (analysisData.strengths) {
      analysisData.strengths.forEach(strength => {
        if (strength.includes('tempo') || strength.includes('rhythm')) themes.push('tempo');
        if (strength.includes('balance')) themes.push('balance');
        if (strength.includes('setup') || strength.includes('address')) themes.push('setup');
        if (strength.includes('rotation') || strength.includes('shoulder')) themes.push('body_rotation');
        if (strength.includes('impact')) themes.push('impact');
        if (strength.includes('plane')) themes.push('swing_plane');
        if (strength.includes('follow')) themes.push('follow_through');
      });
    }

    return [...new Set(themes)]; // Remove duplicates
  }

  // Generate tags from analysis data
  static generateTagsFromAnalysis(analysisData) {
    const tags = [];
    
    // Score-based tags
    const score = analysisData.overallScore || 0;
    if (score >= 8.5) tags.push('excellent');
    else if (score >= 7.5) tags.push('good');
    else if (score >= 6.5) tags.push('average');
    else if (score >= 5.5) tags.push('needs_work');
    else tags.push('beginner');

    // Add general tags
    tags.push('chat_upload', 'analyzed');

    // Add focus area tags
    if (analysisData.improvements && analysisData.improvements.length > 0) {
      tags.push(`focus_${analysisData.improvements[0].toLowerCase().replace(/\s+/g, '_')}`);
    }

    return tags;
  }

  // Get video vault summary for user
  static async getVideoVaultSummary(userId) {
    try {
      const timeline = await VideoVaultManager.getVideoTimeline(userId);
      return {
        totalVideos: timeline.length,
        latestVideo: timeline[0] || null,
        averageScore: timeline.length > 0 ? 
          timeline.reduce((sum, video) => sum + (video.analysisData?.overallScore || 0), 0) / timeline.length : 0,
        improvementTrend: this.calculateImprovementTrend(timeline)
      };
    } catch (error) {
      console.error('Failed to get video vault summary:', error);
      return {
        totalVideos: 0,
        latestVideo: null,
        averageScore: 0,
        improvementTrend: 'stable'
      };
    }
  }

  // Calculate improvement trend from video timeline
  static calculateImprovementTrend(timeline) {
    if (timeline.length < 2) return 'stable';
    
    const recentVideos = timeline.slice(0, 3);
    const olderVideos = timeline.slice(-3);
    
    const recentAvg = recentVideos.reduce((sum, video) => 
      sum + (video.analysisData?.overallScore || 0), 0) / recentVideos.length;
    const olderAvg = olderVideos.reduce((sum, video) => 
      sum + (video.analysisData?.overallScore || 0), 0) / olderVideos.length;
    
    const difference = recentAvg - olderAvg;
    
    if (difference > 0.3) return 'improving';
    if (difference < -0.3) return 'declining';
    return 'stable';
  }
}

export default ChatVideoIntegration;