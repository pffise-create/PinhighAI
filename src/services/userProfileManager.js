import AsyncStorage from '@react-native-async-storage/async-storage';
import ChatHistoryManager from './chatHistoryManager';
import VideoVaultManager from './videoVaultManager';
import CoachingInsightsAggregator from './coachingInsightsAggregator';

const USER_PROFILE_PREFIX = 'user_profile_';
const USER_GOALS_PREFIX = 'user_goals_';
const COACHING_PREFERENCES_PREFIX = 'coaching_prefs_';

export class UserProfileManager {
  static async getUserProfile(userId = 'default') {
    try {
      const profileKey = `${USER_PROFILE_PREFIX}${userId}`;
      const profileJson = await AsyncStorage.getItem(profileKey);
      
      if (!profileJson) {
        return await this.createDefaultProfile(userId);
      }

      const profile = JSON.parse(profileJson);
      
      // Ensure profile has all required fields
      return {
        ...this.getDefaultProfileFields(),
        ...profile,
        userId,
        lastUpdated: profile.lastUpdated || new Date().toISOString()
      };
    } catch (error) {
      console.error('Failed to get user profile:', error);
      return await this.createDefaultProfile(userId);
    }
  }

  static async updateUserProfile(userId = 'default', updates) {
    try {
      const currentProfile = await this.getUserProfile(userId);
      const updatedProfile = {
        ...currentProfile,
        ...updates,
        lastUpdated: new Date().toISOString()
      };

      const profileKey = `${USER_PROFILE_PREFIX}${userId}`;
      await AsyncStorage.setItem(profileKey, JSON.stringify(updatedProfile));

      return updatedProfile;
    } catch (error) {
      console.error('Failed to update user profile:', error);
      throw error;
    }
  }

  static async getUserGoals(userId = 'default') {
    try {
      const goalsKey = `${USER_GOALS_PREFIX}${userId}`;
      const goalsJson = await AsyncStorage.getItem(goalsKey);
      
      if (!goalsJson) {
        return this.getDefaultGoals();
      }

      const goals = JSON.parse(goalsJson);
      
      // Update progress for all goals
      return await this.updateGoalsProgress(userId, goals);
    } catch (error) {
      console.error('Failed to get user goals:', error);
      return this.getDefaultGoals();
    }
  }

  static async updateUserGoals(userId = 'default', goals) {
    try {
      const updatedGoals = {
        ...goals,
        lastUpdated: new Date().toISOString()
      };

      const goalsKey = `${USER_GOALS_PREFIX}${userId}`;
      await AsyncStorage.setItem(goalsKey, JSON.stringify(updatedGoals));

      return updatedGoals;
    } catch (error) {
      console.error('Failed to update user goals:', error);
      throw error;
    }
  }

  static async getCoachingPreferences(userId = 'default') {
    try {
      const prefsKey = `${COACHING_PREFERENCES_PREFIX}${userId}`;
      const prefsJson = await AsyncStorage.getItem(prefsKey);
      
      if (!prefsJson) {
        return this.getDefaultCoachingPreferences();
      }

      return JSON.parse(prefsJson);
    } catch (error) {
      console.error('Failed to get coaching preferences:', error);
      return this.getDefaultCoachingPreferences();
    }
  }

  static async updateCoachingPreferences(userId = 'default', preferences) {
    try {
      const updatedPrefs = {
        ...preferences,
        lastUpdated: new Date().toISOString()
      };

      const prefsKey = `${COACHING_PREFERENCES_PREFIX}${userId}`;
      await AsyncStorage.setItem(prefsKey, JSON.stringify(updatedPrefs));

      return updatedPrefs;
    } catch (error) {
      console.error('Failed to update coaching preferences:', error);
      throw error;
    }
  }

  static async generateUserStats(userId = 'default') {
    try {
      const [chatSummary, videos, insights] = await Promise.all([
        ChatHistoryManager.getConversationSummary(userId),
        VideoVaultManager.getVideoTimeline(userId),
        CoachingInsightsAggregator.generateCoachingSummary(userId)
      ]);

      const stats = {
        totalSessions: chatSummary.totalMessages,
        videosAnalyzed: chatSummary.analysisCount,
        totalVideos: videos.length,
        averageScore: videos.length > 0 ? 
          videos.reduce((sum, v) => sum + (v.analysisData?.overallScore || 0), 0) / videos.length : 0,
        bestScore: videos.length > 0 ? 
          Math.max(...videos.map(v => v.analysisData?.overallScore || 0)) : 0,
        improvementTrend: this.calculateImprovementTrend(videos),
        streakData: this.calculateStreaks(videos),
        focusAreas: insights?.topImprovements || [],
        strengths: insights?.topStrengths || [],
        daysActive: this.calculateDaysActive(chatSummary.lastInteraction),
        joinDate: this.getJoinDate(userId)
      };

      return stats;
    } catch (error) {
      console.error('Failed to generate user stats:', error);
      return this.getDefaultStats();
    }
  }

  static async addGoal(userId = 'default', goal) {
    try {
      const currentGoals = await this.getUserGoals(userId);
      const newGoal = {
        id: `goal_${Date.now()}`,
        createdAt: new Date().toISOString(),
        ...goal
      };

      const goalCategory = goal.type === 'handicap' ? 'golfGoals' : 'swingGoals';
      const updatedGoals = {
        ...currentGoals,
        [goalCategory]: [...currentGoals[goalCategory], newGoal]
      };

      return await this.updateUserGoals(userId, updatedGoals);
    } catch (error) {
      console.error('Failed to add goal:', error);
      throw error;
    }
  }

  static async updateGoal(userId = 'default', goalId, updates) {
    try {
      const currentGoals = await this.getUserGoals(userId);
      let updatedGoals = { ...currentGoals };
      let goalFound = false;

      // Update in swingGoals
      updatedGoals.swingGoals = currentGoals.swingGoals.map(goal => {
        if (goal.id === goalId) {
          goalFound = true;
          return { ...goal, ...updates, updatedAt: new Date().toISOString() };
        }
        return goal;
      });

      // Update in golfGoals if not found in swingGoals
      if (!goalFound) {
        updatedGoals.golfGoals = currentGoals.golfGoals.map(goal => {
          if (goal.id === goalId) {
            return { ...goal, ...updates, updatedAt: new Date().toISOString() };
          }
          return goal;
        });
      }

      return await this.updateUserGoals(userId, updatedGoals);
    } catch (error) {
      console.error('Failed to update goal:', error);
      throw error;
    }
  }

  static async deleteGoal(userId = 'default', goalId) {
    try {
      const currentGoals = await this.getUserGoals(userId);
      const updatedGoals = {
        ...currentGoals,
        swingGoals: currentGoals.swingGoals.filter(goal => goal.id !== goalId),
        golfGoals: currentGoals.golfGoals.filter(goal => goal.id !== goalId)
      };

      return await this.updateUserGoals(userId, updatedGoals);
    } catch (error) {
      console.error('Failed to delete goal:', error);
      throw error;
    }
  }

  static async exportUserData(userId = 'default') {
    try {
      const [profile, goals, preferences, videos, chatHistory, insights] = await Promise.all([
        this.getUserProfile(userId),
        this.getUserGoals(userId),
        this.getCoachingPreferences(userId),
        VideoVaultManager.getVideoTimeline(userId),
        ChatHistoryManager.loadConversation(userId),
        CoachingInsightsAggregator.generateCoachingSummary(userId)
      ]);

      return {
        exportDate: new Date().toISOString(),
        userId,
        profile,
        goals,
        preferences,
        statistics: await this.generateUserStats(userId),
        videos: videos.map(v => ({
          ...v,
          videoUrl: null, // Remove actual video URLs for privacy
          thumbnailUrl: null
        })),
        chatSummary: {
          totalMessages: chatHistory.messageCount,
          analysisCount: chatHistory.messages.filter(m => m.messageType === 'analysis_result').length,
          lastInteraction: chatHistory.userProfile.lastInteraction
        },
        insights
      };
    } catch (error) {
      console.error('Failed to export user data:', error);
      throw error;
    }
  }

  static async deleteUserData(userId = 'default') {
    try {
      const keys = [
        `${USER_PROFILE_PREFIX}${userId}`,
        `${USER_GOALS_PREFIX}${userId}`,
        `${COACHING_PREFERENCES_PREFIX}${userId}`
      ];

      await Promise.all([
        ...keys.map(key => AsyncStorage.removeItem(key)),
        ChatHistoryManager.resetConversation(userId)
        // Note: VideoVaultManager data would need separate cleanup
      ]);

      return true;
    } catch (error) {
      console.error('Failed to delete user data:', error);
      throw error;
    }
  }

  // Private helper methods
  static async createDefaultProfile(userId) {
    const profile = {
      ...this.getDefaultProfileFields(),
      userId,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };

    const profileKey = `${USER_PROFILE_PREFIX}${userId}`;
    await AsyncStorage.setItem(profileKey, JSON.stringify(profile));

    return profile;
  }

  static getDefaultProfileFields() {
    return {
      name: '',
      email: '',
      handicap: null,
      experience: 'intermediate', // 'beginner', 'intermediate', 'advanced'
      golfGoals: [],
      preferredCoach: 'encouraging', // 'encouraging', 'analytical', 'balanced'
      notifications: {
        enabled: true,
        practiceReminders: true,
        progressUpdates: true,
        goalDeadlines: true
      },
      privacy: {
        dataSharing: false,
        analytics: true
      }
    };
  }

  static getDefaultGoals() {
    return {
      swingGoals: [],
      golfGoals: [],
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
  }

  static getDefaultCoachingPreferences() {
    return {
      coachingStyle: 'encouraging', // 'encouraging', 'analytical', 'balanced'
      focusAreas: [], // Areas user wants to prioritize
      sessionFrequency: 'weekly', // 'daily', 'weekly', 'monthly'
      reminderSettings: {
        practiceReminders: true,
        progressCheckins: true,
        goalDeadlines: true
      },
      drillPreferences: {
        difficulty: 'intermediate',
        duration: 'medium', // 'short', 'medium', 'long'
        equipment: ['clubs'] // Available equipment for drills
      },
      analysisDetail: 'standard', // 'basic', 'standard', 'detailed'
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
  }

  static async updateGoalsProgress(userId, goals) {
    try {
      const videos = await VideoVaultManager.getVideoTimeline(userId);
      const insights = await CoachingInsightsAggregator.generateCoachingSummary(userId);

      // Update swing goals progress
      const updatedSwingGoals = goals.swingGoals.map(goal => {
        let currentProgress = 0;

        if (goal.type === 'overall_score' && videos.length > 0) {
          const recentVideos = videos.slice(0, 5);
          currentProgress = recentVideos.reduce((sum, v) => 
            sum + (v.analysisData?.overallScore || 0), 0) / recentVideos.length;
        } else if (goal.type === 'improvement_area' && insights?.topImprovements) {
          // Check if the improvement area is still in recent top improvements
          const isStillImproving = insights.topImprovements.some(imp => 
            imp.area.toLowerCase().includes(goal.target.toLowerCase())
          );
          currentProgress = isStillImproving ? goal.currentScore || 0 : Math.min(goal.targetScore, (goal.currentScore || 0) + 0.5);
        }

        return {
          ...goal,
          currentScore: currentProgress || goal.currentScore,
          progress: goal.targetScore ? (currentProgress / goal.targetScore) * 100 : 0,
          isCompleted: currentProgress >= (goal.targetScore || 0)
        };
      });

      return {
        ...goals,
        swingGoals: updatedSwingGoals,
        golfGoals: goals.golfGoals.map(goal => ({
          ...goal,
          progress: goal.targetValue && goal.currentValue ? 
            ((goal.targetValue - goal.currentValue) / goal.targetValue) * 100 : 0,
          isCompleted: goal.currentValue <= (goal.targetValue || Infinity)
        }))
      };
    } catch (error) {
      console.error('Failed to update goals progress:', error);
      return goals;
    }
  }

  static calculateImprovementTrend(videos) {
    if (videos.length < 2) return 'stable';

    const recent = videos.slice(0, 3);
    const older = videos.slice(-3);

    const recentAvg = recent.reduce((sum, v) => 
      sum + (v.analysisData?.overallScore || 0), 0) / recent.length;
    const olderAvg = older.reduce((sum, v) => 
      sum + (v.analysisData?.overallScore || 0), 0) / older.length;

    const diff = recentAvg - olderAvg;
    
    if (diff > 0.3) return 'improving';
    if (diff < -0.3) return 'declining';
    return 'stable';
  }

  static calculateStreaks(videos) {
    if (videos.length < 2) return { current: 0, longest: 0 };

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    let previousScore = 0;

    videos.reverse().forEach(video => {
      const score = video.analysisData?.overallScore || 0;
      if (score >= previousScore) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
      previousScore = score;
    });

    // Calculate current streak
    let currentScore = 0;
    videos.forEach(video => {
      const score = video.analysisData?.overallScore || 0;
      if (score >= currentScore) {
        currentStreak++;
      } else {
        return;
      }
      currentScore = score;
    });

    return { current: currentStreak, longest: longestStreak };
  }

  static calculateDaysActive(lastInteraction) {
    if (!lastInteraction) return 0;
    
    const lastDate = new Date(lastInteraction);
    const now = new Date();
    const diffTime = Math.abs(now - lastDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  static getJoinDate(userId) {
    // In a real app, this would come from user registration data
    // For now, we'll use a default date
    return new Date('2025-01-01').toISOString();
  }

  static getDefaultStats() {
    return {
      totalSessions: 0,
      videosAnalyzed: 0,
      totalVideos: 0,
      averageScore: 0,
      bestScore: 0,
      improvementTrend: 'stable',
      streakData: { current: 0, longest: 0 },
      focusAreas: [],
      strengths: [],
      daysActive: 0,
      joinDate: new Date().toISOString()
    };
  }
}

export default UserProfileManager;