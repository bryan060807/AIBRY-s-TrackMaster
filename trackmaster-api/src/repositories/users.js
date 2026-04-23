import { mapSqliteUniqueConstraint } from './errors.js';
import { mapUserRow, mapUserWithPasswordRow } from './mappers.js';

export function createUsersRepository(db) {
  return {
    create({ id, email, passwordHash }) {
      try {
        const row = db.prepare(`
          INSERT INTO users (id, email, password_hash)
          VALUES (?, ?, ?)
          RETURNING id, email, password_hash, created_at
        `).get(id, email, passwordHash);
        return mapUserWithPasswordRow(row);
      } catch (err) {
        throw mapSqliteUniqueConstraint(err, 'USER_EMAIL_EXISTS', 'A user with that email already exists');
      }
    },

    findByEmailWithPassword(email) {
      const row = db.prepare(`
        SELECT id, email, password_hash, created_at
        FROM users
        WHERE email = ?
      `).get(email);
      return mapUserWithPasswordRow(row);
    },

    findPublicById(id) {
      const row = db.prepare(`
        SELECT id, email, created_at
        FROM users
        WHERE id = ?
      `).get(id);
      return mapUserRow(row);
    },
  };
}
