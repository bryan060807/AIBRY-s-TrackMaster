const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { loadRuntimeEnv, resolveRuntimeEnvPath } = require('./runtime-env.cjs');

test('production env path is anchored to the project root', () => {
  const projectRoot = path.join('C:', 'trackmaster');
  const envPath = resolveRuntimeEnvPath({
    projectRoot,
    env: { NODE_ENV: 'production' },
  });

  assert.equal(envPath, path.join(projectRoot, '.env.production.local'));
});

test('runtime env file overrides stale inherited PM2 values', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trackmaster-env-test-'));
  const envPath = path.join(projectRoot, '.env.production.local');
  const env = {
    NODE_ENV: 'production',
    TRACKMASTER_POSTGRES_URL: 'postgresql://user:secret@stale.invalid:5432/database',
  };

  try {
    fs.writeFileSync(
      envPath,
      'TRACKMASTER_POSTGRES_URL=postgresql://user:secret@fedora.local:5432/database\n',
      'utf8'
    );

    const result = loadRuntimeEnv({ projectRoot, env });

    assert.equal(result.loaded, true);
    assert.equal(
      env.TRACKMASTER_POSTGRES_URL,
      'postgresql://user:secret@fedora.local:5432/database'
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
