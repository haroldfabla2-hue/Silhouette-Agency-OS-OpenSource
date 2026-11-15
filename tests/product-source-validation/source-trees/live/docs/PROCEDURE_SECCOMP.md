# Optional trusted seccomp filter for the closed file worker

Existing worker default remains unchanged. Deployment can provide an explicit
trusted-local BPF file and SHA-256 to `testOsFileProcedure(procedure, artifact)`.
Wrong/missing/hash-invalid filter fails before launch; no fallback to weaker mode
when an artifact was requested. Filter bytes are piped on FD3 to bubblewrap, not
loaded as JavaScript or mounted into worker. Caller never supplies arbitrary code.

`scripts/generate_procedure_seccomp.py` uses system libseccomp to resolve syscall
numbers for the build host architecture and export BPF. Generate separately on
that deployment architecture; do not copy an x86 filter to another architecture.
No binary filter bundled or guessed syscall IDs. Deployment pins the generated
artifact SHA-256. Needs Linux Python3/libseccomp.so.2/bubblewrap/prlimit. CI uses
real libseccomp and real syscall execution, not a mocked security result.

This is a DENY LIST, not a complete least-privilege syscall allow list: denies
socket/socketpair/connect/bind/listen/accept, ptrace/process_vm access, mount/
pivot_root, bpf/perf/key management, reboot/module/kexec and namespace changes.
Returns EPERM. Existing unshared namespaces/default-deny external mounts/empty
environment/prlimit gates remain. Arbitrary/generated code is not exposed.
Does not prove every dangerous syscall or exploit is blocked. Kernel/runtime
libraries are trusted. No cgroup quotas: /sys/fs/cgroup here is read-only, so no
writable delegated cgroup or actual cgroup memory/process quota was verified.
Do not claim a full hostile-code execution platform or production certification.

Actual local regression: deployment-generated BPF, real closed worker disk writes
and SHA checks succeed; modified filter hash rejected; actual socket/listen call
inside namespace returns EPERM. Existing worker tests retained. Full filter policy
review, architecture-specific deployment, cgroup delegation, signed receipts and
live cancellation wiring still required before broader production execution.
