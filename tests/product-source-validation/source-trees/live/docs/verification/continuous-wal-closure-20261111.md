# Continuous WAL: durability and honest interruption

11 November 2026. Follow-up candidate based on `4a3a12a14ba4e312b409f486f152a0ce7e770fd6`. Changes only the continuous-memory WAL and its real-process tests. No deployment, activation, external provider, schema migration or task reexecution is included.

## Reproduced roots

1. `logBeforeProcessing` returned an ID before the file existed. An immediate process exit lost the supposed write-ahead record. The baseline assertion failed against the actual service and filesystem.
2. Shutdown changed unfinished PENDING entries to COMMITTED. The baseline shutdown assertion observed COMMITTED for an unfinished authored task.
3. Startup accepted a corrupt WAL instead of refusing further writes. The baseline assertion expecting a visible failure failed. The old source could then write an empty/new WAL over the original.
4. The same singleton is initialized by both the DB loader and orchestrator. Initialization was not idempotent, so a second call could treat current-process work as crash recovery.
5. Recovery itself claimed COMMITTED without reexecuting or independently verifying the task. A memory-append error could also be swallowed while commitment appeared successful.

## Changes

- The existing synchronous write-ahead API now writes an exclusive temporary file, fsyncs it, atomically renames it and fsyncs the containing directory on POSIX before returning an ID. Windows has no equivalent directory-handle fsync through this API; no Windows power-loss guarantee is claimed.
- Failed WAL persistence throws, rolls back the attempted in-memory append and blocks further writes in that process. Restart must recover from the actual durable file rather than continuing from an uncertain RAM view.
- Corrupt JSON, malformed records, duplicate IDs and lexically escaping agent IDs are refused. The original file is not deleted, quarantined or replaced with empty state.
- Initialization is idempotent. Shutdown preserves pending entries and writes synchronously; it never manufactures successful processing.
- Startup records unfinished work as INTERRUPTED, with the original ID, payload and time retained. It writes an explicit interruption notice, not a completed-task result. Interrupted records are not pruned by the existing committed-record cleanup policy.
- Caller-requested commitment verifies an exact, ID-bearing memory receipt before marking COMMITTED. Repeating the same commit does not append duplicate summaries. An unknown ID, conflicting retry, failed append or failed WAL replacement is visible to the caller.

COMMITTED here records the caller's processing/memory boundary. It is not independent verification that an external action, answer or project is correct. Recovery does not automatically rerun a task.

## Executed evidence

The actual service runs in separate Node processes with disposable directories and credential-free environments. The full suite is additionally run in a private network. Fixture payloads are authored test inputs, not substituted service/provider responses.

Seven automated real-process tests cover:

- immediate process exit after a durable write, followed by a new process retaining the original payload as interrupted;
- shutdown retaining pending work;
- idempotent initialization and exact committed-memory receipt readback;
- corrupt original preservation and refused new writes;
- real filesystem append failure remaining pending;
- real atomic-replacement failure preserving the original record and exposing failure;
- old interrupted work surviving the existing committed-record retention cleanup.

The pre-fix failures and final positive logs are retained separately. Final whole-suite/lint/build results are supplied with the candidate commit. They do not establish full application shutdown, outcome ownership or product acceptance.

## Remaining boundaries

- The full application's shutdown still catches some cleanup errors, and the curiosity service's queued writes are not drained by the app shutdown handler. Those are separate lifecycle work, not claimed solved by this file.
- There is no complete task-resume/reexecution workflow here. Interrupted work stays explicit and recoverable; a human-readable notice is not an executed recovery plan.
- Historical entries already lost by the old implementation cannot be reconstructed by this change.
- Existing committed-WAL retention is unchanged. This is not proof that all original conversation/task payloads have eternal canonical retention across the whole product.
- The agent-directory symlink/ownership boundary is not reviewed here. This remains a single-writer local WAL. Multi-process writer coordination and production-scale synchronous-write latency are unproven.
- Independent review and a global typecheck of this candidate remain required before any merge proposal. Neither earlier typechecks nor successful builds replace that gate.

## Rollback

INTERRUPTED is a new WAL state. Do not run an older WAL handler on these records: older cleanup can mistake that state for a prunable terminal record. Preserve the exact WAL and agent-memory files before a reviewed rollout. A rollback must preserve unresolved records and their interruption metadata; restoring an old source archive over current stores is not safe. No rollback or production migration was executed in this batch.
