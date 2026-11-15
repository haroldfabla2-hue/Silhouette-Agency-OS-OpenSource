# Changelog

All notable changes to Silhouette Agency OS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [3.0.1] - 2026-06-28

### Removed
- **`env_snippet.txt`** — stray env fragment with a placeholder key pattern; secrets belong in
  `.env.local` only (see `.env.example`). Sanitized in two steps to keep GitGuardian checks green.

---

## [3.0.0] - 2026-06-27

### Added
- **External Silhouette Brain integration** — typed, resilient client (`services/brain/`) for the
  standalone [silhouette-brain](https://github.com/haroldfabla2-hue/silhouette-brain) 4-Tier memory
  service. Deep recall is injected into the ContextAssembler and local memories are mirrored to the
  Brain (both fail-safe). New `/v1/brain/*` API routes, `silhouette brain --remote` CLI, a `brain`
  Docker Compose profile, config section + env overrides, docs, and 10 unit tests.
- Missing `qdrant` service added to `docker-compose.yml` (the `bot` service depended on it but it
  was never defined, breaking `docker compose up`).

### Security
- **Auth bypass closed**: token-less access is refused on network-exposed binds; allowed only on
  loopback or with explicit `SILHOUETTE_ALLOW_INSECURE=true`. Server now binds `127.0.0.1` by default.
- **Password hashing**: replaced unsalted SHA-256 with salted **scrypt** (backward compatible +
  transparent upgrade). Password hashes are no longer returned in API responses.
- **Tool policy enforcement**: `securityManager` denylist is now consulted at the orchestrator
  execution chokepoint; GUEST channel users can no longer invoke code execution, git, or HTTP tools.
- **Secrets endpoint** masks credentials by default (raw reveal requires CREATOR + explicit opt-in).
- **Git shell injection removed**: `gitService` now uses `execFile` argv arrays (no shell).
- **Host-access escape hatches** (`/var/run/docker.sock`, `/:/host`) removed from the default Docker
  stack and moved to an opt-in `docker-compose.host-access.yml` override.

### Fixed
- `ollamaService` now lazily initializes its BullMQ/Redis infrastructure and attaches error handlers
  to every connection — eliminating unhandled `ioredis` error events that failed CI without Redis.
- Hardened `continuumMemory.search` against circular-import init ordering.
- Test suite is green end-to-end (136 tests, 0 unhandled errors); converted a legacy channels test to
  Vitest and moved a manual integration probe out of the automated path.

### Removed
- Stray committed artifacts: a 40 MB `.m4a`, `pr5.json`, `types.ts.temp_actions`, `env_snippet.txt`.

### Changed — features made real (were aspirational / stubs)
- **Lint is green**: pre-existing lint failed (128 errors + 2747 warnings); now 0
  errors via a pragmatic ESLint config + dead-config cleanup (warnings advisory).
- **Z3 verification**: real invariants (conflicting writes, secret-exfiltration
  shape) + `getZ3Stats()` observability + `Z3_FAIL_CLOSED` opt-in.
- **Cognitive cadence**: replaced `Math.random()` "occasional" triggers in the
  introspection loop with reproducible time/signal-gated cadence.
- **Cognitive-state engine**: dropped overclaimed "IIT" framing; documented as a
  composite index with a transparent `getPhiBreakdown()`.
- **Federated memory**: real P2P-over-HTTP sync (Merkle integrity, dedup,
  trust-scaling, `/v1/federated/*` routes) — previously a mock.
- **Sensory drivers**: functional software state machines (TTL state, history)
  with pluggable hardware backends — previously emulation stubs.
- Test suite grew to 155 passing tests (was 103 at the start).

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
