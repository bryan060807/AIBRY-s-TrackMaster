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

test('loadConfig keeps AIBRY ID disabled and dev-only by default', () => {
  const config = loadConfig({
    TRACKMASTER_JWT_SECRET: JWT_SECRET,
  });

  assert.equal(config.aibryId.enabled, false);
  assert.equal(config.aibryId.devOnly, true);
  assert.equal(config.aibryId.redirectUri, 'http://127.0.0.1:3000/auth/aibry-id/callback');
  assert.equal(config.aibryId.selfProvisioning, false);
});

test('loadConfig accepts public AIBRY ID configuration with HTTPS app-origin callback', () => {
  const config = loadConfig({
    TRACKMASTER_JWT_SECRET: JWT_SECRET,
    TRACKMASTER_AIBRY_ID_ENABLED: 'true',
    TRACKMASTER_AIBRY_ID_DEV_ONLY: 'false',
    TRACKMASTER_AIBRY_ID_ISSUER: 'https://id.aibry.shop',
    TRACKMASTER_AIBRY_ID_CLIENT_ID: 'trackmaster-public-web',
    TRACKMASTER_AIBRY_ID_REDIRECT_URI: 'https://trackmaster.aibry.shop/auth/aibry-id/callback',
    TRACKMASTER_AIBRY_ID_SUCCESS_REDIRECT: 'https://trackmaster.aibry.shop/',
    TRACKMASTER_AIBRY_ID_SELF_PROVISIONING: 'true',
  });

  assert.equal(config.aibryId.enabled, true);
  assert.equal(config.aibryId.devOnly, false);
  assert.equal(config.aibryId.issuer, 'https://id.aibry.shop');
  assert.equal(config.aibryId.redirectUri, 'https://trackmaster.aibry.shop/auth/aibry-id/callback');
  assert.equal(config.aibryId.scopes, 'openid profile email');
  assert.equal(config.aibryId.selfProvisioning, true);
  assert.equal(config.aibryId.stateCookieSecret, JWT_SECRET);
});

test('loadConfig rejects public AIBRY ID config without explicit public values', () => {
  assert.throws(
    () => loadConfig({
      TRACKMASTER_JWT_SECRET: JWT_SECRET,
      TRACKMASTER_AIBRY_ID_ENABLED: 'true',
      TRACKMASTER_AIBRY_ID_DEV_ONLY: 'false',
    }),
    /TRACKMASTER_AIBRY_ID_ISSUER is required/
  );
});

test('loadConfig rejects non-HTTPS or loopback public AIBRY ID callback URLs', () => {
  const publicConfig = {
    TRACKMASTER_JWT_SECRET: JWT_SECRET,
    TRACKMASTER_AIBRY_ID_ENABLED: 'true',
    TRACKMASTER_AIBRY_ID_DEV_ONLY: 'false',
    TRACKMASTER_AIBRY_ID_ISSUER: 'https://id.aibry.shop',
    TRACKMASTER_AIBRY_ID_CLIENT_ID: 'trackmaster-public-web',
    TRACKMASTER_AIBRY_ID_SUCCESS_REDIRECT: 'https://trackmaster.aibry.shop/',
  };

  assert.throws(
    () => loadConfig({
      ...publicConfig,
      TRACKMASTER_AIBRY_ID_REDIRECT_URI: 'http://trackmaster.aibry.shop/auth/aibry-id/callback',
    }),
    /TRACKMASTER_AIBRY_ID_REDIRECT_URI must use HTTPS/
  );

  assert.throws(
    () => loadConfig({
      ...publicConfig,
      TRACKMASTER_AIBRY_ID_REDIRECT_URI: 'https://127.0.0.1/auth/aibry-id/callback',
    }),
    /TRACKMASTER_AIBRY_ID_REDIRECT_URI must not use a loopback host/
  );
});
