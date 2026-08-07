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
ping -n 3 127.0.0.1 >nul
start "" http://localhost:3000
exit /b 0