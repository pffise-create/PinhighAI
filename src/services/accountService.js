import runtimeEnvConfig from '../config/runtimeEnv';

const ACCOUNT_ENDPOINT = '/api/account';

const readErrorMessage = async (response) => {
  try {
    const payload = await response.json();
    return payload?.message || payload?.error || '';
  } catch {
    return '';
  }
};

export const deleteAccountData = async ({ getAuthHeaders, fetchImpl = fetch } = {}) => {
  const baseUrl = runtimeEnvConfig.api.baseUrl.replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('Account deletion is not configured for this build.');
  }
  if (typeof getAuthHeaders !== 'function') {
    throw new Error('Authentication is required to delete this account.');
  }

  const response = await fetchImpl(`${baseUrl}${ACCOUNT_ENDPOINT}`, {
    method: 'DELETE',
    headers: await getAuthHeaders(),
  });

  if (!response.ok) {
    const serverMessage = await readErrorMessage(response);
    throw new Error(serverMessage || 'We could not delete your account. Please try again.');
  }

  return response.status === 204 ? null : response.json();
};
