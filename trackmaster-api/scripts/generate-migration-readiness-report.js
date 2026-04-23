#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const TABLES = ['users', 'sessions', 'presets', 'tracks'];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await generateMigrationReadinessReport(options);
}

export async function generateMigrationReadinessReport(options) {
  const reportDir = options.reportDir ? resolveFromProject(options.reportDir) : null;
  const rehearsalPath = options.rehearsalReport
    ? resolveFromProject(options.rehearsalReport)
    : reportDir ? path.join(reportDir, 'rehearsal-report.json') : null;
  const migrationPath = options.migrationReport
    ? resolveFromProject(options.migrationReport)
    : reportDir ? path.join(reportDir, 'migration-report.json') : null;
  const runtimeValidationPath = options.runtimeValidationReport
    ? resolveFromProject(options.runtimeValidationReport)
    : reportDir ? path.join(reportDir, 'postgres-runtime-validation', 'staging-runtime-report.json') : null;

  const rehearsal = rehearsalPath ? await readJsonIfExists(rehearsalPath) : null;
  const migration = migrationPath
    ? await readJsonIfExists(migrationPath)
    : rehearsal?.migrationReport || null;
  const runtimeValidation = runtimeValidationPath ? await readJsonIfExists(runtimeValidationPath) : null;

  if (!rehearsal && !migration) {
    throw new Error('No rehearsal or migration report found. Use --report-dir, --rehearsal-report, or --migration-report.');
  }

  const manual = {
    storageValidation: normalizeManualStatus(options.storageValidation, 'pending'),
    storageNotes: options.storageNotes || '',
    backupValidation: normalizeManualStatus(options.backupValidation, 'pending'),
    backupNotes: options.backupNotes || '',
    dataFreezePlan: normalizePlanStatus(options.dataFreezePlan, 'pending'),
    runtimeSwitchPlan: normalizePlanStatus(options.runtimeSwitchPlan, 'pending'),
  };
  const generatedAt = new Date().toISOString();
  const readiness = evaluateReadiness({
    rehearsal,
    migration,
    manual,
    runtimeValidation,
    runtimeValidationPath,
  });
  const outputPath = options.out
    ? resolveFromProject(options.out)
    : reportDir ? path.join(reportDir, 'migration-readiness-report.md') : null;
  const jsonOutputPath = options.jsonOut
    ? resolveFromProject(options.jsonOut)
    : reportDir ? path.join(reportDir, 'migration-readiness-data.json') : null;
  const markdown = renderMarkdown({
    generatedAt,
    rehearsal,
    migration,
    manual,
    readiness,
    rehearsalPath,
    migrationPath,
    runtimeValidation,
    runtimeValidationPath,
    jsonOutputPath,
  });
  const readinessData = createReadinessData({
    generatedAt,
    rehearsal,
    migration,
    manual,
    readiness,
    rehearsalPath,
    migrationPath,
    runtimeValidationPath,
  });

  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, markdown);
    console.log(outputPath);
  } else {
    console.log(markdown);
  }
  if (jsonOutputPath) {
    await fs.mkdir(path.dirname(jsonOutputPath), { recursive: true });
    await fs.writeFile(jsonOutputPath, `${JSON.stringify(readinessData, null, 2)}\n`);
    if (outputPath) console.log(jsonOutputPath);
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--report-dir') {
      options.reportDir = requiredValue(args, ++index, arg);
    } else if (arg === '--rehearsal-report') {
      options.rehearsalReport = requiredValue(args, ++index, arg);
    } else if (arg === '--migration-report') {
      options.migrationReport = requiredValue(args, ++index, arg);
    } else if (arg === '--runtime-validation-report') {
      options.runtimeValidationReport = requiredValue(args, ++index, arg);
    } else if (arg === '--out') {
      options.out = requiredValue(args, ++index, arg);
    } else if (arg === '--json-out') {
      options.jsonOut = requiredValue(args, ++index, arg);
    } else if (arg === '--storage-validation') {
      options.storageValidation = requiredValue(args, ++index, arg);
    } else if (arg === '--storage-notes') {
      options.storageNotes = requiredValue(args, ++index, arg);
    } else if (arg === '--backup-validation') {
      options.backupValidation = requiredValue(args, ++index, arg);
    } else if (arg === '--backup-notes') {
      options.backupNotes = requiredValue(args, ++index, arg);
    } else if (arg === '--data-freeze-plan') {
      options.dataFreezePlan = requiredValue(args, ++index, arg);
    } else if (arg === '--runtime-switch-plan') {
      options.runtimeSwitchPlan = requiredValue(args, ++index, arg);
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
  console.log(`TrackMaster migration readiness report

Inputs:
  --report-dir <path>             Directory containing rehearsal-report.json and migration-report.json
  --rehearsal-report <path>       Explicit rehearsal JSON path
  --migration-report <path>       Explicit migration JSON path
  --runtime-validation-report <path>
                                  Explicit staging-runtime-report.json path
  --out <path>                    Markdown report output path
  --json-out <path>               Machine-readable readiness JSON output path

Manual readiness flags:
  --storage-validation passed|pending|failed
  --storage-notes <text>
  --backup-validation passed|pending|failed
  --backup-notes <text>
  --data-freeze-plan ready|pending|failed
  --runtime-switch-plan ready|pending|failed

Default manual flags are pending, which makes the report NO-GO until Fedora
storage, backup, data-freeze, and runtime switch checks are explicitly marked.
Runtime validation is required and defaults to
<report-dir>/postgres-runtime-validation/staging-runtime-report.json.
`);
}

function evaluateReadiness({ rehearsal, migration, manual, runtimeValidation, runtimeValidationPath }) {
  const runtime = summarizeRuntimeValidation(runtimeValidation, runtimeValidationPath);
  const criteria = [
    criterion('Rehearsal wrapper completed', rehearsal?.status === 'passed', rehearsal?.status || 'missing'),
    criterion('Guarded import rehearsal completed', (rehearsal?.mode || migration?.mode) === 'apply', rehearsal?.mode || migration?.mode || 'missing'),
    criterion('Source and post-import counts match', sourceAndTargetCountsMatch(migration), countSummary(migration)),
    criterion('No import conflicts', objectTotal(migration?.conflicts) === 0, objectSummary(migration?.conflicts)),
    criterion('No missing user references', objectTotal(migration?.missingReferences) === 0, objectSummary(migration?.missingReferences)),
    criterion('Row checksum validation passed', rowValidationPassed(migration), rowValidationSummary(migration)),
    criterion('API validation passed against imported Postgres data', rehearsal?.apiValidation?.passed === true, apiValidationSummary(rehearsal)),
    criterion('Real API runtime validation artifact present', runtime.artifactPresent, runtime.artifactDetail),
    criterion('Real API server process started', runtime.serverStarted, runtime.serverStartedDetail),
    criterion('Runtime health smoke paths passed', runtime.healthChecksPassed, runtime.healthChecksDetail),
    criterion('Required real-server smoke paths passed', runtime.requiredSmokePassed, runtime.requiredSmokeDetail),
    criterion('Runtime validation reported no fatal errors', runtime.noFatalError, runtime.fatalErrorDetail),
    criterion('Staged API child process shut down cleanly', runtime.cleanShutdown, runtime.shutdownDetail),
    criterion('Runtime validation status is passed', runtime.statusPassed, runtime.statusDetail),
    criterion('Fedora file storage path validation passed', manual.storageValidation === 'passed', manual.storageValidation),
    criterion('Backup and restore verification passed', manual.backupValidation === 'passed', manual.backupValidation),
    criterion('Downtime/data-freeze plan is ready', manual.dataFreezePlan === 'ready', manual.dataFreezePlan),
    criterion('systemd/nginx/runtime switch plan is ready', manual.runtimeSwitchPlan === 'ready', manual.runtimeSwitchPlan),
  ];

  return {
    decision: criteria.every((item) => item.passed) ? 'GO' : 'NO-GO',
    criteria,
    runtimeValidation: runtime,
  };
}

function criterion(name, passed, detail) {
  return {
    name,
    passed: Boolean(passed),
    detail: detail === undefined || detail === null || detail === '' ? '-' : String(detail),
  };
}

function sourceAndTargetCountsMatch(migration) {
  if (!migration?.source?.counts || !migration?.afterImport?.counts) return false;
  return TABLES.every((table) => migration.source.counts[table] === migration.afterImport.counts[table]);
}

function countSummary(migration) {
  if (!migration?.source?.counts) return 'missing counts';
  if (!migration?.afterImport?.counts) return 'missing post-import counts';
  return TABLES.map((table) => `${table}:${migration.source.counts[table]}=>${migration.afterImport.counts[table]}`).join(', ');
}

function rowValidationPassed(migration) {
  const tables = migration?.validation?.tables;
  if (!tables) return false;
  return TABLES.every((table) => {
    const result = tables[table];
    return result
      && result.matched === result.sourceCount
      && result.missingIds?.length === 0
      && result.mismatches?.length === 0;
  });
}

function rowValidationSummary(migration) {
  const tables = migration?.validation?.tables;
  if (!tables) return 'missing row validation';
  return TABLES.map((table) => {
    const result = tables[table] || {};
    return `${table}: matched ${result.matched ?? 0}/${result.sourceCount ?? 0}, missing ${result.missingIds?.length ?? 0}, mismatches ${result.mismatches?.length ?? 0}`;
  }).join('; ');
}

function apiValidationSummary(rehearsal) {
  const api = rehearsal?.apiValidation;
  if (!api) return 'missing';
  if (api.skipped) return 'skipped';
  return api.passed ? 'passed' : `failed status=${api.status}`;
}

function summarizeRuntimeValidation(report, reportPath) {
  if (!report) {
    const detail = reportPath ? `missing expected artifact: ${reportPath}` : 'missing expected artifact';
    return {
      artifactPresent: false,
      artifactDetail: detail,
      statusPassed: false,
      statusDetail: 'missing',
      noFatalError: false,
      fatalErrorDetail: detail,
      serverStarted: false,
      serverStartedDetail: 'missing',
      cleanShutdown: false,
      shutdownDetail: 'missing',
      healthChecksPassed: false,
      healthChecksDetail: 'missing',
      requiredSmokePassed: false,
      requiredSmokeDetail: 'missing',
      smoke: [],
      requiredSmoke: [],
      optionalSmoke: [],
      failedRequiredSmoke: [],
    };
  }

  const smoke = Array.isArray(report.smoke) ? report.smoke.map(normalizeSmokeCheck) : [];
  const requiredSmoke = smoke.filter((check) => check.required !== false);
  const optionalSmoke = smoke.filter((check) => check.required === false);
  const failedRequiredSmoke = requiredSmoke.filter((check) => check.status !== 'passed');
  const healthNames = ['health', 'v1-health'];
  const healthChecksPassed = healthNames.every((name) => smoke.some((check) => check.name === name && check.status === 'passed'));

  return {
    artifactPresent: true,
    artifactDetail: reportPath ? `loaded ${reportPath}` : 'loaded',
    statusPassed: report.status === 'passed',
    statusDetail: report.status || 'missing',
    noFatalError: !report.error,
    fatalErrorDetail: report.error?.message || '-',
    serverStarted: Number.isFinite(Number(report.server?.pid)),
    serverStartedDetail: report.server?.pid ? `pid=${report.server.pid}` : 'missing pid',
    cleanShutdown: report.server?.cleanShutdown === true,
    shutdownDetail: `exitCode=${report.server?.exitCode ?? ''} signal=${report.server?.signal ?? ''} cleanShutdown=${report.server?.cleanShutdown === true}`,
    healthChecksPassed,
    healthChecksDetail: smokeStatusSummary(smoke.filter((check) => healthNames.includes(check.name))),
    requiredSmokePassed: requiredSmoke.length > 0 && failedRequiredSmoke.length === 0,
    requiredSmokeDetail: failedRequiredSmoke.length > 0
      ? smokeStatusSummary(failedRequiredSmoke)
      : requiredSmoke.length > 0 ? smokeStatusSummary(requiredSmoke) : 'missing required smoke checks',
    smoke,
    requiredSmoke,
    optionalSmoke,
    failedRequiredSmoke,
    reportStatus: report.status || 'missing',
    reportPath: reportPath || '',
    baseUrl: report.baseUrl || '',
    error: report.error || null,
    server: report.server || null,
  };
}

function normalizeSmokeCheck(check) {
  return {
    name: check?.name || 'unnamed',
    required: check?.required !== false,
    status: check?.status || 'missing',
    durationMs: check?.durationMs,
    error: check?.error || '',
    details: check?.details || null,
  };
}

function smokeStatusSummary(smoke) {
  if (!smoke || smoke.length === 0) return 'missing';
  return smoke
    .map((check) => `${check.name}:${check.status}${check.error ? ` (${check.error})` : ''}`)
    .join(', ');
}

function objectTotal(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  return Object.values(value).reduce((sum, item) => sum + (Array.isArray(item) ? item.length : 0), 0);
}

function objectSummary(value) {
  if (!value) return 'missing';
  return Object.entries(value)
    .map(([key, item]) => `${key}:${Array.isArray(item) ? item.length : 0}`)
    .join(', ');
}

function renderMarkdown({
  generatedAt,
  rehearsal,
  migration,
  manual,
  readiness,
  rehearsalPath,
  migrationPath,
  runtimeValidation,
  runtimeValidationPath,
  jsonOutputPath,
}) {
  const runtime = readiness.runtimeValidation;
  const lines = [
    '# TrackMaster Migration Readiness Report',
    '',
    `Generated: ${generatedAt}`,
    `Decision: **${readiness.decision}**`,
    '',
    '## Inputs',
    '',
    `- Rehearsal report: ${rehearsalPath || 'not provided'}`,
    `- Migration report: ${migrationPath || 'embedded or not provided'}`,
    `- Runtime validation report: ${runtimeValidationPath || 'not provided'}`,
    `- Source SQLite: ${rehearsal?.sourceSqlitePath || migration?.source?.sqlitePath || 'unknown'}`,
    `- Migration snapshot: ${rehearsal?.migrationSqlitePath || migration?.source?.sqlitePath || 'unknown'}`,
    `- Postgres target: ${rehearsal?.postgresUrl || migration?.target?.postgresUrl || 'unknown'}`,
    `- Mode: ${rehearsal?.mode || migration?.mode || 'unknown'}`,
    '',
    '## Go/No-Go Criteria',
    '',
    '| Criterion | Status | Detail |',
    '| --- | --- | --- |',
    ...readiness.criteria.map((item) => `| ${escapeCell(item.name)} | ${item.passed ? 'PASS' : 'FAIL'} | ${escapeCell(item.detail)} |`),
    '',
    '## Counts',
    '',
    '| Table | Source | Target Before | Would Insert | Inserted | Target After |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...TABLES.map((table) => renderCountRow(table, migration)),
    '',
    '## Conflicts',
    '',
    renderObjectLists(migration?.conflicts),
    '',
    '## Missing References',
    '',
    renderObjectLists(migration?.missingReferences),
    '',
    '## Row Validation',
    '',
    '| Table | Source | Compared | Matched | Missing IDs | Mismatches |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...TABLES.map((table) => renderValidationRow(table, migration)),
    '',
    '## API Validation',
    '',
    `- Status: ${apiValidationSummary(rehearsal)}`,
    `- Log: ${rehearsal?.apiValidation?.logPath || 'not available'}`,
    '',
    '## Runtime Validation',
    '',
    `- Status: ${runtime.statusDetail}`,
    `- Report: ${runtimeValidationPath || 'not available'}`,
    `- Server started: ${runtime.serverStarted ? 'yes' : 'no'} (${runtime.serverStartedDetail})`,
    `- Clean shutdown: ${runtime.cleanShutdown ? 'yes' : 'no'} (${runtime.shutdownDetail})`,
    `- Fatal error: ${runtimeValidation?.error?.message || 'none'}`,
    '',
    '| Smoke Check | Required | Status | Detail |',
    '| --- | --- | --- | --- |',
    ...renderRuntimeSmokeRows(runtime),
    '',
    '## Manual Fedora Readiness',
    '',
    `- File storage path validation: ${manual.storageValidation}${manual.storageNotes ? ` - ${manual.storageNotes}` : ''}`,
    `- Backup/restore verification: ${manual.backupValidation}${manual.backupNotes ? ` - ${manual.backupNotes}` : ''}`,
    `- Downtime/data-freeze plan: ${manual.dataFreezePlan}`,
    `- systemd/nginx/runtime switch plan: ${manual.runtimeSwitchPlan}`,
    '',
    '## Rollback Notes',
    '',
    ...rollbackNotes(rehearsal, migration).map((note) => `- ${note}`),
    '',
    '## Artifact Paths',
    '',
    `- Output directory: ${rehearsal?.artifacts?.outDir || 'not available'}`,
    `- Migration CLI log: ${rehearsal?.artifacts?.migrationLogPath || 'not available'}`,
    `- API validation log: ${rehearsal?.artifacts?.apiLogPath || 'not available'}`,
    `- Runtime validation report: ${runtimeValidationPath || 'not available'}`,
    `- Runtime validation server log: ${runtimeValidationPath ? path.join(path.dirname(runtimeValidationPath), 'server.log') : 'not available'}`,
    `- Machine-readable readiness data: ${jsonOutputPath || 'not available'}`,
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function createReadinessData({
  generatedAt,
  rehearsal,
  migration,
  manual,
  readiness,
  rehearsalPath,
  migrationPath,
  runtimeValidationPath,
}) {
  return {
    generatedAt,
    decision: readiness.decision,
    inputs: {
      rehearsalReport: rehearsalPath || null,
      migrationReport: migrationPath || null,
      runtimeValidationReport: runtimeValidationPath || null,
      sourceSqlite: rehearsal?.sourceSqlitePath || migration?.source?.sqlitePath || null,
      migrationSnapshot: rehearsal?.migrationSqlitePath || migration?.source?.sqlitePath || null,
      postgresTarget: rehearsal?.postgresUrl || migration?.target?.postgresUrl || null,
      mode: rehearsal?.mode || migration?.mode || null,
    },
    criteria: readiness.criteria,
    manual,
    runtimeValidation: readiness.runtimeValidation,
  };
}

function renderRuntimeSmokeRows(runtime) {
  if (!runtime.smoke || runtime.smoke.length === 0) {
    return ['| - | - | missing | No runtime smoke checks were loaded. |'];
  }
  return runtime.smoke.map((check) => [
    escapeCell(check.name),
    check.required ? 'yes' : 'no',
    escapeCell(check.status),
    escapeCell(check.error || summarizeDetails(check.details) || '-'),
  ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
}

function summarizeDetails(details) {
  if (!details) return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch (_err) {
    return String(details);
  }
}

function renderCountRow(table, migration) {
  return [
    table,
    numberCell(migration?.source?.counts?.[table]),
    numberCell(migration?.target?.counts?.[table]),
    numberCell(migration?.wouldInsert?.[table]),
    numberCell(migration?.inserted?.[table]),
    numberCell(migration?.afterImport?.counts?.[table]),
  ].join(' | ').replace(/^/, '| ').replace(/$/, ' |');
}

function renderValidationRow(table, migration) {
  const result = migration?.validation?.tables?.[table] || {};
  return [
    table,
    numberCell(result.sourceCount),
    numberCell(result.comparedCount),
    numberCell(result.matched),
    numberCell(result.missingIds?.length),
    numberCell(result.mismatches?.length),
  ].join(' | ').replace(/^/, '| ').replace(/$/, ' |');
}

function renderObjectLists(value) {
  if (!value) return '- Not available';
  const entries = Object.entries(value);
  if (entries.length === 0) return '- None';
  return entries
    .map(([key, items]) => {
      const list = Array.isArray(items) && items.length > 0 ? `: ${items.map(String).join(', ')}` : '';
      return `- ${key}: ${Array.isArray(items) ? items.length : 0}${list}`;
    })
    .join('\n');
}

function rollbackNotes(rehearsal, migration) {
  return [
    ...(migration?.rollback || []),
    ...(rehearsal?.rollback || []),
  ].filter((item, index, all) => all.indexOf(item) === index);
}

function normalizeManualStatus(value, fallback) {
  const normalized = String(value || fallback).toLowerCase();
  if (!['passed', 'pending', 'failed'].includes(normalized)) {
    throw new Error(`Invalid validation status: ${value}. Use passed, pending, or failed.`);
  }
  return normalized;
}

function normalizePlanStatus(value, fallback) {
  const normalized = String(value || fallback).toLowerCase();
  if (!['ready', 'pending', 'failed'].includes(normalized)) {
    throw new Error(`Invalid plan status: ${value}. Use ready, pending, or failed.`);
  }
  return normalized;
}

function numberCell(value) {
  return value === undefined || value === null ? '-' : String(value);
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
}

function resolveFromProject(value) {
  return path.resolve(projectRoot, value);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const currentPath = fileURLToPath(import.meta.url);

if (entryPath === currentPath) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
