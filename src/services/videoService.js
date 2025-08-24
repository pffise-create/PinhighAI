// videoService.js - Complete service for video upload and analysis
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://t7y64hqkq0.execute-api.us-east-1.amazonaws.com/prod';

class VideoService {
  constructor() {
    this.currentAnalysisId = null;
  }

  // Generate unique filename for video upload
  generateFileName(userId = 'user') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `golf-swings/${userId}/${timestamp}-${random}.mov`;
  }

  // Step 1: Get presigned URL for S3 upload
  async getPresignedUrl(fileName, contentType = 'video/quicktime') {
    try {
      console.log('🔗 Getting presigned URL for:', fileName);
      
      const response = await fetch(`${API_BASE_URL}/api/video/presigned-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: fileName,
          contentType,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get presigned URL: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Got presigned URL for:', data.fileName || fileName);
      
      // Extract analysis ID from the filename for later use
      this.currentAnalysisId = this.extractAnalysisId(fileName);
      
      return data.presignedUrl;
      
    } catch (error) {
      console.error('❌ Error getting presigned URL:', error);
      throw new Error(`Failed to get upload URL: ${error.message}`);
    }
  }

  // Extract analysis ID from filename
  extractAnalysisId(fileName) {
    // fileName format: golf-swings/user-xxx/timestamp-random.mov
    const parts = fileName.split('/');
    if (parts.length >= 3) {
      const filenamePart = parts[2].replace('.mov', '').replace('.mp4', '');
      return filenamePart; // This becomes our analysis ID
    }
    return null;
  }

  // Step 2: Upload video to S3 using presigned URL
  async uploadVideoToS3(videoUri, presignedUrl, onProgress) {
    try {
      console.log('⬆️ Uploading video to S3...');
      
      // Create form data for video upload
      const formData = new FormData();
      formData.append('file', {
        uri: videoUri,
        type: 'video/quicktime',
        name: 'golf-swing.mov',
      });

      const xhr = new XMLHttpRequest();
      
      return new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100;
            onProgress && onProgress(progress);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            console.log('✅ Video uploaded successfully');
            resolve(xhr.response);
          } else {
            reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error during upload'));
        });

        xhr.open('PUT', presignedUrl);
        xhr.setRequestHeader('Content-Type', 'video/quicktime');
        xhr.send(formData._parts[0][1]); // Extract the actual file data
      });
      
    } catch (error) {
      console.error('❌ Upload error:', error);
      throw error;
    }
  }

  // Step 3: Trigger analysis after upload
  async triggerAnalysis(fileName, bucketName = 'golf-coach-videos-1753203601') {
    try {
      console.log('🔄 Triggering analysis for:', fileName);
      
      const response = await fetch(`${API_BASE_URL}/api/video/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          s3Key: fileName,
          bucketName: bucketName,
          userId: 'mobile-user'
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to trigger analysis: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Analysis triggered:', data.jobId);
      
      return {
        jobId: data.jobId || this.currentAnalysisId,
        status: 'started'
      };
      
    } catch (error) {
      console.error('❌ Error triggering analysis:', error);
      throw error;
    }
  }

  // Step 4: Get analysis results
  async getAnalysisResults(jobIdOrAnalysisId) {
    try {
      console.log('📋 Getting analysis results for:', jobIdOrAnalysisId);
      
      // First try as jobId
      let response = await fetch(`${API_BASE_URL}/api/video/results/${jobIdOrAnalysisId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // If that fails, try querying DynamoDB directly through a different endpoint
      if (!response.ok && response.status === 500) {
        console.log('⚠️ Results endpoint failed, trying alternative...');
        
        // Try to construct an analysis ID if we have a timestamp-based ID
        const analysisId = jobIdOrAnalysisId;
        
        // Call your Lambda directly to get from DynamoDB
        response = await fetch(`${API_BASE_URL}/api/analysis/${analysisId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      }

      if (!response.ok) {
        throw new Error(`Failed to get results: ${response.status}`);
      }

      const data = await response.json();
      
      // Check different possible response formats
      if (data.Item) {
        // DynamoDB format
        return this.parseDynamoDBResponse(data.Item);
      } else if (data.ai_analysis || data.analysis_results) {
        // Direct format
        console.log('✅ Got analysis results');
        const hasCoachingResponse = data.ai_analysis_completed && data.ai_analysis?.coaching_response;
        return {
          status: hasCoachingResponse ? 'completed' : 'processing',
          analysis: data.ai_analysis || data.analysis_results,
          coaching_response: data.ai_analysis?.coaching_response,
        };
      } else if (data.status) {
        // Status response
        return {
          status: data.status,
          message: data.message || 'Processing...'
        };
      } else {
        // Unknown format
        console.log('⚠️ Unknown response format:', data);
        return {
          status: 'processing',
          message: 'Analysis in progress...'
        };
      }
      
    } catch (error) {
      console.error('❌ Error getting results:', error);
      throw error;
    }
  }

  // Helper to parse DynamoDB response format
  parseDynamoDBResponse(item) {
    // Parse DynamoDB item format
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

  // Step 5: Complete upload and analysis workflow
  async uploadAndAnalyze(videoUri, videoDuration, onProgress) {
    try {
      const fileName = this.generateFileName();
      
      // Step 1: Get presigned URL
      const presignedUrl = await this.getPresignedUrl(fileName);
      
      // Step 2: Upload video
      await this.uploadVideoToS3(videoUri, presignedUrl, onProgress);
      
      // Step 3: Trigger analysis
      const analysisResult = await this.triggerAnalysis(fileName);
      
      return {
        jobId: analysisResult.jobId,
        fileName: fileName,
        status: 'uploaded'
      };
      
    } catch (error) {
      console.error('❌ Upload and analyze failed:', error);
      throw error;
    }
  }

  // Step 6: Poll for analysis completion with progress updates
  async waitForAnalysisComplete(jobId, onProgress, maxAttempts = 60, intervalMs = 5000) {
    console.log('⏳ Starting to poll for results...');
    
    const startTime = Date.now();
    let lastStatus = '';
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        console.log(`⏳ Polling attempt ${attempt}/${maxAttempts} (${elapsedSeconds}s elapsed)`);
        
        // Use the analysis ID we saved earlier if jobId fails
        const idToCheck = this.currentAnalysisId || jobId;
        const results = await this.getAnalysisResults(idToCheck);
        
        // Log status changes
        if (results.status !== lastStatus) {
          console.log(`📊 Status changed: ${lastStatus} → ${results.status}`);
          lastStatus = results.status;
        }
        
        // Check for full completion including AI analysis
        if (results.status === 'completed' && results.analysis && results.coaching_response) {
          const totalTime = Math.floor((Date.now() - startTime) / 1000);
          console.log(`🎉 Full AI analysis complete! Total time: ${totalTime}s`);
          return results;
        }
        
        // If frame extraction is complete but AI analysis isn't, keep polling
        if (results.status === 'completed' && results.analysis && !results.coaching_response) {
          console.log('📸 Frame extraction complete, waiting for AI analysis...');
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
        
        if (statusMessages[results.status]) {
          console.log(statusMessages[results.status]);
        }
        
        // Call progress callback
        if (onProgress) {
          const progress = Math.min(30 + (attempt / maxAttempts) * 70, 95);
          onProgress({
            progress: progress / 100,
            message: statusMessages[results.status] || results.message || 'Processing...'
          });
        }
        
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        
      } catch (error) {
        console.warn(`⚠️ Polling attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxAttempts) {
          const totalTime = Math.floor((Date.now() - startTime) / 1000);
          throw new Error(`Analysis timeout after ${totalTime}s: ${error.message}`);
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    
    const totalTime = Math.floor((Date.now() - startTime) / 1000);
    throw new Error(`Analysis timed out after ${totalTime}s`);
  }
}

// Export singleton instance
export default new VideoService();