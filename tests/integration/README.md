# Real memory integration checks

These are explicit standalone tests, not automatically discovered Vitest tests.
They use public deterministic precomputed vectors, never generated embeddings.
A safety loader rejects model/bootstrap imports and fetches outside the provided
loopback Qdrant URL. No service is mocked by this loader. It is PARTIAL DEFENSE, not OS isolation:
direct net/http, child_process and redirects are not confined by it. Final
acceptance needs an independently reviewed namespace/process boundary.

Required before running any engine-backed script: an independently approved finite
sandbox and resource/disk/time budget, a disposable empty Qdrant store, an existing
local Qdrant executable, and no production credentials. These scripts neither install
nor provision a production engine. Configure engine workers/CPU/memory externally.

Shared environment:

```
QDRANT_CONSUMER_TEST_URL=http://127.0.0.1:19333
QDRANT_CONSUMER_GUARD_AUDIT=/approved-disposable-dir/guard.txt
QDRANT_CONSUMER_TEST_RESULT=/approved-disposable-dir/result.json
UNIFIED_MEMORY_TEST_DIR=/approved-disposable-dir/qdrant-eval-test
VECTOR_ENGINE=scan
LANCEDB_OPTIMIZE_INTERVAL_MINUTES=0
```

The entry guard requires a `qdrant-eval-` path marker for canonical test data. Run
from a private empty working directory using absolute paths to the repo scripts:

```
node --max-old-space-size=256 \
  --import /path/to/repo/tests/integration/qdrant-no-models.guard.mjs \
  --import /path/to/repo/node_modules/tsx/dist/loader.mjs \
  /path/to/repo/tests/integration/canonical-consumers.real.ts
```

- `canonical-consumers.real.ts`: real LanceDB and real consumers with explicitly
  disabled Qdrant. Does not start an engine or prove Qdrant replay.
- `local-projection-recovery.real.ts`: real filesystem projection failure, canonical
  retention, no premature activation, reopen and Lance repair with Qdrant disabled.
- `projection-fairness.real.ts`: 101 prepared orphans, durable scan cursor across
  reopen and valid 384-dimensional local replay behind them; no Qdrant engine.
- `projection-ordering.real.ts`: deterministic scheduling barrier in actual replay,
  newer same-ID write from a second service instance, stale receipt rejection and
  stable Lance versions/counts across down-mirror retries and reopen. No mocked I/O.
- `qdrant-backend.real.ts`: real local Qdrant backend lifecycle/schema/ID/filter/
  Brand compatibility checks. This rewritten final split test is not yet executed.
- `unified-memory.real.ts`: real LanceDB and Qdrant down/up, replay/reopen and consumers.
  A prior revision passed 15 checks; the final revision is not yet engine-tested.

Require exit 0 AND a completed result AND guard audit containing only
`guard_installed` for a clean positive run. Preserve failures. A blocked import,
missing result or resource failure is not a pass. Inspect/stop every child engine
and account for total logical disk usage across attempts before declaring cleanup.

No script proves model quality, consciousness, million-row performance, full
Dreamer operation, multi-level RAPTOR generation or useful applied learning.
