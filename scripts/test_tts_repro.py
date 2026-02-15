import os
import torch
from TTS.api import TTS

# Define paths
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
voice_file = os.path.join(base_dir, "uploads", "voice", "cloned", "cloned_1766900677338_qqpodacmz.wav")
output_file = "test_output.wav"

print(f"--- TTS Reproduction Test ---")
print(f"PyTorch Version: {torch.__version__}")
print(f"CUDA Available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA Version: {torch.version.cuda}")
    print(f"Device: {torch.cuda.get_device_name(0)}")

print(f"\nChecking voice file: {voice_file}")
if not os.path.exists(voice_file):
    print("❌ Voice file not found!")
    exit(1)
else:
    print(f"✅ Voice file found. Size: {os.path.getsize(voice_file)} bytes")

try:
    print("\nLoading TTS Model...")
    # FIX: PyTorch 2.6+ defaults torch.load(weights_only=True) which breaks Coqui XTTS
    original_load = torch.load
    import functools
    torch.load = functools.partial(original_load, weights_only=False)
    print(f"[REPRO] 🛡️ Applied PyTorch 2.6+ compatibility fix")

    # Initialize TTS with the same model used in the app
    device = "cuda" if torch.cuda.is_available() else "cpu"
    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
    
    # Restore original torch.load
    torch.load = original_load
    print(f"[REPRO] 🛡️ Restored original torch.load safety")
    
    print("✅ Model loaded successfully.")
    
    text = "Hello, this is a test of the text to speech system."
    print(f"\nAttempting synthesis with text: '{text}'")
    
    tts.tts_to_file(
        text=text,
        file_path=output_file,
        speaker_wav=voice_file,
        language="en"
    )
    
    print(f"\n✅ Success! Audio saved to {output_file}")

except Exception as e:
    print(f"\n❌ Error occurred: {e}")
    import traceback
    traceback.print_exc()
