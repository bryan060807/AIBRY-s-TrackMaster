# TrackMaster Fedora Cutover Operator Checklist

This is the short operator checklist for the migration window. Use the detailed
commands in `fedora-cutover-runbook.md`.

## Before Window

- [ ] Latest Fedora rehearsal report says `Decision: GO`.
- [ ] Storage path validation passed.
- [ ] Backup and restore verification passed.
- [ ] Data-freeze plan approved.
- [ ] systemd/nginx/runtime switch plan approved.
- [ ] Postgres runtime env verified in staging or a disposable Fedora target.
- [ ] Rollback owner identified.
- [ ] Smoke-test account ready.
- [ ] Production still uses `TRACKMASTER_REPOSITORY_BACKEND=sqlite`.

## Freeze

- [ ] Announce maintenance window.
- [ ] Stop or block TrackMaster writes.
- [ ] Confirm no Windows/Fedora split-brain writer remains active.
- [ ] Create final SQLite snapshot.
- [ ] Run SQLite integrity check.

## Import

- [ ] Create/reset approved Postgres target.
- [ ] Run guarded import with `TRACKMASTER_REHEARSAL_ALLOW_WRITE=1`.
- [ ] Generate final migration report.
- [ ] Confirm source counts equal target after-import counts.
- [ ] Confirm zero conflicts.
- [ ] Confirm zero missing references.
- [ ] Confirm zero checksum mismatches.
- [ ] Confirm API imported-data validation passed.
- [ ] Confirm real API process Postgres runtime validation passed.
- [ ] Confirm `migration-readiness-data.json` marks runtime validation criteria as passed.

## Final Go/No-Go

- [ ] Generate `migration-readiness-report.md`.
- [ ] Generate `migration-readiness-data.json`.
- [ ] Confirm `Decision: GO`.
- [ ] Abort if any criterion is failed, pending, or missing.

## Runtime Switch

- [ ] Back up current API env file.
- [ ] Back up nginx config.
- [ ] Prepare Postgres env file.
- [ ] Review env diff.
- [ ] Restart TrackMaster API.
- [ ] Reload nginx.
- [ ] Confirm service health.

## Smoke Tests

- [ ] `/api/health` through nginx passes.
- [ ] `/api/v1/health` through nginx passes.
- [ ] Login/session restore passes.
- [ ] Presets read passes.
- [ ] Preset create/readback passes.
- [ ] Track history read passes.
- [ ] Track download passes for an imported track owner.

## Rollback Checkpoints

- [ ] Before freeze: cancel window.
- [ ] After freeze before runtime switch: restart SQLite-backed API.
- [ ] After runtime switch before writes reopen: restore env/nginx backups and restart API.
- [ ] After writes reopen: treat rollback as data-sensitive; freeze writes and reconcile Postgres writes before reverting.

## Cleanup

- [ ] Archive reports/logs/snapshots.
- [ ] Remove disposable rehearsal databases.
- [ ] Clear write-enable env vars from operator shell.
- [ ] Record final decision and timestamps.
