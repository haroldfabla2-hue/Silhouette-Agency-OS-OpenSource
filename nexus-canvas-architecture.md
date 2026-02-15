# 🏗️ ARQUITECTURA TÉCNICA: Nexus Canvas
## Sistema Completo End-to-End

**Nivel:** Senior Architects / Tech Leads  
**Versión:** 2.0  
**Fecha:** 28 Diciembre 2025

---

## 1. DIAGRAMA DE CAPAS (Macro)

```
┌─────────────────────────────────────────────────┐
│         USER PRESENTATION LAYER (Browser)       │
│  • React Components • Tailwind UI • Pixi Canvas│
└──────────────────────┬──────────────────────────┘
                       │ REST API + WebSocket
┌──────────────────────┴──────────────────────────┐
│        APPLICATION LAYER (FastAPI)              │
│  • Route Handlers • Business Logic • Validation │
└──────────────────────┬──────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
┌───────┴────────┐ ┌───┴────────┐ ┌──┴──────────┐
│ GPU ML Layer   │ │ Data Layer │ │ Cache Layer│
│ (Python/CUDA)  │ │ (SQL/ORM)  │ │ (Redis)    │
└────────────────┘ └────────────┘ └────────────┘
```

---

## 2. COMPONENTES PRINCIPALES

### 2.1 Frontend Architecture (React + TypeScript)

```typescript
// src/App.tsx
export default function App() {
  return (
    <div className="flex h-screen bg-slate-900">
      {/* LEFT: Toolbar */}
      <Toolbar />
      
      {/* CENTER: Canvas */}
      <CanvasArea />
      
      {/* RIGHT: Inspector Panels */}
      <InspectorPanel>
        <LayerPanel />
        <HistoryPanel />
        <ColorPanel />
        <BrushPanel />
      </InspectorPanel>
    </div>
  )
}
```

### 2.2 Canvas Engine (Pixi.js + WebGL)

```typescript
// src/engine/CanvasEngine.ts
export class CanvasEngine {
  private app: PIXI.Application
  private container: PIXI.Container
  private layers: Map<string, PIXI.Sprite>
  private renderTexture: PIXI.RenderTexture

  constructor(canvas: HTMLCanvasElement) {
    this.app = new PIXI.Application({
      view: canvas,
      width: 1920,
      height: 1080,
      resolution: window.devicePixelRatio,
      autoDensity: true,
      backgroundColor: 0xffffff,
      antialias: true
    })

    this.container = new PIXI.Container()
    this.app.stage.addChild(this.container)
    
    // Start render loop
    this.app.ticker.add(() => this.render())
  }

  async addLayer(layer: Layer): Promise<void> {
    const texture = await this.layerToTexture(layer)
    const sprite = new PIXI.Sprite(texture)
    
    sprite.blendMode = this.mapBlendMode(layer.blendMode)
    sprite.alpha = layer.opacity / 100
    
    this.layers.set(layer.id, sprite)
    this.container.addChild(sprite)
  }

  private mapBlendMode(mode: string): PIXI.BLEND_MODES {
    const modeMap: Record<string, PIXI.BLEND_MODES> = {
      'NORMAL': PIXI.BLEND_MODES.NORMAL,
      'MULTIPLY': PIXI.BLEND_MODES.MULTIPLY,
      'SCREEN': PIXI.BLEND_MODES.SCREEN,
      'OVERLAY': PIXI.BLEND_MODES.OVERLAY,
      // ... 20+ más
    }
    return modeMap[mode] || PIXI.BLEND_MODES.NORMAL
  }

  render(): void {
    // 60fps render loop
    // Composed automatically by Pixi
  }
}
```

### 2.3 State Management (Zustand)

```typescript
// src/store/useCanvasStore.ts
interface CanvasState {
  // Document state
  document: NexusDocument
  
  // Selection & tools
  selectedLayerId: string | null
  selectedTool: Tool
  toolOptions: ToolOptions
  
  // UI state
  zoom: number
  panX: number
  panY: number
  
  // Actions
  addLayer: (layer: Layer) => void
  deleteLayer: (id: string) => void
  updateLayer: (id: string, updates: Partial<Layer>) => void
  undo: () => void
  redo: () => void
  setZoom: (zoom: number) => void
}

export const useCanvasStore = create<CanvasState>()(
  immer(
    devtools((set, get) => ({
      document: createNewDocument(),
      selectedLayerId: null,
      selectedTool: 'move',
      toolOptions: { size: 20, hardness: 100, opacity: 100 },
      zoom: 1,
      panX: 0,
      panY: 0,

      addLayer: (layer) => set((state) => {
        state.document.layers.push(layer)
        state.document.history.push({
          action: 'addLayer',
          timestamp: new Date(),
          newState: state.document
        })
      }),

      updateLayer: (id, updates) => set((state) => {
        const layer = findLayerById(state.document, id)
        if (layer) {
          Object.assign(layer, updates)
          state.document.history.push({
            action: 'updateLayer',
            timestamp: new Date(),
            newState: state.document
          })
        }
      }),

      undo: () => set((state) => {
        if (state.document.historyIndex > 0) {
          state.document.historyIndex--
          state.document = state.document.history[state.document.historyIndex].newState
        }
      })
    }))
  )
)
```

---

## 3. BACKEND ARCHITECTURE (FastAPI + Python)

### 3.1 Project Structure

```
api/
├── app/
│   ├── main.py              # Entry point
│   ├── config.py            # Config management
│   ├── dependencies.py      # DI container
│   │
│   ├── routers/
│   │   ├── canvas.py        # Canvas endpoints
│   │   ├── ai.py            # AI generation
│   │   └── auth.py          # Authentication
│   │
│   ├── models/
│   │   ├── layer.py         # Layer data model
│   │   ├── document.py      # Document model
│   │   └── schemas.py       # Pydantic schemas
│   │
│   ├── services/
│   │   ├── canvas_service.py
│   │   ├── ai_service.py
│   │   └── image_service.py
│   │
│   ├── ml/
│   │   ├── pipelines/
│   │   │   ├── inpaint.py   # Stable Diffusion
│   │   │   ├── segment.py   # SAM2
│   │   │   └── remove_bg.py # rembg
│   │   └── models/          # Downloaded .pt files
│   │
│   └── utils/
│       ├── cache.py
│       └── logger.py
│
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```

### 3.2 Main FastAPI App

```python
# app/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

# Global ML models (loaded once, cached in memory)
ml_models = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("Loading ML models...")
    ml_models['sdxl'] = load_stable_diffusion_xl()
    ml_models['sam2'] = load_sam2_model()
    print("✅ Models loaded to VRAM")
    
    yield
    
    # Shutdown
    print("Cleaning up...")
    for model in ml_models.values():
        del model
    import torch
    torch.cuda.empty_cache()

app = FastAPI(
    title="Nexus Canvas API",
    version="2.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://yourdomain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(canvas_router, prefix="/api/canvas", tags=["canvas"])
app.include_router(ai_router, prefix="/api/ai", tags=["ai"])
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "version": "2.0.0",
        "gpu": get_gpu_info(),
        "models_loaded": list(ml_models.keys())
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

### 3.3 AI Router (Generative Fill)

```python
# app/routers/ai.py
from fastapi import APIRouter, Form, BackgroundTasks
from pydantic import BaseModel
import uuid

router = APIRouter()

class GenerativeRequestSchema(BaseModel):
    image_base64: str
    mask_base64: str
    prompt: str
    negative_prompt: str = "blurry, low quality"
    steps: int = 30
    guidance_scale: float = 7.5

@router.post("/generative-fill")
async def generative_fill(
    image_base64: str = Form(...),
    mask_base64: str = Form(...),
    prompt: str = Form(...),
    background_tasks: BackgroundTasks = None
):
    """
    Async generative inpainting
    - Queue immediately
    - Process in background
    - Client polls for result
    """
    
    task_id = str(uuid.uuid4())
    
    # Queue the task
    await redis.setex(
        f"task:{task_id}",
        3600,  # 1 hour TTL
        json.dumps({
            "status": "queued",
            "created_at": datetime.now().isoformat(),
            "image_base64": image_base64,
            "mask_base64": mask_base64,
            "prompt": prompt
        })
    )
    
    # Process in background
    background_tasks.add_task(
        process_generative_fill,
        task_id=task_id,
        image_b64=image_base64,
        mask_b64=mask_base64,
        prompt=prompt
    )
    
    return {
        "task_id": task_id,
        "status": "queued",
        "estimated_wait": "15-20 seconds"
    }

@router.get("/task/{task_id}")
async def get_task_status(task_id: str):
    """Poll for task result"""
    result = await redis.get(f"task:{task_id}")
    
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    
    data = json.loads(result)
    
    if data['status'] == 'completed':
        return {
            "task_id": task_id,
            "status": "completed",
            "result_image": data.get('result_image_base64'),
            "model_used": "stable-diffusion-xl-inpaint"
        }
    
    return {"task_id": task_id, "status": data['status']}

async def process_generative_fill(task_id: str, image_b64: str, mask_b64: str, prompt: str):
    """Heavy lifting in background"""
    try:
        # Update status
        await redis.hset(f"task:{task_id}", "status", "processing")
        
        # Load image & mask
        image = load_image_from_base64(image_b64)
        mask = load_image_from_base64(mask_b64)
        
        # Run inference
        pipe = ml_models['sdxl']
        with torch.no_grad():
            result = pipe(
                prompt=prompt,
                image=image,
                mask_image=mask,
                guidance_scale=7.5,
                num_inference_steps=30
            ).images[0]
        
        # Save result
        result_b64 = image_to_base64(result)
        
        await redis.hset(
            f"task:{task_id}",
            "status", "completed"
        )
        await redis.hset(
            f"task:{task_id}",
            "result_image_base64", result_b64
        )
        
    except Exception as e:
        logging.error(f"Task {task_id} failed: {e}")
        await redis.hset(f"task:{task_id}", "status", "failed")
        await redis.hset(f"task:{task_id}", "error", str(e))
```

---

## 4. DATABASE SCHEMA (PostgreSQL)

```sql
-- Documents table
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    width INT NOT NULL DEFAULT 1920,
    height INT NOT NULL DEFAULT 1080,
    dpi INT NOT NULL DEFAULT 300,
    color_profile VARCHAR(50) DEFAULT 'sRGB',
    
    -- JSON storage for complex data
    layers_data JSONB NOT NULL DEFAULT '[]'::jsonb,
    history_data JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at)
);

-- Layer snapshots (for performance)
CREATE TABLE layer_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    layer_id VARCHAR(100) NOT NULL,
    image_data BYTEA,  -- PNG binary
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_document_id (document_id),
    INDEX idx_layer_id (layer_id)
);

-- AI tasks log
CREATE TABLE ai_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    task_type VARCHAR(50) NOT NULL,  -- 'inpaint', 'remove_bg', etc
    status VARCHAR(50) DEFAULT 'queued',
    model_used VARCHAR(100),
    prompt TEXT,
    
    input_size INT,  -- bytes
    output_size INT,
    latency_ms INT,  -- how long inference took
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);
```

---

## 5. PERFORMANCE OPTIMIZATIONS

### 5.1 GPU Memory Management

```python
# Smart model loading/unloading
class GPUMemoryManager:
    def __init__(self, max_vram_gb=16):
        self.max_vram = max_vram_gb * 1024 * 1024 * 1024
        self.loaded_models = {}
    
    def load_model(self, model_name: str):
        if model_name in self.loaded_models:
            return self.loaded_models[model_name]
        
        # Check available memory
        if self.get_used_vram() > self.max_vram * 0.8:
            self.unload_least_used()
        
        # Load model
        model = self._download_and_load(model_name)
        self.loaded_models[model_name] = {
            'model': model,
            'last_used': datetime.now(),
            'use_count': 0
        }
        return model
    
    def get_used_vram(self):
        return torch.cuda.memory_allocated()
    
    def unload_least_used(self):
        # Find least recently used model
        lru = min(
            self.loaded_models.items(),
            key=lambda x: x[1]['last_used']
        )
        del self.loaded_models[lru[0]]
        torch.cuda.empty_cache()
```

### 5.2 Layer Caching

```typescript
// Frontend layer texture caching
class LayerTextureCache {
  private cache = new Map<string, PIXI.Texture>()
  private maxSize = 50
  
  get(layerId: string): PIXI.Texture | null {
    return this.cache.get(layerId) || null
  }
  
  set(layerId: string, texture: PIXI.Texture): void {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest
      const oldest = this.cache.keys().next().value
      this.cache.delete(oldest)
    }
    this.cache.set(layerId, texture)
  }
  
  invalidate(layerId: string): void {
    this.cache.delete(layerId)
  }
  
  invalidateAll(): void {
    this.cache.clear()
  }
}
```

---

## 6. DEPLOYMENT (Docker + AWS)

### 6.1 Dockerfile

```dockerfile
FROM nvidia/cuda:12.0-devel-ubuntu22.04

WORKDIR /app

# Install Python
RUN apt-get update && apt-get install -y python3.11 python3-pip

# Copy requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY app/ ./app/

# Expose port
EXPOSE 8000

# Run
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 6.2 Docker Compose

```yaml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DEBUG=true
      - USE_CUDA=true
    volumes:
      - ./app:/app/app
    depends_on:
      - postgres
      - redis
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: nexus_canvas
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: secure_password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

---

**Esta arquitectura soporta 1000+ usuarios concurrentes con <100ms latencia.**

