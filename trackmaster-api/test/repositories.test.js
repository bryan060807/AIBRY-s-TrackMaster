import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../src/db.js';
import { createRepositories } from '../src/repositories/index.js';
import { runRepositoryContractTests } from './repositoryContract.js';

runRepositoryContractTests({
  backendName: 'sqlite',
  createContext: createSqliteRepositoryTestContext,
});

test('repository factory exposes inactive postgres skeleton without activating it as default', async () => {
  const pool = {
    query: async () => ({ rows: [{ ok: 1 }], rowCount: 1 }),
  };
  const repositories = createRepositories({ backend: 'postgres', pool });

  assert.equal(repositories.backend, 'postgres');
  await assert.rejects(
    repositories.health.check(),
    /Postgres repositories are disabled unless the runtime or test harness explicitly activates them/
  );

  const testRepositories = createRepositories({
    backend: 'postgres',
    pool,
    allowTestPostgres: true,
  });
  assert.deepEqual(await testRepositories.health.check(), { ok: 1 });

  const runtimeRepositories = createRepositories({
    backend: 'postgres',
    pool,
    allowRuntimePostgres: true,
  });
  assert.deepEqual(await runtimeRepositories.health.check(), { ok: 1 });
});

test('repository factory rejects unknown backends', () => {
  assert.throws(
    () => createRepositories({ backend: 'mysql', db: {} }),
    /Unsupported TrackMaster repository backend: mysql/
  );
});

function createSqliteRepositoryTestContext() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trackmaster-repo-test-'));
  const config = {
    dbPath: path.join(dataDir, 'trackmaster.sqlite'),
    legacyUserId: 'legacy-local-user',
  };
  const db = openDatabase(config);
  const repositories = createRepositories({ backend: 'sqlite', db });

  return {
    db,
    repositories,
    close: () => {
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
