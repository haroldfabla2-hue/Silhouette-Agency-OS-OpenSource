# Silhouette Agency OS: Biological Nomenclature Glossary

Throughout the architecture of Silhouette Agency OS, biological and poetic nomenclature is used to describe deeply complex technical subsystems. This design choice bridges the gap between cold mechanical computation and organic autonomous behavior.

This glossary maps these conceptual terms to their exact technical implementation within the codebase.

## Core Cognitive Systems

### The Soul (`soul`)
The persistent core identity of an agent. It goes beyond a simple system prompt, encapsulating the agent's long-term personality, behavioral directives, learned opinions, and fundamental purpose.
*   **Technical Implementation:** Handled by `AgentFileSystem` (creates the isolated soul directory) and `ContinuumMemory` (persists the soul's experiences). It is injected into the LLM context via `orchestrator.ts > buildSystemPrompt()`.

### Heartbeat (`heartbeat`)
The autonomous lifecycle engine that awakens agents periodically even without external stimuli. It ensures agents remain proactive, allowing them to self-reflect, execute pending background tasks, or evolve.
*   **Technical Implementation:** Implemented in `scheduler.ts` and `AgentSwarmOrchestrator.agentHeartbeat()`. It uses cron-like intervals to dispatch `INTERNAL_TICK` events to sleeping agents.

### Olfactory Driver (`olfactory_driver`)
The system's anomaly detection and context-gathering mechanism. Named for the way a scent gives immediate, pre-cognitive context of an environment, this driver "sniffs" the terminal environment, system state, and active directory to provide situational awareness *before* the LLM begins reasoning.
*   **Technical Implementation:** Present in the `sandbox` and `terminalWebSocket.ts` integrations, where the environment state (pwd, recent errors, resource usage) is gathered and prepended to the cognitive context.

### Hive Mind Sync (`hive_mind_sync`)
The mechanism by which individual, parallel agents share discoveries and align their objectives without human intervention.
*   **Technical Implementation:** Achieved through `redisManager.ts` (Pub/Sub channels) and `discoveryJournal.ts`. When an agent learns something new, it publishes a `CONTINUUM_INSIGHT_AVAILABLE` event that other agents can asynchronously digest.

### Continuum Memory (`continuum_memory`)
A unified memory architecture that seamlessly bleeds short-term working memory into episodic storage, and eventually into semantic knowledge graphs.
*   **Technical Implementation:** Managed by `continuumMemory.ts`. Short-term memory (Redis), Episodic memory (LanceDB/Vector arrays), and Semantic memory (Neo4j Knowledge Graph).

### The Janitor Engine (`janitor_engine`)
The background garbage collection and truth-reconciliation service. It asynchronously audits the memory continuum to compress redundant information, resolve contradictions, and prune outdated beliefs.
*   **Technical Implementation:** Found in `janitorEngine.ts`, which runs periodic sweeps to consolidate vector clusters and resolve knowledge graph conflicts using logical gating (and formally Z3).

## Security & Evolution Protocols

### Genesis Protocol (`genesis_protocol`)
The multi-stage initialization sequence that prepares the environment, boots the database layers, validates integrity, and awakens the first orchestrator agent.
*   **Technical Implementation:** The `bootSequence` inside `index.ts`, combined with `systemProtocol.ts` which fires the `GENESIS_START` and `GENESIS_COMPLETE` bus events.

### Janus V2 (`janus_v2`)
The dual-faced self-healing loop. One "face" generates code or actions, while the other "face" simultaneously critiques and prepares rollback strategies if the first face fails.
*   **Technical Implementation:** Implemented within `janusRepair.ts`. It utilizes the capability loop to run a failure-recovery cycle, now bounded by a Circuit Breaker logic to prevent infinite hallucination loops.

### Cognitive Shield (`cognitive_shield`)
The defense mechanism against prompt injection and malicious user inputs.
*   **Technical Implementation:** In `orchestrator.ts`, this is the anti-prompt injection metaprompt (`[SECURITY SHIELD]`) prepended dynamically when a `GUEST` user (identified via `identityService.ts`) interacts with the system.

## Communication Channels

### Neuro-Bus (`system_bus`)
The central nervous system of Silhouette OS. It handles all asynchronous, decoupled event routing between decoupled subsystems (memory, channels, agents, and sandboxes).
*   **Technical Implementation:** `systemBus.ts` which implements a Node.js `EventEmitter` (and Redis pub/sub in clustered mode) using strictly typed `SystemProtocol` events.
