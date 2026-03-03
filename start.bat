@echo off
chcp 65001 >nul 2>&1
title QQ Farm Bot - Web GUI
echo =============================
echo   QQ Farm Bot - Web GUI
echo =============================
echo.

:: Check if node is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] Node.js not found, please install Node.js first
    echo Download: https://nodejs.org/
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist node_modules (
    echo [Setup] Installing dependencies...
    npm install
    echo.
)

echo [Start] Opening http://localhost:3000 ...
echo.

:: Open browser after 2 seconds
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

:: Start GUI server
node gui.js
pause
