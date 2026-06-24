import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadRuntimeEnv } = require('./runtime-env.cjs');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

loadRuntimeEnv({ projectRoot });

const { startServer } = await import('../trackmaster-api/src/server.js');

startServer().catch((err) => {
  console.error('Failed to start trackmaster-api', err);
  process.exit(1);
});
