"""
Download a default voice sample for XTTS v2
Run this script once to get a sample voice that can be used for TTS synthesis
"""

import os
import urllib.request
import sys

# Directory for voice samples
VOICES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "voice", "voices")
os.makedirs(VOICES_DIR, exist_ok=True)

# Default sample - A high quality Spanish speaker sample from Mozilla Common Voice
# This is a 10-second sample suitable for XTTS voice cloning
SAMPLE_URL = "https://huggingface.co/coqui/XTTS-v2/resolve/main/samples/en_sample.wav"
SAMPLE_PATH = os.path.join(VOICES_DIR, "default_speaker.wav")

def download_sample():
    if os.path.exists(SAMPLE_PATH):
        print(f"[SETUP] Default voice sample already exists at {SAMPLE_PATH}")
        return True
    
    print(f"[SETUP] Downloading default voice sample...")
    print(f"[SETUP] URL: {SAMPLE_URL}")
    print(f"[SETUP] Destination: {SAMPLE_PATH}")
    
    try:
        urllib.request.urlretrieve(SAMPLE_URL, SAMPLE_PATH)
        print(f"[SETUP] ✅ Downloaded successfully!")
        return True
    except Exception as e:
        print(f"[SETUP] ❌ Failed to download: {e}")
        return False

if __name__ == "__main__":
    success = download_sample()
    sys.exit(0 if success else 1)
