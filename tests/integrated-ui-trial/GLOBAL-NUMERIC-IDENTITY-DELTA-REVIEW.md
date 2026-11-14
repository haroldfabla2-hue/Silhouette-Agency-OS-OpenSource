# Global numeric ID namespace custody: source-only delta

No runtime, import, syscall probe, sudo, package install, product mutation, publication or workflow composition. Four Python files were AST-parsed as source text only. This is an explicit security-model change requiring independent review, not a diagnostic-only change.

## Changes

- Replace require_host_identity_namespace with retain_global_numeric_identity, returning an owned GlobalNumericIdentityGrant.
- Acquire only self user/mount namespace FDs, register before fstat, retain until custody-chain close. Open follows these two fixed procfs namespace magic links intentionally; no PID1 access.
- Current and retained namespace identity use (st_dev,st_ino), checked before and after maps/capability reads, again once before returning, and on every original chain recheck.
- Both UID/GID maps are bounded complete EOF reads, each exactly sole tokens 0 0 4294967295. The reviewed maximal-extent induction proves global numeric identity, NOT initial namespace membership. Nonidentity/multiple/partial maps remain denied.
- Nonroot/effective UID stable, zero CapEff/CapPrm/CapInh/CapAmb, bounded proc status, now duplicate-key denial. Genuine host procfs/trusted kernel remain assumptions, not proved by these reads.
- Both namespace FDs are attempted closed on construction failure and chain shutdown, even after directory FD close failure. First failure retained; any secondary cleanup failure marks cleanupFailed. No close retry of possibly released descriptors.
- Three new fixed operation labels: SELF_USERNS_OPEN, SELF_MOUNTNS_OPEN, NAMESPACE_FSTAT. Existing first/deepest-error schema unchanged. PID1_USERNS_STAT remains an unused historical enum only, never evidence a current comparison ran.
- Explicit model string GLOBAL_NUMERIC_IDENTITY_ROOT_SUPERVISOR_LOCAL_EXT4_XFS_NONIDMAPPED replaces the old string. Dynamic strict schema consumers must use this exact source; no dual acceptance of old/new affirmative models.

## Caller audit and retained invariants

Across actual26's 143 source members, effective_acl_custody.py is the only import consumer and has exactly two call sites: initial inspect and recheck. Previous tuple consumers were only index0 runner UID and full tuple equality. No initial-user-namespace consumer was found. Those are now grant.runner and grant.recheck.

qualify-host.py/identity-entry.py/namespace-entry.py/supervisor.py self-namespace/internal sandbox invariants are separate and untouched. The child-namespace-is-different property is not replaced by this proposal.

All ACL parsing/effective rights/owner constraints/per-FD statx/statmount/native ABI/local ext4-XFS/noIDMAP/retained ancestor metadata/private leaf FD rules remain byte-identical except grant acquisition/recheck/cleanup integration. No chmod/setfacl, no proc mount or access-policy change, no helper privilege, no unshare/setns, no new network. All original timing/caps/assertions/private exports remain mandatory in any future composition. Extra two held namespace FDs per chain, up to six across the original three chains; no extra task/process. Runtime resource/deadline fit is unverified, not assumed.

## Superseded historical statement

The historical ACL-CUSTODY-DELTA-REVIEW.md states same namespace as PID1. That described the actual23-26 model. Under THIS proposed model that specific condition is explicitly superseded by full global numeric UID/GID identity plus retained self user/mount namespace stability. The historical file is not rewritten or presented as a current model. A later full composition must include this supersession next to current model references; preserving old text without an explicit current supersession would be misleading.

## Review boundaries

This admits fully globally identity-mapped nested namespaces, which the previous PID1 comparison denied. It never asserts a namespace is initial. Missing procfs access, malformed status/maps, namespace drift, any syscall/ACL error, non-local/IDMAP mount or cleanup failure stays fail-closed. A transient namespace excursion out and back is not proved impossible by two snapshots; the prequalification trusted single-threaded supervisor and absence of candidate execution remain necessary. Holding FDs prevents identity reuse while held, but does not itself prohibit a privileged actor from changing the host. Trusted host root remains outside the adversary model.

Source proof and authoritative URLs are in the separately delivered namespace research. No initial namespace inode constant, owner UID heuristic or ambiguous NS_GET_PARENT EPERM fallback is used.

## Contents

Four proposed modules, four exact actual26 preimages, per-file unified diffs, manifest. No full operational-parent gate updates, workflow publication or runtime authority. Whole product remains FAIL/INCOMPLETE. No pure function tests were run for this delta, and AST parsing is not type/runtime coverage.
