# TrackMaster API Repository Contracts

The API routes and auth layer should depend on these repository contracts, not
raw database calls. The active implementation is SQLite-backed, but repository
outputs are backend-neutral domain objects. Repository consumers should `await`
all repository methods so a future async Postgres implementation can preserve
these method names and return shapes without route churn.

## Shared Domain Shape

Repositories return camelCase/domain-friendly objects. Backend-specific row
names such as SQLite `created_at`, `password_hash`, or `storage_path` are mapped
inside `src/repositories/mappers.js`.

- Public users expose `id`, `email`, and `createdAt`.
- Users loaded for password verification also expose `passwordHash`.
- Session lookups return public user fields plus `sessionId`.
- Presets expose `id`, `userId`, `name`, `createdAt`, `updatedAt`, and nested
  `params`.
- Tracks expose `id`, `userId`, `fileName`, `storagePath`, `status`,
  `durationSeconds`, `sizeBytes`, `format`, and `createdAt`.

Not-found reads return `undefined`. Mutation methods return backend-neutral
outcomes such as `{ created: true }`, `{ changed: boolean }`, or
`{ deleted: boolean }`. Routes must not depend on SQLite `changes` counts.

## users

`create({ id, email, passwordHash })`

- Inserts a user.
- Returns a user object containing `id`, `email`, `passwordHash`, and
  `createdAt`.
- Duplicate email throws a backend-neutral `RepositoryConflictError` with
  `code: "USER_EMAIL_EXISTS"` and `status: 409`. Route code maps this to HTTP
  `409`.

`findByEmailWithPassword(email)`

- Looks up one user by normalized email.
- Returns `id`, `email`, `passwordHash`, and `createdAt`.
- Returns `undefined` when no user exists.

`findPublicById(id)`

- Looks up one user by id for authenticated request context.
- Returns `id`, `email`, and `createdAt`.
- Returns `undefined` when no user exists.

## sessions

`deleteExpired(now)`

- Deletes sessions with `expires_at <= now`.
- `now` must be an ISO timestamp string.
- Returns `{ deleted: boolean, deletedCount: number }`.

`create({ id, userId, tokenHash, userAgent, clientKey, expiresAt })`

- Inserts a server-side session row.
- `tokenHash` is a SHA-256 hash of the opaque cookie token, not the raw token.
- `expiresAt` must be an ISO timestamp string.
- Returns `{ created: true }`.

`findActiveUserByTokenHash(tokenHash, now)`

- Finds the active, unrevoked session matching `tokenHash` and `expires_at > now`.
- Returns public user fields plus `sessionId`.
- Returns `undefined` when the token is missing, expired, revoked, or invalid.

`revokeByTokenHash(tokenHash, revokedAt)`

- Marks matching active sessions as revoked.
- Returns `{ changed: boolean }`. `changed` is `false` for already-revoked or
  unknown tokens.

## presets

`listForUser(userId)`

- Returns all presets owned by `userId`, newest first.
- Returns an empty array when the user has no presets.

`findForUser(id, userId)`

- Returns one preset owned by `userId`.
- Returns `undefined` when missing or owned by another user.

`create(values)`

- Inserts a preset. `values` must include `id`, `userId`, `name`, and all current
  mastering parameter fields: `eqLow`, `eqMid`, `eqHigh`, `compThreshold`,
  `compRatio`, `makeupGain`, `delayTime`, `delayFeedback`, `delayMix`,
  `reverbDecay`, `reverbMix`, `saturationDrive`, and `saturationMix`.
- Returns the created preset object:
  `{ id, userId, name, createdAt, updatedAt, params }`.

`updateForUser(id, userId, values)`

- Updates one preset owned by `userId`.
- `values` uses the same parameter field names as `create`.
- Returns `{ changed: boolean, preset }`.
- `changed` is `false` and `preset` is `undefined` when the preset does not
  exist or belongs to another user.

`deleteForUser(id, userId)`

- Deletes one preset owned by `userId`.
- Returns `{ deleted: boolean }`. Route code treats `deleted: false` as HTTP
  `404`.

## tracks

`listForUser(userId)`

- Returns all track/export history rows owned by `userId`, newest first.
- Returns an empty array when the user has no tracks.

`findForUser(id, userId)`

- Returns one track/export history row owned by `userId`.
- Returns `undefined` when missing or owned by another user.

`create(values)`

- Inserts track/export metadata after the route writes the audio file.
- `values` must include `id`, `userId`, `fileName`, `storagePath`, `status`,
  `durationSeconds`, `sizeBytes`, and `format`.
- Returns the created track object.

`deleteForUser(id, userId)`

- Deletes one track/export metadata row owned by `userId`.
- Returns `{ deleted: boolean }`.

## Backend Factory

`createRepositories(options)`

- Accepts `{ backend, db }`.
- `backend` defaults to `"sqlite"`.
- `"sqlite"` remains the default active implementation.
- `"postgres"` is registered under `src/repositories/postgres.js`. It returns an
  inactive skeleton unless the caller provides a `pg` pool and either
  `allowRuntimePostgres: true` or `allowTestPostgres: true`.
- Production startup creates and owns a Postgres pool only when
  `TRACKMASTER_REPOSITORY_BACKEND=postgres` and `TRACKMASTER_POSTGRES_URL` are
  set explicitly.
- Unsupported backend names throw before routes start.
- Existing direct SQLite usage through `createRepositories(db)` remains as a
  compatibility shim during the split.
- The draft Postgres schema lives at
  `migrations/postgres/0001_initial_schema.sql`.
- The optional Postgres contract test is gated by
  `TRACKMASTER_TEST_POSTGRES_URL` and `TRACKMASTER_TEST_POSTGRES_RESET=1`.

## health

`check()`

- Executes a minimal database read.
- Returns a truthy row when the database is reachable.
- Throws if the database cannot be queried.
