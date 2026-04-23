$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$env:NODE_ENV = "development"
$env:PORT = "3104"
$env:TRACKMASTER_HOST = "127.0.0.1"
$env:TRACKMASTER_DATA_DIR = ".\data-windows-readiness"
$env:TRACKMASTER_REPOSITORY_BACKEND = "sqlite"
$env:TRACKMASTER_JWT_SECRET = "trackmaster-windows-readiness-local-secret"
$env:TRACKMASTER_JWT_EXPIRES_IN = "12h"
$env:TRACKMASTER_SESSION_COOKIE = "tm_session_windows_readiness"
$env:TRACKMASTER_SESSION_EXPIRES_IN_SECONDS = "43200"
$env:TRACKMASTER_UPLOAD_LIMIT = "120mb"
$env:CORS_ORIGIN = "http://127.0.0.1:3000"

Write-Host "Starting TrackMaster Windows-readiness API on http://127.0.0.1:3104"
Write-Host "This uses .\data-windows-readiness and is not a production writer."

node server/index.js
