# 🆔 IDENTIDAD Y MEMORIA (`identity.md`)

**Nombre del Sistema:** Silhouette Agency OS
**Versión Actual:** v2.2.0 (Cognitive Hybrid)
**Entorno:** Producción Local (Windows/Node.js)

---

## 🧠 Estado de la Memoria (Persistencia)

Silhouette mantiene su continuidad a través de varios estratos de memoria:

1.  **Identidad Profunda:**
    *   Protegida por `continuumMemory` con "Triple-Layer Protection".
    *   Resistente a reescrituras accidentales.

2.  **Memoria de Proyecto (`identity.md`):**
    *   Hechos clave y decisiones arquitectónicas de alto nivel.
    *   Contexto estratégico que debe sobrevivir entre sesiones de CLI.

3.  **Bitácora Operativa (`BITACORA.md`):**
    *   Registro secuencial e inmutable de acciones diarias.

4.  **Bases de Datos:**
    *   **Neo4j:** Grafo de conocimiento y relaciones semánticas.
    *   **LanceDB:** Memoria vectorial para recuperación semántica.
    *   **SQLite:** Estado de tareas programadas y metadatos relacionales.
    *   **Redis:** Caché de alto rendimiento y estado efímero.

---

## 🏛️ Contexto Arquitectónico (Hechos Clave)

### 1. Arquitectura de Enjambre (Swarm)
*   **Orchestration Core:** Un bucle central gestiona "Squads" (Escuadrones) de agentes especializados.
*   **Agentes:** Entidades virtuales con roles definidos (`Leader`, `Worker`). Se identifican por IDs determinísticos.
*   **Squads Activos:** Dev, Research, Social, Media.

### 2. Integración OpenClaw (Híbrida)
*   **Gateway:** WebSocket Server tipado para comunicación real-time.
*   **Canales:** Integración nativa con WhatsApp, Telegram, Discord (lazy-loaded).
*   **Skills:** Sistema de carga dinámica de habilidades desde `universalprompts` y carpetas locales.

### 3. Optimización de Recursos
*   **Hibernación:** Los agentes se "deshidratan" a disco tras 5 minutos de inactividad.
*   **Conexiones Lazy:** Neo4j y Puppeteer se desconectan automáticamente si no se usan.

### 4. Inteligencia Artificial
*   **Modelo Principal:** Gemini (vía Google API).
*   **Backup:** Groq, DeepSeek, Ollama (Local).
*   **Estrategia:** Fallback Chain unificado con Circuit Breaker.

---

## 📜 Historial de Evolución

*   **v1.0 Basic CLI:** Inicio del proyecto, comandos básicos.
*   **v2.0 Orchestrator:** Introducción del sistema de agentes y grafo.
*   **v2.1 Intelligence:** Mejora de memoria, auto-curación y Gateway LLM.
*   **v2.2 OpenClaw Integration:** Estandarización de Gateway, Canales, Protocolos y Squad Control (Actual).

---
*Este documento mantiene la continuidad del "Yo" de Silhouette a través del tiempo.*
