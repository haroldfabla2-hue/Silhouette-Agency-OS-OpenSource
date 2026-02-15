# PA-011: Expansión de "Skills" del Agente (Ultimate Agency Studio)

> **Estado:** EN PROGRESO
> **Fecha de Inicio:** 2025-12-16
> **Objetivo:** Transformar a los agentes en un "Equipo Creativo de Agencia" de clase mundial, utilizando un stack multi-proveedor para redundancia y calidad cinematográfica.

## 1. Módulos de "Ultimate Agency Studio"

### A. The Eye & Hand (Visual Cortex 3.0)
Hemos evolucionado de un solo modelo a una **Federación de Modelos**.
- **Motor Principal (Replicate):** `google/nano-banana-pro` (Gemini 3 Pro Image). Calidad Suprema.
- **Motor Secundario (Freepik & ImagineArt):** Para estilos específicos (Vectorial, Ilustración) y redundancia.
- **Motor de Respaldo (Stability XL):** Generación base robusta.
- **Video Engine:**
    - **Tier 1:** `Veo 3` (Google). Coherencia máxima.
    - **Tier 2:** `ImagineArt Video`. Estilizado.
- **Assets Reales:** `Unsplash API`.

### B. The Voice (Audio Cortex)
- **Motor de Voz:** `ElevenLabs`. Narración emotiva y clonación de voz.

### C. The Brain (Search & context)
- **Búsqueda Profunda:** `Tavily API`. Optimizado para agentes de IA (menos ruido que Google Search).

## 2. Plan de Ejecución

### Fase 1: Gestión de Credenciales (KeyVault)
- [x] **Seguridad:** Inyectar claves en `.env.local` (Replicate, Veo, ElevenLabs, Freepik, Tavily, ImagineArt, Unsplash).
- [x] **Config:** Actualizar `GenesisConfig` en `types.ts` para soportar este mapa de proveedores.

### Fase 2: Servicios de Media (The Factory)
- [x] **Image Hub:** Crear `services/media/imageFactory.ts`.
    - Pattern: **Router**. Si el prompt pide "Realista" -> Nano Banana. Si pide "Icono" -> Freepik.
- [x] **Video Hub:** Crear `services/media/videoFactory.ts` (Veo + ImagineArt).
- [x] **Voice Hub:** Crear `services/media/voiceFactory.ts` (ElevenLabs).
- [x] **Search Hub:** Integrar `TavilyService` como reemplazo/alternativa a Google Search.

### Fase 3: Habilidades de Agente (The Workflow)
- [x] **Creative Director:** Usa `ImageFactory` para generar storyboards.
- [x] **Copywriter:** Usa `ElevenLabs` para generar locuciones de prueba.
- [x] **Campaign Manager:** Usa `Tavily` para investigar competidores.

### Fase 4: Integración UI (Agency Dashboard)
- [x] Panel de Control de Media ("Asset Library").
- [x] Vista de "Production Pipeline" (Generando... -> Editando... -> Renderizando).

### Fase 5: Agency Organization (The Librarians)
- [x] **Librarian Squad**: Definido en `services/squads/librarianSquad.ts`.
- [/] **VFS Integration**: Escuadrón encargado de mantener orden en `virtualFileSystem.ts`.

- [ ] **Phase 6: MCP Webhooks (System Nervous System)**
    - [x] **Core**: Implement `registerResource` in `mcpServer.ts`.
    - [x] **Integration**: Connect `webhookManager` to MCP resources.
    - [ ] **Verification**: Test with `curl` to MCP endpoint.

## 3. Comandos de Verificación
- `npx tsx tests/verify_ultimate_stack.ts`
