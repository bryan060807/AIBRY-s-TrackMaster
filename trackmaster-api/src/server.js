import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { config as defaultConfig } from './config.js';
import { openDatabase } from './db.js';
import { checkPostgresConnection, closePostgresPool, createPostgresPool } from './postgres.js';
import { createRepositories } from './repositories/index.js';
import { ensureStorage } from './storage.js';

export async function startServer({ config = defaultConfig, db = null, pool = null } = {}) {
  ensureStorage(config);

  const backend = config.repositoryBackend || 'sqlite';
  const ownedDb = db || (backend === 'sqlite' ? openDatabase(config) : null);
  let ownedPool = null;
  let postgresPool = pool;

  if (backend === 'postgres') {
    postgresPool = pool || createPostgresPool({
      connectionString: config.postgresUrl,
      max: config.postgresPoolMax,
    });
    ownedPool = pool ? null : postgresPool;
    try {
      await checkPostgresConnection(postgresPool);
    } catch (err) {
      if (ownedPool) await closePostgresPool(ownedPool);
      throw err;
    }
  }

  let repositories;
  let app;
  try {
    repositories = createRepositories({
      backend,
      db: ownedDb,
      pool: postgresPool,
      allowRuntimePostgres: backend === 'postgres',
    });
    app = createApp({ config, repositories });
  } catch (err) {
    await closeResources();
    throw err;
  }
  let server;
  try {
    server = await listen(app, config);
  } catch (err) {
    await closeResources();
    throw err;
  }
  console.log(`trackmaster-api listening on http://${config.host}:${config.port}`);
  console.log(`trackmaster-api data dir: ${config.dataDir}`);
  console.log(`trackmaster-api repository backend: ${backend}`);

  async function closeResources() {
    if (ownedDb) ownedDb.close();
    if (ownedPool) await closePostgresPool(ownedPool);
  }

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
    await closeServer(server);
    await closeResources();
  }

  function shutdown() {
    close()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('Error while shutting down trackmaster-api', err);
        process.exit(1);
      });
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { app, config, db: ownedDb, pool: postgresPool, repositories, server, shutdown, close };
}

function listen(app, config) {
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve(server);
    });
    server.once('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const currentPath = fileURLToPath(import.meta.url);

if (entryPath === currentPath) {
  startServer().catch((err) => {
    console.error('Failed to start trackmaster-api', err);
    process.exit(1);
  });
}
