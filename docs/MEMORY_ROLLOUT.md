# Opt-in memory rollout groundwork

Builds on merged PR #20. Existing runtime retrieval is unchanged. New services
are explicit opt-in APIs, not daemon integrations or production cutover.

## Provider-aware projection

`MemoryProjectionRollout` has separate backfill and ANN-shadow flags, both off by
default. Projection collections use provider/model/version/dimension identity.
Backfill compares durable fingerprints, calls an explicit provider, checks finite
nonzero vectors and rechecks source revisions before writing. Canonical memories
remain unchanged. Search rechecks canonical owner, revision, deletion and
HYPOTHESIS status. Exact bypasses the index even after IVF_FLAT training.
ANN requires an actual trained index. There is no default ANN cutover.

`LexicalHashProvider` is a real deterministic lexical embedding baseline. It is
NOT a neural semantic model. No Gemini/Ollama provider identity is guessed and no
provider credentials are used. Backfill currently scans canonical records and
projection metadata in memory; this is bounded local groundwork, not a scalable
streaming consumer. Concurrency is serialized within one rollout instance, not
across processes. Old/deleted vector rows are rejected at canonical hydration;
physical projection garbage collection is still pending.

## Measured baseline

See MEMORY_ROLLOUT_BENCHMARK.json and scripts/benchmark_memory_rollout.ts.
Measured before this documentation was added, on September 30, 2026, Node
22.23.3, 2 logical CPU Xeon 2.60 GHz, 2 GB workspace:

- 4,952 unique non-overlapping 60-word passages from services/docs/server.
- Lexical hash 64 dimensions, cosine IVF_FLAT, 32 partitions, 8 probes.
- 100 source-derived queries after 10 warmups, k=10.
- Mean recall@10 versus exact: 0.854.
- Exact p95: 10.670 ms. ANN p95: 9.573 ms.

Timings include connection/table-open and raw vector query, not canonical
hydration, neural embedding latency or full agent response. Queries are not a
held-out human-labeled relevance set. This recall does NOT justify cutover and
this modest latency difference does NOT prove a production speedup. The actual
repository corpus had 4,952 unique passages, so a requested 10,000-passage run
was rejected rather than inflating it through repeated/artificial rows.
Script corpus size defaults to 4,952; source additions can alter corpus ordering
and count. Benchmark results are measurements, not test assertions or targets.

## Temporal extraction boundary

`temporalClaimExtraction` validates owner/source ID, exact offsets, fields in the
evidence span and time intervals. Negation and uncertainty require review.
Extractively supported candidates remain PROPOSED or CONFLICTED, never automatic
CONFIRMED facts. This is a bounded grounding critic, NOT NLI or calibrated truth
confidence. Entity resolution, semantic entailment and contradiction models,
multilingual evaluation and authenticated human claim review remain pending.

## Procedure sandbox boundary

`procedureFileSandbox` executes a closed JSON contract: write new files and assert
SHA-256 postconditions inside a fresh disposable temp directory. No shell,
arbitrary code, network, user-supplied symlinks or external paths. Limits: 32
operations, 1 MiB written content, strict relative filenames. At least one hash
postcondition is required. Receipts contain owner/version/contract hash/outcome;
temp files are deleted. Approved runs require the registry's exact owner/version
state. Failed approved runs revoke through the existing evidence registry.

This is a file-only capability interpreter, NOT an OS/container sandbox for
arbitrary procedures. Human authentication for registry approval is still the
caller's responsibility; the API does not claim to establish it. Production
execution adapters, signed approvals, durable execution receipts, cross-process
locking and deployment isolation remain pending. Procedure tests are real file
writes and reads, not simulated execution.

## Validation

Five additional real tests, no mocks/skips added. Full local suite: 24 files,
171/171 passing on Node 22. Full lint: zero errors, 400 pre-existing warnings.
Local full typecheck could not complete within the 2 GB workspace budget and
triggered an execution outage. Node 20/22 CI must independently validate full
lint/typecheck/tests/builds. Existing audit tolerates known vulnerabilities;
CI green must not be described as security clean.
