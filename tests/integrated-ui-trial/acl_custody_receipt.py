"""SOURCE ONLY finite decision receipt. No raw data, IDs, paths or hashes."""
KEYS={'version','status','inspectedAncestors','aclAncestors','defaultAclAncestors','untrustedWriteEntries','model','effectiveDacChecked','mountModelChecked','productPass','failureStage','failureReason'}
REASONS=frozenset(('ACL_BASE_ENTRIES_REQUIRED', 'ACL_DUPLICATE_ENTRY', 'ACL_ENCODING_UNSUPPORTED', 'ACL_ENTRY_UNSUPPORTED', 'ACL_MASK_REQUIRED', 'ACL_MODE_MISMATCH', 'ACL_READ_UNAVAILABLE', 'ARCH_UNSUPPORTED', 'BUDGET_EXHAUSTED', 'CHAIN_CHANGED', 'COUNT_BOUND', 'DEADLINE', 'DEADLINE_OR_CLOSED_CHAIN', 'DIAGNOSTIC_DEADLINE', 'DIAGNOSTIC_NEVER_ADMITS', 'DIRECTORY_REQUIRED', 'EXPECTED_MUTATION_ACL_CHANGED', 'EXPECTED_MUTATION_IDENTITY_CHANGED', 'FIXED_PATH_REQUIRED', 'FIXED_STATUS_REQUIRED', 'FIXED_SUMMARY_REQUIRED', 'FIXED_VERSION_REQUIRED', 'IDMAPPED_OR_UNSUPPORTED_FILESYSTEM', 'LEAF_NONOWNER_ACCESS', 'LEAF_NOT_PRIVATE', 'MODE_ACL_MISMATCH', 'MODE_NONOWNER_WRITE', 'MOUNT_FIELDS_UNAVAILABLE', 'NAMESPACE_CHANGED', 'NATIVE_OR_QUALIFIER_FAILURE', 'NONROOT_RUNNER_REQUIRED', 'NO_RETAINED_CHAIN', 'PATH_SHAPE', 'PATH_SHAPE_UNSUPPORTED', 'PROC_STATUS_BOUND', 'STATMOUNT_UNAVAILABLE', 'STATX_UNAVAILABLE', 'SUPERVISOR_CAPABILITIES_UNSUPPORTED', 'TYPE_OR_DEADLINE', 'UNEXPECTED_EXCEPTION', 'UNIQUE_MOUNT_ID_UNAVAILABLE', 'UNTRUSTED_ENTRY_WRITE', 'UNTRUSTED_OWNER', 'USER_NAMESPACE_MAPPING_UNSUPPORTED', 'USER_NAMESPACE_MISMATCH'))
REASONS=REASONS|frozenset(op+'_'+reason for op in('STATX','STATMOUNT')for reason in('ENOSYS','EPERM','EACCES','EINVAL','EOVERFLOW','OTHER'))|frozenset(('IO_ENOENT','IO_ELOOP','IO_EACCES','IO_ENOTDIR','IO_OTHER'))
STAGES=frozenset(('ROOT_CHAIN','EVIDENCE_CHAIN','PRIVATE_MKDIR','PRIVATE_CHAIN','PRIVATE_FD','SINK_OPEN','SINK_ACL','CHAIN_RECHECK','FD_GRANT','QUALIFIER_COMMAND','COMPLETE'))
STATUSES={'SUPPORTED_MODEL_DAC_CUSTODY','BLOCKED_UNSAFE_ACCESS','BLOCKED_UNSUPPORTED_OR_INCOMPLETE'}
def validate(v):
    assert type(v)is dict and set(v)==KEYS
    assert type(v['version'])is int and v['version']==1 and v['status']in STATUSES
    assert v['model']=='ROOT_AND_SUPERVISOR_ONLY_LOCAL_EXT4_XFS_NONIDMAPPED'
    for k,n in(('inspectedAncestors',32),('aclAncestors',32),('defaultAclAncestors',32),('untrustedWriteEntries',16352)):
        if k=='untrustedWriteEntries'and v['status']!='SUPPORTED_MODEL_DAC_CUSTODY':assert v[k]is None
        else:assert type(v[k])is int and 0<=v[k]<=n
    assert type(v['effectiveDacChecked'])is bool and type(v['mountModelChecked'])is bool and v['productPass']is False
    assert v['failureStage']in STAGES
    assert v['failureReason']in REASONS|{'NONE'}
    if v['status']=='SUPPORTED_MODEL_DAC_CUSTODY':
        assert v['failureStage']=='COMPLETE'and v['failureReason']=='NONE'
    else:assert v['failureReason']!='NONE'
    if v['status']=='SUPPORTED_MODEL_DAC_CUSTODY':assert v['effectiveDacChecked']and v['mountModelChecked']and v['untrustedWriteEntries']==0
    else:assert not v['effectiveDacChecked']
    return v

def finite(chain,status,stage='COMPLETE',reason='NONE'):
    raw=chain.raw_private if chain is not None else[]
    good=status=='SUPPORTED_MODEL_DAC_CUSTODY'
    return validate({'version':1,'status':status,'inspectedAncestors':len(raw),'aclAncestors':sum(x['access']is not None for x in raw),'defaultAclAncestors':sum(x['default']is not None for x in raw),'untrustedWriteEntries':0 if good else None,'model':'ROOT_AND_SUPERVISOR_ONLY_LOCAL_EXT4_XFS_NONIDMAPPED','effectiveDacChecked':good,'mountModelChecked':good,'productPass':False,'failureStage':stage,'failureReason':reason})

# Raw exceptions are NEVER serialized. Only exact source-owned class/reason
# combinations are mapped. No class-name or str(exception) export fallback.
def classify_fixed(exception,trusted_types):
    if type(exception)in trusted_types and len(exception.args)==1 and type(exception.args[0])is str and exception.args[0]in REASONS:
        return exception.args[0]
    if type(exception)is OSError or isinstance(exception,(FileNotFoundError,PermissionError,NotADirectoryError)):
        import errno
        return {errno.ENOENT:'IO_ENOENT',errno.ELOOP:'IO_ELOOP',errno.EACCES:'IO_EACCES',errno.ENOTDIR:'IO_ENOTDIR'}.get(exception.errno,'IO_OTHER')
    return 'UNEXPECTED_EXCEPTION'

def classify_at_stage(exception,trusted_types,stage):
    reason=classify_fixed(exception,trusted_types)
    if reason!='UNEXPECTED_EXCEPTION':return reason
    if type(exception)is AssertionError and exception.args==('QUALIFICATION_FD_GRANT_BUDGET_EXHAUSTED',):return 'BUDGET_EXHAUSTED'
    if stage=='QUALIFIER_COMMAND':return 'NATIVE_OR_QUALIFIER_FAILURE'
    return reason
