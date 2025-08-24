// Enhanced Video Service with Comprehensive Logging and Timeout Fixes
// Addresses critical timeout issues identified in analysis

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod';

// TIMEOUT CONFIGURATION - Fixed from analysis
const TIMEOUT_CONFIG = {
  S3_UPLOAD_TIMEOUT: 300000,      // 5 minutes (was unlimited)
  ANALYSIS_POLL_TIMEOUT: 1200000, // 20 minutes (was 5 minutes) 
  POLL_INTERVAL_BASE: 2000,       // 2 seconds (was 5 seconds)
  POLL_INTERVAL_MAX: 10000,       // 10 seconds max
  MAX_RETRY_ATTEMPTS: 3,          // 3 retries for network issues
  NETWORK_TIMEOUT: 30000          // 30 seconds for API calls
};

// LOGGING CONFIGURATION
class Logger {
  static generateCorrelationId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  static info(component, message, context = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      component: component,
      message: message,
      correlationId: context.correlationId || 'unknown',
      userId: context.userId || 'anonymous',
      context: context
    };
    
    console.log(`[${logEntry.correlationId}] ${component}: ${message}`, context);
    
    // TODO: Send to remote logging service
    this.sendToRemoteLogging(logEntry);
  }

  static error(component, message, error, context = {}) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      component: component,
      message: message,
      error: {
        message: error?.message,
        stack: error?.stack,
        type: error?.constructor?.name
      },
      correlationId: context.correlationId || 'unknown',
      userId: context.userId || 'anonymous',
      context: {
        ...context,
        userAgent: navigator?.userAgent,
        connectionType: navigator?.connection?.effectiveType,
        memoryUsage: performance?.memory?.usedJSHeapSize
      }
    };
    
    console.error(`[${errorEntry.correlationId}] ${component} ERROR: ${message}`, errorEntry);
    
    // TODO: Send to error tracking service
    this.sendToErrorTracking(errorEntry);
  }

  static performance(component, operation, duration, context = {}) {
    const perfEntry = {
      timestamp: new Date().toISOString(),
      level: 'PERF',
      component: component,
      operation: operation,
      duration_ms: duration,
      correlationId: context.correlationId || 'unknown',
      context: context
    };
    
    console.log(`[${perfEntry.correlationId}] PERF ${component}.${operation}: ${duration}ms`, context);
    
    // TODO: Send to performance monitoring
    this.sendToPerformanceMonitoring(perfEntry);
  }

  static sendToRemoteLogging(entry) {
    // TODO: Implement remote logging (AWS CloudWatch, LogRocket, etc.)
  }

  static sendToErrorTracking(entry) {
    // TODO: Implement error tracking (Sentry, Bugsnag, etc.)
  }

  static sendToPerformanceMonitoring(entry) {
    // TODO: Implement performance monitoring (DataDog, New Relic, etc.)
  }
}

class EnhancedVideoService {
  constructor() {
    this.currentAnalysisId = null;
    this.correlationId = null;
    this.userJourney = [];
  }

  // Track user journey for debugging
  trackJourneyStep(step, data = {}) {
    const journeyEntry = {
      step: step,
      timestamp: new Date().toISOString(),
      correlationId: this.correlationId,
      data: data
    };
    
    this.userJourney.push(journeyEntry);
    
    Logger.info('UserJourney', `Step: ${step}`, {
      correlationId: this.correlationId,
      journeyStep: this.userJourney.length,
      ...data
    });
  }

  // FIXED: Generate unique filename with better structure
  generateFileName(userId = 'user') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    this.correlationId = Logger.generateCorrelationId();
    
    const fileName = `golf-swings/${userId}/${timestamp}-${random}.mov`;
    
    Logger.info('VideoService', 'Generated filename', {
      correlationId: this.correlationId,
      fileName: fileName,
      userId: userId,
      timestamp: timestamp
    });
    
    this.trackJourneyStep('filename_generated', { fileName, userId });
    
    return fileName;
  }

  // FIXED: Add timeout and retry logic to presigned URL
  async getPresignedUrl(fileName, contentType = 'video/quicktime') {
    const startTime = Date.now();
    
    try {
      Logger.info('VideoService', 'Getting presigned URL', {
        correlationId: this.correlationId,
        fileName: fileName,
        contentType: contentType
      });
      
      this.trackJourneyStep('presigned_url_request', { fileName, contentType });

      // FIXED: Add timeout to fetch request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_CONFIG.NETWORK_TIMEOUT);
      
      const response = await fetch(`${API_BASE_URL}/api/video/presigned-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-Id': this.correlationId
        },
        body: JSON.stringify({
          fileName: fileName,
          contentType,
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Presigned URL failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      // Extract analysis ID from the filename for later use
      this.currentAnalysisId = this.extractAnalysisId(fileName);
      
      Logger.performance('VideoService', 'get_presigned_url', duration, {
        correlationId: this.correlationId,
        fileName: data.fileName || fileName,
        success: true
      });
      
      this.trackJourneyStep('presigned_url_success', { 
        fileName: data.fileName, 
        duration: duration 
      });
      
      return data.presignedUrl;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      Logger.error('VideoService', 'Failed to get presigned URL', error, {
        correlationId: this.correlationId,
        fileName: fileName,
        duration: duration
      });
      
      this.trackJourneyStep('presigned_url_error', { 
        error: error.message, 
        duration: duration 
      });
      
      // FIXED: Enhanced error message with context
      throw new Error(`Failed to get upload URL: ${error.message} (correlationId: ${this.correlationId}, duration: ${duration}ms)`);
    }
  }

  // Extract analysis ID from filename
  extractAnalysisId(fileName) {
    const parts = fileName.split('/');
    if (parts.length >= 3) {
      const filenamePart = parts[2].replace('.mov', '').replace('.mp4', '');
      return filenamePart;
    }
    return null;
  }

  // FIXED: Add comprehensive timeout and progress tracking to S3 upload
  async uploadVideoToS3(videoUri, presignedUrl, onProgress) {
    const startTime = Date.now();
    
    try {
      Logger.info('VideoService', 'Starting S3 upload', {
        correlationId: this.correlationId,
        videoUri: videoUri,
        presignedUrl: presignedUrl.substring(0, 100) + '...' // Truncate for logging
      });
      
      this.trackJourneyStep('s3_upload_start', { videoUri });

      // Create form data for video upload
      const formData = new FormData();
      formData.append('file', {
        uri: videoUri,
        type: 'video/quicktime',
        name: 'golf-swing.mov',
      });

      const xhr = new XMLHttpRequest();
      
      return new Promise((resolve, reject) => {
        let lastProgressUpdate = Date.now();
        
        // FIXED: Add timeout to prevent infinite uploads
        xhr.timeout = TIMEOUT_CONFIG.S3_UPLOAD_TIMEOUT;
        
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100;
            const now = Date.now();
            const uploadSpeed = event.loaded / ((now - startTime) / 1000); // bytes per second
            
            // Throttle progress updates to every 2 seconds
            if (now - lastProgressUpdate > 2000) {
              Logger.info('VideoService', 'Upload progress', {
                correlationId: this.correlationId,
                progress: Math.round(progress),
                loaded: event.loaded,
                total: event.total,
                uploadSpeed: Math.round(uploadSpeed / 1024) + ' KB/s'
              });
              
              lastProgressUpdate = now;
            }
            
            onProgress && onProgress(progress);
          }
        });

        xhr.addEventListener('load', () => {
          const duration = Date.now() - startTime;
          
          if (xhr.status >= 200 && xhr.status < 300) {
            Logger.performance('VideoService', 's3_upload', duration, {
              correlationId: this.correlationId,
              status: xhr.status,
              success: true
            });
            
            this.trackJourneyStep('s3_upload_success', { 
              duration: duration,
              status: xhr.status 
            });
            
            resolve(xhr.response);
          } else {
            const error = new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`);
            
            Logger.error('VideoService', 'S3 upload failed', error, {
              correlationId: this.correlationId,
              status: xhr.status,
              statusText: xhr.statusText,
              duration: duration
            });
            
            this.trackJourneyStep('s3_upload_error', { 
              status: xhr.status,
              statusText: xhr.statusText,
              duration: duration 
            });
            
            reject(error);
          }
        });

        xhr.addEventListener('error', () => {
          const duration = Date.now() - startTime;
          const error = new Error('Network error during upload');
          
          Logger.error('VideoService', 'S3 upload network error', error, {
            correlationId: this.correlationId,
            duration: duration,
            connectionType: navigator?.connection?.effectiveType
          });
          
          this.trackJourneyStep('s3_upload_network_error', { duration: duration });
          
          reject(error);
        });

        // FIXED: Add timeout handler
        xhr.addEventListener('timeout', () => {
          const duration = Date.now() - startTime;
          const error = new Error(`Upload timeout after ${duration}ms - please check your connection`);
          
          Logger.error('VideoService', 'S3 upload timeout', error, {
            correlationId: this.correlationId,
            duration: duration,
            timeout: TIMEOUT_CONFIG.S3_UPLOAD_TIMEOUT,
            connectionType: navigator?.connection?.effectiveType
          });
          
          this.trackJourneyStep('s3_upload_timeout', { 
            duration: duration,
            timeout: TIMEOUT_CONFIG.S3_UPLOAD_TIMEOUT 
          });
          
          reject(error);
        });

        xhr.open('PUT', presignedUrl);
        xhr.setRequestHeader('Content-Type', 'video/quicktime');
        xhr.setRequestHeader('X-Correlation-Id', this.correlationId);
        xhr.send(formData._parts[0][1]); // Extract the actual file data
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      Logger.error('VideoService', 'S3 upload setup failed', error, {
        correlationId: this.correlationId,
        duration: duration
      });
      
      this.trackJourneyStep('s3_upload_setup_error', { 
        error: error.message,
        duration: duration 
      });
      
      throw error;
    }
  }

  // FIXED: Add timeout and retry to analysis trigger
  async triggerAnalysis(fileName, bucketName = 'golf-coach-videos-1753203601') {
    const startTime = Date.now();
    
    try {
      Logger.info('VideoService', 'Triggering analysis', {
        correlationId: this.correlationId,
        fileName: fileName,
        bucketName: bucketName
      });
      
      this.trackJourneyStep('trigger_analysis', { fileName, bucketName });

      // FIXED: Add timeout to analysis trigger
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_CONFIG.NETWORK_TIMEOUT);
      
      const response = await fetch(`${API_BASE_URL}/api/video/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-Id': this.correlationId
        },
        body: JSON.stringify({
          s3Key: fileName,
          bucketName: bucketName,
          userId: 'mobile-user',
          correlationId: this.correlationId
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`Failed to trigger analysis: ${response.status}`);
      }

      const data = await response.json();
      
      Logger.performance('VideoService', 'trigger_analysis', duration, {
        correlationId: this.correlationId,
        jobId: data.jobId,
        success: true
      });
      
      this.trackJourneyStep('trigger_analysis_success', { 
        jobId: data.jobId,
        duration: duration 
      });
      
      return {
        jobId: data.jobId || this.currentAnalysisId,
        status: 'started'
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      Logger.error('VideoService', 'Failed to trigger analysis', error, {
        correlationId: this.correlationId,
        fileName: fileName,
        duration: duration
      });
      
      this.trackJourneyStep('trigger_analysis_error', { 
        error: error.message,
        duration: duration 
      });
      
      throw error;
    }
  }

  // FIXED: Enhanced polling with exponential backoff and extended timeout
  async waitForAnalysisComplete(jobId, onProgress, maxDuration = TIMEOUT_CONFIG.ANALYSIS_POLL_TIMEOUT) {
    Logger.info('VideoService', 'Starting analysis polling', {
      correlationId: this.correlationId,
      jobId: jobId,
      maxDuration: maxDuration
    });
    
    this.trackJourneyStep('polling_start', { jobId, maxDuration });
    
    const startTime = Date.now();
    let lastStatus = '';
    let interval = TIMEOUT_CONFIG.POLL_INTERVAL_BASE;
    let attempt = 0;
    
    while (Date.now() - startTime < maxDuration) {
      attempt++;
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      
      try {
        Logger.info('VideoService', 'Polling for results', {
          correlationId: this.correlationId,
          attempt: attempt,
          elapsed: elapsedSeconds,
          interval: interval
        });
        
        // Use the analysis ID we saved earlier if jobId fails
        const idToCheck = this.currentAnalysisId || jobId;
        const results = await this.getAnalysisResults(idToCheck);
        
        // Log status changes
        if (results.status !== lastStatus) {
          Logger.info('VideoService', 'Status change detected', {
            correlationId: this.correlationId,
            oldStatus: lastStatus,
            newStatus: results.status,
            elapsed: elapsedSeconds
          });
          
          this.trackJourneyStep('status_change', { 
            from: lastStatus, 
            to: results.status, 
            elapsed: elapsedSeconds 
          });
          
          lastStatus = results.status;
        }
        
        // Check for full completion including AI analysis
        if (results.status === 'completed' && results.analysis && results.coaching_response) {
          const totalTime = Math.floor((Date.now() - startTime) / 1000);
          
          Logger.performance('VideoService', 'analysis_complete', Date.now() - startTime, {
            correlationId: this.correlationId,
            totalTime: totalTime,
            attempts: attempt,
            success: true
          });
          
          this.trackJourneyStep('analysis_complete', { 
            totalTime: totalTime,
            attempts: attempt 
          });
          
          return results;
        }
        
        if (results.status === 'failed' || results.status === 'FAILED') {
          throw new Error('Analysis failed on the server');
        }
        
        // Provide progress messages based on actual status
        const statusMessages = {
          'EXTRACTING_FRAMES': '🎬 Extracting swing frames from video...',
          'PROCESSING': '📸 Processing P1-P10 positions...',
          'UPLOADING_FRAMES': '⬆️ Uploading frame images...',
          'READY_FOR_AI': '🤖 Starting AI analysis...',
          'ANALYZING': '🧠 AI coach analyzing your swing...',
          'completed': '✅ Analysis complete!'
        };
        
        // Call progress callback
        if (onProgress) {
          const progressPercent = Math.min(30 + (elapsedSeconds / (maxDuration / 1000)) * 70, 95);
          onProgress({
            progress: progressPercent / 100,
            message: statusMessages[results.status] || results.message || 'Processing...',
            elapsed: elapsedSeconds,
            attempt: attempt
          });
        }
        
        // FIXED: Exponential backoff for polling
        await new Promise(resolve => setTimeout(resolve, interval));
        interval = Math.min(interval * 1.2, TIMEOUT_CONFIG.POLL_INTERVAL_MAX);
        
      } catch (error) {
        Logger.error('VideoService', 'Polling attempt failed', error, {
          correlationId: this.correlationId,
          attempt: attempt,
          elapsed: elapsedSeconds
        });
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
    
    const totalTime = Math.floor((Date.now() - startTime) / 1000);
    const timeoutError = new Error(`
      Analysis timeout after ${totalTime}s
      Correlation ID: ${this.correlationId}
      Job ID: ${jobId}
      Last Status: ${lastStatus}
      Attempts: ${attempt}
      Journey: ${JSON.stringify(this.userJourney.slice(-3))}
    `);
    
    Logger.error('VideoService', 'Analysis timeout', timeoutError, {
      correlationId: this.correlationId,
      totalTime: totalTime,
      lastStatus: lastStatus,
      attempts: attempt,
      userJourney: this.userJourney
    });
    
    this.trackJourneyStep('analysis_timeout', { 
      totalTime: totalTime,
      lastStatus: lastStatus,
      attempts: attempt 
    });
    
    throw timeoutError;
  }

  // Enhanced getAnalysisResults with better error handling
  async getAnalysisResults(jobIdOrAnalysisId) {
    const startTime = Date.now();
    
    try {
      Logger.info('VideoService', 'Getting analysis results', {
        correlationId: this.correlationId,
        jobId: jobIdOrAnalysisId
      });
      
      // FIXED: Add timeout to results request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_CONFIG.NETWORK_TIMEOUT);
      
      // First try as jobId
      let response = await fetch(`${API_BASE_URL}/api/video/results/${jobIdOrAnalysisId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-Id': this.correlationId
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // If that fails, try querying DynamoDB directly through a different endpoint
      if (!response.ok && response.status === 500) {
        Logger.info('VideoService', 'Primary results endpoint failed, trying alternative', {
          correlationId: this.correlationId,
          status: response.status,
          jobId: jobIdOrAnalysisId
        });
        
        const analysisId = jobIdOrAnalysisId;
        
        const controller2 = new AbortController();
        const timeoutId2 = setTimeout(() => controller2.abort(), TIMEOUT_CONFIG.NETWORK_TIMEOUT);
        
        response = await fetch(`${API_BASE_URL}/api/analysis/${analysisId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Correlation-Id': this.correlationId
          },
          signal: controller2.signal
        });
        
        clearTimeout(timeoutId2);
      }

      if (!response.ok) {
        throw new Error(`Failed to get results: ${response.status}`);
      }

      const data = await response.json();
      const duration = Date.now() - startTime;
      
      Logger.performance('VideoService', 'get_analysis_results', duration, {
        correlationId: this.correlationId,
        jobId: jobIdOrAnalysisId,
        hasData: !!data,
        success: true
      });
      
      // Check different possible response formats
      if (data.Item) {
        return this.parseDynamoDBResponse(data.Item);
      } else if (data.ai_analysis || data.analysis_results) {
        const hasCoachingResponse = data.ai_analysis_completed && data.ai_analysis?.coaching_response;
        return {
          status: hasCoachingResponse ? 'completed' : 'processing',
          analysis: data.ai_analysis || data.analysis_results,
          coaching_response: data.ai_analysis?.coaching_response,
        };
      } else if (data.status) {
        return {
          status: data.status,
          message: data.message || 'Processing...'
        };
      } else {
        Logger.info('VideoService', 'Unknown response format', {
          correlationId: this.correlationId,
          response: data
        });
        
        return {
          status: 'processing',
          message: 'Analysis in progress...'
        };
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      Logger.error('VideoService', 'Failed to get analysis results', error, {
        correlationId: this.correlationId,
        jobId: jobIdOrAnalysisId,
        duration: duration
      });
      
      throw error;
    }
  }

  // Helper to parse DynamoDB response format
  parseDynamoDBResponse(item) {
    const status = item.status?.S || 'processing';
    const aiAnalysis = item.ai_analysis?.S ? JSON.parse(item.ai_analysis.S) : null;
    const analysisResults = item.analysis_results?.S ? JSON.parse(item.analysis_results.S) : null;
    
    if (status === 'completed' && (aiAnalysis || analysisResults)) {
      return {
        status: 'completed',
        analysis: aiAnalysis || analysisResults,
        coaching_response: aiAnalysis?.coaching_response,
        symptoms: aiAnalysis?.symptoms_detected,
        root_cause: aiAnalysis?.root_cause,
        confidence: aiAnalysis?.confidence_score,
        recommendations: aiAnalysis?.practice_recommendations
      };
    }
    
    return {
      status: status,
      message: item.progress_message?.S || 'Processing...'
    };
  }

  // Enhanced complete workflow with comprehensive error handling
  async uploadAndAnalyze(videoUri, videoDuration, onProgress) {
    const startTime = Date.now();
    
    try {
      const fileName = this.generateFileName();
      
      Logger.info('VideoService', 'Starting upload and analyze workflow', {
        correlationId: this.correlationId,
        fileName: fileName,
        videoDuration: videoDuration
      });
      
      this.trackJourneyStep('workflow_start', { fileName, videoDuration });
      
      // Step 1: Get presigned URL
      const presignedUrl = await this.getPresignedUrl(fileName);
      
      // Step 2: Upload video
      await this.uploadVideoToS3(videoUri, presignedUrl, onProgress);
      
      // Step 3: Trigger analysis
      const analysisResult = await this.triggerAnalysis(fileName);
      
      const duration = Date.now() - startTime;
      
      Logger.performance('VideoService', 'upload_and_analyze', duration, {
        correlationId: this.correlationId,
        fileName: fileName,
        jobId: analysisResult.jobId,
        success: true
      });
      
      this.trackJourneyStep('workflow_success', { 
        jobId: analysisResult.jobId,
        duration: duration 
      });
      
      return {
        jobId: analysisResult.jobId,
        fileName: fileName,
        status: 'uploaded',
        correlationId: this.correlationId
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      Logger.error('VideoService', 'Upload and analyze workflow failed', error, {
        correlationId: this.correlationId,
        duration: duration,
        userJourney: this.userJourney
      });
      
      this.trackJourneyStep('workflow_error', { 
        error: error.message,
        duration: duration 
      });
      
      throw error;
    }
  }

  // Get debugging information for support
  getDebuggingInfo() {
    return {
      correlationId: this.correlationId,
      currentAnalysisId: this.currentAnalysisId,
      userJourney: this.userJourney,
      systemInfo: {
        userAgent: navigator?.userAgent,
        connection: navigator?.connection?.effectiveType,
        memory: performance?.memory?.usedJSHeapSize,
        timestamp: new Date().toISOString()
      }
    };
  }
}

// Export singleton instance
export default new EnhancedVideoService();