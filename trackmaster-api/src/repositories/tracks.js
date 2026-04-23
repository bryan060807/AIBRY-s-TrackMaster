import { mapDeletedMutationResult, mapTrackRow } from './mappers.js';

export function createTracksRepository(db) {
  const repository = {
    listForUser(userId) {
      return db.prepare(`
        SELECT *
        FROM tracks
        WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(userId).map(mapTrackRow);
    },

    findForUser(id, userId) {
      const row = db.prepare(`
        SELECT *
        FROM tracks
        WHERE id = ?
          AND user_id = ?
      `).get(id, userId);
      return mapTrackRow(row);
    },

    create(values) {
      db.prepare(`
        INSERT INTO tracks (id, user_id, file_name, storage_path, status, duration_seconds, size_bytes, format)
        VALUES (@id, @userId, @fileName, @storagePath, @status, @durationSeconds, @sizeBytes, @format)
      `).run(values);
      return repository.findForUser(values.id, values.userId);
    },

    deleteForUser(id, userId) {
      const result = db.prepare(`
        DELETE FROM tracks
        WHERE id = ?
          AND user_id = ?
      `).run(id, userId);
      return mapDeletedMutationResult(result);
    },
  };
  return repository;
}
