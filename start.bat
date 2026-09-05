@echo off
setlocal
title TurboConvert - Fastest MOV to MP4 Converter
color 0B

echo ===============================================================================
echo       TurboConvert - Ultra-Fast Video and Audio Converter
echo       Fastest MOV to MP4 Engine (Instant Lossless Remuxing)
echo ===============================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js is not found in your system PATH!
    echo Please install Node.js from https://nodejs.org/ and try again.
    echo.
    pause
    exit /b 1
)

where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
    color 0E
    echo [WARNING] ffmpeg.exe was not detected in system PATH.
    echo Make sure FFmpeg is installed for video and audio conversions to work.
    echo.
)

if not exist node_modules (
    echo [INFO] First-time setup: Installing required dependencies
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo [SUCCESS] Dependencies installed successfully!
    echo.
)

echo [INFO] Starting TurboConvert Server on http://localhost:3000
echo.
echo Press Ctrl+C in this window at any time to stop the server.
echo.

start "" "http://localhost:3000"

node server.js

if %errorlevel% neq 0 (
    echo.
    color 0C
    echo [ERROR] Server stopped with an error code %errorlevel%.
    pause
)
