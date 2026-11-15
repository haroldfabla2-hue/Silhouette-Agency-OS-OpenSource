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
Receipts are audit records. With the opt-in `signer` option (see Signed receipts below) each finished run also gets an Ed25519-signed, hash-chained envelope. This ledger does not claim
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

## Signed receipts (opt-in)

`new ProcedureApprovalLedger(path, { signer })` with `createEd25519Signer(privateKeyPem)`.
The caller owns the key; nothing is generated, stored or defaulted by the ledger.
On `finish`, in the same IMMEDIATE transaction as the run state, a row is added to
`procedure_receipts`: canonical JSON payload (run, procedure, version, owner,
contract hash, epoch, final state, stored receipt, completion time, previous entry
hash), its SHA-256, and an Ed25519 signature. `keyId` is the hash of the public key.
- `verifyRun(runId, owner, publicKeyPem)`: signature valid AND payload equals the live run row.
- `verifyChain(trustedKeys)`: every entry signed by a trusted key and linked from genesis.
- A late success after revoke is signed as REVOKED.

Limits, stated plainly: the signing key lives in the process that runs the ledger,
so this detects edits to the database file by anyone without the key; it does not
defend against a compromised process holding the key. Deleting the newest entries
(truncating the tail) is not detectable from the chain alone; the external
anchor support in `docs/RECEIPT_ANCHORS.md` exists for exactly that. No key rotation or
revocation list yet. Not a hardware attestation.

## Owner identity: WebAuthn assertion gate (opt-in)

`new ProcedureApprovalLedger(path, { ownerIdentity: { rpId, origins, challengeTtlMs? } })`.
Once set, plain `decide()` throws; approve/revoke must go through
`issueDecisionChallenge(...)` then `decideWithAssertion(...)`.
- Challenge: 32 random bytes, single use, short TTL, bound to owner, procedure, version,
  contract hash, decision, reason and the contract epoch at issue time. It is consumed
  atomically before verification, so a failed attempt burns it. If the contract changed
  since issue, the decision is refused.
- Assertion checks: `webauthn.get` type, challenge, allowed origin (no cross-origin),
  rpIdHash, user presence AND user verification flags, ES256 signature over
  authData || SHA-256(clientDataJSON), and a strictly increasing signature counter
  when the authenticator uses one (clone detection). Credentials are per owner.
- Enrollment (`issueEnrollmentChallenge`, `enrollCredential`): attestation "none", ES256
  only, UP+UV+AT flags required.

Limits, stated plainly:
- Tests use a SOFTWARE authenticator (real P-256 keys and ECDSA, exact WebAuthn byte
  formats). It validates the server logic. No hardware authenticator or browser
  ceremony was exercised here.
- Attestation "none" proves possession of a fresh key, not the device make or model.
- Who may enroll an owner's FIRST credential is the caller's authenticated decision.
  No recovery flow, no credential removal API, no multi-reviewer quorum.
- Counter 0 on both sides (synced passkeys) cannot detect cloning.
- The decision UI must display the exact contract, decision and reason that the challenge is bound to.

## Signer key rotation

`ledger.rotateSigner(newSigner, newPublicKeyPem)` retires the current signing key. The OLD key signs a rotation record that names the new key and the hash of the last receipt, so the rotation is fixed at one position in the chain. From then on only the new key can sign: a ledger opened with a retired signer refuses `finish` ("Signer key was retired by a rotation"). A key that was ever used cannot be reused.

`ledger.verifyChainFromRoot(rootPublicKeyPem)` audits the whole chain from the one public key that started it. It follows each signed rotation and requires every receipt to use the key active at its position. A removed, edited or forged rotation, or a receipt signed by a retired key after its rotation, fails the audit. The existing `verifyChain(trustedKeys)` still works and is unchanged.

Limits: the ledger does not store private keys, so where the new key lives and who may call `rotateSigner` is the caller's decision. Rotation does not help if the old private key was stolen before rotating: an attacker holding it could sign a rotation to their own key. The last entry hash can be anchored outside this database; see `docs/RECEIPT_ANCHORS.md` (`chainHead`, `buildAnchor`, `verifyAnchor`).
