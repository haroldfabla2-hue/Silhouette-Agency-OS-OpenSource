from fixed_io_boundary import fixed_call,read_and_close
"""SOURCE ONLY. No invocation at import except definitions. No acquired code.
Linux x86_64 v6.11 UAPI layouts. Unsupported syscall/fields => fail closed.
"""
import errno
import ctypes
import os
import platform
import struct

class MountModelUnavailable(Exception):
    pass

def syscall_failure(operation):
    code = ctypes.get_errno()
    label = {errno.ENOSYS: 'ENOSYS', errno.EPERM: 'EPERM', errno.EACCES: 'EACCES', errno.EINVAL: 'EINVAL', errno.EOVERFLOW: 'EOVERFLOW'}.get(code, 'OTHER')
    raise MountModelUnavailable(operation + '_' + label)

def mount_identity(fd):
    if fixed_call('PLATFORM_ARCH',platform.machine) != 'x86_64':
        raise MountModelUnavailable('ARCH_UNSUPPORTED')
    libc = fixed_call('LIBC_BIND',ctypes.CDLL,None, use_errno=True)
    buf = ctypes.create_string_buffer(256)
    rc = fixed_call('STATX_SYSCALL', libc.syscall, ctypes.c_long(332), ctypes.c_int(fd), ctypes.c_char_p(b''), ctypes.c_int(4096), ctypes.c_uint(18431), ctypes.byref(buf))
    if rc != 0:
        fixed_call('STATX_SYSCALL',syscall_failure,'STATX')
    mask = struct.unpack_from('<I', buf.raw, 0)[0]
    if mask & 16384 != 16384:
        raise MountModelUnavailable('UNIQUE_MOUNT_ID_UNAVAILABLE')
    unique = struct.unpack_from('<Q', buf.raw, 144)[0]
    req = ctypes.create_string_buffer(struct.pack('<IIQQQ', 32, 0, unique, 3, 0))
    out = ctypes.create_string_buffer(512)
    rc = fixed_call('STATMOUNT_SYSCALL', libc.syscall, ctypes.c_long(457), ctypes.byref(req), ctypes.byref(out), ctypes.c_size_t(512), ctypes.c_uint(0))
    if rc != 0:
        fixed_call('STATMOUNT_SYSCALL',syscall_failure,'STATMOUNT')
    raw = out.raw
    size = struct.unpack_from('<I', raw)[0]
    fields = struct.unpack_from('<Q', raw, 8)[0]
    if not 512 <= size <= 512 or fields & 3 != 3:
        raise MountModelUnavailable('MOUNT_FIELDS_UNAVAILABLE')
    fs_magic = struct.unpack_from('<Q', raw, 24)[0]
    mount_id = struct.unpack_from('<Q', raw, 40)[0]
    attrs = struct.unpack_from('<Q', raw, 64)[0]
    if mount_id != unique or attrs & 1048576 or fs_magic not in (61267, 1481003842):
        raise MountModelUnavailable('IDMAPPED_OR_UNSUPPORTED_FILESYSTEM')
    return (unique, fs_magic, attrs)

def require_host_identity_namespace():
    for name in ('uid_map', 'gid_map'):
        fd = fixed_call('UID_MAP_OPEN' if name == 'uid_map' else 'GID_MAP_OPEN', os.open, '/proc/self/' + name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        value=read_and_close(fd,257,'UID_MAP_READ' if name=='uid_map'else'GID_MAP_READ')
        if len(value) > 256 or value.split() != [b'0', b'0', b'4294967295']:
            raise MountModelUnavailable('USER_NAMESPACE_MAPPING_UNSUPPORTED')
    if fixed_call('SELF_USERNS_STAT', os.stat, '/proc/self/ns/user').st_ino != fixed_call('PID1_USERNS_STAT', os.stat, '/proc/1/ns/user').st_ino:
        raise MountModelUnavailable('USER_NAMESPACE_MISMATCH')
    fd = fixed_call('PROC_STATUS_OPEN', os.open, '/proc/self/status', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    status=read_and_close(fd,65537,'PROC_STATUS_READ')
    if len(status) > 65536:
        raise MountModelUnavailable('PROC_STATUS_BOUND')
    fields = dict((line.split(b':', 1) for line in status.splitlines() if b':' in line))
    if any((int(fields.get(k, b'-1').strip(), 16) != 0 for k in (b'CapEff', b'CapPrm', b'CapInh', b'CapAmb'))):
        raise MountModelUnavailable('SUPERVISOR_CAPABILITIES_UNSUPPORTED')
    if fixed_call('PROCESS_UID',os.geteuid) == 0:
        raise MountModelUnavailable('NONROOT_RUNNER_REQUIRED')
    return (fixed_call('PROCESS_UID',os.geteuid), fixed_call('SELF_USERNS_STAT', os.stat, '/proc/self/ns/user').st_ino, fixed_call('SELF_MOUNTNS_STAT', os.stat, '/proc/self/ns/mnt').st_ino)
