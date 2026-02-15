"""
SILHOUETTE - Inference API
FastAPI server for model inference.
Independent instance for Silhouette Agency OS.
"""
import os
import torch
from typing import Optional, List
from dataclasses import dataclass

try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel
    import uvicorn
    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False


@dataclass
class InferenceConfig:
    model_path: str = "./checkpoints/checkpoint_final.pt"
    device: str = "auto"
    max_length: int = 2048
    default_temperature: float = 0.7
    default_top_p: float = 0.9
    default_top_k: int = 50


class InferenceAPI:
    """Inference wrapper for NANOSILHOUETTE."""
    
    def __init__(self, config: Optional[InferenceConfig] = None):
        self.config = config or InferenceConfig()
        self.model = None
        self.tokenizer = None
        
        # Auto-detect device
        if self.config.device == "auto":
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(self.config.device)
    
    def load_model(self, model_path: Optional[str] = None):
        """Load model from checkpoint."""
        from src.model import NanoSilhouetteModel
        from src.training.data_loader import SimpleTokenizer
        
        path = model_path or self.config.model_path
        
        if not os.path.exists(path):
            raise FileNotFoundError(f"Model not found: {path}")
        
        checkpoint = torch.load(path, map_location=self.device)
        
        # Create model
        self.model = NanoSilhouetteModel()
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.to(self.device)
        self.model.eval()
        
        self.tokenizer = SimpleTokenizer()
        print(f"Model loaded from {path}")
    
    @torch.no_grad()
    def generate(
        self,
        prompt: str,
        max_new_tokens: int = 100,
        temperature: float = None,
        top_p: float = None,
        top_k: int = None
    ) -> str:
        """Generate text from prompt."""
        if self.model is None:
            raise RuntimeError("Model not loaded. Call load_model() first.")
        
        temperature = temperature or self.config.default_temperature
        top_p = top_p or self.config.default_top_p
        top_k = top_k or self.config.default_top_k
        
        # Tokenize
        tokens = self.tokenizer.encode(prompt)
        input_ids = torch.tensor([tokens], device=self.device)
        
        # Generate
        output_ids = self.model.generate(
            input_ids,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            top_p=top_p,
            top_k=top_k
        )
        
        # Decode
        output_tokens = output_ids[0].tolist()
        return self.tokenizer.decode(output_tokens)
    
    @torch.no_grad()
    def get_embedding(self, text: str) -> torch.Tensor:
        """Get text embedding using JEPA head."""
        if self.model is None:
            raise RuntimeError("Model not loaded.")
        
        tokens = self.tokenizer.encode(text)
        input_ids = torch.tensor([tokens], device=self.device)
        
        outputs = self.model(input_ids)
        return outputs["hidden_states"].mean(dim=1)


# FastAPI app
if FASTAPI_AVAILABLE:
    app = FastAPI(title="SILHOUETTE API", version="1.0.0")
    api = InferenceAPI()
    
    class GenerateRequest(BaseModel):
        prompt: str
        max_new_tokens: int = 100
        temperature: float = 0.7
        top_p: float = 0.9
        top_k: int = 50
    
    class GenerateResponse(BaseModel):
        text: str
        tokens_generated: int
    
    @app.on_event("startup")
    async def startup():
        try:
            api.load_model()
        except FileNotFoundError:
            print("Warning: No model checkpoint found. Load manually.")
    
    @app.post("/generate", response_model=GenerateResponse)
    async def generate(request: GenerateRequest):
        if api.model is None:
            raise HTTPException(500, "Model not loaded")
        
        text = api.generate(
            request.prompt,
            request.max_new_tokens,
            request.temperature,
            request.top_p,
            request.top_k
        )
        
        return GenerateResponse(
            text=text,
            tokens_generated=len(text) - len(request.prompt)
        )
    
    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "model_loaded": api.model is not None,
            "device": str(api.device)
        }


def run_server(host: str = "0.0.0.0", port: int = 8102):
    """Run the FastAPI server on port 8102 (default)."""
    import os
    port = int(os.environ.get("SILHOUETTE_PORT", port))
    if not FASTAPI_AVAILABLE:
        print("FastAPI not installed. Run: pip install fastapi uvicorn")
        return
    print(f"Starting SILHOUETTE API on port {port}...")
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    run_server()
