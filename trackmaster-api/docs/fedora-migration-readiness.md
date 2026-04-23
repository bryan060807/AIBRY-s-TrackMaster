# TrackMaster Fedora Migration Readiness Checklist

This checklist is for rehearsal and readiness decisions only. It does not cut
production over to Postgres. Keep production configured with
`TRACKMASTER_REPOSITORY_BACKEND=sqlite` until a separate approved cutover pass.
Use `fedora-cutover-runbook.md` for the concrete migration-window command
sequence after this readiness checklist is `GO`.

## Scope

- Main TrackMaster API data only: users, sessions, presets, and track/export
  metadata.
- Audio files remain filesystem-backed and must be validated separately before
  cutover.
- Comparator is out of scope for this workflow.

## Required Inputs

- A real copy or snapshot of the current TrackMaster SQLite database.
- A disposable Fedora-hosted Postgres target.
- Access to TrackMaster API source with dependencies installed.
- A writable artifact directory for rehearsal reports.

## Fedora Rehearsal Commands

Set these paths for the Fedora rehearsal host:

```bash
export TRACKMASTER_SQLITE_SNAPSHOT=/srv/trackmaster/rehearsal/trackmaster.sqlite
export TRACKMASTER_REHEARSAL_POSTGRES_URL='postgres://trackmaster:trackmaster@127.0.0.1:5432/trackmaster_rehearsal'
export TRACKMASTER_REHEARSAL_DIR=/srv/trackmaster/rehearsal/reports/$(date -u +%Y%m%dT%H%M%SZ)
```

Preview only:

```bash
npm --prefix trackmaster-api run rehearse:postgres-migration -- \
  --sqlite "$TRACKMASTER_SQLITE_SNAPSHOT" \
  --postgres-url "$TRACKMASTER_REHEARSAL_POSTGRES_URL" \
  --copy-snapshot \
  --apply-schema \
  --out-dir "$TRACKMASTER_REHEARSAL_DIR"
```

Guarded import plus API read validation:

```bash
export TRACKMASTER_REHEARSAL_ALLOW_WRITE=1

npm --prefix trackmaster-api run rehearse:postgres-migration -- \
  --sqlite "$TRACKMASTER_SQLITE_SNAPSHOT" \
  --postgres-url "$TRACKMASTER_REHEARSAL_POSTGRES_URL" \
  --copy-snapshot \
  --apply-schema \
  --apply \
  --api-validate \
  --out-dir "$TRACKMASTER_REHEARSAL_DIR"
```

Real server process validation against the imported disposable Postgres target:

```bash
export TRACKMASTER_STAGING_ALLOW_RUNTIME_VALIDATION=1
export TRACKMASTER_STAGING_API_JWT_SECRET='trackmaster-staging-secret-32-characters'

npm --prefix trackmaster-api run validate:postgres-runtime -- \
  --postgres-url "$TRACKMASTER_REHEARSAL_POSTGRES_URL" \
  --data-dir /srv/trackmaster/rehearsal/staged-data \
  --out-dir "$TRACKMASTER_REHEARSAL_DIR/postgres-runtime-validation"
```

This starts `trackmaster-api/src/server.js` as a child process, validates
health/auth/session/presets/tracks through HTTP, writes a report, and shuts the
child process down without touching production systemd or nginx.

Generate the human-readable readiness report:

```bash
npm --prefix trackmaster-api run report:migration-readiness -- \
  --report-dir "$TRACKMASTER_REHEARSAL_DIR" \
  --storage-validation pending \
  --backup-validation pending \
  --data-freeze-plan pending \
  --runtime-switch-plan pending
```

The report generator automatically reads runtime validation from:

```text
$TRACKMASTER_REHEARSAL_DIR/postgres-runtime-validation/staging-runtime-report.json
```

It also writes machine-readable readiness data to:

```text
$TRACKMASTER_REHEARSAL_DIR/migration-readiness-data.json
```

Use an explicit runtime artifact path only if the validator wrote to a
non-standard location:

```bash
npm --prefix trackmaster-api run report:migration-readiness -- \
  --report-dir "$TRACKMASTER_REHEARSAL_DIR" \
  --runtime-validation-report "$TRACKMASTER_REHEARSAL_DIR/postgres-runtime-validation/staging-runtime-report.json" \
  --storage-validation passed \
  --backup-validation passed \
  --data-freeze-plan ready \
  --runtime-switch-plan ready
```

After manual checks pass, regenerate with explicit readiness flags:

```bash
npm --prefix trackmaster-api run report:migration-readiness -- \
  --report-dir "$TRACKMASTER_REHEARSAL_DIR" \
  --storage-validation passed \
  --backup-validation passed \
  --data-freeze-plan ready \
  --runtime-switch-plan ready \
  --storage-notes "All imported track storage_path entries resolve under the planned Fedora audio root." \
  --backup-notes "SQLite snapshot, Postgres dump, and restore test completed."
```

## Artifact Review

Review these files in the rehearsal output directory:

- `rehearsal-report.json`: wrapper status, mode, artifact paths, API validation
  result, rollback notes.
- `migration-report.json`: source counts, target counts, conflicts, missing
  references, inserted counts, row checksum validation.
- `migration-readiness-report.md`: human-readable go/no-go report.
- `migration-readiness-data.json`: machine-readable go/no-go data, including
  runtime validation criteria and smoke check statuses.
- `migration-cli.log`: migration CLI stdout/stderr.
- `api-validation.log`: API read validation stdout/stderr when `--api-validate`
  is used.
- `postgres-runtime-validation/staging-runtime-report.json`: real server
  process smoke-test report when runtime validation is used.
- `postgres-runtime-validation/server.log`: stdout/stderr captured from the
  staged API child process.
- `source-snapshot.sqlite`: SQLite backup snapshot created by the rehearsal.

## Go/No-Go Criteria

The report generator marks the rehearsal as `GO` only when all criteria pass:

- Rehearsal wrapper completed successfully.
- Guarded import rehearsal ran in `apply` mode.
- Source counts equal post-import Postgres counts for users, sessions, presets,
  and tracks.
- Zero conflicts:
  - user ids
  - user emails
  - session ids
  - session token hashes
  - preset ids
  - track ids
  - track storage paths
- Zero missing user references for sessions, presets, and tracks.
- Row checksum validation has zero missing ids and zero mismatches.
- API read validation passes through the Postgres repository backend.
- Real API server process validation passes against the imported Postgres
  database.
- Real API server process validation artifact exists at the expected path, the
  child process starts, `/api/health` and `/api/v1/health` pass, all required
  smoke paths pass, no fatal runtime error is reported, and the staged child
  process shuts down cleanly.
- Fedora file storage path validation is marked `passed`.
- Backup and restore verification is marked `passed`.
- Downtime/data-freeze plan is marked `ready`.
- systemd/nginx/runtime switch plan is marked `ready`.

Any failed or pending item is a `NO-GO`.
Missing runtime validation is fail-closed and is also a `NO-GO`. The optional
track download smoke check may be `skipped` without blocking readiness when the
runtime validation report marks it as non-required.

## Manual Fedora Checks

File storage path validation:

- Confirm every imported `tracks.storage_path` resolves under the intended
  Fedora TrackMaster audio root.
- Confirm the file exists for every track/export metadata row that should remain
  downloadable.
- Confirm path normalization does not depend on Windows separators or local
  drive letters.
- Record the result in the readiness report with
  `--storage-validation passed|pending|failed`.

Backup and restore verification:

- Save the source SQLite snapshot.
- Save a Postgres dump after rehearsal import.
- Restore the Postgres dump into a second disposable database and rerun counts
  or repository validation.
- Record the result with `--backup-validation passed|pending|failed`.

Downtime/data-freeze:

- Define the final write freeze window.
- Stop or block TrackMaster writes before the final SQLite snapshot.
- Confirm no Windows or Fedora TrackMaster API instance can write to a separate
  local data store during cutover.
- Record the result with `--data-freeze-plan ready|pending|failed`.

systemd/nginx/runtime switch:

- Prepare environment files for the future API service, but do not activate
  Postgres in production during rehearsal.
- Verify the intended service account can read audio storage and connect to
  Postgres.
- Prepare nginx upstream changes and rollback commands.
- Record the result with `--runtime-switch-plan ready|pending|failed`.

## Backup Requirements

Before any real migration window, prepare:

- SQLite database snapshot from the frozen production data directory.
- Full TrackMaster audio storage backup.
- Existing API service environment file backup.
- Existing nginx site config backup.
- Existing systemd unit file backup.
- Disposable rehearsal Postgres dump.
- Final production Postgres dump after import.

## Rollback Checkpoints

Rehearsal rollback:

- Drop or recreate the disposable Postgres database.
- Delete or archive the rehearsal report directory.
- Leave production SQLite runtime untouched.

Future cutover rollback:

- Stop the new Postgres-backed API service.
- Restore the previous API environment file with
  `TRACKMASTER_REPOSITORY_BACKEND=sqlite`.
- Restore previous nginx upstream if it changed.
- Start the previous SQLite-backed API service.
- Verify `/api/health`, login/session restore, presets, and track listing.

The full cutover rollback command set lives in `fedora-cutover-runbook.md`.

## Post-Rehearsal Cleanup

- Stop and remove disposable Postgres containers or databases.
- Archive report artifacts outside the app deployment directory.
- Remove any temporary SQLite snapshots from shared temp locations.
- Keep `migration-readiness-report.md` with the migration decision record.
