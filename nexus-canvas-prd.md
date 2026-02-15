# 📋 PRD: Nexus Canvas 2.0
## El Clon Profesional de Photoshop con Integración IA Native

**Versión:** 2.0.0 (MVP Completo)  
**Última Actualización:** 28 de Diciembre, 2025  
**Owner del Producto:** Brandistry Tech Strategy Team  
**Status:** `Approved for Development - Phase 1` ✅

---

## 1. VISIÓN EJECUTIVA

### Propósito Principal
**Nexus Canvas** es un editor gráfico profesional embebido en la web que redefine cómo los usuarios interactúan con imágenes generadas por IA. A diferencia de los editores web genéricos:

1. **Arquitectura idéntica a Photoshop:** Sistema de capas multinivel, modos de fusión matemáticos, máscaras de selección binarias.
2. **IA nativa en el core:** No es una "feature añadida", sino la médula espinal del editor. Cada selección puede convertirse en un prompt para Stable Diffusion/Flux/DALL-E.
3. **Rendimiento GPU:** Usando WebGL (Pixi.js) en lugar de Canvas API puro, garantizamos 60fps incluso con 50+ capas.
4. **Integración sin fricción:** El editor vive en una pestaña de tu web app existente. Las imágenes generadas por IA llegan al canvas como Layer 1 automáticamente.

---

## 2. STACK TECNOLÓGICO (Production-Ready)

### Frontend
```
React 19.0+ (component framework)
TypeScript 5.3+ (strict mode, type safety)
Zustand 5.0+ (state management, minimal boilerplate)
Pixi.js 8.0+ (WebGL 2.0, 60fps rendering)
Tailwind CSS 4.0 (styling, utility-first)
Vite 5.0 (build tool, <1s HMR)
```

### Backend
```
FastAPI 0.100+ (async Python, high throughput)
Python 3.11+ (async/await, modern syntax)
Stable Diffusion XL (SOTA inpainting quality)
SAM 2 (Segment Anything Model 2, detection)
LaMa (Large Mask Inpainting, cleanup)
rembg (Background removal, u2net model)
PostgreSQL 15+ (persistence, ACID compliance)
Redis 7.0+ (caching, job queue)
```

### Infrastructure
```
NVIDIA CUDA 12.0+ (GPU acceleration)
Docker + Kubernetes (containerization, orchestration)
AWS/GCP (cloud deployment)
CDN (CloudFront/Bunny for static assets)
```

---

## 3. FEATURES CORE (MVP PHASE 1)

### 3.1 Sistema de Capas
- ✅ Capas ilimitadas, multinivel
- ✅ Drag & drop para reordenar
- ✅ Thumbnails en tiempo real
- ✅ Visibilidad (eye toggle)
- ✅ Bloqueo (lock toggle)
- ✅ Renombrar capas
- ✅ Crear/Eliminar capas
- ✅ Opacidad por capa (0-100%)
- ✅ Modos de fusión (25+)
- ✅ Máscaras de capa
- ✅ Grupos de capas

### 3.2 Herramientas de Selección
- ✅ Rectangular Marquee
- ✅ Elliptical Marquee
- ✅ Lasso Tool
- ✅ Polygonal Lasso
- ✅ Magnetic Lasso
- ✅ Quick Selection
- ✅ Magic Wand / Select by Color
- ✅ Object Selection (AI-powered)

### 3.3 Herramientas de Pintura
- ✅ Brush (dinámicas: tamaño, dureza, opacidad, flow)
- ✅ Pencil (hard edges)
- ✅ Eraser
- ✅ Clone Stamp
- ✅ Healing Brush
- ✅ Dodge/Burn/Sponge

### 3.4 Herramientas de Texto
- ✅ Horizontal Type
- ✅ Vertical Type
- ✅ Font family selector (Google Fonts + custom)
- ✅ Font size, weight, style
- ✅ Line height, letter spacing
- ✅ Text shadows & strokes
- ✅ Kerning, ligaduras

### 3.5 Herramientas de Vector
- ✅ Pen Tool (Bézier paths)
- ✅ Shape Tools (Rect, Ellipse, Polygon, Line)
- ✅ Stroke & Fill controls
- ✅ Path editing (add/remove/convert points)

### 3.6 IA Integration (THE KILLER FEATURES)

#### Generative Fill
1. Usuario dibuja selección
2. Escribe prompt: "sunset, Van Gogh style"
3. Sistema envía: {image_base64, mask_base64, prompt}
4. Backend ejecuta Stable Diffusion XL Inpainting
5. Resultado se crea como nueva capa con máscara

#### Smart Remove
1. Usuario selecciona objeto
2. Backend ejecuta SAM2 + LaMa
3. Objeto se elimina limpiamente
4. Nueva capa con resultado

#### Background Removal
1. Un click en botón
2. rembg elimina fondo automáticamente
3. PNG con alpha channel

#### Image Variations
1. Genera 3 alternativas de imagen
2. Con img2img (Stable Diffusion)
3. Cada una en capa separada (hidden by default)

### 3.7 Modos de Fusión (25+)
Normal, Multiply, Screen, Overlay, Soft Light, Hard Light, Color Dodge, Color Burn, Lighten, Darken, Linear Dodge, Linear Burn, Vivid Light, Pin Light, Difference, Exclusion, Hue, Saturation, Color, Luminosity, + 5 más

### 3.8 Historial
- ✅ Undo/Redo (max 100 estados)
- ✅ Visual history panel
- ✅ State snapshots con metadata

### 3.9 Exportación
- ✅ PNG (con alpha)
- ✅ JPG (adjustable quality)
- ✅ WebP
- ✅ PSD (Photoshop format, future)
- ✅ SVG (vectors only, future)

---

## 4. ESPECIFICACIÓN TÉCNICA DETALLADA

### 4.1 Data Model (JSON Schema)

```typescript
interface NexusDocument {
  id: string;
  name: string;
  version: "2.0";
  createdAt: ISO8601;
  updatedAt: ISO8601;
  
  dimensions: {
    width: number;
    height: number;
    dpi: number;
    colorProfile: "sRGB" | "AdobeRGB" | "ProPhoto";
  };
  
  layers: Layer[];
  layerGroups: LayerGroup[];
  history: HistoryState[];
  historyIndex: number;
  
  metadata: {
    lastTool: Tool;
    lastColor: Color;
    lastBrushSettings: BrushSettings;
    viewportZoom: number;
    viewportPosition: { x: number; y: number };
  };
}

interface Layer {
  id: string;
  name: string;
  type: "raster" | "vector" | "text" | "adjustment" | "group";
  visible: boolean;
  locked: boolean;
  lockAlpha: boolean;
  lockPosition: boolean;
  
  blendMode: BlendMode;
  opacity: number; // 0-100
  clippingMask: boolean;
  
  transform: {
    x: number;
    y: number;
    rotation: number;
    scale: { x: number; y: number };
    skewX: number;
    skewY: number;
  };
  
  raster?: {
    width: number;
    height: number;
    imageData: ImageDataBlob;
    pixelData?: ArrayBuffer;
    filters: PixelFilter[];
  };
  
  text?: {
    content: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: 100 | 400 | 700 | 900;
    fontStyle: "normal" | "italic";
    lineHeight: number;
    letterSpacing: number;
    color: Color;
    alignment: "left" | "center" | "right" | "justify";
    textDecoration: "none" | "underline" | "line-through";
    wrapText: boolean;
    shadow?: TextShadow;
    stroke?: TextStroke;
  };
  
  mask?: {
    id: string;
    imageData: ImageDataBlob;
    inverted: boolean;
    density: number;
  };
  
  vector?: {
    paths: BezierPath[];
    strokeWidth: number;
    strokeColor: Color;
    fillColor: Color;
  };
  
  metadata: {
    aiGenerated: boolean;
    generationPrompt?: string;
    generationModel?: "stable-diffusion-xl" | "flux" | "dalle-3";
    sourceImageId?: string;
  };
}
```

### 4.2 Rendering Pipeline (Pixi.js)

```typescript
class CompositeEngine {
  async renderDocument(doc: NexusDocument): Promise<PIXI.Texture> {
    const canvas = new PIXI.Container();
    
    for (const layer of doc.layers.filter(l => l.visible)) {
      const pixiLayer = await this.layerToPixiSprite(layer, doc.dimensions);
      
      pixiLayer.blendMode = this.mapBlendMode(layer.blendMode);
      pixiLayer.alpha = layer.opacity / 100;
      
      pixiLayer.position.set(layer.transform.x, layer.transform.y);
      pixiLayer.rotation = (layer.transform.rotation * Math.PI) / 180;
      pixiLayer.scale.set(layer.transform.scale.x, layer.transform.scale.y);
      
      if (layer.mask) {
        pixiLayer.mask = await this.maskToPixiMask(layer.mask);
      }
      
      canvas.addChild(pixiLayer);
    }
    
    return canvas.renderTexture as PIXI.Texture;
  }
  
  private blendPixel(
    base: Uint8ClampedArray,
    blend: Uint8ClampedArray,
    mode: BlendMode
  ): Uint8ClampedArray {
    const result = new Uint8ClampedArray(4);
    
    switch (mode) {
      case "NORMAL":
        const alpha = blend[3] / 255;
        result[0] = Math.round(blend[0] * alpha + base[0] * (1 - alpha));
        result[1] = Math.round(blend[1] * alpha + base[1] * (1 - alpha));
        result[2] = Math.round(blend[2] * alpha + base[2] * (1 - alpha));
        result[3] = Math.max(base[3], blend[3]);
        break;
      
      case "MULTIPLY":
        result[0] = (blend[0] * base[0]) / 255;
        result[1] = (blend[1] * base[1]) / 255;
        result[2] = (blend[2] * base[2]) / 255;
        result[3] = blend[3];
        break;
      
      case "SCREEN":
        result[0] = 255 - ((255 - blend[0]) * (255 - base[0])) / 255;
        result[1] = 255 - ((255 - blend[1]) * (255 - base[1])) / 255;
        result[2] = 255 - ((255 - blend[2]) * (255 - base[2])) / 255;
        result[3] = blend[3];
        break;
      
      case "OVERLAY":
        for (let i = 0; i < 3; i++) {
          const bn = base[i] / 255;
          const sn = blend[i] / 255;
          result[i] = Math.round(
            (bn <= 0.5
              ? 2 * sn * bn
              : 1 - 2 * (1 - sn) * (1 - bn)) * 255
          );
        }
        result[3] = blend[3];
        break;
    }
    
    return result;
  }
}
```

---

## 5. INTEGRACIÓN IA (Backend - FastAPI)

### 5.1 Generative Fill

```python
from fastapi import APIRouter, Form
from diffusers import StableDiffusionXLInpaintPipeline
import torch
from PIL import Image
import base64
import io

router = APIRouter(prefix="/api/ai", tags=["AI"])

# Load model once, cache in memory
pipe = StableDiffusionXLInpaintPipeline.from_pretrained(
    "stabilityai/stable-diffusion-xl-base-1.0",
    torch_dtype=torch.float16
).to("cuda")

@router.post("/generative-fill")
async def generative_fill(
    image_base64: str = Form(...),
    mask_base64: str = Form(...),
    prompt: str = Form(...),
    negative_prompt: str = Form(default="blurry, low quality"),
    strength: float = Form(default=0.8),
    guidance_scale: float = Form(default=7.5),
    steps: int = Form(default=30)
):
    """Inpainting generativo con prompt"""
    
    # Decode
    image = Image.open(io.BytesIO(base64.b64decode(image_base64)))
    mask = Image.open(io.BytesIO(base64.b64decode(mask_base64)))
    
    # Resize
    image = image.resize((512, 512), Image.LANCZOS)
    mask = mask.resize((512, 512), Image.NEAREST)
    
    # Validate mask
    mask_array = np.array(mask.convert("L"))
    mask_array = (mask_array > 127).astype(np.uint8) * 255
    mask = Image.fromarray(mask_array)
    
    # Generate
    with torch.no_grad():
        result = pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            image=image,
            mask_image=mask,
            strength=strength,
            guidance_scale=guidance_scale,
            num_inference_steps=steps,
            generator=torch.Generator("cuda").manual_seed(42)
        ).images[0]
    
    # Convert to base64
    buffered = io.BytesIO()
    result.save(buffered, format="PNG")
    result_base64 = base64.b64encode(buffered.getvalue()).decode()
    
    return {
        "success": True,
        "image_base64": result_base64,
        "prompt_used": prompt,
        "model": "stable-diffusion-xl-inpaint"
    }
```

### 5.2 Smart Remove (SAM2 + LaMa)

```python
from segment_anything import sam_model_registry, SamPredictor

sam = sam_model_registry["vit_b"](checkpoint="sam_vit_b_01ec64.pth")
predictor = SamPredictor(sam)

@router.post("/smart-remove")
async def smart_remove(
    image_base64: str = Form(...),
    brush_strokes: list = Form(...)
):
    """Detecta y elimina objeto con SAM + LaMa"""
    
    image = Image.open(io.BytesIO(base64.b64decode(image_base64)))
    image_array = np.array(image)
    
    # SAM2 predict
    predictor.set_image(image_array)
    points = np.array([[s["x"], s["y"]] for s in brush_strokes])
    masks, scores, _ = predictor.predict(
        point_coords=points,
        point_labels=np.ones(len(points))
    )
    
    mask = masks[np.argmax(scores)]
    
    # LaMa inpaint
    lama_result = lama_inpainter(image_array, mask)
    
    buffered = io.BytesIO()
    Image.fromarray(lama_result).save(buffered, format="PNG")
    result_base64 = base64.b64encode(buffered.getvalue()).decode()
    
    return {
        "success": True,
        "image_base64": result_base64,
        "model": "LaMa + SAM2"
    }
```

### 5.3 Background Removal

```python
from rembg import remove

@router.post("/remove-background")
async def remove_background(
    image_base64: str = Form(...),
    background_color: str = Form(default="transparent")
):
    """Elimina fondo con rembg"""
    
    image = Image.open(io.BytesIO(base64.b64decode(image_base64)))
    output = remove(image)
    
    if background_color != "transparent":
        bg = Image.new("RGB", output.size, background_color)
        bg.paste(output, mask=output.split()[3])
        output = bg
    
    buffered = io.BytesIO()
    output.save(buffered, format="PNG")
    result_base64 = base64.b64encode(buffered.getvalue()).decode()
    
    return {
        "success": True,
        "image_base64": result_base64,
        "model": "rembg"
    }
```

---

## 6. INTERFAZ DE USUARIO

### Layout
```
┌─────────────────────────────────────────────────────┐
│  File  Edit  Image  Select  Filter  Window  Help    │  TOP BAR
├─────────────────────────────────────────────────────┤
│ │ Tools    │           CANVAS (Center)     │ Panels │
│ │          │  ┌────────────────────────┐   │        │
│ │ B M E... │  │                        │   │ Layers │
│ │ (Icons)  │  │    Artboard + Layers   │   │ History│
│ │          │  │                        │   │ Colors │
│ │ V A C... │  └────────────────────────┘   │ Brushes│
│ │          │                               │        │
└──┴──────────┴───────────────────────────────┴────────┘
```

### Top Options Bar (Context-sensitive)
```
Brush: ▼ | Size: 25px | Hardness: 75% | Opacity: 100% | 
Mode: Normal ▼ | Flow: 50% | Spacing: 25%
```

### Layers Panel
```
┌─ New Layer Button +
├─────────────────────────────────────────
│ [⏷] [🖼] [Layer Name]  [dropdown] 100% [👁] [🔒] [✕]
│     [thumbnail]        [Blend]   [opacity][eye][lock][del]
├─────────────────────────────────────────
│ [⏷] [🖼] [Background]   Normal    100% [👁] [🔒] [✕]
│     [thumbnail]
└─────────────────────────────────────────
```

---

## 7. ROADMAP (20 SEMANAS)

### Phase 1: Core Engine (Weeks 1-4) ✓
- Layer system with proper Z-index
- Pixi.js canvas rendering
- Basic tools (Move, Zoom, Pan)
- Layer panel UI
- Undo/Redo
- Export PNG/JPG

### Phase 2: Paint Tools (Weeks 5-8) ✓
- Brush engine (dinámicas)
- Eraser, Clone, Healing
- Color picker
- 25+ blending modes
- Brush settings panel
- Brush presets

### Phase 3: IA Integration (Weeks 9-12) ⭐ CRITICAL
- Generative Fill
- Smart Remove (SAM2 + LaMa)
- Background Removal (rembg)
- Image Variations
- ControlNet support

### Phase 4: Typography & Vectors (Weeks 13-16)
- Text engine
- Font loading
- Kerning, line-height
- Text shadows & strokes
- Pen tool (Bézier)
- Shape tools

### Phase 5: Polish & Production (Weeks 17-20)
- Performance optimization
- Keyboard shortcuts
- Smart guides
- UI refinement
- Testing
- Documentation

---

## 8. PERFORMANCE TARGETS

| Operación | Target | Herramienta |
| --- | --- | --- |
| **Zoom in/out** | 60fps | Chrome DevTools |
| **Pan canvas** | 60fps | Lighthouse |
| **Brush stroke latency** | <50ms | Performance Observer |
| **Undo/Redo** | <100ms | Date.now() timing |
| **Export PNG (4K)** | <2s | Network timing |
| **Generative Fill** | <15s | API response time |

---

## 9. MÉTRICAS DE ÉXITO

### Técnicas
- 60fps pan/zoom
- <100ms undo/redo
- <2s export 4K
- <15s Generative Fill

### Producto
- 85%+ user satisfaction
- 50%+ users use AI features
- <3 min average edit time
- 0 critical bugs

### Negocio
- +30% user retention
- +20% conversion free→premium
- <$2 cost per AI generation
- +40% session duration

---

**Documento continúa en siguiente parte...** 

*Esta es la Parte 1 del PRD Completo. Contiene la visión, stack, features, especificaciones técnicas y roadmap.*

