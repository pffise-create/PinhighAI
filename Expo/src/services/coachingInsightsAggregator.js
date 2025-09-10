// CoachingInsightsAggregator.js - Analyzes conversation and video data for insights
import ChatHistoryManager from './chatHistoryManager';

export class CoachingInsightsAggregator {
  // Generate comprehensive coaching summary
  static async generateCoachingSummary(userId = 'default') {
    try {
      const conversation = await ChatHistoryManager.loadConversation(userId);
      const summary = await ChatHistoryManager.getConversationSummary(userId);
      
      return {
        topStrengths: await this.extractConsistentStrengths(conversation, summary),
        topImprovements: await this.identifyRecurringIssues(conversation, summary),
        recommendedDrills: await this.aggregateEffectiveDrills(conversation, summary),
        progressMetrics: await this.calculateProgressTrends(conversation, summary),
        coachingThemes: await this.extractCoachingThemes(conversation, summary),
        sessionData: {
          totalSessions: summary.totalMessages > 0 ? Math.ceil(summary.analysisCount / 2) + 1 : 0,
          videosAnalyzed: summary.analysisCount,
          lastSession: summary.lastInteraction,
          engagementLevel: this.calculateEngagementLevel(conversation, summary),
        }
      };
    } catch (error) {
      console.error('Failed to generate coaching summary:', error);
      return this.getFallbackSummary();
    }
  }

  // Extract consistent strengths from analysis history
  static async extractConsistentStrengths(conversation, summary) {
    const analysisMessages = conversation.messages.filter(msg => 
      msg.messageType === 'analysis_result' && msg.analysisData
    );

    if (analysisMessages.length === 0) {
      return this.getSampleStrengths();
    }

    const strengthCounts = {};
    const allStrengths = [];

    // Aggregate strengths from all analyses
    analysisMessages.forEach(msg => {
      if (msg.analysisData.strengths) {
        msg.analysisData.strengths.forEach(strength => {
          allStrengths.push(strength);
          const key = this.normalizeStrengthText(strength);
          strengthCounts[key] = (strengthCounts[key] || 0) + 1;
        });
      }
    });

    // Find most consistent strengths (mentioned multiple times)
    const consistentStrengths = Object.entries(strengthCounts)
      .filter(([_, count]) => count > 1 || analysisMessages.length === 1)
      .sort(([_, a], [__, b]) => b - a)
      .slice(0, 5)
      .map(([strength, count]) => ({
        text: this.humanizeStrengthText(strength),
        frequency: count,
        consistency: (count / analysisMessages.length * 100).toFixed(0),
        improvement: Math.random() > 0.5 ? 'stable' : 'improving', // Mock trend
      }));

    // If no consistent strengths, use most recent
    if (consistentStrengths.length === 0 && allStrengths.length > 0) {
      return allStrengths.slice(-3).map(strength => ({
        text: strength,
        frequency: 1,
        consistency: '100',
        improvement: 'new',
      }));
    }

    return consistentStrengths.length > 0 ? consistentStrengths : this.getSampleStrengths();
  }

  // Identify recurring improvement areas
  static async identifyRecurringIssues(conversation, summary) {
    const analysisMessages = conversation.messages.filter(msg => 
      msg.messageType === 'analysis_result' && msg.analysisData
    );

    if (analysisMessages.length === 0) {
      return this.getSampleImprovements();
    }

    const improvementCounts = {};
    const allImprovements = [];

    // Aggregate improvements from all analyses
    analysisMessages.forEach(msg => {
      if (msg.analysisData.improvements) {
        msg.analysisData.improvements.forEach(improvement => {
          allImprovements.push(improvement);
          const key = this.normalizeImprovementText(improvement);
          improvementCounts[key] = (improvementCounts[key] || 0) + 1;
        });
      }
    });

    // Find recurring issues (highest priority)
    const recurringImprovements = Object.entries(improvementCounts)
      .sort(([_, a], [__, b]) => b - a)
      .slice(0, 3)
      .map(([improvement, count]) => ({
        text: this.humanizeImprovementText(improvement),
        frequency: count,
        priority: count > 1 ? 'high' : 'medium',
        category: this.categorizeImprovement(improvement),
        progressTrend: this.mockProgressTrend(), // In real app, track actual progress
      }));

    return recurringImprovements.length > 0 ? recurringImprovements : this.getSampleImprovements();
  }

  // Aggregate effective practice drills
  static async aggregateEffectiveDrills(conversation, summary) {
    const analysisMessages = conversation.messages.filter(msg => 
      msg.messageType === 'analysis_result' && msg.analysisData
    );

    if (analysisMessages.length === 0) {
      return this.getSampleDrills();
    }

    const drillCounts = {};
    const allDrills = [];

    // Aggregate drills from all analyses
    analysisMessages.forEach(msg => {
      if (msg.analysisData.practiceRecommendations) {
        msg.analysisData.practiceRecommendations.forEach(drill => {
          allDrills.push(drill);
          const key = this.normalizeDrillText(drill);
          drillCounts[key] = (drillCounts[key] || 0) + 1;
        });
      }
    });

    // Find most recommended drills
    const topDrills = Object.entries(drillCounts)
      .sort(([_, a], [__, b]) => b - a)
      .slice(0, 6)
      .map(([drill, count]) => ({
        title: this.humanizeDrillText(drill),
        description: this.getDrillDescription(drill),
        frequency: count,
        effectiveness: this.mockDrillEffectiveness(),
        category: this.categorizeDrill(drill),
        timeRequired: this.estimateDrillTime(drill),
      }));

    return topDrills.length > 0 ? topDrills : this.getSampleDrills();
  }

  // Calculate progress trends and metrics
  static async calculateProgressTrends(conversation, summary) {
    const analysisMessages = conversation.messages.filter(msg => 
      msg.messageType === 'analysis_result' && msg.analysisData
    );

    if (analysisMessages.length < 2) {
      return this.getMockProgressMetrics();
    }

    // Calculate overall score trend
    const scores = analysisMessages.map(msg => ({
      score: msg.analysisData.overallScore || 7.5,
      date: new Date(msg.timestamp),
    }));

    const latestScore = scores[scores.length - 1].score;
    const firstScore = scores[0].score;
    const improvement = latestScore - firstScore;

    return {
      overall: {
        current: latestScore,
        previous: firstScore,
        improvement: improvement.toFixed(1),
        trend: improvement > 0 ? 'improving' : improvement < 0 ? 'declining' : 'stable',
      },
      categories: this.mockCategoryProgress(),
      milestones: this.generateMilestones(analysisMessages),
      recentWins: this.identifyRecentWins(analysisMessages),
      goalProgress: this.mockGoalProgress(),
    };
  }

  // Extract coaching themes and focus areas
  static async extractCoachingThemes(conversation, summary) {
    const analysisMessages = conversation.messages.filter(msg => 
      msg.messageType === 'analysis_result' && msg.analysisData
    );

    if (analysisMessages.length === 0) {
      return this.getSampleThemes();
    }

    // Extract primary themes from coaching responses
    const themes = {};
    const focusAreas = [];

    analysisMessages.forEach(msg => {
      if (msg.analysisData.improvements) {
        msg.analysisData.improvements.forEach(improvement => {
          const theme = this.extractThemeFromImprovement(improvement);
          themes[theme] = (themes[theme] || 0) + 1;
          focusAreas.push(improvement);
        });
      }
    });

    return {
      primaryThemes: Object.entries(themes)
        .sort(([_, a], [__, b]) => b - a)
        .slice(0, 3)
        .map(([theme, count]) => ({
          name: theme,
          frequency: count,
          status: 'active',
        })),
      activeFocusAreas: focusAreas.slice(-2), // Most recent focus areas
      evolutionPath: this.mockEvolutionPath(),
    };
  }

  // Calculate user engagement level
  static calculateEngagementLevel(conversation, summary) {
    const totalMessages = summary.totalMessages;
    const videoAnalyses = summary.analysisCount;
    const daysSinceFirst = Math.floor(
      (new Date() - new Date(conversation.userProfile?.lastInteraction || new Date())) / 
      (1000 * 60 * 60 * 24)
    );

    if (totalMessages === 0) return 'new';
    if (videoAnalyses >= 3 && totalMessages >= 10) return 'highly_engaged';
    if (videoAnalyses >= 1 && totalMessages >= 5) return 'engaged';
    return 'getting_started';
  }

  // Text normalization helpers
  static normalizeStrengthText(text) {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static normalizeImprovementText(text) {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static normalizeDrillText(text) {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static humanizeStrengthText(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  static humanizeImprovementText(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  static humanizeDrillText(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Categorization helpers
  static categorizeImprovement(improvement) {
    const categories = {
      'weight': 'fundamentals',
      'hip': 'fundamentals',
      'setup': 'fundamentals',
      'tempo': 'timing',
      'swing': 'technique',
      'impact': 'technique',
      'follow': 'technique',
    };

    for (const [key, category] of Object.entries(categories)) {
      if (improvement.includes(key)) return category;
    }
    return 'technique';
  }

  static categorizeDrill(drill) {
    if (drill.includes('slow') || drill.includes('tempo')) return 'timing';
    if (drill.includes('weight') || drill.includes('balance')) return 'fundamentals';
    if (drill.includes('impact') || drill.includes('contact')) return 'ball_striking';
    return 'general';
  }

  // Mock data generators for realistic examples
  static getSampleStrengths() {
    return [
      { text: 'Consistent setup position', frequency: 1, consistency: '100', improvement: 'stable' },
      { text: 'Good balance throughout swing', frequency: 1, consistency: '100', improvement: 'improving' },
      { text: 'Solid tempo and rhythm', frequency: 1, consistency: '100', improvement: 'stable' },
    ];
  }

  static getSampleImprovements() {
    return [
      { text: 'Weight shift timing', frequency: 1, priority: 'high', category: 'fundamentals', progressTrend: 'working_on' },
      { text: 'Hip rotation in downswing', frequency: 1, priority: 'medium', category: 'fundamentals', progressTrend: 'new' },
      { text: 'Impact position consistency', frequency: 1, priority: 'medium', category: 'technique', progressTrend: 'new' },
    ];
  }

  static getSampleDrills() {
    return [
      { 
        title: 'Slow motion swing practice', 
        description: 'Focus on proper positions at reduced speed',
        frequency: 1, 
        effectiveness: 'high', 
        category: 'timing',
        timeRequired: '10-15 minutes'
      },
      { 
        title: 'Weight shift step drill', 
        description: 'Practice weight transfer with step-through motion',
        frequency: 1, 
        effectiveness: 'high', 
        category: 'fundamentals',
        timeRequired: '5-10 minutes'
      },
      { 
        title: 'Impact bag training', 
        description: 'Improve contact and impact position',
        frequency: 1, 
        effectiveness: 'medium', 
        category: 'ball_striking',
        timeRequired: '10-15 minutes'
      },
    ];
  }

  static getSampleThemes() {
    return {
      primaryThemes: [
        { name: 'Fundamentals', frequency: 2, status: 'active' },
        { name: 'Timing', frequency: 1, status: 'active' },
      ],
      activeFocusAreas: ['Weight shift timing', 'Hip rotation'],
      evolutionPath: ['Setup consistency', 'Weight transfer', 'Hip rotation'],
    };
  }

  // Mock data for progress metrics
  static getMockProgressMetrics() {
    return {
      overall: {
        current: 7.5,
        previous: 7.2,
        improvement: '+0.3',
        trend: 'improving',
      },
      categories: [
        { name: 'Setup', score: 8.2, trend: 'stable' },
        { name: 'Backswing', score: 7.8, trend: 'improving' },
        { name: 'Impact', score: 7.1, trend: 'improving' },
        { name: 'Follow-through', score: 7.6, trend: 'stable' },
      ],
      milestones: [
        { name: 'First Video Analysis', date: new Date(), achieved: true },
        { name: 'Consistent Setup', date: null, achieved: false },
      ],
      recentWins: ['Improved weight shift timing', 'Better impact position'],
      goalProgress: { current: 1, target: 5, percentage: 20 },
    };
  }

  // Helper methods for mock data
  static mockProgressTrend() {
    const trends = ['working_on', 'improving', 'new', 'mastered'];
    return trends[Math.floor(Math.random() * trends.length)];
  }

  static mockDrillEffectiveness() {
    const levels = ['high', 'medium', 'low'];
    return levels[Math.floor(Math.random() * levels.length)];
  }

  static mockCategoryProgress() {
    return [
      { name: 'Setup', score: 8.2, trend: 'stable' },
      { name: 'Backswing', score: 7.8, trend: 'improving' },
      { name: 'Transition', score: 6.9, trend: 'working_on' },
      { name: 'Impact', score: 7.1, trend: 'improving' },
      { name: 'Follow-through', score: 7.6, trend: 'stable' },
    ];
  }

  static generateMilestones(analysisMessages) {
    const milestones = [
      { name: 'First Video Analysis', achieved: analysisMessages.length >= 1 },
      { name: 'Three Swing Analysis', achieved: analysisMessages.length >= 3 },
      { name: 'Week of Practice', achieved: false }, // Would track actual practice
      { name: 'Consistency Improvement', achieved: analysisMessages.length >= 2 },
    ];

    return milestones.map(milestone => ({
      ...milestone,
      date: milestone.achieved ? new Date() : null,
    }));
  }

  static identifyRecentWins(analysisMessages) {
    if (analysisMessages.length < 2) {
      return ['Completed first swing analysis!'];
    }

    const recent = analysisMessages.slice(-2);
    const wins = [];

    // Compare recent scores
    if (recent[1].analysisData.overallScore > recent[0].analysisData.overallScore) {
      wins.push('Overall swing score improved!');
    }

    // Mock additional wins
    const possibleWins = [
      'Better weight shift timing',
      'Improved impact position',
      'More consistent setup',
      'Better tempo control',
      'Stronger follow-through',
    ];

    return [...wins, ...possibleWins.slice(0, 2 - wins.length)];
  }

  static mockGoalProgress() {
    return {
      current: Math.floor(Math.random() * 3) + 1,
      target: 5,
      get percentage() {
        return Math.round((this.current / this.target) * 100);
      }
    };
  }

  static mockEvolutionPath() {
    return ['Setup fundamentals', 'Weight transfer basics', 'Hip rotation timing', 'Impact optimization'];
  }

  static extractThemeFromImprovement(improvement) {
    if (improvement.includes('weight') || improvement.includes('balance')) return 'Fundamentals';
    if (improvement.includes('tempo') || improvement.includes('timing')) return 'Timing';
    if (improvement.includes('hip') || improvement.includes('rotation')) return 'Body Movement';
    if (improvement.includes('impact') || improvement.includes('contact')) return 'Ball Striking';
    return 'Technique';
  }

  static getDrillDescription(drill) {
    const descriptions = {
      'slow motion': 'Focus on proper positions at reduced speed',
      'weight': 'Practice proper weight distribution and transfer',
      'impact': 'Improve contact and impact position',
      'hip': 'Develop proper hip rotation sequence',
      'alignment': 'Build consistent setup and alignment',
      'tempo': 'Develop consistent swing rhythm',
    };

    for (const [key, desc] of Object.entries(descriptions)) {
      if (drill.includes(key)) return desc;
    }
    return 'Improve overall swing mechanics';
  }

  static estimateDrillTime(drill) {
    if (drill.includes('slow') || drill.includes('step')) return '5-10 minutes';
    if (drill.includes('impact') || drill.includes('wall')) return '10-15 minutes';
    return '10-20 minutes';
  }

  // Fallback summary for error cases
  static getFallbackSummary() {
    return {
      topStrengths: this.getSampleStrengths(),
      topImprovements: this.getSampleImprovements(),
      recommendedDrills: this.getSampleDrills(),
      progressMetrics: this.getMockProgressMetrics(),
      coachingThemes: this.getSampleThemes(),
      sessionData: {
        totalSessions: 0,
        videosAnalyzed: 0,
        lastSession: new Date().toISOString(),
        engagementLevel: 'new',
      }
    };
  }
}

export default CoachingInsightsAggregator;