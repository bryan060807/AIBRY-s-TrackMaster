# AIBRY TrackMaster

Garage-native browser mastering rack.

TrackMaster is a Vite/React frontend plus a local Node/Express API. The browser
does the audio processing with the Web Audio API; the API stores mastering logs,
custom presets, and exported audio on the garage server using SQLite and the
local filesystem.

## Architecture

- Frontend: static Vite build served by nginx
- API: Express on `127.0.0.1:3004`
- Database: `data/trackmaster.sqlite`
- Storage: `data/uploads/`
- Public web entry: Cloudflare Tunnel to `http://127.0.0.1:3000`
- Public API entry: Cloudflare Tunnel to `http://127.0.0.1:3004`
- Auth: local account login with JWT-protected API routes

Current live ownership stays on the Fedora host. The Windows-side PM2 scaffold
in this repo is readiness-only; it binds to localhost, uses a separate
`data-windows-readiness/` SQLite data directory, and must not be saved into the
Windows PM2 resurrect list as a production process.

## Repository Layout

The current split is intentional and these paths are required source, not
duplicates:

- `server/`: compatibility API launcher. `server/index.js` starts
  `trackmaster-api/src/server.js`.
- `trackmaster-api/`: API-owned source, tests, migrations, and Fedora cutover
  docs. This tree is copied by the API container build and is required for
  runtime validation.
- `src/`: current Vite UI entrypoint and React app shell.
- `trackmaster-ui/`: UI-owned split source introduced during the scaffold pass.
  The root UI still builds from `src/`, but `src/lib/api.ts` intentionally
  re-exports the shared API/session client from `trackmaster-ui/src/lib`.
- `deploy/`: Fedora live deployment assets.
- `scripts/` and `docs/`: Windows-readiness operator helpers and runbooks.

Only generated artifacts stay ignored: `dist/`, `data/`,
`data-windows-readiness/`, `node_modules/`, and `trackmaster-api/reports/`.

## Local Development

```bash
npm ci
npm run dev:api
npm run dev
```

The Vite dev server proxies `/api` to `http://127.0.0.1:3004`.

## Validation

```bash
npm run lint
npm run build
npm audit --audit-level=high
```

## Garage Deployment

See [deploy/README.md](deploy/README.md).

## Windows Readiness Only

Use this path to validate Windows syntax, PM2 wiring, and local health probes
without changing production authority:

```powershell
cd C:\Users\bryan\aibry\projects\aibry-trackmaster
npm install
npm run check:api
powershell -ExecutionPolicy Bypass -File scripts\validate-windows-readiness.ps1
```

Optional local-only PM2 smoke check:

```powershell
npm run pm2:windows-readiness:start
Invoke-RestMethod http://127.0.0.1:3104/api/readiness
npm run pm2:windows-readiness:delete
```

Do not run `pm2 save` for `trackmaster-windows-readiness-api`, do not open a
firewall rule for it, and do not point Fedora nginx or Cloudflare at it. See
[docs/windows-readiness-runbook.md](docs/windows-readiness-runbook.md).
