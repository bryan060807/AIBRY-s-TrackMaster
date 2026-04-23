import { Router } from 'express';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { asyncHandler } from '../request.js';

export function createHealthRouter({ config, repositories }) {
  const router = Router();

  router.get('/health', asyncHandler(async (_req, res) => {
    try {
      await repositories.health.check();
      res.json({ ok: true, service: 'trackmaster-api' });
    } catch (err) {
      console.error('Health check failed', err);
      res.status(503).json({ ok: false, service: 'trackmaster-api' });
    }
  }));

  router.get('/readiness', asyncHandler(async (_req, res) => {
    const readiness = await getReadiness({ config, repositories });
    res.status(readiness.ok ? 200 : 503).json(readiness);
  }));

  return router;
}

async function getReadiness({ config, repositories }) {
  const checks = {
    repository: await checkRepository(repositories),
    storage: await checkStorage(config),
  };
  const ok = Object.values(checks).every((check) => check.ok);

  return {
    ok,
    service: 'trackmaster-api',
    repositoryBackend: config.repositoryBackend,
    runtime: {
      host: config.host,
      port: config.port,
      production: config.production,
    },
    checks,
  };
}

async function checkRepository(repositories) {
  try {
    await repositories.health.check();
    return { ok: true };
  } catch (err) {
    console.error('Repository readiness check failed', err);
    return { ok: false, error: err.message || 'Repository check failed' };
  }
}

async function checkStorage(config) {
  try {
    await fs.access(config.dataDir, fsConstants.R_OK | fsConstants.W_OK);
    await fs.access(config.uploadsDir, fsConstants.R_OK | fsConstants.W_OK);
    return { ok: true, kind: 'local-filesystem' };
  } catch (err) {
    console.error('Storage readiness check failed', err);
    return { ok: false, kind: 'local-filesystem', error: err.message || 'Storage check failed' };
  }
}
