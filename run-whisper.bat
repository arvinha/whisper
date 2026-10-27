@echo off
cd /d "%~dp0"
title Whisper online
if not exist node_modules call npm install
if not exist .next\BUILD_ID call npx next build
if not exist data mkdir data
for /f "tokens=5" %%p in ('netstat -ano ^| findstr LISTENING ^| findstr ":4323 "') do taskkill /PID %%p /F >nul 2>&1
start "Whisper server" /min cmd /c "node node_modules\next\dist\bin\next start -p 4323 >> data\server.log 2>&1"
