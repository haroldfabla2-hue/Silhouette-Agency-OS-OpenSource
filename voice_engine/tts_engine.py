"""
Chatterbox Multilingual TTS Engine Wrapper
GPU-accelerated voice cloning with lazy loading and sleep/wake support
Migrated from Coqui XTTS v2 for better performance and lower VRAM usage
"""

import torch
import torchaudio as ta
from typing import Optional
import os
import time

class TTSEngine:
    def __init__(self):
        self.tts = None
        self.model_name = "ChatterboxMultilingual"
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.is_loaded = False
        self.default_speaker_wav = None  # Reference audio for voice cloning
        self.default_language = "es"  # Spanish default
        self.sr = 24000  # Chatterbox sample rate
        
        # Idle timer for intelligent sleep/wake
        self.last_activity_time: float = 0
        self.idle_timeout_seconds: int = 300  # 5 minutes default
        self._idle_timer_running = False
        
        print(f"[TTS_ENGINE] Initialized. Device: {self.device}")
        print(f"[TTS_ENGINE] Model: {self.model_name}")
        print(f"[TTS_ENGINE] CUDA Available: {torch.cuda.is_available()}")
        print(f"[TTS_ENGINE] Idle Timeout: {self.idle_timeout_seconds}s")
        if torch.cuda.is_available():
            print(f"[TTS_ENGINE] GPU: {torch.cuda.get_device_name(0)}")
            print(f"[TTS_ENGINE] VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
    
    def load_model(self):
        """Lazy load the Chatterbox Multilingual model to GPU"""
        if self.is_loaded:
            print("[TTS_ENGINE] Model already loaded")
            return True
            
        print(f"[TTS_ENGINE] 🔄 Loading Chatterbox Multilingual to {self.device}...")
        start = time.time()
        
        try:
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
            
            self.tts = ChatterboxMultilingualTTS.from_pretrained(device=self.device)
            self.sr = self.tts.sr  # Get actual sample rate from model
            self.is_loaded = True
            
            elapsed = time.time() - start
            print(f"[TTS_ENGINE] ✅ Model loaded in {elapsed:.1f}s")
            
            if torch.cuda.is_available():
                allocated = torch.cuda.memory_allocated() / 1024**3
                print(f"[TTS_ENGINE] 📊 VRAM Used: {allocated:.2f} GB")
            
            return True
        except Exception as e:
            print(f"[TTS_ENGINE] ❌ Failed to load model: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def unload_model(self):
        """Unload model from GPU (sleep mode)"""
        if not self.is_loaded:
            print("[TTS_ENGINE] Model not loaded, nothing to unload")
            return
            
        print("[TTS_ENGINE] 💤 Unloading model from GPU (Sleep Mode)...")
        
        try:
            del self.tts
            self.tts = None
            self.is_loaded = False
            
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
                
            print("[TTS_ENGINE] ✅ Model unloaded. GPU memory freed.")
        except Exception as e:
            print(f"[TTS_ENGINE] ⚠️ Error during unload: {e}")
    
    def speak(self, text: str, output_path: str, language: str = None, speaker_wav: str = None) -> bool:
        """Generate speech from text using Chatterbox Multilingual"""
        if not self.is_loaded:
            print("[TTS_ENGINE] Model not loaded. Loading now...")
            if not self.load_model():
                return False
        
        lang = language or self.default_language
        speaker = speaker_wav or self.default_speaker_wav
        
        # Map common language codes to Chatterbox format
        lang_map = {
            "es": "es", "en": "en", "fr": "fr", "de": "de", 
            "it": "it", "pt": "pt", "ja": "ja", "zh": "zh",
            "ru": "ru", "ar": "ar", "ko": "ko", "nl": "nl",
            "pl": "pl", "tr": "tr", "sv": "sv", "da": "da",
            "fi": "fi", "no": "no", "el": "el", "he": "he",
            "hi": "hi", "ms": "ms", "sw": "sw"
        }
        lang_id = lang_map.get(lang, "en")  # Default to English if unknown
        
        print(f"[TTS_ENGINE] 🗣️ Generating: '{text[:50]}...' (lang={lang_id})")
        start = time.time()
        
        try:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            
            # Generate with Chatterbox Multilingual
            if speaker and os.path.exists(speaker):
                # Voice cloning with reference audio
                print(f"[TTS_ENGINE] Using custom speaker: {speaker}")
                wav = self.tts.generate(
                    text, 
                    audio_prompt_path=speaker,
                    language_id=lang_id
                )
            else:
                # Use default voice (no cloning)
                print(f"[TTS_ENGINE] Using default voice for language: {lang_id}")
                # Try to find a reference audio in uploads
                base_dir = os.path.dirname(os.path.dirname(__file__))
                search_paths = [
                    os.path.join(base_dir, "uploads", "voice", "voices"),
                    os.path.join(base_dir, "uploads", "voice", "cloned"),
                    os.path.join(base_dir, "uploads", "voice", "library")
                ]
                
                fallback_speaker = None
                for path in search_paths:
                    if os.path.exists(path):
                        files = [os.path.join(path, f) for f in os.listdir(path) 
                                if f.endswith(".wav") and os.path.getsize(os.path.join(path, f)) > 15000]
                        if files:
                            fallback_speaker = files[0]
                            print(f"[TTS_ENGINE] ✅ Found fallback speaker: {os.path.basename(fallback_speaker)}")
                            break
                
                if fallback_speaker:
                    wav = self.tts.generate(
                        text,
                        audio_prompt_path=fallback_speaker,
                        language_id=lang_id
                    )
                else:
                    # Generate without voice cloning (uses model's default)
                    wav = self.tts.generate(text, language_id=lang_id)
            
            # Save the audio
            ta.save(output_path, wav, self.sr)
            
            elapsed = time.time() - start
            print(f"[TTS_ENGINE] ✅ Generated in {elapsed:.2f}s → {output_path}")
            return True
            
        except Exception as e:
            import traceback
            print(f"[TTS_ENGINE] ❌ Generation failed: {e}")
            print(f"[TTS_ENGINE] Traceback: {traceback.format_exc()}")
            return False
    
    def get_status(self) -> dict:
        """Get engine status"""
        status = {
            "loaded": self.is_loaded,
            "device": self.device,
            "model": self.model_name if self.is_loaded else None,
            "sample_rate": self.sr
        }
        
        if torch.cuda.is_available():
            status["gpu_name"] = torch.cuda.get_device_name(0)
            status["vram_total_gb"] = torch.cuda.get_device_properties(0).total_memory / 1024**3
            status["vram_used_gb"] = torch.cuda.memory_allocated() / 1024**3
            status["vram_free_gb"] = status["vram_total_gb"] - status["vram_used_gb"]
        
        return status
    
    def list_speakers(self) -> list:
        """List available speakers - Chatterbox uses reference audio, not pre-defined speakers"""
        # Scan for available voice files in the voices directory
        base_dir = os.path.dirname(os.path.dirname(__file__))
        voices_dir = os.path.join(base_dir, "uploads", "voice", "voices")
        
        speakers = []
        if os.path.exists(voices_dir):
            for f in os.listdir(voices_dir):
                if f.endswith(".wav"):
                    speakers.append(f.replace(".wav", ""))
        
        return speakers

    def update_activity(self):
        """Update last activity timestamp"""
        self.last_activity_time = time.time()
    
    def check_and_unload_if_idle(self) -> bool:
        """Check if idle timeout has been reached and unload if so"""
        if not self.is_loaded:
            return False
        
        if self.last_activity_time == 0:
            return False
            
        idle_time = time.time() - self.last_activity_time
        if idle_time >= self.idle_timeout_seconds:
            print(f"[TTS_ENGINE] ⏰ Idle timeout reached ({idle_time:.0f}s). Unloading model...")
            self.unload_model()
            return True
        return False
    
    def start_idle_timer(self):
        """Start background thread that checks for idle timeout"""
        if self._idle_timer_running:
            return
        
        import threading
        
        def idle_checker():
            self._idle_timer_running = True
            while self._idle_timer_running and self.is_loaded:
                time.sleep(30)  # Check every 30 seconds
                if self.is_loaded:
                    self.check_and_unload_if_idle()
            self._idle_timer_running = False
        
        thread = threading.Thread(target=idle_checker, daemon=True)
        thread.start()
        print("[TTS_ENGINE] ⏱️ Idle timer started")
    
    def stop_idle_timer(self):
        """Stop the idle timer"""
        self._idle_timer_running = False

# Singleton instance
tts_engine = TTSEngine()

