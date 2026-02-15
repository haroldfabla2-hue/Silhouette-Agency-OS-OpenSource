# Memoria del Proyecto NanoSilhouette

Este archivo contiene hechos clave, decisiones importantes y contexto persistente específico para el proyecto NanoSilhouette. Su propósito es mantener la continuidad del contexto a través de diferentes sesiones.

---

## Directiva para el Agente CLI

Al inicio de cada sesión:
1. Lee `MAPA_DE_MD.md` para identificar archivos relevantes
2. Lee `PROJECT_MEMORY.md` (este archivo) para cargar hechos clave
3. Lee `BITACORA.md` para entender el historial reciente
4. Lee `NANOSILHOUETTE_BLUEPRINT.md` si necesitas contexto arquitectónico

---

## Hechos Clave del Proyecto

### Arquitectura
- **Tipo de Modelo:** AGI Core híbrido con 9 subsistemas cognitivos
- **d_model base:** 512
- **Subsistemas:** World Model, Self Model, Curiosity, Goals, Reasoning (CoT), Knowledge Graph, Memory, Discovery, Capabilities
- **Integrador:** GlobalWorkspace con atención cruzada (metaphorical consciousness)
- **Backend:** PyTorch puro (fallbacks para mamba-ssm y flash-attn)

### Estado Actual (2025-12-30)
- ✅ Arquitectura neural 100% implementada
- ✅ Forward pass ejecuta sin errores
- ✅ Dream Cycle (Sleep) implementado y funcional
- ✅ Universal Knowledge Ingestor funcional (29 agentes escaneados)
- ❌ Modelo NO entrenado (pesos aleatorios)
- ❌ Inferencia end-to-end NO conectada
- ⚠️ Herramientas mayormente mocked

### Decisiones Importantes
1. **Biological Architecture:** El modelo sigue principios biológicos (Brain, Nervous System, Immune System, Sleep Cycle)
2. **No External Dependencies for Core:** mamba-ssm y flash-attn son opcionales con fallbacks PyTorch
3. **RLTF:** Reinforcement Learning from Tool Feedback implementado en CapabilitySystem

### Objetivo Actual
Completar arquitectura e iniciar entrenamiento básico

### Tarea en Curso
Cierre de sesión y documentación de contexto

---

## Próximos Pasos Sugeridos
1. Ejecutar `train.py` con dataset pequeño para validar pipeline
2. Conectar tokenizador al flujo de inferencia
3. Implementar al menos 1 herramienta real (no mocked)
4. Crear script de chat interactivo

---

## Rutas Importantes
- **Checkpoints:** `./checkpoints/`
- **Scripts:** `./scripts/` (train.py, dream.py, verify_ingestion.py)
- **Modelo:** `./src/model/`
- **Training:** `./src/training/`
- **Inference:** `./src/inference/`
- **Universal Prompts:** `./universalprompts/`
