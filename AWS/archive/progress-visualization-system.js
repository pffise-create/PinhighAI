/**
 * Sprint 4B: Progress Visualization System
 * 
 * This module creates dynamic, interactive visualizations of golf coaching
 * progress, analytics, and insights. Supports multiple chart types,
 * responsive design, and export capabilities for comprehensive progress reporting.
 */

const AWS = require('aws-sdk');

// Visualization configuration
const VISUALIZATION_CONFIG = {
  CHART_TYPES: {
    LINE_CHART: 'line_chart',
    BAR_CHART: 'bar_chart',
    RADAR_CHART: 'radar_chart',
    HEATMAP: 'heatmap',
    SCATTER_PLOT: 'scatter_plot',
    PROGRESS_BAR: 'progress_bar',
    GAUGE_CHART: 'gauge_chart',
    TIMELINE: 'timeline',
    VIOLIN_PLOT: 'violin_plot',
    TREND_ARROW: 'trend_arrow'
  },
  
  VISUALIZATION_THEMES: {
    GOLF_PROFESSIONAL: {
      colors: ['#2E7D32', '#4CAF50', '#81C784', '#A5D6A7', '#C8E6C9'],
      background: '#FAFAFA',
      gridColor: '#E0E0E0',
      textColor: '#212121',
      accentColor: '#4CAF50'
    },
    PERFORMANCE_FOCUS: {
      colors: ['#1976D2', '#2196F3', '#64B5F6', '#90CAF9', '#BBDEFB'],
      background: '#F8F9FA',
      gridColor: '#E3F2FD',
      textColor: '#0D47A1',
      accentColor: '#2196F3'
    },
    HIGH_CONTRAST: {
      colors: ['#FF5722', '#FF9800', '#FFC107', '#FFEB3B', '#CDDC39'],
      background: '#FFFFFF',
      gridColor: '#BDBDBD',
      textColor: '#000000',
      accentColor: '#FF5722'
    }
  },
  
  RESPONSIVE_BREAKPOINTS: {
    MOBILE: 480,
    TABLET: 768,
    DESKTOP: 1024,
    LARGE: 1440
  },
  
  EXPORT_FORMATS: {
    PNG: 'png',
    SVG: 'svg',
    PDF: 'pdf',
    JSON: 'json'
  },
  
  ANIMATION_SETTINGS: {
    DURATION: 750,
    EASING: 'ease-in-out',
    STAGGER_DELAY: 100
  }
};

const VISUALIZATION_TEMPLATES = {
  // Progress tracking visualizations
  SKILL_PROGRESSION_RADAR: {
    type: 'radar_chart',
    title: 'Skill Development Overview',
    description: 'Multi-dimensional skill progress visualization',
    dataRequirements: ['dimensions', 'current_scores', 'baseline_scores'],
    defaultOptions: {
      scales: { r: { min: 0, max: 100 } },
      responsive: true,
      maintainAspectRatio: false
    }
  },
  
  LEARNING_VELOCITY_TIMELINE: {
    type: 'line_chart',
    title: 'Learning Velocity Over Time',
    description: 'Track rate of improvement and acceleration',
    dataRequirements: ['timestamps', 'velocity_values', 'acceleration_points'],
    defaultOptions: {
      tension: 0.4,
      pointRadius: 6,
      pointHoverRadius: 8
    }
  },
  
  CONSISTENCY_HEATMAP: {
    type: 'heatmap',
    title: 'Practice Consistency Calendar',
    description: 'Daily practice frequency and intensity',
    dataRequirements: ['dates', 'practice_intensity', 'session_count'],
    defaultOptions: {
      cellSize: 15,
      colorScale: 'interpolateGreens'
    }
  },
  
  BREAKTHROUGH_TIMELINE: {
    type: 'timeline',
    title: 'Breakthrough Moments',
    description: 'Key improvement milestones and achievements',
    dataRequirements: ['events', 'timestamps', 'impact_scores'],
    defaultOptions: {
      orientation: 'horizontal',
      showTooltips: true
    }
  },
  
  // Performance analytics visualizations
  SWING_CONSISTENCY_TREND: {
    type: 'line_chart',
    title: 'Swing Consistency Trend',
    description: 'Consistency improvement over time',
    dataRequirements: ['sessions', 'consistency_scores', 'trend_line'],
    defaultOptions: {
      showTrendLine: true,
      confidenceInterval: true
    }
  },
  
  BALL_FLIGHT_SCATTER: {
    type: 'scatter_plot',
    title: 'Ball Flight Analysis',
    description: 'Ball flight patterns and improvements',
    dataRequirements: ['carry_distance', 'accuracy', 'shot_shape'],
    defaultOptions: {
      showRegression: true,
      colorByCategory: true
    }
  },
  
  // Coaching effectiveness visualizations
  COACHING_IMPACT_GAUGE: {
    type: 'gauge_chart',
    title: 'Coaching Effectiveness',
    description: 'Overall coaching impact score',
    dataRequirements: ['effectiveness_score', 'benchmark_score'],
    defaultOptions: {
      minValue: 0,
      maxValue: 100,
      zones: [
        { from: 0, to: 40, color: '#FF6B6B' },
        { from: 40, to: 70, color: '#FFE66D' },
        { from: 70, to: 100, color: '#4ECDC4' }
      ]
    }
  },
  
  ENGAGEMENT_DISTRIBUTION: {
    type: 'violin_plot',
    title: 'Engagement Distribution',
    description: 'Conversation engagement patterns',
    dataRequirements: ['engagement_scores', 'session_types'],
    defaultOptions: {
      showMedian: true,
      showQuartiles: true
    }
  }
};

/**
 * Progress Visualization System
 */
class ProgressVisualizationSystem {
  
  constructor() {
    this.dynamodb = new AWS.DynamoDB.DocumentClient();
    this.s3 = new AWS.S3();
    this.cloudwatch = new AWS.CloudWatch();
    
    this.visualizationsTable = 'coaching-visualizations';
    this.assetsTable = 'visualization-assets';
    
    // Visualization cache for performance
    this.visualizationCache = new Map();
    this.templateCache = new Map();
  }
  
  /**
   * Generate comprehensive progress visualizations
   */
  async generateProgressVisualizations(userId, analytics, progressTracking, dashboardInsights, theme = 'GOLF_PROFESSIONAL') {
    try {
      console.log(`📊 Generating progress visualizations for user: ${userId} (${theme})`);
      
      const visualizations = {
        userId: userId,
        theme: theme,
        generatedAt: new Date().toISOString(),
        
        // Core visualization categories
        progressCharts: {},
        performanceCharts: {},
        engagementCharts: {},
        predictiveCharts: {},
        
        // Interactive features
        interactiveFeatures: {},
        
        // Export and sharing
        exportOptions: {},
        sharingCapabilities: {},
        
        // Responsive configurations
        responsiveConfigs: {},
        
        // Metadata
        visualizationMetadata: null
      };
      
      // Generate progress tracking visualizations
      visualizations.progressCharts = await this.generateProgressCharts(progressTracking, theme);
      
      // Generate performance analytics visualizations
      visualizations.performanceCharts = await this.generatePerformanceCharts(analytics, theme);
      
      // Generate engagement visualizations
      visualizations.engagementCharts = await this.generateEngagementCharts(analytics, theme);
      
      // Generate predictive visualizations
      visualizations.predictiveCharts = await this.generatePredictiveCharts(dashboardInsights, theme);
      
      // Add interactive features
      visualizations.interactiveFeatures = this.generateInteractiveFeatures(visualizations);
      
      // Configure responsive layouts
      visualizations.responsiveConfigs = this.generateResponsiveConfigs(visualizations);
      
      // Set up export options
      visualizations.exportOptions = this.generateExportOptions(visualizations);
      
      // Configure sharing capabilities
      visualizations.sharingCapabilities = this.generateSharingCapabilities(visualizations);
      
      // Add metadata
      visualizations.visualizationMetadata = this.generateVisualizationMetadata(visualizations);
      
      // Cache and store visualizations
      await this.cacheVisualizations(visualizations);
      await this.storeVisualizations(visualizations);
      
      console.log('✅ Progress visualizations generated successfully');
      return visualizations;
      
    } catch (error) {
      console.error('❌ Error generating progress visualizations:', error);
      throw error;
    }
  }
  
  /**
   * Generate progress tracking charts
   */
  async generateProgressCharts(progressTracking, theme) {
    try {
      console.log('📈 Generating progress charts...');
      
      const progressCharts = {};
      const themeConfig = VISUALIZATION_CONFIG.VISUALIZATION_THEMES[theme];
      
      // 1. Skill Progression Radar Chart
      if (progressTracking?.dimensionalProgress) {
        progressCharts.skillProgressionRadar = this.createSkillProgressionRadar(
          progressTracking.dimensionalProgress,
          themeConfig
        );
      }
      
      // 2. Learning Velocity Timeline
      if (progressTracking?.learningVelocity) {
        progressCharts.learningVelocityTimeline = this.createLearningVelocityTimeline(
          progressTracking.learningVelocity,
          themeConfig
        );
      }
      
      // 3. Overall Progress Gauge
      if (progressTracking?.overallProgress) {
        progressCharts.overallProgressGauge = this.createOverallProgressGauge(
          progressTracking.overallProgress,
          themeConfig
        );
      }
      
      // 4. Mastery Progression Bars
      if (progressTracking?.masteryProgression) {
        progressCharts.masteryProgressionBars = this.createMasteryProgressionBars(
          progressTracking.masteryProgression,
          themeConfig
        );
      }
      
      // 5. Breakthrough Timeline
      if (progressTracking?.plateauAnalysis?.breakthroughMoments) {
        progressCharts.breakthroughTimeline = this.createBreakthroughTimeline(
          progressTracking.plateauAnalysis.breakthroughMoments,
          themeConfig
        );
      }
      
      return progressCharts;
      
    } catch (error) {
      console.error('❌ Error generating progress charts:', error);
      return {};
    }
  }
  
  /**
   * Generate performance analytics charts
   */
  async generatePerformanceCharts(analytics, theme) {
    try {
      console.log('🎯 Generating performance charts...');
      
      const performanceCharts = {};
      const themeConfig = VISUALIZATION_CONFIG.VISUALIZATION_THEMES[theme];
      
      // 1. Swing Consistency Trend
      if (analytics?.swingProgressAnalysis?.consistencyProgression) {
        performanceCharts.swingConsistencyTrend = this.createSwingConsistencyTrend(
          analytics.swingProgressAnalysis.consistencyProgression,
          themeConfig
        );
      }
      
      // 2. Technical Progress Heat Map
      if (analytics?.swingProgressAnalysis?.technicalProgression) {
        performanceCharts.technicalProgressHeatmap = this.createTechnicalProgressHeatmap(
          analytics.swingProgressAnalysis.technicalProgression,
          themeConfig
        );
      }
      
      // 3. Ball Flight Analysis Scatter
      if (analytics?.swingProgressAnalysis?.ballFlightProgression) {
        performanceCharts.ballFlightScatter = this.createBallFlightScatter(
          analytics.swingProgressAnalysis.ballFlightProgression,
          themeConfig
        );
      }
      
      // 4. Performance Trends Line Chart
      if (analytics?.swingProgressAnalysis?.overallScoreProgression) {
        performanceCharts.performanceTrends = this.createPerformanceTrends(
          analytics.swingProgressAnalysis.overallScoreProgression,
          themeConfig
        );
      }
      
      // 5. Coaching Effectiveness Gauge
      if (analytics?.coachingEffectiveness) {
        performanceCharts.coachingEffectivenessGauge = this.createCoachingEffectivenessGauge(
          analytics.coachingEffectiveness,
          themeConfig
        );
      }
      
      return performanceCharts;
      
    } catch (error) {
      console.error('❌ Error generating performance charts:', error);
      return {};
    }
  }
  
  /**
   * Generate engagement visualization charts
   */
  async generateEngagementCharts(analytics, theme) {
    try {
      console.log('💬 Generating engagement charts...');
      
      const engagementCharts = {};
      const themeConfig = VISUALIZATION_CONFIG.VISUALIZATION_THEMES[theme];
      
      // 1. Practice Frequency Heatmap
      if (analytics?.conversationAnalysis) {
        engagementCharts.practiceFrequencyHeatmap = this.createPracticeFrequencyHeatmap(
          analytics.conversationAnalysis,
          themeConfig
        );
      }
      
      // 2. Engagement Score Trends
      if (analytics?.conversationAnalysis?.engagementScore) {
        engagementCharts.engagementTrends = this.createEngagementTrends(
          analytics.conversationAnalysis,
          themeConfig
        );
      }
      
      // 3. Question Asking Patterns
      if (analytics?.conversationAnalysis?.questionAskedPatterns) {
        engagementCharts.questionPatterns = this.createQuestionPatterns(
          analytics.conversationAnalysis.questionAskedPatterns,
          themeConfig
        );
      }
      
      // 4. Coaching Receptivity Distribution
      if (analytics?.conversationAnalysis?.coachingReceptivity) {
        engagementCharts.receptivityDistribution = this.createReceptivityDistribution(
          analytics.conversationAnalysis.coachingReceptivity,
          themeConfig
        );
      }
      
      return engagementCharts;
      
    } catch (error) {
      console.error('❌ Error generating engagement charts:', error);
      return {};
    }
  }
  
  /**
   * Generate predictive visualization charts
   */
  async generatePredictiveCharts(dashboardInsights, theme) {
    try {
      console.log('🔮 Generating predictive charts...');
      
      const predictiveCharts = {};
      const themeConfig = VISUALIZATION_CONFIG.VISUALIZATION_THEMES[theme];
      
      // 1. Progress Projections
      if (dashboardInsights?.opportunities?.breakthroughOpportunities) {
        predictiveCharts.progressProjections = this.createProgressProjections(
          dashboardInsights.opportunities.breakthroughOpportunities,
          themeConfig
        );
      }
      
      // 2. Plateau Risk Assessment
      if (dashboardInsights?.alerts?.plateauAlerts) {
        predictiveCharts.plateauRiskAssessment = this.createPlateauRiskAssessment(
          dashboardInsights.alerts.plateauAlerts,
          themeConfig
        );
      }
      
      // 3. Breakthrough Probability Timeline
      if (dashboardInsights?.opportunities?.improvementOpportunities) {
        predictiveCharts.breakthroughProbability = this.createBreakthroughProbability(
          dashboardInsights.opportunities.improvementOpportunities,
          themeConfig
        );
      }
      
      // 4. Coaching Optimization Recommendations
      if (dashboardInsights?.recommendations) {
        predictiveCharts.coachingOptimization = this.createCoachingOptimization(
          dashboardInsights.recommendations,
          themeConfig
        );
      }
      
      return predictiveCharts;
      
    } catch (error) {
      console.error('❌ Error generating predictive charts:', error);
      return {};
    }
  }
  
  /**
   * Chart creation methods
   */
  
  createSkillProgressionRadar(dimensionalProgress, themeConfig) {
    const dimensions = Object.entries(dimensionalProgress)
      .filter(([key]) => key !== '_crossDimensionalInsights')
      .map(([skill, progress]) => ({
        skill: skill,
        current: progress.currentScore || 0,
        baseline: progress.baselineScore || 0,
        peak: progress.peakScore || 0
      }));
    
    return {
      type: VISUALIZATION_CONFIG.CHART_TYPES.RADAR_CHART,
      title: 'Skill Development Overview',
      data: {
        labels: dimensions.map(d => d.skill),
        datasets: [
          {
            label: 'Current Level',
            data: dimensions.map(d => d.current),
            borderColor: themeConfig.colors[0],
            backgroundColor: `${themeConfig.colors[0]}20`,
            pointBackgroundColor: themeConfig.colors[0],
            pointBorderColor: themeConfig.colors[0],
            pointHoverBackgroundColor: themeConfig.colors[0],
            pointHoverBorderColor: themeConfig.colors[0]
          },
          {
            label: 'Baseline',
            data: dimensions.map(d => d.baseline),
            borderColor: themeConfig.colors[2],
            backgroundColor: `${themeConfig.colors[2]}15`,
            pointBackgroundColor: themeConfig.colors[2],
            pointBorderColor: themeConfig.colors[2],
            borderDash: [5, 5]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            angleLines: { display: true, color: themeConfig.gridColor },
            grid: { color: themeConfig.gridColor },
            pointLabels: { color: themeConfig.textColor, font: { size: 12 } },
            ticks: { display: false },
            min: 0,
            max: 100
          }
        },
        plugins: {
          legend: {
            labels: { color: themeConfig.textColor, font: { size: 12 } }
          },
          tooltip: {
            backgroundColor: themeConfig.background,
            titleColor: themeConfig.textColor,
            bodyColor: themeConfig.textColor,
            borderColor: themeConfig.accentColor,
            borderWidth: 1
          }
        }
      }
    };
  }
  
  createLearningVelocityTimeline(learningVelocity, themeConfig) {
    // Generate sample timeline data (in real implementation, this would use actual data)
    const timelineData = [];
    const now = new Date();
    
    for (let i = 30; i >= 0; i--) {
      const date = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
      timelineData.push({
        x: date.toISOString().split('T')[0],
        y: learningVelocity.currentVelocity + (Math.random() - 0.5) * 0.5
      });
    }
    
    return {
      type: VISUALIZATION_CONFIG.CHART_TYPES.LINE_CHART,
      title: 'Learning Velocity Over Time',
      data: {
        datasets: [
          {
            label: 'Learning Velocity',
            data: timelineData,
            borderColor: themeConfig.colors[1],
            backgroundColor: `${themeConfig.colors[1]}20`,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: themeConfig.colors[1],
            pointBorderColor: themeConfig.background,
            pointBorderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: { unit: 'day' },
            grid: { color: themeConfig.gridColor },
            ticks: { color: themeConfig.textColor }
          },
          y: {
            beginAtZero: true,
            grid: { color: themeConfig.gridColor },
            ticks: { color: themeConfig.textColor },
            title: {
              display: true,
              text: 'Velocity (points/day)',
              color: themeConfig.textColor
            }
          }
        },
        plugins: {
          legend: {
            labels: { color: themeConfig.textColor }
          },
          tooltip: {
            backgroundColor: themeConfig.background,
            titleColor: themeConfig.textColor,
            bodyColor: themeConfig.textColor,
            borderColor: themeConfig.accentColor,
            borderWidth: 1
          }
        }
      }
    };
  }
  
  createOverallProgressGauge(overallProgress, themeConfig) {
    return {
      type: VISUALIZATION_CONFIG.CHART_TYPES.GAUGE_CHART,
      title: 'Overall Progress Score',
      data: {
        value: overallProgress.overallScore || 0,
        maxValue: 100,
        zones: [
          { from: 0, to: 40, color: '#FF6B6B', label: 'Developing' },
          { from: 40, to: 70, color: '#FFE66D', label: 'Improving' },
          { from: 70, to: 85, color: '#4ECDC4', label: 'Proficient' },
          { from: 85, to: 100, color: '#2E7D32', label: 'Advanced' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        needle: {
          color: themeConfig.textColor,
          width: 3
        },
        centerText: {
          display: true,
          text: `${Math.round(overallProgress.overallScore || 0)}%`,
          color: themeConfig.textColor,
          font: { size: 24, weight: 'bold' }
        },
        labels: {
          color: themeConfig.textColor,
          font: { size: 12 }
        }
      }
    };
  }
  
  createPracticeFrequencyHeatmap(conversationData, themeConfig) {
    // Generate sample heatmap data
    const heatmapData = [];
    const now = new Date();
    
    for (let week = 0; week < 12; week++) {
      for (let day = 0; day < 7; day++) {
        const date = new Date(now.getTime() - ((week * 7 + day) * 24 * 60 * 60 * 1000));
        heatmapData.push({
          x: day,
          y: week,
          v: Math.floor(Math.random() * 5), // 0-4 intensity
          date: date.toISOString().split('T')[0]
        });
      }
    }
    
    return {
      type: VISUALIZATION_CONFIG.CHART_TYPES.HEATMAP,
      title: 'Practice Frequency Calendar',
      data: {
        datasets: [{
          label: 'Practice Intensity',
          data: heatmapData,
          backgroundColor: function(context) {
            const value = context.parsed.v;
            const alpha = value / 4; // 0 to 1
            return `${themeConfig.colors[0]}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
          },
          borderColor: themeConfig.gridColor,
          borderWidth: 1,
          width: 15,
          height: 15
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            position: 'bottom',
            min: 0,
            max: 6,
            ticks: {
              stepSize: 1,
              callback: function(value) {
                const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                return days[value];
              },
              color: themeConfig.textColor
            },
            grid: { display: false }
          },
          y: {
            type: 'linear',
            min: 0,
            max: 11,
            ticks: {
              stepSize: 1,
              callback: function(value) {
                return `Week ${12 - value}`;
              },
              color: themeConfig.textColor
            },
            grid: { display: false }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: themeConfig.background,
            titleColor: themeConfig.textColor,
            bodyColor: themeConfig.textColor,
            borderColor: themeConfig.accentColor,
            borderWidth: 1,
            callbacks: {
              title: function(context) {
                const point = context[0];
                return point.raw.date;
              },
              label: function(context) {
                return `Practice Intensity: ${context.raw.v}/4`;
              }
            }
          }
        }
      }
    };
  }
  
  /**
   * Interactive features generation
   */
  generateInteractiveFeatures(visualizations) {
    return {
      zoomAndPan: {
        enabled: true,
        charts: ['learningVelocityTimeline', 'performanceTrends', 'breakthroughTimeline']
      },
      
      crossFiltering: {
        enabled: true,
        linkedCharts: [
          ['skillProgressionRadar', 'masteryProgressionBars'],
          ['practiceFrequencyHeatmap', 'engagementTrends']
        ]
      },
      
      tooltipEnhancements: {
        customTooltips: true,
        showRelatedMetrics: true,
        includeRecommendations: true
      },
      
      dataPointSelection: {
        enabled: true,
        allowMultiSelect: true,
        showDetailPanel: true
      },
      
      timeRangeSelector: {
        enabled: true,
        presets: ['7d', '30d', '90d', '1y'],
        customRange: true
      },
      
      realTimeUpdates: {
        enabled: true,
        updateInterval: 300000, // 5 minutes
        animateChanges: true
      }
    };
  }
  
  /**
   * Responsive configuration generation
   */
  generateResponsiveConfigs(visualizations) {
    return {
      mobile: {
        maxWidth: VISUALIZATION_CONFIG.RESPONSIVE_BREAKPOINTS.MOBILE,
        chartModifications: {
          fontSize: 10,
          legendPosition: 'bottom',
          tooltipPosition: 'nearest',
          aspectRatio: 1.2
        },
        hiddenElements: ['gridLines', 'minorTicks'],
        simplifiedCharts: ['skillProgressionRadar', 'technicalProgressHeatmap']
      },
      
      tablet: {
        maxWidth: VISUALIZATION_CONFIG.RESPONSIVE_BREAKPOINTS.TABLET,
        chartModifications: {
          fontSize: 12,
          legendPosition: 'right',
          aspectRatio: 1.5
        },
        adaptiveLayout: true
      },
      
      desktop: {
        minWidth: VISUALIZATION_CONFIG.RESPONSIVE_BREAKPOINTS.DESKTOP,
        chartModifications: {
          fontSize: 14,
          showAllLabels: true,
          enhancedTooltips: true
        },
        fullFeatureSet: true
      }
    };
  }
  
  /**
   * Export options generation
   */
  generateExportOptions(visualizations) {
    return {
      formats: {
        png: {
          quality: 'high',
          resolution: '300dpi',
          backgroundColor: 'white'
        },
        pdf: {
          format: 'A4',
          orientation: 'landscape',
          includeMetadata: true
        },
        svg: {
          scalable: true,
          includeStyles: true
        },
        json: {
          includeData: true,
          includeConfig: true
        }
      },
      
      customReports: {
        progressReport: {
          charts: ['skillProgressionRadar', 'learningVelocityTimeline', 'overallProgressGauge'],
          template: 'progress_template',
          includeInsights: true
        },
        performanceReport: {
          charts: ['swingConsistencyTrend', 'ballFlightScatter', 'coachingEffectivenessGauge'],
          template: 'performance_template',
          includeRecommendations: true
        }
      },
      
      scheduledExports: {
        weekly: { enabled: false, format: 'pdf', recipients: [] },
        monthly: { enabled: false, format: 'pdf', recipients: [] }
      }
    };
  }
  
  /**
   * Helper methods
   */
  
  async cacheVisualizations(visualizations) {
    this.visualizationCache.set(visualizations.userId, {
      data: visualizations,
      cachedAt: Date.now(),
      expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour
    });
  }
  
  async storeVisualizations(visualizations) {
    try {
      const record = {
        visualization_id: `viz_${visualizations.userId}_${Date.now()}`,
        user_id: visualizations.userId,
        theme: visualizations.theme,
        generated_at: visualizations.generatedAt,
        visualization_data: visualizations,
        created_at: new Date().toISOString()
      };
      
      await this.dynamodb.put({
        TableName: this.visualizationsTable,
        Item: record
      }).promise();
      
      console.log('✅ Visualizations stored successfully');
      
    } catch (error) {
      console.error('❌ Error storing visualizations:', error);
    }
  }
  
  generateVisualizationMetadata(visualizations) {
    return {
      totalCharts: this.countTotalCharts(visualizations),
      chartTypes: this.getChartTypes(visualizations),
      interactiveFeatures: Object.keys(visualizations.interactiveFeatures || {}).length,
      exportFormats: Object.keys(visualizations.exportOptions?.formats || {}).length,
      responsiveBreakpoints: Object.keys(visualizations.responsiveConfigs || {}).length,
      generationTime: Date.now(),
      version: '1.0'
    };
  }
  
  countTotalCharts(visualizations) {
    let count = 0;
    Object.values(visualizations).forEach(category => {
      if (typeof category === 'object' && category !== null) {
        count += Object.keys(category).length;
      }
    });
    return count;
  }
  
  getChartTypes(visualizations) {
    const types = new Set();
    const addTypes = (obj) => {
      if (typeof obj === 'object' && obj !== null) {
        if (obj.type) {
          types.add(obj.type);
        } else {
          Object.values(obj).forEach(addTypes);
        }
      }
    };
    addTypes(visualizations);
    return Array.from(types);
  }
  
  generateSharingCapabilities(visualizations) {
    return {
      publicLinks: {
        enabled: true,
        expirationOptions: ['1d', '7d', '30d', 'never'],
        passwordProtection: true
      },
      
      embedOptions: {
        iframe: true,
        directEmbed: true,
        responsiveEmbed: true
      },
      
      socialSharing: {
        platforms: ['twitter', 'linkedin', 'facebook'],
        customMessages: true,
        includeMetrics: true
      },
      
      collaborativeFeatures: {
        comments: true,
        annotations: true,
        sharing: true
      }
    };
  }
}

// EXPORT PROGRESS VISUALIZATION SYSTEM
module.exports = {
  ProgressVisualizationSystem,
  VISUALIZATION_CONFIG,
  VISUALIZATION_TEMPLATES
};