# Product closure batch: durable failure selection and honest health

11 November 2026. Candidate branch only. No merge, rollout, production-data test, provider activation or billing change.

## Scope

This batch continues the unmerged outcome/continuity repair `8bf3491db55ccba9884f5ce2f42f6febea82fb81`. The PR212 merge has the same tree as `da6ee511cd04b6eda6004de860d8efc506b32c56`; the final candidate is based on that main merge, with the earlier continuity repair retained. It does not replace that repair or the original product requirements.

## Reproduced defects and corrections

- A real experience write persisted its original identity and content. A new process could retrieve it, but the actual learning selector returned no failures because it read only process-local RAM. The new selector uses a bounded, exact-tag canonical observation read. It does not depend on semantic ranking, embeddings or a provider. The RAM-only API remains RAM-only; no recovered history is invented there.
- The actual health router reported Qdrant `up` with no connected Qdrant. The corrected path distinguishes a config-disabled module from an unavailable dependency. An existing connection must pass a read-only collections probe before the endpoint claims `up`. A separate single-connection probe client uses the SDK's aborting 1,000 ms timeout, not a timeout race that leaves a long request running.
- The daemon health check previously tested object existence. It now reports actual scheduler running state and enabled/registered task counts. It explicitly does not certify cognitive output.
- A failed SQLite health probe now degrades the aggregate instead of allowing a healthy aggregate after a persistence failure.

## Executed positive boundaries

Actual services were run in disposable files/databases with an isolated network and no provider credentials. Fixture content is authored input, not emulated provider output.

- Fresh-process learning selection recovers the original persisted failure, timestamp, context, outcome and agent. The baseline assertion failed; the corrected assertion passed.
- A canonical window of 105 authored failures returns the most recent 100; unrelated records do not consume the window. A canonical update removing the failure tag takes effect. Invalid limits are rejected. A malformed experience causes a visible error, not a successful empty window.
- Native LanceDB tests verify legacy/V2 ID precedence before tag selection, tag removal, excluded IDs, bounded ordering, no FTS/initialization in the observation reader, and an observable corrupt-record failure.
- A request to the actual health router with absent dependencies reports HTTP 503 and does not claim Qdrant or a stopped scheduler is healthy. It does not create a collection. The baseline route assertion failed; the corrected assertion passed.

The full configured suite includes older doubles/static checks; its count is not a product acceptance result. Two existing skips remain: real ElevenLabs speech synthesis has no provider credential in this environment, and the cold-narrator integration test has an explicitly unisolated boot dependency in its unit harness. Neither is a pass. This batch's real-process probes are separate evidence.

A first complete suite run failed 25 tests because browser binaries were hidden by the test environment and nested user namespaces lacked required capabilities. The original log is retained. Only the disposable environment was corrected: read-only browser binaries and nested namespace capabilities. No assertion, skip or product behavior was weakened for those failures.

## Gates and limits

- Final suite, lint and build results are reported with the candidate commit, not inferred from file existence.
- Global TypeScript acceptance is pending. The available local memory is about 2 GB; a previous global check exhausted a 1,400 MB heap. The earlier successful global check required a separate 3 GB isolated environment with a 2,560 MB heap. This batch does not reuse that old result as proof for its new tree and does not run the check on the live service.
- Observation scans still read canonical tables. Result size is bounded, but the scan cost is not an indexed receipt/history lookup. Production-scale performance remains unproven. Do not drop receipt checks to make the code look faster.
- Successful Qdrant connectivity, post-disconnect recovery and active scheduler execution are not established by the negative health probe.
- The remaining product gates are unchanged: outstanding-write drainage, complete task/memory recovery, permission/tenant isolation, real provider-backed observation/reflection/research, independently verified improvement application, and a full goal-to-delivery acceptance run. This batch does not implement applied learning or prove consciousness.

## Deployment and rollback

No schema migration, dependency, credential, provider, billing or autonomy-policy change. This branch is not approval to deploy. Preserve all canonical records and the V2 experience records from the previous repair; rollback must not overwrite durable stores with an old source archive. Older source cannot correctly interpret V2 experience content. Review, global typecheck and a separate state-preserving deployment approval remain required.
