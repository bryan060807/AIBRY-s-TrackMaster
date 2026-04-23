import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { closePostgresPool, createPostgresPool } from '../src/postgres.js';
import { createRepositories } from '../src/repositories/index.js';

const connectionString = process.env.TRACKMASTER_REHEARSAL_POSTGRES_URL || '';
const jwtSecret = process.env.TRACKMASTER_REHEARSAL_API_JWT_SECRET || 'trackmaster-rehearsal-secret-32-chars';

if (!connectionString) {
  test('postgres imported API validation skipped', {
    skip: 'Set TRACKMASTER_REHEARSAL_POSTGRES_URL to validate API reads against imported Postgres data.',
  }, () => {});
} else {
  test('API reads imported presets and tracks through the Postgres backend', async () => {
    const pool = createPostgresPool({ connectionString, max: 2 });
    let server;

    try {
      const user = await firstImportedUser(pool);
      assert.ok(user, 'At least one imported user is required for API rehearsal validation.');

      const expectedPresetCount = await countForUser(pool, 'presets', user.id);
      const expectedTrackCount = await countForUser(pool, 'tracks', user.id);

      const app = createApp({
        config: rehearsalApiConfig(),
        repositories: createRepositories({
          backend: 'postgres',
          pool,
          allowTestPostgres: true,
        }),
      });
      server = await listen(app);
      const baseUrl = serverBaseUrl(server);
      const token = jwt.sign({ sub: user.id, email: user.email }, jwtSecret, {
        expiresIn: '5m',
        issuer: 'trackmaster-api',
        audience: 'trackmaster-web',
      });

      const session = await requestJson(baseUrl, '/api/auth/session', { token });
      assert.equal(session.response.status, 200);
      assert.equal(session.body.user.id, user.id);
      assert.equal(session.body.authMode, 'jwt-bearer');

      const presets = await requestJson(baseUrl, '/api/presets', { token });
      assert.equal(presets.response.status, 200);
      assert.equal(presets.body.presets.length, expectedPresetCount);

      const tracks = await requestJson(baseUrl, '/api/tracks', { token });
      assert.equal(tracks.response.status, 200);
      assert.equal(tracks.body.tracks.length, expectedTrackCount);

      const presetsV1 = await requestJson(baseUrl, '/api/v1/presets', { token });
      assert.equal(presetsV1.response.status, 200);
      assert.deepEqual(presetsV1.body, presets.body);
    } finally {
      if (server) await closeServer(server);
      await closePostgresPool(pool);
    }
  });
}

async function firstImportedUser(pool) {
  const result = await pool.query(`
    SELECT users.id, users.email, count(presets.id) + count(tracks.id) AS owned_rows
    FROM users
    LEFT JOIN presets ON presets.user_id = users.id
    LEFT JOIN tracks ON tracks.user_id = users.id
    GROUP BY users.id, users.email, users.created_at
    ORDER BY owned_rows DESC, users.created_at, users.id
    LIMIT 1
  `);
  return result.rows[0];
}

async function countForUser(pool, table, userId) {
  const result = await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE user_id = $1`, [userId]);
  return result.rows[0].count;
}

function rehearsalApiConfig() {
  const dataDir = path.join(os.tmpdir(), 'trackmaster-postgres-api-rehearsal');
  return {
    projectRoot: dataDir,
    port: 0,
    host: '127.0.0.1',
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    dbPath: '',
    uploadLimit: '10mb',
    corsOrigin: '',
    jwtSecret,
    jwtExpiresIn: '12h',
    effectiveJwtSecret: jwtSecret,
    sessionCookieName: 'tm_session',
    sessionExpiresSeconds: 3600,
    apiRateWindowMs: 60000,
    apiRateLimit: 10000,
    authRateWindowMs: 60000,
    authRateLimit: 10000,
    production: false,
    legacyUserId: 'legacy-local-user',
    repositoryBackend: 'postgres',
  };
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function serverBaseUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function requestJson(baseUrl, pathname, { token }) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
