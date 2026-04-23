import {
  mapChangedMutationResult,
  mapCountedDeleteMutationResult,
  mapCreatedMutationResult,
  mapSessionUserRow,
} from './mappers.js';

export function createSessionsRepository(db) {
  return {
    deleteExpired(now) {
      const result = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
      return mapCountedDeleteMutationResult(result);
    },

    create({ id, userId, tokenHash, userAgent, clientKey, expiresAt }) {
      db.prepare(`
        INSERT INTO sessions (id, user_id, token_hash, user_agent, client_key, expires_at)
        VALUES (@id, @userId, @tokenHash, @userAgent, @clientKey, @expiresAt)
      `).run({ id, userId, tokenHash, userAgent, clientKey, expiresAt });
      return mapCreatedMutationResult();
    },

    findActiveUserByTokenHash(tokenHash, now) {
      const row = db.prepare(`
        SELECT users.id, users.email, users.created_at, sessions.id AS session_id
        FROM sessions
        INNER JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
          AND sessions.revoked_at IS NULL
          AND sessions.expires_at > ?
      `).get(tokenHash, now);
      return mapSessionUserRow(row);
    },

    revokeByTokenHash(tokenHash, revokedAt) {
      const result = db.prepare(`
        UPDATE sessions
        SET revoked_at = ?
        WHERE token_hash = ?
          AND revoked_at IS NULL
      `).run(revokedAt, tokenHash);
      return mapChangedMutationResult(result);
    },
  };
}
