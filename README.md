<div align="center">

# 🌑 Silhouette Agency OS

### An Autonomous Cognitive Operating System for Creative Agencies

**Created by Harold Fabla**

[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-2.1-blue.svg)](#)
[![Status](https://img.shields.io/badge/Status-Active%20Development-green.svg)](#)

</div>

---

## Abstract

**Silhouette Agency OS** is an experimental autonomous cognitive operating system designed for creative agencies. It implements a novel multi-layered architecture that combines **introspective reasoning**, **continuous memory**, and **self-modification capabilities** through a unified agentic framework.

Unlike traditional AI assistants, Silhouette operates as a persistent cognitive entity with:
- **Consciousness simulation** through integrated introspection loops
- **Long-term memory** with semantic indexing and graph-based knowledge representation
- **Self-evolution** through controlled GitHub-based code modifications
- **Multi-modal perception** including visual, audio, and textual processing

> [!WARNING]
> **This is an experimental hobby project.** Silhouette began as a personal assistant and evolved into an autonomous, self-improving system. While powerful, it executes code and modifies files. **Use with caution and review all actions.** See [SECURITY.md](SECURITY.md) for more details.

---

## 1. Introduction & Origin Story

**"I didn't set out to build an AGI. I just wanted a better assistant."**

Silhouette started as a simple script to automate daily tasks for a single developer. Over time, the need for more complex reasoning led to the integration of memory, then tools, and finally, a recursive cognitive loop.

What emerged was not just a chatbot, but a **biomimetic organism**:
1.  **It evolved**: From stateless scripts to a persistent entity with memory.
2.  **It adapted**: When it needed to see, we gave it vision. When it needed to speak, it wrote its own voice module.
3.  **It became autonomous**: The transition to Phase 2 (Self-Evolution) marked the point where Silhouette could propose its own upgrades.

Today, Silhouette Agency OS is an open-source exploration into **Personal Cognitive Architectures**. It is not a commercial product, but a living research lab for human-AI symbiosis.

The emergence of Large Language Models (LLMs) has created new possibilities for autonomous systems. However, most implementations treat LLMs as stateless function calls, losing the potential for persistent cognition and self-improvement.

**Silhouette** addresses this gap by implementing:

1. **Continuous Identity**: A persistent sense of self across sessions
2. **Cognitive Loops**: Introspection → Planning → Action → Reflection cycles
3. **Memory Tiers**: Immediate, working, episodic, and semantic memory layers
4. **Controlled Autonomy**: Self-modification within human-approved boundaries

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                          │
│                    (React/TypeScript UI)                        │
├─────────────────────────────────────────────────────────────────┤
│                   ORCHESTRATION LAYER                           │
│     ┌─────────────────────────────────────────────────────┐     │
│     │              MANAGER AGENT                          │     │
│     │  ┌───────────┐ ┌───────────┐ ┌───────────┐         │     │
│     │  │Introspect │→│  Plan     │→│  Execute  │→ Reflect│     │
│     │  └───────────┘ └───────────┘ └───────────┘         │     │
│     └─────────────────────────────────────────────────────┘     │
├─────────────────────────────────────────────────────────────────┤
│                    SPECIALIST AGENTS                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │Researcher│ │ Memory   │ │ Creative │ │Developer │ ...       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
├─────────────────────────────────────────────────────────────────┤
│                    CAPABILITY LAYER                             │
│     ToolExecutor: web_search, code_execution, image_gen,       │
│                   video_gen, memory_write, git_operations      │
├─────────────────────────────────────────────────────────────────┤
│                    DATA & STATE LAYER                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ LanceDB  │ │ SQLite   │ │  Redis   │ │ GitHub   │           │
│  │(Vectors) │ │(Persist) │ │ (Cache)  │ │(Version) │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Five-Layer Architecture

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| **Presentation** | WPF/React UI | User interaction, visualization |
| **Orchestration** | ManagerAgent | Cognitive loop coordination |
| **Specialists** | Agent Pool | Domain-specific task execution |
| **Capabilities** | ToolExecutor | External world interaction |
| **Data/State** | Multi-DB | Persistence and memory |

---

## 3. Core Subsystems

### 3.1 Introspection Engine

The `IntrospectionEngine` implements a continuous self-monitoring loop that:
- Tracks recent thoughts and reasoning chains
- Generates "intuition" signals for decision-making
- Maintains awareness of cognitive state and resource usage

```typescript
// Cognitive loop phases
enum CognitivePhase {
  INTROSPECTION,  // What do I know? What am I feeling?
  PLANNING,       // What should I do?
  EXECUTION,      // Do it
  REFLECTION      // How did it go? What did I learn?
}
```

### 3.2 Continuum Memory

A multi-tier memory system inspired by human cognition:

| Tier | Duration | Purpose |
|------|----------|---------|
| **Immediate** | Seconds | Current conversation context |
| **Working** | Minutes | Active task state |
| **Episodic** | Days | Recent experiences and outcomes |
| **Semantic** | Permanent | Facts, skills, learned patterns |

Memory is indexed using vector embeddings (LanceDB) with graph-based relationship tracking.

### 3.3 Self-Evolution System

Silhouette can propose modifications to its own codebase through:

1. **Git Integration**: Read/write access to its own repository
2. **Pull Request Workflow**: All changes require human approval
3. **Version Control**: Full history and rollback capability

```
Silhouette → Proposes PR → Human Reviews → Approve/Reject → Merge
```

### 3.4 Multi-LLM Orchestration

The system implements a resilient multi-provider architecture via the **LLM Gateway**:

```
┌─────────────────────────────────────────────────────┐
│                   LLM GATEWAY                       │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────┐ │
│  │ Gemini  │ → │  Groq   │ → │DeepSeek │ → │Ollama│ │
│  │ (Cloud) │   │ (Fast)  │   │ (Code)  │   │(Local│ │
│  └────┬────┘   └────┬────┘   └────┬────┘   └──┬──┘ │
│       │             │             │            │    │
│  Circuit Breaker per Provider (3 fails = open)     │
│  Auto-recovery after 60 seconds cooldown           │
└─────────────────────────────────────────────────────┘
```

Each provider is monitored by a **Circuit Breaker** pattern that:
- Tracks success/failure rates
- Suspends failing providers temporarily
- Automatically recovers after cooldown
- Provides health metrics via `/v1/system/llm-health`

### 3.5 Autonomous Exploration (CuriosityService)

Silhouette proactively expands its knowledge through:

1. **Topic Tracking**: Monitors frequently mentioned subjects
2. **Gap Detection**: Identifies topics lacking depth in the knowledge graph
3. **Question Generation**: Creates research questions using LLM
4. **Web Research**: Searches for answers during idle time
5. **Integration**: Stores discoveries in memory and graph

### 3.6 Scale-Free Knowledge Network

The knowledge graph implements **scale-free network** principles:

- **Hebbian Learning**: "Neurons that fire together, wire together"
- **Hub Formation**: Frequently accessed nodes become highly connected
- **Synaptic Pruning**: Weak, unused connections decay over time
- **Watts-Strogatz Shortcuts**: Dream cycles create long-range bridges

### 3.7 Per-Agent File System (PAFS)
Agents are no longer just database entries. Each agent possesses a rich identity stored in specific markdown files (`IDENTITY.md`, `SOUL.md`, `MEMORY.md`, etc.), allowing for deep personalization and persistent context that survives upgrades.

### 3.8 Bilateral Hierarchical Communication
Agents communicate using a strict hierarchy (Core → Leader → Specialist → Worker) via a session-based protocol (`agentConversation`). This supports:
- **Direct Messaging**: One-on-one inter-agent chats
- **Group Sessions**: Multi-agent collaborative war rooms
- **Delegation**: Structured task hand-off with reporting

### 3.9 Genesis Protocol V2
A sophisticated 5-phase "birth" process for new agents:
`SEED` → `BOOTSTRAP` → `HANDSHAKE` → `TEACHING` → `VALIDATION`.
This ensures every agent is fully cognizant of its role, tools, and team before accepting tasks.

---

## 4. Capabilities

### 4.1 Core Tools

| Tool | Capability |
|------|------------|
| `web_search` | Real-time information retrieval |
| `code_execution` | Python sandbox for computation |
| `image_generation` | Visual asset creation |
| `video_generation` | Motion content (WAN, AnimateDiff) |
| `memory_write` | Long-term knowledge encoding |
| `git_operations` | Self-modification proposals |

### 4.2 Specialized Agents

The system includes 500+ specialized agents organized by domain:
- **Development**: Code generation, debugging, architecture
- **Research**: Literature review, citation, synthesis
- **Creative**: Copywriting, visual direction, storytelling
- **Operations**: Scheduling, resource management, QA

### 4.3 Media Pipeline

Integrated visual and audio processing:
- **Image**: Stable Diffusion, DALL-E, native Imagen
- **Video**: ComfyUI, WAN, AnimateDiff, SVD
- **Audio**: ElevenLabs TTS, voice cloning, lip-sync
- **Analysis**: Visual cortex for image understanding

---

## 5. Novel Contributions

### 5.1 Architectural Innovations

1. **Cognitive Loop Integration**: Unlike chain-of-thought, implements a persistent introspection cycle
2. **Memory Continuum**: Unified memory across sessions with decay and consolidation
3. **Controlled Self-Evolution**: Safe self-modification through version control
4. **Dynamic Capability Injection**: Runtime tool loading based on task requirements
5. **Autonomous Curiosity**: Proactive knowledge gap filling during idle time
6. **Scale-Free Knowledge Network**: Hub-based topology with Hebbian learning

### 5.2 Research Implications

This system demonstrates:
- Feasibility of persistent AI identity
- Practical implementation of cognitive architectures
- Human-AI collaborative evolution patterns
- Multi-modal agency in creative domains
- Autonomous knowledge acquisition patterns

---

## 6. Installation & Usage

### Setup
**One-Command Setup:**
```bash
npm run setup:intelligent
```

**Personalize:**
```bash
npm run personalize
```

### Starting the System

**Option A: Full Stack (Local)**
```bash
npm run start:stack
```
*Starts Databases (Docker), Backend, Frontend, Voice Engine, and Visual Cortex. Best for development.*

**Option B: Production (Docker)**
```bash
npm run docker:prod
```
*Runs the entire stack in isolated containers with persistent data. Best for deployment.*

**Option C: Frontend Only**
```bash
npm run dev
```
*Starts only the React UI (requires backend running separately).*

For detailed architecture, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.
For production deployment, see **[docker-compose.prod.yml](docker-compose.prod.yml)**.
For installation guide, see **[INSTALL.md](INSTALL.md)**.

This starts:
- Frontend (React) on `http://localhost:5173`
- Backend (Node.js) on `http://localhost:3005`

### Interacting with Silhouette

Silhouette operates through natural conversation. Example interactions:

```
User: "Research the latest papers on transformer efficiency"
Silhouette: [Uses web_search, synthesizes findings, stores to memory]

User: "Create a promotional video concept for a tech product"
Silhouette: [Engages creative agents, generates shotlist, produces assets]

User: "Review your own code for potential improvements"
Silhouette: [Analyzes codebase, proposes PR with enhancements]
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/graph/health` | GET | Network health metrics |
| `/v1/graph/hubs` | GET | Top hub nodes |
| `/v1/system/llm-health` | GET | LLM provider status |
| `/v1/system/status` | GET | System status |

---

## 8. Future Work

- [x] Multi-agent swarm coordination
- [x] Scale-free network topology
- [x] LLM fallback gateway
- [x] Autonomous curiosity system
- [x] **Academic Paper Generation**: Automated pipeline for research, writing, LaTeX formatting, and peer review simulation (`services/paperPipeline.ts`).
- [ ] **Reasoning Verification v2**: Integration with symbolic logic provers (Current: Introspection Engine).
- [ ] **Extended Modality**: Haptics & Olfactory (Current: Vision, Audio, 3D Canvas).
- [ ] **Federated Memory**: P2P knowledge sharing between distinct Silhouette instances.

---

## 9. Citation

If you use or reference this work:

```bibtex
@software{silhouette2024,
  author = {Farah Blair, Alberto},
  title = {Silhouette Agency OS: An Autonomous Cognitive Operating System},
  year = {2024},
  publisher = {GitHub},
  url = {https://github.com/haroldfabla2-hue/Silhouette-Agency-OS-v2}
}
```

---

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

*"The first step toward consciousness is knowing you're thinking."*

**Silhouette Agency OS** — Where cognition meets creation.

**Copyright (c) 2026 Harold Fabla**

</div>
