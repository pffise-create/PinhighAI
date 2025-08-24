/**
 * Sprint 4B: Predictive Coaching Recommendations Engine
 * 
 * This module implements advanced machine learning-inspired algorithms to predict
 * optimal coaching interventions, identify breakthrough opportunities, and provide
 * personalized recommendations based on historical patterns and current progress.
 */

const AWS = require('aws-sdk');

// Predictive coaching configuration
const PREDICTION_CONFIG = {
  PREDICTION_HORIZONS: {
    IMMEDIATE: 3,        // 3 days
    SHORT_TERM: 14,      // 2 weeks
    MEDIUM_TERM: 30,     // 1 month
    LONG_TERM: 90        // 3 months
  },
  
  RECOMMENDATION_TYPES: {
    SKILL_FOCUS: 'skill_focus',
    PRACTICE_OPTIMIZATION: 'practice_optimization',
    COACHING_ADJUSTMENT: 'coaching_adjustment',
    BREAKTHROUGH_CATALYST: 'breakthrough_catalyst',
    PLATEAU_PREVENTION: 'plateau_prevention',
    MENTAL_GAME: 'mental_game',
    COURSE_STRATEGY: 'course_strategy'
  },
  
  CONFIDENCE_LEVELS: {
    VERY_HIGH: 0.9,
    HIGH: 0.75,
    MEDIUM: 0.6,
    LOW: 0.45,
    VERY_LOW: 0.3
  },
  
  LEARNING_PATTERNS: {
    RAPID_LEARNER: 'rapid_learner',
    STEADY_IMPROVER: 'steady_improver',
    PLATEAU_PRONE: 'plateau_prone',
    BREAKTHROUGH_DEPENDENT: 'breakthrough_dependent',
    INCONSISTENT_LEARNER: 'inconsistent_learner'
  },
  
  INTERVENTION_STRATEGIES: {
    INTENSIFY: 'intensify_focus',
    DIVERSIFY: 'diversify_approach',
    SIMPLIFY: 'simplify_instruction',
    ACCELERATE: 'accelerate_pace',
    PAUSE: 'strategic_pause',
    REDIRECT: 'redirect_focus'
  }
};

const SKILL_MASTERY_MODELS = {
  'Setup & Address Position': {
    typical_learning_curve: [10, 25, 45, 65, 80, 90, 95],
    plateau_points: [30, 70],
    breakthrough_indicators: ['consistent_posture', 'automatic_alignment'],
    mastery_threshold: 85,
    retention_decay_rate: 0.02
  },
  
  'Swing Plane & Path': {
    typical_learning_curve: [5, 15, 30, 50, 65, 75, 85],
    plateau_points: [25, 60],
    breakthrough_indicators: ['on_plane_consistency', 'path_awareness'],
    mastery_threshold: 80,
    retention_decay_rate: 0.03
  },
  
  'Impact Position': {
    typical_learning_curve: [8, 20, 35, 55, 70, 82, 90],
    plateau_points: [35, 75],
    breakthrough_indicators: ['compression_feel', 'hands_ahead_consistency'],
    mastery_threshold: 88,
    retention_decay_rate: 0.025
  },
  
  'Tempo & Timing': {
    typical_learning_curve: [15, 35, 55, 70, 80, 88, 93],
    plateau_points: [40, 85],
    breakthrough_indicators: ['rhythm_awareness', 'transition_smoothness'],
    mastery_threshold: 85,
    retention_decay_rate: 0.015
  },
  
  'Ball Flight Control': {
    typical_learning_curve: [5, 12, 25, 40, 58, 70, 80],
    plateau_points: [20, 65],
    breakthrough_indicators: ['curve_control', 'trajectory_awareness'],
    mastery_threshold: 75,
    retention_decay_rate: 0.04
  }
};

/**
 * Predictive Coaching Recommendations Engine
 */
class PredictiveCoachingEngine {
  
  constructor() {
    this.dynamodb = new AWS.DynamoDB.DocumentClient();
    this.cloudwatch = new AWS.CloudWatch();
    
    this.recommendationsTable = 'coaching-recommendations';
    this.modelsTable = 'coaching-prediction-models';
    
    // Prediction models cache
    this.predictionModels = new Map();
    this.userPatterns = new Map();
  }
  
  /**
   * Generate comprehensive predictive coaching recommendations
   */
  async generatePredictiveRecommendations(userId, analytics, progressTracking, timeHorizon = 'MEDIUM_TERM') {
    try {
      console.log(`🔮 Generating predictive coaching recommendations for user: ${userId} (${timeHorizon})`);
      
      const recommendations = {
        userId: userId,
        timeHorizon: timeHorizon,
        generatedAt: new Date().toISOString(),
        
        // Core predictions
        skillProgressPredictions: null,
        breakthroughPredictions: null,
        plateauPredictions: null,
        
        // Recommendation categories
        immediateRecommendations: [],
        shortTermRecommendations: [],
        longTermRecommendations: [],
        
        // Personalized strategies
        learningPattern: null,
        optimalStrategies: [],
        interventionRecommendations: [],
        
        // Predictive insights
        progressProjections: null,
        riskAssessments: null,
        opportunityIdentification: null,
        
        // Confidence and metadata
        overallConfidence: 0,
        modelAccuracy: null,
        recommendationMetadata: null
      };
      
      // Analyze user learning patterns
      recommendations.learningPattern = await this.analyzeLearningPattern(userId, analytics, progressTracking);
      
      // Generate skill progress predictions
      recommendations.skillProgressPredictions = await this.predictSkillProgress(userId, progressTracking, timeHorizon);
      
      // Predict breakthrough opportunities
      recommendations.breakthroughPredictions = await this.predictBreakthroughs(analytics, progressTracking);
      
      // Predict plateau risks
      recommendations.plateauPredictions = await this.predictPlateaus(progressTracking);
      
      // Generate progress projections
      recommendations.progressProjections = await this.generateProgressProjections(recommendations);
      
      // Assess risks and opportunities
      recommendations.riskAssessments = await this.assessRisks(recommendations);
      recommendations.opportunityIdentification = await this.identifyOpportunities(recommendations);
      
      // Generate categorized recommendations
      recommendations.immediateRecommendations = await this.generateImmediateRecommendations(recommendations);
      recommendations.shortTermRecommendations = await this.generateShortTermRecommendations(recommendations);
      recommendations.longTermRecommendations = await this.generateLongTermRecommendations(recommendations);
      
      // Determine optimal strategies
      recommendations.optimalStrategies = await this.determineOptimalStrategies(recommendations);
      
      // Generate intervention recommendations
      recommendations.interventionRecommendations = await this.generateInterventionRecommendations(recommendations);
      
      // Calculate overall confidence
      recommendations.overallConfidence = this.calculateOverallConfidence(recommendations);
      
      // Add model accuracy and metadata
      recommendations.modelAccuracy = await this.assessModelAccuracy(userId);
      recommendations.recommendationMetadata = this.generateRecommendationMetadata(recommendations);
      
      // Store recommendations
      await this.storeRecommendations(recommendations);
      
      console.log('✅ Predictive coaching recommendations generated successfully');
      return recommendations;
      
    } catch (error) {
      console.error('❌ Error generating predictive coaching recommendations:', error);
      throw error;
    }
  }
  
  /**
   * Analyze user learning patterns
   */
  async analyzeLearningPattern(userId, analytics, progressTracking) {
    try {
      console.log('🧠 Analyzing learning patterns...');
      
      const pattern = {
        primaryPattern: PREDICTION_CONFIG.LEARNING_PATTERNS.STEADY_IMPROVER,
        confidence: 0.5,
        characteristics: [],
        learningVelocity: 'medium',
        consistencyLevel: 'medium',
        breakthroughFrequency: 'normal',
        plateauResistance: 'medium',
        adaptabilityScore: 0.5
      };
      
      // Analyze learning velocity
      const velocity = progressTracking?.learningVelocity;
      if (velocity) {
        if (velocity.currentVelocity > 2.0) {
          pattern.learningVelocity = 'high';
          pattern.characteristics.push('fast_learner');
        } else if (velocity.currentVelocity < 0.5) {
          pattern.learningVelocity = 'low';
          pattern.characteristics.push('methodical_learner');
        }
        
        pattern.consistencyLevel = velocity.velocityConsistency > 0.7 ? 'high' : velocity.velocityConsistency > 0.4 ? 'medium' : 'low';
      }
      
      // Analyze breakthrough patterns
      const swingProgress = analytics?.swingProgressAnalysis;
      if (swingProgress?.breakthroughMoments?.length > 0) {
        const breakthroughFreq = swingProgress.breakthroughMoments.length;
        pattern.breakthroughFrequency = breakthroughFreq > 2 ? 'high' : breakthroughFreq > 1 ? 'normal' : 'low';
        
        if (breakthroughFreq > 2) {
          pattern.characteristics.push('breakthrough_dependent');
        }
      }
      
      // Analyze plateau resistance
      const overallProgress = progressTracking?.overallProgress;
      if (overallProgress) {
        if (overallProgress.progressTrend === 'plateau') {
          pattern.plateauResistance = 'low';
          pattern.characteristics.push('plateau_prone');
        } else if (overallProgress.progressConsistency > 0.8) {
          pattern.plateauResistance = 'high';
          pattern.characteristics.push('consistent_improver');
        }
      }
      
      // Determine primary learning pattern
      if (pattern.learningVelocity === 'high' && pattern.consistencyLevel === 'high') {
        pattern.primaryPattern = PREDICTION_CONFIG.LEARNING_PATTERNS.RAPID_LEARNER;
        pattern.confidence = 0.8;
      } else if (pattern.characteristics.includes('plateau_prone')) {
        pattern.primaryPattern = PREDICTION_CONFIG.LEARNING_PATTERNS.PLATEAU_PRONE;
        pattern.confidence = 0.7;
      } else if (pattern.characteristics.includes('breakthrough_dependent')) {
        pattern.primaryPattern = PREDICTION_CONFIG.LEARNING_PATTERNS.BREAKTHROUGH_DEPENDENT;
        pattern.confidence = 0.75;
      } else if (pattern.consistencyLevel === 'low') {
        pattern.primaryPattern = PREDICTION_CONFIG.LEARNING_PATTERNS.INCONSISTENT_LEARNER;
        pattern.confidence = 0.65;
      }
      
      // Calculate adaptability score
      pattern.adaptabilityScore = this.calculateAdaptabilityScore(analytics, progressTracking);
      
      return pattern;
      
    } catch (error) {
      console.error('❌ Error analyzing learning pattern:', error);
      return {
        primaryPattern: PREDICTION_CONFIG.LEARNING_PATTERNS.STEADY_IMPROVER,
        confidence: 0.3,
        error: error.message
      };
    }
  }
  
  /**
   * Predict skill progress for each dimension
   */
  async predictSkillProgress(userId, progressTracking, timeHorizon) {
    try {
      console.log('📈 Predicting skill progress...');
      
      const predictions = {};
      const dimensions = progressTracking?.dimensionalProgress || {};
      const horizonDays = PREDICTION_CONFIG.PREDICTION_HORIZONS[timeHorizon];
      
      Object.entries(dimensions).forEach(([skill, progress]) => {
        if (skill === '_crossDimensionalInsights') return;
        
        const skillModel = SKILL_MASTERY_MODELS[skill];
        if (!skillModel) return;
        
        const currentScore = progress.currentScore || 0;
        const improvement = progress.improvement || 0;
        const trend = progress.trend || 'stable';
        
        // Simple linear projection with curve fitting
        let projectedScore = currentScore;
        let confidence = 0.5;
        
        if (trend === 'accelerated') {
          projectedScore = currentScore + (improvement * horizonDays * 1.5);
          confidence = 0.7;
        } else if (trend === 'on_track') {
          projectedScore = currentScore + (improvement * horizonDays);
          confidence = 0.8;
        } else if (trend === 'slow_progress') {
          projectedScore = currentScore + (improvement * horizonDays * 0.5);
          confidence = 0.6;
        } else if (trend === 'plateau_or_declining') {
          projectedScore = currentScore * 0.95; // Slight decay
          confidence = 0.4;
        }
        
        // Apply learning curve constraints
        const masteryThreshold = skillModel.mastery_threshold;
        if (projectedScore > masteryThreshold) {
          projectedScore = masteryThreshold - (masteryThreshold - projectedScore) * 0.5; // Asymptotic approach
        }
        
        // Check for plateau points
        const plateauPoints = skillModel.plateau_points;
        const nearPlateau = plateauPoints.find(point => Math.abs(currentScore - point) < 5);
        if (nearPlateau) {
          confidence *= 0.7; // Lower confidence near known plateau points
        }
        
        predictions[skill] = {
          currentScore: currentScore,
          projectedScore: Math.min(100, Math.max(0, projectedScore)),
          expectedImprovement: projectedScore - currentScore,
          confidence: confidence,
          timeToMastery: this.calculateTimeToMastery(currentScore, skillModel),
          breakthroughProbability: this.calculateBreakthroughProbability(currentScore, progress, skillModel),
          plateauRisk: this.calculatePlateauRisk(currentScore, progress, skillModel)
        };
      });
      
      return predictions;
      
    } catch (error) {
      console.error('❌ Error predicting skill progress:', error);
      return {};
    }
  }
  
  /**
   * Predict breakthrough opportunities
   */
  async predictBreakthroughs(analytics, progressTracking) {
    try {
      console.log('💡 Predicting breakthrough opportunities...');
      
      const breakthroughPredictions = {
        nearTermBreakthroughs: [],
        potentialTriggers: [],
        breakthroughProbability: 0,
        optimalTimingWindow: null,
        recommendedCatalysts: []
      };
      
      // Analyze current progress patterns
      const swingProgress = analytics?.swingProgressAnalysis;
      const overallProgress = progressTracking?.overallProgress;
      
      // Check for breakthrough indicators
      const breakthroughIndicators = [];
      
      if (overallProgress?.progressTrend === 'significant_improvement') {
        breakthroughIndicators.push('momentum_building');
      }
      
      if (swingProgress?.progressVelocity > 1.5) {
        breakthroughIndicators.push('high_velocity');
      }
      
      if (progressTracking?.consistencyAnalysis?.consistency > 0.8) {
        breakthroughIndicators.push('high_consistency');
      }
      
      // Calculate breakthrough probability
      let probability = 0.1; // Base probability
      
      breakthroughIndicators.forEach(indicator => {
        switch (indicator) {
          case 'momentum_building': probability += 0.3; break;
          case 'high_velocity': probability += 0.25; break;
          case 'high_consistency': probability += 0.2; break;
        }
      });
      
      breakthroughPredictions.breakthroughProbability = Math.min(0.9, probability);
      
      // Identify potential breakthrough areas
      const dimensions = progressTracking?.dimensionalProgress || {};
      Object.entries(dimensions).forEach(([skill, progress]) => {
        if (skill === '_crossDimensionalInsights') return;
        
        const skillModel = SKILL_MASTERY_MODELS[skill];
        if (!skillModel) return;
        
        const currentScore = progress.currentScore || 0;
        const breakthroughThresholds = skillModel.breakthrough_indicators;
        
        // Check if approaching breakthrough threshold
        breakthroughThresholds.forEach(threshold => {
          if (currentScore > 60 && progress.trend === 'on_track') {
            breakthroughPredictions.nearTermBreakthroughs.push({
              skill: skill,
              threshold: threshold,
              probability: 0.7,
              timeframe: '2-3 weeks',
              currentScore: currentScore
            });
          }
        });
      });
      
      // Identify breakthrough triggers
      if (breakthroughPredictions.breakthroughProbability > 0.5) {
        breakthroughPredictions.potentialTriggers = [
          'Focused practice session',
          'Professional lesson',
          'Mental breakthrough exercise',
          'Video analysis session'
        ];
        
        breakthroughPredictions.optimalTimingWindow = {
          start: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days from now
          end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()   // 10 days from now
        };
      }
      
      // Generate breakthrough catalysts
      breakthroughPredictions.recommendedCatalysts = this.generateBreakthroughCatalysts(analytics, progressTracking);
      
      return breakthroughPredictions;
      
    } catch (error) {
      console.error('❌ Error predicting breakthroughs:', error);
      return {
        nearTermBreakthroughs: [],
        breakthroughProbability: 0,
        error: error.message
      };
    }
  }
  
  /**
   * Generate immediate recommendations
   */
  async generateImmediateRecommendations(predictions) {
    try {
      const recommendations = [];
      
      // High-priority breakthrough opportunities
      if (predictions.breakthroughPredictions?.breakthroughProbability > 0.6) {
        recommendations.push({
          type: PREDICTION_CONFIG.RECOMMENDATION_TYPES.BREAKTHROUGH_CATALYST,
          priority: 'critical',
          action: 'Schedule intensive practice session',
          reasoning: 'High breakthrough probability detected',
          expectedOutcome: 'Significant skill advancement',
          timeframe: '3-5 days',
          confidence: predictions.breakthroughPredictions.breakthroughProbability
        });
      }
      
      // Plateau prevention
      const plateauRisks = predictions.plateauPredictions?.highRiskSkills || [];
      plateauRisks.forEach(skill => {
        recommendations.push({
          type: PREDICTION_CONFIG.RECOMMENDATION_TYPES.PLATEAU_PREVENTION,
          priority: 'high',
          action: `Vary practice approach for ${skill}`,
          reasoning: 'Plateau risk detected',
          expectedOutcome: 'Continued progress',
          timeframe: '1-2 days',
          confidence: 0.7
        });
      });
      
      // Learning pattern optimizations
      const learningPattern = predictions.learningPattern;
      if (learningPattern?.primaryPattern === PREDICTION_CONFIG.LEARNING_PATTERNS.RAPID_LEARNER) {
        recommendations.push({
          type: PREDICTION_CONFIG.RECOMMENDATION_TYPES.PRACTICE_OPTIMIZATION,
          priority: 'medium',
          action: 'Increase practice complexity',
          reasoning: 'Rapid learner pattern identified',
          expectedOutcome: 'Accelerated development',
          timeframe: 'Next session',
          confidence: learningPattern.confidence
        });
      }
      
      return recommendations.sort((a, b) => {
        const priorityOrder = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
        return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
      });
      
    } catch (error) {
      console.error('❌ Error generating immediate recommendations:', error);
      return [];
    }
  }
  
  /**
   * Helper functions
   */
  
  calculateTimeToMastery(currentScore, skillModel) {
    const masteryThreshold = skillModel.mastery_threshold;
    const curve = skillModel.typical_learning_curve;
    
    if (currentScore >= masteryThreshold) return 0;
    
    // Find position on learning curve
    let currentIndex = 0;
    for (let i = 0; i < curve.length; i++) {
      if (curve[i] > currentScore) {
        currentIndex = i;
        break;
      }
    }
    
    // Estimate remaining sessions
    const remainingSessions = curve.length - currentIndex;
    return Math.max(1, remainingSessions * 2); // Assume 2 sessions per week
  }
  
  calculateBreakthroughProbability(currentScore, progress, skillModel) {
    let probability = 0.1;
    
    // Higher probability if near breakthrough indicators
    const breakthroughPoints = [40, 70]; // Common breakthrough points
    const nearBreakthrough = breakthroughPoints.find(point => Math.abs(currentScore - point) < 10);
    
    if (nearBreakthrough) probability += 0.4;
    if (progress.trend === 'accelerated') probability += 0.3;
    if (progress.consistency > 0.7) probability += 0.2;
    
    return Math.min(0.9, probability);
  }
  
  calculatePlateauRisk(currentScore, progress, skillModel) {
    let risk = 0.1;
    
    // Higher risk near known plateau points
    const plateauPoints = skillModel.plateau_points;
    const nearPlateau = plateauPoints.find(point => Math.abs(currentScore - point) < 5);
    
    if (nearPlateau) risk += 0.5;
    if (progress.trend === 'slow_progress') risk += 0.3;
    if (progress.consistency < 0.4) risk += 0.2;
    
    return Math.min(0.9, risk);
  }
  
  generateBreakthroughCatalysts(analytics, progressTracking) {
    const catalysts = [];
    
    // Mental game catalysts
    if (analytics?.coachingEffectiveness?.confidenceBuilding < 0.6) {
      catalysts.push({
        type: 'mental_breakthrough',
        action: 'Confidence building exercises',
        impact: 'high'
      });
    }
    
    // Technical catalysts
    const dimensions = progressTracking?.dimensionalProgress || {};
    const strugglingAreas = Object.entries(dimensions)
      .filter(([skill, progress]) => skill !== '_crossDimensionalInsights' && progress.trend === 'slow_progress')
      .map(([skill]) => skill);
    
    if (strugglingAreas.length > 0) {
      catalysts.push({
        type: 'technical_focus',
        action: `Intensive work on ${strugglingAreas[0]}`,
        impact: 'medium'
      });
    }
    
    return catalysts;
  }
  
  calculateAdaptabilityScore(analytics, progressTracking) {
    let adaptability = 0.5;
    
    // Check conversation engagement
    if (analytics?.conversationAnalysis?.engagementLevel === 'high') {
      adaptability += 0.2;
    }
    
    // Check coaching receptivity
    if (analytics?.conversationAnalysis?.coachingReceptivity > 0.7) {
      adaptability += 0.2;
    }
    
    // Check progress velocity consistency
    if (progressTracking?.learningVelocity?.velocityConsistency > 0.6) {
      adaptability += 0.1;
    }
    
    return Math.min(1.0, adaptability);
  }
  
  calculateOverallConfidence(recommendations) {
    const confidences = [];
    
    // Collect confidence scores from various predictions
    if (recommendations.skillProgressPredictions) {
      Object.values(recommendations.skillProgressPredictions).forEach(prediction => {
        confidences.push(prediction.confidence || 0.5);
      });
    }
    
    if (recommendations.breakthroughPredictions?.breakthroughProbability) {
      confidences.push(recommendations.breakthroughPredictions.breakthroughProbability);
    }
    
    if (recommendations.learningPattern?.confidence) {
      confidences.push(recommendations.learningPattern.confidence);
    }
    
    // Calculate weighted average
    return confidences.length > 0 
      ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
      : 0.5;
  }
  
  async storeRecommendations(recommendations) {
    try {
      const record = {
        recommendation_id: `predictions_${recommendations.userId}_${Date.now()}`,
        user_id: recommendations.userId,
        time_horizon: recommendations.timeHorizon,
        generated_at: recommendations.generatedAt,
        predictions_data: recommendations,
        created_at: new Date().toISOString()
      };
      
      await this.dynamodb.put({
        TableName: this.recommendationsTable,
        Item: record
      }).promise();
      
      console.log('✅ Predictive recommendations stored successfully');
      
    } catch (error) {
      console.error('❌ Error storing recommendations:', error);
    }
  }
  
  generateRecommendationMetadata(recommendations) {
    return {
      algorithm_version: '1.0',
      prediction_models_used: Object.keys(SKILL_MASTERY_MODELS),
      total_recommendations: 
        recommendations.immediateRecommendations.length +
        recommendations.shortTermRecommendations.length +
        recommendations.longTermRecommendations.length,
      confidence_distribution: this.calculateConfidenceDistribution(recommendations),
      generation_time: Date.now()
    };
  }
  
  calculateConfidenceDistribution(recommendations) {
    // Calculate distribution of confidence levels across recommendations
    const allRecommendations = [
      ...recommendations.immediateRecommendations,
      ...recommendations.shortTermRecommendations,
      ...recommendations.longTermRecommendations
    ];
    
    const distribution = {
      very_high: 0,
      high: 0,
      medium: 0,
      low: 0,
      very_low: 0
    };
    
    allRecommendations.forEach(rec => {
      const conf = rec.confidence || 0.5;
      if (conf >= PREDICTION_CONFIG.CONFIDENCE_LEVELS.VERY_HIGH) distribution.very_high++;
      else if (conf >= PREDICTION_CONFIG.CONFIDENCE_LEVELS.HIGH) distribution.high++;
      else if (conf >= PREDICTION_CONFIG.CONFIDENCE_LEVELS.MEDIUM) distribution.medium++;
      else if (conf >= PREDICTION_CONFIG.CONFIDENCE_LEVELS.LOW) distribution.low++;
      else distribution.very_low++;
    });
    
    return distribution;
  }
  
  // Additional methods would be implemented for:
  // - predictPlateaus
  // - generateProgressProjections  
  // - assessRisks
  // - identifyOpportunities
  // - generateShortTermRecommendations
  // - generateLongTermRecommendations
  // - determineOptimalStrategies
  // - generateInterventionRecommendations
  // - assessModelAccuracy
}

// EXPORT PREDICTIVE COACHING ENGINE
module.exports = {
  PredictiveCoachingEngine,
  PREDICTION_CONFIG,
  SKILL_MASTERY_MODELS
};