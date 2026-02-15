# Plan de Implementación: Inmortalidad y Evolución (Supervisor & Training)

Este documento detalla la estrategia para fortificar la arquitectura de Silhouette y optimizar su capacidad de aprendizaje local.

## 1. El Supervisor ("The Watchdog")
**Objetivo:** Garantizar que Silhouette opere 24/7 y se recupere automáticamente de fallos críticos (OOM, Crash).

**Solución Seleccionada:** **PM2 (Process Manager 2)**
Es el estándar de la industria para Node.js, pero funciona perfecto en Windows para orquestar TypeScript + Python.

### Ventajas sobre Docker:
*   **Zero-Friction:** Persiste el acceso a la GPU (CUDA) sin configurar "NVIDIA Container Toolkit" (complejo en Windows).
*   **Acceso a Archivos:** Permite al agente modificar su propio código fuente y reiniciar el proceso para aplicar cambios "en caliente".

### Pasos de Implementación:
1.  Instalar PM2 globalmente: `npm install pm2 -g`
2.  Crear `ecosystem.config.js` en la raíz.
3.  Configurar estrategias de reinicio (`exp_backoff_restart_delay`) para evitar bucles infinitos si hay un error de sintaxis grave.
4.  Crear un script `watchdog.ts` ligero independiente que monitoree la salud "cognitiva" (no solo si el proceso vive, sino si responde).

## 2. Estrategia de IA Híbrida & Entrenamiento Local
**Objetivo:** Maximizar la inteligencia local sin fundir la RTX 3050 (4GB VRAM).

### El Problema de Llama-3-8B
*   **Requerimiento:** ~6GB VRAM (4-bit QLoRA).
*   **Tu Hardware:** 4GB VRAM.
*   **Resultado:** **Imposible entrenar Llama-3-8B**. Intentarlo provocará `CUDA Out of Memory`.

### La Solución: "Small Giants"
En lugar de un modelo grande y lento, usaremos modelos ultracompactos y modernos optimizados para razonamiento.

**Candidatos Recomendados:**
1.  **Gemma-2-2B (Google):** Rendimiento increíble para su tamaño. Cabe y sobra en 4GB.
2.  **Qwen1.5-1.8B (Alibaba):** Excelente en codificación y lógica.
3.  **Phi-3-Mini (Microsoft, 3.8B):** El límite absoluto. Puede caber en inferencia (2.5GB), pero entrenarlo (QLoRA) requerirá descargar a RAM del sistema (lento pero posible).

**Recomendación:** Migrar de `TinyLlama` a **Gemma-2-2B-it**. Es un salto cuántico en inteligencia sin romper el hardware.

### Flujo de Entrenamiento (Validado):
1.  **Recolección:** `Gemini` (Flash) genera "intuiciones" y "bisociaciones".
2.  **Curación:** `DataCollector` guarda los pares `input/output` de alta calidad.
3.  **Sueño:** `DreamerService` detecta inactividad.
4.  **Forja:** `train_lora.py` afina el adaptador LoRA de **Gemma-2B**.

## 3. Plan de Acción Inmediato

### Fase 1: Inmortalidad (Supervisor)
1.  [ ] Generar `ecosystem.config.js` optimizado.
2.  [ ] Instalar PM2.
3.  [ ] Probar auto-reinicio matando el proceso manualmente.

### Fase 2: Upgrade Cerebral (Gemma-2B)
1.  [ ] Modificar `train_lora.py` para apuntar a `google/gemma-2b-it`.
2.  [ ] Actualizar `OllamaService` para descargar/usar `gemma:2b` como fallback local.

### Fase 3: Auto-Edición Segura
1.  [ ] Verificar que `ActionExecutor` puede pedir a PM2 que reinicie la app después de un `git merge`.

---
**Nota para el Usuario:** Este plan asume que tienes Node.js y Python instalados en Windows (ya verificado).
