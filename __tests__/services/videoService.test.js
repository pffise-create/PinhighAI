// videoService.test.js - Unit tests for video upload and analysis pipeline

describe('VideoService', () => {
  let videoService;

  beforeEach(() => {
    jest.resetModules();
    videoService = require('../../src/services/videoService').default;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('getPresignedUrl', () => {
    it('returns presigned URL and sets analysis id from file name', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ presignedUrl: 'https://s3.example/upload' }),
      });

      const url = await videoService.getPresignedUrl(
        'golf-swings/user-1/12345-abcd.mov',
        'video/quicktime',
        { Authorization: 'Bearer token' }
      );

      expect(url).toBe('https://s3.example/upload');
      expect(videoService.currentAnalysisId).toBe('12345-abcd');
    });
  });

  describe('uploadAndAnalyze', () => {
    it('orchestrates presigned URL -> upload -> trigger analysis', async () => {
      jest.spyOn(videoService, 'generateFileName').mockReturnValue('golf-swings/user-1/abc123.mov');
      jest.spyOn(videoService, 'getPresignedUrl').mockResolvedValue('https://s3.example/upload');
      jest.spyOn(videoService, 'uploadVideoToS3').mockResolvedValue(undefined);
      jest.spyOn(videoService, 'triggerAnalysis').mockResolvedValue({ jobId: 'abc123', status: 'started' });

      const result = await videoService.uploadAndAnalyze(
        'file://clip.mov',
        4.2,
        jest.fn(),
        'user-1',
        { Authorization: 'Bearer token' }
      );

      expect(videoService.getPresignedUrl).toHaveBeenCalled();
      expect(videoService.uploadVideoToS3).toHaveBeenCalled();
      expect(videoService.triggerAnalysis).toHaveBeenCalled();
      expect(result).toEqual({
        jobId: 'abc123',
        fileName: 'golf-swings/user-1/abc123.mov',
        status: 'uploaded',
      });
    });

    it('throws AUTHENTICATION_REQUIRED without auth headers', async () => {
      await expect(
        videoService.uploadAndAnalyze('file://clip.mov', 4.2, jest.fn(), 'user-1', {})
      ).rejects.toThrow('AUTHENTICATION_REQUIRED');
    });
  });

  describe('triggerAnalysis trim payload', () => {
    it('includes trimStartMs/trimEndMs when trimData is present', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jobId: 'analysis-1' }),
      });

      await videoService.triggerAnalysis(
        'golf-swings/user-1/analysis-1.mov',
        'golf-coach-videos-1753203601',
        'user-1',
        { Authorization: 'Bearer token' },
        { startTimeMs: 1200, endTimeMs: 4700 }
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/video/analyze'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            s3Key: 'golf-swings/user-1/analysis-1.mov',
            bucketName: 'golf-coach-videos-1753203601',
            trimStartMs: 1200,
            trimEndMs: 4700,
          }),
        })
      );
    });

    it('normalizes legacy second-based trim payloads', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jobId: 'analysis-2' }),
      });

      await videoService.triggerAnalysis(
        'golf-swings/user-1/analysis-2.mov',
        'golf-coach-videos-1753203601',
        'user-1',
        { Authorization: 'Bearer token' },
        { startTime: 1.25, endTime: 4.5 }
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/video/analyze'),
        expect.objectContaining({
          body: JSON.stringify({
            s3Key: 'golf-swings/user-1/analysis-2.mov',
            bucketName: 'golf-coach-videos-1753203601',
            trimStartMs: 1250,
            trimEndMs: 4500,
          }),
        })
      );
    });
  });

  describe('waitForAnalysisComplete', () => {
    it('polls until status is completed with coaching_response', async () => {
      const progressSpy = jest.fn();
      jest.spyOn(videoService, 'getAnalysisResults')
        .mockResolvedValueOnce({ status: 'analyzing', message: 'AI in progress...' })
        .mockResolvedValueOnce({
          status: 'completed',
          analysis: { coaching_response: 'Keep your chest rotating through impact.' },
          coaching_response: 'Keep your chest rotating through impact.',
        });

      const result = await videoService.waitForAnalysisComplete('analysis-1', progressSpy, 5, 0, {});

      expect(result.coaching_response).toBe('Keep your chest rotating through impact.');
      expect(progressSpy).toHaveBeenCalled();
    });

    it('fails fast on explicit FAILED status instead of timing out', async () => {
      jest.spyOn(videoService, 'getAnalysisResults').mockResolvedValue({
        status: 'failed',
        message: 'AI analysis failed',
      });

      await expect(
        videoService.waitForAnalysisComplete('analysis-1', jest.fn(), 5, 0, {})
      ).rejects.toThrow('Analysis failed on the server');

      expect(videoService.getAnalysisResults).toHaveBeenCalledTimes(1);
    });

    it('throws timeout error after maxAttempts on transient errors', async () => {
      jest.spyOn(videoService, 'getAnalysisResults').mockRejectedValue(new Error('network'));

      await expect(
        videoService.waitForAnalysisComplete('analysis-1', jest.fn(), 2, 0, {})
      ).rejects.toThrow('Analysis timeout');
    });
  });

  describe('result parsing', () => {
    it('parses direct API payload with string ai_analysis', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'AI_COMPLETED',
          ai_analysis_completed: true,
          ai_analysis: JSON.stringify({ coaching_response: 'Great sequencing.' }),
          analysis_results: { frames_extracted: 16 },
        }),
      });

      const result = await videoService.getAnalysisResults('analysis-2', {});
      expect(result.status).toBe('completed');
      expect(result.coaching_response).toBe('Great sequencing.');
    });

    it('normalizes DynamoDB document-style item payload', () => {
      const result = videoService.parseDynamoDBResponse({
        status: 'AI_COMPLETED',
        ai_analysis_completed: true,
        ai_analysis: JSON.stringify({ coaching_response: 'Hold your finish.' }),
        analysis_results: { frames_extracted: 12 },
        progress_message: 'Done',
      });

      expect(result.status).toBe('completed');
      expect(result.coaching_response).toBe('Hold your finish.');
    });
  });
});
