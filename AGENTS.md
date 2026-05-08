# AGENTS.md — TrackMaster

## Scope

This file applies to this repository:

```txt
C:\Users\bryan\aibry\projects\aibry-trackmaster
```

If this file conflicts with a parent `AGENTS.md`, follow this repo-level file for repo-specific work and the parent file for broad AIBRY operating policy.

## AIBRY Host Split

AIBRY uses a split-host model:

```txt
Fedora = infrastructure/control-plane host
Windows = app/runtime/operator host
```

Fedora owns infrastructure/control-plane concerns such as Postgres, durable storage, Cloudflare ingress, admin-proxy, aibry-admin, node-agent, systemd/Podman/Docker infrastructure, backups, rollback artifacts, and Fedora worker services.

Windows owns PM2-managed app runtimes, migrated app/API/UI processes where applicable, Garage Admin V2, and the Windows runtime worker.

Do not blur Fedora and Windows responsibilities.

## Secrets Policy

Never expose, log, commit, render, or pass to the frontend:

- `.env`
- `.env.*`
- API keys
- database passwords
- Cloudflare Access credentials
- AIBRY auth tokens
- worker auth tokens
- OAuth access tokens
- OAuth refresh tokens
- private keys/certificates
- service account JSON
- raw PM2 environment dumps

Do not ask the operator to paste secrets into chat.

Do not commit `node_modules`, unintended `dist`/build churn, raw logs, temporary browser profiles, database dumps, backup archives, or secrets.

## Git Hygiene

Before changes:

```bash
git status --short
git branch --show-current
git remote -v
```

Before any commit:

```bash
git diff --stat
git diff
```

Prefer targeted changes over broad rewrites. Avoid force-pushes unless explicitly approved.

## Project Role

TrackMaster is a migrated AIBRY app/runtime surface on Windows with Fedora/Postgres infrastructure support.

## Current Runtime Context

Expected current architecture:

```txt
Runtime host: Windows
API process: trackmaster-api
UI process: trackmaster-ui
Database: trackmaster_production on Fedora/Postgres
Current DB role: aibry
Future hardening role: trackmaster_app
```

Known endpoints from runbooks:

```txt
Local API health: http://127.0.0.1:3004/api/health
Local API readiness: http://127.0.0.1:3004/api/readiness
Local UI: http://127.0.0.1:3000/
Public UI: https://trackmaster.aibry.shop/
Public API: https://trackmaster-api.aibry.shop/api/*
Same-origin API: https://trackmaster.aibry.shop/api/*
```

Verify live status before making operational claims.

## Database Rules

Do not hardcode database credentials.

Do not commit `.env` or connection strings containing passwords.

Future hardening task: create/use least-privilege `trackmaster_app` Postgres role, but do not perform DB migrations or role changes unless explicitly requested.

## Runtime Rules

Windows owns app runtime. Fedora owns database/control-plane infrastructure.

Do not assume Fedora localhost for Windows runtime endpoints or Windows localhost for Fedora database/container endpoints.

## Validation

Use repo scripts if present.

Common checks may include:

```bash
npm run build
npm test
node --check server/static-web.js
```

Also validate read-only health endpoints when available.

Do not run production restarts or DB migrations unless explicitly requested.

