import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { asyncHandler } from '../request.js';
import { jsonError } from '../responses.js';
import { resolveStoredPath, safeBaseName, safeFormat, storagePathFor } from '../storage.js';

function mapTrack(track, basePath) {
  return {
    id: track.id,
    fileName: track.fileName,
    createdAt: track.createdAt,
    storagePath: track.storagePath,
    status: track.status,
    durationSeconds: track.durationSeconds,
    sizeBytes: track.sizeBytes,
    format: track.format,
    downloadUrl: `${basePath}/tracks/${encodeURIComponent(track.id)}/download`,
  };
}

export function createTracksRouter({ config, basePath, repositories }) {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const rows = await repositories.tracks.listForUser(req.user.id);
    res.json({ tracks: rows.map((row) => mapTrack(row, basePath)) });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const id = randomUUID();
    const format = safeFormat(req.header('X-Format'));
    if (!format) {
      jsonError(res, 400, 'Unsupported audio export format');
      return;
    }

    const contentType = String(req.header('Content-Type') || '').split(';')[0].toLowerCase();
    const expectedTypes = format === 'wav'
      ? new Set(['audio/wav', 'audio/x-wav', 'audio/wave'])
      : new Set(['audio/mpeg', 'audio/mp3']);
    if (!expectedTypes.has(contentType)) {
      jsonError(res, 415, 'Audio content type does not match the export format');
      return;
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      jsonError(res, 400, 'Audio payload is required');
      return;
    }

    const displayName = `${safeBaseName(req.header('X-File-Name'))}_mastered.${format}`;
    const durationSeconds = Number.parseFloat(req.header('X-Duration-Seconds') || '');
    const { relative, absolute } = storagePathFor(config, req.user.id, id, displayName, format);

    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, req.body, { flag: 'wx', mode: 0o640 });

    try {
      const row = await repositories.tracks.create({
        id,
        userId: req.user.id,
        fileName: displayName,
        storagePath: relative,
        status: 'mastered',
        durationSeconds: Number.isFinite(durationSeconds) && durationSeconds >= 0 && durationSeconds <= 86400 ? durationSeconds : null,
        sizeBytes: req.body.length,
        format,
      });
      res.status(201).json({ track: mapTrack(row, basePath) });
    } catch (err) {
      fs.rmSync(absolute, { force: true });
      throw err;
    }
  }));

  router.get('/:id/download', asyncHandler(async (req, res) => {
    const row = await repositories.tracks.findForUser(req.params.id, req.user.id);
    if (!row) {
      jsonError(res, 404, 'Track not found');
      return;
    }

    const absolute = resolveStoredPath(config, row.storagePath);
    if (!absolute || !fs.existsSync(absolute)) {
      jsonError(res, 404, 'Track file not found');
      return;
    }

    res.download(absolute, row.fileName);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const row = await repositories.tracks.findForUser(req.params.id, req.user.id);
    if (!row) {
      jsonError(res, 404, 'Track not found');
      return;
    }

    const absolute = resolveStoredPath(config, row.storagePath);
    if (absolute && fs.existsSync(absolute)) {
      fs.unlinkSync(absolute);
    }

    await repositories.tracks.deleteForUser(req.params.id, req.user.id);
    res.json({ ok: true });
  }));

  return router;
}
