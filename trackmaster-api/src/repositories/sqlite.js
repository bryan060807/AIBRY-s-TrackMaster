import { createHealthRepository } from './health.js';
import { createPresetsRepository } from './presets.js';
import { createSessionsRepository } from './sessions.js';
import { createTracksRepository } from './tracks.js';
import { createUsersRepository } from './users.js';

export function createSqliteRepositories(db) {
  return {
    backend: 'sqlite',
    health: createHealthRepository(db),
    presets: createPresetsRepository(db),
    sessions: createSessionsRepository(db),
    tracks: createTracksRepository(db),
    users: createUsersRepository(db),
  };
}
