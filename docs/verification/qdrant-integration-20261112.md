# Canonical memory and optional Qdrant projection

Branch checkpoint, NOT deployment acceptance. Production and main are unchanged.

## Implemented in this checkpoint

- LanceDB remains canonical. Code RAG, RAPTOR storage/recall, Dreamer retrieval,
  introspection retrieval and Brand Twin reads use one application contract.
- Every new vector consumer supplies the actual embedding identity, not just its
  dimension. Unknown historical identities are not guessed or rewritten.
- Code chunks are immutable versions. A canonical file marker activates a version
  only after all chunks succeed. Older chunks remain in history, not active RAG.
- Queries preserve cosine scores and hydrate canonical payloads. Identity, payload
  filters and score bands apply before top-k. Changed content cannot borrow a stale
  vector. The new filtered/band query uses a bounded paged exact scan, NOT a claim
  of million-vector latency or ANN performance parity.
- SQLite projection intent is committed before a vector-bearing canonical write.
  Replay checks the current canonical checksum before publishing. It never repeats
  the originating operation. Pending, completed, superseded and unsupported entries
  are retained. Unsupported 384-dimensional points remain searchable in LanceDB.
- Qdrant startup/health observes an existing 768/Cosine collection without creating
  one. A failed connection can recover on the same instance. Errors are not empty
  successful searches or acknowledged writes. Arbitrary app IDs map deterministically
  to Qdrant IDs and round-trip as original IDs.
- Qdrant searches use exact mode because the isolated ANN experiment failed a global
  query even after an owner index and ef=128. That ANN failure is not waived.
- Brand payload updates are canonical and require no new embedding or inference.
  Existing Qdrant-only Brand Twins have read-only compatibility access. This is NOT
  a verified bulk migration of every legacy Qdrant payload.

## Executed evidence and its limits

1. First-cut real Qdrant consumer checks passed before subsequent integration changes.
   They are historical evidence, not acceptance of this final diff.
2. Real LanceDB plus real Qdrant outage/reopen/replay: 15 checks passed at 08:39.
   Later code-version markers, stale-vector checks, replay timer and validation edits
   were not rerun against a Qdrant engine. Final replay acceptance remains pending.
3. Canonical consumer run: 19 checks passed at 08:46 with real LanceDB,
   explicitly disabled Qdrant and public precomputed vectors. Includes multi-chunk
   indexing, shrink, preserved history, reopen, an actual invalid-vector mid-write
   failure, inactive partial version and successful retry, payload-only feedback replay intent, RAPTOR leaf recall,
   Dreamer duplicate query, identity and owner isolation, band ranking, stale-vector
   exclusion, Brand reads/feedback and 384-dimensional retrieval. This does not
   exercise the entire Dreamer, introspection or campaign execution path.
4. Five focused test files: 41 tests passed at 08:44. Existing unit doubles are
   labeled as doubles and are not counted as real consumer acceptance. Campaign's
   mock target changed to the new contract; its assertions and generation gate
   remain intact.
5. Changed-source transpilation: no syntax diagnostics. ESLint: no errors, seven
   unused-variable warnings. Neither is a full TypeScript check.
6. Full TypeScript check failed with a local heap OOM around the existing 1 GB limit.
   No full-suite/build/typecheck acceptance is claimed.

## Retained failed attempts

- Importing the full Dreamer module unexpectedly bootstrapped app services and
  attempted local embedding initialization despite providers being off. It downloaded
  about 713 KB of config/tokenizer files. No ONNX/model weights, model-ready output
  or completed inference was observed. The process and test engine were stopped.
  This run is NOT clean acceptance of the no-model boundary.
- A separate engine with accumulated disposable collections failed with real Qdrant
  HTTP 500 allocation errors under its 1 GB virtual-address limit. No limit increase
  was used. The failure logs remain. A fresh separate test store then passed.
- A copied test config still pointed at the older store on one attempted launch.
  Connection failed. The path was corrected before the successful separate-store run.
- A harness disk monitor raced with Qdrant's atomic rename and raised FileNotFound.
  Both child processes were stopped by finally. The monitor now tolerates disappearing
  transient files and still enforces cumulative disk size.

The new test guard refuses model/bootstrap modules before execution and refuses
fetch destinations other than the explicit loopback test URL. A negative test
confirmed refusal of localEmbeddingService before it executed. Successful guarded
runs logged only guard installation, no blocked import or off-test fetch.

## Acceptance blockers, not waived

- Full typecheck/build/full suite.
- Final-version Qdrant replay, crash-boundary and recovery acceptance.
  Static review found a prepare-before-commit race: prepared intents now remain
  distinct until canonical read-back; a concurrent old source cannot supersede
  an in-flight write. Recovery verifies prepared intents against canonical data. Opening a new
  Lance instance and replaying is not a complete process-crash fault matrix.
- Entire production consumer flows: multi-level RAPTOR generation/parent links,
  Dreamer cycle/graph, introspection/chat, Brand context/campaign preparation, and
  meaningful applied learning. No inference or spending was authorized to test these.
- Legacy unverified vectors remain unverified. They are not assigned a model based
  on dimension or table name. A safe, reviewed recovery/re-embedding plan is needed.
- Optional projection failures retain durable intent, but disk-full/readback failures
  still need injected process-level acceptance. Unsupported vectors are observable,
  not falsely marked projected.
- Payload-only projection now reuses a validated same-content/same-identity vector
  without inference. Its final real-Qdrant replay acceptance remains pending.
- Semantic legacy digest extraction was a no-op; it now fails explicitly instead of
  claiming to have extracted zero useful insights. Actual extraction remains pending.
- Unknown legacy code chunks without activation markers are preserved but excluded
  from active new-contract Code RAG until reindex. No automatic inference reindex ran.

The finite Qdrant engine experiment stopped at 08:39, before the 30-minute ceiling.
Accumulated evidence/test stores are about 1.80 GB, below 2 GB. No further engine
runs are claimed or scheduled by this checkpoint. No production installation,
configuration, service startup, merge, deployment or provider invocation occurred.


## Independent review follow-up (after 20d446d)

Review found a real missing recovery path: canonical store could acknowledge while
Lance vector projection failed, but replay repaired only Qdrant. The fix makes
replay repair Lance first even when Qdrant is disabled. Unified ingestion requires
a real local projection receipt before activating Code RAG or completing a leaf
write. Canonical data and prepared intent remain when indexing is pending.

A real filesystem obstruction (regular file where the Lance projection directory
must be) caused Not-a-directory. Indexing rejected, no activation marker appeared,
and canonical content survived. After removing only the public test obstruction,
reopening and replaying with Qdrant disabled created the projection row BEFORE any
index retry; retry then activated the file and its query recovered. No method was
mocked to succeed or fail.

Canonical consumer run now has 21 checks including empty-file deactivation and a
slow old embedding arriving before a newer file event. Same-file writes serialize
across service instances in one process. This is NOT a cross-process CAS guarantee.
Unchanged-file hash caching was removed because per-instance caches could outlive a
newer marker written by another instance. This correctness change has a reindex
cost; performance acceptance remains pending. Projection replay is explicit at
loader/timer boundaries, not launched concurrently from each canonical receipt.

These fixes require a new source pin and independent review. They do not inherit
final Qdrant acceptance from the earlier 15-check engine run.


## Additional review follow-up

- Prepared-intent selection now uses a persisted round-robin cursor. A real test
  retained 101 old prepared intents, reopened the journal cursor, and recovered a
  valid prepared 384-dimensional vector behind them in batches of 50, with Qdrant
  disabled. Status counts no longer rotate the cursor. This is not a process-kill
  acceptance matrix.
- Continuum's actual semantic query now delegates to canonicalContextSearch, which
  uses fresh canonical/identity/owner-checked points instead of the old Lance.search
  hydration and raw Qdrant payload union. Code and hypothesis filters apply before
  top-k. The real extracted query component is tested; importing full Continuum /
  Dreamer / introspection without unrelated bootstrap remains an acceptance gap.
- Paged point queries use independent pinned table handles for canonical payloads,
  activation markers and projection rows. No shared mutable writer handle is checked
  out. Concurrent cross-process activation still needs final runtime acceptance.
- Code DELETE uses a retained deletion marker. Empty contents deactivate older code;
  same-file events are serialized in this process, across service instances.
- Semantic recall filters its supported insight types before ranking. A mixed corpus
  test excludes code/brands and checks entities/source/type. Cosine similarity is
  reported separately from stored confidence. Multilevel parent-link completeness
  remains unverified and unresolved; it is not proved by a leaf recall test.

The test loader/fetch guard is PARTIAL DEFENSE ONLY. It is NOT network/process
confinement: direct http/https/net, child_process, and fetch redirects require an OS
sandbox boundary. No-model static/import inspection plus this guard is useful
additional evidence, but is not a substitute for final reviewed namespace/seccomp
isolation or a full-consumer no-startup check.


## Wiring and replay-order follow-up

- Production dbLoader now starts local projection recovery regardless of Qdrant's
  disabled state. The startup entry performs an immediate finite batch, then an
  unref timer. The real filesystem-fault test invokes that exact startup entry and
  checks the loader source wiring. Full app boot remains a separate unpassed gate.
- Owner-less public records normalize to system for filtering, consistent with
  canonical column normalization. Scope tags filter before semantic ranking.
- Context lexical lookup now scans all pinned pages with bounded winners, canonical
  hydration and owner/tag/type exclusions before top-k. A mixed corpus with 65 code
  and marker distractors still returns the valid scoped/tagged memory at limit one.
  This favors completeness, not a demonstrated large-scale latency improvement.
- Store, replay and consumer projection receipts serialize on a shared per-database
  queue across service instances in this process. A stale consumer receipt checks
  canonical checksum before touching projection. Cross-process CAS remains open.
- Persisted equal payload/vector rows plus READY state are an idempotent local
  receipt. Four retries with mirror disabled, including reopen, leave canonical
  and projection table versions and row counts unchanged.
- The deterministic replay ordering test pauses the actual replayer at a test-only
  scheduling checkpoint after source verification. It does not replace or fake I/O.
  A newer write from another real Lance service instance waits, then its content
  and vector stay current; an older receipt is rejected.

These are focused real storage/component tests, not full app/OS-isolation acceptance.


The strengthened stale-receipt ordering test initially FAILED with "missing expected
rejection": an older Lance service instance's getNodeById used a stale table handle
and saw its own old canonical source. That failed attempt is retained. Canonical
point reads now open an independent latest handle before verifying checksums; the
final strengthened test must pass before this fix is treated as evidence.

After latest independent point-read fix, all four real component tests passed, including stale receipt rejection. Focused Vitest 41 tests passed before that final point-read change and are not represented as a full suite.

## Final public-entry audit and dense-vector coverage

Dense 768-dimensional sin/cos fractions deliberately not exactly representable in
Float32 passed the physical-version/reopen test without a dtype repair. Observed
Arrow schema was FixedSizeList[768]<Float32>. This extends, not replaces, the unit
vector test. Direct production projectEmbedding callers were only the three
internal store/replay/receipt calls; external callers found were tests. Public
projectEmbedding now uses the source-verified queue; internal callers use a private
method to avoid recursive queue deadlock. Public deleteNode has production callers
in continuumMemory, database/sqliteAdapter and cognitiveScheduler; deletion now
uses the same queue. A real deterministic delete-vs-replay barrier verifies no
resurrection from an older intent. Stale direct projection is also rejected.

The vector-scan fixture now projects the actual stored canonical node instead of
regenerating its Date.now fields, with its assertions unchanged. Focused five-file
41-test suite passed after this final entry-point change. This is not the full suite.
Cross-process CAS, other maintenance writers, full app lifecycle, legacy identity,
full cognitive flows, ANN failure and large-scale latency/disk remain open.

## Delivery event reactivation, exact A -> B -> A

A new real-ledger test first failed against 9a32bc9: after terminal event A,
terminal B and exact restored A, pending count was zero. The terminal content-key
was being reused. Each prepare now allocates a new UUID delivery event and uses
INSERT, not INSERT OR IGNORE. Source checksum remains validation data, not event
identity. No terminal/in-flight row is reset or deleted. Existing historical keys
remain readable; no schema migration or memory rewrite is required.

The test uses actual SQLite terminal-state fixtures explicitly, not a successful
mirror double: terminal ACKs are setup for the historical scenario. It verifies
new pending event identity after complete and superseded histories, exact original
payload/timestamp/vector preserved, reopen, actual Lance replay with mirror disabled,
canonical/local A and honestly still-pending mirror. This proves the ledger/local
reactivation regression, NOT final mirror payload acceptance. Qdrant remains closed.

## Vector generation bound to canonical commit

Same node JSON/identity with V1 then V2 previously allowed a cursor/reopen to replay
V2 first and V1 last, leaving the older local vector. The new regression reproduced
that failure. Canonical memory_records_v2 now commits projection_event_key beside
the unchanged node JSON in the same merge. It names the immutable intent containing
the vector and identity. Replay supersedes a different keyed event before delivery;
consumer/direct receipts verify identity and Float32-normalized vector against the
active event. This defines stored vector equivalence as Float32 equality, not
arbitrary double precision. Existing tables get an additive empty-string column at
the next serialized write, not at read-only init. Existing empty/unkeyed historical
rows still use source-checksum recovery; historical generation is not fabricated.

Real tests cover shifted cursor, reopen, V2 then stale V1, exact persisted Float32
V2, stale receipt rejection, and additive upgrade of an old-schema table preserving
the node. Mirror disabled: this is not final Qdrant ACK/restart evidence. UUID cost
was measured on a separate real SQLite ledger: ten identical dense-vector prepare
attempts grew the closed database from 16,384 to 196,608 bytes (+180,224 bytes).
This is a fixture measurement, not a production capacity bound; no history was
pruned. Repeated canonical writes are distinct events, not globally exactly-once.
