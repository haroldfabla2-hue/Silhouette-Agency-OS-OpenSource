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

class GlobalNumericIdentityGrant:
    """Owned self-namespace FDs, not initial-user-namespace membership proof.
    Genuine host procfs and reviewed Linux maximal-extent semantics required.
    Only trusted supervisor code may own/use this grant; never candidate data.
    """
    def __init__(self):
        self.fds=[]
        self.identities=None
        self.runner=None
        self.closed=False

    def close(self):
        first=None
        if not self.closed:
            for fd in reversed(self.fds):
                try:fixed_call('FD_CLOSE',os.close,fd)
                except BaseException as error:
                    if first is None:first=error
            self.closed=True
        if first is not None:raise first

    def current_identities(self):
        values=[]
        for fd,name,operation in zip(self.fds,('user','mnt'),('SELF_USERNS_STAT','SELF_MOUNTNS_STAT')):
            held=fixed_call('NAMESPACE_FSTAT',os.fstat,fd)
            now=fixed_call(operation,os.stat,'/proc/self/ns/'+name)
            identity=(held.st_dev,held.st_ino)
            if identity!=(now.st_dev,now.st_ino):
                raise MountModelUnavailable('NAMESPACE_CHANGED')
            values.append(identity)
        if len(values)!=2:raise MountModelUnavailable('NAMESPACE_CHANGED')
        return tuple(values)

    def recheck(self):
        if self.closed:raise MountModelUnavailable('NAMESPACE_CHANGED')
        before=self.current_identities()
        if before!=self.identities:raise MountModelUnavailable('NAMESPACE_CHANGED')
        runner=_require_global_numeric_id_maps_and_caps()
        if runner!=self.runner or self.current_identities()!=before:
            raise MountModelUnavailable('NAMESPACE_CHANGED')
        return self.runner


def _read_bounded_proc(path,limit,open_operation,read_operation,bound_reason):
    fd=fixed_call(open_operation,os.open,path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    first=None
    try:
        result=bytearray()
        while True:
            value=fixed_call(read_operation,os.read,fd,min(4096,limit+1-len(result)))
            if not value:return bytes(result)
            result.extend(value)
            if len(result)>limit:raise MountModelUnavailable(bound_reason)
    except BaseException as original:first=original;raise
    finally:
        try:fixed_call('FD_CLOSE',os.close,fd)
        except BaseException:
            if first is not None:first.cleanupFailed=True
            else:raise


def _require_global_numeric_id_maps_and_caps():
    for name in ('uid_map','gid_map'):
        value=_read_bounded_proc('/proc/self/'+name,256,
            'UID_MAP_OPEN'if name=='uid_map'else'GID_MAP_OPEN',
            'UID_MAP_READ'if name=='uid_map'else'GID_MAP_READ',
            'USER_NAMESPACE_MAPPING_UNSUPPORTED')
        # Full EOF-checked sole maximal extent. Parent-relative second column
        # alone is NOT proof. Kernel stores composed global extents; maximal
        # contiguous count forces stored global base0 through every parent.
        if value.split()!=[b'0',b'0',b'4294967295']:
            raise MountModelUnavailable('USER_NAMESPACE_MAPPING_UNSUPPORTED')
    status=_read_bounded_proc('/proc/self/status',65536,'PROC_STATUS_OPEN','PROC_STATUS_READ','PROC_STATUS_BOUND')
    fields={}
    for line in status.splitlines():
        if b':'not in line:continue
        key,value=line.split(b':',1)
        if key in fields:raise MountModelUnavailable('PROC_STATUS_BOUND')
        fields[key]=value
    if any(int(fields.get(k,b'-1').strip(),16)!=0 for k in(b'CapEff',b'CapPrm',b'CapInh',b'CapAmb')):
        raise MountModelUnavailable('SUPERVISOR_CAPABILITIES_UNSUPPORTED')
    runner=fixed_call('PROCESS_UID',os.geteuid)
    if runner==0:raise MountModelUnavailable('NONROOT_RUNNER_REQUIRED')
    return runner


def retain_global_numeric_identity():
    grant=GlobalNumericIdentityGrant()
    try:
        # Following these two fixed procfs magic links is intentional. They
        # refer only to this process; no PID1 access or privilege expansion.
        for name,operation in(('user','SELF_USERNS_OPEN'),('mnt','SELF_MOUNTNS_OPEN')):
            fd=fixed_call(operation,os.open,'/proc/self/ns/'+name,os.O_RDONLY|os.O_CLOEXEC)
            grant.fds.append(fd) # Register BEFORE any fstat or map read.
        grant.identities=grant.current_identities()
        grant.runner=_require_global_numeric_id_maps_and_caps()
        if grant.current_identities()!=grant.identities:
            raise MountModelUnavailable('NAMESPACE_CHANGED')
        grant.recheck()
        return grant
    except BaseException as original:
        try:grant.close()
        except BaseException:original.cleanupFailed=True
        raise
