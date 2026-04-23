import type { MasteringParams } from '../../../src/hooks/useAudioEngine';
import {
  apiFetch,
  clearLegacyAuthToken,
  getAuthToken,
  getCurrentUser,
  login,
  logout,
  parseJson,
  register,
  type AuthResult,
  type AuthUser,
} from './sessionClient';

export type { AuthResult, AuthUser };
export { getAuthToken, getCurrentUser, login, logout, register };

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

// TODO: Generate these types and paths from the API contract once /api/v1 is the primary surface.
export async function downloadTrack(id: string) {
  const response = await apiFetch(`/api/tracks/${encodeURIComponent(id)}/download`);
  if (!response.ok) {
    if (response.status === 401) clearLegacyAuthToken();
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === 'string' ? payload.error : 'Download failed';
    throw new Error(message);
  }
  return response.blob();
}

export async function listTracks() {
  return parseJson<{ tracks: TrackRecord[] }>(await apiFetch('/api/tracks'));
}

export async function uploadTrack(blob: Blob, options: { fileName: string; format: string; durationSeconds: number }) {
  return parseJson<{ track: TrackRecord }>(await apiFetch('/api/tracks', {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
      'X-File-Name': options.fileName,
      'X-Format': options.format,
      'X-Duration-Seconds': String(options.durationSeconds),
    },
    body: blob,
  }));
}

export async function deleteTrack(id: string) {
  await parseJson<{ ok: true }>(await apiFetch(`/api/tracks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }));
}

export async function listPresets() {
  return parseJson<{ presets: ApiPreset[] }>(await apiFetch('/api/presets'));
}

export async function createPreset(name: string, params: MasteringParams) {
  return parseJson<{ preset: ApiPreset }>(await apiFetch('/api/presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, params }),
  }));
}

export async function deletePreset(id: string) {
  await parseJson<{ ok: true }>(await apiFetch(`/api/presets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }));
}
