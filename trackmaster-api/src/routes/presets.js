import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { asyncHandler } from '../request.js';
import { jsonError } from '../responses.js';

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedNumber(value, fallback, min, max) {
  return Math.min(max, Math.max(min, readNumber(value, fallback)));
}

function normalizeParams(body) {
  const params = body?.params;
  if (!params || typeof params !== 'object') {
    throw new Error('Preset params are required');
  }

  return {
    eqLow: boundedNumber(params.eqLow, 0, -12, 12),
    eqMid: boundedNumber(params.eqMid, 0, -12, 12),
    eqHigh: boundedNumber(params.eqHigh, 0, -12, 12),
    compThreshold: boundedNumber(params.compThreshold, -14, -60, 0),
    compRatio: boundedNumber(params.compRatio, 1.5, 1, 20),
    makeupGain: boundedNumber(params.makeupGain, 0, 0, 24),
    delayTime: boundedNumber(params.delayTime, 0.3, 0.01, 2),
    delayFeedback: boundedNumber(params.delayFeedback, 0.2, 0, 0.9),
    delayMix: boundedNumber(params.delayMix, 0, 0, 1),
    reverbDecay: boundedNumber(params.reverbDecay, 1.5, 0.1, 5),
    reverbMix: boundedNumber(params.reverbMix, 0, 0, 1),
    saturationDrive: boundedNumber(params.saturationDrive, 1, 1, 50),
    saturationMix: boundedNumber(params.saturationMix, 0, 0, 1),
  };
}

function mapPreset(preset) {
  return {
    id: preset.id,
    name: preset.name,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
    params: preset.params,
  };
}

export function createPresetsRouter({ repositories }) {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const rows = await repositories.presets.listForUser(req.user.id);
    res.json({ presets: rows.map(mapPreset) });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      jsonError(res, 400, 'Preset name is required');
      return;
    }

    const params = normalizeParams(req.body);
    const id = randomUUID();
    const row = await repositories.presets.create({ id, userId: req.user.id, name: name.slice(0, 120), ...params });
    res.status(201).json({ preset: mapPreset(row) });
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const existing = await repositories.presets.findForUser(req.params.id, req.user.id);
    if (!existing) {
      jsonError(res, 404, 'Preset not found');
      return;
    }

    const name = String(req.body?.name || existing.name).trim();
    const params = normalizeParams(req.body);
    const result = await repositories.presets.updateForUser(req.params.id, req.user.id, {
      name: name.slice(0, 120),
      ...params,
    });
    if (!result.changed) {
      jsonError(res, 404, 'Preset not found');
      return;
    }
    res.json({ preset: mapPreset(result.preset) });
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const result = await repositories.presets.deleteForUser(req.params.id, req.user.id);
    if (!result.deleted) {
      jsonError(res, 404, 'Preset not found');
      return;
    }
    res.json({ ok: true });
  }));

  return router;
}
