# Changelog

All notable changes to Silhouette Agency OS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.2.0] - 2026-06-18

### Added

#### Enterprise Desktop Packaging
- **Professional NSIS Installer** with custom wizard, license agreement, and desktop shortcuts
- **Auto-Update System** via `electron-updater` with GitHub Releases integration
- **Protocol Handler** registration (`silhouette://`) for deep linking
- **Multi-platform builds** — Windows (NSIS), macOS (DMG), Linux (AppImage + deb)
- **Native module unpacking** — `better-sqlite3`, `@lancedb`, `sharp` properly extracted from ASAR

#### CI/CD Pipeline
- **Release Workflow** (`.github/workflows/release.yml`) — Automated cross-platform builds on tag push
- **Enhanced CI** — Security audit, strict lint/test enforcement, improved caching
- **Artifact Publishing** — Automatic upload to GitHub Releases with checksums

#### Anonymous Opt-In Telemetry
- **Privacy-First Analytics SDK** (`services/telemetryAnalytics.ts`)
  - Anonymous UUID, no PII, no file paths, no chat content
  - Local SQLite buffer with periodic batch flush
  - Graceful offline handling — events persist until connectivity
- **Consent Management** — Explicit opt-in during onboarding setup wizard
- **Privacy Dashboard** in Settings — view collected data, opt-out, purge all data
- **Analytics API** (`/v1/analytics/*`) — events ingestion, consent CRUD, data deletion

### Fixed
- Production splash screen path using `process.resourcesPath`
- Missing `preload.cjs`, `pythonManager.cjs` in electron-builder files array
- Windows icon format — proper `.ico` generation from PNG source
- `node_modules` runtime dependencies included in packaged builds
- Native modules (`better-sqlite3`, LanceDB) properly unpacked from ASAR archive

### Security
- Crash reporter with PII-free stack traces
- Telemetry proxy validates event schema before ingestion
- All analytics data deletable by user at any time

---

## [2.1.0] - 2026-01-07

### Added

#### New Services
- **LLM Gateway Service** (`services/llmGateway.ts`)
  - Unified multi-provider LLM access
  - Automatic fallback chain: Gemini → Groq → DeepSeek → Ollama
  - Circuit breaker pattern per provider (auto-recovery after 60s)
  - Streaming support for real-time responses
  - Health monitoring and metrics

- **CuriosityService** (`services/curiosityService.ts`)
  - Autonomous knowledge exploration
  - Detects frequently mentioned topics lacking depth
  - Generates research questions using LLM
  - Proactive web search to fill knowledge gaps
  - Auto-stores discoveries in memory and graph
  - Runs exploration cycle every 15 minutes during idle

- **Neo4j Index Initialization Script** (`scripts/init_neo4j_indexes.ts`)
  - Creates 5 performance indexes for graph operations
  - `idx_rel_lastAccessed` - Pruning cycle decay queries
  - `idx_rel_weight` - Pruning cycle removal queries
  - `idx_node_id` - Fast node lookup by ID
  - `idx_node_label` - Fast node lookup by label
  - `idx_node_content_fulltext` - Full-text search on content

#### New Endpoints
- `GET /v1/graph/health` - Network health metrics, top hubs, at-risk connections
- `GET /v1/graph/hubs` - List of top hub nodes with degree
- `GET /v1/system/llm-health` - LLM provider status and circuit breaker states

### Enhanced

- **Memory Pressure Monitor** (`services/continuumMemory.ts`)
  - Auto-consolidates when working memory exceeds 500 nodes
  - Logs warning at 400 nodes threshold
  - Prevents OOM errors during long sessions

- **Dreamer Service** (`services/dreamerService.ts`)
  - Integrated with EurekaService for multi-tier gap detection
  - Now searches for Watts-Strogatz shortcuts during sleep cycle
  - Creates bridges between conceptually distant nodes

- **Narrative Service** (`services/narrativeService.ts`)
  - Bidirectional graph linking for high-importance thoughts
  - Generates embeddings and finds related concepts
  - Creates `MENTIONS` relationships to existing Concept nodes

- **Context Janitor** (`services/contextJanitor.ts`)
  - Semantic contradiction detection
  - Identifies memories with overlapping topics but opposite sentiments
  - Auto-downgrades weaker contradictory memories
  - Tags ambiguous pairs for human review

- **Hub Strengthening Service** (`services/hubStrengtheningService.ts`)
  - Batched Hebbian reinforcement (reduces DB load)
  - Deduplication of reinforcement requests
  - Configurable batch sizes and intervals
  - Combined health check query for efficiency
  - Force flush and graceful shutdown support

### Performance
- Graph pruning queries now 10x faster with Neo4j indexes
- Memory consolidation prevents runaway memory usage
- LLM calls resilient to individual provider failures

---

## [2.0.0] - 2024-12-XX

### Initial Release
- Multi-agent orchestration system
- Continuum memory with 4 tiers
- Introspection engine with OODA loop
- Knowledge graph with Neo4j
- Multi-modal capabilities (image, video, audio)
- Self-evolution through GitHub integration
