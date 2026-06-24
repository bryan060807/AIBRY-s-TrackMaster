-- AIBRY ID external identity links.
-- Uses plain TEXT ids so no privileged Postgres extensions are required.

BEGIN;

CREATE TABLE IF NOT EXISTS external_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_issuer TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email_at_link_time TEXT,
  email_verified_at_link_time BOOLEAN NOT NULL DEFAULT FALSE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (provider_issuer, provider_subject)
);

CREATE INDEX IF NOT EXISTS external_identities_user_id_idx
  ON external_identities (user_id);

CREATE INDEX IF NOT EXISTS external_identities_provider_subject_idx
  ON external_identities (provider_issuer, provider_subject);

COMMIT;
