@echo off
echo 🔧 Installing missing dependencies for AnimateDiff...
"ComfyUI\python_embeded\python.exe" -m pip install einops pandas "imageio[ffmpeg]"
echo.
echo ✅ Installation complete!
pause
