jest.mock('../../src/config/runtimeEnv', () => ({
  __esModule: true,
  default: { api: { baseUrl: 'https://api.example.com/' } },
}));

import { deleteAccountData } from '../../src/services/accountService';

describe('deleteAccountData', () => {
  it('sends an authenticated delete request', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ deleted: true }),
    });
    const getAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer token' });

    await expect(deleteAccountData({ getAuthHeaders, fetchImpl })).resolves.toEqual({ deleted: true });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/api/account', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token' },
    });
  });

  it('surfaces a safe server error message', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn().mockResolvedValue({ message: 'Please contact support.' }),
    });

    await expect(deleteAccountData({
      getAuthHeaders: jest.fn().mockResolvedValue({}),
      fetchImpl,
    })).rejects.toThrow('Please contact support.');
  });
});
