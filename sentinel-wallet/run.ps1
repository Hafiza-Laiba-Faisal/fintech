# Sentinel Wallet — Helper Script
# Run this script to install and test without PATH issues.
# Usage: powershell -ExecutionPolicy Bypass -File run.ps1

$ErrorActionPreference = "Stop"

# Fix PATH for this session
$machinePath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
$userPath    = [System.Environment]::GetEnvironmentVariable("PATH", "User")
$env:PATH    = "$machinePath;$userPath"

# Find npm.cmd
$npmCmd = "C:\Program Files\nodejs\npm.cmd"
if (-not (Test-Path $npmCmd)) {
    $npmFound = Get-Command npm -ErrorAction SilentlyContinue
    if ($npmFound) { $npmCmd = $npmFound.Source }
    else {
        Write-Error "npm not found. Install Node.js from https://nodejs.org"
        exit 1
    }
}

$nodeExe = "C:\Program Files\nodejs\node.exe"

Write-Host "`nNode.js: $(& $nodeExe --version)"
Write-Host "npm:     $(& $npmCmd --version)"
Write-Host "Dir:     $(Get-Location)`n"

$action = if ($args.Count -gt 0) { $args[0] } else { "test" }

switch ($action) {
    "install" {
        Write-Host "==> Installing dependencies..." -ForegroundColor Cyan
        & $npmCmd install
    }
    "test" {
        Write-Host "==> Installing dependencies..." -ForegroundColor Cyan
        & $npmCmd install
        Write-Host "`n==> Running tests..." -ForegroundColor Cyan
        & $npmCmd test
    }
    "demo" {
        Write-Host "==> Installing dependencies..." -ForegroundColor Cyan
        & $npmCmd install
        Write-Host "`n==> Running mock demo..." -ForegroundColor Cyan
        & $npmCmd run demo:mock
    }
    "live" {
        Write-Host "==> Installing dependencies..." -ForegroundColor Cyan
        & $npmCmd install
        Write-Host "`n==> Running LIVE testnet demo..." -ForegroundColor Yellow
        & $npmCmd run demo
    }
    default {
        Write-Host "Usage: powershell -ExecutionPolicy Bypass -File run.ps1 [install|test|demo|live]"
    }
}
