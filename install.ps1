# ==============================================================================
# Voxify 1-Command Windows Installer
# Run in PowerShell:
# irm https://raw.githubusercontent.com/sayan2302/voxify/main/install.ps1 | iex
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ========================================================" -ForegroundColor Cyan
Write-Host "     Voxify - Local AI Document Reader & Audio Pill       " -ForegroundColor Cyan
Write-Host "  ========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Architecture Check
if ([IntPtr]::Size -ne 8) {
    Write-Host "[x] Voxify requires 64-bit Windows. Installation aborted." -ForegroundColor Red
    exit 1
}

# 2. Check WebView2 Runtime
$wv2Installed = $false
try {
    $wv2Key = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    if (Test-Path $wv2Key) { $wv2Installed = $true }
} catch {}

if (-not $wv2Installed) {
    try {
        $wv2UserKey = "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
        if (Test-Path $wv2UserKey) { $wv2Installed = $true }
    } catch {}
}

if (-not $wv2Installed) {
    Write-Host "[-] Microsoft Edge WebView2 not found. Installing prerequisite..." -ForegroundColor Yellow
    $wv2Bootstrapper = "$env:TEMP\MicrosoftEdgeWebview2Setup.exe"
    try {
        Invoke-WebRequest -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $wv2Bootstrapper
        Start-Process -FilePath $wv2Bootstrapper -ArgumentList "/silent /install" -Wait
        Remove-Item -Path $wv2Bootstrapper -Force -ErrorAction SilentlyContinue
        Write-Host "[+] WebView2 runtime installed." -ForegroundColor Green
    } catch {
        Write-Host "[!] Note: Please ensure WebView2 is installed for UI rendering." -ForegroundColor Yellow
    }
}

# 3. Fetch Latest Release Information from GitHub
$repo = "sayan2302/voxify"
$releasesUrl = "https://api.github.com/repos/$repo/releases/latest"

Write-Host "[-] Connecting to GitHub ($repo)..." -ForegroundColor Gray
try {
    $release = Invoke-RestMethod -Uri $releasesUrl -Headers @{ "User-Agent" = "VoxifyInstaller" }
} catch {
    Write-Host "[x] Failed to reach GitHub Releases ($releasesUrl)." -ForegroundColor Red
    Write-Host "    Please ensure your internet connection is active and the repository is public." -ForegroundColor Red
    exit 1
}

$version = $release.tag_name
Write-Host "[+] Found Voxify release: $version" -ForegroundColor Green

# Find the setup.exe asset
$asset = $release.assets | Where-Object { $_.name -like "*setup.exe" -or $_.name -like "*.exe" } | Select-Object -First 1

if (-not $asset) {
    Write-Host "[x] No executable installer found in release $version." -ForegroundColor Red
    exit 1
}

$downloadUrl = $asset.browser_download_url
$sizeMb = [math]::Round($asset.size / 1MB, 1)
$tempInstaller = "$env:TEMP\$($asset.name)"

Write-Host "[-] Downloading Voxify ($sizeMb MB)..." -ForegroundColor Cyan

# Download with status
$webClient = New-Object System.Net.WebClient
try {
    $webClient.DownloadFile($downloadUrl, $tempInstaller)
    Write-Host "[+] Download complete!" -ForegroundColor Green
} catch {
    Write-Host "[x] Download failed: $_" -ForegroundColor Red
    exit 1
}

# 4. Silent Install
Write-Host "[-] Installing Voxify silently in the background..." -ForegroundColor Cyan
$process = Start-Process -FilePath $tempInstaller -ArgumentList "/S" -Wait -PassThru

# Small delay to let Windows Explorer finalize shortcut indexing
Start-Sleep -Seconds 2

# Cleanup temporary installer file
Remove-Item -Path $tempInstaller -Force -ErrorAction SilentlyContinue

# 5. Verify & Auto-Launch
$installedExe = "$env:LOCALAPPDATA\Programs\Voxify\Voxify.exe"
if (-not (Test-Path $installedExe)) {
    $installedExe = "$env:ProgramFiles\Voxify\Voxify.exe"
}

if (Test-Path $installedExe) {
    Write-Host ""
    Write-Host "  ========================================================" -ForegroundColor Green
    Write-Host "     [+] Voxify installed successfully!                   " -ForegroundColor Green
    Write-Host "     [-] Launching Voxify now...                          " -ForegroundColor Cyan
    Write-Host "  ========================================================" -ForegroundColor Green
    Write-Host ""
    Start-Process -FilePath $installedExe
} else {
    Write-Host ""
    Write-Host "[+] Installation complete! You can open Voxify from your Start Menu." -ForegroundColor Green
}
