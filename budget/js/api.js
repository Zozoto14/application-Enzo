function readCsrfCookie() {
  const match = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('csrf='));
  return match ? decodeURIComponent(match.slice(5)) : null;
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class OfflineError extends Error {
  constructor() {
    super('Serveur injoignable.');
    this.code = 'offline';
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCsrfCookie();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new OfflineError();
  }

  // A static host without the backend answers with HTML, not JSON: treat that as
  // "no server here" rather than surfacing a parse error to the user.
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (response.status === 404) throw new OfflineError();
    throw new ApiError(response.status, 'unexpected_response', 'Réponse inattendue du serveur.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, data.code || 'error', data.message || 'Erreur serveur.');
  }
  return data;
}

export const api = {
  prelogin: (email) => request('/api/auth/prelogin', { method: 'POST', body: { email } }),
  signup: (payload) => request('/api/auth/signup', { method: 'POST', body: payload }),
  login: (email, authKey) => request('/api/auth/login', { method: 'POST', body: { email, authKey } }),
  logout: () => request('/api/auth/logout', { method: 'POST', body: {} }),
  session: () => request('/api/auth/session'),
  resendVerification: (email) => request('/api/auth/resend-verification', { method: 'POST', body: { email } }),
  changePassword: (payload) => request('/api/auth/change-password', { method: 'POST', body: payload }),
  getVault: () => request('/api/vault'),
  putVault: (payload) => request('/api/vault', { method: 'PUT', body: payload }),
  deleteAccount: () => request('/api/account', { method: 'DELETE' }),
};

export async function serverAvailable() {
  try {
    await api.session();
    return true;
  } catch (e) {
    return !(e instanceof OfflineError);
  }
}
