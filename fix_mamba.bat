@echo off
echo [STATUS] Starting Mamba Repair & Install Sequence...

:: 1. Setup Directory
if not exist "models" mkdir models

:: 2. Download from Verified Source (Bartowski Q4_K_M - Stable)
:: We rename it to 'mamba.gguf' to avoid filename typo issues
echo.
echo [STEP 1] Downloading Mamba 2.8B GGUF...
echo [INFO] URL: huggingface.co/bartowski/mamba-2.8b-hf-GGUF
curl -L "https://huggingface.co/bartowski/mamba-2.8b-hf-GGUF/resolve/main/mamba-2.8b-hf-Q4_K_M.gguf?download=true" -o models/mamba.gguf

:: 3. Check File Size (rudimentary check)
for %%I in (models\mamba.gguf) do if %%~zI LSS 1000000 (
    echo [ERROR] The downloaded file is too small (%%~zI bytes). Download failing.
    echo [CHECK] Do you have internet? Is HuggingFace blocked?
    pause
    exit /b
)

:: 4. Create Modelfile dynamically to ensure paths are perfect
echo.
echo [STEP 2] Generating Local Configuration...
(
    echo FROM ./models/mamba.gguf
    echo PARAMETER temperature 0.7
    echo PARAMETER top_k 40
    echo PARAMETER top_p 0.9
    echo SYSTEM """You are Silhouette, a native Mamba AI. Efficient and precise."""
) > Modelfile_Mamba_Fixed

:: 5. Install to Ollama
echo.
echo [STEP 3] Compiling Model into Ollama (Name: mamba_native)...
ollama create mamba_native -f Modelfile_Mamba_Fixed

:: 6. Success
echo.
echo [SUCCESS] Mamba is alive.
echo [ACTION] Please runs: ollama run mamba_native
pause
