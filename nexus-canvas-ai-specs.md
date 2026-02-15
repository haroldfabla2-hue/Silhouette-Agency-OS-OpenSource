# 🤖 IA INTEGRATION: Especificaciones Técnicas
## Modelos, Pipelines y Optimizaciones

**Nivel:** ML Engineers / AI Architects  
**Versión:** 2.0  
**Última actualización:** 28 Diciembre 2025

---

## 1. MODELOS Y LIBRERÍAS

### 1.1 Stable Diffusion XL (Inpainting)

```python
from diffusers import StableDiffusionXLInpaintPipeline
import torch

# Configuration
MODEL_ID = "stabilityai/stable-diffusion-xl-1.0-inpainting-0.1"
DTYPE = torch.float16  # Memory efficient

# Load once, cache in memory
pipeline = StableDiffusionXLInpaintPipeline.from_pretrained(
    MODEL_ID,
    torch_dtype=DTYPE,
    use_safetensors=True
)
pipeline.to("cuda")
pipeline.enable_attention_slicing()  # For lower VRAM

# Inference
@torch.no_grad()
def inpaint(
    prompt: str,
    image: PIL.Image,
    mask: PIL.Image,
    negative_prompt: str = "blurry, low quality",
    num_steps: int = 30,
    guidance_scale: float = 7.5,
    strength: float = 0.8
) -> PIL.Image:
    
    result = pipeline(
        prompt=prompt,
        negative_prompt=negative_prompt,
        image=image,
        mask_image=mask,
        num_inference_steps=num_steps,
        guidance_scale=guidance_scale,
        strength=strength,
        generator=torch.Generator("cuda").manual_seed(42)
    )
    
    return result.images[0]

# Latency profile (RTX 3090):
# • Loading: 2-3 seconds (first time only)
# • Inference (30 steps): 12-15 seconds
# • Total: 14-18 seconds
```

### 1.2 SAM2 (Segment Anything Model 2)

```python
from segment_anything import sam_model_registry, SamPredictor
from PIL import Image
import numpy as np

# Load
sam = sam_model_registry["vit_b"](
    checkpoint="sam_vit_b_01ec64.pth"  # 375MB
)
sam.to("cuda")
predictor = SamPredictor(sam)

def segment_object(
    image: PIL.Image,
    click_points: List[Tuple[int, int]],
    click_labels: List[int] = None
) -> np.ndarray:
    """
    Segment object from clicks
    - click_points: [(x1, y1), (x2, y2), ...]
    - click_labels: [1, 1, ...] for positive, [0, ...] for negative
    """
    
    image_array = np.array(image)
    
    predictor.set_image(image_array)
    
    input_point = np.array(click_points)
    input_label = np.array(click_labels or [1] * len(click_points))
    
    masks, scores, logits = predictor.predict(
        point_coords=input_point,
        point_labels=input_label,
        multimask_output=True
    )
    
    # Return best mask
    return masks[np.argmax(scores)]

# Latency:
# • First image: 3-5 seconds (image encoding)
# • Per click: 50-100ms (very fast!)
```

### 1.3 LaMa (Large Mask Inpainting)

```python
from lama.saicinpaint.evaluation.utils import (
    pad_tensor_to_modulo,
    resize_max_side
)
from lama.saicinpaint.training.trainers import load_checkpoint

# Load model
device = torch.device("cuda")
model = load_checkpoint(
    "big-lama",
    cpu_transfer=False
)
model.to(device)

def inpaint_cleanup(
    image: PIL.Image,
    mask: PIL.Image,
    dilate_kernel_size: int = 3
) -> PIL.Image:
    """
    High-quality inpainting cleanup
    Better than content-aware fill for irregular selections
    """
    
    image_np = np.array(image)
    mask_np = np.array(mask.convert("L"))
    
    # Dilate mask for better blending
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (dilate_kernel_size, dilate_kernel_size)
    )
    mask_dilated = cv2.dilate(mask_np, kernel, iterations=1)
    
    # Convert to tensor
    image_tensor = torch.from_numpy(image_np).to(device).float() / 255
    mask_tensor = torch.from_numpy(mask_dilated).to(device).float() / 255
    
    # Inference
    with torch.no_grad():
        inpainted = model(
            image_tensor.unsqueeze(0).permute(0, 3, 1, 2),
            mask_tensor.unsqueeze(0).unsqueeze(0)
        )
    
    # Convert back
    result = (inpainted[0].permute(1, 2, 0).cpu() * 255).astype(np.uint8)
    
    return Image.fromarray(result)

# Latency: 2-4 seconds for 1024x1024
```

### 1.4 rembg (Background Removal)

```python
from rembg import remove
from PIL import Image

def remove_background(
    image: PIL.Image,
    background_color: str = "white"
) -> PIL.Image:
    """
    Remove background with U2Net
    Returns PNG with alpha channel
    """
    
    # Remove background (returns RGBA)
    output = remove(image)
    
    # If solid background requested
    if background_color != "transparent":
        bg = Image.new("RGB", output.size, background_color)
        bg.paste(output, mask=output.split()[3])
        return bg
    
    return output

# Latency: 1-2 seconds for 1024x1024
```

---

## 2. PIPELINE ORCHESTRATION

### 2.1 Async Job Queue (Celery + Redis)

```python
from celery import Celery, group, chain
import redis

app = Celery(
    'nexus_canvas',
    broker='redis://localhost:6379/0',
    backend='redis://localhost:6379/1'
)

@app.task(bind=True, max_retries=3)
def task_generative_fill(self, task_id: str, image_b64: str, mask_b64: str, prompt: str):
    """Main inpainting task"""
    try:
        self.update_state(state='PROGRESS', meta={'progress': 0})
        
        # Load and preprocess
        image = load_image_from_base64(image_b64)
        mask = load_image_from_base64(mask_b64)
        
        self.update_state(state='PROGRESS', meta={'progress': 20})
        
        # Run inference
        result_image = inpaint(
            prompt=prompt,
            image=image,
            mask=mask,
            num_steps=30
        )
        
        self.update_state(state='PROGRESS', meta={'progress': 80})
        
        # Save to Redis
        result_b64 = image_to_base64(result_image)
        
        redis_client = redis.Redis()
        redis_client.hset(
            f"task:{task_id}",
            mapping={
                'status': 'completed',
                'result_image': result_b64,
                'model': 'stable-diffusion-xl-inpaint'
            }
        )
        
        self.update_state(state='SUCCESS', meta={'progress': 100})
        
    except Exception as exc:
        # Retry with exponential backoff
        raise self.retry(exc=exc, countdown=60)

@app.task(bind=True)
def task_smart_remove(self, task_id: str, image_b64: str, mask_b64: str):
    """Smart object removal (SAM2 + LaMa)"""
    
    image = load_image_from_base64(image_b64)
    mask = load_image_from_base64(mask_b64)
    
    # Step 1: Segment with SAM2
    self.update_state(state='PROGRESS', meta={'current': 'Segmenting', 'progress': 20})
    segmented_mask = segment_object(image, mask)
    
    # Step 2: Inpaint with LaMa
    self.update_state(state='PROGRESS', meta={'current': 'Inpainting', 'progress': 60})
    result = inpaint_cleanup(image, Image.fromarray(segmented_mask))
    
    # Save
    result_b64 = image_to_base64(result)
    redis_client = redis.Redis()
    redis_client.hset(
        f"task:{task_id}",
        mapping={'status': 'completed', 'result_image': result_b64}
    )

# Pipeline orchestration
def start_generative_fill_pipeline(image_b64, mask_b64, prompt):
    """Execute multiple models in sequence if needed"""
    
    pipeline = chain(
        task_generative_fill.s(image_b64, mask_b64, prompt),
        # Optional: cleanup with LaMa
        # task_refine_inpaint.s()
    )
    
    result = pipeline.apply_async()
    return result.id
```

---

## 3. QUANTIZATION & OPTIMIZATION

### 3.1 Model Quantization (FP16 → INT8)

```python
import torch
from torch.quantization import quantize_dynamic

# Convert SDXL to INT8 (smaller + faster)
quantized_model = quantize_dynamic(
    pipeline.unet,
    {torch.nn.Linear},
    dtype=torch.qint8
)

# Memory savings:
# • Original: 4.5GB
# • Quantized: 2.2GB (-50%)
# • Inference: -20% faster

# Tradeoff: quality slightly reduced but imperceptible
```

### 3.2 Flash Attention (Memory efficient)

```python
from torch.nn.attention import scaled_dot_product_attention

# Enable in pipeline
pipeline.enable_attention_slicing()  # or
pipeline.enable_xformers_memory_efficient_attention()

# Results:
# • Memory: -30%
# • Speed: +15%
# • Quality: identical
```

### 3.3 Batch Processing

```python
def batch_inpaint(batch: List[InpaintRequest]) -> List[PIL.Image]:
    """Process multiple images simultaneously"""
    
    images = torch.stack([r.image for r in batch])
    masks = torch.stack([r.mask for r in batch])
    prompts = [r.prompt for r in batch]
    
    # Batch inference (4x faster than sequential)
    results = pipeline(
        prompt=prompts,
        image=images,
        mask_image=masks,
        num_inference_steps=20  # Fewer steps for batch
    )
    
    return results.images
```

---

## 4. ERROR HANDLING & FALLBACKS

### 4.1 Graceful Degradation

```python
class AIServiceWithFallbacks:
    def __init__(self):
        self.primary = SDXLPipeline()
        self.fallback1 = SDv15Inpaint()  # Smaller, faster
        self.fallback2 = ReplicateAPI()  # External API
    
    async def inpaint(
        self,
        image: PIL.Image,
        mask: PIL.Image,
        prompt: str,
        retry_count: int = 0
    ) -> PIL.Image:
        """Try primary, fallback to smaller models, then API"""
        
        try:
            # Try SDXL (best quality)
            return self.primary.inpaint(image, mask, prompt)
        
        except torch.cuda.OutOfMemoryError:
            logging.warning("SDXL OOM, using SD v1.5")
            # Clear VRAM
            torch.cuda.empty_cache()
            try:
                return self.fallback1.inpaint(image, mask, prompt)
            except Exception as e:
                logging.warning("SD v1.5 failed, using Replicate")
                return await self.fallback2.inpaint(image, mask, prompt)
        
        except Exception as e:
            logging.error(f"All inpaint methods failed: {e}")
            raise InpaintError(f"Failed after {retry_count} retries")
```

### 4.2 Content Filtering

```python
from better_profanity import profanity

def filter_prompt(prompt: str) -> bool:
    """Reject harmful prompts"""
    
    blacklist_keywords = [
        "nudity", "violence", "hate", "gore"
    ]
    
    # Check direct words
    if any(k in prompt.lower() for k in blacklist_keywords):
        return False
    
    # Check profanity
    if profanity.contains_profanity(prompt):
        return False
    
    return True
```

---

## 5. MONITORING & METRICS

```python
import time
from prometheus_client import Counter, Histogram

# Metrics
inpaint_counter = Counter(
    'ai_inpaint_total',
    'Total inpaint requests',
    ['status']
)

inpaint_latency = Histogram(
    'ai_inpaint_latency_seconds',
    'Inpaint latency in seconds',
    buckets=[1, 5, 10, 15, 20, 30, 60]
)

gpu_vram_usage = Gauge(
    'gpu_vram_used_bytes',
    'GPU VRAM used in bytes'
)

def track_inpaint(prompt: str, model_name: str):
    """Decorator to track metrics"""
    
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            start = time.time()
            try:
                result = await func(*args, **kwargs)
                inpaint_counter.labels(status='success').inc()
                return result
            except Exception as e:
                inpaint_counter.labels(status='error').inc()
                raise
            finally:
                elapsed = time.time() - start
                inpaint_latency.observe(elapsed)
                gpu_vram_usage.set(torch.cuda.memory_allocated())
        
        return wrapper
    return decorator
```

---

## 6. COST ANALYSIS (AWS)

| Component | Cost/Month | Notes |
| --- | --- | --- |
| **g4dn.xlarge GPU** | $600 | 1x NVIDIA T4 GPU (16GB VRAM) |
| **Spot instance** | $180 | 70% discount |
| **RDS Postgres** | $100 | Database |
| **ElastiCache Redis** | $50 | Cache/Queue |
| **S3 Storage** | $20-100 | Depends on volume |
| ****TOTAL** | **$850-1100** | **Year 1** |

**Cost per inference:**
- Model download: $0.0001 (amortized)
- GPU compute (15 sec @ $0.60/hr): $0.0025
- Storage/bandwidth: $0.0005
- **Total: $0.003 per inference**

At 100 inpaints/day = $0.30/day = $9/month per user (profitable at $10/mo premium)

