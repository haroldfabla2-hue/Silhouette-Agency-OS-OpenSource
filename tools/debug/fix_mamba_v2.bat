@echo off
echo [STATUS] Starting Mamba Repair V2...

:: 1. Verify Download
if exist "models\mamba.gguf" (
    echo [CHECK] Model file found! Skipping download.
) else (
    echo [ERROR] Model file missing. Please run the previous script or download manually.
    pause
    exit /b
)

:: 2. Create Modelfile (Robust Syntax)
echo.
echo [STEP 2] Generating Local Configuration...
(
    echo FROM ./models/mamba.gguf
    echo PARAMETER temperature 0.7
    echo PARAMETER top_k 40
    echo PARAMETER top_p 0.9
    echo SYSTEM """You are Silhouette, a native Mamba AI."""
) > Modelfile_Mamba_Fixed

:: 3. Install to Ollama
echo.
echo [STEP 3] Compiling Model into Ollama...
ollama create mamba_native -f Modelfile_Mamba_Fixed

:: 4. Success
echo.
echo [SUCCESS] Installation Complete.
echo [ACTION] Try running: ollama run mamba_native
pause
