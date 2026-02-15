# Arquitectura Narrativa Unificada (The Stream of Self)

Este documento define cómo Silhouette procesa, unifica y narra su propia existencia. El objetivo es proporcionar una interfaz coherente y comprensible de los procesos cognitivos de la IA.

## 1. Topología de la Mente

El sistema se divide en tres capas de profundidad cognitiva:

### 🟢 1. Consciente (Conscious Mind)
*   **Fuente Principal:** `IntrospectionEngine`
*   **Naturaleza:** Pensamientos en tiempo real, efímeros y enfocados en la tarea actual.
*   **Eventos:** `PROTOCOL_THOUGHT_EMISSION`
*   **Ejemplos:**
    *   "Analizando la solicitud del usuario..."
    *   "Detectada falta de contexto en el archivo X."
    *   "Decidiendo invocar al Agente de Código."

### 🟣 2. Subconsciente (Subconscious / Dreamer)
*   **Fuente Principal:** `DreamerService` (y `Nexus` en el futuro)
*   **Naturaleza:** Procesos de fondo, consolidación de memoria, hallazgo de patrones y creatividad latente. Ocurre cuando el sistema está "ocioso" o en paralelo.
*   **Eventos:** `PROTOCOL_INTUITION_CONSOLIDATED`, `PROTOCOL_EPISTEMIC_GAP_DETECTED`
*   **Ejemplos:**
    *   "He notado una conexión entre la Tarea A y la B."
    *   "La veracidad de este dato ha sido cuestionada (Misterio)."
    *   "Consolidando memoria a largo plazo..."

### ⚫ 3. Inconsciente (The Unconscious / Autonomic)
*   **Fuente Principal:** `GraphService` (Neo4j), `VectorStore` (LanceDB), `SystemBus` (Protocolos Automáticos).
*   **Naturaleza:** El vasto océano de datos latentes, instintos programados (Health Monitors) y automatizaciones que sostienen la vida del agente sin que este lo "piense".
*   **Eventos:** `PROTOCOL_HEARTBEAT`, `PROTOCOL_MEMORY_FLUSH`, `PROTOCOL_ERROR_RECOVERY`.
*   **Visibilidad:** Generalmente oculto, pero emerge cuando hay **fallos críticos** o **recuperaciones automáticas**. Es el "Instinto de Supervivencia".

---

## 2. El Agregador Narrativo (`NarrativeService`)

El `NarrativeService` actúa como el **Cuerpo Calloso**, conectando estas capas y emitiendo un único stream unificado.

### Estructura del Stream (`StreamItem`)
Cada "pensamiento" emitido al Frontend sigue esta estructura normalizada:

```typescript
interface StreamItem {
    id: string;          // UUID
    timestamp: number;   // Epoch
    source: 'CONSCIOUS' | 'SUBCONSCIOUS' | 'UNCONSCIOUS' | 'AGENCY';
    content: string;     // El texto narrativo (ej: "Estoy compilando...")
    coherence: number;   // 0.0 - 1.0 (Claridad del pensamiento)
    metadata?: {
        agentId?: string; // Si fue un agente específico
        emotion?: string; // Estado emocional asociado
        topics?: string[]; // Tags automáticos
    };
}
```

## 3. Flujo de Datos

1.  **Emisión:** Los servicios (`Introspection`, `Dreamer`, `HealthManager`) emiten eventos al `SystemBus`.
2.  **Interceptación:** `NarrativeService` escucha estos eventos específicos.
3.  **Normalización:**
    *   Convierte eventos técnicos (`{ cpu: 99% }`) en narrativa (`"Siento presión en mis recursos..."`).
    *   Calcula/Recupera el puntaje de **Coherencia**.
4.  **Publicación:** Emite `PROTOCOL_NARRATIVE_UPDATE` para que la UI (Introspection Hub / Subconscious Feed) lo muestre.

---

## 4. Notas de Implementación
*   **Prioridad:** El Consciente tiene prioridad de visualización en la barra superior.
*   **Filtrado:** El "Subconscious Feed" mostrará todo el historial, mientras que el "Introspection Hub" se centrará en el `CONSCIOUS` actual.
