# 🎨 PLAN DE INTEGRACIÓN: Nexus Canvas en Silhouette

**Objetivo:** Integrar el editor gráfico "Nexus Canvas" (Photoshop-like) dentro del ecosistema Silhouette, adaptando su arquitectura original (Python/FastAPI) a la infraestructura existente de Silhouette (Node.js/Express + ComfyUI/Replicate).

## 1. Estrategia de Adaptación

| Componente | Arquitectura Original (Nexus PRD) | Arquitectura Adaptada (Silhouette) | Razón |
| :--- | :--- | :--- | :--- |
| **Frontend** | React + Pixi.js + Zustand | **React + Pixi.js + Zustand** | Se mantiene idéntico. Es una arquitectura sólida y compatible con el stack actual. |
| **Backend Core** | Python (FastAPI) | **Node.js (Express)** | Para evitar fragmentar el backend. Se extenderá `media.routes.ts`. |
| **IA Inference** | Python Service (In-process ML) | **Remote Execution (ComfyUI / Replicate)** | Silhouette ya tiene `ImageFactory` que orquesta esto. No necesitamos un microservicio Python extra, usaremos la "Factoría" existente. |
| **Persistencia** | PostgreSQL | **SQLite (AssetCatalog)** | Coherencia con el sistema actual de gestión de Assets de Silhouette. |
| **Cola de Tareas** | Redis + Celery | **In-Memory / Existing Queue** | Silhouette ya tiene un gestor de cola simple. Se usará ese o se ampliará si es necesario. |

---

## 2. Roadmap de Implementación

### Fase 1: Core Engine (Frontend) 🏗️
Crear la base del editor gráfico en el cliente.
- [ ] **Estructura de Directorios:** `components/canvas/{engine, store, layers, tools, panels}`.
- [ ] **Store (Zustand):** Definir el modelo de datos `NexusDocument` y `Layer`.
- [ ] **Engine (Pixi.js):** Crear la clase `CanvasEngine` que inicialice WebGL y maneje el renderizado de texturas.
- [ ] **UI:** Crear `NexusCanvas.tsx` como contenedor principal y paneles básicos (Capas, Toolbar).

### Fase 2: Herramientas Básicas 🖌️
Implementar la interacción usuario-canvas.
- [ ] **Gestión de Capas:** Añadir, borrar, reordenar, visibilidad.
- [ ] **Herramientas de Navegación:** Pan, Zoom.
- [ ] **Herramientas de Selección:** Rectangular, Lasso (dibujar paths en Pixi).
- [ ] **Pincel Básico:** Dibujar en una textura temporal y componer.

### Fase 3: Conexión con Media Cortex (Backend) 🧠
Conectar el editor con la "Inteligencia".
- [ ] **Extensión de API:** Nuevos endpoints en `media.routes.ts` para Inpainting y Segmentación.
- [ ] **Adaptador ImageFactory:**
    - Crear método `inpaint(image, mask, prompt)` en `ImageFactory.ts`.
    - Crear/Verificar Workflow de ComfyUI para Inpainting.
    - Implementar fallback a Replicate para Inpainting (si no existe).
- [ ] **Integración en UI:** Botón "Generative Fill" que capture la selección + capa actual y llame al API.

### Fase 4: Pulido e Integración UX ✨
Hacer que se sienta parte de Silhouette.
- [ ] **Integración con Asset Library:** Poder arrastrar un Asset del panel derecho al Canvas.
- [ ] **Guardado:** Guardar el resultado como un nuevo Asset en `AssetCatalog`.
- [ ] **Estilos:** Asegurar que use el Design System de Silhouette (Glassmorphism, Tailwind).

---

## 3. Especificación Técnica de Componentes Nuevos

### 3.1 `components/canvas/store/useCanvasStore.ts`
El cerebro del estado del editor. Manejará:
- Array de Capas (`Layer[]`).
- Selección actual (`selectedLayerId`).
- Historial (`undo/redo` stack).
- Configuración de herramientas (`brushSize`, `opacity`).

### 3.2 `components/canvas/engine/CanvasEngine.ts`
La clase controladora de Pixi.js.
- `init(canvasElement)`: Arranca la aplicación Pixi.
- `renderLayer(layer)`: Convierte datos de capa a texturas.
- `updateSelection(path)`: Dibuja la "hormiga marchante" (selection marquee).

### 3.3 `services/media/imageFactory.ts` (Extensiones)
Necesitamos añadir capacidades de Inpainting.
```typescript
interface InpaintRequest {
  image: Buffer; // Base64 decode
  mask: Buffer;  // Base64 decode
  prompt: string;
  provider?: 'local' | 'replicate';
}

// Nuevo método en la clase
async inpaint(req: InpaintRequest): Promise<ImageAsset>;
```

---

## 4. Siguientes Pasos Inmediatos
1. Crear la estructura de directorios en `components/canvas`.
2. Implementar `useCanvasStore` con los tipos definidos en el PRD.
3. Crear el componente esqueleto `NexusCanvas.tsx`.
