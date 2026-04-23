import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';

const JWT_SECRET = 'trackmaster-test-secret-32-characters';

test('loadConfig keeps SQLite as the default repository backend', () => {
  const config = loadConfig({
    TRACKMASTER_JWT_SECRET: JWT_SECRET,
  });

  assert.equal(config.repositoryBackend, 'sqlite');
  assert.equal(config.postgresUrl, '');
  assert.equal(config.postgresPoolMax, 5);
});

test('loadConfig rejects unsupported repository backends', () => {
  assert.throws(
    () => loadConfig({
      TRACKMASTER_JWT_SECRET: JWT_SECRET,
      TRACKMASTER_REPOSITORY_BACKEND: 'mysql',
    }),
    /Unsupported TRACKMASTER_REPOSITORY_BACKEND "mysql"/
  );
});

test('loadConfig requires a Postgres URL when the Postgres backend is selected', () => {
  assert.throws(
    () => loadConfig({
      TRACKMASTER_JWT_SECRET: JWT_SECRET,
      TRACKMASTER_REPOSITORY_BACKEND: 'postgres',
    }),
    /TRACKMASTER_POSTGRES_URL is required when TRACKMASTER_REPOSITORY_BACKEND=postgres/
  );
});

test('loadConfig accepts explicit Postgres runtime settings', () => {
  const config = loadConfig({
    TRACKMASTER_JWT_SECRET: JWT_SECRET,
    TRACKMASTER_REPOSITORY_BACKEND: 'postgres',
    TRACKMASTER_POSTGRES_URL: 'postgres://trackmaster:trackmaster@127.0.0.1:5432/trackmaster',
    TRACKMASTER_POSTGRES_POOL_MAX: '9',
  });

  assert.equal(config.repositoryBackend, 'postgres');
  assert.equal(config.postgresUrl, 'postgres://trackmaster:trackmaster@127.0.0.1:5432/trackmaster');
  assert.equal(config.postgresPoolMax, 9);
});
