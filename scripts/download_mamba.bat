@echo off
echo [SETUP] Switching to models directory to avoid path space issues...
cd /d "d:\Proyectos personales\Silhouette Agency OS - LLM\models"

echo [SETUP] Downloading Mamba 2.8B GGUF (1.7GB)...
echo [NOTE] This might take a few minutes depending on your internet.
curl -L "https://huggingface.co/devingulliver/mamba-gguf/resolve/main/mamba-2.8b-slimpj.Q4_K_M.gguf?download=true" -o mamba-2.8b-slimpj.Q4_K_M.gguf

echo.
echo [SETUP] Download checks:
if exist "mamba-2.8b-slimpj.Q4_K_M.gguf" (
    echo [SUCCESS] Model file found.
    echo.
    echo [NEXT STEP] Run this command in your terminal manually:
    echo ollama create mamba-2.8b -f Modelfile_Mamba
) else (
    echo [ERROR] Model file download failed.
)
pause
