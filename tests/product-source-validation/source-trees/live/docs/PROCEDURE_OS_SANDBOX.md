# Opt-in Linux isolated file-contract test worker

Builds on draft #21. Existing declarative file sandbox remains unchanged. The
new `testOsFileProcedure` is an explicit test API, not daemon integration or an
execution endpoint. Registry approval is not interpreted as execution authority.
There is deliberately no arbitrary/generated code or natural-language runner.

Linux deployment needs `/usr/bin/bwrap`, `/usr/bin/prlimit`, working unprivileged
user namespaces, runtime Node binary and `/lib`, `/lib64` shared libraries.
Missing dependencies or namespaces fail closed with no unsafe fallback. CI on
Linux must install bubblewrap and permit namespaces to run these real tests.

The trusted, closed interpreter is deployment-owned CJS. It repeats schema,
strict keys/path/size checks, writes new files and verifies actual SHA-256 bytes.
Worker gets a fresh tmpfs work directory and no host home/tmp/config mounts.
All namespaces are unshared, capabilities dropped, environment cleared, no
external network. Only runtime binary and library directories are read-only
mounted, plus private proc/dev. Resource gates: 64MiB JS heap, 2GiB virtual
address space, 3 CPU seconds, 5 seconds wall time, 64 descriptors, 1MiB/file,
32 operations, 1MiB total input write bytes, bounded stdout/stderr. Parent kills
the process group on timeout/output excess. No ambient credentials forwarded.

October 1 actual Linux test results: 4 new tests passed. Real writes/hash checks,
wrong hashes/duplicate-write failure, path escape and extra-field rejection,
plus actual namespace host-sentinel/environment/external-network denial. No
simulations or conditional skips. These prove the exercised boundaries only.

Not a complete hostile-code platform: no seccomp/cgroup policy, no verified
container runtime image, no signed durable receipts, no cross-process approval
locking/revocation transaction, no authenticated human UI. Kernel/user namespace
and runtime library trust remain. Arbitrary code is NOT exposed. The probe uses
only fixed test-authored code. Deployment is opt-in and existing features remain.
