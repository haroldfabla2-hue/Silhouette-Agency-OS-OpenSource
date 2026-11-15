# Silhouette Brain Integration

This OS can offload long-term cognition to the standalone
[**silhouette-brain**](https://github.com/haroldfabla2-hue/silhouette-brain)
service — an independent Python micro-service that implements a **4-Tier memory
architecture** (Working/Redis · Medium/SQLite · Long-Term/Vectors · Deep/Neo4j)
plus a reasoning engine, exposed over a plain HTTP API (default port `9876`).

The integration is **optional and fail-safe**: if the Brain is disabled or
unreachable, the OS keeps running on its native memory with zero behavioural
change. Nothing in the cognitive loop can be taken down by the Brain.

## How it works

```
┌────────────────────────┐        HTTP (9876)        ┌────────────────────────┐
│   Silhouette Agency OS  │ ───────────────────────▶ │     silhouette-brain   │
│                         │  /api/reasoning/context   │  Working · Medium ·    │
│  ContextAssembler  ◀────┼───────────────────────────│  Long-Term · Deep      │
│  ContinuumMemory ──────▶│  /api/memory (mirror)     │  + Reasoning Engine    │
└────────────────────────┘                           └────────────────────────┘
```

| Direction | OS component | Brain endpoint | Purpose |
|-----------|--------------|----------------|---------|
| **Read** | `services/contextAssembler.ts` | `GET /api/reasoning/context` | Inject deep recall + synthesis into the agent prompt |
| **Write** | `services/continuumMemory.ts` | `POST /api/memory` | Mirror local memories into the Brain (fire-and-forget) |
| **Ops** | `server/routes/v1/brain.routes.ts` | various | Authenticated proxy/health surface (`/v1/brain/*`) |
| **CLI** | `silhouette brain --remote` | `GET /api/status` | Inspect the remote Brain from the terminal |

Implementation lives in [`services/brain/`](../services/brain):
- `brainClient.ts` — typed, resilient HTTP client (timeouts, health caching, graceful degradation).
- `brainMemoryBridge.ts` — formats Brain recall into prompt blocks and mirrors writes.

## Enabling it

Set the Brain URL (auto-enables the integration):

```bash
# .env.local
BRAIN_API_URL=http://localhost:9876
# BRAIN_API_ENABLED=true     # optional explicit toggle
# BRAIN_API_KEY=...          # optional, only if the brain sits behind an auth proxy
# BRAIN_API_TIMEOUT_MS=8000
```

### Running the Brain with Docker Compose

A `silhouette-brain` service is bundled behind a Compose **profile** so it never
interferes with the default stack. It builds from a sibling checkout of the
brain repo:

```bash
# 1. Clone the brain next to this repo
git clone https://github.com/haroldfabla2-hue/silhouette-brain ../silhouette-brain

# 2. Bring up the OS + the Brain together
docker compose --profile brain up -d
```

Inside the Compose network the bot reaches the Brain at
`http://silhouette-brain:9876` (already wired via `BRAIN_API_URL`).

You can also point at an externally-managed Brain by overriding `BRAIN_API_URL`,
or change the build context with `BRAIN_CONTEXT=/path/to/silhouette-brain`.

## HTTP surface (`/v1/brain/*`)

All routes require the same auth as the rest of the API.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/v1/brain/status` | Integration + remote service status |
| `GET`  | `/v1/brain/context?query=...` | Unified reasoning context |
| `GET`  | `/v1/brain/semantic?query=...&limit=5` | Vector semantic search |
| `GET`  | `/v1/brain/entities?type=...` | Tracked entities |
| `GET`  | `/v1/brain/graph?entity=...` | Neo4j relationship graph |
| `POST` | `/v1/brain/memory` | Store a memory (`{ text, importance?, tags?, tier? }`) |
| `POST` | `/v1/brain/feedback` | Record source-ranking feedback |

## CLI

```bash
silhouette brain --remote          # remote Brain capabilities & health
silhouette brain --remote --json   # machine-readable
```

## Failure modes

- **Brain disabled** → all read calls return empty, writes are skipped. No-op.
- **Brain unreachable** → availability probe fails (cached for 30s), context
  assembly proceeds with native memory only; writes are dropped silently.
- **Slow Brain** → requests are bounded by `BRAIN_API_TIMEOUT_MS` and, on the
  chat hot-path, by the ContextAssembler's per-turn timeout.
