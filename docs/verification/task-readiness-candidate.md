# Bounded readiness candidate

Base: 686f0d26478d39204f0087e9c9828eafc9d177d4. This branch adds one explicit EvidenceAck generic and updates two test contracts. No execution order, provider, workflow, permission or production setting changes.

## Evidence and limits

- The preceding V4 evidence harness passed 25 groups before this type-only annotation. It was not rerun after this annotation or test edits, and does not represent all 32 proposed cases.
- First compiler-only check: 437 sources, 75 diagnostics, exit 1. It exposed two Ack typing diagnostics and missing SQLite declarations.
- A broader resolver attempt aborted with heap OOM, exit 134. This remains a failed attempt, not a compiler result.
- The same bounded original resolver with only the explicit EvidenceAck annotation read 437 sources and returned 73 diagnostics, exit 1. The two Ack diagnostics were no longer reproduced.
- Exact published @types/better-sqlite3 9.6.0 bytes were fetched without installation, and registry SHA512 integrity was verified. The declaration requires TypeScript 5.6; the check used existing TypeScript 5.8.3 and existing node types without upgrades.
- A final compiler-only check using that real declaration read 438 sources and returned 66 diagnostics, exit 1, with no diagnostics in the four changed source roots under this limited host. This is not a globally clean typecheck or green CI. The 66 transitive diagnostics remain unclassified against a causal baseline.

## Test-contract migration

The mission lifecycle contract now passes the exact admitted attempt context for normal results and retains the completed/failed/artifact/error assertions. A separate test makes the conservative context-free migration explicit: on a versioned row, Done/Late without context preserves unattributed evidence and a review blocker rather than claiming completion or attributing it to a current attempt.

The reconciliation contract checks the 409 status and empty candidate list when no eligible uncertainty remains, rather than depending on an old error string. These test changes were reviewed statically only. No old application suite or isolated contract runner was executed. The old tests import application-heavy modules, so a direct run was not treated as safe under the current validation scope.

This branch is a review candidate, not an integrated or deployed result. No claim of total non-degradation, complete workload awareness, real HTTP authentication/runtime validation, total restart safety, joint filesystem/database atomicity, or complete autonomous-entity behavior is made.
