# Transactional exact-contract ledger, explicit opt-in

`ProcedureApprovalLedger` adds a separate SQLite WAL ledger. Existing JSON
MemoryEvidence and default runtime behavior remain unchanged. No daemon or
execution endpoint is installed. This is not human authentication: the caller
must authenticate the owner before passing their ownerId and exact reviewed
contract hash into decide. An LLM cannot establish owner approval.

Contracts use the existing closed file-contract decoder and canonical JSON
encoding before hash. Identity is procedure ID + immutable version + owner ID.
Changed content at the same version is refused, owner/hash mismatch refused.
Approval and revocation use BEGIN IMMEDIATE transactions, an epoch and an audit
record with reason. Revocation invalidates all RESERVED leases in the same
transaction. Independent connections/processes serialize through SQLite rather
than the earlier per-instance JS promise queue. Only one outstanding reserved
run per exact owner/version. Durable run IDs, exact hash/epoch, one-time receipt
completion, owner-scoped lookup. Receipts persist on disk and across reopen.

A late successful worker receipt after revocation is stored as REVOKED, never
SUCCEEDED. Forged owner/version/hash/epoch or replayed completion is rejected.
Receipt is an audit record, not a signed attestation. This ledger does not claim
kernel-atomic cancellation of a running process, rollback of external effects,
cross-DB evidence transactions or authenticated UI integration. Its API is not
wired to the worker and registry approval is NOT execution authority. A worker
adapter must check current lease before start and abort on revoke; ledger finish
still denies a success after revoke. Crash leaves an explicit RESERVED run; no
automatic stale-lease stealing, retry or success. Operator recovery policy remains
pending, as do signed receipts and live worker revocation/cancellation wiring.

SQLite file directory must be trusted-local/private and owner backup/sync policy
reviewed. No network filesystem lock guarantee. Existing evidence file is not
silently migrated. No proof of physical human presence, no default execution.

Real regression tests use disk SQLite, two independent live connections, reopen,
immutable edits, wrong owner/hash, duplicate reservation, forged lease/version,
revocation before late receipt, one-time finish and persisted receipt. No mocks
or fabricated successes. The test receipt is explicit ledger test data, not a
claim that an OS procedure actually ran. Actual file worker tests remain separate.

cgroup v2 is present but not writable in the current environment; no cgroup quota
verification or deployment is claimed. Existing bubblewrap namespaces/prlimit
limits continue unchanged. seccomp/cgroup deployment and signed receipts remain
separate work, not hidden behind this ledger.
