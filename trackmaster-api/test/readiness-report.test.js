import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { generateMigrationReadinessReport } from '../scripts/generate-migration-readiness-report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('readiness report is NO-GO when runtime validation artifact is missing', async () => {
  const reportDir = createReportFixture({ includeRuntimeValidation: false });

  try {
    await runReadinessReport(reportDir);
    const markdown = fs.readFileSync(path.join(reportDir, 'migration-readiness-report.md'), 'utf8');
    const data = readJson(path.join(reportDir, 'migration-readiness-data.json'));

    assert.match(markdown, /Decision: \*\*NO-GO\*\*/);
    assert.equal(data.decision, 'NO-GO');
    assert.equal(
      data.criteria.find((item) => item.name === 'Real API runtime validation artifact present')?.passed,
      false
    );
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});

test('readiness report is GO when runtime validation passes and optional track download is skipped', async () => {
  const reportDir = createReportFixture({ includeRuntimeValidation: true });

  try {
    await runReadinessReport(reportDir);
    const markdown = fs.readFileSync(path.join(reportDir, 'migration-readiness-report.md'), 'utf8');
    const data = readJson(path.join(reportDir, 'migration-readiness-data.json'));

    assert.match(markdown, /Decision: \*\*GO\*\*/);
    assert.match(markdown, /track-download-read \| no \| skipped/);
    assert.equal(data.decision, 'GO');
    assert.equal(data.runtimeValidation.statusPassed, true);
    assert.equal(
      data.runtimeValidation.optionalSmoke.find((item) => item.name === 'track-download-read')?.status,
      'skipped'
    );
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});

async function runReadinessReport(reportDir) {
  await generateMigrationReadinessReport({
    reportDir,
    storageValidation: 'passed',
    backupValidation: 'passed',
    dataFreezePlan: 'ready',
    runtimeSwitchPlan: 'ready',
  });
}

function createReportFixture({ includeRuntimeValidation }) {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trackmaster-readiness-test-'));
  fs.writeFileSync(path.join(reportDir, 'migration-report.json'), `${JSON.stringify(migrationReport(), null, 2)}\n`);
  fs.writeFileSync(path.join(reportDir, 'rehearsal-report.json'), `${JSON.stringify(rehearsalReport(reportDir), null, 2)}\n`);

  if (includeRuntimeValidation) {
    const runtimeDir = path.join(reportDir, 'postgres-runtime-validation');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'staging-runtime-report.json'), `${JSON.stringify(runtimeReport(), null, 2)}\n`);
  }

  return reportDir;
}

function migrationReport() {
  return {
    mode: 'apply',
    source: {
      sqlitePath: 'source.sqlite',
      counts: { users: 1, sessions: 0, presets: 1, tracks: 1 },
    },
    target: {
      postgresUrl: 'postgres://trackmaster:***@127.0.0.1:5432/trackmaster_rehearsal',
      counts: { users: 0, sessions: 0, presets: 0, tracks: 0 },
    },
    conflicts: {
      usersById: [],
      usersByEmail: [],
      sessionsById: [],
      sessionsByTokenHash: [],
      presetsById: [],
      tracksById: [],
      tracksByStoragePath: [],
    },
    missingReferences: {
      sessionsUserIds: [],
      presetsUserIds: [],
      tracksUserIds: [],
    },
    wouldInsert: { users: 1, sessions: 0, presets: 1, tracks: 1 },
    inserted: { users: 1, sessions: 0, presets: 1, tracks: 1 },
    afterImport: {
      counts: { users: 1, sessions: 0, presets: 1, tracks: 1 },
    },
    validation: {
      tables: {
        users: validationTable(1),
        sessions: validationTable(0),
        presets: validationTable(1),
        tracks: validationTable(1),
      },
    },
    rollback: ['Drop the disposable Postgres database.'],
  };
}

function validationTable(count) {
  return {
    sourceCount: count,
    comparedCount: count,
    matched: count,
    missingIds: [],
    mismatches: [],
  };
}

function rehearsalReport(reportDir) {
  return {
    status: 'passed',
    mode: 'apply',
    sourceSqlitePath: 'source.sqlite',
    migrationSqlitePath: 'source-snapshot.sqlite',
    postgresUrl: 'postgres://trackmaster:***@127.0.0.1:5432/trackmaster_rehearsal',
    apiValidation: {
      skipped: false,
      status: 0,
      passed: true,
      logPath: path.join(reportDir, 'api-validation.log'),
    },
    artifacts: {
      outDir: reportDir,
      migrationLogPath: path.join(reportDir, 'migration-cli.log'),
      migrationReportPath: path.join(reportDir, 'migration-report.json'),
      apiLogPath: path.join(reportDir, 'api-validation.log'),
    },
    rollback: ['Leave production on SQLite.'],
  };
}

function runtimeReport() {
  return {
    status: 'passed',
    baseUrl: 'http://127.0.0.1:34567',
    server: {
      pid: 1234,
      exitCode: 0,
      signal: null,
      cleanShutdown: true,
    },
    error: null,
    smoke: [
      { name: 'health', required: true, status: 'passed', durationMs: 10 },
      { name: 'v1-health', required: true, status: 'passed', durationMs: 10 },
      { name: 'auth-session-jwt-read', required: true, status: 'passed', durationMs: 10 },
      { name: 'presets-read', required: true, status: 'passed', durationMs: 10 },
      { name: 'track-history-read', required: true, status: 'passed', durationMs: 10 },
      {
        name: 'track-download-read',
        required: false,
        status: 'skipped',
        durationMs: 1,
        details: { reason: 'No imported tracks exist for the selected smoke-test user.' },
      },
    ],
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
