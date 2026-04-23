# TrackMaster Windows Readiness Runbook

This runbook is for Windows-side readiness checks only. It must not be used as
a live production cutover. Fedora remains the authoritative TrackMaster runtime,
database owner, storage owner, nginx front door, and Cloudflare target until the
separate Fedora cutover runbook is approved and executed.

## Guardrails

- Do not point Fedora nginx or Cloudflare at the Windows readiness API.
- Do not open an inbound Windows Firewall rule for this readiness process.
- Do not run `pm2 save` for `trackmaster-windows-readiness-api`.
- Do not set `TRACKMASTER_REPOSITORY_BACKEND=postgres` for this Windows process.
- Do not reuse Fedora production `data/` or audio storage paths.

The Windows readiness process binds to `127.0.0.1:3104`, uses SQLite, and writes
only under `data-windows-readiness/`, which is intentionally separate from the
Fedora-owned production data.

## One-Shot Local API Check

```powershell
cd C:\Users\bryan\aibry\projects\aibry-trackmaster
npm install
npm run start:windows-readiness
```

In another PowerShell session:

```powershell
Invoke-RestMethod http://127.0.0.1:3104/api/health
Invoke-RestMethod http://127.0.0.1:3104/api/readiness
```

Stop the foreground process with `Ctrl+C`.

## PM2 Readiness Check

```powershell
cd C:\Users\bryan\aibry\projects\aibry-trackmaster
npm install
npm run pm2:windows-readiness:start
npm run pm2:windows-readiness:status
Invoke-RestMethod http://127.0.0.1:3104/api/readiness
npm run pm2:windows-readiness:logs
npm run pm2:windows-readiness:delete
```

Do not run `pm2 save` after starting this process. If it is accidentally saved,
remove it and save the cleaned PM2 list:

```powershell
npm run pm2:windows-readiness:delete
pm2 save
```

## Validation

```powershell
npm run check:api
powershell -ExecutionPolicy Bypass -File scripts\validate-windows-readiness.ps1
```

Expected readiness properties:

- `ok: true`
- `service: trackmaster-api`
- `repositoryBackend: sqlite`
- `storage.ready: true`
- `runtime.host: 127.0.0.1`
- `runtime.production: false`

Any Postgres runtime validation or live API cutover remains covered by
`trackmaster-api/docs/fedora-cutover-runbook.md`, not this Windows runbook.
