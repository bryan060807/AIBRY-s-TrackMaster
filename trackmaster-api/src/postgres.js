import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDir = path.resolve(__dirname, '../migrations/postgres');

export function createPostgresPool({ connectionString, max = 5 } = {}) {
  if (!connectionString) {
    throw new Error('A Postgres connection string is required.');
  }

  return new Pool({
    connectionString,
    max,
  });
}

export async function checkPostgresConnection(pool) {
  if (!pool?.query) {
    throw new Error('Postgres health check requires a pg Pool or compatible query client.');
  }
  const result = await pool.query('SELECT 1 AS ok');
  return result.rows[0];
}

export async function closePostgresPool(pool) {
  if (pool?.end) {
    await pool.end();
  }
}

export async function applyPostgresMigrations(pool, { migrationsDir = defaultMigrationsDir } = {}) {
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
  }

  return { applied: files };
}

export async function resetPostgresSchemaForTests(pool) {
  await pool.query(`
    DROP TABLE IF EXISTS tracks, presets, sessions, users CASCADE;
    DROP FUNCTION IF EXISTS set_updated_at() CASCADE;
  `);
}
