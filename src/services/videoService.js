// videoService.js - Video upload and analysis pipeline
// Handles: presigned URL -> S3 upload -> trigger analysis -> poll for results
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod';
const VIDEO_BUCKET = process.env.EXPO_PUBLIC_VIDEO_BUCKET || 'golf-coach-videos-1753203601';
const DEFAULT_POLL_INTERVAL_MS = 1500;

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
  analyzing: [
    'Your coach is studying the details...',
    'Comparing against tour-level fundamentals...',
    'Building your personalized feedback...',
  ],
  processing: ['Preparing your swing for analysis...'],
  completed: ['Analysis complete!'],
};

// Derive content type and extension from a video URI
const inferVideoMeta = (uri) => {
  const lower = (uri || '').toLowerCase();
  if (lower.endsWith('.mp4') || lower.includes('.mp4')) {
    return { contentType: 'video/mp4', ext: '.mp4' };
  }
  // Default to QuickTime (.mov) for iOS
  return { contentType: 'video/quicktime', ext: '.mov' };
};

const DYNAMO_ATTR_KEYS = new Set(['S', 'N', 'BOOL', 'NULL', 'M', 'L']);
const FATAL_ANALYSIS_FAILURE = 'ANALYSIS_FAILED';

class VideoService {
  constructor() {
    this.currentAnalysisId = null;
  }

  // Generate unique S3 key for video upload
  generateFileName(userId, ext = '.mov') {
    if (!userId) throw new Error('userId is required for generateFileName');
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `golf-swings/${userId}/${timestamp}-${random}${ext}`;
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
  async uploadVideoToS3(videoUri, presignedUrl, contentType, onProgress) {
    // Convert local file URI to blob (RN's XHR only auto-handles file objects in FormData,
    // but presigned PUTs need raw body, so we fetch the file as a blob first)
    const fileResponse = await fetch(videoUri);
    const blob = await fileResponse.blob();

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
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.send(blob);
    });
  }

  // Step 3: Trigger server-side analysis (optionally include trim bounds)
  async triggerAnalysis(fileName, bucketName = VIDEO_BUCKET, userId, authHeaders = {}, trimData = null) {
    if (!userId) throw new Error('AUTHENTICATION_REQUIRED');

    const requestBody = { s3Key: fileName, bucketName };
    const normalizedTrim = this.normalizeTrimData(trimData);
    if (normalizedTrim) {
      requestBody.trimStartMs = normalizedTrim.trimStartMs;
      requestBody.trimEndMs = normalizedTrim.trimEndMs;
    }

    const response = await fetch(`${API_BASE_URL}/api/video/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(requestBody),
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
      if (response.status === 401 || response.status === 403) {
        throw new Error('AUTHENTICATION_REQUIRED');
      }
      throw new Error(`Failed to get results: ${response.status}`);
    }

    const data = await response.json();

    // DynamoDB format
    if (data.Item) return this.parseDynamoDBResponse(data.Item);

    // Direct format
    if (data.ai_analysis || data.analysis_results || data.status) {
      const aiAnalysis = this.parseMaybeJson(data.ai_analysis);
      const analysisResults = this.parseMaybeJson(data.analysis_results);
      const coachingResponse = this.extractCoachingResponse(aiAnalysis);
      const normalizedStatus = this.normalizeStatus(data.status, {
        aiAnalysisCompleted: Boolean(data.ai_analysis_completed),
        coachingResponse,
      });

      return {
        status: normalizedStatus,
        analysis: aiAnalysis || analysisResults,
        coaching_response: coachingResponse,
        message: data.message || 'Processing...',
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
    const normalizedItem = this.parseDynamoValue(item);
    const aiAnalysis = this.parseMaybeJson(normalizedItem.ai_analysis);
    const analysisResults = this.parseMaybeJson(normalizedItem.analysis_results);
    const coachingResponse = this.extractCoachingResponse(aiAnalysis);
    const status = this.normalizeStatus(normalizedItem.status, {
      aiAnalysisCompleted: Boolean(normalizedItem.ai_analysis_completed),
      coachingResponse,
    });

    if (status === 'completed' && (aiAnalysis || analysisResults)) {
      return {
        status: 'completed',
        analysis: aiAnalysis || analysisResults,
        coaching_response: coachingResponse,
        symptoms: aiAnalysis?.symptoms_detected,
        root_cause: aiAnalysis?.root_cause,
        confidence: aiAnalysis?.confidence_score,
        recommendations: aiAnalysis?.practice_recommendations,
      };
    }

    return {
      status,
      analysis: aiAnalysis || analysisResults,
      coaching_response: coachingResponse,
      message: normalizedItem.progress_message || 'Processing...',
    };
  }

  parseDynamoValue(value) {
    if (Array.isArray(value)) {
      return value.map((entry) => this.parseDynamoValue(entry));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const keys = Object.keys(value);
    const isAttrValue = keys.length > 0 && keys.every((key) => DYNAMO_ATTR_KEYS.has(key));
    if (isAttrValue) {
      if (Object.prototype.hasOwnProperty.call(value, 'S')) return value.S;
      if (Object.prototype.hasOwnProperty.call(value, 'N')) return Number(value.N);
      if (Object.prototype.hasOwnProperty.call(value, 'BOOL')) return Boolean(value.BOOL);
      if (Object.prototype.hasOwnProperty.call(value, 'NULL')) return null;
      if (Object.prototype.hasOwnProperty.call(value, 'M')) return this.parseDynamoValue(value.M);
      if (Object.prototype.hasOwnProperty.call(value, 'L')) {
        return Array.isArray(value.L) ? value.L.map((entry) => this.parseDynamoValue(entry)) : [];
      }
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, this.parseDynamoValue(entry)])
    );
  }

  parseMaybeJson(payload) {
    if (!payload) {
      return null;
    }

    if (typeof payload !== 'string') {
      return payload;
    }

    try {
      return JSON.parse(payload);
    } catch (error) {
      return payload;
    }
  }

  extractCoachingResponse(aiAnalysis) {
    if (!aiAnalysis || typeof aiAnalysis !== 'object') {
      return null;
    }
    return aiAnalysis.coaching_response || aiAnalysis.response || null;
  }

  normalizeTrimData(trimData) {
    if (!trimData || typeof trimData !== 'object') {
      return null;
    }

    const asNumber = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    let startMs = asNumber(trimData.startTimeMs ?? trimData.trimStartMs);
    let endMs = asNumber(trimData.endTimeMs ?? trimData.trimEndMs);

    // Backward compatibility for older second-based trim payloads.
    if (startMs === null && trimData.startTime !== undefined) {
      const startSeconds = asNumber(trimData.startTime);
      if (startSeconds !== null) startMs = Math.round(startSeconds * 1000);
    }
    if (endMs === null && trimData.endTime !== undefined) {
      const endSeconds = asNumber(trimData.endTime);
      if (endSeconds !== null) endMs = Math.round(endSeconds * 1000);
    }

    if (startMs !== null && endMs !== null && endMs > startMs) {
      return {
        trimStartMs: Math.round(startMs),
        trimEndMs: Math.round(endMs),
      };
    }

    const durationMs = asNumber(trimData.durationMs);
    if (durationMs !== null && durationMs > 0) {
      const normalizedStart = startMs !== null ? Math.round(startMs) : 0;
      return {
        trimStartMs: normalizedStart,
        trimEndMs: normalizedStart + Math.round(durationMs),
      };
    }

    return null;
  }

  normalizeStatus(rawStatus, { aiAnalysisCompleted = false, coachingResponse = null } = {}) {
    const statusToken = typeof rawStatus === 'string' ? rawStatus.toUpperCase() : '';

    if (coachingResponse && aiAnalysisCompleted) {
      return 'completed';
    }

    if (statusToken === 'FAILED') return 'failed';
    if (statusToken === 'AI_PROCESSING' || statusToken === 'READY_FOR_AI') return 'analyzing';
    if (statusToken === 'AI_COMPLETED' || statusToken === 'COMPLETED') {
      return coachingResponse ? 'completed' : 'analyzing';
    }
    if (
      statusToken === 'PROCESSING' ||
      statusToken === 'STARTED' ||
      statusToken === 'EXTRACTING_FRAMES' ||
      statusToken === 'UPLOADING_FRAMES'
    ) {
      return statusToken || 'processing';
    }
    if (typeof rawStatus === 'string' && rawStatus.trim()) {
      return rawStatus;
    }

    if (aiAnalysisCompleted) {
      return coachingResponse ? 'completed' : 'analyzing';
    }

    return 'processing';
  }

  // Step 5: Complete upload + analysis workflow
  async uploadAndAnalyze(videoUri, videoDuration, onProgress, userId, authHeaders = {}, trimData = null) {
    if (!userId) throw new Error('AUTHENTICATION_REQUIRED');
    if (!authHeaders?.Authorization) throw new Error('AUTHENTICATION_REQUIRED');

    const { contentType, ext } = inferVideoMeta(videoUri);
    const fileName = this.generateFileName(userId, ext);

    // Get presigned URL
    const presignedUrl = await this.getPresignedUrl(fileName, contentType, authHeaders);

    // Upload video (already trimmed client-side)
    await this.uploadVideoToS3(videoUri, presignedUrl, contentType, onProgress);

    // Trigger analysis
    const analysisResult = await this.triggerAnalysis(fileName, VIDEO_BUCKET, userId, authHeaders, trimData);

    return { jobId: analysisResult.jobId, fileName, status: 'uploaded' };
  }

  // Step 6: Poll for analysis completion with golf-themed progress messages
  async waitForAnalysisComplete(jobId, onProgress, maxAttempts = 60, intervalMs = DEFAULT_POLL_INTERVAL_MS, authHeaders = {}) {
    const startTime = Date.now();
    let lastStatus = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const idToCheck = this.currentAnalysisId || jobId;
        const results = await this.getAnalysisResults(idToCheck, authHeaders);

        if (results.status !== lastStatus) {
          if (__DEV__) console.log(`Status: ${lastStatus || 'init'} -> ${results.status}`);
          lastStatus = results.status;
        }

        // Full completion: AI analysis present
        if (results.status === 'completed' && results.analysis && results.coaching_response) {
          return results;
        }

        if (results.status === 'failed' || results.status === 'FAILED') {
          throw new Error(FATAL_ANALYSIS_FAILURE);
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
        if (error?.message === 'AUTHENTICATION_REQUIRED') {
          throw error;
        }
        if (error?.message === FATAL_ANALYSIS_FAILURE) {
          throw new Error('Analysis failed on the server');
        }
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
