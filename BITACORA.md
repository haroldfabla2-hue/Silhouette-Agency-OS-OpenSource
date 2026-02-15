# BITÁCORA DEL PROYECTO - SILHOUETTE AGENCY OS

Este archivo registra el historial cronológico de trabajo, decisiones importantes y cambios significativos en el proyecto.

## [2026-01-05] Core Systems Stabilization & Identity Architecture
- **Objetivo:** Resolver problemas críticos de estabilidad en el núcleo cognitivo de Silhouette (Memoria, Identidad, Narrativa).
- **Problemas Detectados:**
    - **Infinite Memory Loop:** `store()` → `introspection` → `THOUGHT_EMISSION` → `narrative` → `store()`.
    - **Identity Confusion:** Silhouette confundía sus propias respuestas ("Soy Silhouette") como si fueran del usuario ("El usuario indica que es Silhouette").
    - **Duplicate Narrative Thoughts:** 13 servicios emitiendo pensamientos simultáneamente saturaban el log.
- **Logros (Soluciones Definitivas):**
    - **Narrative Architecture (Blackboard Pattern):**
        - Centralización del control en `narrativeService` sin modificar los 13 emisores (Low Risk).
        - Implementado **Hash-based Deduplication** (10s window).
        - Implementado **Source Throttling** (Max 10 pensamientos/fuente/ventana).
        - Implementado **Source Analytics** para observabilidad.
    - **Identity Protection (Triple-Layer):**
        - Refactorización crítica de `continuumMemory.transformUserPerspective`.
        - Layer 1: Exclusión explícita de tags de sistema/asistente.
        - Layer 2: Detección de contenido autoreferencial ("Soy Silhouette").
        - Layer 3: Solo transformar si existe tag explícito 'user'/'input'.
    - **Infinite Loop Defense:**
        - Flag `skipIngestion=true` en narrativa para romper recursión.
        - Detección de patrones repetitivos en `ContinuumMemory`.
- **Archivos Modificados:**
    - `services/narrativeService.ts` (Dedup + Throttling + Analytics)
    - `services/continuumMemory.ts` (Identity Fix + Anti-Recursion)
    - `services/dreamerService.ts` (Entropy hard cap)
    - `services/chatController.ts` (Speaker attribution)
    - `constants/silhouetteIdentity.ts` (Centralized Identity rules)
- **Estado Final:** Build TypeScript exitoso. Logs limpios. Identidad estable.

## [2026-01-05] Security & Capability Architecture Overhaul
- **Objetivo:** Implementar un sistema robusto de seguridad, awareness de capacidades y autenticación MCP.
- **Logros:**
    - **CapabilityAwarenessService:**
        - Servicio persistente que trackea tools, agents y squads en tiempo real.
        - Suscripción a eventos SystemBus (`TOOL_CREATED`, `AGENT_SPAWNED`, `SQUAD_FORMED`, etc.).
        - Persistencia de snapshots en LanceDB.
        - Método `getCapabilitySummary()` integrado en PromptCompiler.
    - **SecuritySquad:**
        - Análisis multi-capa de código antes de ejecución: Static, Intent, Permission, Injection.
        - Integración con arquitectura de agentes: delega a agentes CYBERSEC vía orchestrator.
        - Emisión de eventos de seguridad vía SystemBus.
    - **MCPClient:**
        - Cliente para que Silhouette consuma servicios MCP externos (Spotify, GitHub, Instagram).
        - Registro de servidores, descubrimiento de tools, ejecución remota.
    - **API Key Authentication:**
        - `apiKeyService.ts`: Gestión de API keys con SHA-256, expiración, permisos.
        - Solo administradores pueden crear keys (X-Admin-Password).
        - Middleware de autenticación en mcpServer.ts.
        - Endpoints admin en `/v1/admin/api-keys`.
    - **Nuevos SystemProtocols:**
        - Capability lifecycle: `TOOL_CREATED`, `TOOL_EVOLVED`, `TOOL_DELETED`, `AGENT_SPAWNED`, `AGENT_DISMISSED`, `SQUAD_FORMED`, `SQUAD_DISSOLVED`, `CAPABILITY_SYNC`
        - Security: `SECURITY_REVIEW_REQUEST`, `SECURITY_REVIEW_RESULT`, `SECURITY_THREAT_DETECTED`
        - API Keys: `API_KEY_CREATED`, `API_KEY_REVOKED`, `API_KEY_EXPIRED`
- **Archivos Creados:**
    - `services/capabilityAwareness.ts`
    - `services/security/securitySquad.ts`
    - `services/mcp/mcpClient.ts`
    - `services/apiKeyService.ts`
    - `server/routes/v1/apikeys.routes.ts`
- **Archivos Modificados:**
    - `types.ts` (+14 SystemProtocols)
    - `services/promptCompiler.ts` (usa CapabilityAwareness)
    - `services/tools/toolHandler.ts` (integra SecuritySquad)
    - `services/tools/definitions.ts` (+purpose en ExecuteCodeArgs)
    - `services/tools/toolRegistry.ts` (+TOOL_CREATED/TOOL_EVOLVED events)
    - `services/factory/AgentFactory.ts` (+AGENT_SPAWNED event)
    - `services/factory/squadFactory.ts` (+AGENT_SPAWNED, +SQUAD_FORMED events)
    - `server/mcp/mcpServer.ts` (+authentication middleware)
    - `server/app.ts` (+apikeys routes)
- **Revisión de Integración (Cumplimiento de Mejores Prácticas):**
    - ✅ Corregido `SecuritySquad.findSecurityAgents` para usar API pública `getAgents()`
    - ✅ Agregada emisión de `TOOL_CREATED`/`TOOL_EVOLVED` en `ToolRegistry.registerTool`
    - ✅ Agregada emisión de `AGENT_SPAWNED` en `AgentFactory.spawnForTask` y `SquadFactory`
    - ✅ Agregada emisión de `SQUAD_FORMED` en `SquadFactory.spawnSquad`
    - ✅ Verificado que `lancedbService.searchByContent` existe y funciona

## [2026-01-24] Frontend Port Conflict Resolution
- **Objetivo:** Resolver el error 404 "Cannot GET /" en el frontend causado por conflicto de puertos.
- **Problema:** Un proceso externo (NestJS) ocupaba el puerto 3000, impidiendo que el frontend de Silhouette (configurado en puerto 3000) funcionara.
- **Acción:**
    - Se modificó `vite.config.ts` para eliminar la asignación forzada al puerto 3000, permitiendo el default 5173.
    - Se actualizó `start_all.bat` para reflejar los puertos correctos (Backend: 3005, Frontend: 5173).
    - Se ejecutó `kill_all.bat` para limpiar procesos.
- **Resultado:** Configuración alineada con estándares de Vite y backend Express. Requiere reinicio manual.

## [2026-02-14] System Architecture Upgrade (The Nucleus) & Memory Verification
- **Objetivo:** Estandarizar la creación de capacidades (Plugins/Skills) y cerrar el bucle de auto-evolución, emulando y superando la arquitectura de OpenClaw. Verificar la integridad de la Memoria Continua.
- **Logros:**
    - **Plugin System:** Implementada interfaz `IPlugin` y `PluginRegistry`. Migración de herramientas de FileSystem a plugin core.
    - **Self-Evolution:** Implementado `PluginFactory` y herramienta `create_plugin`. El `EvolutionScheduler` ahora puede orquestar la creación de su propio código.
    - **Context Awareness:** Creados estándares `SKILL_STANDARD.md` y `PLUGIN_STANDARD.md`.
    - **Memory Verification:** Auditoría exitosa de `ContinuumMemory` (RAM->LanceDB->Qdrant) y `DiscoveryJournal`/`SynthesisService`. Confirmada persistencia de hechos y descubrimientos.
- **Archivos Críticos:**
    - `services/plugins/pluginFactory.ts`
    - `services/evolution/evolutionScheduler.ts`
    - `services/continuumMemory.ts`
    - `services/discoveryJournal.ts`
- **Estado Final:** Arquitectura "Nucleus" completada. El sistema es capaz de introspección, planificación y auto-extensión.


