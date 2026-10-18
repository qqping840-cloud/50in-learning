@echo off
chcp 65001 >nul
title Kana Studio
echo Starting Kana Studio ...
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install: https://nodejs.org
  pause
  exit /b 1
)
start "KanaStudioSrv" /min cmd /c "node server.js"
for /f %%P in ('node -p "require('./config.json').port || 3000"') do set "KANA_PORT=%%P"
set /a KANA_TRIES=0
:wait_for_server
powershell -NoProfile -Command "$r = try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%KANA_PORT%/api/config' -TimeoutSec 1 } catch { $null }; if ($r -and $r.StatusCode -eq 200) { exit 0 } else { exit 1 }"
if not errorlevel 1 goto server_ready
set /a KANA_TRIES+=1
if %KANA_TRIES% GEQ 40 goto server_failed
timeout /t 1 /nobreak >nul
goto wait_for_server
:server_ready
start "" http://localhost:%KANA_PORT%
exit /b 0
:server_failed
echo [ERROR] Kana Studio server did not become ready on port %KANA_PORT%.
pause
exit /b 1
