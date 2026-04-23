import fs from 'node:fs';
import path from 'node:path';

export function ensureStorage(config) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

export function safeBaseName(value) {
  const base = path.basename(String(value || 'track')).replace(/\.[^/.]+$/, '');
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
  return safe || 'track';
}

export function safeFormat(value) {
  const format = String(value || '').toLowerCase();
  if (format === 'wav' || format === 'mp3') return format;
  return '';
}

export function storagePathFor(config, userId, id, fileName, format) {
  const date = new Date();
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const basename = safeBaseName(fileName);
  const userFolder = safeBaseName(userId);
  const relative = path.join(userFolder, yyyy, mm, `${id}_${basename}.${format}`);
  const absolute = path.join(config.uploadsDir, relative);
  const normalizedUploads = `${path.resolve(config.uploadsDir)}${path.sep}`;
  const normalizedAbsolute = path.resolve(absolute);
  if (!normalizedAbsolute.startsWith(normalizedUploads)) {
    throw new Error('Unsafe storage path');
  }
  return { relative, absolute };
}

export function resolveStoredPath(config, storagePath) {
  const absolute = path.resolve(config.uploadsDir, storagePath);
  const normalizedUploads = `${path.resolve(config.uploadsDir)}${path.sep}`;
  return absolute.startsWith(normalizedUploads) ? absolute : '';
}
