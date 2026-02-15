# PLAN DE ACCIÓN FASE 7: Inteligencia Visual y Pipelines Dinámicos

> **Estado:** PLANIFICACIÓN / LISTO PARA INICIO
> **Fecha de Inicio:** 2025-12-18
> **Objetivo:** Dotar a los Agentes de Silhouette de una "Corteza Visual" totalmente autónoma, permitiéndoles no solo solicitar imágenes, sino orquestar pipelines de video complejos (SVD, VID2VID, WAN) mediante herramientas formalmente definidas.

## 1. Contexto

Hasta ahora, la generación de videos se realizaba mediante scripts de Python (`worker_wan.py`) o endpoints hardcodeados. El Agente no tiene conocimiento *semántico* de que puede "ver" los assets generados o "transformarlos".

## 2. Definición de Herramientas Agénticas (JSON Schema)

Para que el modelo (Planner) entienda sus nuevas capacidades, debemos exponerlas como `function declarations` (Tool Definitions) en la configuración del Agente (`AgentConfig` o `ToolRegistry`).

### A. `generate_video`
- **Descripción:** Genera o transforma video a partir de texto o imágenes/videos existentes.
- **Parámetros:**
    - `prompt` (string): Descripción de la escena.
    - `engine` (enum): "WAN" | "SVD" | "ANIMATEDIFF" | "VID2VID".
    - `input_asset_path` (string, opcional): Ruta absoluta a un archivo de imagen o video para usar como fuente (Source).
    - `duration` (number, opcional): Duración en segundos (default 5).

### B. `list_visual_assets`
- **Descripción:** Permite al agente "mirar" en su carpeta de salida (`ComfyUI/output` o `uploads`) para encontrar archivos generados previamente.
- **Parámetros:**
    - `filter_type` (enum, opcional): "video" | "image" | "all".
    - `limit` (number, opcional): Cantidad de resultados recientes.

## 3. Plan de Implementación Técnica

### Paso 1: Definición de Tipos y Esquemas
- [ ] Crear interfaces TypeScript en `types.ts` o `services/tools/definitions.ts`.
- [ ] Definir el JSON Schema compatible con Gemini Function Calling.

### Paso 2: Implementación de Tool Executors
- [ ] Actualizar `ToolExecutor` para router las llamadas a `VideoFactory`.
- [ ] Implementar la lógica de `list_visual_assets` en `MediaManager`.

### Paso 3: Integración en Prompt del Sistema
- [ ] Asegurar que el System Prompt del Agente incluya instrucciones sobre cómo usar estas herramientas para flujos creativos (ej: "Primero genera una imagen, luego úsala para hacer un video SVD").

## 4. Criterios de Éxito
- El Agente puede recibir una instrucción como "Haz un video de un gato y luego transformalo a estilo anime" y ejecutar autónomamente:
    1. `generate_video(prompt="cat", engine="WAN")` -> obtiene `cat.mp4`.
    2. `generate_video(prompt="anime style", engine="VID2VID", input_asset_path="cat.mp4")`.
