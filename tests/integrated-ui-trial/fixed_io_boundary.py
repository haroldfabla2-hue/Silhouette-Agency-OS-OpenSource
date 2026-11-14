"""Source-only fixed IO operation attribution; never print raw exceptions.
The supervisor alone supplies code-owned callables/operations, not candidate.
"""
OPERATIONS=frozenset(('UID_MAP_OPEN','UID_MAP_READ','GID_MAP_OPEN','GID_MAP_READ','SELF_USERNS_STAT','PID1_USERNS_STAT','SELF_MOUNTNS_STAT','PROC_STATUS_OPEN','PROC_STATUS_READ','ROOT_DIRECTORY_OPEN','CHILD_DIRECTORY_OPEN','DIRECTORY_FSTAT','ACCESS_ACL_READ','DEFAULT_ACL_READ','STATX_SYSCALL','STATMOUNT_SYSCALL','NAMESPACE_IDENTITY','MOUNT_IDENTITY','CHAIN_RECHECK','EXPECTED_MUTATION_RECHECK','PRIVATE_MKDIR','PRIVATE_FD_DUP','SINK_OPEN','SINK_FSTAT','SINK_ACL','FD_CLOSE','QUALIFIER_COMMAND','RECEIPT_EMIT','QUALIFICATION_BUDGET','FD_STREAM_OPEN','LIBC_BIND','PLATFORM_ARCH','PROCESS_UID','CLOCK_READ','ACL_PARSE','ACCESS_RIGHTS'))
class FixedBoundaryFailure(Exception):
    def __init__(self,operation,original):
        assert operation in OPERATIONS
        self.operation=operation;self.original=original;self.cleanupFailed=getattr(original,'cleanupFailed',False)is True
        # No original message in args or generic traceback representation.
        super().__init__('FIXED_BOUNDARY_FAILURE')
def fixed_call(operation,function,*args,**kwargs):
    assert operation in OPERATIONS
    try:return function(*args,**kwargs)
    except FixedBoundaryFailure:raise
    except BaseException as original:raise FixedBoundaryFailure(operation,original)from None

def read_and_close(fd,limit,read_operation):
    import os
    first=None
    try:return fixed_call(read_operation,os.read,fd,limit)
    except BaseException as original:first=original;raise
    finally:
        try:fixed_call('FD_CLOSE',os.close,fd)
        except BaseException:
            if first is not None:first.cleanupFailed=True
            else:raise
