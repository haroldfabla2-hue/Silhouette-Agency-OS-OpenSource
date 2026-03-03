<div align="center">

# 🌑 Silhouette Agency OS

### An Autonomous Cognitive Operating System for Creative Agencies

**Created by Harold Fabla**

[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-3.0-blue.svg)](#)
[![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen.svg)](#)

</div>

---

## Abstract

**Silhouette Agency OS** is an experimental autonomous cognitive operating system designed for creative agencies. It implements a novel multi-layered architecture that combines **introspective reasoning**, **continuous memory**, and **self-modification capabilities** through a unified agentic framework.

Unlike traditional AI assistants, Silhouette operates as a persistent cognitive entity with:
- **Consciousness simulation** through integrated introspection loops
- **Long-term memory** with semantic indexing and graph-based knowledge representation
- **Self-evolution** through controlled GitHub-based code modifications
- **Multi-modal perception** including visual, audio, and textual processing
- **Multi-channel communication** via Telegram, WhatsApp, and Discord
- **Production-grade deployment** with auto-SSL, Docker, and VPS support

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
│           React UI  ·  Telegram  ·  WhatsApp  ·  Discord        │
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
│                   video_gen, memory_write, git_operations       │
├─────────────────────────────────────────────────────────────────┤
│              COMMUNICATION CHANNELS                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Telegram │ │ WhatsApp │ │ Discord  │ │  Web UI  │           │
│  │(Grammy)  │ │(Baileys) │ │(discordjs│ │ (React)  │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
├─────────────────────────────────────────────────────────────────┤
│                    DATA & STATE LAYER                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ LanceDB  │ │ SQLite   │ │  Redis   │ │ Neo4j    │           │
│  │(Vectors) │ │(Persist) │ │ (Cache)  │ │ (Graph)  │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
├─────────────────────────────────────────────────────────────────┤
│                  PRODUCTION LAYER                               │
│  Janus V2 Supervisor · Caddy (SSL) · Docker · CI/CD            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Six-Layer Architecture

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| **Presentation** | React UI + Messaging Channels | User interaction, visualization |
| **Orchestration** | ManagerAgent | Cognitive loop coordination |
| **Specialists** | Agent Pool (500+) | Domain-specific task execution |
| **Capabilities** | ToolExecutor | External world interaction |
| **Communication** | Telegram, WhatsApp, Discord | Multi-channel messaging |
| **Production** | Janus, Caddy, Docker, CI | Supervision, SSL, deployment |

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

### 3.2 Truth Evaluation (Janitor Engine)
A critical part of cognition is resolving conflicting information. The **Janitor Engine** continuously scans working and episodic memory (last 24h) in the background. If it detects logical or narrative contradictions (e.g., "User prefers X" vs "User prefers Y"), it uses an LLM synthesis pass to resolve the conflict, generating a singular **Meta-Truth** and pruning the obsolete fragmented memories.

### 3.3 Continuum Memory

A multi-tier memory system inspired by human cognition:

| Tier | Duration | Purpose |
|------|----------|---------|
| **Immediate** | Seconds | Current conversation context |
| **Working** | Minutes | Active task state |
| **Episodic** | Days | Recent experiences and outcomes |
| **Semantic** | Permanent | Facts, skills, learned patterns |

Memory is indexed using vector embeddings (LanceDB) with graph-based relationship tracking. 
**Recent Enhancement (Brain Integration):** Silhouette features a unified `getCombinedContext` retrieval pipeline that fuses Semantic (Deep) and Episodic (Medium) memories in a single, token-optimized call, significantly improving the agent's contextual awareness without overwhelming the LLM context window.

### 3.4 Self-Evolution System

Silhouette can propose modifications to its own codebase through:

1. **Git Integration**: Read/write access to its own repository
2. **Pull Request Workflow**: All changes require human approval
3. **Version Control**: Full history and rollback capability

```
Silhouette → Proposes PR → Human Reviews → Approve/Reject → Merge
```

### 3.5 Multi-Channel Communication

All channels share the same Brain, memory, and session context:

| Channel | Library | UX Features |
|---------|---------|-------------|
| **Telegram** | Grammy | Continuous typing (4s), Markdown fallback, message chunking (4000 char) |
| **WhatsApp** | Baileys | Composing presence, auto-trust first contact, QR login |
| **Discord** | discord.js | Typing (9s), 1950 char chunking, guild/channel allowlists |
| **Web UI** | React + WebSocket | Real-time dashboard, introspection hub |

**Security:** Each channel supports `open`, `allowlist`, and `auto-trust` access modes. Internal thoughts are filtered (10 patterns) to prevent LLM reasoning from leaking to users.

### 3.6 Janus V2 — Intelligent Supervisor

The Janus process supervisor goes beyond simple restarts:

- **Crash Analysis**: Captures stderr, computes crash signatures
- **Exponential Backoff**: 1s → 2s → 4s → ... → 30s max
- **LLM Repair**: After 3 crashes with same signature, invokes Gemini API for root-cause analysis
- **Learning Loop**: Feeds crash reports to self-evolution system

### 3.7 Multi-LLM Orchestration

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

### 3.8 Google Workspace Integration

Unified plugin with per-service activation:

| Service | Capabilities |
|---------|-------------|
| Calendar | List, create, update events |
| Drive | Upload, search, share files |
| Gmail | Read, send, search emails |
| Docs | Create, read documents |
| Sheets | Read, write, create spreadsheets |
| Slides, Forms, Meet, Places | Full integration |

OAuth2 flow: `GET /v1/google-auth/start?services=calendar,drive`

### 3.9 Production Security

| Layer | Implementation |
|-------|---------------|
| **Auth** | JWT middleware on all API routes |
| **Rate Limiting** | Global, chat, and admin limiters |
| **Prompt Sanitization** | 14 injection patterns neutralized |
| **CORS** | Configurable origin whitelist |
| **Secrets** | `.env.local` + SQLite secrets vault |

---

## 4. Capabilities

### 4.1 Core Tools

| Tool | Capability |
|------|------------|
| `web_search` | Real-time information retrieval |
| `code_execution` | Python sandbox for computation |
| `image_generation` | Visual asset creation |
| `video_generation` | Motion content (WAN, AnimateDiff) |
| `introspect_database`| Universal Database Introspector (Postgres/MySQL/SQLite/Mongo) |
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

## 5. Installation & Deployment

> [!CAUTION]
> **SECURITY DISCLAIMER:** This is a hobbyist research project. It grants autonomous LLMs access to your file system and terminal. Run this inside a sandbox, VM, or strictly controlled environment. The creator is not responsible for accidental data loss or API costs.

### Interactive Setup (Recommended)

```bash
# Clone the repository
git clone https://github.com/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource.git
cd Silhouette-Agency-OS-OpenSource

# Install dependencies
npm install

# Run interactive setup wizard
npx tsx scripts/setup.ts
```

The wizard guides you through:
1. **LLM Providers** — Gemini, OpenAI, Groq, DeepSeek, Ollama
2. **Messaging Channels** — Telegram, WhatsApp, Discord
3. **Deployment Mode** — Local, Docker, VPS, Coolify
4. **Domain & SSL** — Auto-provisioned via Caddy + Let's Encrypt
5. **Google Workspace** — OAuth2 credentials

### Starting the System

| Mode | Command | Use Case |
|------|---------|----------|
| **Local** | `npm run boot` | Development (Janus supervisor) |
| **Docker** | `docker-compose -f docker-compose.prod.yml up -d` | Production |
| **VPS** | Setup wizard + Docker | Remote server with SSL |
| **Coolify** | Git push | Managed deployment |

For detailed deployment instructions, see **[DEPLOY.md](DEPLOY.md)**.
For architecture details, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

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

## 8. V5 Advanced Features & Implementation

### 8.1 Genesis V2 Protocol (Agent Factory)
Genesis V2 is the intelligent birth protocol that scaffolds new cognitive entities automatically. It runs automatically when the OS detects a missing or uninitialized agent roster.
- **How it works:** It uses a 5-step lifecycle (`SEED` → `BOOTSTRAP` → `HANDSHAKE` → `TEACHING` → `VALIDATION`). It generates the underlying `AGENT_TPL` files (Soul, Heartbeat, Tools, Memory), forces the agent to read the Orchestrator's operational manual via the `SystemBus`, and validates their logical consistency.
- **Triggering Genesis:** Genesis runs autonomously via `npm run setup:intelligent` or when an unresolved Core agent is invoked. 

### 8.2 Reasoning Verification v2 (Z3 Symbolic Logic)
Located in `services/introspectionEngine.ts`. The kernel intercepts the agent's proposed `AgentAction`s and mathematically proves they do not violate universal invariants (e.g., trying to modify and delete the same resource simultaneously). 
- **Usage:** This runs silently on every single cognitive cycle. If a logical contradiction is found, the system halts the loop and emits a `SYSTEM_ALERT`.

### 8.3 Extended Modalities (Haptics & Olfactory)
Software-level drivers located in `services/sensory/hapticsDriver.ts` and `olfactoryDriver.ts`.
- **Usage:** Though primarily software abstraction layers for missing physical hardware, these drivers broadcast sensory states (like `HEARTBEAT` haptic pulses or `OZONE` chemical emulation) to the UI's `SENSORY_SNAPSHOT` bus to allow testing immersive biometric hardware setups.

### 8.4 P2P Federated Memory Sync
Agents can sync Generalized knowledge (`DEEP` tier vectors) with other Silhouette instances on different subnets.
- **Usage:** Handled autonomously in `services/federatedMemory.ts`. The instance will broadcast generalized learnings on the `HIVE_MIND_SYNC` channel dynamically.

---

## 9. Future Work

- [x] Multi-agent swarm coordination
- [x] Scale-free network topology
- [x] LLM fallback gateway
- [x] Autonomous curiosity system
- [x] **Academic Paper Generation**: Automated pipeline for research, writing, LaTeX formatting, and peer review simulation (`services/paperPipeline.ts`).
- [x] **Reasoning Verification v2**: Integration with symbolic logic provers via `z3-solver`.
- [x] **Extended Modality**: Software drivers for Haptics & Olfactory.
- [x] **Federated Memory**: P2P knowledge sharing between distinct Silhouette instances.
- [x] **Minimax Core Integration**: Native TTS and Visual-Cortex multimodal support mapping to API.

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
