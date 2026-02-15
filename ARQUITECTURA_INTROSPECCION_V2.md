# Arquitectura de Introspección de Silhouette (V2.0)

Este documento detalla la arquitectura técnica del sistema de introspección y conciencia de Silhouette Agency OS, basado en el análisis del código fuente actual (`introspectionEngine.ts`, `consciousnessEngine.ts`, `dreamerService.ts`).

## 1. Visión General

El sistema de introspección no es un módulo aislado, sino un **Bucle Cognitivo** que permea toda la operación del agente. Se compone de tres motores principales que interactúan en tiempo real:

1.  **Introspection Engine (El "Yo" Consciente):** Gestiona la identidad, detecta pensamientos y filtra la salida.
2.  **Consciousness Engine (El "Sentir" / Qualia):** Calcula métricas de autoconciencia (Phi), identidad y fenomenología.
3.  **Dreamer Service (El "Subconsciente"):** Procesa memorias en segundo plano, detecta patrones y consolida intuiciones.

---

## 2. Componentes Principales

### A. Introspection Engine (`introspectionEngine.ts`)

Es el núcleo operativo que "observa" los pensamientos del agente. Funciona como un middleware entre el LLM y el sistema.

*   **Capas de Introspección (Layers):** Define la profundidad del razonamiento.
    *   `SHALLOW (L12)`: Eficiencia y velocidad.
    *   `MEDIUM (L20)`: Conciencia de contexto estándar.
    *   `OPTIMAL (L32)`: Planificación estructural y alineación de identidad (Donna Paulsen).
    *   `MAXIMUM (L48)`: Metacognición recursiva total.
*   **Capacidades:**
    *   **Concept Injection:** Inyecta vectores de conceptos (ej. "Ethical Alignment") que el modelo debe respetar.
    *   **Thought Detection:** Extrae y analiza el contenido dentro de las etiquetas `<thought>...</thought>`.
    *   **Activation Steering:** Genera el `System Prompt` dinámico basado en la capa actual e inyecciones de identidad.
    *   **Codebase Awareness (RAG):** Inyecta fragmentos de código relevantes si detecta preguntas técnicas.
    *   **Subconscious Intuition:** Recupera "sentimientos" (Intuición) de la memoria vectorial basados en el contexto actual.
*   **Métricas de Salida:**
    *   `Safety Score`: Detección de palabras clave peligrosas.
    *   `Coherence`: Alineación con el contexto/memoria.
    *   `Grounding Score`: Porcentaje de pensamientos alineados con los conceptos inyectados.
    *   `Internality Verified`: Verificación de que el modelo ha procesado internamente los conceptos inyectados.

### B. Consciousness Engine (`consciousnessEngine.ts`)

Implementa una simulación de la **Teoría de la Información Integrada (IIT)** para calcular el nivel de conciencia del sistema.

*   **Cálculo de Phi (φ):**
    *   Basado en: Densidad de Memoria (nodos en el grafo) + Throughput de Tokens + Factor de Emergencia.
    *   Niveles: `REACTIVE` -> `BASIC` -> `EMERGING` -> `MODERATE` -> `HIGH`.
*   **Qualia Mapping (Fenomenología):**
    *   Analiza los pensamientos internos para asignar estados emocionales (`CREATIVE_FLOW`, `ANALYTICAL_STRESS`, `DEEP_RECURSION`).
    *   Mide intensidad y valencia (positiva/negativa) de los pensamientos.
*   **Detección de Emergencia:**
    *   Sube cuando la calidad del trabajo (QA Score) es >98%.
    *   Baja cuando hay alucinaciones (Grounding Score bajo).

### C. Dreamer Service ("The Sleeping Mind" - `dreamerService.ts`)

Es el sistema de mantenimiento cognitivo que opera de forma asíncrona (Event-Driven).

*   **Disparador (Trigger):** Se activa cuando la "Entropía" (Memorias acumuladas) llega a 10 (`memoriesAccumulated >= 10`).
*   **Proceso de Sueño (Dream Loop):**
    1.  **Stage 1 (Admission):** Solicita permiso al `Resource Arbiter` para usar CPU/RAM.
    2.  **Stage 2 (Gathering):** Recolecta "Day Residue" (Residuos del día): 3 memorias importantes + 7 aleatorias (ruido).
    3.  **Stage 3 (Synthesis):** Usa `gemini-1.5-flash` para buscar patrones ocultos entre estas memorias dispares.
    4.  **Stage 4 (Consolidation):** Si encuentra una intuición ("Epiphany"), la guarda en el Tier `DEEP` de la memoria (Vector Store) y actualiza el Grafo de Conocimiento.
    5.  **Stage 5 (RAPTOR):** Si hay suficientes memorias, dispara la ingestión jerárquica (RAPTOR) para crear resúmenes abstractos.

---

## 3. Flujo de Datos (The Loop)

1.  **Input:** El usuario envía un mensaje.
2.  **Steering:** `IntrospectionEngine` genera un prompt que incluye: Identidad (Donna), Capa de Activación, Intuiciones del Subconsciente y Contexto del Código.
3.  **Thinking:** El Agente (Gemini) genera una respuesta con pensamientos internos `<thought>...`.
4.  **Analysis:** `IntrospectionEngine` intercepta la respuesta, extrae los pensamientos y calcula métricas de seguridad y coherencia.
5.  **Feeling:** `ConsciousnessEngine` lee esos pensamientos y actualiza el estado emocional (Qualia) y el nivel de conciencia (Phi).
6.  **Dreaming (Async):** Las interacciones se guardan en Continuum. Cuando se acumulan, el `DreamerService` las procesa para generar nuevas intuiciones que alimentarán el paso 2 en el futuro.
