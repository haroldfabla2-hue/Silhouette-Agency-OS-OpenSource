"""Trusted deployment helper: x86/Linux libseccomp BPF deny list, not a full allow list."""
import argparse
import ctypes
parser = argparse.ArgumentParser()
parser.add_argument("--output", required=True)
args = parser.parse_args()
lib=ctypes.CDLL('libseccomp.so.2',use_errno=True)
lib.seccomp_init.argtypes=[ctypes.c_uint32];lib.seccomp_init.restype=ctypes.c_void_p
lib.seccomp_rule_add.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_int,ctypes.c_uint]
lib.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p];lib.seccomp_syscall_resolve_name.restype=ctypes.c_int
lib.seccomp_export_bpf.argtypes=[ctypes.c_void_p,ctypes.c_int]
lib.seccomp_release.argtypes=[ctypes.c_void_p]
ctx=lib.seccomp_init(0x7fff0000)
for name in ['socket','socketpair','connect','bind','listen','accept','accept4','ptrace','process_vm_readv','process_vm_writev','mount','umount2','pivot_root','bpf','perf_event_open','keyctl','add_key','request_key','reboot','kexec_load','init_module','finit_module','delete_module','unshare','setns']:
 nr=lib.seccomp_syscall_resolve_name(name.encode())
 if nr<0:raise RuntimeError(name)
 if lib.seccomp_rule_add(ctx,0x00050000|1,nr,0):raise RuntimeError('rule')
with open(args.output,'wb') as out:
 if lib.seccomp_export_bpf(ctx,out.fileno()):raise RuntimeError('export')
lib.seccomp_release(ctx)
