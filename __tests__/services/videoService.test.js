// videoService.test.js - Unit tests for video upload and analysis pipeline
// Tests: presigned URL flow, S3 upload, polling with status transitions, timeout

describe('VideoService', () => {
  describe('getPresignedUrl', () => {
    it.todo('returns presigned URL from API response');
    it.todo('throws on non-200 response');
    it.todo('sets currentAnalysisId from fileName');
  });

  describe('uploadVideoToS3', () => {
    it.todo('uploads video via XHR PUT to presigned URL');
    it.todo('calls onProgress with { progress, stage, message }');
    it.todo('rejects on upload failure');
    it.todo('rejects on timeout after 90 seconds');
  });

  describe('triggerAnalysis', () => {
    it.todo('sends s3Key and bucketName without trim params');
    it.todo('throws AUTHENTICATION_REQUIRED when userId is missing');
    it.todo('throws AUTHENTICATION_REQUIRED on 401/403');
  });

  describe('uploadAndAnalyze', () => {
    it.todo('orchestrates presigned URL → upload → trigger analysis');
    it.todo('returns { jobId, fileName, status }');
    it.todo('throws AUTHENTICATION_REQUIRED without auth headers');
  });

  describe('waitForAnalysisComplete', () => {
    it.todo('polls until status is completed with coaching_response');
    it.todo('calls onProgress with golf-themed stage messages');
    it.todo('throws on FAILED status');
    it.todo('throws timeout error after maxAttempts');
    it.todo('rotates through stage message variants');
  });
});
