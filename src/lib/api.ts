import type { MasteringParams } from '../hooks/useAudioEngine';

const AUTH_TOKEN_STORAGE_KEY = 'trackmaster.authToken';

export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface TrackRecord {
  id: string;
  fileName: string;
  createdAt: string;
  storagePath: string;
  status: string;
  durationSeconds: number | null;
  sizeBytes: number | null;
  format: string | null;
  downloadUrl: string;
}

export interface ApiPreset {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  isCustom?: boolean;
  params: MasteringParams;
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

function storeToken(token: string) {
  try {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch (err) {
    console.warn('Failed to persist TrackMaster auth token', err);
  }
}

function clearStoredToken() {
  try {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear TrackMaster auth token', err);
  }
}

function authHeaders(headers: Record<string, string> = {}) {
  const token = getStoredToken();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

async function parseJson<T>(response: Response): Promise<T> {
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

export function logout() {
  clearStoredToken();
}

export async function register(email: string, password: string) {
  const result = await parseJson<{ user: AuthUser; token: string }>(await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }));
  storeToken(result.token);
  return result;
}

export async function login(email: string, password: string) {
  const result = await parseJson<{ user: AuthUser; token: string }>(await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }));
  storeToken(result.token);
  return result;
}

export async function getCurrentUser() {
  return parseJson<{ user: AuthUser }>(await fetch('/api/auth/me', {
    headers: authHeaders(),
  }));
}

export async function downloadTrack(id: string) {
  const response = await fetch(`/api/tracks/${encodeURIComponent(id)}/download`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    if (response.status === 401) clearStoredToken();
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === 'string' ? payload.error : 'Download failed';
    throw new Error(message);
  }
  return response.blob();
}

export async function listTracks() {
  return parseJson<{ tracks: TrackRecord[] }>(await fetch('/api/tracks', {
    headers: authHeaders(),
  }));
}

export async function uploadTrack(blob: Blob, options: { fileName: string; format: string; durationSeconds: number }) {
  return parseJson<{ track: TrackRecord }>(await fetch('/api/tracks', {
    method: 'POST',
    headers: authHeaders({
      'Content-Type': blob.type || 'application/octet-stream',
      'X-File-Name': options.fileName,
      'X-Format': options.format,
      'X-Duration-Seconds': String(options.durationSeconds),
    }),
    body: blob,
  }));
}

export async function deleteTrack(id: string) {
  await parseJson<{ ok: true }>(await fetch(`/api/tracks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }));
}

export async function listPresets() {
  return parseJson<{ presets: ApiPreset[] }>(await fetch('/api/presets', {
    headers: authHeaders(),
  }));
}

export async function createPreset(name: string, params: MasteringParams) {
  return parseJson<{ preset: ApiPreset }>(await fetch('/api/presets', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, params }),
  }));
}

export async function deletePreset(id: string) {
  await parseJson<{ ok: true }>(await fetch(`/api/presets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }));
}
