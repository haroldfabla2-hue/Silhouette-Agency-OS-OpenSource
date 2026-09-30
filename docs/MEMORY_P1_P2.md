# Memory P1/P2 implementation status

This branch is stacked on P0. It does not claim the full guide's production exit criteria.

## P1 implemented

- LanceDB FTS indexes both legacy memory and a new canonical records table. Search filters owner before retrieval; no first-500-row scan.
- Existing memory is preserved and read through a legacy path. New canonical records do not contain placeholder zero vectors.
- Finite, nonzero embeddings with explicit model/version/dimension are projected into separate model-specific tables. Unknown or invalid vectors remain pending for explicit re-embedding. `pendingEmbeddings` and `projectEmbedding` expose this durable queue and consumer contract.
- Cross-tier reciprocal rank fusion, deterministic lexical reranking, newest-ID deduplication and a conservative estimated context budget.
- Qdrant remains available. Its lexical fallback paginates and filters owner. Unknown model identity is not compared semantically. Set matching model metadata only after validating the actual provider and stored corpus.

Pending: automatic provider-aware re-embedding consumer, ANN index training/backfill, real-corpus shadow recall@10/p95 benchmarks, calibrated/tokenizer-based budgets and measured reranker rollout. Current model-specific vector queries are exact LanceDB vector search, not a demonstrated ANN speedup.

## P2 implemented

- Non-destructive activation calculation with rate-limited significant accesses, bounded frequency and protected retention tags. `recordMeaningfulRecall` is an explicit API; ordinary automated reads do not reinforce memories.
- Deterministic sleep selection with duplicate diversity; archives require every selected exact span to cite an existing source. Unsupported output fails closed and leaves source transitions uncommitted. Original episodic content is retained.
- Dream intuitions are tagged HYPOTHESIS. They no longer write factual graph edges or emit action-triggering consolidation signals automatically.
- Disk-backed temporal claim/procedure registry with owner isolation, immutable claim identity, valid-time queries, overlapping contradiction state and temporal succession references. Procedures require execution-source IDs, successful outcome records and explicit approval; failed outcomes revoke them.

Pending: production calibration, semantic clustering, live-model summary quality evaluation, temporal graph extractor/canonical entity resolution/multilingual NLI, authenticated review UI and sandbox execution integration, lineage purge/backup retention and end-to-end ACL/rollback workflows. The registry is groundwork, not proof of an autonomous procedural system.

## Validation

New tests use real LanceDB and real filesystem persistence. Numerical vectors are declared fixture coordinates, not fake model embeddings or quality measurements. Existing repository tests contain legacy mocks; this change introduces none and does not skip tests.

Local full suite: 22 files, 166 tests passed. Local targeted additions: seven tests passed, including match at row 501, invalid vectors, model separation, owner isolation, temporal conflicts, persistence/restart, procedure rejection/approval/revocation and retention time travel. Full typecheck needs CI validation because the local workspace has 2 GB RAM.
