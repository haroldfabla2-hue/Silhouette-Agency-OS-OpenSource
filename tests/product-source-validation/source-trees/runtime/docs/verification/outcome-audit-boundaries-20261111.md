# Outcome and memory receipt boundaries

Candidate follow-up to `cca79ecd069b7f8bf57b163bcbef8ff333b1aea2`. No merge, deployment, live provider, external message, real-data inspection or data migration in this work.

## Executed reproductions and fixes

- Actual `securityManager` denial of `read_file` produced a failed capability envelope with null data, but the chat integration returned success. The actual before-fix assertion failed. The corrected chat bridge respects the capability envelope before inspecting its payload.
- A real read of an authored local file succeeded, then an actual corrupt canonical LanceDB row made experience readback fail. Previously this went into the tool-failure catch and its subsequent failure-memory write threw out of the chat API. The corrected bridge preserves the real tool result and returns a separate, visible learning-memory warning. It does not repeat the tool or invent a failure of the underlying operation.
- Failure-memory rejection is contained without discarding the original tool error. Denial plus actual corrupt storage exercises that path. A missing-file failure remains a failure, not a substituted successful response.
- A real gaps-only legacy curiosity snapshot was rejected by the strict restore barrier. The historical reader accepted this shape. A compatible reader now restores the original questions without rewriting the file. Before the first mutation upgrades its shape, it retains and reads back an exact hash-named legacy copy. Corrupt originals remain byte-identical, with an observable blocked-storage status and refused mutations. No blank-store reset is offered as recovery.

Six automated subprocess tests use actual services, filesystem reads, policy denial and corrupt storage. They do not emulate a provider response. Their authored inputs are not a successful cognition/research demonstration. Tests and logs retain the failing baselines separately from corrected results.

## Additional guarded source changes, acceptance still open

The orchestrator's final reply now requires a returned channel message ID before it logs delivery or commits the WAL. If no ID is returned, delivery stays unverified without sending a second error reply. A post-delivery WAL failure is caught separately: the reply is not resent and the uncommitted record remains available for honest interruption recovery. This is a source correction informed by the real WAL failure checks, NOT an executed whole-handler/channel delivery acceptance test. External channel acceptance and all alternate early-return reply paths remain to be tested. A channel message ID is an acceptance receipt, not proof the human read the reply.

`scripts/check-continuity-stores.ts` is a read-only rollout preflight. It reads existing WAL/curiosity files without importing application services or rewriting data, and reports indices/reasons rather than payloads or agent IDs. It flags record-shape problems, lexically escaping legacy agent IDs, observed agent-directory symlinks, malformed curiosity fields, and incompatibility with an older WAL handler once INTERRUPTED records exist. It does not silently migrate such data, certify all filesystem ownership/race conditions, or approve rollout. It was exercised on disposable fixture stores only, not production.

## Pending gates

- Grouped suite, lint and build results are reported with the final candidate. Global TypeScript success on `cca79ec` applies only to that earlier tree; this candidate needs its own final gate.
- The two existing full-suite skips are unchanged: real ElevenLabs synthesis has no credential in this isolated environment; the cold-narrator unit integration harness has an unisolated boot dependency. Neither skip is acceptance.
- Full post-send/channel/WAL acceptance, queued-curiosity shutdown drainage, production-store read-only compatibility preflight and a reviewed state-preserving rollback plan remain open. Do not run an older handler on new INTERRUPTED WAL records, which the older source can prune as terminal.
- Meaningful reflection, positive research, measured improvement application, full task resume and goal-to-delivery product acceptance are not claimed here.

## Grouped candidate evidence

Final isolated suite: 1474 passed, zero failed, two skipped, 228 files, 104.07 seconds. Lint: zero errors, 419 existing warnings. Frontend build: 20.69 seconds. Server build: 4.13 seconds. The earlier bounded 112-second suite attempt was incomplete and remains recorded as exit 124, not a pass. The final complete run used five workers and a 118-second bound. Eight read-only preflight cases checked exact source-byte preservation and absence of payloads; absent-directory handling refused without creating it. No global typecheck result is asserted for this new tree yet.
