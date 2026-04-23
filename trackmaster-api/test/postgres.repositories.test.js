import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyPostgresMigrations,
  closePostgresPool,
  createPostgresPool,
  resetPostgresSchemaForTests,
} from '../src/postgres.js';
import { createRepositories } from '../src/repositories/index.js';
import { runRepositoryContractTests } from './repositoryContract.js';

const connectionString = process.env.TRACKMASTER_TEST_POSTGRES_URL || '';
const resetAllowed = process.env.TRACKMASTER_TEST_POSTGRES_RESET === '1';

if (!connectionString) {
  test('postgres repository contract skipped', {
    skip: 'Set TRACKMASTER_TEST_POSTGRES_URL and TRACKMASTER_TEST_POSTGRES_RESET=1 to run against a disposable Postgres database.',
  }, () => {});
} else {
  runRepositoryContractTests({
    backendName: 'postgres',
    createContext: createPostgresRepositoryTestContext,
  });
}

async function createPostgresRepositoryTestContext() {
  assert.equal(
    resetAllowed,
    true,
    'TRACKMASTER_TEST_POSTGRES_RESET=1 is required because the Postgres contract test drops and recreates TrackMaster tables.'
  );

  const pool = createPostgresPool({ connectionString, max: 1 });

  try {
    await resetPostgresSchemaForTests(pool);
    await applyPostgresMigrations(pool);
    return {
      pool,
      repositories: createRepositories({
        backend: 'postgres',
        pool,
        allowTestPostgres: true,
      }),
      close: async () => {
        try {
          await resetPostgresSchemaForTests(pool);
        } finally {
          await closePostgresPool(pool);
        }
      },
    };
  } catch (err) {
    await closePostgresPool(pool);
    throw err;
  }
}
