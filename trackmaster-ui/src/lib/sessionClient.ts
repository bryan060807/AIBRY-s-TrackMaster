const AUTH_TOKEN_STORAGE_KEY = 'trackmaster.authToken';

export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthResult {
  user: AuthUser;
  token?: string;
  session?: {
    expiresAt: string;
  };
}

function getStoredToken() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to read TrackMaster auth token', err);
    return null;
  }
}

function clearStoredToken() {
  try {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear TrackMaster auth token', err);
  }
}

export function clearLegacyAuthToken() {
  clearStoredToken();
}

function storeLegacyToken(token: string) {
  try {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch (err) {
    console.warn('Failed to persist legacy TrackMaster auth token', err);
  }
}

function rememberLegacyTokenIfNeeded(result: AuthResult) {
  if (!result.session && result.token) {
    storeLegacyToken(result.token);
    return;
  }
  clearStoredToken();
}

function authHeaders(headers: HeadersInit = {}) {
  const result = new Headers(headers);
  const token = getStoredToken();

  // Legacy fallback for users who still have a pre-cookie JWT in localStorage.
  // New logins rely on the HttpOnly session cookie set by the API.
  if (token && !result.has('Authorization')) {
    result.set('Authorization', `Bearer ${token}`);
  }

  return result;
}

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: authHeaders(init.headers),
  });
}

export async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearStoredToken();
    const message = typeof payload.error === 'string' ? payload.error : 'Request failed';
    throw new Error(message);
  }
  return payload as T;
}

export function getAuthToken() {
  return getStoredToken();
}

export async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    clearStoredToken();
  }
}

export async function register(email: string, password: string) {
  const result = await parseJson<AuthResult>(await apiFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }));
  rememberLegacyTokenIfNeeded(result);
  return result;
}

export async function login(email: string, password: string) {
  const result = await parseJson<AuthResult>(await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }));
  rememberLegacyTokenIfNeeded(result);
  return result;
}

export async function getCurrentUser() {
  const response = await apiFetch('/api/auth/session');
  if (response.status === 404) {
    return parseJson<{ user: AuthUser }>(await apiFetch('/api/auth/me'));
  }
  return parseJson<{ user: AuthUser }>(response);
}
