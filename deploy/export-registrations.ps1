param([string] $DataDir = "")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
if (-not $DataDir) { $DataDir = Join-Path $root "data/hosted-studio" }
$env:DATA_DIR = [System.IO.Path]::GetFullPath($DataDir)
& npm run export:registrations
if ($LASTEXITCODE -ne 0) { throw "CSV export failed." }
