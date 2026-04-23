#!/usr/bin/env node
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { closePostgresPool, createPostgresPool } from '../src/postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(apiRoot, '..');
const DEFAULT_JWT_EXPIRES_IN = '5m';

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.allowRuntimeValidation && process.env.TRACKMASTER_STAGING_ALLOW_RUNTIME_VALIDATION !== '1') {
    throw new Error('Refusing staging runtime validation. Set TRACKMASTER_STAGING_ALLOW_RUNTIME_VALIDATION=1 or pass --allow-runtime-validation.');
  }

  const postgresUrl = options.postgresUrl || process.env.TRACKMASTER_STAGING_POSTGRES_URL || '';
  if (!postgresUrl) {
    throw new Error('Missing disposable Postgres URL. Use --postgres-url <url> or TRACKMASTER_STAGING_POSTGRES_URL.');
  }

  const jwtSecret = options.jwtSecret || process.env.TRACKMASTER_STAGING_API_JWT_SECRET || '';
  if (jwtSecret.length < 32) {
    throw new Error('A staging JWT secret of at least 32 characters is required. Use --jwt-secret or TRACKMASTER_STAGING_API_JWT_SECRET.');
  }

  const outDir = path.resolve(projectRoot, options.outDir || process.env.TRACKMASTER_STAGING_OUT_DIR || defaultOutDir());
  const dataDir = path.resolve(projectRoot, options.dataDir || process.env.TRACKMASTER_STAGING_DATA_DIR || path.join(outDir, 'data'));
  const host = options.host || process.env.TRACKMASTER_STAGING_HOST || '127.0.0.1';
  const port = options.port || await findOpenPort(host);
  const baseUrl = `http://${host}:${port}`;
  const serverLogPath = path.join(outDir, 'server.log');
  const reportPath = path.join(outDir, 'staging-runtime-report.json');
  const startedAt = new Date().toISOString();

  await fs.mkdir(outDir, { recursive: true });

  const report = {
    status: 'failed',
    startedAt,
    endedAt: null,
    postgresUrl: maskPostgresUrl(postgresUrl),
    baseUrl,
    dataDir,
    artifacts: {
      outDir,
      serverLogPath,
      reportPath,
    },
    database: null,
    selectedUser: null,
    selectedDownloadTrack: null,
    server: {
      pid: null,
      exitCode: null,
      signal: null,
      cleanShutdown: false,
    },
    smoke: [],
    error: null,
    rollback: rollbackNotes(),
  };

  let runtime = null;
  let exitCode = 1;

  try {
    const inspected = await inspectPostgresTarget({ postgresUrl, dataDir });
    report.database = inspected.database;
    report.selectedUser = inspected.user;
    report.selectedDownloadTrack = inspected.downloadTrack;

    runtime = startApiProcess({
      baseEnv: process.env,
      dataDir,
      host,
      jwtSecret,
      logPath: serverLogPath,
      port,
      poolMax: options.poolMax || process.env.TRACKMASTER_STAGING_POSTGRES_POOL_MAX || '2',
      postgresUrl,
    });
    report.server.pid = runtime.child.pid;

    await waitForHealth({ baseUrl, exitInfo: runtime.exitInfo, timeoutMs: options.timeoutMs });
    report.smoke = await runSmokeTests({
      baseUrl,
      downloadTrack: inspected.downloadTrack,
      expectedPresetCount: inspected.user.presetCount,
      expectedTrackCount: inspected.user.trackCount,
      jwtSecret,
      user: inspected.user,
    });

    const failedChecks = report.smoke.filter((check) => check.status === 'failed');
    report.status = failedChecks.length === 0 ? 'passed' : 'failed';
    exitCode = report.status === 'passed' ? 0 : 1;
  } catch (err) {
    report.status = 'failed';
    report.error = {
      message: err.message,
      stack: err.stack,
    };
    exitCode = 1;
  } finally {
    if (runtime) {
      const shutdown = await stopApiProcess(runtime);
      report.server.exitCode = shutdown.exitCode;
      report.server.signal = shutdown.signal;
      report.server.cleanShutdown = shutdown.cleanShutdown;
      if (!shutdown.cleanShutdown) {
        report.status = 'failed';
        exitCode = 1;
      }
    }
    report.endedAt = new Date().toISOString();
    await writeReport(reportPath, report);
  }

  console.log(JSON.stringify({
    status: report.status,
    baseUrl,
    artifacts: report.artifacts,
    checks: report.smoke.map((check) => ({
      name: check.name,
      status: check.status,
      required: check.required,
    })),
    server: report.server,
  }, null, 2));

  process.exit(exitCode);
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--postgres-url') {
      options.postgresUrl = requiredValue(args, ++index, arg);
    } else if (arg === '--data-dir') {
      options.dataDir = requiredValue(args, ++index, arg);
    } else if (arg === '--out-dir') {
      options.outDir = requiredValue(args, ++index, arg);
    } else if (arg === '--jwt-secret') {
      options.jwtSecret = requiredValue(args, ++index, arg);
    } else if (arg === '--host') {
      options.host = requiredValue(args, ++index, arg);
    } else if (arg === '--port') {
      options.port = parsePositiveInteger(requiredValue(args, ++index, arg), arg);
    } else if (arg === '--pool-max') {
      options.poolMax = String(parsePositiveInteger(requiredValue(args, ++index, arg), arg));
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(requiredValue(args, ++index, arg), arg);
    } else if (arg === '--allow-runtime-validation') {
      options.allowRuntimeValidation = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return {
    timeoutMs: 30000,
    ...options,
  };
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`TrackMaster Postgres runtime staging validation

Starts the real TrackMaster API process against a disposable imported Postgres
database, runs read-only smoke tests through HTTP, writes artifacts, and shuts
the process down. This does not touch production systemd or nginx.

Required:
  --postgres-url <url>            Disposable imported Postgres database URL
  --jwt-secret <secret>           Staging JWT secret, at least 32 characters

Guard:
  TRACKMASTER_STAGING_ALLOW_RUNTIME_VALIDATION=1 or --allow-runtime-validation

Optional:
  --data-dir <path>               Staging TrackMaster data dir; uploads live under <data-dir>/uploads
  --out-dir <path>                Artifact directory
  --host <host>                   API listen host; default 127.0.0.1
  --port <port>                   API listen port; default finds a free local port
  --pool-max <count>              Postgres pool max for the staged API; default 2
  --timeout-ms <ms>               Health/readiness timeout; default 30000

Environment equivalents:
  TRACKMASTER_STAGING_POSTGRES_URL
  TRACKMASTER_STAGING_DATA_DIR
  TRACKMASTER_STAGING_OUT_DIR
  TRACKMASTER_STAGING_API_JWT_SECRET
  TRACKMASTER_STAGING_POSTGRES_POOL_MAX
`);
}

async function inspectPostgresTarget({ postgresUrl, dataDir }) {
  const pool = createPostgresPool({ connectionString: postgresUrl, max: 1 });
  try {
    const database = {
      counts: await countTables(pool),
    };
    const user = await firstImportedUser(pool);
    if (!user) {
      throw new Error('No imported users found in the staging Postgres target.');
    }

    const downloadTrack = await findDownloadableTrack(pool, user.id, dataDir);
    return { database, user, downloadTrack };
  } finally {
    await closePostgresPool(pool);
  }
}

async function countTables(pool) {
  const counts = {};
  for (const table of ['users', 'sessions', 'presets', 'tracks']) {
    const result = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
    counts[table] = result.rows[0].count;
  }
  return counts;
}

async function firstImportedUser(pool) {
  const result = await pool.query(`
    SELECT
      users.id,
      users.email,
      count(DISTINCT presets.id)::int AS preset_count,
      count(DISTINCT tracks.id)::int AS track_count
    FROM users
    LEFT JOIN presets ON presets.user_id = users.id
    LEFT JOIN tracks ON tracks.user_id = users.id
    GROUP BY users.id, users.email, users.created_at
    ORDER BY track_count DESC, preset_count DESC, users.created_at, users.id
    LIMIT 1
  `);
  const row = result.rows[0];
  return row ? {
    id: row.id,
    email: row.email,
    presetCount: row.preset_count,
    trackCount: row.track_count,
  } : null;
}

async function findDownloadableTrack(pool, userId, dataDir) {
  const result = await pool.query(`
    SELECT id, file_name, storage_path, size_bytes
    FROM tracks
    WHERE user_id = $1
    ORDER BY created_at, id
    LIMIT 50
  `, [userId]);

  for (const row of result.rows) {
    const absolutePath = resolveStoredPath(dataDir, row.storage_path);
    if (absolutePath && await fileExists(absolutePath)) {
      return {
        id: row.id,
        fileName: row.file_name,
        storagePath: row.storage_path,
        sizeBytes: row.size_bytes,
        absolutePath,
      };
    }
  }

  return result.rows.length > 0 ? {
    skipped: true,
    reason: 'Imported tracks exist for the selected user, but no corresponding file exists under the staged uploads directory.',
    candidateCount: result.rows.length,
  } : {
    skipped: true,
    reason: 'No imported tracks exist for the selected smoke-test user.',
    candidateCount: 0,
  };
}

function startApiProcess({ baseEnv, dataDir, host, jwtSecret, logPath, port, poolMax, postgresUrl }) {
  const logStream = fsSync.createWriteStream(logPath, { flags: 'a' });
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: apiRoot,
    env: {
      ...baseEnv,
      NODE_ENV: 'staging',
      PORT: String(port),
      TRACKMASTER_HOST: host,
      TRACKMASTER_DATA_DIR: dataDir,
      TRACKMASTER_REPOSITORY_BACKEND: 'postgres',
      TRACKMASTER_POSTGRES_URL: postgresUrl,
      TRACKMASTER_POSTGRES_POOL_MAX: String(poolMax),
      TRACKMASTER_JWT_SECRET: jwtSecret,
      TRACKMASTER_JWT_EXPIRES_IN: DEFAULT_JWT_EXPIRES_IN,
      TRACKMASTER_SESSION_COOKIE: 'tm_session',
      TRACKMASTER_SESSION_EXPIRES_IN_SECONDS: '3600',
      TRACKMASTER_API_RATE_LIMIT: '10000',
      TRACKMASTER_AUTH_RATE_LIMIT: '10000',
      CORS_ORIGIN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const exitInfo = { exited: false, exitCode: null, signal: null };
  child.stdout.on('data', (chunk) => writeLog(logStream, 'stdout', chunk));
  child.stderr.on('data', (chunk) => writeLog(logStream, 'stderr', chunk));
  child.once('exit', (exitCode, signal) => {
    exitInfo.exited = true;
    exitInfo.exitCode = exitCode;
    exitInfo.signal = signal;
    writeLog(logStream, 'exit', `code=${exitCode ?? ''} signal=${signal ?? ''}\n`);
  });

  return { child, exitInfo, logStream };
}

function writeLog(logStream, source, chunk) {
  logStream.write(`[${new Date().toISOString()}] ${source}: ${String(chunk)}`);
}

async function waitForHealth({ baseUrl, exitInfo, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (exitInfo.exited) {
      throw new Error(`API process exited before health check passed: code=${exitInfo.exitCode} signal=${exitInfo.signal || ''}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = new Error(`Health returned HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await delay(500);
  }

  throw new Error(`Timed out waiting for ${baseUrl}/api/health. Last error: ${lastError?.message || 'none'}`);
}

async function runSmokeTests({ baseUrl, downloadTrack, expectedPresetCount, expectedTrackCount, jwtSecret, user }) {
  const checks = [];
  const token = jwt.sign({ sub: user.id, email: user.email }, jwtSecret, {
    expiresIn: DEFAULT_JWT_EXPIRES_IN,
    issuer: 'trackmaster-api',
    audience: 'trackmaster-web',
  });

  await runCheck(checks, 'health', true, async () => {
    return expectJson(await requestJson(baseUrl, '/api/health'), { ok: true, service: 'trackmaster-api' });
  });

  await runCheck(checks, 'v1-health', true, async () => {
    return expectJson(await requestJson(baseUrl, '/api/v1/health'), { ok: true, service: 'trackmaster-api' });
  });

  await runCheck(checks, 'auth-session-jwt-read', true, async () => {
    const body = await requestJson(baseUrl, '/api/auth/session', { token });
    if (body.user?.id !== user.id || body.authMode !== 'jwt-bearer') {
      throw new Error(`Unexpected session body: ${JSON.stringify(body)}`);
    }
    return { userId: body.user.id, authMode: body.authMode };
  });

  await runCheck(checks, 'presets-read', true, async () => {
    const body = await requestJson(baseUrl, '/api/presets', { token });
    if (!Array.isArray(body.presets)) {
      throw new Error(`Unexpected presets body: ${JSON.stringify(body)}`);
    }
    if (body.presets.length !== expectedPresetCount) {
      throw new Error(`Expected ${expectedPresetCount} presets, received ${body.presets.length}.`);
    }
    return { count: body.presets.length };
  });

  let tracksBody = null;
  await runCheck(checks, 'track-history-read', true, async () => {
    tracksBody = await requestJson(baseUrl, '/api/tracks', { token });
    if (!Array.isArray(tracksBody.tracks)) {
      throw new Error(`Unexpected tracks body: ${JSON.stringify(tracksBody)}`);
    }
    if (tracksBody.tracks.length !== expectedTrackCount) {
      throw new Error(`Expected ${expectedTrackCount} tracks, received ${tracksBody.tracks.length}.`);
    }
    return { count: tracksBody.tracks.length };
  });

  await runCheck(checks, 'track-download-read', false, async () => {
    if (downloadTrack?.skipped) {
      return skip(downloadTrack.reason, { candidateCount: downloadTrack.candidateCount });
    }

    const apiTrack = tracksBody?.tracks?.find((track) => track.id === downloadTrack.id);
    if (!apiTrack?.downloadUrl) {
      throw new Error(`Download candidate ${downloadTrack.id} was not present in API track history.`);
    }
    const response = await fetch(`${baseUrl}${apiTrack.downloadUrl}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Track download returned HTTP ${response.status}.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (downloadTrack.sizeBytes !== null && downloadTrack.sizeBytes !== undefined && bytes.length !== Number(downloadTrack.sizeBytes)) {
      throw new Error(`Downloaded ${bytes.length} bytes, expected ${downloadTrack.sizeBytes}.`);
    }
    return {
      trackId: downloadTrack.id,
      bytes: bytes.length,
      storagePath: downloadTrack.storagePath,
    };
  });

  return checks;
}

async function runCheck(checks, name, required, fn) {
  const startedAt = Date.now();
  try {
    const details = await fn();
    checks.push({
      name,
      required,
      status: details?.skipped ? 'skipped' : 'passed',
      durationMs: Date.now() - startedAt,
      details,
    });
  } catch (err) {
    checks.push({
      name,
      required,
      status: err.skipped ? 'skipped' : 'failed',
      durationMs: Date.now() - startedAt,
      error: err.message,
      details: err.details,
    });
  }
}

function skip(reason, details) {
  const err = new Error(reason);
  err.skipped = true;
  err.details = details;
  throw err;
}

async function requestJson(baseUrl, pathname, { token } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${pathname} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function expectJson(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(`Expected ${key}=${value}, received ${actual[key]}.`);
    }
  }
  return actual;
}

async function stopApiProcess(runtime) {
  if (runtime.exitInfo.exited) {
    runtime.logStream.end();
    return {
      exitCode: runtime.exitInfo.exitCode,
      signal: runtime.exitInfo.signal,
      cleanShutdown: runtime.exitInfo.exitCode === 0 || runtime.exitInfo.signal === 'SIGTERM',
    };
  }

  runtime.child.kill('SIGTERM');
  const cleanExit = await waitForProcessExit(runtime.exitInfo, 5000);
  if (!cleanExit) {
    runtime.child.kill('SIGKILL');
    await waitForProcessExit(runtime.exitInfo, 5000);
  }

  runtime.logStream.end();
  return {
    exitCode: runtime.exitInfo.exitCode,
    signal: runtime.exitInfo.signal,
    cleanShutdown: Boolean(cleanExit),
  };
}

async function waitForProcessExit(exitInfo, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exitInfo.exited) return true;
    await delay(100);
  }
  return false;
}

function resolveStoredPath(dataDir, storagePath) {
  const uploadsDir = path.join(dataDir, 'uploads');
  const absolute = path.resolve(uploadsDir, storagePath);
  const normalizedUploads = `${path.resolve(uploadsDir)}${path.sep}`;
  return absolute.startsWith(normalizedUploads) ? absolute : '';
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_err) {
    return false;
  }
}

function findOpenPort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = address.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function writeReport(filePath, report) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`);
}

function defaultOutDir() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join('trackmaster-api', 'reports', 'postgres-runtime-validations', timestamp);
}

function maskPostgresUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch (_err) {
    return '[invalid-url]';
  }
}

function rollbackNotes() {
  return [
    'This validator does not change production systemd or nginx.',
    'The staged API process is started as a child process and shut down after smoke tests.',
    'The workflow reads imported Postgres data and does not register users, create presets, upload tracks, or mutate the database.',
    'Production remains on TRACKMASTER_REPOSITORY_BACKEND=sqlite unless a human executes the cutover runbook.',
  ];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
