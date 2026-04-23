import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export function openDatabase(config) {
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  backfillLegacyUser(db, config.legacyUserId);
  return db;
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      file_name TEXT NOT NULL,
      storage_path TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'mastered',
      duration_seconds REAL,
      size_bytes INTEGER,
      format TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      eq_low REAL NOT NULL,
      eq_mid REAL NOT NULL,
      eq_high REAL NOT NULL,
      comp_threshold REAL NOT NULL,
      comp_ratio REAL NOT NULL,
      makeup_gain REAL NOT NULL,
      delay_time REAL NOT NULL,
      delay_feedback REAL NOT NULL,
      delay_mix REAL NOT NULL,
      reverb_decay REAL NOT NULL,
      reverb_mix REAL NOT NULL,
      saturation_drive REAL NOT NULL,
      saturation_mix REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      client_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  `);
}

function ensureColumn(db, table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!existing.some((row) => row.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function backfillLegacyUser(db, legacyUserId) {
  ensureColumn(db, 'tracks', 'user_id', 'TEXT');
  ensureColumn(db, 'presets', 'user_id', 'TEXT');
  db.prepare('UPDATE tracks SET user_id = ? WHERE user_id IS NULL').run(legacyUserId);
  db.prepare('UPDATE presets SET user_id = ? WHERE user_id IS NULL').run(legacyUserId);
  db.prepare('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(
    legacyUserId,
    'legacy@trackmaster.local',
    bcrypt.hashSync(randomUUID(), 12)
  );
}
