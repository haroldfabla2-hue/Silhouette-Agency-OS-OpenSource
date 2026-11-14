"""SOURCE ONLY. No invocation at import except definitions. No acquired code.
Linux x86_64 v6.11 UAPI layouts. Unsupported syscall/fields => fail closed.
"""
import ctypes
import os
import platform
import struct

class MountModelUnavailable(Exception):
    pass

def mount_identity(fd):
    if platform.machine()!='x86_64':raise MountModelUnavailable('ARCH_UNSUPPORTED')
    libc=ctypes.CDLL(None,use_errno=True)
    # statx via stable x86_64 syscall332; AT_EMPTY_PATH, BASIC+MNT_ID_UNIQUE.
    buf=ctypes.create_string_buffer(256)
    rc=libc.syscall(ctypes.c_long(332),ctypes.c_int(fd),ctypes.c_char_p(b''),ctypes.c_int(0x1000),ctypes.c_uint(0x47ff),ctypes.byref(buf))
    if rc!=0:raise MountModelUnavailable('STATX_UNAVAILABLE')
    mask=struct.unpack_from('<I',buf.raw,0)[0]
    if mask&0x4000!=0x4000:raise MountModelUnavailable('UNIQUE_MOUNT_ID_UNAVAILABLE')
    unique=struct.unpack_from('<Q',buf.raw,144)[0]
    req=ctypes.create_string_buffer(struct.pack('<IIQQQ',32,0,unique,3,0))
    out=ctypes.create_string_buffer(512)
    rc=libc.syscall(ctypes.c_long(457),ctypes.byref(req),ctypes.byref(out),ctypes.c_size_t(512),ctypes.c_uint(0))
    if rc!=0:raise MountModelUnavailable('STATMOUNT_UNAVAILABLE')
    raw=out.raw;size=struct.unpack_from('<I',raw)[0];fields=struct.unpack_from('<Q',raw,8)[0]
    if not 512<=size<=512 or fields&3!=3:raise MountModelUnavailable('MOUNT_FIELDS_UNAVAILABLE')
    fs_magic=struct.unpack_from('<Q',raw,24)[0];mount_id=struct.unpack_from('<Q',raw,40)[0];attrs=struct.unpack_from('<Q',raw,64)[0]
    if mount_id!=unique or attrs&0x100000 or fs_magic not in(0xef53,0x58465342):
        raise MountModelUnavailable('IDMAPPED_OR_UNSUPPORTED_FILESYSTEM')
    return(unique,fs_magic,attrs)

def require_host_identity_namespace():
    for name in('uid_map','gid_map'):
        fd=os.open('/proc/self/'+name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
        with os.fdopen(fd,'rb')as stream:value=stream.read(257)
        if len(value)>256 or value.split()!=[b'0',b'0',b'4294967295']:
            raise MountModelUnavailable('USER_NAMESPACE_MAPPING_UNSUPPORTED')
    if os.stat('/proc/self/ns/user').st_ino!=os.stat('/proc/1/ns/user').st_ino:
        raise MountModelUnavailable('USER_NAMESPACE_MISMATCH')
    fd=os.open('/proc/self/status',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    with os.fdopen(fd,'rb')as stream:status=stream.read(65537)
    if len(status)>65536:raise MountModelUnavailable('PROC_STATUS_BOUND')
    fields=dict(line.split(b':',1)for line in status.splitlines()if b':'in line)
    if any(int(fields.get(k,b'-1').strip(),16)!=0 for k in(b'CapEff',b'CapPrm',b'CapInh',b'CapAmb')):raise MountModelUnavailable('SUPERVISOR_CAPABILITIES_UNSUPPORTED')
    if os.geteuid()==0:raise MountModelUnavailable('NONROOT_RUNNER_REQUIRED')
    return(os.geteuid(),os.stat('/proc/self/ns/user').st_ino,os.stat('/proc/self/ns/mnt').st_ino)
