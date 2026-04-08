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
