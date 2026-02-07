// videoService.js - Video upload and analysis pipeline
// Handles: presigned URL -> S3 upload -> trigger analysis -> poll for results
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod';

// Golf-themed progress messages mapped to pipeline stages.
// Each stage has multiple variants that rotate every ~3-4s for visual life.
const STAGE_MESSAGES = {
  EXTRACTING_FRAMES: [
    'Breaking down your swing frame by frame...',
    'Capturing key positions...',
    'Isolating your swing sequence...',
  ],
  PROCESSING: [
    'Mapping P1 through P10 positions...',
    'Tracing your swing plane...',
    'Measuring club path and face angle...',
  ],
  UPLOADING_FRAMES: [
    'Preparing frames for analysis...',
    'Lining up the shot data...',
    'Organizing swing positions...',
  ],
  READY_FOR_AI: [
    'Handing off to your AI coach...',
    'Coach is reviewing your swing...',
    'Setting up the lesson...',
  ],
  ANALYZING: [
    'Your coach is studying the details...',
    'Comparing against tour-level fundamentals...',
    'Building your personalized feedback...',
  ],
  completed: ['Analysis complete!'],
};

class VideoService {
  constructor() {
    this.currentAnalysisId = null;
  }

  // Generate unique S3 key for video upload
  generateFileName(userId) {
    if (!userId) throw new Error('userId is required for generateFileName');
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `golf-swings/${userId}/${timestamp}-${random}.mov`;
  }

  // Step 1: Get presigned URL for S3 upload
  async getPresignedUrl(fileName, contentType = 'video/quicktime', authHeaders = {}) {
    const response = await fetch(`${API_BASE_URL}/api/video/presigned-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ fileName, contentType }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get presigned URL: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    this.currentAnalysisId = this.extractAnalysisId(fileName);
    return data.presignedUrl;
  }

  // Extract analysis ID from S3 key (e.g. golf-swings/user-xxx/timestamp-random.mov -> timestamp-random)
  extractAnalysisId(fileName) {
    const parts = fileName.split('/');
    if (parts.length >= 3) {
      return parts[2].replace('.mov', '').replace('.mp4', '');
    }
    return null;
  }

  // Step 2: Upload video to S3 using presigned URL
  async uploadVideoToS3(videoUri, presignedUrl, onProgress) {
    const formData = new FormData();
    formData.append('file', {
      uri: videoUri,
      type: 'video/quicktime',
      name: 'golf-swing.mov',
    });

    const xhr = new XMLHttpRequest();
    xhr.timeout = 90000; // 90s timeout for video uploads

    return new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          onProgress?.({
            progress: event.loaded / event.total,
            stage: 'UPLOADING',
            message: 'Uploading your swing video...',
          });
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
      xhr.addEventListener('timeout', () => reject(new Error('Video upload timed out after 90 seconds')));

      xhr.open('PUT', presignedUrl);
      xhr.setRequestHeader('Content-Type', 'video/quicktime');
      xhr.send(formData._parts[0][1]);
    });
  }

  // Step 3: Trigger server-side analysis (no trim params — client trims before upload)
  async triggerAnalysis(fileName, bucketName = 'golf-coach-videos-1753203601', userId, authHeaders = {}) {
    if (!userId) throw new Error('AUTHENTICATION_REQUIRED');

    const response = await fetch(`${API_BASE_URL}/api/video/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ s3Key: fileName, bucketName }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('AUTHENTICATION_REQUIRED');
      }
      const errorText = await response.text();
      throw new Error(`Failed to trigger analysis: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return { jobId: data.jobId || this.currentAnalysisId, status: 'started' };
  }

  // Step 4: Get analysis results
  async getAnalysisResults(jobIdOrAnalysisId, authHeaders = {}) {
    const headers = { 'Content-Type': 'application/json', ...authHeaders };

    let response = await fetch(`${API_BASE_URL}/api/video/results/${jobIdOrAnalysisId}`, {
      method: 'GET',
      headers,
    });

    // Fallback to alternative endpoint if primary fails
    if (!response.ok && response.status === 500) {
      response = await fetch(`${API_BASE_URL}/api/analysis/${jobIdOrAnalysisId}`, {
        method: 'GET',
        headers,
      });
    }

    if (!response.ok) {
      throw new Error(`Failed to get results: ${response.status}`);
    }

    const data = await response.json();

    // DynamoDB format
    if (data.Item) return this.parseDynamoDBResponse(data.Item);

    // Direct format
    if (data.ai_analysis || data.analysis_results) {
      const hasCoachingResponse = data.ai_analysis_completed && data.ai_analysis?.coaching_response;
      return {
        status: hasCoachingResponse ? 'completed' : 'processing',
        analysis: data.ai_analysis || data.analysis_results,
        coaching_response: data.ai_analysis?.coaching_response,
      };
    }

    // Status-only response
    return {
      status: data.status || 'processing',
      message: data.message || 'Processing...',
    };
  }

  // Parse DynamoDB item format into normalized result
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
        recommendations: aiAnalysis?.practice_recommendations,
      };
    }

    return { status, message: item.progress_message?.S || 'Processing...' };
  }

  // Step 5: Complete upload + analysis workflow (client trims before calling this)
  async uploadAndAnalyze(videoUri, videoDuration, onProgress, userId, authHeaders = {}) {
    if (!userId) throw new Error('AUTHENTICATION_REQUIRED');
    if (!authHeaders?.Authorization) throw new Error('AUTHENTICATION_REQUIRED');

    const fileName = this.generateFileName(userId);

    // Get presigned URL
    const presignedUrl = await this.getPresignedUrl(fileName, 'video/quicktime', authHeaders);

    // Upload video (already trimmed client-side)
    await this.uploadVideoToS3(videoUri, presignedUrl, onProgress);

    // Trigger analysis
    const analysisResult = await this.triggerAnalysis(fileName, 'golf-coach-videos-1753203601', userId, authHeaders);

    return { jobId: analysisResult.jobId, fileName, status: 'uploaded' };
  }

  // Step 6: Poll for analysis completion with golf-themed progress messages
  async waitForAnalysisComplete(jobId, onProgress, maxAttempts = 60, intervalMs = 5000, authHeaders = {}) {
    const startTime = Date.now();
    let lastStatus = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const idToCheck = this.currentAnalysisId || jobId;
        const results = await this.getAnalysisResults(idToCheck, authHeaders);

        // Log status transitions
        if (results.status !== lastStatus) {
          console.log(`Status: ${lastStatus || 'init'} -> ${results.status}`);
          lastStatus = results.status;
        }

        // Full completion: AI analysis present
        if (results.status === 'completed' && results.analysis && results.coaching_response) {
          return results;
        }

        if (results.status === 'failed' || results.status === 'FAILED') {
          throw new Error('Analysis failed on the server');
        }

        // Pick a golf-themed message for the current pipeline stage
        const stageMessages = STAGE_MESSAGES[results.status];
        const message = stageMessages
          ? stageMessages[attempt % stageMessages.length]
          : (results.message || 'Processing...');

        onProgress?.({
          progress: Math.min(0.30 + (attempt / maxAttempts) * 0.65, 0.95),
          stage: results.status,
          message,
        });

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      } catch (error) {
        if (attempt === maxAttempts) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          throw new Error(`Analysis timeout after ${elapsed}s: ${error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    throw new Error(`Analysis timed out after ${elapsed}s`);
  }
}

// Export singleton instance
export default new VideoService();
