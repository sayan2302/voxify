@echo off
cd /d "%~dp0"
echo Cleaning up previous instances...
taskkill /F /IM voxify.exe >nul 2>&1
taskkill /F /IM vocalis-studio.exe >nul 2>&1
timeout /t 1 /nobreak >nul
echo Starting Voxify (Native Windows AI Reader)...
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
npm run tauri dev
