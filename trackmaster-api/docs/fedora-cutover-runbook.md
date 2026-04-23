# TrackMaster Fedora Postgres Cutover Runbook

This runbook is operational preparation only. It does not change TrackMaster's
default runtime. The current safe default remains:

```bash
TRACKMASTER_REPOSITORY_BACKEND=sqlite
```

Do not execute the cutover-only runtime switch until a human approves the
migration window and the final Postgres import/readiness checks pass.
Production startup still defaults to SQLite. Postgres runtime activation is
available only when `TRACKMASTER_REPOSITORY_BACKEND=postgres` and
`TRACKMASTER_POSTGRES_URL` are set explicitly during an approved migration
window.

## Risk Labels

- `[READ-ONLY]`: Does not modify production data or runtime.
- `[SAFE REHEARSAL]`: Writes only to disposable rehearsal targets.
- `[WRITE-AFFECTING]`: Writes to migration targets or changes service state.
- `[CUTOVER-ONLY]`: For the approved migration window only.
- `[ROLLBACK]`: Reverts runtime/service state after an abort or failed cutover.

## Variables

Set these on the Fedora host before rehearsal or cutover. Replace every
placeholder with the real value for the environment.

```bash
export TM_APP_ROOT=/opt/trackmaster/aibry-trackmaster
export TM_API_ROOT="$TM_APP_ROOT/trackmaster-api"
export TM_DATA_DIR=/var/lib/trackmaster
export TM_STORAGE_ROOT="$TM_DATA_DIR/uploads"
export TM_SQLITE_SOURCE="$TM_DATA_DIR/trackmaster.sqlite"
export TM_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
export TM_WORK_DIR="/srv/trackmaster/migration/$TM_RUN_ID"
export TM_FINAL_SQLITE_SNAPSHOT="$TM_WORK_DIR/final-trackmaster.sqlite"
export TM_REPORT_DIR="$TM_WORK_DIR/reports"

export TM_PG_HOST=127.0.0.1
export TM_PG_PORT=5432
export TM_PG_USER=trackmaster
export TM_PG_DB=trackmaster
export TM_PG_REHEARSAL_DB=trackmaster_rehearsal
export TM_PG_POOL_MAX=5
export TM_PG_URL="postgres://$TM_PG_USER:REPLACE_PASSWORD@$TM_PG_HOST:$TM_PG_PORT/$TM_PG_DB"
export TM_PG_REHEARSAL_URL="postgres://$TM_PG_USER:REPLACE_PASSWORD@$TM_PG_HOST:$TM_PG_PORT/$TM_PG_REHEARSAL_DB"

export TM_API_SERVICE=trackmaster-api.service
export TM_API_ENV_FILE=/etc/trackmaster/trackmaster-api.env
export TM_API_ENV_BACKUP="$TM_WORK_DIR/trackmaster-api.env.before-cutover"
export TM_NGINX_SERVICE=nginx.service
export TM_NGINX_SITE=/etc/nginx/conf.d/trackmaster.conf
export TM_NGINX_SITE_BACKUP="$TM_WORK_DIR/trackmaster-nginx.conf.before-cutover"
export TM_PUBLIC_BASE_URL=https://trackmaster.example.com
export TM_API_LISTEN_HOST=127.0.0.1
export TM_API_PORT=3004
export TM_API_BASE_URL="http://$TM_API_LISTEN_HOST:$TM_API_PORT"
export TM_JWT_SECRET_VALUE='REPLACE_WITH_EXISTING_PRODUCTION_SECRET'
export TM_SESSION_COOKIE=tm_session
export TM_SESSION_TTL_SECONDS=43200
```

## Phase 0: Preflight

### 0.1 Confirm Current Runtime

`[READ-ONLY]`

```bash
cd "$TM_APP_ROOT"
grep -E '^TRACKMASTER_REPOSITORY_BACKEND=' "$TM_API_ENV_FILE" || true
systemctl status "$TM_API_SERVICE" --no-pager
systemctl status "$TM_NGINX_SERVICE" --no-pager
curl -fsS "$TM_PUBLIC_BASE_URL/api/health"
curl -fsS "$TM_API_BASE_URL/api/health"
```

Expected:

- API is healthy.
- Production env is still SQLite or does not explicitly set Postgres.
- No active Windows/Fedora split-brain writer is pointing at a different local
  TrackMaster database.

Abort if API health fails before the migration starts.

### 0.2 Confirm Tooling

`[READ-ONLY]`

```bash
node --version
npm --prefix "$TM_API_ROOT" --version
psql --version
sqlite3 --version
sudo -u postgres psql -c 'select version();'
```

### 0.3 Confirm Latest Readiness Report Is GO

`[READ-ONLY]`

```bash
grep -n 'Decision:' "$TM_REPORT_DIR/migration-readiness-report.md"
grep -n 'FAIL' "$TM_REPORT_DIR/migration-readiness-report.md" && exit 1 || true
```

Abort unless the latest Fedora rehearsal readiness report says `Decision:
**GO**`.

## Phase 1: Backups Before Freeze

### 1.1 Prepare Migration Directory

`[READ-ONLY]`

```bash
sudo mkdir -p "$TM_WORK_DIR"
sudo chown "$(id -u):$(id -g)" "$TM_WORK_DIR"
mkdir -p "$TM_REPORT_DIR"
```

### 1.2 Backup Config Files

`[READ-ONLY]`

```bash
sudo cp -a "$TM_API_ENV_FILE" "$TM_API_ENV_BACKUP"
sudo cp -a "$TM_NGINX_SITE" "$TM_NGINX_SITE_BACKUP"
sudo systemctl cat "$TM_API_SERVICE" > "$TM_WORK_DIR/$TM_API_SERVICE.unit.before-cutover.txt"
```

### 1.3 Backup Current SQLite And Storage

`[READ-ONLY]`

This pre-freeze backup is not the final import source. It is an early rollback
asset.

```bash
sqlite3 "$TM_SQLITE_SOURCE" ".backup '$TM_WORK_DIR/pre-freeze-trackmaster.sqlite'"
tar -C "$TM_DATA_DIR" -czf "$TM_WORK_DIR/pre-freeze-uploads.tar.gz" uploads
```

### 1.4 Backup Current Postgres Target If It Exists

`[READ-ONLY]`

```bash
pg_dump "$TM_PG_URL" > "$TM_WORK_DIR/postgres-before-cutover.sql" || true
```

## Phase 2: Maintenance And Data Freeze

### 2.1 Start Maintenance Window

`[CUTOVER-ONLY] [WRITE-AFFECTING]`

Choose one freeze strategy. The safest option is to stop the API before the
final SQLite snapshot.

Option A: stop API service:

```bash
sudo systemctl stop "$TM_API_SERVICE"
sudo systemctl status "$TM_API_SERVICE" --no-pager || true
```

Option B: nginx maintenance response while API drains:

```bash
sudo cp -a "$TM_NGINX_SITE" "$TM_WORK_DIR/nginx-before-maintenance.conf"
# Apply pre-reviewed maintenance nginx config here.
sudo nginx -t
sudo systemctl reload "$TM_NGINX_SERVICE"
```

Abort if any other TrackMaster API instance can still write to SQLite.

### 2.2 Final SQLite Snapshot

`[CUTOVER-ONLY] [READ-ONLY AFTER FREEZE]`

```bash
sqlite3 "$TM_SQLITE_SOURCE" ".backup '$TM_FINAL_SQLITE_SNAPSHOT'"
sqlite3 "$TM_FINAL_SQLITE_SNAPSHOT" 'pragma integrity_check;'
ls -lh "$TM_FINAL_SQLITE_SNAPSHOT"
```

Abort if `pragma integrity_check` does not return `ok`.

## Phase 3: Postgres Target Prepare And Import

### 3.1 Create Or Reset Target Database

`[CUTOVER-ONLY] [DESTRUCTIVE]`

Only run against the approved target database. Never run this against an
unapproved production database.

```bash
sudo -u postgres dropdb --if-exists "$TM_PG_DB"
sudo -u postgres createdb --owner "$TM_PG_USER" "$TM_PG_DB"
```

Checkpoint: rollback is still easy here. Production remains frozen on the
unchanged SQLite snapshot.

### 3.2 Import Final Snapshot

`[CUTOVER-ONLY] [WRITE-AFFECTING]`

```bash
export TRACKMASTER_REHEARSAL_ALLOW_WRITE=1

npm --prefix "$TM_API_ROOT" run rehearse:postgres-migration -- \
  --sqlite "$TM_FINAL_SQLITE_SNAPSHOT" \
  --postgres-url "$TM_PG_URL" \
  --copy-snapshot \
  --apply-schema \
  --apply \
  --api-validate \
  --out-dir "$TM_REPORT_DIR"
```

### 3.3 Backup Imported Postgres Target

`[CUTOVER-ONLY] [READ-ONLY]`

Create a rollback and audit artifact immediately after the guarded import.

```bash
pg_dump "$TM_PG_URL" > "$TM_WORK_DIR/postgres-after-import.sql"
gzip -f "$TM_WORK_DIR/postgres-after-import.sql"
ls -lh "$TM_WORK_DIR/postgres-after-import.sql.gz"
```

### 3.4 Generate Final Cutover Readiness Report

`[CUTOVER-ONLY] [READ-ONLY]`

Run first with manual checks pending:

```bash
npm --prefix "$TM_API_ROOT" run report:migration-readiness -- \
  --report-dir "$TM_REPORT_DIR" \
  --runtime-validation-report "$TM_REPORT_DIR/postgres-runtime-validation/staging-runtime-report.json" \
  --storage-validation pending \
  --backup-validation pending \
  --data-freeze-plan ready \
  --runtime-switch-plan ready
```

After storage and backup checks pass, regenerate:

```bash
npm --prefix "$TM_API_ROOT" run report:migration-readiness -- \
  --report-dir "$TM_REPORT_DIR" \
  --runtime-validation-report "$TM_REPORT_DIR/postgres-runtime-validation/staging-runtime-report.json" \
  --storage-validation passed \
  --backup-validation passed \
  --data-freeze-plan ready \
  --runtime-switch-plan ready \
  --storage-notes "Validated imported storage_path rows under $TM_STORAGE_ROOT." \
  --backup-notes "Validated SQLite snapshot and Postgres dump/restore checkpoint."
```

Abort before runtime switch unless the report says `Decision: **GO**`.
Missing or failed real API process runtime validation is an automatic `NO-GO`.

## Phase 4: Validation Before Runtime Switch

### 4.1 Repository Contract Against Target

`[CUTOVER-ONLY] [READ-ONLY]`

This resets schemas in the configured database and is normally for disposable
targets. Do not run this against the final imported production target unless the
test harness has been adjusted to avoid reset. For final imported data, prefer
the API imported-data validation in the rehearsal wrapper.

```bash
# Disposable-only contract validation:
export TRACKMASTER_TEST_POSTGRES_URL="$TM_PG_REHEARSAL_URL"
export TRACKMASTER_TEST_POSTGRES_RESET=1
npm --prefix "$TM_API_ROOT" run test:postgres
```

### 4.2 Imported Data API Read Validation

`[CUTOVER-ONLY] [READ-ONLY]`

```bash
export TRACKMASTER_REHEARSAL_POSTGRES_URL="$TM_PG_URL"
export TRACKMASTER_REHEARSAL_API_JWT_SECRET="$(grep '^TRACKMASTER_JWT_SECRET=' "$TM_API_ENV_FILE" | cut -d= -f2-)"
npm --prefix "$TM_API_ROOT" run test:postgres:api-imported
```

### 4.3 Real API Process Staging Validation

`[SAFE REHEARSAL] [READ-ONLY]`

This starts the real TrackMaster API server as a local child process with
`TRACKMASTER_REPOSITORY_BACKEND=postgres`, runs read-only smoke tests through
HTTP, writes artifacts, and shuts the child process down. It does not touch
production systemd or nginx.

```bash
export TRACKMASTER_STAGING_ALLOW_RUNTIME_VALIDATION=1

npm --prefix "$TM_API_ROOT" run validate:postgres-runtime -- \
  --postgres-url "$TM_PG_URL" \
  --data-dir "$TM_DATA_DIR" \
  --jwt-secret "$TM_JWT_SECRET_VALUE" \
  --out-dir "$TM_REPORT_DIR/postgres-runtime-validation"
```

Review:

```bash
cat "$TM_REPORT_DIR/postgres-runtime-validation/staging-runtime-report.json"
tail -n 100 "$TM_REPORT_DIR/postgres-runtime-validation/server.log"
```

Abort before runtime switch if the report status is not `passed`. The migration
readiness generator reads this artifact and fails closed when it is missing or
when required smoke checks fail.

### 4.4 File Storage Path Validation Placeholder

`[CUTOVER-ONLY] [READ-ONLY]`

Replace this with the final storage validation script when added. Until then,
run a direct SQL sample and file existence check:

```bash
psql "$TM_PG_URL" -c "select count(*) as tracks, count(storage_path) as paths from tracks;"
psql "$TM_PG_URL" -At -c "select storage_path from tracks limit 20;" |
while read -r relpath; do
  test -f "$TM_STORAGE_ROOT/$relpath" && echo "OK $relpath" || echo "MISSING $relpath"
done
```

Abort if expected downloadable exports are missing.

## Phase 5: Runtime Switch

Current code keeps production Postgres activation gated. Treat this phase as
`CUTOVER-ONLY`. Do not run it until the final import and readiness report are
approved. Before replacing the live env file, verify the service starts cleanly
with `TRACKMASTER_REPOSITORY_BACKEND=postgres` in a staging or disposable
Fedora environment.

### 5.1 Prepare Environment File

`[CUTOVER-ONLY] [WRITE-AFFECTING]`

```bash
sudo cp -a "$TM_API_ENV_FILE" "$TM_API_ENV_FILE.pre-postgres-switch"
sudo install -m 600 -o root -g root "$TM_API_ENV_FILE" "$TM_API_ENV_FILE.next"

sudo sed -i 's/^TRACKMASTER_REPOSITORY_BACKEND=.*/TRACKMASTER_REPOSITORY_BACKEND=postgres/' "$TM_API_ENV_FILE.next"
grep -q '^TRACKMASTER_POSTGRES_URL=' "$TM_API_ENV_FILE.next" \
  && sudo sed -i "s|^TRACKMASTER_POSTGRES_URL=.*|TRACKMASTER_POSTGRES_URL=$TM_PG_URL|" "$TM_API_ENV_FILE.next" \
  || echo "TRACKMASTER_POSTGRES_URL=$TM_PG_URL" | sudo tee -a "$TM_API_ENV_FILE.next" >/dev/null
grep -q '^TRACKMASTER_POSTGRES_POOL_MAX=' "$TM_API_ENV_FILE.next" \
  && sudo sed -i "s|^TRACKMASTER_POSTGRES_POOL_MAX=.*|TRACKMASTER_POSTGRES_POOL_MAX=$TM_PG_POOL_MAX|" "$TM_API_ENV_FILE.next" \
  || echo "TRACKMASTER_POSTGRES_POOL_MAX=$TM_PG_POOL_MAX" | sudo tee -a "$TM_API_ENV_FILE.next" >/dev/null
grep -q '^TRACKMASTER_DATA_DIR=' "$TM_API_ENV_FILE.next" \
  && sudo sed -i "s|^TRACKMASTER_DATA_DIR=.*|TRACKMASTER_DATA_DIR=$TM_DATA_DIR|" "$TM_API_ENV_FILE.next" \
  || echo "TRACKMASTER_DATA_DIR=$TM_DATA_DIR" | sudo tee -a "$TM_API_ENV_FILE.next" >/dev/null
grep -q '^TRACKMASTER_HOST=' "$TM_API_ENV_FILE.next" \
  && sudo sed -i "s|^TRACKMASTER_HOST=.*|TRACKMASTER_HOST=$TM_API_LISTEN_HOST|" "$TM_API_ENV_FILE.next" \
  || echo "TRACKMASTER_HOST=$TM_API_LISTEN_HOST" | sudo tee -a "$TM_API_ENV_FILE.next" >/dev/null
grep -q '^PORT=' "$TM_API_ENV_FILE.next" \
  && sudo sed -i "s|^PORT=.*|PORT=$TM_API_PORT|" "$TM_API_ENV_FILE.next" \
  || echo "PORT=$TM_API_PORT" | sudo tee -a "$TM_API_ENV_FILE.next" >/dev/null
grep -q '^TRACKMASTER_SESSION_COOKIE=' "$TM_API_ENV_FILE.next" \
  && sudo sed -i "s|^TRACKMASTER_SESSION_COOKIE=.*|TRACKMASTER_SESSION_COOKIE=$TM_SESSION_COOKIE|" "$TM_API_ENV_FILE.next" \
  || echo "TRACKMASTER_SESSION_COOKIE=$TM_SESSION_COOKIE" | sudo tee -a "$TM_API_ENV_FILE.next" >/dev/null
grep -q '^TRACKMASTER_SESSION_EXPIRES_IN_SECONDS=' "$TM_API_ENV_FILE.next" \
  && sudo sed -i "s|^TRACKMASTER_SESSION_EXPIRES_IN_SECONDS=.*|TRACKMASTER_SESSION_EXPIRES_IN_SECONDS=$TM_SESSION_TTL_SECONDS|" "$TM_API_ENV_FILE.next" \
  || echo "TRACKMASTER_SESSION_EXPIRES_IN_SECONDS=$TM_SESSION_TTL_SECONDS" | sudo tee -a "$TM_API_ENV_FILE.next" >/dev/null
grep -q '^TRACKMASTER_JWT_SECRET=' "$TM_API_ENV_FILE.next" \
  && sudo sed -i "s|^TRACKMASTER_JWT_SECRET=.*|TRACKMASTER_JWT_SECRET=$TM_JWT_SECRET_VALUE|" "$TM_API_ENV_FILE.next" \
  || echo "TRACKMASTER_JWT_SECRET=$TM_JWT_SECRET_VALUE" | sudo tee -a "$TM_API_ENV_FILE.next" >/dev/null

sudo diff -u "$TM_API_ENV_FILE" "$TM_API_ENV_FILE.next" || true
```

Checkpoint: rollback is still easy. The live env file has not been replaced.

### 5.2 Activate Environment And Restart API

`[CUTOVER-ONLY] [WRITE-AFFECTING]`

```bash
sudo mv "$TM_API_ENV_FILE.next" "$TM_API_ENV_FILE"
sudo systemctl daemon-reload
sudo systemctl restart "$TM_API_SERVICE"
sudo systemctl status "$TM_API_SERVICE" --no-pager
journalctl -u "$TM_API_SERVICE" -n 100 --no-pager
```

### 5.3 Reload nginx

`[CUTOVER-ONLY] [WRITE-AFFECTING]`

```bash
sudo nginx -t
sudo systemctl reload "$TM_NGINX_SERVICE"
sudo systemctl status "$TM_NGINX_SERVICE" --no-pager
```

Checkpoint: after the API is accepting writes on Postgres, rollback becomes
data-sensitive. Any new writes after this point must be handled before reverting
to SQLite.

## Phase 6: Smoke Tests

Set smoke-test credentials for a known test account or use a temporary account
created during the maintenance window.

```bash
export TM_SMOKE_EMAIL=smoke-test@example.com
export TM_SMOKE_PASSWORD='replace-with-strong-smoke-password'
export TM_COOKIE_JAR="$TM_WORK_DIR/smoke-cookies.txt"
```

### 6.1 Health Through nginx

`[CUTOVER-ONLY] [READ-ONLY]`

```bash
curl -fsS "$TM_PUBLIC_BASE_URL/api/health"
curl -fsS "$TM_PUBLIC_BASE_URL/api/v1/health"
```

### 6.2 Auth/Login And Session Restore

`[CUTOVER-ONLY] [WRITE-AFFECTING IF REGISTERING]`

Preferred if the account already exists:

```bash
curl -fsS -c "$TM_COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TM_SMOKE_EMAIL\",\"password\":\"$TM_SMOKE_PASSWORD\"}" \
  "$TM_PUBLIC_BASE_URL/api/auth/login" | tee "$TM_WORK_DIR/smoke-login.json"

curl -fsS -b "$TM_COOKIE_JAR" "$TM_PUBLIC_BASE_URL/api/auth/session"
```

If no smoke account exists and the team approves a write:

```bash
curl -fsS -c "$TM_COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TM_SMOKE_EMAIL\",\"password\":\"$TM_SMOKE_PASSWORD\"}" \
  "$TM_PUBLIC_BASE_URL/api/auth/register" | tee "$TM_WORK_DIR/smoke-register.json"
```

### 6.3 Presets Read/Write

`[CUTOVER-ONLY] [WRITE-AFFECTING]`

```bash
curl -fsS -b "$TM_COOKIE_JAR" "$TM_PUBLIC_BASE_URL/api/presets" | tee "$TM_WORK_DIR/smoke-presets-before.json"

curl -fsS -b "$TM_COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -X POST \
  -d '{
    "name":"Smoke Test Preset",
    "params":{
      "eqLow":1,"eqMid":0,"eqHigh":-1,
      "compThreshold":-14,"compRatio":2,"makeupGain":1,
      "delayTime":0.3,"delayFeedback":0.2,"delayMix":0,
      "reverbDecay":1.5,"reverbMix":0,
      "saturationDrive":1,"saturationMix":0
    }
  }' \
  "$TM_PUBLIC_BASE_URL/api/presets" | tee "$TM_WORK_DIR/smoke-preset-create.json"

curl -fsS -b "$TM_COOKIE_JAR" "$TM_PUBLIC_BASE_URL/api/presets" | tee "$TM_WORK_DIR/smoke-presets-after.json"
```

### 6.4 Track History Read

`[CUTOVER-ONLY] [READ-ONLY]`

```bash
curl -fsS -b "$TM_COOKIE_JAR" "$TM_PUBLIC_BASE_URL/api/tracks" | tee "$TM_WORK_DIR/smoke-tracks.json"
```

### 6.5 Track Download

`[CUTOVER-ONLY] [READ-ONLY]`

If `jq` is available:

```bash
export TM_TRACK_DOWNLOAD_URL="$(jq -r '.tracks[0].downloadUrl // empty' "$TM_WORK_DIR/smoke-tracks.json")"
test -n "$TM_TRACK_DOWNLOAD_URL"
curl -fSL -b "$TM_COOKIE_JAR" "$TM_PUBLIC_BASE_URL$TM_TRACK_DOWNLOAD_URL" -o "$TM_WORK_DIR/smoke-track-download.bin"
ls -lh "$TM_WORK_DIR/smoke-track-download.bin"
```

If there are no imported tracks for the smoke user, use a known imported user or
validate download through an account that owns imported track history.

## Phase 7: Rollback

### Rollback Checkpoint A: Before Freeze

`[ROLLBACK] [READ-ONLY]`

No rollback needed. Do not start the migration window.

### Rollback Checkpoint B: After Freeze, Before Runtime Switch

`[ROLLBACK] [WRITE-AFFECTING]`

```bash
sudo systemctl start "$TM_API_SERVICE"
sudo cp -a "$TM_NGINX_SITE_BACKUP" "$TM_NGINX_SITE"
sudo nginx -t
sudo systemctl reload "$TM_NGINX_SERVICE"
curl -fsS "$TM_PUBLIC_BASE_URL/api/health"
```

Postgres can be discarded:

```bash
sudo -u postgres dropdb --if-exists "$TM_PG_DB"
```

### Rollback Checkpoint C: After Runtime Switch, Before Writes Reopen

`[ROLLBACK] [WRITE-AFFECTING]`

```bash
sudo systemctl stop "$TM_API_SERVICE"
sudo cp -a "$TM_API_ENV_BACKUP" "$TM_API_ENV_FILE"
sudo cp -a "$TM_NGINX_SITE_BACKUP" "$TM_NGINX_SITE"
sudo systemctl daemon-reload
sudo systemctl start "$TM_API_SERVICE"
sudo nginx -t
sudo systemctl reload "$TM_NGINX_SERVICE"
curl -fsS "$TM_PUBLIC_BASE_URL/api/health"
```

### Rollback Checkpoint D: After Writes Reopen

`[ROLLBACK] [DATA-SENSITIVE]`

Do not blindly switch back to SQLite if users may have written to Postgres.
Options:

- Freeze writes again.
- Export and reconcile new Postgres writes.
- Decide whether to preserve Postgres as source of truth or manually replay
  writes into SQLite.
- Only then restore the SQLite env/runtime if approved.

## Phase 8: Post-Cutover Or Post-Abort Cleanup

`[WRITE-AFFECTING]`

```bash
unset TRACKMASTER_REHEARSAL_ALLOW_WRITE
unset TRACKMASTER_MIGRATION_ALLOW_WRITE
archive="$TM_WORK_DIR/artifacts.tar.gz"
tar -C "$TM_WORK_DIR" -czf "$archive" reports *.sqlite *.sql *.txt 2>/dev/null || true
ls -lh "$archive"
```

Keep all reports and logs with the migration decision record.
