# Biomimetic outcome and continuity repair

11 November 2026. Follow-up to the three ingress fixes in PR212, based on `da6ee511cd04b6eda6004de860d8efc506b32c56`.

## Reproduced failures

These were executed against actual services in disposable files/databases, not inferred from module names or mocked responses:

| Boundary | Baseline observation | Repair and executed check |
|---|---|---|
| Curiosity ESM import | Node 22.18 ESM threw `require is not defined` before a gap could be tested. | Native imports replace require in initializer and persistence paths. |
| Gap continuity | After fixing only the import, addGap reported a pending question, but a fresh process restored 0 of 1. | Restore barrier, awaited callers, serialized atomic writes, periodic/batch/status persistence. Two original questions remain in a fresh process. |
| Actual bus topic ingress | A real MEMORY_CREATED event produced 0 tracked topics. The handler treated ProtocolEvent as its payload. | Unwrap the actual payload, queue event updates after restore, persist topics. One memory topic and one thought topic remain after process exit and restart. |
| Experience identity | recordFailure followed by getRelevant returned a different UUID and newly invented time. | Versioned full experience record preserves UUID, time, agent and delimiter/newline-bearing fields in a fresh process. Legacy text uses the actual memory node ID/time and labels that provenance; it cannot recover an original experience UUID that was never stored. |
| Rejected experience write | The actual memory recursion guard rejected content, but recordFailure returned success and added one phantom RAM entry. | Canonical receipt readback precedes RAM insertion and success logging; missing readback throws and leaves the buffer unchanged. |
| Improvement outcome | An unmatched context returned true and incremented autoApplied despite no action branch. Other branches generated proposals or returned void, without application evidence. | Explicit routing outcomes describe the boundary reached. Generated patches are retained as proposals, not tagged APPLIED. No application is claimed without an independent participant receipt. Existing callers log the actual outcome rather than emitting an invented auto-applied thought. |
| Discovery persistence | The source caught storage failure internally and allowed research to mark RESOLVED. | Canonical content readback with a deterministic attempt-content tag is required. An actual store rejection propagates instead of being treated as saved knowledge. This is a persistence test, not a successful research/synthesis test. |

## Executed validation

`tests/real-process/biomimetic-continuity-child.ts` has explicit fixture modes. Each ran in a separate Node process with real service imports, no provider responses or service doubles, provider transport OFF, a separate filesystem/database and an isolated network:

- `experience-write`: original UUID, timestamp, agent, newline and delimiter-bearing fields read back exactly.
- `experience-read`: fresh-process durable readback matches the original; RAM history remains empty, explicitly not mistaken for recovered history.
- `experience-legacy`: actual memory-node ID/time and agent retained with legacy provenance.
- `experience-rejected`: actual memory recursion guard rejects persistence; caller sees rejection and buffer count stays zero.
- `learning-outcomes`: unmatched context is UNHANDLED; an authored prompt proposal reaches verified local storage; retry reads the same proposal; an actual rejected write returns FAILED; autoApplied delta stays zero.
- `gap-write`: two concurrent additions plus actual memory/thought bus events persist.
- `gap-read`: separate process restores the two questions and both topic counters.
- `discovery-readback`: authored fixture content reaches canonical memory; actual rejected content fails readback. No search or LLM output is claimed.
- `gap-corrupt`: broken JSON is left byte-identical, and mutation is refused instead of overwriting the original.

Final code checks:

- Complete configured suite: 1459 passed, 0 failed, 2 skipped, 226 files, 92.50 seconds. This suite includes doubles and static checks and is separate evidence from the real-process probes.
- Global lint: 0 errors, 419 existing warnings. Targeted files: 0 errors, 3 pre-existing warnings in the narrator/daemon.
- Global TypeScript check: exit 0 in an isolated verification source copy, private network, read-only dependencies and 2560 MB heap. No application import or production-data test. The live app's PID/restart count remained unchanged.
- Frontend build: passed, 21.40 seconds. Server build: passed, 4.38 seconds. Existing chunk warnings remain.
- `git diff --check`: passed.

The earlier intermediate suite/build/typecheck runs and failing baseline logs are retained separately. A shell tail-formatting error after an earlier successful build was a reporting-command error, not a build failure; the final logs above were read successfully.

## Deployment scope, not authorization

This patch changes local service logic and a versioned experience text format. It adds no dependency, schema migration, provider credential, provider activation, training, autonomy activation, sandbox installation, network publication or shared proxy change. Legacy experience text remains readable with its explicit provenance limitation. Rollback must retain the new durable records rather than overwrite stores with an old source archive; older code does not understand the V2 experience format correctly. A future deployment needs its own reviewed scope and state-preserving rollback.

## Still unproven or incomplete

- Positive observation-to-reflection-to-valid-insight-to-research-to-measured-improvement chain.
- Meaningfulness, truth and novelty of generated insights; positive provider-backed research and independent verification.
- Positive dream consolidation and durable identity-evidence maturation.
- Complete durable recent-history replay into the bounded learning failure selector. Its current-process RAM source is still explicitly bounded.
- An application participant with actual regression-safe improvement receipts. All current LearningOutcome variants have `applied: false`; this is an honest limit, not implemented effective learning.
- Automatic shutdown drainage of outstanding curiosity event writes. The explicit wait boundary proves completed writes; a void event emission alone is not a durability receipt.
- Affective feelings, subjective consciousness or scientific consciousness measurement. None is established by these repairs.

No merge, deployment or activation is included in this verification.

Operational caveat: exact-tag canonical readback uses the existing getLatestObservation path, which scans canonical records. These disposable-fixture checks do not establish acceptable latency on a large production memory store. Benchmark or replace it with a receipt-oriented indexed boundary before a performance-sensitive rollout; do not silently remove verification to make it faster.
