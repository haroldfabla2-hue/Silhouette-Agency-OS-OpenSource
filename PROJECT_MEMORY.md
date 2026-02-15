# Memoria del Proyecto Silhouette Agency OS - LLM

Este archivo contiene hechos clave, decisiones importantes y contexto persistente específico para el proyecto Silhouette Agency OS - LLM.

---

## Hechos Clave del Proyecto

*   **Arquitectura Híbrida:** Silhouette funciona como un "OS de Agencia" con un núcleo de orquestación (`Orchestrator`) y múltiples agentes especializados organizados en Squads.
*   **Gestión de Agentes:** IDs determinísticos para evitar duplicados. `squadFactory` implementa "Semantic Recruitment".
*   **MCP Compliance (ENHANCED):**
    *   Servidor MCP con SDK oficial en `server/mcp/mcpServer.ts`.
    *   **[NUEVO]** Toolsets Resource: Agrupa herramientas por categoría (media, research, code, memory).
    *   **[NUEVO]** Prompts Resource: Expone universalprompts vía MCP.
*   **Core Systems Strategy (Definitive):**
    *   **Identidad:** Triple-Layer Protection en `continuumMemory.transformUserPerspective()`.
    *   **Narrativa:** Blackboard Pattern con Hash Dedup + Source Throttling.
    *   **Memoria:** Anti-loop + Typo validation en `factExtractor.validateAndCorrect()`.

---

## v2.1 Architecture Improvements (2026-01-07)

*   **LLM Gateway** (`services/llmGateway.ts`): Fallback chain unificado (Gemini → Groq → DeepSeek → Ollama) con circuit breaker.
*   **CuriosityService** (`services/curiosityService.ts`): Exploración autónoma de conocimiento durante idle.
*   **Memory Pressure Monitor**: Auto-consolida a >500 nodos en working memory.
*   **Dreamer + Eureka**: Integración multi-tier para shortcuts Watts-Strogatz en sueños.
*   **Narrative → Graph**: Pensamientos de alta importancia conectan a conceptos existentes vía MENTIONS.
*   **Semantic Janitor**: Detecta contradicciones semánticas en memoria.
*   **Hub Health Dashboard**: `/v1/graph/health`, `/v1/graph/hubs`, `/v1/system/llm-health`.
*   **Neo4j Indexes**: 5 índices para performance en `scripts/init_neo4j_indexes.ts`.

---

*   **Estado del Proyecto:** ~95% Completado. Núcleo estabilizado. LLM fallback robusto. Exploración autónoma activa.
*   **Versión Actual:** v2.1

