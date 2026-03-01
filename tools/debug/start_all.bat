@echo off
title Silhouette Launcher
echo ===================================================
echo   SILHOUETTE AGENCY OS - SYSTEM LAUNCHER
echo ===================================================
echo.

:: ===================================================
:: ARCHITECTURE:
:: 1. Infrastructure (Docker) - Redis, Neo4j, Qdrant
:: 2. Main Server (Node.js) - npm run server via Janus
:: 3. Voice Engine (Python) - Chatterbox Multilingual TTS on port 8100
:: 4. Visual Cortex (ComfyUI) - Optional, on port 8188
:: 5. Frontend (Vite) - React UI on port 5173
:: ===================================================

echo [1/5] Checking Infrastructure (Docker)...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] WARNING: Docker is not running by default!
    echo     Please start Docker Desktop manually.
    echo     Databases [Redis, Neo4j, Qdrant] may be unavailable.
    timeout /t 5
) else (
    echo     Docker is online. Spinning up containers...
    docker-compose up -d redis qdrant neo4j
    echo     Waiting for databases to initialize...
    timeout /t 5 /nobreak >nul
)

echo [2/5] Starting Main Server (Janus Supervisor)...
start "Silhouette Main Server" cmd /k "node --env-file=.env.local --import tsx/esm scripts/janus.js"
timeout /t 3 /nobreak >nul

echo [3/5] Starting Voice Engine (Chatterbox Multilingual)...
if exist "C:\Users\usuario\miniconda3\Scripts\activate.bat" (
    echo      Found Miniconda. Activating 'silhouette-tts'...
    start "Silhouette Voice Engine" cmd /k "call C:\Users\usuario\miniconda3\Scripts\activate.bat silhouette-tts && cd voice_engine && uvicorn main:app --port 8100 --reload"
) else if exist "voice_engine\venv\Scripts\activate.bat" (
    echo      Found local venv. Activating...
    start "Silhouette Voice Engine" cmd /k "cd voice_engine && venv\Scripts\activate && uvicorn main:app --port 8100 --reload"
) else (
    echo [!] Voice Engine environment not found. Skipping.
)

echo [4/5] Starting Visual Cortex (ComfyUI)...
if exist "ComfyUI\run_nvidia_gpu.bat" (
    start "Visual Cortex" /min cmd /c "cd ComfyUI && run_nvidia_gpu.bat"
) else (
    echo [!] ComfyUI not found. Skipping Visual Cortex.
)

echo [5/5] Starting Frontend Interface (Vite)...
timeout /t 2 /nobreak >nul
start "Silhouette UI" cmd /k "npm run dev"

echo.
echo ===================================================
echo   All systems launching...
echo   - Main Server: http://localhost:3005
echo   - Voice Engine: http://localhost:8100
echo   - Visual Cortex: http://localhost:8188
echo   - Frontend: http://localhost:5173
echo   - Databases: Neo4j, Redis, Qdrant (Docker)
echo ===================================================
echo.
pause
