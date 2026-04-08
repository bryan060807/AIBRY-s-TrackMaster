import * as localApi from './api';
import type { ApiPreset, TrackRecord } from './api';
import type { MasteringParams } from '../hooks/useAudioEngine';

export type { ApiPreset, TrackRecord } from './api';

export interface UploadTrackOptions {
  fileName: string;
  format: string;
  durationSeconds: number;
}

export interface DataService {
  downloadTrack(id: string): Promise<Blob>;
  listTracks(): Promise<{ tracks: TrackRecord[] }>;
  uploadTrack(blob: Blob, options: UploadTrackOptions): Promise<{ track: TrackRecord }>;
  deleteTrack(id: string): Promise<void>;
  listPresets(): Promise<{ presets: ApiPreset[] }>;
  createPreset(name: string, params: MasteringParams): Promise<{ preset: ApiPreset }>;
  deletePreset(id: string): Promise<void>;
}

const localDataService: DataService = {
  downloadTrack: localApi.downloadTrack,
  listTracks: localApi.listTracks,
  uploadTrack: localApi.uploadTrack,
  deleteTrack: localApi.deleteTrack,
  listPresets: localApi.listPresets,
  createPreset: localApi.createPreset,
  deletePreset: localApi.deletePreset,
};

export const dataService: DataService = localDataService;

export const downloadTrack = dataService.downloadTrack;
export const listTracks = dataService.listTracks;
export const uploadTrack = dataService.uploadTrack;
export const deleteTrack = dataService.deleteTrack;
export const listPresets = dataService.listPresets;
export const createPreset = dataService.createPreset;
export const deletePreset = dataService.deletePreset;
