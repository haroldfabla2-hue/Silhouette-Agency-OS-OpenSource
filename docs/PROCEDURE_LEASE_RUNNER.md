# Explicit lease runner: canonical contract, live cancel, durable result

`runLeasedFileProcedure` joins the opt-in SQLite ledger with the existing isolated
closed file worker. No daemon, network/API execution endpoint, default execution
or migration is installed. Existing file-test APIs remain backwards compatible.
Caller must separately authenticate owner and authorize this exact execution;
registry approval alone does not call the runner. The explicit reservation names
owner, procedure/version, exact contract hash, epoch and run ID.

Runner reads the immutable canonical contract from ledger, verifies its stored
hash and live reservation, then rechecks just before process spawn. Caller cannot
substitute procedure steps. Worker stays in private tmpfs, empty env, isolated
namespaces, no host outputs/network; optional pinned seccomp and prlimit retained.

During execution, a 25ms timer checks the LOCAL SQLite lease, not external sites.
Another connection's revocation or a ledger read error aborts and kills the real
process group with SIGKILL. Optional external AbortSignal also cancels. Timer and
listeners are removed on completion. Final receipt is committed by ledger.finish
with transactional revocation/epoch check. Revoke wins over a late success.
One-time completion prevents reuse. Receipts persist across SQLite reopen.

Polling is bounded best-effort cancellation, not an instantaneous kernel-atomic
revocation guarantee. Event-loop stalls/OS scheduling can delay it; worker may
finish before a poll, but final transaction still cannot record success after
revocation. Private tmpfs effects disappear with worker; no rollback of external
systems is claimed. Interrupted/canceled execution records succeeded=false with
operations=0, meaning no verified completed count, not proof of zero partial
internal operations. Crash can leave RESERVED for operator recovery; no retry or
automatic stale-lease stealing. Observer callback is trusted internal telemetry,
not user code or permission. No signed attestations, cgroup quotas or identity UI
integration claimed. cgroup mount remains read-only in validation environment.

Four new real tests: canonical worker actually writes/checks hashes, durable
successful receipt survives reopen, replay rejected; revoked lease cannot spawn;
revocation from second SQLite connection kills actual spawned process and records
REVOKED; external cancellation kills actual process and records FAILED. Existing
ledger/seccomp/namespace tests unchanged. Tests use real disk, process IDs and
stored states, not mocked worker outputs or simulated cancellation.
