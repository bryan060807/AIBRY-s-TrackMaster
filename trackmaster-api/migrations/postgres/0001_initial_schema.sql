-- Draft TrackMaster Postgres schema.
-- Inactive by default: this file is not applied by the current SQLite runtime.
-- The first real Postgres pass should run this through a migration tool and
-- pair it with repository contract tests before any production cutover.

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  client_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
  ON sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  eq_low DOUBLE PRECISION NOT NULL,
  eq_mid DOUBLE PRECISION NOT NULL,
  eq_high DOUBLE PRECISION NOT NULL,
  comp_threshold DOUBLE PRECISION NOT NULL,
  comp_ratio DOUBLE PRECISION NOT NULL,
  makeup_gain DOUBLE PRECISION NOT NULL,
  delay_time DOUBLE PRECISION NOT NULL,
  delay_feedback DOUBLE PRECISION NOT NULL,
  delay_mix DOUBLE PRECISION NOT NULL,
  reverb_decay DOUBLE PRECISION NOT NULL,
  reverb_mix DOUBLE PRECISION NOT NULL,
  saturation_drive DOUBLE PRECISION NOT NULL,
  saturation_mix DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presets_user_created_at
  ON presets(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'mastered',
  duration_seconds DOUBLE PRECISION,
  size_bytes BIGINT,
  format TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracks_user_created_at
  ON tracks(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS presets_set_updated_at ON presets;

CREATE TRIGGER presets_set_updated_at
BEFORE UPDATE ON presets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
