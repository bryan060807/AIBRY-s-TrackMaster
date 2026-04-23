import { createInactivePostgresRepositories, createPostgresRepositories } from './postgres.js';
import { createSqliteRepositories } from './sqlite.js';

const DEFAULT_BACKEND = 'sqlite';

export function createRepositories(options) {
  const { backend, db, pool, allowRuntimePostgres, allowTestPostgres } = normalizeRepositoryOptions(options);

  if (backend === 'sqlite') {
    if (!db) {
      throw new Error('SQLite repository backend requires a database connection.');
    }
    return createSqliteRepositories(db);
  }

  if (backend === 'postgres') {
    if ((allowRuntimePostgres || allowTestPostgres) && pool) {
      return createPostgresRepositories(pool);
    }
    return createInactivePostgresRepositories();
  }

  throw new Error(`Unsupported TrackMaster repository backend: ${backend}`);
}

function normalizeRepositoryOptions(options) {
  if (options?.prepare && typeof options.prepare === 'function') {
    return { backend: DEFAULT_BACKEND, db: options };
  }

  return {
    backend: options?.backend || DEFAULT_BACKEND,
    db: options?.db,
    pool: options?.pool,
    allowRuntimePostgres: options?.allowRuntimePostgres === true,
    allowTestPostgres: options?.allowTestPostgres === true,
  };
}
