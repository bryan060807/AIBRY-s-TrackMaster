import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startServer } from '../src/server.js';

const JWT_SECRET = 'trackmaster-test-secret-32-characters';

test('startServer activates Postgres repositories only when explicitly configured with a pool', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trackmaster-runtime-test-'));
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(String(sql));
      return { rows: [{ ok: 1 }], rowCount: 1 };
    },
  };
  let runtime;

  try {
    runtime = await startServer({
      config: runtimeConfig(dataDir),
      pool,
    });

    assert.equal(runtime.repositories.backend, 'postgres');
    assert.ok(queries.some((query) => query.includes('SELECT 1 AS ok')));

    const address = runtime.server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: 'trackmaster-api' });

    const readinessResponse = await fetch(`http://127.0.0.1:${address.port}/api/readiness`);
    assert.equal(readinessResponse.status, 200);
    const readiness = await readinessResponse.json();
    assert.equal(readiness.ok, true);
    assert.equal(readiness.service, 'trackmaster-api');
    assert.equal(readiness.repositoryBackend, 'postgres');
    assert.equal(readiness.checks.repository.ok, true);
    assert.equal(readiness.checks.storage.ok, true);
    assert.equal(readiness.runtime.host, '127.0.0.1');
  } finally {
    if (runtime) await runtime.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function runtimeConfig(dataDir) {
  return {
    projectRoot: dataDir,
    port: 0,
    host: '127.0.0.1',
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    dbPath: path.join(dataDir, 'trackmaster.sqlite'),
    uploadLimit: '10mb',
    repositoryBackend: 'postgres',
    postgresUrl: 'postgres://trackmaster:trackmaster@127.0.0.1:5432/trackmaster',
    postgresPoolMax: 1,
    corsOrigin: '',
    jwtSecret: JWT_SECRET,
    jwtExpiresIn: '12h',
    effectiveJwtSecret: JWT_SECRET,
    sessionCookieName: 'tm_session',
    sessionExpiresSeconds: 3600,
    apiRateWindowMs: 60000,
    apiRateLimit: 10000,
    authRateWindowMs: 60000,
    authRateLimit: 10000,
    production: false,
    legacyUserId: 'legacy-local-user',
  };
}
