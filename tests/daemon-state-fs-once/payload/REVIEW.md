# V9 consolidated inactive diagnostic package, HOLD

This is the v8 source overlay plus two local corrections requested by review.
Manifests, inactive workflow and exact local activation/retirement proposal
are consolidated for independent review. No publication, import, tests, probes
or other run. Result remains functionally pending.
V8's earlier review document is background, not a claim these paths were fixed.

## Offline admission evidence before rejecting it

Each successful manager state read is copied to admissionManager and persisted
before the ActiveState rejection guard. The existing timeout guard still runs
before state(), and that state() still receives the same admission deadline.

After the bounded1024-byte ready read, the original bytes are saved as reversible
hex with original length and SHA before JSON parsing. Parsed ready and the
manager record are persisted before check_deadline and ADMISSION_READY. Thus a
valid bounded JSON value with an invalid stage/pid/nonce is retained even though
the guard rejects it. Malformed JSON can be inspected from the saved raw bytes.
Hex preserves non-UTF8 bytes too, without asking a decoder to succeed first.

No guard, deadline, ready limit, anchor acquisition, permit, profile or test
condition was relaxed. The extra persistence consumes existing time and the
unchanged check_deadline must still pass. Failure to read within the bound, or
to persist, remains a failure, not a fabricated admission record.

## Sanitized recovered error evidence reaches the existing artifact

V8 placed failurePersistenceEvidence in durable launcher state, but did not
export that object. V9 adds a fixed-schema classification projection to the
existing summary.json, never the full launcher state. It includes:
- Availability from the state actually read by export, primary classified error,
  and classified persistence/launcher-persistence fields if present.
- At most16 secondary records, each with a closed phase plus class/code and
  bounded parser numbers. It deliberately does not copy arbitrary payload keys,
  stack traces, paths, raw messages or secondary nested chains.
- A primary cause/context chain of at most4, using only closed class/code and
  relation labels. Unknown fields become fixed unknown labels.
- Explicit flags that exporting this projection does NOT prove the final
  producer/offline receipt was recovered, and that failure of the launcher
  state write itself cannot be recovered by this path.

The projection plus receipt-read errors is capped at8192 encoded bytes. That
uses the existing diagnostic size scale, not an increase to artifact limits.
The summary itself is now included in the existing12MiB total-byte check. The
existing per-file,32-entry and other source bounds remain unchanged. Hitting a
bound is an export failure/UNKNOWN, never silent truncation called complete.
No new file, destination, audience or retention period is introduced.

A missing/unreadable final receipt previously could abort export before the
summary was written. The receipt load now records a closed phase/class/code
failure and skips that phase's selected files because their upstream partial
lineage cannot be verified. Export can still write the sanitized launcher
projection and other independently verified evidence. It marks evidenceUnknown
and forces UNKNOWN_TEARDOWN_REQUIRED. It does not guess that selected files
are complete from their existence. A stale receipt is not called current final
receipt recovery either: the explicit recovered-error projection remains
separate from ordinary selected-byte metadata.

## Hard persistence limit, not success by exception attachment

When producer/offline final persistence fails but the launcher successfully
persists the classified exception evidence, the later export can report that
limited durable projection. This is the only recovery path claimed here.

If writing the launcher state ALSO fails, an exception attribute exists only
in that process. It is not durable and the next export cannot recover it. The
artifact can at most reflect the last durable state/receipt and its explicit
uncertainty. No successful recovery, complete secondary evidence, cleanup,
teardown or functional result may be claimed from that condition. Likewise an
export or artifact-upload failure leaves evidence unavailable, not recovered.
The implementation adds no retry and does not increase limits to hide it.

## Preserved scope and verification

Only launch.INACTIVE.py and offline/isolated-controller.INACTIVE.py differ from
the delivered v8 overlay. The package includes all six v8 overlay files for
unambiguous source review, v8-v9 delta, cumulative v7-v9 delta, source hashes and
static-check metadata. Other changes remain exactly the v8 proposal, not newly
accepted by this document. The consolidated pins bind this exact source overlay; they do not authorize
activation. Independent review must corroborate the proposed trees first.

Static AST parsing and source inspection only. No synthetic tests, helper
execution or runtime success claim. No historical v7 link rows or initial guard
were reconstructed. V7 remains terminal/retired; fulltypes and FS11 pending.
Any eventual use still requires separate review and approval, one attempt on a
fresh dedicated disposable VM without privileged competing writers, never a
shared host or Tamara. UNKNOWN retains until actual VM teardown. No retry,
permission/network/sysctl widening, merge, deploy or spend.

## Consolidation boundary

The full package includes exactly the reviewed v9 source overlay. Producer and
offline roots are both newly computed, not inherited from v7. The complete root
manifest retains its exact membership, including the unchanged source companion
provided separately. Offline controller diagnostics changed; offline observer,
test/gate/source pins and oracle contents did not. No historical v7 veth rows or
initial guard were recovered. This is improved evidence preservation, not a
demonstrated fix of that missing root cause. Fulltypes and FS11 remain pending.

Any later effect still requires explicit review and authorization against the
latest head and original human scope, one attempt on a fresh dedicated
disposable GitHub-hosted VM without competing privileged writers. No shared
host, Tamara, automatic retry, reuse, merge, deploy, cost, sysctl or permission
widening. UNKNOWN retains for actual teardown, never equated to job completion.
