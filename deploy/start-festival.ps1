<#
.SYNOPSIS
  Starts the festival studio on this Windows laptop with the safe festival settings (Create from clips only).

.DESCRIPTION
  -Mode local   Laptop only (http://localhost:3000). The backup demo; needs no network.
  -Mode lan     Phones on the same Wi-Fi open http://<laptop-ip>:3000. Plain HTTP: phones record with their own
                camera app ("Use phone camera") or upload; in-page camera needs HTTPS.
  -Mode tunnel  Public HTTPS through a Cloudflare quick tunnel (cloudflared, no account). Exposes this laptop's studio
                to anyone with the link, so it requires -ConfirmPublic. Quick tunnels are for small demos: no uptime
                guarantee and the address changes every start.

  In every mode: podcast mode is off, operator screens answer only on this laptop, the local AI model is off,
  and data lives outside the repository. Run `npm run build` first. Stop with Ctrl+C.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\start-festival.ps1 -Mode lan
#>
param(
  [ValidateSet("local", "lan", "tunnel")] [string] $Mode = "local",
  [int] $Port = 3000,
  [string] $DataDir = "D:\zenith-festival-data",
  [switch] $ConfirmPublic
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

foreach ($tool in @("node", "ffmpeg", "ffprobe")) { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH." } }
if (-not (Test-Path (Join-Path $root ".next-production\BUILD_ID"))) { throw "No production build found. Run: npm run build" }
New-Item -ItemType Directory -Force $DataDir | Out-Null

# The operator secret is generated once and kept with the data, never in the repository or on screen.
$secretFile = Join-Path $DataDir "operator-secret.txt"
if (-not $env:OPERATOR_SECRET) {
  if (-not (Test-Path $secretFile)) {
    $bytes = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [System.IO.File]::WriteAllText($secretFile, (($bytes | ForEach-Object { $_.ToString("x2") }) -join ""))
  }
  $env:OPERATOR_SECRET = ([System.IO.File]::ReadAllText($secretFile)).Trim()
}

$env:NODE_ENV = "production"
$env:PORT = "$Port"
$env:DATA_DIR = $DataDir
$env:PODCAST_MODE = "off"
$env:OPERATOR_LOCAL_ONLY = "true"
$env:CREATIVE_MODEL_PROVIDER = "off"
# Measured on this laptop (npm run verify:concurrency 8): two render slots finish a rush sooner, peak about 0.85 GB.
if (-not $env:MAX_CONCURRENT_RENDERS) { $env:MAX_CONCURRENT_RENDERS = "2" }
Remove-Item Env:TRUST_PROXY -ErrorAction SilentlyContinue

$tunnel = $null
switch ($Mode) {
  "local" {
    $env:HOSTNAME = "127.0.0.1"; $env:COOKIE_SECURE = "false"; $env:PUBLIC_BASE_URL = "http://localhost:$Port"
  }
  "lan" {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi*" -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1).IPAddress
    if (-not $ip) { throw "No Wi-Fi IPv4 address found. Connect to the stall network first." }
    $env:HOSTNAME = "0.0.0.0"; $env:COOKIE_SECURE = "false"; $env:PUBLIC_BASE_URL = "http://${ip}:$Port"
    Write-Host "Windows may ask to allow Node.js on private networks; allow it only for the stall's own network." -ForegroundColor Yellow
  }
  "tunnel" {
    if (-not $ConfirmPublic) { throw "Tunnel mode publishes this studio on the internet. Re-run with -ConfirmPublic once that is authorised." }
    if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { throw "cloudflared is not installed." }
    $log = Join-Path $DataDir "cloudflared.log"; Remove-Item $log -ErrorAction SilentlyContinue
    # The tunnel reaches only the studio's port on loopback; nothing else on this laptop is published.
    $tunnel = Start-Process cloudflared -ArgumentList @("tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$Port", "--logfile", $log) -PassThru -WindowStyle Hidden
    $url = $null
    for ($i = 0; $i -lt 60 -and -not $url; $i++) {
      Start-Sleep -Seconds 1
      if (Test-Path $log) { $match = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1; if ($match) { $url = $match.Matches[0].Value } }
    }
    if (-not $url) { Stop-Process -Id $tunnel.Id -ErrorAction SilentlyContinue; throw "The tunnel did not report an address. See $log" }
    $env:HOSTNAME = "127.0.0.1"; $env:COOKIE_SECURE = "true"; $env:PUBLIC_BASE_URL = $url; $env:TRUST_PROXY = "cloudflare"
  }
}

Write-Host ""
Write-Host "Visitors:  $($env:PUBLIC_BASE_URL)/festival" -ForegroundColor Green
Write-Host "Operator:  http://localhost:$Port/operator   (this laptop only; secret in $secretFile)"
Write-Host "Display:   http://localhost:$Port/display"
Write-Host "Podcast to reels is off for the festival. Stop with Ctrl+C."
Write-Host ""
try { & node scripts/serve.mjs }
finally { if ($tunnel) { Stop-Process -Id $tunnel.Id -ErrorAction SilentlyContinue } }
