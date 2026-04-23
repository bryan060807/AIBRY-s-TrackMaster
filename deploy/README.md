# AIBRY TrackMaster Garage Deployment

This app deploys as an authenticated garage-native split service:

- `trackmaster-web`: nginx serving the Vite `dist/` directory and proxying `/api/`
- `trackmaster-api`: Node/Express API with SQLite and local filesystem storage, run by a user systemd service
- `data/trackmaster.sqlite`: local database
- `data/uploads/`: local mastered audio storage
- frontend port: `127.0.0.1:3000`
- API port: `127.0.0.1:3004`
- Cloudflare Tunnel: `trackmaster.aibry.shop` to `http://127.0.0.1:3000`
- Cloudflare Tunnel: `trackmaster-api.aibry.shop` to `http://127.0.0.1:3004`

This is the live deployment model. Windows PM2 files in the repository are
readiness-only and must not replace the Fedora Podman/systemd/nginx runtime
unless the separate Fedora cutover runbook is explicitly approved.

Required repository source for this deployment shape:

- root `server/` compatibility entrypoint
- root frontend source under `src/`
- `trackmaster-api/` API source tree copied into the API container

`trackmaster-ui/` is also required source in the repo during the split because
the current root UI re-exports shared API/session client code from it, even
though the live frontend build still starts from root `src/`.

## Build

```bash
npm ci
npm run lint
npm run build
test -f .env || touch .env
grep -q '^TRACKMASTER_JWT_SECRET=' .env || printf 'TRACKMASTER_JWT_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
podman build -f deploy/Containerfile.api -t localhost/aibry-trackmaster-api:latest .
podman build -f deploy/Containerfile.web -t localhost/aibry-trackmaster-ui:latest .
```

The API service reads `/home/aibry/projects/aibry-trackmaster/.env` through
`--env-file`. Keep the JWT secret there, not in frontend code or the systemd
unit.

## Install the user services

```bash
mkdir -p data/uploads
mkdir -p ~/.config/systemd/user
cp deploy/trackmaster-api.service ~/.config/systemd/user/
cp deploy/trackmaster-web.service ~/.config/systemd/user/
rm -f ~/.config/containers/systemd/trackmaster-api.container
rm -f ~/.config/containers/systemd/trackmaster-web.container
systemctl --user daemon-reload
systemctl --user enable --now trackmaster-api.service
systemctl --user enable --now trackmaster-web.service
systemctl --user status trackmaster-api.service
systemctl --user status trackmaster-web.service
curl -fsS http://127.0.0.1:3004/api/health
curl -fsS http://127.0.0.1:3004/api/readiness
curl -i http://127.0.0.1:3004/api/tracks
curl -I http://127.0.0.1:3000/
```

## Cloudflare Tunnel

Add this ingress rule to the existing tunnel configuration:

```yaml
- hostname: trackmaster.aibry.shop
  service: http://127.0.0.1:3000
- hostname: trackmaster-api.aibry.shop
  service: http://127.0.0.1:3004
```

Restart the existing tunnel user service after changing its config.
