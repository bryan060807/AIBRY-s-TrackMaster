import { mapPostgresUniqueConstraint } from './errors.js';
import {
  mapChangedMutationResult,
  mapCountedDeleteMutationResult,
  mapCreatedMutationResult,
  mapDeletedMutationResult,
  mapPresetRow,
  mapSessionUserRow,
  mapTrackRow,
  mapUserRow,
  mapUserWithPasswordRow,
} from './mappers.js';

const INACTIVE_MESSAGE = 'Postgres repositories are disabled unless the runtime or test harness explicitly activates them. Keep TRACKMASTER_REPOSITORY_BACKEND=sqlite until an approved cutover.';

function inactiveRepositoryMethod(name) {
  return async () => {
    throw new Error(`${INACTIVE_MESSAGE} Method not active: ${name}`);
  };
}

export function createInactivePostgresRepositories() {
  return {
    backend: 'postgres',
    health: {
      check: inactiveRepositoryMethod('health.check'),
    },
    users: {
      create: inactiveRepositoryMethod('users.create'),
      findByEmailWithPassword: inactiveRepositoryMethod('users.findByEmailWithPassword'),
      findPublicById: inactiveRepositoryMethod('users.findPublicById'),
    },
    sessions: {
      deleteExpired: inactiveRepositoryMethod('sessions.deleteExpired'),
      create: inactiveRepositoryMethod('sessions.create'),
      findActiveUserByTokenHash: inactiveRepositoryMethod('sessions.findActiveUserByTokenHash'),
      revokeByTokenHash: inactiveRepositoryMethod('sessions.revokeByTokenHash'),
    },
    presets: {
      listForUser: inactiveRepositoryMethod('presets.listForUser'),
      findForUser: inactiveRepositoryMethod('presets.findForUser'),
      create: inactiveRepositoryMethod('presets.create'),
      updateForUser: inactiveRepositoryMethod('presets.updateForUser'),
      deleteForUser: inactiveRepositoryMethod('presets.deleteForUser'),
    },
    tracks: {
      listForUser: inactiveRepositoryMethod('tracks.listForUser'),
      findForUser: inactiveRepositoryMethod('tracks.findForUser'),
      create: inactiveRepositoryMethod('tracks.create'),
      deleteForUser: inactiveRepositoryMethod('tracks.deleteForUser'),
    },
  };
}

export function createPostgresRepositories(pool) {
  if (!pool?.query) {
    throw new Error('Postgres repository backend requires a pg Pool or compatible query client.');
  }

  return {
    backend: 'postgres',
    health: createPostgresHealthRepository(pool),
    users: createPostgresUsersRepository(pool),
    sessions: createPostgresSessionsRepository(pool),
    presets: createPostgresPresetsRepository(pool),
    tracks: createPostgresTracksRepository(pool),
  };
}

function createPostgresHealthRepository(pool) {
  return {
    async check() {
      const result = await pool.query('SELECT 1 AS ok');
      return result.rows[0];
    },
  };
}

function createPostgresUsersRepository(pool) {
  return {
    async create({ id, email, passwordHash }) {
      try {
        const result = await pool.query(`
          INSERT INTO users (id, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id, email, password_hash, created_at
        `, [id, email, passwordHash]);
        return mapUserWithPasswordRow(result.rows[0]);
      } catch (err) {
        throw mapPostgresUniqueConstraint(err, 'USER_EMAIL_EXISTS', 'A user with that email already exists');
      }
    },

    async findByEmailWithPassword(email) {
      const result = await pool.query(`
        SELECT id, email, password_hash, created_at
        FROM users
        WHERE lower(email) = lower($1)
      `, [email]);
      return mapUserWithPasswordRow(result.rows[0]);
    },

    async findPublicById(id) {
      const result = await pool.query(`
        SELECT id, email, created_at
        FROM users
        WHERE id = $1
      `, [id]);
      return mapUserRow(result.rows[0]);
    },
  };
}

function createPostgresSessionsRepository(pool) {
  return {
    async deleteExpired(now) {
      const result = await pool.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
      return mapCountedDeleteMutationResult(result);
    },

    async create({ id, userId, tokenHash, userAgent, clientKey, expiresAt }) {
      await pool.query(`
        INSERT INTO sessions (id, user_id, token_hash, user_agent, client_key, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [id, userId, tokenHash, userAgent, clientKey, expiresAt]);
      return mapCreatedMutationResult();
    },

    async findActiveUserByTokenHash(tokenHash, now) {
      const result = await pool.query(`
        SELECT users.id, users.email, users.created_at, sessions.id AS session_id
        FROM sessions
        INNER JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = $1
          AND sessions.revoked_at IS NULL
          AND sessions.expires_at > $2
      `, [tokenHash, now]);
      return mapSessionUserRow(result.rows[0]);
    },

    async revokeByTokenHash(tokenHash, revokedAt) {
      const result = await pool.query(`
        UPDATE sessions
        SET revoked_at = $1
        WHERE token_hash = $2
          AND revoked_at IS NULL
      `, [revokedAt, tokenHash]);
      return mapChangedMutationResult(result);
    },
  };
}

function createPostgresPresetsRepository(pool) {
  return {
    async listForUser(userId) {
      const result = await pool.query(`
        SELECT *
        FROM presets
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [userId]);
      return result.rows.map(mapPresetRow);
    },

    async findForUser(id, userId) {
      const result = await pool.query(`
        SELECT *
        FROM presets
        WHERE id = $1
          AND user_id = $2
      `, [id, userId]);
      return mapPresetRow(result.rows[0]);
    },

    async create(values) {
      const result = await pool.query(`
        INSERT INTO presets (
          id, user_id, name, eq_low, eq_mid, eq_high, comp_threshold, comp_ratio, makeup_gain,
          delay_time, delay_feedback, delay_mix, reverb_decay, reverb_mix, saturation_drive, saturation_mix
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16
        )
        RETURNING *
      `, [
        values.id,
        values.userId,
        values.name,
        values.eqLow,
        values.eqMid,
        values.eqHigh,
        values.compThreshold,
        values.compRatio,
        values.makeupGain,
        values.delayTime,
        values.delayFeedback,
        values.delayMix,
        values.reverbDecay,
        values.reverbMix,
        values.saturationDrive,
        values.saturationMix,
      ]);
      return mapPresetRow(result.rows[0]);
    },

    async updateForUser(id, userId, values) {
      const result = await pool.query(`
        UPDATE presets
        SET name = $3,
            eq_low = $4,
            eq_mid = $5,
            eq_high = $6,
            comp_threshold = $7,
            comp_ratio = $8,
            makeup_gain = $9,
            delay_time = $10,
            delay_feedback = $11,
            delay_mix = $12,
            reverb_decay = $13,
            reverb_mix = $14,
            saturation_drive = $15,
            saturation_mix = $16,
            updated_at = now()
        WHERE id = $1
          AND user_id = $2
        RETURNING *
      `, [
        id,
        userId,
        values.name,
        values.eqLow,
        values.eqMid,
        values.eqHigh,
        values.compThreshold,
        values.compRatio,
        values.makeupGain,
        values.delayTime,
        values.delayFeedback,
        values.delayMix,
        values.reverbDecay,
        values.reverbMix,
        values.saturationDrive,
        values.saturationMix,
      ]);
      const preset = mapPresetRow(result.rows[0]);
      return { changed: Boolean(preset), preset };
    },

    async deleteForUser(id, userId) {
      const result = await pool.query(`
        DELETE FROM presets
        WHERE id = $1
          AND user_id = $2
      `, [id, userId]);
      return mapDeletedMutationResult(result);
    },
  };
}

function createPostgresTracksRepository(pool) {
  return {
    async listForUser(userId) {
      const result = await pool.query(`
        SELECT *
        FROM tracks
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [userId]);
      return result.rows.map(mapTrackRow);
    },

    async findForUser(id, userId) {
      const result = await pool.query(`
        SELECT *
        FROM tracks
        WHERE id = $1
          AND user_id = $2
      `, [id, userId]);
      return mapTrackRow(result.rows[0]);
    },

    async create(values) {
      const result = await pool.query(`
        INSERT INTO tracks (id, user_id, file_name, storage_path, status, duration_seconds, size_bytes, format)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        values.id,
        values.userId,
        values.fileName,
        values.storagePath,
        values.status,
        values.durationSeconds,
        values.sizeBytes,
        values.format,
      ]);
      return mapTrackRow(result.rows[0]);
    },

    async deleteForUser(id, userId) {
      const result = await pool.query(`
        DELETE FROM tracks
        WHERE id = $1
          AND user_id = $2
      `, [id, userId]);
      return mapDeletedMutationResult(result);
    },
  };
}
