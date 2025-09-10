/**
 * Sprint 4B: Progress Tracking Algorithms
 * 
 * This module implements sophisticated algorithms to track coaching progress
 * across multiple dimensions, identify learning patterns, and measure
 * improvement velocity for personalized coaching optimization.
 */

const AWS = require('aws-sdk');

// Progress tracking configuration
const PROGRESS_CONFIG = {
  TRACKING_DIMENSIONS: {
    TECHNICAL_SKILL: 'technical_skill',
    CONSISTENCY: 'consistency', 
    MENTAL_GAME: 'mental_game',
    COURSE_MANAGEMENT: 'course_management',
    OVERALL_PERFORMANCE: 'overall_performance'
  },
  
  MEASUREMENT_WINDOWS: {
    IMMEDIATE: 3,        // 3 days
    SHORT_TERM: 7,       // 1 week
    MEDIUM_TERM: 30,     // 1 month
    LONG_TERM: 90,       // 3 months
    SEASONAL: 180        // 6 months
  },
  
  IMPROVEMENT_THRESHOLDS: {
    BREAKTHROUGH: 0.25,    // 25% improvement
    SIGNIFICANT: 0.15,     // 15% improvement  
    MODERATE: 0.08,        // 8% improvement
    MARGINAL: 0.03,        // 3% improvement
    PLATEAU: 0.01          // 1% improvement
  },
  
  CONSISTENCY_METRICS: {
    VARIANCE_THRESHOLD: 0.15,    // 15% variance for consistency
    STREAK_THRESHOLD: 5,         // 5 consecutive improvements
    STABILITY_WINDOW: 10         // 10 data points for stability
  },
  
  VELOCITY_CALCULATIONS: {
    SMOOTHING_FACTOR: 0.3,       // Exponential smoothing
    MIN_DATA_POINTS: 5,          // Minimum points for velocity
    VELOCITY_HORIZON: 14         // Days to project forward
  }
};

const SKILL_DIMENSIONS = {
  'Setup & Address Position': {
    weight: 0.2,
    category: 'fundamentals',
    learningCurve: 'moderate',
    typical_mastery_sessions: 15
  },
  'Swing Plane & Path': {
    weight: 0.25,
    category: 'mechanics',
    learningCurve: 'steep',
    typical_mastery_sessions: 30
  },
  'Impact Position': {
    weight: 0.3,
    category: 'mechanics',
    learningCurve: 'steep',
    typical_mastery_sessions: 25
  },
  'Tempo & Timing': {
    weight: 0.15,
    category: 'feel',
    learningCurve: 'gradual',
    typical_mastery_sessions: 20
  },
  'Ball Flight Control': {
    weight: 0.25,
    category: 'application',
    learningCurve: 'moderate',
    typical_mastery_sessions: 35
  },
  'Mental Game': {
    weight: 0.15,
    category: 'mental',
    learningCurve: 'ongoing',
    typical_mastery_sessions: null // Ongoing development
  },
  'Course Management': {
    weight: 0.1,
    category: 'strategy',
    learningCurve: 'gradual',
    typical_mastery_sessions: 40
  }
};

/**
 * Progress Tracking Engine
 */
class ProgressTrackingEngine {
  
  constructor() {
    this.dynamodb = new AWS.DynamoDB.DocumentClient();
    this.cloudwatch = new AWS.CloudWatch();
    
    this.progressTable = 'coaching-progress-tracking';
    this.analyticsTable = 'coaching-analytics';
    this.conversationsTable = 'coaching-conversations';
  }
  
  /**
   * Generate comprehensive progress tracking for a user
   */
  async generateProgressTracking(userId, timeWindow = 'MEDIUM_TERM') {
    try {
      console.log(`📈 Generating progress tracking for user: ${userId} (${timeWindow})`);
      
      const tracking = {
        userId: userId,
        timeWindow: timeWindow,
        generatedAt: new Date().toISOString(),
        
        // Core progress metrics
        overallProgress: null,
        dimensionalProgress: {},
        learningVelocity: null,
        consistencyAnalysis: null,
        
        // Learning patterns
        learningPatterns: null,
        masteryProgression: null,
        plateauAnalysis: null,
        
        // Predictive insights
        progressProjections: null,
        optimizationRecommendations: [],
        
        // Metadata
        dataQuality: null,
        trackingMetadata: null
      };
      
      // Get user's historical data
      const userData = await this.getUserProgressData(userId, timeWindow);
      
      if (!userData || userData.length === 0) {
        return {
          ...tracking,
          message: 'Insufficient data for progress tracking',
          dataPoints: 0
        };
      }
      
      console.log(`📊 Analyzing ${userData.length} data points for progress tracking`);
      
      // Calculate overall progress
      tracking.overallProgress = await this.calculateOverallProgress(userData);
      
      // Analyze progress by dimension
      tracking.dimensionalProgress = await this.analyzeDimensionalProgress(userData);
      
      // Calculate learning velocity
      tracking.learningVelocity = await this.calculateLearningVelocity(userData);
      
      // Analyze consistency patterns
      tracking.consistencyAnalysis = await this.analyzeConsistencyPatterns(userData);
      
      // Identify learning patterns
      tracking.learningPatterns = await this.identifyLearningPatterns(userData);
      
      // Track mastery progression
      tracking.masteryProgression = await this.trackMasteryProgression(userData);
      
      // Analyze plateaus and breakthroughs
      tracking.plateauAnalysis = await this.analyzePlateausAndBreakthroughs(userData);
      
      // Generate progress projections
      tracking.progressProjections = await this.generateProgressProjections(tracking);
      
      // Create optimization recommendations
      tracking.optimizationRecommendations = await this.generateOptimizationRecommendations(tracking);
      
      // Assess data quality
      tracking.dataQuality = this.assessDataQuality(userData);
      
      // Add tracking metadata
      tracking.trackingMetadata = this.generateTrackingMetadata(userData, tracking);
      
      // Store progress tracking results
      await this.storeProgressTracking(tracking);
      
      console.log('✅ Progress tracking completed successfully');
      return tracking;
      
    } catch (error) {
      console.error('❌ Error generating progress tracking:', error);
      throw error;
    }
  }
  
  /**
   * Calculate overall progress across all dimensions
   */
  async calculateOverallProgress(userData) {
    try {
      console.log('📊 Calculating overall progress...');
      
      if (userData.length < 2) {
        return {
          progressTrend: 'insufficient_data',
          improvementRate: 0,
          overallScore: 0
        };
      }
      
      // Sort data chronologically
      const sortedData = userData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      const progress = {
        progressTrend: 'stable',
        improvementRate: 0,
        overallScore: 0,
        confidenceLevel: 0,
        
        // Detailed metrics
        baselineScore: 0,
        currentScore: 0,
        peakScore: 0,
        progressConsistency: 0,
        timeToProgress: 0,
        
        // Segmented analysis
        earlyProgress: null,
        recentProgress: null,
        accelerationPhases: [],
        
        // Statistical measures
        progressStandardDeviation: 0,
        progressCorrelation: 0
      };
      
      // Calculate baseline and current scores
      progress.baselineScore = this.calculateCompositeScore(sortedData[0]);
      progress.currentScore = this.calculateCompositeScore(sortedData[sortedData.length - 1]);
      progress.peakScore = Math.max(...sortedData.map(d => this.calculateCompositeScore(d)));
      
      // Calculate improvement rate
      const totalImprovement = progress.currentScore - progress.baselineScore;
      const timeSpanDays = (new Date(sortedData[sortedData.length - 1].timestamp) - new Date(sortedData[0].timestamp)) / (1000 * 60 * 60 * 24);
      progress.improvementRate = timeSpanDays > 0 ? (totalImprovement / progress.baselineScore) / timeSpanDays : 0;
      
      // Determine progress trend
      if (progress.improvementRate > PROGRESS_CONFIG.IMPROVEMENT_THRESHOLDS.BREAKTHROUGH / 30) {
        progress.progressTrend = 'breakthrough';
      } else if (progress.improvementRate > PROGRESS_CONFIG.IMPROVEMENT_THRESHOLDS.SIGNIFICANT / 30) {
        progress.progressTrend = 'significant_improvement';
      } else if (progress.improvementRate > PROGRESS_CONFIG.IMPROVEMENT_THRESHOLDS.MODERATE / 30) {
        progress.progressTrend = 'moderate_improvement';
      } else if (progress.improvementRate > PROGRESS_CONFIG.IMPROVEMENT_THRESHOLDS.MARGINAL / 30) {
        progress.progressTrend = 'marginal_improvement';
      } else if (Math.abs(progress.improvementRate) <= PROGRESS_CONFIG.IMPROVEMENT_THRESHOLDS.PLATEAU / 30) {
        progress.progressTrend = 'plateau';
      } else {
        progress.progressTrend = 'declining';
      }
      
      // Calculate overall score (0-100)
      progress.overallScore = Math.min(100, Math.max(0, progress.currentScore));
      
      // Calculate progress consistency
      const scores = sortedData.map(d => this.calculateCompositeScore(d));
      const progressPoints = [];
      for (let i = 1; i < scores.length; i++) {
        progressPoints.push(scores[i] - scores[i-1]);
      }
      
      if (progressPoints.length > 0) {
        const avgProgress = progressPoints.reduce((sum, p) => sum + p, 0) / progressPoints.length;
        const progressVariance = progressPoints.reduce((sum, p) => sum + Math.pow(p - avgProgress, 2), 0) / progressPoints.length;
        progress.progressStandardDeviation = Math.sqrt(progressVariance);
        progress.progressConsistency = Math.max(0, 1 - (progress.progressStandardDeviation / Math.abs(avgProgress || 1)));
      }
      
      // Analyze early vs recent progress
      const midPoint = Math.floor(sortedData.length / 2);
      const earlyData = sortedData.slice(0, midPoint);
      const recentData = sortedData.slice(midPoint);
      
      if (earlyData.length >= 2) {
        progress.earlyProgress = this.calculateProgressSegment(earlyData);
      }
      
      if (recentData.length >= 2) {
        progress.recentProgress = this.calculateProgressSegment(recentData);
      }
      
      // Identify acceleration phases
      progress.accelerationPhases = this.identifyAccelerationPhases(sortedData);
      
      // Calculate confidence level
      progress.confidenceLevel = this.calculateProgressConfidence(progress, sortedData.length);
      
      return progress;
      
    } catch (error) {
      console.error('❌ Error calculating overall progress:', error);
      return {
        progressTrend: 'calculation_error',
        improvementRate: 0,
        overallScore: 0,
        error: error.message
      };
    }
  }
  
  /**
   * Analyze progress by individual dimensions
   */
  async analyzeDimensionalProgress(userData) {
    try {
      console.log('📊 Analyzing dimensional progress...');
      
      const dimensionalProgress = {};
      
      // Analyze each skill dimension
      Object.keys(SKILL_DIMENSIONS).forEach(dimension => {
        dimensionalProgress[dimension] = this.analyzeDimensionProgress(userData, dimension);
      });
      
      // Add cross-dimensional analysis
      dimensionalProgress._crossDimensionalInsights = this.analyzeCrossDimensionalPatterns(dimensionalProgress);
      
      return dimensionalProgress;
      
    } catch (error) {
      console.error('❌ Error analyzing dimensional progress:', error);
      return {};
    }
  }
  
  /**
   * Analyze progress for a specific dimension
   */
  analyzeDimensionProgress(userData, dimension) {
    try {
      const dimensionData = userData.map(data => ({
        timestamp: data.timestamp,
        score: this.extractDimensionScore(data, dimension),
        context: data.context
      })).filter(d => d.score !== null);
      
      if (dimensionData.length < 2) {
        return {
          trend: 'insufficient_data',
          improvement: 0,
          confidence: 0
        };
      }
      
      const sorted = dimensionData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const firstScore = sorted[0].score;
      const lastScore = sorted[sorted.length - 1].score;
      const improvement = firstScore > 0 ? (lastScore - firstScore) / firstScore : 0;
      
      // Calculate trend
      let trend = 'stable';
      const skillConfig = SKILL_DIMENSIONS[dimension];
      const expectedRate = this.getExpectedImprovementRate(skillConfig);
      
      if (improvement > expectedRate * 1.5) {
        trend = 'accelerated';
      } else if (improvement > expectedRate) {
        trend = 'on_track';
      } else if (improvement > expectedRate * 0.5) {
        trend = 'slow_progress';
      } else if (improvement > 0) {
        trend = 'minimal_progress';
      } else {
        trend = 'plateau_or_declining';
      }
      
      // Calculate consistency
      const scores = sorted.map(d => d.score);
      const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
      const variance = scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length;
      const consistency = Math.max(0, 1 - (Math.sqrt(variance) / avgScore));
      
      // Identify learning phases
      const learningPhases = this.identifyLearningPhases(sorted, skillConfig);
      
      // Calculate mastery progress
      const masteryProgress = this.calculateMasteryProgress(sorted, skillConfig);
      
      return {
        trend: trend,
        improvement: Math.round(improvement * 100) / 100,
        confidence: consistency,
        currentScore: lastScore,
        baselineScore: firstScore,
        peakScore: Math.max(...scores),
        consistency: Math.round(consistency * 100) / 100,
        learningPhases: learningPhases,
        masteryProgress: masteryProgress,
        expectedProgress: expectedRate,
        dataPoints: dimensionData.length
      };
      
    } catch (error) {
      console.error(`❌ Error analyzing dimension ${dimension}:`, error);
      return {
        trend: 'analysis_error',
        improvement: 0,
        confidence: 0,
        error: error.message
      };
    }
  }
  
  /**
   * Calculate learning velocity
   */
  async calculateLearningVelocity(userData) {
    try {
      console.log('🚀 Calculating learning velocity...');
      
      if (userData.length < PROGRESS_CONFIG.VELOCITY_CALCULATIONS.MIN_DATA_POINTS) {
        return {
          velocity: 0,
          acceleration: 0,
          trend: 'insufficient_data'
        };
      }
      
      const sorted = userData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const velocityMetrics = {
        currentVelocity: 0,
        averageVelocity: 0,
        peakVelocity: 0,
        acceleration: 0,
        velocityTrend: 'stable',
        velocityConsistency: 0,
        projectedProgress: null
      };
      
      // Calculate velocity between each data point
      const velocities = [];
      for (let i = 1; i < sorted.length; i++) {
        const timeDiff = (new Date(sorted[i].timestamp) - new Date(sorted[i-1].timestamp)) / (1000 * 60 * 60 * 24);
        const scoreDiff = this.calculateCompositeScore(sorted[i]) - this.calculateCompositeScore(sorted[i-1]);
        
        if (timeDiff > 0) {
          velocities.push({
            velocity: scoreDiff / timeDiff,
            timestamp: sorted[i].timestamp,
            timeDiff: timeDiff,
            scoreDiff: scoreDiff
          });
        }
      }
      
      if (velocities.length === 0) {
        return velocityMetrics;
      }
      
      // Calculate current velocity (exponentially weighted)
      const smoothingFactor = PROGRESS_CONFIG.VELOCITY_CALCULATIONS.SMOOTHING_FACTOR;
      let smoothedVelocity = velocities[0].velocity;
      
      for (let i = 1; i < velocities.length; i++) {
        smoothedVelocity = smoothingFactor * velocities[i].velocity + (1 - smoothingFactor) * smoothedVelocity;
      }
      
      velocityMetrics.currentVelocity = smoothedVelocity;
      velocityMetrics.averageVelocity = velocities.reduce((sum, v) => sum + v.velocity, 0) / velocities.length;
      velocityMetrics.peakVelocity = Math.max(...velocities.map(v => v.velocity));
      
      // Calculate acceleration (change in velocity)
      if (velocities.length >= 3) {
        const recentVelocities = velocities.slice(-3);
        const accelerations = [];
        
        for (let i = 1; i < recentVelocities.length; i++) {
          const velDiff = recentVelocities[i].velocity - recentVelocities[i-1].velocity;
          const timeDiff = recentVelocities[i].timeDiff;
          accelerations.push(velDiff / timeDiff);
        }
        
        velocityMetrics.acceleration = accelerations.reduce((sum, a) => sum + a, 0) / accelerations.length;
      }
      
      // Determine velocity trend
      if (velocityMetrics.acceleration > 0.01) {
        velocityMetrics.velocityTrend = 'accelerating';
      } else if (velocityMetrics.acceleration < -0.01) {
        velocityMetrics.velocityTrend = 'decelerating';
      } else {
        velocityMetrics.velocityTrend = 'stable';
      }
      
      // Calculate velocity consistency
      const velocityValues = velocities.map(v => v.velocity);
      const avgVel = velocityValues.reduce((sum, v) => sum + v, 0) / velocityValues.length;
      const velVariance = velocityValues.reduce((sum, v) => sum + Math.pow(v - avgVel, 2), 0) / velocityValues.length;
      velocityMetrics.velocityConsistency = Math.max(0, 1 - (Math.sqrt(velVariance) / Math.abs(avgVel || 1)));
      
      // Project future progress
      const projectionHorizon = PROGRESS_CONFIG.VELOCITY_CALCULATIONS.VELOCITY_HORIZON;
      const currentScore = this.calculateCompositeScore(sorted[sorted.length - 1]);
      const projectedScore = currentScore + (velocityMetrics.currentVelocity * projectionHorizon);
      
      velocityMetrics.projectedProgress = {
        horizon: projectionHorizon,
        currentScore: currentScore,
        projectedScore: Math.max(0, projectedScore),
        projectedImprovement: projectedScore - currentScore,
        confidence: velocityMetrics.velocityConsistency
      };
      
      return velocityMetrics;
      
    } catch (error) {
      console.error('❌ Error calculating learning velocity:', error);
      return {
        velocity: 0,
        acceleration: 0,
        trend: 'calculation_error',
        error: error.message
      };
    }
  }
  
  /**
   * Helper functions
   */
  
  async getUserProgressData(userId, timeWindow) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - PROGRESS_CONFIG.MEASUREMENT_WINDOWS[timeWindow]);
      
      // Get swing analysis data
      const swingParams = {
        TableName: 'golf-coach-analyses',
        FilterExpression: 'user_id = :userId AND created_at > :cutoffDate AND attribute_exists(ai_analysis)',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':cutoffDate': cutoffDate.toISOString()
        }
      };
      
      const swingResult = await this.dynamodb.scan(swingParams).promise();
      
      // Get conversation data
      const convParams = {
        TableName: this.conversationsTable,
        FilterExpression: 'user_id = :userId AND last_updated > :cutoffDate',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':cutoffDate': cutoffDate.toISOString()
        }
      };
      
      const convResult = await this.dynamodb.scan(convParams).promise();
      
      // Combine and format data
      const progressData = [];
      
      // Add swing analysis data points
      (swingResult.Items || []).forEach(swing => {
        progressData.push({
          timestamp: swing.created_at,
          type: 'swing_analysis',
          source_id: swing.analysis_id,
          data: swing.ai_analysis,
          context: {
            swing_type: swing.swing_type,
            video_url: swing.video_url,
            user_notes: swing.user_notes
          }
        });
      });
      
      // Add conversation insights
      (convResult.Items || []).forEach(conv => {
        if (conv.coaching_themes && conv.coaching_themes.length > 0) {
          progressData.push({
            timestamp: conv.last_updated,
            type: 'conversation_insights',
            source_id: conv.conversation_id,
            data: {
              themes: conv.coaching_themes,
              progress_mentions: this.extractProgressMentions(conv.recent_messages || [])
            },
            context: {
              message_count: conv.recent_messages?.length || 0,
              conversation_summary: conv.conversation_summary
            }
          });
        }
      });
      
      return progressData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
    } catch (error) {
      console.error(`❌ Error getting user progress data for ${userId}:`, error);
      return [];
    }
  }
  
  calculateCompositeScore(dataPoint) {
    try {
      if (dataPoint.type === 'swing_analysis' && dataPoint.data) {
        return dataPoint.data.overall_score || 0;
      } else if (dataPoint.type === 'conversation_insights' && dataPoint.data) {
        // Calculate score based on theme progress
        const themes = dataPoint.data.themes || [];
        if (themes.length === 0) return 0;
        
        const themeScores = themes.map(theme => {
          const progressPattern = theme.progressPattern;
          if (!progressPattern) return 50; // Default neutral score
          
          switch (progressPattern.overallTrend) {
            case 'improving': return 75;
            case 'excellent_progress': return 90;
            case 'good_progress': return 70;
            case 'struggling': return 30;
            case 'needs_attention': return 25;
            default: return 50;
          }
        });
        
        return themeScores.reduce((sum, score) => sum + score, 0) / themeScores.length;
      }
      
      return 0;
    } catch (error) {
      return 0;
    }
  }
  
  extractDimensionScore(dataPoint, dimension) {
    try {
      if (dataPoint.type === 'swing_analysis' && dataPoint.data) {
        // Map swing analysis fields to dimensions
        const dimensionMapping = {
          'Setup & Address Position': 'setup_score',
          'Swing Plane & Path': 'swing_plane_score', 
          'Impact Position': 'impact_score',
          'Tempo & Timing': 'tempo_score',
          'Ball Flight Control': 'ball_flight_score'
        };
        
        const field = dimensionMapping[dimension];
        return field ? (dataPoint.data[field] || dataPoint.data.overall_score) : null;
      } else if (dataPoint.type === 'conversation_insights' && dataPoint.data) {
        // Extract theme-based scores
        const themes = dataPoint.data.themes || [];
        const relevantTheme = themes.find(t => t.name === dimension);
        
        if (relevantTheme && relevantTheme.progressPattern) {
          const pattern = relevantTheme.progressPattern;
          switch (pattern.overallTrend) {
            case 'improving': return 75;
            case 'excellent_progress': return 90;
            case 'good_progress': return 70;
            case 'struggling': return 30;
            case 'needs_attention': return 25;
            default: return 50;
          }
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
  
  async storeProgressTracking(tracking) {
    try {
      const record = {
        tracking_id: `progress_${tracking.userId}_${Date.now()}`,
        user_id: tracking.userId,
        time_window: tracking.timeWindow,
        generated_at: tracking.generatedAt,
        tracking_data: tracking,
        created_at: new Date().toISOString()
      };
      
      await this.dynamodb.put({
        TableName: this.progressTable,
        Item: record
      }).promise();
      
      console.log('✅ Progress tracking stored successfully');
      
    } catch (error) {
      console.error('❌ Error storing progress tracking:', error);
    }
  }
  
  // Additional helper methods would be implemented here:
  // - calculateProgressSegment
  // - identifyAccelerationPhases
  // - calculateProgressConfidence
  // - analyzeCrossDimensionalPatterns
  // - identifyLearningPhases
  // - calculateMasteryProgress
  // - getExpectedImprovementRate
  // - analyzeConsistencyPatterns
  // - identifyLearningPatterns
  // - trackMasteryProgression
  // - analyzePlateausAndBreakthroughs
  // - generateProgressProjections
  // - generateOptimizationRecommendations
  // - assessDataQuality
  // - generateTrackingMetadata
  // - extractProgressMentions
  
  // Simplified implementations for key functions:
  
  calculateProgressSegment(data) {
    if (data.length < 2) return null;
    
    const first = this.calculateCompositeScore(data[0]);
    const last = this.calculateCompositeScore(data[data.length - 1]);
    const improvement = first > 0 ? (last - first) / first : 0;
    
    return {
      improvement: improvement,
      trend: improvement > 0.1 ? 'improving' : improvement < -0.1 ? 'declining' : 'stable',
      dataPoints: data.length
    };
  }
  
  identifyAccelerationPhases(data) {
    const phases = [];
    const scores = data.map(d => this.calculateCompositeScore(d));
    
    for (let i = 2; i < scores.length; i++) {
      const recentImprovement = scores[i] - scores[i-1];
      const previousImprovement = scores[i-1] - scores[i-2];
      
      if (recentImprovement > previousImprovement * 1.5) {
        phases.push({
          startIndex: i-1,
          endIndex: i,
          accelerationFactor: recentImprovement / (previousImprovement || 1),
          timestamp: data[i].timestamp
        });
      }
    }
    
    return phases;
  }
  
  calculateProgressConfidence(progress, dataPoints) {
    let confidence = 0.5; // Base confidence
    
    // More data points = higher confidence
    confidence += Math.min(0.3, dataPoints * 0.02);
    
    // Consistent progress = higher confidence
    confidence += progress.progressConsistency * 0.2;
    
    // Recent progress aligning with overall = higher confidence
    if (progress.recentProgress && progress.recentProgress.trend === progress.progressTrend) {
      confidence += 0.1;
    }
    
    return Math.min(1.0, confidence);
  }
  
  extractProgressMentions(messages) {
    const progressKeywords = [
      'improved', 'better', 'progress', 'breakthrough', 'getting it',
      'consistent', 'solid', 'feeling good', 'comfortable', 'natural'
    ];
    
    const mentions = [];
    messages.forEach(msg => {
      const content = (msg.content || '').toLowerCase();
      progressKeywords.forEach(keyword => {
        if (content.includes(keyword)) {
          mentions.push({
            keyword: keyword,
            timestamp: msg.timestamp,
            role: msg.role,
            context: content.substring(Math.max(0, content.indexOf(keyword) - 30), content.indexOf(keyword) + 50)
          });
        }
      });
    });
    
    return mentions;
  }
  
  assessDataQuality(userData) {
    return {
      totalDataPoints: userData.length,
      dataSpan: this.calculateDataSpan(userData),
      dataConsistency: this.calculateDataConsistency(userData),
      qualityScore: Math.min(100, userData.length * 2 + (this.calculateDataConsistency(userData) * 50))
    };
  }
  
  calculateDataSpan(userData) {
    if (userData.length < 2) return 0;
    const sorted = userData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return (new Date(sorted[sorted.length - 1].timestamp) - new Date(sorted[0].timestamp)) / (1000 * 60 * 60 * 24);
  }
  
  calculateDataConsistency(userData) {
    if (userData.length < 3) return 0;
    // Simple consistency check based on regular intervals
    const intervals = [];
    const sorted = userData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(new Date(sorted[i].timestamp) - new Date(sorted[i-1].timestamp));
    }
    
    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
    
    return Math.max(0, 1 - (Math.sqrt(variance) / avgInterval));
  }
  
  generateTrackingMetadata(userData, tracking) {
    return {
      algorithm_version: '1.0',
      data_sources: [...new Set(userData.map(d => d.type))],
      tracking_dimensions: Object.keys(SKILL_DIMENSIONS).length,
      computation_time: Date.now(),
      confidence_level: tracking.overallProgress?.confidenceLevel || 0
    };
  }
}

// EXPORT PROGRESS TRACKING ENGINE
module.exports = {
  ProgressTrackingEngine,
  PROGRESS_CONFIG,
  SKILL_DIMENSIONS
};