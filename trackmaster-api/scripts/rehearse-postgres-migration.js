#!/usr/bin/env node
import fs from 'node:fs/promises';
import Database from 'better-sqlite3';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(apiRoot, '..');

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sqlitePath = path.resolve(projectRoot, options.sqlite || process.env.TRACKMASTER_REHEARSAL_SQLITE_PATH || '');
  const postgresUrl = options.postgresUrl || process.env.TRACKMASTER_REHEARSAL_POSTGRES_URL || '';

  if (!options.sqlite && !process.env.TRACKMASTER_REHEARSAL_SQLITE_PATH) {
    throw new Error('Missing SQLite source. Use --sqlite <path> or TRACKMASTER_REHEARSAL_SQLITE_PATH.');
  }
  if (!postgresUrl) {
    throw new Error('Missing disposable Postgres target. Use --postgres-url <url> or TRACKMASTER_REHEARSAL_POSTGRES_URL.');
  }

  const apply = options.apply === true;
  if (apply && process.env.TRACKMASTER_REHEARSAL_ALLOW_WRITE !== '1') {
    throw new Error('Refusing rehearsal import. Set TRACKMASTER_REHEARSAL_ALLOW_WRITE=1 with --apply.');
  }

  const outDir = path.resolve(projectRoot, options.outDir || defaultOutDir());
  await fs.mkdir(outDir, { recursive: true });

  const sourceForMigration = options.copySnapshot
    ? await copySnapshot(sqlitePath, outDir)
    : sqlitePath;
  const migrationReportPath = path.join(outDir, 'migration-report.json');
  const migrationLogPath = path.join(outDir, 'migration-cli.log');
  const apiLogPath = path.join(outDir, 'api-validation.log');
  const rehearsalReportPath = path.join(outDir, 'rehearsal-report.json');

  const migration = runNodeCommand([
    path.join(apiRoot, 'scripts/sqlite-to-postgres.js'),
    '--sqlite', sourceForMigration,
    '--postgres-url', postgresUrl,
    '--report', migrationReportPath,
    ...(options.applySchema ? ['--apply-schema'] : []),
    ...(apply ? ['--apply'] : []),
  ], {
    TRACKMASTER_MIGRATION_ALLOW_WRITE: apply ? '1' : process.env.TRACKMASTER_MIGRATION_ALLOW_WRITE || '',
  });
  await fs.writeFile(migrationLogPath, commandLog(migration));

  if (migration.status !== 0) {
    await writeRehearsalReport(rehearsalReportPath, {
      status: 'failed',
      failedStep: 'migration',
      mode: apply ? 'apply' : 'preview',
      sourceSqlitePath: sqlitePath,
      migrationSqlitePath: sourceForMigration,
      copiedSnapshot: options.copySnapshot === true,
      postgresUrl: maskPostgresUrl(postgresUrl),
      artifacts: { outDir, migrationLogPath, migrationReportPath },
      rollback: rollbackNotes(),
    });
    process.exit(migration.status || 1);
  }

  let apiValidation = { skipped: true, reason: 'Run with --api-validate to verify API reads through Postgres.' };
  if (options.apiValidate) {
    const apiResult = runNodeCommand([path.join(apiRoot, 'test/postgres.imported.api.test.js')], {
      TRACKMASTER_REHEARSAL_POSTGRES_URL: postgresUrl,
      TRACKMASTER_REHEARSAL_API_JWT_SECRET: process.env.TRACKMASTER_REHEARSAL_API_JWT_SECRET || 'trackmaster-rehearsal-secret-32-chars',
    });
    await fs.writeFile(apiLogPath, commandLog(apiResult));
    apiValidation = {
      skipped: false,
      status: apiResult.status,
      passed: apiResult.status === 0,
      logPath: apiLogPath,
    };
    if (apiResult.status !== 0) {
      await writeRehearsalReport(rehearsalReportPath, {
        status: 'failed',
        failedStep: 'api-validation',
        mode: apply ? 'apply' : 'preview',
        sourceSqlitePath: sqlitePath,
        migrationSqlitePath: sourceForMigration,
        copiedSnapshot: options.copySnapshot === true,
        postgresUrl: maskPostgresUrl(postgresUrl),
        migrationReport: await readJsonIfExists(migrationReportPath),
        apiValidation,
        artifacts: { outDir, migrationLogPath, migrationReportPath, apiLogPath },
        rollback: rollbackNotes(),
      });
      process.exit(apiResult.status || 1);
    }
  }

  const report = {
    status: 'passed',
    mode: apply ? 'apply' : 'preview',
    sourceSqlitePath: sqlitePath,
    migrationSqlitePath: sourceForMigration,
    copiedSnapshot: options.copySnapshot === true,
    postgresUrl: maskPostgresUrl(postgresUrl),
    migrationReport: await readJsonIfExists(migrationReportPath),
    apiValidation,
    artifacts: { outDir, migrationLogPath, migrationReportPath, apiLogPath: options.apiValidate ? apiLogPath : undefined },
    rollback: rollbackNotes(),
  };
  await writeRehearsalReport(rehearsalReportPath, report);
  console.log(JSON.stringify({ ...report, migrationReport: '[see migration-report.json]' }, null, 2));
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--sqlite') {
      options.sqlite = requiredValue(args, ++index, arg);
    } else if (arg === '--postgres-url') {
      options.postgresUrl = requiredValue(args, ++index, arg);
    } else if (arg === '--out-dir') {
      options.outDir = requiredValue(args, ++index, arg);
    } else if (arg === '--copy-snapshot') {
      options.copySnapshot = true;
    } else if (arg === '--apply-schema') {
      options.applySchema = true;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--api-validate') {
      options.apiValidate = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp() {
  console.log(`TrackMaster Fedora-style Postgres migration rehearsal

Required:
  --sqlite <path>                 Source TrackMaster SQLite database or snapshot
  --postgres-url <url>            Disposable Postgres target URL

Safe defaults:
  Preview mode only. No import unless --apply and TRACKMASTER_REHEARSAL_ALLOW_WRITE=1 are both set.

Optional:
  --copy-snapshot                 Copy the SQLite source into the report directory before reading it
  --apply-schema                  Apply the draft Postgres schema to the target
  --apply                         Import data using guarded migration mode
  --api-validate                  Start the API with Postgres repos and verify read routes
  --out-dir <path>                Report/artifact directory
`);
}

async function copySnapshot(sqlitePath, outDir) {
  const snapshotPath = path.join(outDir, 'source-snapshot.sqlite');
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(snapshotPath);
    return snapshotPath;
  } finally {
    db.close();
  }
}

function runNodeCommand(args, env = {}) {
  return spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 10 * 1024 * 1024,
  });
}

function commandLog(result) {
  return [
    `exitCode=${result.status}`,
    `signal=${result.signal || ''}`,
    `error=${result.error ? result.error.message : ''}`,
    '',
    'stdout:',
    result.stdout || '',
    '',
    'stderr:',
    result.stderr || '',
  ].join('\n');
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

async function writeRehearsalReport(filePath, report) {
  await fs.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`);
}

function defaultOutDir() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join('trackmaster-api', 'reports', 'migration-rehearsals', timestamp);
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
    'Keep production TrackMaster configured with TRACKMASTER_REPOSITORY_BACKEND=sqlite.',
    'The rehearsal reads a SQLite copy/snapshot and writes only to the supplied disposable Postgres target.',
    'To rollback rehearsal data, drop/recreate the disposable Postgres database or rerun the container/database reset.',
    'Do not point this workflow at the production Fedora Postgres database until the migration window is approved.',
  ];
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
