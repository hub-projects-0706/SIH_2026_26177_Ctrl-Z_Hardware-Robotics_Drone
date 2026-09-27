@echo off
echo ==============================================================================
echo       AEROSIGHT - AI Autonomous Search and Rescue Drone System Launcher       
echo ==============================================================================

echo [1/3] Starting Command Web Dashboard (Node.js Express + WebSocket)...
start "AEROSIGHT Dashboard" cmd /k "cd /d "%~dp0web dashboard" && node server.js"

timeout /t 2 /nobreak >nul

echo [2/3] Verifying Dashboard Availability...
powershell -Command "try { $res = Invoke-WebRequest -Uri 'http://localhost:3000/api/telemetry' -TimeoutSec 3; Write-Host 'Dashboard is ONLINE!' -ForegroundColor Green } catch { Write-Host 'Dashboard starting up...' -ForegroundColor Yellow }"

echo [3/3] Starting Python Edge System with RT-DETR-L Trained ML Model...
if exist "C:\Users\ruthr\AppData\Local\Programs\Python\Python314\python.exe" (
    "C:\Users\ruthr\AppData\Local\Programs\Python\Python314\python.exe" "%~dp0rescue_drone\main.py"
) else (
    python "%~dp0rescue_drone\main.py"
)

pause
