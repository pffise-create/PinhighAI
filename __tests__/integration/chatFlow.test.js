// chatFlow.test.js - Integration-style tests for core chat/video service flows

describe('Chat Flow Integration', () => {
  describe('text conversation flow', () => {
    it('send message -> receive coach response', async () => {
      jest.resetModules();
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: 'Great move in transition. Keep your chest rotating.',
          timestamp: '2026-02-18T00:00:00.000Z',
        }),
      });

      const chatApiService = require('../../src/services/chatApiService').default;
      const result = await chatApiService.sendMessage('How was that swing?', 'user-1', {
        Authorization: 'Bearer token',
      });

      expect(result.response).toMatch(/Great move in transition/);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('video analysis flow', () => {
    it('upload and poll pipeline resolves with coach response', async () => {
      jest.resetModules();
      global.fetch = jest.fn();
      const videoService = require('../../src/services/videoService').default;

      jest.spyOn(videoService, 'generateFileName').mockReturnValue('golf-swings/user-1/analysis-xyz.mov');
      jest.spyOn(videoService, 'getPresignedUrl').mockResolvedValue('https://s3.example/upload');
      jest.spyOn(videoService, 'uploadVideoToS3').mockResolvedValue(undefined);
      jest.spyOn(videoService, 'triggerAnalysis').mockResolvedValue({ jobId: 'analysis-xyz', status: 'started' });
      jest.spyOn(videoService, 'getAnalysisResults')
        .mockResolvedValueOnce({ status: 'analyzing', message: 'Coach reviewing your swing...' })
        .mockResolvedValueOnce({
          status: 'completed',
          analysis: { coaching_response: 'Great tempo. Focus on shallowing the club.' },
          coaching_response: 'Great tempo. Focus on shallowing the club.',
        });

      const uploadResult = await videoService.uploadAndAnalyze(
        'file://clip.mov',
        4.5,
        jest.fn(),
        'user-1',
        { Authorization: 'Bearer token' }
      );

      const analysis = await videoService.waitForAnalysisComplete(
        uploadResult.jobId,
        jest.fn(),
        5,
        0,
        { Authorization: 'Bearer token' }
      );

      expect(uploadResult.jobId).toBe('analysis-xyz');
      expect(analysis.coaching_response).toMatch(/Great tempo/);
    });
  });
});
