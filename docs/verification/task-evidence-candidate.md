# Task evidence candidate, not integrated

Base: 88d139b9ce3dea8138b49572fd06b89a436b1bdc. Product delta: four source files. No workflow, default, provider, permission, scheduling, or deployment changes.

This candidate preserves per-attempt task evidence, immutable output references, timeout verdicts and late outcomes. It uses explicit attempt/event identities, keeps conflicts for review, and releases the RAM hold only after the corresponding persisted timeout and late result are acknowledged. It does not establish complete awareness or coordination of Silhouette's workload.

## Compatibility boundary

Done/Late calls without explicit context on versioned rows preserve the result as unattributed evidence and create a review blocker. This is a **conservative API migration**, not transparent compatibility. Runtime planExecutor calls carry explicit attempt identity. The previous application test suite has not been updated or validated for this migration. Legacy rows retain their original snapshot and unknown metadata. No historical batch repair is performed.

## Verification record

Preparation records marked PREPARED/NO EXECUTION are retained as history. One authorized V4 harness execution then completed with exit 0 and 25 CASE_PASS groups. This is not coverage of all 32 proposed cases.

The harness used exact extracted taskLedger bodies with declared singleton/type substitutions, exact SQLite methods/validator, and both exact ACK boundaries from planExecutor. It used the existing SQLite driver and temporary real SQLite/filesystem operations. Source and extraction hashes were checked before importing the extracted modules. Clock/UUID controls, directory fsync and competing-destination faults, SQLite abort/deferred-constraint failures and deterministic two-connection stale-selection interleavings were declared fixture mechanics.

Covered groups include timeout/late orderings, replay without clock mutation, conflict after prior review, legacy-result attribution boundaries, malformed metadata preservation, immutable output files, inline fallback, real SQL rollback/COMMIT constraint failure, orphan preservation, historical uncertainty, selected reconciliation and admission metadata. Expected injected errors remain visible in the full log.

## Limits

- No application import, full product class execution, complete typecheck or old application suite was run for this delta.
- Principal fixtures are not authentication proof. HTTP authorization and runtime wiring remain statically reviewed only.
- Two-connection deterministic interleavings are not parallel-process stress testing.
- Deferred-constraint COMMIT failure is not disk failure, power loss or crash-recovery proof.
- Filesystem publication and SQLite commit are not jointly atomic. Immutable orphan files may remain after a database failure; no automatic cleanup is introduced.
- A timeout that never persisted can still lose its RAM-only barrier on process death. No total restart-safety claim is made.
- Optional untested cases remain listed in the retained coverage record. The result is a bounded candidate, not a production completion claim.
