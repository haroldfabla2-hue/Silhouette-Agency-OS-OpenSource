# Consolidated native first-failure source delta

Parent actual27 26c801546d6bf0d1c63b67ccbee136d5016778bf. Source-only, not integrated into a full workflow, imported as product, run against OS/native tools or published. Full product FAIL/INCOMPLETE. No new acquisition, sudo/provision, model/provider, private runtime access, resource or network expansion.

## What changes

Six implementation modules: one new native_fixed_boundary.py plus five exact actual27 preimage modules. The original finite exporter remains an explicit projection; raw host inventory is still private. New strict native receipt has eighteen exact keys: the old thirteen plus failureOperation, failureReason, cleanupFailed, cleanupForced, privateEvidenceFailed. No raw exception class/message/path/SONAME/readelf/version/object identifier or hash is exported. Native and product flags remain false even for clean metadata.

native_fixed_boundary provides83 finite source-owned operation labels, finite reason strings and first-boundary wrapper. Nested already-fixed exceptions are not rewrapped. Only exact source-owned reason types supplied by supervisor code can contribute a literal reason. OSError inputs map to finite categories; no numeric errno or string heuristic. Unknown becomes UNATTRIBUTED_INTERNAL/UNEXPECTED_EXCEPTION, still blocked. Original exception is private and never serialized. Fixed reason classes cannot be impersonated by a subclass or matching text alone.

Inventory source labels both fixed host-tool families independently. Every Popen/selector/nonblocking/register/read/select/unregister/wait/decode operation is inside original ownership try/finally. Every independent cleanup is attempted: selector close, group probe, residual kill, child wait, stdout close, stderr close. Cleanup never replaces an existing primary. A residual/uncertain live group sets forced cleanup and denies normal inventory. ProcessLookupError races on group probe/kill are explicit, not generic success or replacement root cause. No child is deliberately run in tests of this packet.

Existing contract/provenance/native guards remain: exact browser/archive/ELF/architecture contract now also checked, same32external requirements, local metadata paths only, same128providers/128edges/16384pending/64KiBreadelf/2MiBcache/64KiBstderr/5spertool/deadline bounds. Same nonzero exit, any stderr, invalid UTF8, architecture, provider ownership/path, changed metadata, missing/ambiguous provider or unsupported dynamic-path condition denies; no loosening to get green. No loader/ldd/CDLL/acquired code runs. Canonical resolve/stat/restat, provider parser/guard and cache/contract boundaries are labelled. Private result remains metadata-only, not resolver or symbol-binding/native-load proof.

Coordinator borrows supervisor directory/sink grants and never closes them. Owned private file FDs use direct writes, not fdopen transfer, and are always closed. Raw JSON serialized into bounded32MiB private bytes before file creation (the actual finite inventory is already bounded by128objects times64KiBmetadata plus rows; no output/resource cap increase). Same private600 exclusive nofollow creation, fsync file and directory. All private write/close/fsync operations labelled; no raw metadata exported. Failure evidence is separately written privately with only fixed fields. If failure evidence cannot be written, privateEvidenceFailed is set and the primary still reaches the fixed sink attempt. It never becomes the root cause unless there was no earlier failure.

Finite projection/schema/encode/bound/write/fsync/deadline/custody boundaries covered. Fixed sink keeps the original single complete write check: short write fails, no truncation/overwrite retry. Failed mandatory sink prints only a validated finite fallback with receiptWriteFailed:true, then throws; fallback never satisfies mandatory presence or rescues acceptance. If the deadline expires during sink fsync, the already-written metadata receipt is accompanied by a blocked fixed fallback and the qualifier fails. No rollback or rewrite of a partially written sink. Any source composition must retain current mandatory blocked/invalid export behavior.

qualify-host loads the fixed module chain under MODULE_SPEC/CREATE/EXEC labels, bounded complete nofollow contract read/close, strict duplicate/nonfinite JSON, FD arguments and deadline. Pre-coordinator bootstrap failure emits only a fixed fallback if safe sink machinery is not available. When a safe borrowed sink and writer exist it attempts the mandatory finite receipt. It does not retry a previously attempted or written sink. The legacy host JSON keeps only REGULAR_NATIVE_STATIC_INCOMPLETE for native failure; precise native receipt/fallback is separate, never raw exception content.

## Preserved export boundary

return-evidence.py is NOT modified. It dynamically loads native_receipt_schema and enforces exact fields, bounded read and blocked mandatory failure. No private inventory/failure filename is added to its allowlist. Credentialed runtime logs/pixels/private hashes stay denied. Capture of schema-valid blocked fixed receipts remains failure by design. Public summary counts on unavailable receipts are diagnostics, not evidence no private operations occurred. Actual27 cause remains unknown and is not retroactively assigned by this patch.

## Pure execution evidence

Ten groups PASS, explicit parser/schema/reason-mapping tests only. They AST-load ONLY the pure boundary/export/schema definitions from source text, then operate on explicit dictionaries, exception inputs, strings and finite constants. No OS/proc/syscall/subprocess/native/product/clock path or mocked success adapter is called. Covered clean metadata not native pass; finite errno INPUT mapping; all83 operation mappings; first exception retained; exact source reason types; cleanup/private flags; private marker omission; gap projection; strict field/type/count/unknown rejection. Synthetic OSError objects are reason-mapping inputs, not a claim a filesystem operation occurred. No filesystem failure, process cleanup, native inventory, resource fit or actual qualifier behavior tested.

An earlier passing pure run covered81 operations, before two contract open/close labels were added; the final pure run/result covers83. No failed pure attempts occurred. Full test source and final results included. All seven Python source files AST-parse. Python parsing is not compilation/runtime evidence for the original OS paths.

## Remaining source/runtime limitations and review focus

- Trusted supervisor/kernel/genuine procfs, protected source/contract FD grant and unchanged single-threaded prequalification assumptions remain necessary.
- This proposal preserves first error and bounded fixed diagnostics; it does not itself correct any native provider gap or prove host-tool behavior. Actual27's private cause remains unobserved.
- Existing host base qualifier checks outside the native extension keep their original output behavior and guard semantics. No broader redesign is hidden here.
- Outer hosted-orchestrator still reports QUALIFIER_COMMAND and conservative zero ancestor counts on child failure. The inner native fixed receipt is the load-bearing discriminator; no new interpretation of zero counts.
- Native schema strictness means old receipts are not accepted as new evidence. Historical packets remain historical, not regenerated.
- All30squalification/27sdecision/3scleanupreserve, process output caps,1020saggregate/20minworkflow/3GiB/1CPU/96tasks and product acceptance assertions must be retained in any future full composition. No runtime/publication authority is created by this packet.

## Reviewed follow-up fixes before composition

Both bootstrap and coordinator fallback stdout writes catch diagnostic output failure, mark primary cleanupFailed privately and let the original operation propagate. No fallback-print exception replaces it. Post-sink deadline failure calls fallback with receiptWriteFailed:false, because the mandatory receipt was successfully written before that final deadline check; the finite fallback still reports blocked budget and qualifier fails. All other sink failures use true. No simulated stdout/clock tests were run; these changes have AST/source review only.
