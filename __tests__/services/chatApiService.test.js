// chatApiService.test.js - Unit tests for simplified chat API service
// Tests: sendMessage success, 401 handling, timeout, error propagation

describe('ChatApiService', () => {
  describe('sendMessage', () => {
    it.todo('returns { response, timestamp } on success');
    it.todo('throws AUTHENTICATION_REQUIRED on 401 response');
    it.todo('throws AUTHENTICATION_REQUIRED on 403 response');
    it.todo('throws on network timeout (AbortController)');
    it.todo('propagates API error messages from non-200 responses');
    it.todo('uses correct chat URL from env or default');
    it.todo('sends userId and trimmed message in request body');
    it.todo('includes auth headers in request');
  });
});
