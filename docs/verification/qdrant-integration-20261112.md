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
