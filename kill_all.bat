@echo off
title Silhouette Terminator
echo ===================================================
echo   SILHOUETTE AGENCY OS - SYSTEM SHUTDOWN
echo ===================================================
echo.
echo [1/5] Sending Shutdown Signals...
:: Try to allow graceful shutdown first
taskkill /FI "WINDOWTITLE eq Silhouette Main Server*" 2>nul
taskkill /FI "WINDOWTITLE eq Silhouette UI*" 2>nul
taskkill /FI "WINDOWTITLE eq Silhouette Voice*" 2>nul
taskkill /FI "WINDOWTITLE eq Silhouette Reasoning Model*" 2>nul
taskkill /FI "WINDOWTITLE eq Visual Cortex*" 2>nul

:: Give them 2 seconds to close files/DB connections
timeout /t 2 /nobreak >nul

echo.
echo [2/5] Stopping Infrastructure (Docker)...
echo     This ensures databases save data and release ports.
:: Try docker-compose (V1/Standalone)
docker-compose stop 2>nul
if %errorlevel% neq 0 (
    echo     ...switching to 'docker compose' (V2)...
    docker compose stop 2>nul
)

echo.
echo [3/5] Stopping Python Engines...
:: Cleanup specific DB ports if Docker failed to release them
:: Redis(6499), Qdrant(6444), Neo4j(7787, 7574, 7687), Reasoning(8000)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :6499 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :6444 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :7787 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :7574 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

:: Specifically target python processes
taskkill /F /IM "python.exe" /FI "WINDOWTITLE eq Silhouette*" 2>nul
:: Voice Engine Port (8100)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8100 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

echo.
echo [4/5] Cleaning up Node processes (Frontend/Backend)...
:: Kill Node APIs (3000, 3001, 3005)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3005 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
:: Kill Vite (5173)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

echo.
echo [5/5] Final Cleanup...
:: Force close any stubborn windows
taskkill /F /FI "WINDOWTITLE eq Silhouette Main Server*" /T 2>nul
taskkill /F /FI "WINDOWTITLE eq Silhouette Voice*" /T 2>nul

echo.
echo ===================================================
echo   System Clean. (Databases Stopped, Ports Freed)
echo   Safe to restart via start_all.bat
echo ===================================================
pause
