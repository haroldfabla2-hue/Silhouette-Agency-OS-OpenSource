"""
Audio Preprocessor for Voice Cloning
Handles noise reduction, normalization, silence trimming, and format conversion
for professional-grade voice cloning with XTTS v2.

Author: Silhouette Agency OS
"""

import os
import numpy as np
import warnings
from pathlib import Path
from typing import Dict, Tuple, Optional, List
import json

# Suppress warnings for cleaner output
warnings.filterwarnings('ignore')

# Audio processing imports
try:
    import librosa
    import soundfile as sf
    LIBROSA_AVAILABLE = True
except ImportError:
    LIBROSA_AVAILABLE = False
    print("[AUDIO_PREPROCESSOR] Warning: librosa not available, some features disabled")

try:
    import noisereduce as nr
    NOISEREDUCE_AVAILABLE = True
except ImportError:
    NOISEREDUCE_AVAILABLE = False
    print("[AUDIO_PREPROCESSOR] Warning: noisereduce not available")

try:
    from pydub import AudioSegment
    from pydub.silence import split_on_silence, detect_silence
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False
    print("[AUDIO_PREPROCESSOR] Warning: pydub not available")


class AudioQualityAnalyzer:
    """Analyzes audio quality for voice cloning suitability."""
    
    # Thresholds for quality assessment
    MIN_DURATION_SECONDS = 6.0
    MAX_DURATION_SECONDS = 300.0
    OPTIMAL_SAMPLE_RATE = 22050
    MIN_SAMPLE_RATE = 16000
    
    def __init__(self):
        self.issues: List[str] = []
        self.recommendations: List[str] = []
    
    def analyze(self, audio_path: str) -> Dict:
        """
        Analyze audio file quality and return comprehensive metrics.
        
        Returns:
            Dict with quality metrics and recommendations
        """
        self.issues = []
        self.recommendations = []
        
        if not LIBROSA_AVAILABLE:
            return {
                "error": "librosa not installed",
                "overall_score": 0
            }
        
        try:
            # Load audio
            y, sr = librosa.load(audio_path, sr=None)
            duration = librosa.get_duration(y=y, sr=sr)
            
            # Calculate metrics
            metrics = {
                "duration": round(duration, 2),
                "sample_rate": sr,
                "channels": 1 if len(y.shape) == 1 else y.shape[0],
                "rms_db": self._calculate_rms_db(y),
                "noise_level": self._estimate_noise_level(y, sr),
                "silence_ratio": self._calculate_silence_ratio(y, sr),
                "clipping_ratio": self._detect_clipping(y),
                "dynamic_range": self._calculate_dynamic_range(y),
                "spectral_flatness": self._calculate_spectral_flatness(y, sr)
            }
            
            # Check duration
            if duration < self.MIN_DURATION_SECONDS:
                self.issues.append(f"Audio too short ({duration:.1f}s). Minimum recommended: {self.MIN_DURATION_SECONDS}s")
                self.recommendations.append("Record at least 6 seconds of clear speech")
            elif duration > self.MAX_DURATION_SECONDS:
                self.issues.append(f"Audio very long ({duration:.1f}s). Consider trimming.")
                self.recommendations.append("For instant cloning, 15-30 seconds is optimal")
            
            # Check sample rate
            if sr < self.MIN_SAMPLE_RATE:
                self.issues.append(f"Low sample rate ({sr}Hz). Recommended: {self.OPTIMAL_SAMPLE_RATE}Hz+")
                self.recommendations.append("Re-record with higher quality settings")
            
            # Check noise level
            if metrics["noise_level"] == "high":
                self.issues.append("High background noise detected")
                self.recommendations.append("Record in a quieter environment or use noise reduction")
            
            # Check for clipping
            if metrics["clipping_ratio"] > 0.01:
                self.issues.append(f"Audio clipping detected ({metrics['clipping_ratio']*100:.1f}% of samples)")
                self.recommendations.append("Lower microphone gain and re-record")
            
            # Check silence ratio
            if metrics["silence_ratio"] > 0.5:
                self.issues.append(f"Too much silence ({metrics['silence_ratio']*100:.0f}%)")
                self.recommendations.append("Trim silences for better voice learning")
            
            # Check volume
            if metrics["rms_db"] < -30:
                self.issues.append("Audio too quiet")
                self.recommendations.append("Speak closer to the microphone or increase gain")
            elif metrics["rms_db"] > -5:
                self.issues.append("Audio too loud")
                self.recommendations.append("Move away from microphone or lower gain")
            
            # Calculate overall score
            overall_score = self._calculate_overall_score(metrics)
            
            return {
                "metrics": metrics,
                "issues": self.issues,
                "recommendations": self.recommendations,
                "overall_score": overall_score,
                "is_suitable": overall_score >= 60 and len(self.issues) <= 2
            }
            
        except Exception as e:
            return {
                "error": str(e),
                "overall_score": 0
            }
    
    def _calculate_rms_db(self, y: np.ndarray) -> float:
        """Calculate RMS level in dB."""
        rms = np.sqrt(np.mean(y**2))
        if rms > 0:
            return float(20 * np.log10(rms))
        return -100.0
    
    def _estimate_noise_level(self, y: np.ndarray, sr: int) -> str:
        """Estimate background noise level."""
        # Use first 0.5s as noise sample (assuming it's silence/low speech)
        noise_sample = y[:int(sr * 0.5)]
        noise_rms = np.sqrt(np.mean(noise_sample**2))
        signal_rms = np.sqrt(np.mean(y**2))
        
        if signal_rms > 0:
            snr = 20 * np.log10(signal_rms / (noise_rms + 1e-10))
            if snr < 10:
                return "high"
            elif snr < 20:
                return "medium"
            else:
                return "low"
        return "unknown"
    
    def _calculate_silence_ratio(self, y: np.ndarray, sr: int) -> float:
        """Calculate ratio of silence in audio."""
        threshold = 0.02 * np.max(np.abs(y))
        silent_samples = np.sum(np.abs(y) < threshold)
        return float(silent_samples / len(y))
    
    def _detect_clipping(self, y: np.ndarray) -> float:
        """Detect clipping (samples at max/min values)."""
        clipped = np.sum(np.abs(y) > 0.99)
        return float(clipped / len(y))
    
    def _calculate_dynamic_range(self, y: np.ndarray) -> float:
        """Calculate dynamic range in dB."""
        percentile_high = np.percentile(np.abs(y), 95)
        percentile_low = np.percentile(np.abs(y[np.abs(y) > 0.01]), 5) if np.any(np.abs(y) > 0.01) else 0.001
        if percentile_low > 0:
            return float(20 * np.log10(percentile_high / percentile_low))
        return 0.0
    
    def _calculate_spectral_flatness(self, y: np.ndarray, sr: int) -> float:
        """Calculate spectral flatness (measure of noise vs tonal content)."""
        flatness = librosa.feature.spectral_flatness(y=y)
        return float(np.mean(flatness))
    
    def _calculate_overall_score(self, metrics: Dict) -> int:
        """Calculate overall quality score (0-100)."""
        score = 100
        
        # Duration scoring
        duration = metrics["duration"]
        if duration < 6:
            score -= 30
        elif duration < 10:
            score -= 10
        elif duration > 300:
            score -= 15
        
        # Sample rate scoring
        if metrics["sample_rate"] < 16000:
            score -= 25
        elif metrics["sample_rate"] < 22050:
            score -= 10
        
        # Noise level scoring
        if metrics["noise_level"] == "high":
            score -= 20
        elif metrics["noise_level"] == "medium":
            score -= 10
        
        # Clipping scoring
        if metrics["clipping_ratio"] > 0.05:
            score -= 25
        elif metrics["clipping_ratio"] > 0.01:
            score -= 15
        
        # Silence ratio scoring
        if metrics["silence_ratio"] > 0.5:
            score -= 15
        elif metrics["silence_ratio"] > 0.3:
            score -= 5
        
        # Volume scoring
        rms = metrics["rms_db"]
        if rms < -35 or rms > -3:
            score -= 15
        elif rms < -30 or rms > -5:
            score -= 5
        
        return max(0, min(100, score))


class AudioPreprocessor:
    """
    Preprocesses audio for optimal voice cloning with XTTS v2.
    
    Features:
    - Noise reduction
    - Audio normalization
    - Silence trimming
    - Format conversion
    - Resampling
    """
    
    TARGET_SAMPLE_RATE = 22050
    TARGET_BIT_DEPTH = 16
    
    def __init__(self, output_dir: str = None):
        self.output_dir = output_dir or os.path.join(os.getcwd(), 'uploads', 'voice', 'processed')
        os.makedirs(self.output_dir, exist_ok=True)
        self.analyzer = AudioQualityAnalyzer()
    
    def preprocess(
        self,
        input_path: str,
        output_name: str = None,
        noise_reduce: bool = True,
        normalize: bool = True,
        trim_silence: bool = True,
        target_sr: int = None
    ) -> Dict:
        """
        Full preprocessing pipeline for voice cloning.
        
        Args:
            input_path: Path to input audio file
            output_name: Name for output file (without extension)
            noise_reduce: Apply noise reduction
            normalize: Normalize audio levels
            trim_silence: Remove leading/trailing silence
            target_sr: Target sample rate (default: 22050)
            
        Returns:
            Dict with processed file path and metrics
        """
        if not LIBROSA_AVAILABLE:
            return {"error": "librosa not installed", "success": False}
        
        target_sr = target_sr or self.TARGET_SAMPLE_RATE
        output_name = output_name or f"processed_{os.path.basename(input_path).split('.')[0]}"
        output_path = os.path.join(self.output_dir, f"{output_name}.wav")
        
        try:
            print(f"[AUDIO_PREPROCESSOR] Processing: {input_path}")
            
            # Load audio
            y, sr = librosa.load(input_path, sr=None, mono=True)
            original_duration = librosa.get_duration(y=y, sr=sr)
            print(f"[AUDIO_PREPROCESSOR] Loaded: {original_duration:.2f}s @ {sr}Hz")
            
            # Step 1: Resample if needed
            if sr != target_sr:
                print(f"[AUDIO_PREPROCESSOR] Resampling {sr}Hz -> {target_sr}Hz")
                y = librosa.resample(y, orig_sr=sr, target_sr=target_sr)
                sr = target_sr
            
            # Step 2: Trim silence
            if trim_silence:
                y = self._trim_silence(y, sr)
                print(f"[AUDIO_PREPROCESSOR] After trim: {librosa.get_duration(y=y, sr=sr):.2f}s")
            
            # Step 3: Noise reduction
            if noise_reduce and NOISEREDUCE_AVAILABLE:
                y = self._reduce_noise(y, sr)
                print("[AUDIO_PREPROCESSOR] Noise reduced")
            
            # Step 4: Normalize
            if normalize:
                y = self._normalize_audio(y)
                print("[AUDIO_PREPROCESSOR] Normalized")
            
            # Step 5: Final cleanup
            y = self._apply_fade(y, sr)
            
            # Save processed audio
            sf.write(output_path, y, sr, subtype='PCM_16')
            print(f"[AUDIO_PREPROCESSOR] Saved: {output_path}")
            
            # Analyze final quality
            final_analysis = self.analyzer.analyze(output_path)
            
            return {
                "success": True,
                "output_path": output_path,
                "original_duration": round(original_duration, 2),
                "processed_duration": round(librosa.get_duration(y=y, sr=sr), 2),
                "sample_rate": sr,
                "quality": final_analysis.get("overall_score", 0),
                "issues": final_analysis.get("issues", [])
            }
            
        except Exception as e:
            print(f"[AUDIO_PREPROCESSOR] Error: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def _trim_silence(self, y: np.ndarray, sr: int, top_db: int = 25) -> np.ndarray:
        """Trim leading and trailing silence."""
        y_trimmed, _ = librosa.effects.trim(y, top_db=top_db)
        return y_trimmed
    
    def _reduce_noise(self, y: np.ndarray, sr: int) -> np.ndarray:
        """Apply noise reduction using spectral gating."""
        if not NOISEREDUCE_AVAILABLE:
            return y
        
        # Use first 0.5s as noise sample
        noise_sample = y[:int(sr * 0.5)]
        
        # Apply noise reduction
        y_reduced = nr.reduce_noise(
            y=y,
            sr=sr,
            y_noise=noise_sample,
            prop_decrease=0.8,
            n_fft=2048,
            stationary=False
        )
        
        return y_reduced
    
    def _normalize_audio(self, y: np.ndarray, target_db: float = -20.0) -> np.ndarray:
        """Normalize audio to target dB level."""
        rms = np.sqrt(np.mean(y**2))
        if rms > 0:
            target_rms = 10 ** (target_db / 20)
            y = y * (target_rms / rms)
            
            # Prevent clipping
            peak = np.max(np.abs(y))
            if peak > 0.95:
                y = y * (0.95 / peak)
        
        return y
    
    def _apply_fade(self, y: np.ndarray, sr: int, fade_ms: int = 10) -> np.ndarray:
        """Apply small fade in/out to prevent clicks."""
        fade_samples = int(sr * fade_ms / 1000)
        
        # Fade in
        y[:fade_samples] *= np.linspace(0, 1, fade_samples)
        
        # Fade out
        y[-fade_samples:] *= np.linspace(1, 0, fade_samples)
        
        return y
    
    def convert_format(self, input_path: str, output_format: str = "wav") -> str:
        """
        Convert audio to specified format.
        
        Args:
            input_path: Path to input audio file
            output_format: Target format (wav, mp3, etc.)
            
        Returns:
            Path to converted file
        """
        if not PYDUB_AVAILABLE:
            raise ImportError("pydub not installed")
        
        audio = AudioSegment.from_file(input_path)
        
        # Convert to mono
        audio = audio.set_channels(1)
        
        # Set sample rate
        audio = audio.set_frame_rate(self.TARGET_SAMPLE_RATE)
        
        output_name = os.path.basename(input_path).rsplit('.', 1)[0]
        output_path = os.path.join(self.output_dir, f"{output_name}.{output_format}")
        
        audio.export(output_path, format=output_format)
        return output_path


def preprocess_for_cloning(input_path: str, output_name: str = None) -> Dict:
    """
    Convenience function for preprocessing audio for voice cloning.
    
    Args:
        input_path: Path to audio file
        output_name: Optional name for processed file
        
    Returns:
        Dict with results and processed file path
    """
    preprocessor = AudioPreprocessor()
    
    # First analyze the original
    analyzer = AudioQualityAnalyzer()
    original_analysis = analyzer.analyze(input_path)
    
    # Process the audio
    result = preprocessor.preprocess(
        input_path,
        output_name=output_name,
        noise_reduce=original_analysis.get("metrics", {}).get("noise_level") != "low",
        normalize=True,
        trim_silence=True
    )
    
    result["original_analysis"] = original_analysis
    return result


# FastAPI integration
def create_preprocessing_endpoint():
    """Create FastAPI router for audio preprocessing."""
    from fastapi import APIRouter, File, UploadFile, HTTPException
    from fastapi.responses import JSONResponse
    import tempfile
    import shutil
    
    router = APIRouter(prefix="/audio", tags=["audio"])
    
    @router.post("/analyze")
    async def analyze_audio(file: UploadFile = File(...)):
        """Analyze audio quality for voice cloning."""
        try:
            # Save uploaded file temporarily
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
                shutil.copyfileobj(file.file, tmp)
                tmp_path = tmp.name
            
            # Analyze
            analyzer = AudioQualityAnalyzer()
            result = analyzer.analyze(tmp_path)
            
            # Cleanup
            os.unlink(tmp_path)
            
            return JSONResponse(content=result)
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @router.post("/preprocess")
    async def preprocess_audio(
        file: UploadFile = File(...),
        noise_reduce: bool = True,
        normalize: bool = True,
        trim_silence: bool = True
    ):
        """Preprocess audio for voice cloning."""
        try:
            # Save uploaded file temporarily
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
                shutil.copyfileobj(file.file, tmp)
                tmp_path = tmp.name
            
            # Process
            preprocessor = AudioPreprocessor()
            result = preprocessor.preprocess(
                tmp_path,
                noise_reduce=noise_reduce,
                normalize=normalize,
                trim_silence=trim_silence
            )
            
            # Cleanup temp file
            os.unlink(tmp_path)
            
            return JSONResponse(content=result)
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    return router


if __name__ == "__main__":
    # Test the preprocessor
    import sys
    
    if len(sys.argv) > 1:
        input_file = sys.argv[1]
        print(f"\n=== Audio Preprocessor Test ===")
        print(f"Input: {input_file}\n")
        
        # Analyze
        analyzer = AudioQualityAnalyzer()
        analysis = analyzer.analyze(input_file)
        
        print("=== Quality Analysis ===")
        print(json.dumps(analysis, indent=2))
        
        # Process
        print("\n=== Processing ===")
        result = preprocess_for_cloning(input_file)
        print(json.dumps({k: v for k, v in result.items() if k != "original_analysis"}, indent=2))
    else:
        print("Usage: python audio_preprocessor.py <audio_file>")
        print("\nThis module provides audio preprocessing for voice cloning:")
        print("  - Quality analysis")
        print("  - Noise reduction")
        print("  - Normalization")
        print("  - Silence trimming")
        print("  - Format conversion")
