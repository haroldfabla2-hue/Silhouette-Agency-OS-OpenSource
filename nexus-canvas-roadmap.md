# 📊 ROADMAP DETALLADO: 20 Semanas a Producción
## Phase-by-Phase Breakdown

**Versión:** 2.0  
**Fecha:** 28 Diciembre 2025  
**Estado:** Pre-Development

---

## TIMELINE OVERVIEW

```
WEEK 1-4      WEEK 5-8      WEEK 9-12     WEEK 13-16    WEEK 17-20
├─ Phase 1    ├─ Phase 2    ├─ Phase 3    ├─ Phase 4    ├─ Phase 5
├─ Core       ├─ Paint      ├─ IA         ├─ Type/Vec   ├─ Polish
├─ Engine     ├─ Tools      ├─ Integration├─ Typography ├─ Launch
└─ MVP 0.1    └─ MVP 0.2    └─ MVP 1.0    └─ v1.5       └─ v2.0
```

---

## PHASE 1: CORE ENGINE (Weeks 1-4)

### Week 1: Foundation
**Goal:** Project setup, architecture decisions, team onboarding

#### Tasks
- [ ] Create GitHub repo + branch strategy
- [ ] Setup development environment (Docker, Python venv)
- [ ] Configure CI/CD pipeline (GitHub Actions)
- [ ] Database schema design & migration setup
- [ ] API boilerplate (FastAPI structure)
- [ ] React project initialization (Vite)

#### Deliverables
- GitHub repo with CI/CD working
- Backend health check endpoint
- Frontend "Hello Canvas" component

#### Hours: 80h (1 engineer)

---

### Week 2: Layer System & State Management
**Goal:** Build the layer architecture (heart of the application)

#### Backend Tasks
```python
# models/layer.py
- Layer data model (Pydantic)
- CRUD operations (Create, Read, Update, Delete)
- Layer ordering logic (z-index)
- Blending mode constants

# routers/canvas.py
POST /canvas/documents
  └─ Create new document (1920x1080, sRGB)

POST /canvas/layers
  └─ Add layer to document

PATCH /canvas/layers/{id}
  └─ Update layer (opacity, blend mode, visibility)

DELETE /canvas/layers/{id}
  └─ Remove layer
```

#### Frontend Tasks
```typescript
// store/useCanvasStore.ts
- Zustand store initialization
- Layer state management
- Document structure
- History/undo-redo foundation

// components/LayerPanel.tsx
- Layer list UI
- Add/delete layer buttons
- Opacity slider
- Visibility toggle

// hooks/useLayer.ts
- useLayerById(id)
- useAddLayer()
- useDeleteLayer(id)
- useUpdateLayer(id, updates)
```

#### Deliverables
- Working layer CRUD
- Layer panel UI mockup
- API tests (Postman)
- Frontend tests (Vitest)

#### Hours: 160h (2 engineers)

---

### Week 3: Canvas Rendering (Pixi.js)
**Goal:** Get pixels on screen, layer composition working

#### Tasks
```typescript
// engine/CanvasEngine.ts
class CanvasEngine {
  - Initialize Pixi.Application
  - Layer rendering loop
  - Viewport pan & zoom
  - 60fps frame rate
  - Texture caching
}

// engine/blending.ts
- Implement blending mode mapping
- Test all 25+ modes
- GPU-accelerated (Pixi native)

// components/Canvas.tsx
- Mount Pixi to DOM
- Handle window resize
- Keyboard shortcuts (pan, zoom)
```

#### Testing
- [ ] Create test layers, verify blend modes
- [ ] Zoom in/out, pan around
- [ ] Check FPS (target: 60fps)
- [ ] Memory profiling (target: <500MB)

#### Deliverables
- Live canvas rendering 60fps
- Working zoom/pan controls
- Blend mode showcase
- Performance baseline

#### Hours: 120h (1.5 engineers)

---

### Week 4: Integration & MVP 0.1 Release
**Goal:** Connect frontend + backend, basic workflow

#### Tasks
- [ ] API-Frontend connection (axios client)
- [ ] Document save/load
- [ ] Export PNG/JPG
- [ ] Error handling
- [ ] Logging setup
- [ ] Documentation

#### Testing
- [ ] End-to-end workflow (create doc → add layers → export)
- [ ] Load testing (50 layers max?)
- [ ] Cross-browser testing

#### Deliverables
- **MVP 0.1** released (basic editor)
- Changelog + release notes
- Deployment to staging

#### Hours: 100h

---

## PHASE 2: PAINT TOOLS (Weeks 5-8)

### Week 5: Brush Engine
**Goal:** Implement core painting functionality

#### Tasks
```typescript
// engine/Brush.ts
class Brush {
  - Size, hardness, opacity, flow
  - Dynamic pressure sensitivity
  - Brush presets
  - Texture/pattern support
}

// tools/BrushTool.ts
class BrushTool extends Tool {
  - onMouseDown: start stroke
  - onMouseMove: paint
  - onMouseUp: commit to layer
}

// Pixel operations
- Apply brush color to layer
- Alpha blending
- Pressure simulation
```

#### UI
```typescript
// components/BrushPanel.tsx
- Size slider (1-500px)
- Hardness slider (0-100%)
- Opacity slider (0-100%)
- Flow slider (0-100%)
- Mode selector (Normal, etc)
```

#### Hours: 120h

---

### Week 6: Selection Tools
**Goal:** Marquee, lasso, quick select

#### Tools to implement
1. Rectangular Marquee
2. Elliptical Marquee
3. Lasso (free-draw)
4. Polygonal Lasso
5. Magic Wand (color-based)

#### Hours: 100h

---

### Week 7: Retouching Tools
**Goal:** Clone, Healing, Dodge/Burn

```typescript
// tools/CloneTool.ts
- Alt+click to set source
- Paint to clone from source
- Offset calculation

// tools/HealingBrush.ts
- Similar to clone
- Blend edges better
- Content-aware blend

// tools/DodgeBurn.ts
- Lighten/darken
- Exposure slider
```

#### Hours: 80h

---

### Week 8: Color System & MVP 0.2
**Goal:** Color picker, swatches, gradients

#### Tasks
- [ ] Color picker (HEX, RGB, HSL)
- [ ] Eyedropper tool
- [ ] Foreground/background colors
- [ ] Swatches panel
- [ ] Gradients (linear, radial)
- [ ] All paint tools tested

#### Deliverables
- **MVP 0.2** (functional paint application)
- User manual for paint tools
- Video tutorial

#### Hours: 100h

---

## PHASE 3: AI INTEGRATION (Weeks 9-12) ⭐ CRITICAL

### Week 9: Backend AI Setup
**Goal:** Load models, setup inference pipeline

#### Tasks
```python
# Download and cache models
- Stable Diffusion XL (4GB)
- SAM2 (1GB)
- LaMa (2GB)
- rembg (200MB)

# Setup CUDA environment
- NVIDIA drivers
- cuDNN
- PyTorch CUDA kernels

# FastAPI endpoints
POST /api/ai/generative-fill
  ├─ input: image_base64, mask_base64, prompt
  ├─ queue in Redis
  └─ return task_id

POST /api/ai/smart-remove
  ├─ input: image_base64, brush_mask
  └─ return result_image

POST /api/ai/remove-background
  ├─ input: image_base64
  └─ return PNG with alpha
```

#### Testing
- [ ] Model loading time (<5s)
- [ ] Inference latency (<15s)
- [ ] Memory usage (<10GB)

#### Hours: 160h (2 engineers)

---

### Week 10: Frontend AI Integration
**Goal:** UI for AI features, task polling

#### Tasks
```typescript
// components/GenerativeFillModal.tsx
- Prompt input field
- Negative prompt (advanced)
- Steps slider (10-50)
- Guidance scale (1-20)
- Progress bar
- Cancel button

// hooks/useAI.ts
export const useGenerativeFill = (
  layerId: string,
  selectionMask: Uint8Array,
  prompt: string
) => {
  // Send to backend
  // Poll for result
  // Create new layer on complete
  // Handle errors
}
```

#### Workflow
1. User selects region (Lasso tool)
2. Right-click → "Generative Fill"
3. Modal opens
4. User types prompt
5. Click "Generate"
6. Polling starts
7. New layer created when done

#### Hours: 120h

---

### Week 11: Advanced AI Features
**Goal:** Smart Remove, Background Removal, Variations

```typescript
// Smart Remove
1. User brushes over object
2. Backend runs SAM2 to segment
3. Runs LaMa to inpaint
4. Returns clean image
5. New layer created

// Background Removal
1. One click on "Remove BG"
2. rembg runs
3. PNG with transparency
4. Layer created

// Image Variations
1. User clicks "Variations"
2. Generates 3 alternatives (img2img)
3. Each in separate hidden layer
4. User swipes between them
```

#### Hours: 100h

---

### Week 12: Testing & MVP 1.0 Release
**Goal:** AI features production-ready

#### Testing
- [ ] Generative Fill quality (subjective)
- [ ] Latency (<15s target)
- [ ] Error handling (OOM, bad prompt)
- [ ] Content filtering
- [ ] Load testing (concurrent requests)

#### Deliverables
- **MVP 1.0** (full AI editor)
- AI feature tutorial video
- Prompt engineering guide
- Launch press release

#### Hours: 100h

---

## PHASE 4: TYPOGRAPHY & VECTORS (Weeks 13-16)

### Week 13: Text Engine
**Goal:** Add text layers, font support

```typescript
// models/TextLayer.ts
interface TextLayer extends Layer {
  type: 'text'
  text: {
    content: string
    fontFamily: string
    fontSize: number
    color: Color
    alignment: 'left' | 'center' | 'right'
    lineHeight: number
    letterSpacing: number
  }
}

// Font loading
- Google Fonts API
- Custom font upload
- Font preview

// Text rendering
- Canvas 2D text rendering
- Export to Pixi texture
```

#### Hours: 120h

---

### Week 14: Text Effects
**Goal:** Shadows, strokes, transforms

- Text shadows (offset, blur, color)
- Text strokes (width, color)
- Text transformations (rotation, scale, skew)
- Warp text (on path, distortion)

#### Hours: 80h

---

### Week 15: Vector Tools
**Goal:** Pen tool, shapes, paths

```typescript
// Pen Tool (Bézier curves)
- Click to add points
- Drag to create curves
- Delete/move points
- Convert to raster

// Shape Tools
- Rectangle (with rounded corners)
- Ellipse
- Polygon
- Line
- Custom shapes

// Stroke & Fill
- Stroke width
- Stroke color
- Fill color
- Dashes/patterns
```

#### Hours: 140h

---

### Week 16: Integration & v1.5 Release
**Goal:** All text/vector features working

#### Deliverables
- **v1.5** released
- Typography guide
- Vector tutorial

#### Hours: 80h

---

## PHASE 5: POLISH & PRODUCTION (Weeks 17-20)

### Week 17: Performance Optimization
**Goal:** 60fps guaranteed, <100ms interactions

#### Tasks
- [ ] Profile rendering (Chrome DevTools)
- [ ] Optimize texture caching
- [ ] Layer texture pooling
- [ ] WebGL batch rendering
- [ ] Lazy load models
- [ ] Memory leak hunting

#### Benchmarks
- [ ] 50 layers, 4K resolution, 60fps
- [ ] Export 4K in <2 seconds
- [ ] Undo/redo <100ms latency
- [ ] AI generation <15s

#### Hours: 120h

---

### Week 18: Testing & QA
**Goal:** Zero critical bugs

#### Testing
- [ ] Unit tests (90%+ coverage)
- [ ] Integration tests
- [ ] E2E tests (Cypress)
- [ ] Performance tests
- [ ] Cross-browser testing
- [ ] Mobile responsive

#### QA
- [ ] Usability testing with 10 users
- [ ] Feedback collection
- [ ] Bug fixes (priority-based)

#### Hours: 140h

---

### Week 19: Documentation & Onboarding
**Goal:** Smooth user experience

#### Tasks
- [ ] User manual (PDF + interactive)
- [ ] Video tutorials (YouTube)
- [ ] In-app tooltips
- [ ] Keyboard shortcuts reference
- [ ] API documentation
- [ ] Developer guide

#### Hours: 100h

---

### Week 20: Launch & Monitoring
**Goal:** Production deployment

#### Tasks
- [ ] Final security audit
- [ ] Performance load testing (1000 users)
- [ ] Database backup strategy
- [ ] Monitoring setup (Sentry, DataDog)
- [ ] Incident response plan
- [ ] Launch announcement

#### Deliverables
- **v2.0** production release
- Marketing launch
- Support team training

#### Hours: 80h

---

## TOTAL EFFORT

```
Phase 1: 460 hours  (Core)
Phase 2: 480 hours  (Paint)
Phase 3: 480 hours  (AI) ← Most complex
Phase 4: 420 hours  (Text/Vectors)
Phase 5: 440 hours  (Polish)
─────────────────────────
TOTAL:  2,280 hours

Team: 3-4 engineers × 20 weeks
      = ~7-9 person-months
      = $200-280k (salary costs only)
```

---

## RISK MITIGATION

| Risk | Mitigation | Contingency |
| --- | --- | --- |
| GPU memory issues | Early profiling | Use smaller model (SD v1.5) |
| Model licensing | Verify licenses | Switch to open-source alternative |
| Browser compatibility | Test early | Polyfills / Canvas fallback |
| Team attrition | Clear milestones | Cross-training |
| Scope creep | Strict acceptance criteria | Phase 2 for new features |

---

## SUCCESS METRICS

### By Week
- **Week 4:** MVP 0.1 working (100k MAU ready)
- **Week 8:** MVP 0.2 feature complete (paint tools)
- **Week 12:** MVP 1.0 with AI (launch candidate)
- **Week 16:** v1.5 full feature parity
- **Week 20:** v2.0 production quality

### Quality Metrics
- 60fps consistently on most hardware
- <50ms brush latency
- <15s AI generation
- <100ms undo/redo
- Zero critical bugs (launch day)

---

**Next: Approve timeline, assign team, begin Week 1 planning**

