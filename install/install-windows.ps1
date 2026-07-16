# Lantern - Windows launcher.
# Right-click this file and choose "Run with PowerShell", or run:  powershell -File install-windows.ps1
$ErrorActionPreference = "Stop"
$Dir = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "  Lantern needs Node.js (a free tool that runs it)."
  Write-Host "  1. Go to https://nodejs.org"
  Write-Host "  2. Download the LTS version and install it."
  Write-Host "  3. Run this file again."
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 18) {
  Write-Host "  Your Node.js is too old. Update it at https://nodejs.org, then try again."
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host "  Starting Lantern... your browser will open."
node "$Dir\bin\lantern.js"
