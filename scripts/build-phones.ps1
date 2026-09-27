# Builds a real install for Samsung (APK) and iPhone (TestFlight IPA).
# Requires an Expo account: npx eas-cli login
# iPhone also needs an Apple Developer account ($99/year) the first time credentials are created.
param(
  [ValidateSet("android", "ios", "all")]
  [string]$Platform = "all",
  [ValidateSet("preview", "production")]
  [string]$Profile = "preview"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# Local .env points the app at localhost. Cloud builds must use eas.json instead.
Remove-Item Env:EXPO_PUBLIC_API_URL -ErrorAction SilentlyContinue
Remove-Item Env:EXPO_PUBLIC_EAS_PROJECT_ID -ErrorAction SilentlyContinue
Remove-Item Env:EXPO_PUBLIC_WEB_URL -ErrorAction SilentlyContinue

Write-Host "Checking Expo login..."
npx eas-cli whoami
if ($LASTEXITCODE -ne 0) {
  Write-Host "Not logged in. Run: npx eas-cli login"
  exit 1
}

if (-not (Test-Path ".\assets\icon.png") -or ((Get-Item ".\assets\icon.png").Length -lt 10000)) {
  Write-Host "assets/icon.png is missing or still a placeholder. Refusing to build."
  exit 1
}

Write-Host "Building $Platform with profile $Profile (non-interactive)."
npx eas-cli build --platform $Platform --profile $Profile --non-interactive
exit $LASTEXITCODE
