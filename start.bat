@echo off
chcp 65001 >nul
title 50音学堂
echo 正在启动 50音学堂 ...
start "" node server.js
timeout /t 1 /nobreak >nul
start "" http://localhost:3000
