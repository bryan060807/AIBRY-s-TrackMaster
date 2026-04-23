# TrackMaster API

API-owned code lives here. The root `server/index.js` file is intentionally only
a compatibility entrypoint during the split. This tree is required source for
the repository: root scripts call into it, the API container copies it, and the
Windows-readiness validation path executes it directly.

Current persistence remains SQLite plus local filesystem audio storage by
default. A production-capable Postgres repository runtime path exists for a
future Fedora cutover, but it is disabled unless
`TRACKMASTER_REPOSITORY_BACKEND=postgres` and `TRACKMASTER_POSTGRES_URL` are set
explicitly.

Routes and auth should depend on `src/repositories/`, not raw database queries.
SQLite remains the default repository implementation. The Postgres
implementation must continue to pass the shared repository contract harness
before any production cutover.

Health endpoints:

- `/api/health` and `/api/v1/health`: compatibility liveness checks.
- `/api/readiness` and `/api/v1/readiness`: repository and local storage access
  checks, plus the active host, port, production flag, and repository backend.

Future Fedora Postgres activation env:

```bash
TRACKMASTER_REPOSITORY_BACKEND=postgres
TRACKMASTER_POSTGRES_URL=postgres://trackmaster:REPLACE_PASSWORD@127.0.0.1:5432/trackmaster
TRACKMASTER_POSTGRES_POOL_MAX=5
```

Do not set these in production until the migration runbook is approved and the
final SQLite import has passed validation.

Optional Postgres contract test:

```powershell
$env:TRACKMASTER_TEST_POSTGRES_URL='postgres://trackmaster:trackmaster@127.0.0.1:5432/trackmaster_test'
$env:TRACKMASTER_TEST_POSTGRES_RESET='1'
npm --prefix trackmaster-api run test:postgres
```

The Postgres test path drops and recreates TrackMaster tables, so it must only
point at a disposable database.

SQLite to Postgres migration preview:

```powershell
$env:TRACKMASTER_MIGRATION_SQLITE_PATH='C:\path\to\trackmaster.sqlite'
$env:TRACKMASTER_MIGRATION_POSTGRES_URL='postgres://trackmaster:trackmaster@127.0.0.1:5432/trackmaster_test'
npm --prefix trackmaster-api run migrate:sqlite-to-postgres -- --apply-schema
```

Guarded import mode:

```powershell
$env:TRACKMASTER_MIGRATION_ALLOW_WRITE='1'
npm --prefix trackmaster-api run migrate:sqlite-to-postgres -- --sqlite C:\path\to\trackmaster.sqlite --postgres-url postgres://trackmaster:trackmaster@127.0.0.1:5432/trackmaster_test --apply
```

The migration command is dry-run by default. It reports source counts, target
counts, conflicts, missing user references, and would-insert totals before any
guarded import.

Fedora-style rehearsal workflow:

```powershell
npm --prefix trackmaster-api run rehearse:postgres-migration -- `
  --sqlite C:\path\to\trackmaster.sqlite `
  --postgres-url postgres://trackmaster:trackmaster@127.0.0.1:5432/trackmaster_rehearsal `
  --copy-snapshot `
  --apply-schema `
  --out-dir trackmaster-api\reports\migration-rehearsals\manual-preview
```

Guarded rehearsal import plus API read validation:

```powershell
$env:TRACKMASTER_REHEARSAL_ALLOW_WRITE='1'

npm --prefix trackmaster-api run rehearse:postgres-migration -- `
  --sqlite C:\path\to\trackmaster.sqlite `
  --postgres-url postgres://trackmaster:trackmaster@127.0.0.1:5432/trackmaster_rehearsal `
  --copy-snapshot `
  --apply-schema `
  --apply `
  --api-validate
```

Rehearsal artifacts are written under
`trackmaster-api/reports/migration-rehearsals/<timestamp>/` by default:

- `migration-report.json`: source/target counts, conflicts, missing references,
  row checksum comparison, and rollback notes.
- `rehearsal-report.json`: wrapper status, artifact paths, API validation
  result, and rollback notes.
- `migration-cli.log` and optional `api-validation.log`: command output.

Generate a human-readable readiness report from rehearsal artifacts:

```powershell
npm --prefix trackmaster-api run report:migration-readiness -- `
  --report-dir trackmaster-api\reports\migration-rehearsals\<run-id> `
  --runtime-validation-report trackmaster-api\reports\migration-rehearsals\<run-id>\postgres-runtime-validation\staging-runtime-report.json `
  --storage-validation pending `
  --backup-validation pending `
  --data-freeze-plan pending `
  --runtime-switch-plan pending
```

The readiness report fails closed if real-server Postgres runtime validation is
missing or failed. It writes Markdown to `migration-readiness-report.md` and
machine-readable criteria to `migration-readiness-data.json`.

Validate the real API server process against a disposable imported Postgres
database:

```powershell
$env:TRACKMASTER_STAGING_ALLOW_RUNTIME_VALIDATION='1'
$env:TRACKMASTER_STAGING_API_JWT_SECRET='trackmaster-staging-secret-32-characters'

npm --prefix trackmaster-api run validate:postgres-runtime -- `
  --postgres-url postgres://trackmaster:trackmaster@127.0.0.1:5432/trackmaster_rehearsal `
  --data-dir C:\path\to\staged-trackmaster-data `
  --out-dir trackmaster-api\reports\postgres-runtime-validations\manual
```

This starts `trackmaster-api/src/server.js` as a child process with
`TRACKMASTER_REPOSITORY_BACKEND=postgres`, runs read-only smoke checks through
HTTP, writes `staging-runtime-report.json` and `server.log`, then shuts the
child process down. It does not change production systemd or nginx.

Operational migration docs:

- `docs/fedora-migration-readiness.md`: rehearsal and readiness checklist.
- `docs/fedora-cutover-runbook.md`: ordered Fedora cutover commands, smoke
  tests, and rollback checkpoints.
- `docs/fedora-cutover-operator-checklist.md`: short migration-window
  checklist.
