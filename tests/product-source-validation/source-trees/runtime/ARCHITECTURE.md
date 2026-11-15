# Silhouette Agency OS — System Architecture

This document explains the core components of Silhouette, how they interact, and how to extend the system.

## 1. High-Level Overview

Silhouette is a **Hybrid Cognitive Architecture** that combines:
1.  **Node.js Supervisor ("Janus")**: Manages the lifecycle, auto-updates, and crash recovery.
2.  **Orchestrator (Core)**: The brain that manages agents, memory, and tools.
3.  **Microservices**: Specialized Python services for heavy lifting (Reasoning, Voice, Vision).
4.  **Docker Infrastructure**: Persistence layer (Neo4j, Redis, Qdrant).

## 2. Component Breakdown

### 2.1 Janus ( The Supervisor | `scripts/janus.js` )
**"The Two-Faced Guardian"**
- **Role**: Process Supervisor.
- **Responsibility**: It launches `npm run server`, watches for crashes, and handles auto-restarts.
- **Persistence**: Janus itself is stateless. It does *not* hold memory. Restarting Janus does not lose agent memories (which are in DBs/Files).
- **Why it's here**: To allow the AGI to update its own code and restart itself without killing the parent process.

### 2.2 The Orchestrator (`services/orchestrator.ts`)
**"The Conductor"**
- **Role**: Central Logic Hub.
- **Responsibility**: Routes messages, manages the "Cognitive Loop" (Introspection), and coordinates specialist agents.
- **Integration**: This is where new capabilities are wired in.

### 2.3 Reasoning Engine (`reasoning_engine/`)
**"The Intuition"**
- **Role**: Graph Analysis Microservice (Python/FastAPI).
- **Responsibility**: Connects to connected Neo4j to find "hidden links" between concepts.
- **Status**: Stateless logic. Data lives in Neo4j.

## 3. How to Integrate a New API

**User Question:** *"Where do I integrate a new API? Do I lose persistence?"*

**Answer:** It depends on *what* the API does.

### Scenario A: A New LLM Provider (e.g., Claude, Mistral API)
**Location:** `services/llm/multiLLMProvider.ts`
1.  Add the provider to `LLMProvider` type.
2.  Implement the call logic in `generateResponse`.
3.  Add API Key to `.env`.
**Persistence:** No effect. The LLM is just a processor. Memories are stored in `data/` and `db/`.

### Scenario B: A New Tool (e.g., Weather API, Stock Market)
**Location:** `services/tools/`
1.  Create a new tool file (e.g., `marketTool.ts`).
2.  Register it in `services/tools/toolRegistry.ts`.
3.  Add it to the agent's `TOOLS.md` allowlist.
**Persistence:** Tools are stateless. Results are saved to Memory by the agent if needed.

### Scenario C: A "Heavy" Model (e.g., Local DeepSeek/Janus Model)
**Location:** `reasoning_engine/` (or a new Python service)
1.  If it needs GPU/Python, run it as a microservice (like the Reasoning Engine).
2.  Expose a local HTTP endpoint (e.g., `http://localhost:8100/generate`).
3.  Call it from Node.js using `fetch`.
**Persistence:** If the model needs to save state, map a volume in Docker (e.g., `-v ./data/models:/app/data`).

## 4. Deployment Strategy

### Docker Isolation vs. Host Capabilities
To run Silhouette in Docker but give it "Root-like" powers:
1.  **Filesystem**: We bind-mount the project directory so code/data persist on the host. origin
2.  **Network**: We use `network_mode: "host"` (Linux) or map sensitive ports to allow it to see local services.
3.  **GPU**: We pass GPU access to the container.

See `docker-compose.prod.yml` for the production configuration.
