# Finite full-types to FS11 wiring proposal, inactive

Scope: source-only review. No entry point, service, compiler, package manager,
filter probe, product test or publication was run while preparing this package.
Adapter8 remains closed. Candidate patch and the eleven FS tests are unchanged.

## Chain and stages

The workflow pins bootstrap bytes and this package's SHA256 manifest externally.
Its standard-library driver hashes the same bytes it compiles. Bootstrap checks
every package file, both component manifests, OCI platform manifest and public
source archive before importing a helper. Root stages copy only this sealed public
closure and pinned data, never the checkout, .git, credentials or runner home.
The producer subtree is byte-identical to approved producer v3.

1. Unprivileged transport downloads eight pinned official OCI blobs and the
   original pinned public artifact ZIP. Credentials are used only on their API
   hosts. Redirected blob requests carry no API Authorization header.
2. Root assembly reconstructs the OCI/source data using unchanged producer v3.
   Before any stage, a once-only durable state records attempted execution.
3. A fresh authenticated GitHub run/job snapshot is collected unprivileged only
   after expensive assembly. The root producer checks custody, snapshot hash,
   age, hosted runner, same run/job/event and admission before npm permission.
4. Successful terminal proof, zero OOM delta, exact full-types receipt, removed
   unit/network and readonly work tmpfs permit the source handoff. Offline
   assembly verifies producer root, closure, OCI effective binding, overlays,
   source/toolchain pins and final post-cleanup network ledger hash.
5. Offline data assembly selects exactly 594 pinned native files, plus FOUR
   original source files, unchanged gate and runtime metadata. No daemon,
   node_modules, SQLite or provider code is copied. Native ZIP transport differs
   from the former reconstructed tar only in acquisition. All 594 bytes and
   effective modes match the existing NATIVE-ROOTFS manifest. The included
   NATIVE-ZIP-SELECTION maps every original ZIP member to its target.
6. A SECOND fresh authenticated snapshot is collected after offline assembly.
   Same job/run/head and first-attempt hosted VM remain mandatory. The unchanged
   offline admission gate and real FS11 oracles then run in the reviewed profile.
7. Selected exports only. Per-file limits, total count and total size are fixed.
   No recursive upload of roots, source, contexts, launch state, env or inputs.

## Failure and teardown

A lost launcher/controller process, lost held cgroup identity, uncertain start,
stop, mount, cleanup or evidence means UNKNOWN and no retry on that VM. JSON
cannot restore acquired kernel handles. The workflow does not run recovery or
prefix cleanup. Offline mutations now record intent before syscall and acquired
unit identity before permission. Cleanup checks source and current invocation;
without acquired empty-cgroup proof it retains unit, mounts and evidence.

Job exit, cancellation, timeout, manager PID zero and a PASS test summary are NOT
proof of VM destruction. Retained public roots/tmpfs may require the actual
GitHub-hosted disposable VM teardown. The export always says VM teardown is
unproved from inside the job. A cancelled job may produce no artifact. A future
retry must use a genuinely new hosted job/VM, never a rerun accepted by these
first-attempt guards. There is no cleanup fallback that widens permissions.

## Review and remaining gates

Static AST parsing, local pinned-data comparison and manifest checks only were
performed. Runtime preconditions remain untested: artifact availability, image
blob availability, disk, systemd/cgroup ABI, nft/netns support, ip_forward already
1, conflict-free prefix, host forwarding policy, endpoint allowlist and native
loader compatibility. Any failure is environment/UNKNOWN, not product failure.
No sysctl or existing firewall rule is changed to make prerequisites pass.

The workflow is supplied separately with an INACTIVE filename. It must NOT be
installed or enabled without independent review and the parent's execution gate.
Its intended eventual target is .github/workflows/daemon-state-fs-once.yml and
payload is tests/daemon-state-fs-once/payload. The review wrapper is NOT a request
to publish either. The included source tar is clean public tracked data only.

Candidate FS11 proves two helpers only. A future successful full-types+FS11 run
would not prove daemon integration, captureState integration, full application,
all shutdown paths, Redis token safety, or remote cleanup.
