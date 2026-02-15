@echo off
REM ============================================
REM SILHOUETTE - Startup Script
REM ============================================
REM Activates virtual environment and starts the inference API
REM Similar to voice_engine startup pattern

echo [SILHOUETTE] Starting Silhouette Inference API...

cd /d "%~dp0"

REM Check if virtual environment exists
if not exist ".venv\Scripts\activate.bat" (
    echo [SILHOUETTE] Virtual environment not found. Creating...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    echo [SILHOUETTE] Installing dependencies...
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

REM Set environment variables
set SILHOUETTE_PORT=8102

REM Start the API
echo [SILHOUETTE] Starting API on port %SILHOUETTE_PORT%...
python -m src.inference.api

echo [SILHOUETTE] API stopped.
pause
