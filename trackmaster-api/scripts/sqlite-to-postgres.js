#!/usr/bin/env node
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyPostgresMigrations,
  closePostgresPool,
  createPostgresPool,
} from '../src/postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const DEFAULT_LEGACY_USER_ID = 'legacy-local-user';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sqlitePath = path.resolve(projectRoot, options.sqlite || process.env.TRACKMASTER_MIGRATION_SQLITE_PATH || '');
  const postgresUrl = options.postgresUrl || process.env.TRACKMASTER_MIGRATION_POSTGRES_URL || '';

  if (!options.sqlite && !process.env.TRACKMASTER_MIGRATION_SQLITE_PATH) {
    throw new Error('Missing source SQLite path. Use --sqlite <path> or TRACKMASTER_MIGRATION_SQLITE_PATH.');
  }
  if (!postgresUrl) {
    throw new Error('Missing target Postgres URL. Use --postgres-url <url> or TRACKMASTER_MIGRATION_POSTGRES_URL.');
  }

  const apply = options.apply === true;
  if (apply && process.env.TRACKMASTER_MIGRATION_ALLOW_WRITE !== '1') {
    throw new Error('Refusing to write. Set TRACKMASTER_MIGRATION_ALLOW_WRITE=1 with --apply for guarded import mode.');
  }

  const legacyUserId = options.legacyUserId || process.env.TRACKMASTER_LEGACY_USER_ID || DEFAULT_LEGACY_USER_ID;
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const pool = createPostgresPool({ connectionString: postgresUrl, max: 1 });

  try {
    if (options.applySchema) {
      await applyPostgresMigrations(pool);
    }

    const source = readSqliteSource(sqlite, { legacyUserId });
    const preview = await previewPostgresTarget(pool, source);

    const report = {
      mode: apply ? 'apply' : 'dry-run',
      source: {
        sqlitePath,
        counts: countSource(source),
      },
      target: {
        postgresUrl: maskPostgresUrl(postgresUrl),
        counts: preview.targetCounts,
      },
      conflicts: preview.conflicts,
      missingReferences: preview.missingReferences,
      wouldInsert: preview.wouldInsert,
    };

    if (apply) {
      ensureImportIsSafe(preview);
      report.inserted = await importIntoPostgres(pool, source);
      report.afterImport = {
        counts: await countPostgresTables(pool),
      };
    }

    report.validation = await comparePostgresTarget(pool, source);
    report.rollback = rollbackNotes();

    await writeReport(options.report, report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    sqlite.close();
    await closePostgresPool(pool);
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--sqlite') {
      options.sqlite = requiredValue(args, ++index, arg);
    } else if (arg === '--postgres-url') {
      options.postgresUrl = requiredValue(args, ++index, arg);
    } else if (arg === '--legacy-user-id') {
      options.legacyUserId = requiredValue(args, ++index, arg);
    } else if (arg === '--report') {
      options.report = requiredValue(args, ++index, arg);
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--apply-schema') {
      options.applySchema = true;
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
  console.log(`TrackMaster SQLite to Postgres migration preview

Required:
  --sqlite <path>                 Source SQLite database path
  --postgres-url <url>            Target disposable Postgres URL

Safe defaults:
  Dry-run is the default. It reads source and target, then reports counts,
  conflicts, missing references, and would-insert totals.

Optional:
  --apply-schema                  Apply draft Postgres schema before preview/import
  --apply                         Import rows with INSERT ... ON CONFLICT DO NOTHING
  --legacy-user-id <id>           Fallback user id for old local rows
  --report <path>                 Write the JSON report artifact to disk

Guarded write mode:
  TRACKMASTER_MIGRATION_ALLOW_WRITE=1 is required with --apply.
`);
}

function readSqliteSource(db, { legacyUserId }) {
  const users = readUsers(db);
  const tracks = readTracks(db, { legacyUserId });
  const presets = readPresets(db, { legacyUserId });
  const sessions = readSessions(db);

  if (!users.some((user) => user.id === legacyUserId) && hasLegacyOwnedRows({ tracks, presets }, legacyUserId)) {
    users.push({
      id: legacyUserId,
      email: 'legacy@trackmaster.local',
      passwordHash: bcrypt.hashSync(randomUUID(), 12),
      createdAt: null,
      synthetic: true,
    });
  }

  return { users, sessions, presets, tracks };
}

function readUsers(db) {
  if (!tableExists(db, 'users')) return [];
  return db.prepare('SELECT id, email, password_hash, created_at FROM users ORDER BY created_at, id').all()
    .map((row) => ({
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
    }));
}

function readSessions(db) {
  if (!tableExists(db, 'sessions')) return [];
  return db.prepare(`
    SELECT id, user_id, token_hash, user_agent, client_key, created_at, expires_at, revoked_at
    FROM sessions
    ORDER BY created_at, id
  `).all()
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      userAgent: row.user_agent,
      clientKey: row.client_key,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    }));
}

function readPresets(db, { legacyUserId }) {
  if (!tableExists(db, 'presets')) return [];
  const hasUserId = columnExists(db, 'presets', 'user_id');
  return db.prepare('SELECT * FROM presets ORDER BY created_at, id').all()
    .map((row) => ({
      id: row.id,
      userId: hasUserId && row.user_id ? row.user_id : legacyUserId,
      name: row.name,
      eqLow: row.eq_low,
      eqMid: row.eq_mid,
      eqHigh: row.eq_high,
      compThreshold: row.comp_threshold,
      compRatio: row.comp_ratio,
      makeupGain: row.makeup_gain,
      delayTime: row.delay_time,
      delayFeedback: row.delay_feedback,
      delayMix: row.delay_mix,
      reverbDecay: row.reverb_decay,
      reverbMix: row.reverb_mix,
      saturationDrive: row.saturation_drive,
      saturationMix: row.saturation_mix,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

function readTracks(db, { legacyUserId }) {
  if (!tableExists(db, 'tracks')) return [];
  const hasUserId = columnExists(db, 'tracks', 'user_id');
  return db.prepare('SELECT * FROM tracks ORDER BY created_at, id').all()
    .map((row) => ({
      id: row.id,
      userId: hasUserId && row.user_id ? row.user_id : legacyUserId,
      fileName: row.file_name,
      storagePath: row.storage_path,
      status: row.status,
      durationSeconds: row.duration_seconds,
      sizeBytes: row.size_bytes,
      format: row.format,
      createdAt: row.created_at,
    }));
}

async function previewPostgresTarget(pool, source) {
  const targetCounts = await countPostgresTables(pool);
  const targetUserIds = new Set(await existingIds(pool, 'users', sourceUserReferenceIds(source)));
  const sourceUserIds = new Set(source.users.map((user) => user.id));
  const availableUserIds = new Set([...sourceUserIds, ...targetUserIds]);

  const conflicts = {
    usersById: await existingIds(pool, 'users', source.users.map((row) => row.id)),
    usersByEmail: await existingUserEmails(pool, source.users.map((row) => row.email)),
    sessionsById: await existingIds(pool, 'sessions', source.sessions.map((row) => row.id)),
    sessionsByTokenHash: await existingColumnValues(pool, 'sessions', 'token_hash', source.sessions.map((row) => row.tokenHash)),
    presetsById: await existingIds(pool, 'presets', source.presets.map((row) => row.id)),
    tracksById: await existingIds(pool, 'tracks', source.tracks.map((row) => row.id)),
    tracksByStoragePath: await existingColumnValues(pool, 'tracks', 'storage_path', source.tracks.map((row) => row.storagePath)),
  };

  const missingReferences = {
    sessionsUserIds: missingUserReferences(source.sessions, availableUserIds),
    presetsUserIds: missingUserReferences(source.presets, availableUserIds),
    tracksUserIds: missingUserReferences(source.tracks, availableUserIds),
  };

  return {
    targetCounts,
    conflicts,
    missingReferences,
    wouldInsert: {
      users: source.users.length - conflicts.usersById.length,
      sessions: source.sessions.length - conflicts.sessionsById.length,
      presets: source.presets.length - conflicts.presetsById.length,
      tracks: source.tracks.length - conflicts.tracksById.length,
    },
  };
}

async function comparePostgresTarget(pool, source) {
  const [users, sessions, presets, tracks] = await Promise.all([
    loadTargetRows(pool, 'users', source.users.map((row) => row.id), mapTargetUserForCompare),
    loadTargetRows(pool, 'sessions', source.sessions.map((row) => row.id), mapTargetSessionForCompare),
    loadTargetRows(pool, 'presets', source.presets.map((row) => row.id), mapTargetPresetForCompare),
    loadTargetRows(pool, 'tracks', source.tracks.map((row) => row.id), mapTargetTrackForCompare),
  ]);

  return {
    checksumAlgorithm: 'sha256-json-v1',
    tables: {
      users: compareTable(source.users.map(mapSourceUserForCompare), users),
      sessions: compareTable(source.sessions.map(mapSourceSessionForCompare), sessions),
      presets: compareTable(source.presets.map(mapSourcePresetForCompare), presets),
      tracks: compareTable(source.tracks.map(mapSourceTrackForCompare), tracks),
    },
  };
}

async function loadTargetRows(pool, table, ids, mapper) {
  const uniqueIds = unique(ids.filter(Boolean).map(String));
  if (uniqueIds.length === 0) return [];
  const result = await pool.query(`SELECT * FROM ${table} WHERE id = ANY($1::text[])`, [uniqueIds]);
  return result.rows.map(mapper);
}

function compareTable(sourceRows, targetRows) {
  const targetById = new Map(targetRows.map((row) => [row.id, row]));
  const missingIds = [];
  const mismatches = [];
  let matched = 0;

  for (const sourceRow of sourceRows) {
    const targetRow = targetById.get(sourceRow.id);
    if (!targetRow) {
      missingIds.push(sourceRow.id);
      continue;
    }

    const sourceHash = checksum(sourceRow);
    const targetHash = checksum(targetRow);
    if (sourceHash !== targetHash) {
      mismatches.push({
        id: sourceRow.id,
        sourceHash,
        targetHash,
      });
      continue;
    }

    matched += 1;
  }

  return {
    sourceCount: sourceRows.length,
    comparedCount: sourceRows.length - missingIds.length,
    matched,
    missingIds,
    mismatches,
  };
}

function mapSourceUserForCompare(row) {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
  };
}

function mapTargetUserForCompare(row) {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
  };
}

function mapSourceSessionForCompare(row) {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    userAgent: row.userAgent,
    clientKey: row.clientKey,
    createdAt: normalizeTimestampForCompare(row.createdAt),
    expiresAt: normalizeTimestampForCompare(row.expiresAt),
    revokedAt: normalizeTimestampForCompare(row.revokedAt),
  };
}

function mapTargetSessionForCompare(row) {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    userAgent: row.user_agent,
    clientKey: row.client_key,
    createdAt: normalizeTimestampForCompare(row.created_at),
    expiresAt: normalizeTimestampForCompare(row.expires_at),
    revokedAt: normalizeTimestampForCompare(row.revoked_at),
  };
}

function mapSourcePresetForCompare(row) {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    eqLow: normalizeNumber(row.eqLow),
    eqMid: normalizeNumber(row.eqMid),
    eqHigh: normalizeNumber(row.eqHigh),
    compThreshold: normalizeNumber(row.compThreshold),
    compRatio: normalizeNumber(row.compRatio),
    makeupGain: normalizeNumber(row.makeupGain),
    delayTime: normalizeNumber(row.delayTime),
    delayFeedback: normalizeNumber(row.delayFeedback),
    delayMix: normalizeNumber(row.delayMix),
    reverbDecay: normalizeNumber(row.reverbDecay),
    reverbMix: normalizeNumber(row.reverbMix),
    saturationDrive: normalizeNumber(row.saturationDrive),
    saturationMix: normalizeNumber(row.saturationMix),
    createdAt: normalizeTimestampForCompare(row.createdAt),
    updatedAt: normalizeTimestampForCompare(row.updatedAt),
  };
}

function mapTargetPresetForCompare(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    eqLow: normalizeNumber(row.eq_low),
    eqMid: normalizeNumber(row.eq_mid),
    eqHigh: normalizeNumber(row.eq_high),
    compThreshold: normalizeNumber(row.comp_threshold),
    compRatio: normalizeNumber(row.comp_ratio),
    makeupGain: normalizeNumber(row.makeup_gain),
    delayTime: normalizeNumber(row.delay_time),
    delayFeedback: normalizeNumber(row.delay_feedback),
    delayMix: normalizeNumber(row.delay_mix),
    reverbDecay: normalizeNumber(row.reverb_decay),
    reverbMix: normalizeNumber(row.reverb_mix),
    saturationDrive: normalizeNumber(row.saturation_drive),
    saturationMix: normalizeNumber(row.saturation_mix),
    createdAt: normalizeTimestampForCompare(row.created_at),
    updatedAt: normalizeTimestampForCompare(row.updated_at),
  };
}

function mapSourceTrackForCompare(row) {
  return {
    id: row.id,
    userId: row.userId,
    fileName: row.fileName,
    storagePath: row.storagePath,
    status: row.status,
    durationSeconds: normalizeNumber(row.durationSeconds),
    sizeBytes: normalizeNumber(row.sizeBytes),
    format: row.format,
    createdAt: normalizeTimestampForCompare(row.createdAt),
  };
}

function mapTargetTrackForCompare(row) {
  return {
    id: row.id,
    userId: row.user_id,
    fileName: row.file_name,
    storagePath: row.storage_path,
    status: row.status,
    durationSeconds: normalizeNumber(row.duration_seconds),
    sizeBytes: normalizeNumber(row.size_bytes),
    format: row.format,
    createdAt: normalizeTimestampForCompare(row.created_at),
  };
}

async function countPostgresTables(pool) {
  const counts = {};
  for (const table of ['users', 'sessions', 'presets', 'tracks']) {
    try {
      const result = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
      counts[table] = result.rows[0].count;
    } catch (err) {
      counts[table] = { error: err.message };
    }
  }
  return counts;
}

function countSource(source) {
  return {
    users: source.users.length,
    sessions: source.sessions.length,
    presets: source.presets.length,
    tracks: source.tracks.length,
  };
}

async function existingIds(pool, table, values) {
  return existingColumnValues(pool, table, 'id', values);
}

async function existingUserEmails(pool, emails) {
  const normalized = unique(emails.filter(Boolean).map((email) => String(email).toLowerCase()));
  if (normalized.length === 0) return [];
  const result = await pool.query('SELECT lower(email) AS value FROM users WHERE lower(email) = ANY($1::text[])', [normalized]);
  return result.rows.map((row) => row.value);
}

async function existingColumnValues(pool, table, column, values) {
  const uniqueValues = unique(values.filter((value) => value !== null && value !== undefined).map(String));
  if (uniqueValues.length === 0) return [];
  const result = await pool.query(`SELECT ${column} AS value FROM ${table} WHERE ${column} = ANY($1::text[])`, [uniqueValues]);
  return result.rows.map((row) => row.value);
}

async function importIntoPostgres(pool, source) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = {
      users: await insertUsers(client, source.users),
      sessions: await insertSessions(client, source.sessions),
      presets: await insertPresets(client, source.presets),
      tracks: await insertTracks(client, source.tracks),
    };
    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function insertUsers(client, rows) {
  let inserted = 0;
  for (const row of rows) {
    const result = await client.query(`
      INSERT INTO users (id, email, password_hash, created_at)
      VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()))
      ON CONFLICT (id) DO NOTHING
    `, [row.id, row.email, row.passwordHash, row.createdAt]);
    inserted += result.rowCount;
  }
  return inserted;
}

async function insertSessions(client, rows) {
  let inserted = 0;
  for (const row of rows) {
    const result = await client.query(`
      INSERT INTO sessions (id, user_id, token_hash, user_agent, client_key, created_at, expires_at, revoked_at)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $8)
      ON CONFLICT (id) DO NOTHING
    `, [row.id, row.userId, row.tokenHash, row.userAgent, row.clientKey, row.createdAt, row.expiresAt, row.revokedAt]);
    inserted += result.rowCount;
  }
  return inserted;
}

async function insertPresets(client, rows) {
  let inserted = 0;
  for (const row of rows) {
    const result = await client.query(`
      INSERT INTO presets (
        id, user_id, name, eq_low, eq_mid, eq_high, comp_threshold, comp_ratio, makeup_gain,
        delay_time, delay_feedback, delay_mix, reverb_decay, reverb_mix, saturation_drive, saturation_mix,
        created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16,
        COALESCE($17::timestamptz, now()), COALESCE($18::timestamptz, now())
      )
      ON CONFLICT (id) DO NOTHING
    `, [
      row.id,
      row.userId,
      row.name,
      row.eqLow,
      row.eqMid,
      row.eqHigh,
      row.compThreshold,
      row.compRatio,
      row.makeupGain,
      row.delayTime,
      row.delayFeedback,
      row.delayMix,
      row.reverbDecay,
      row.reverbMix,
      row.saturationDrive,
      row.saturationMix,
      row.createdAt,
      row.updatedAt,
    ]);
    inserted += result.rowCount;
  }
  return inserted;
}

async function insertTracks(client, rows) {
  let inserted = 0;
  for (const row of rows) {
    const result = await client.query(`
      INSERT INTO tracks (id, user_id, file_name, storage_path, status, duration_seconds, size_bytes, format, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()))
      ON CONFLICT (id) DO NOTHING
    `, [
      row.id,
      row.userId,
      row.fileName,
      row.storagePath,
      row.status,
      row.durationSeconds,
      row.sizeBytes,
      row.format,
      row.createdAt,
    ]);
    inserted += result.rowCount;
  }
  return inserted;
}

function ensureImportIsSafe(preview) {
  const fatal = {
    missingReferences: objectTotal(preview.missingReferences),
    usersByEmail: preview.conflicts.usersByEmail.length,
    sessionsByTokenHash: preview.conflicts.sessionsByTokenHash.length,
    tracksByStoragePath: preview.conflicts.tracksByStoragePath.length,
  };
  const fatalCount = Object.values(fatal).reduce((sum, count) => sum + count, 0);
  if (fatalCount > 0) {
    throw new Error(`Refusing import due to unsafe conflicts: ${JSON.stringify(fatal)}`);
  }
}

function sourceUserReferenceIds(source) {
  return unique([
    ...source.sessions.map((row) => row.userId),
    ...source.presets.map((row) => row.userId),
    ...source.tracks.map((row) => row.userId),
  ].filter(Boolean));
}

function missingUserReferences(rows, availableUserIds) {
  return unique(rows
    .map((row) => row.userId)
    .filter((userId) => userId && !availableUserIds.has(userId)));
}

function hasLegacyOwnedRows({ tracks, presets }, legacyUserId) {
  return tracks.some((row) => row.userId === legacyUserId) || presets.some((row) => row.userId === legacyUserId);
}

function tableExists(db, table) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
  `).get(table));
}

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some((row) => row.name === column);
}

function unique(values) {
  return [...new Set(values)];
}

function checksum(value) {
  return createHash('sha256')
    .update(JSON.stringify(sortObject(value)))
    .digest('hex');
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortObject(value[key]);
    return result;
  }, {});
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function normalizeTimestampForCompare(value) {
  if (!value) return value;
  if (value instanceof Date) return value.toISOString();

  const text = String(value);
  const candidate = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function objectTotal(value) {
  return Object.values(value).reduce((sum, item) => sum + item.length, 0);
}

async function writeReport(reportPath, report) {
  if (!reportPath) return;
  const resolved = path.resolve(projectRoot, reportPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`);
}

function rollbackNotes() {
  return [
    'This tool does not change the source SQLite database.',
    'Dry-run mode performs no inserts.',
    'Guarded import mode only writes to the supplied Postgres target.',
    'For rehearsal targets, rollback is to drop/recreate the disposable Postgres database or rerun the rehearsal reset workflow.',
    'Production rollback remains pointing TrackMaster at the unchanged SQLite backend.',
  ];
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

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
