$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgumentList
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($ArgumentList -join ' ') failed with exit code $LASTEXITCODE"
  }
}

Invoke-NativeChecked -FilePath node -ArgumentList @("--check", "server/index.js")
Invoke-NativeChecked -FilePath npm -ArgumentList @("--prefix", "trackmaster-api", "run", "check")
Invoke-NativeChecked -FilePath node -ArgumentList @("-e", "const cfg=require('./ecosystem.windows-readiness.config.cjs'); const app=cfg.apps && cfg.apps[0]; if(!app) throw new Error('missing PM2 app'); if(app.name!=='trackmaster-windows-readiness-api') throw new Error('unexpected PM2 app name'); if(app.env.TRACKMASTER_HOST!=='127.0.0.1') throw new Error('Windows readiness PM2 must bind to localhost'); if(app.env.TRACKMASTER_REPOSITORY_BACKEND!=='sqlite') throw new Error('Windows readiness PM2 must stay on sqlite'); console.log('PM2 windows-readiness config OK');")
Invoke-NativeChecked -FilePath npm -ArgumentList @("run", "build")
