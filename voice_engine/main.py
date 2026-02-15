from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import os
import uvicorn
from tts_engine import tts_engine

app = FastAPI(title="Silhouette Voice Engine", version="1.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize output directory
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "voice")
os.makedirs(OUTPUT_DIR, exist_ok=True)

class SpeakRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    language: Optional[str] = "es"
    auto_speak: Optional[bool] = False  # If True, keep model loaded with idle timer

@app.get("/")
def health_check():
    return {"status": "online", "service": "voice_engine"}

@app.get("/status")
def get_status():
    return tts_engine.get_status()

@app.get("/voices")
def list_voices():
    # 1. Get default model speakers
    default_speakers = tts_engine.list_speakers()
    
    # 2. Get custom cloned voices (uploaded .wav files)
    custom_voices = []
    voices_dir = os.path.join(OUTPUT_DIR, "voices")
    os.makedirs(voices_dir, exist_ok=True)
    
    for file in os.listdir(voices_dir):
        if file.endswith(".wav"):
            voice_id = file
            custom_voices.append(voice_id)
            
    return {
        "default_models": default_speakers,
        "cloned_voices": custom_voices
    }

from fastapi import UploadFile, File

@app.post("/voices/clone")
async def clone_voice(file: UploadFile = File(...), name: str = Body(...)):
    """Upload a WAV file for voice cloning"""
    try:
        voices_dir = os.path.join(OUTPUT_DIR, "voices")
        os.makedirs(voices_dir, exist_ok=True)
        
        # Sanitize name
        safe_name = "".join([c for c in name if c.isalnum() or c in (' ', '-', '_')]).strip()
        filename = f"{safe_name}.wav"
        file_path = os.path.join(voices_dir, filename)
        
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
            
        return {"success": True, "voice_id": filename, "path": f"/uploads/voice/voices/{filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/speak")
def speak(request: SpeakRequest):
    """Generate audio from text with intelligent sleep/wake based on auto_speak mode"""
    # Simple validation
    if not request.text or len(request.text.strip()) == 0:
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    # Generate unique filename based on hash + voice + lang
    import hashlib
    hash_payload = f"{request.text}{request.voice_id}{request.language}"
    file_hash = hashlib.md5(hash_payload.encode()).hexdigest()
    filename = f"tts_{file_hash}.wav"
    output_path = os.path.join(OUTPUT_DIR, filename)
    
    # Check cache first (if file exists)
    if os.path.exists(output_path):
        # Even for cached, update activity if auto_speak
        if request.auto_speak:
            tts_engine.update_activity()
        return {
            "success": True, 
            "url": f"/uploads/voice/{filename}",
            "cached": True
        }
    
    # Resolve Speaker Path for Cloning
    speaker_wav = None
    if request.voice_id:
        # Standardized Search Order:
        # 1. Cloned (User generated) - Primary
        # 2. Library (Downloaded) - Secondary
        # 3. Voices (Legacy/Default) - Fallback
        search_dirs = [
            os.path.join(OUTPUT_DIR, "cloned"),
            os.path.join(OUTPUT_DIR, "library"),
            os.path.join(OUTPUT_DIR, "voices")
        ]
        
        candidates = []
        for d in search_dirs:
            # Try exact match first, then .wav extension
            candidates.append(os.path.join(d, request.voice_id))
            candidates.append(os.path.join(d, f"{request.voice_id}.wav"))
        
        for candidate in candidates:
            if os.path.exists(candidate) and os.path.isfile(candidate):
                speaker_wav = candidate
                print(f"🎤 Resolved Voice ID '{request.voice_id}' to: {speaker_wav}")
                break
        
        if not speaker_wav:
             print(f"⚠️ Voice ID '{request.voice_id}' not found in standardized paths: {search_dirs}")
    
    success = tts_engine.speak(
        text=request.text, 
        output_path=output_path,
        language=request.language,
        speaker_wav=speaker_wav
    )
    
    if not success:
        raise HTTPException(status_code=500, detail="Speech generation failed")
    
    # INTELLIGENT SLEEP/WAKE LOGIC
    if request.auto_speak:
        # Auto-speak mode: Keep model loaded, start idle timer
        tts_engine.update_activity()
        tts_engine.start_idle_timer()
        print("[SPEAK] 🔊 auto_speak=TRUE - Model kept loaded, idle timer active")
    else:
        # On-demand mode: Immediately unload to free VRAM
        print("[SPEAK] 💤 auto_speak=FALSE - Unloading model immediately")
        tts_engine.unload_model()

    return {
        "success": True,
        "url": f"/uploads/voice/{filename}",
        "cached": False
    }

@app.post("/sleep")
def sleep_engine():
    """Put the TTS engine to sleep (free GPU VRAM) - Called by resourceManager for training/video"""
    tts_engine.stop_idle_timer()  # Stop timer if running (integrates with resourceManager)
    tts_engine.unload_model()
    return {"success": True, "message": "Engine sleeping, VRAM freed"}

@app.post("/wake")
def wake_engine():
    """Wake up the TTS engine (load model to GPU)"""
    result = tts_engine.load_model()
    return {"success": result, "message": "Engine awake" if result else "Failed to wake"}

@app.get("/health")
def health_status():
    """Get detailed engine health status"""
    return {
        "status": "ONLINE" if tts_engine.is_loaded else "SLEEPING",
        **tts_engine.get_status()
    }

# --- Audio Preprocessing Integration ---
try:
    from audio_preprocessor import create_preprocessing_endpoint, AudioQualityAnalyzer, preprocess_for_cloning
    audio_router = create_preprocessing_endpoint()
    app.include_router(audio_router)
    print("✅ Audio preprocessing endpoints enabled")
except ImportError as e:
    print(f"⚠️ Audio preprocessing not available: {e}")
except Exception as e:
    print(f"⚠️ Failed to load audio preprocessing: {e}")

# Additional preprocessing endpoint using shared code
@app.post("/preprocess-for-cloning")
async def preprocess_voice(file: UploadFile = File(...), name: str = Body(default="processed")):
    """Preprocess audio specifically for voice cloning with Chatterbox"""
    try:
        import tempfile
        import shutil
        
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
        
        # Process for cloning
        result = preprocess_for_cloning(tmp_path, output_name=name)
        
        # Cleanup temp file
        os.unlink(tmp_path)
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    print("🎤 Starting Silhouette Voice Engine on port 8100...")
    uvicorn.run(app, host="0.0.0.0", port=8100)

