// chatApiService.test.js - Unit tests for simplified chat API service
// Tests: sendMessage success, 401 handling, timeout, error propagation

describe('ChatApiService', () => {
  let chatApiService;

  const loadService = () => {
    jest.resetModules();
    chatApiService = require('../../src/services/chatApiService').default;
  };

  beforeEach(() => {
    global.fetch = jest.fn();
    loadService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('returns { response, timestamp } on success', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ response: 'Coach reply', timestamp: '2026-02-18T00:00:00.000Z' }),
      });

      const result = await chatApiService.sendMessage('  How was my swing?  ', 'user-1', { Authorization: 'Bearer token' });

      expect(result).toEqual({
        response: 'Coach reply',
        timestamp: '2026-02-18T00:00:00.000Z',
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toMatch(/\/api\/chat$/);
      expect(options.headers.Authorization).toBe('Bearer token');
      expect(JSON.parse(options.body)).toEqual({
        message: 'How was my swing?',
        userId: 'user-1',
      });
    });

    it('throws AUTHENTICATION_REQUIRED on 401 response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
      });

      await expect(
        chatApiService.sendMessage('hello', 'user-1', { Authorization: 'Bearer token' })
      ).rejects.toThrow('AUTHENTICATION_REQUIRED');
    });

    it('throws AUTHENTICATION_REQUIRED on 403 response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'forbidden',
      });

      await expect(
        chatApiService.sendMessage('hello', 'user-1', { Authorization: 'Bearer token' })
      ).rejects.toThrow('AUTHENTICATION_REQUIRED');
    });

    it('propagates API error messages from non-200 responses', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'upstream failed',
      });

      await expect(
        chatApiService.sendMessage('hello', 'user-1', { Authorization: 'Bearer token' })
      ).rejects.toThrow('API Error 500: upstream failed');
    });
  });
});
