<#
.SYNOPSIS
  Runs the production studio on this laptop behind a public HTTPS tunnel.
.DESCRIPTION
  Requires npm run build. A new quick tunnel gets a new address: update STUDIO_ORIGIN
  in Vercel Production and redeploy. Keep this process and the laptop online.
  Pass -PublicUrl to reuse an already-running tunnel targeting the same Port.
#>
param(
  [int] $Port = 3200,
  [string] $DataDir = "",
  [string] $PublicUrl = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
foreach ($tool in @("node", "ffmpeg", "ffprobe")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH." }
}
if (-not (Test-Path -LiteralPath (Join-Path $root ".next-production/BUILD_ID"))) { throw "Run npm run build first." }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port is already running. Keep the existing studio, or stop it before restarting." }
if (-not $DataDir) { $DataDir = Join-Path $root "data/hosted-studio" }
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$logDir = Join-Path $root "data/hosting"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$tunnel = $null
try {
  if (-not $PublicUrl) {
    $cloudflared = Get-Command cloudflared -ErrorAction Stop
    $log = Join-Path $logDir ("tunnel-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
    $tunnel = Start-Process -FilePath $cloudflared.Source -ArgumentList @("tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$Port", "--logfile", ('"' + $log + '"')) -PassThru -WindowStyle Hidden
    for ($i = 0; $i -lt 60 -and -not $PublicUrl; $i++) {
      if ($tunnel.HasExited) { throw "Tunnel exited. See $log" }
      Start-Sleep -Seconds 1
      if (Test-Path -LiteralPath $log) {
        $match = Select-String -LiteralPath $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
        if ($match) { $PublicUrl = $match.Matches[0].Value }
      }
    }
    if (-not $PublicUrl) { throw "Tunnel did not report an address. See $log" }
  }
  $uri = [Uri]$PublicUrl
  if ($uri.Scheme -ne "https" -or $uri.UserInfo -or $uri.AbsolutePath -ne "/" -or $uri.Query -or $uri.Fragment) { throw "PublicUrl must be an HTTPS origin." }
  $env:PUBLIC_BASE_URL = $uri.GetLeftPart([UriPartial]::Authority)
  $env:PORT = "$Port"
  $env:HOSTNAME = "127.0.0.1"
  $env:DATA_DIR = [System.IO.Path]::GetFullPath($DataDir)
  $env:COOKIE_SECURE = "true"
  $env:TRUST_PROXY = "cloudflare"
  $env:OPERATOR_LOCAL_ONLY = "true"
  $env:ENABLE_HIGGSFIELD = "false"
  if (-not $env:MAX_CONCURRENT_RENDERS) { $env:MAX_CONCURRENT_RENDERS = "2" }
  # This machine is the renderer, never the Vercel gateway.
  Remove-Item Env:VERCEL -ErrorAction SilentlyContinue
  Remove-Item Env:STUDIO_ORIGIN -ErrorAction SilentlyContinue
  $env:PUBLIC_BASE_URL | Set-Content -LiteralPath (Join-Path $logDir "public-url.txt")
  Write-Host "Studio: $($env:PUBLIC_BASE_URL)" -ForegroundColor Green
  Write-Host "Set Vercel Production STUDIO_ORIGIN to this URL and redeploy if it changed."
  Write-Host "Keep this window, the laptop and its internet connection running. Ctrl+C stops the studio."
  & node scripts/serve.mjs
} finally {
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -ErrorAction SilentlyContinue }
}
