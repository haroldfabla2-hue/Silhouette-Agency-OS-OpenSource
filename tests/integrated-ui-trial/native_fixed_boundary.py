"""Source-owned native first-failure labels. No raw exception serialization."""
import errno

OPERATIONS = frozenset(('EXTENSION_ARGS','EXTENSION_BUDGET','MODULE_SPEC','MODULE_CREATE','MODULE_EXEC',
 'CONTRACT_OPEN','CONTRACT_READ','CONTRACT_CLOSE','CONTRACT_PARSE','CONTRACT_VALIDATE','DIRECTORY_FSTAT','DIRECTORY_CUSTODY','PROCESS_UID',
 'SINK_FSTAT','SINK_CUSTODY','CLOCK_READ','INVENTORY','CACHE_PARSE','SONAME_VALIDATE',
 'LIBRARY_RESOLVE','LIBRARY_STAT','INTERPRETER_RESOLVE','PROVIDER_RESOLVE','PROVIDER_STAT',
 'PROVIDER_RESTAT','PROVIDER_GUARDS','PROVIDER_PARSE','PRIVATE_SERIALIZE','PRIVATE_OPEN','PRIVATE_WRITE',
 'PRIVATE_FSYNC','PRIVATE_CLOSE','PRIVATE_DIRECTORY_FSYNC','FAILURE_SERIALIZE','FAILURE_OPEN',
 'FAILURE_WRITE','FAILURE_FSYNC','FAILURE_CLOSE','FAILURE_DIRECTORY_FSYNC','FINITE_PROJECT',
 'FINITE_VALIDATE','FINITE_ENCODE','FINITE_BOUND','SINK_WRITE','SINK_FSYNC','FINAL_GATE',
 'QUALIFIER_EXTENSION','PRIVATE_FAILURE_RECORD','FIXED_FALLBACK')) | frozenset(
 family+'_'+operation for family in ('CACHE_TOOL','PROVIDER_TOOL') for operation in
 ('SPAWN','SELECTOR_CREATE','NONBLOCK','REGISTER','CLOCK','SELECT','READ','UNREGISTER',
  'WAIT','RESULT','DECODE','SELECTOR_CLOSE','GROUP_PROBE','KILL','CLEANUP_WAIT','STDOUT_CLOSE','STDERR_CLOSE'))
REASONS = frozenset(('NONE','UNEXPECTED_EXCEPTION','IO_ENOENT','IO_EACCES','IO_EPERM','IO_ELOOP','IO_ENOTDIR','IO_ENOSPC','IO_OTHER',
 'TOOL_TIMEOUT','TOOL_NONZERO_EXIT','TOOL_STDERR','TOOL_OUTPUT_CAP','TOOL_UTF8',
 'UNREVIEWED_HOST_TOOL','HOST_TOOL_BOUNDS','HOST_TOOL_WALL','HOST_TOOL_NOT_CLEAN','HOST_TOOL_OUTPUT_CAP',
 'HOST_TOOL_RESIDUAL_GROUP','SONAME_CONTRACT','SONAME_FORMAT','QUALIFICATION_BUDGET_EXHAUSTED',
 'PROVIDER_AGGREGATE_WALL','PROVIDER_OBJECT_CAP','NON_SYSTEM_PROVIDER','PROVIDER_CUSTODY',
 'PROVIDER_ARCHITECTURE','PROVIDER_CHANGED','PROVIDER_EDGE_CAP','PROVIDER_QUEUE_CAP',
 'PRIVATE_DIRECTORY_FD_CUSTODY','FIXED_SINK_FD_CUSTODY','PRIVATE_NATIVE_SCHEMA_INCOMPLETE',
 'PRIVATE_NATIVE_GAP_NOT_ALLOWLISTED','PRIVATE_PROVIDER_SCHEMA_INCOMPLETE','PRIVATE_LIBRARY_SCHEMA_INCOMPLETE',
 'STATIC_NATIVE_HARD_GAP','FIXED_NATIVE_RECEIPT_BOUND','FIXED_NATIVE_RECEIPT_SHORT_WRITE',
 'STATIC_NATIVE_HARD_GAP_OR_BUDGET','SUPERVISOR_FD_ADMISSION_REQUIRED','NO_EXTENSION_BUDGET_REMAINS',
 'CONTRACT_INCOMPLETE','PRIVATE_JSON_BOUND','PRIVATE_SHORT_WRITE','CLEANUP_FAILURE'))

class NativeFixedFailure(Exception):
    def __init__(self, operation, original):
        assert operation in OPERATIONS
        self.operation = operation
        self.original = original
        self.cleanupFailed = getattr(original, 'cleanupFailed', False) is True
        self.cleanupForced = getattr(original, 'cleanupForced', False) is True
        self.privateEvidenceFailed = getattr(original, 'privateEvidenceFailed', False) is True
        self.receiptWritten = getattr(original, 'receiptWritten', False) is True
        super().__init__('NATIVE_FIXED_FAILURE')

class NativeFixedReason(Exception):
    pass

def call(operation, function, *args, **kwargs):
    assert operation in OPERATIONS
    try:
        return function(*args, **kwargs)
    except NativeFixedFailure:
        raise
    except BaseException as original:
        raise NativeFixedFailure(operation, original) from None

def deny(operation, reason):
    assert reason in REASONS and reason != 'NONE'
    raise NativeFixedFailure(operation, NativeFixedReason(reason)) from None

def fixed_reason(error, trusted_types=()):
    if type(error) is NativeFixedFailure:
        error = error.original
    if type(error) in (NativeFixedReason, *trusted_types) and len(error.args) == 1 and type(error.args[0]) is str and error.args[0] in REASONS:
        return error.args[0]
    if isinstance(error, OSError):
        return {errno.ENOENT:'IO_ENOENT',errno.EACCES:'IO_EACCES',errno.EPERM:'IO_EPERM',
                errno.ELOOP:'IO_ELOOP',errno.ENOTDIR:'IO_ENOTDIR',errno.ENOSPC:'IO_ENOSPC'}.get(error.errno,'IO_OTHER')
    # No class-name, message or partial-string inference.
    return 'UNEXPECTED_EXCEPTION'

def diagnostic(error, trusted_types=()):
    return {'failureOperation': error.operation if type(error) is NativeFixedFailure else 'UNATTRIBUTED_INTERNAL',
            'failureReason': fixed_reason(error, trusted_types),
            'cleanupFailed': getattr(error,'cleanupFailed',False) is True,
            'cleanupForced': getattr(error,'cleanupForced',False) is True,
            'privateEvidenceFailed': getattr(error,'privateEvidenceFailed',False) is True}

def clean_diagnostic():
    return {'failureOperation':'NONE','failureReason':'NONE','cleanupFailed':False,
            'cleanupForced':False,'privateEvidenceFailed':False}

def blocked_receipt(error, trusted_types=()):
    return {'version':1,'status':'BLOCKED_PRIVATE_INVENTORY_UNAVAILABLE',
            'libraryCount':0,'cacheCandidateCount':0,'providerObjectCount':0,
            'unresolvedCount':0,'unsupportedCount':0,'fixedGapCount':1,
            'vendorAndDlopen':'UNVERIFIED','namespaceLoad':'NOT_EXECUTED','resourceFit':'UNVERIFIED',
            'nativeQualified':False,'productPass':False,**diagnostic(error,trusted_types)}
