"""Strict projection of existing safe supervisor fields plus fixed stages."""
SUPERVISOR_STAGES=frozenset(['PREFLIGHT','CGROUP_PREFLIGHT','PHYSICAL_PREFLIGHT','CONTROLLER_PREFLIGHT','CGROUP_CREATE_LIMITS','BINARY_AND_BIND_PLAN','SOURCE_CUSTODY','LOG_OPEN','IDENTITY_SPAWN','IDENTITY_READY','IDENTITY_MAP_WRITE','IDENTITY_CONFIRM','BWRAP_EXEC_AND_PHASE_WAIT'])
IDENTITY_STAGES=frozenset(['BOOTSTRAP','CHANNEL_OPEN','USER_NAMESPACE_CREATE','MAP_CONFIRM','PRIVATE_IDENTITY','CAPABILITY_TRANSFER','IDENTITY_READY_SEND','BWRAP_EXEC'])
NAMESPACE_STAGES=frozenset(['BOOTSTRAP','ENTRY_CAPABILITIES','LOOPBACK_SETUP','NETWORK_ISOLATION','FORBIDDEN_HOST_PATHS','CAPABILITY_DROP','PREFLIGHT_RECEIPTS','NODE_DRIVER_LAUNCH'])
FIXED_MESSAGES=frozenset(['CANONICAL_COMPONENT_REPLACED', 'CGROUP_CONTROLLERS_NOT_DELEGATED', 'CGROUP_COUNTER_SAMPLE_CAP', 'DISK_OUTPUT_CAP', 'FIXED_SOURCE_IDENTITY_CHANGED', 'FRESH_NONROOT_OWNER_REQUIRED', 'FRESH_ROOT_OWNER_MISMATCH', 'HARD_CGROUP_UNAVAILABLE', 'HISTORICAL_STATE_PRESENT', 'IDENTITY_CHILD_FIXED_FAILURE', 'IDENTITY_CHILD_NOT_ADMITTED', 'IDENTITY_HANDSHAKE_LIMIT', 'IDENTITY_HELPER_EXITED', 'INSUFFICIENT_ANCESTOR_HEADROOM', 'INSUFFICIENT_DISK_HEADROOM', 'INSUFFICIENT_PHYSICAL_HEADROOM', 'LOG_CAP_NO_TRUNCATION_PASS', 'MAP_READBACK_MISMATCH', 'ONLY_NEW_EMPTY_PHASE_DIR', 'PARENT_MEMORY_RESERVE', 'PRIVATE_SOURCE_ANCESTOR_SYMLINK', 'STATE_MATERIALIZATION_NOT_REVIEWED', 'VALIDATION_FIXTURE_DISK_CAP', 'WALL_LIMIT'])
FIXED_EVENT_TAGS=frozenset(['EMERGENCY_CGROUP_KILL_INVALIDATES_PASS','KERNEL_OOM_KILL_INVALIDATES_PASS','CLEANUP_UNVERIFIED','EMERGENCY_PRIVATE_GROUP_KILL_INVALIDATES_PASS','WAIT_UNVERIFIED','IDENTITY_LOG_CAP_INVALIDATES_PASS','IDENTITY_RECEIPT_UNVERIFIED','FIXED_CLEANUP_CHANNEL_FAILED','FIXED_CLEANUP_LOG_DRAIN_FAILED','FIXED_CLEANUP_LOG_CLOSE_FAILED','FIXED_CLEANUP_PIDFD_FAILED','FIXED_CLEANUP_SELECTOR_FAILED','FIXED_CLEANUP_PIPE_FAILED'])
DRIVER_OPS=frozenset(['DRIVER_BOOTSTRAP','DRIVER_STARTED_RECEIPT','COMPILER_MODULE_LOAD','REAL_FILESYSTEM_CASE','COMPILER_OUTPUT_DIRECTORY','COMPILER_PROGRAM_CREATE','COMPILER_COMPLETE_DIAGNOSTICS','COMPILER_DIAGNOSTIC_WRITE','HELPER_COMPILER_EMIT','HELPER_SOURCE_READ_PARSE','HELPER_SOURCE_WRITE','EXACT_HELPER_MODULE_LOAD','VALIDATION_RECEIPT_WRITE'])
DRIVER_REASONS=frozenset(['OTHER','VALIDATION_WORK_RESERVE','SOURCE_PARSE','EXACT_SPILL_DECLARATIONS_REQUIRED','HELPER_COMPILE_INCOMPLETE','HELPER_EMIT_SKIPPED','COMPILER_DIAGNOSTIC_BOUND','NAMED_SOURCE_TREE_REQUIRED','FULL_MODULE_DIAGNOSTICS'])
def fixed_driver(value):
    if type(value)is not dict or set(value)!={'operation','reason'}or value['operation']not in DRIVER_OPS or value['reason']not in DRIVER_REASONS:return None
    return {'operation':value['operation'],'reason':value['reason']}
def project_supervisor(value):
    out={'stage':None,'reason':None,'identityOperation':None,'childCode':None,'cleanupEventTags':[],'unclassifiedFailure':None,'unclassifiedCleanupEvents':None}
    if type(value)is not dict:return out
    if value.get('failureStage')in SUPERVISOR_STAGES:out['stage']=value['failureStage']
    if value.get('identityFailureOperation')in IDENTITY_STAGES:out['identityOperation']=value['identityFailureOperation']
    code=value.get('code')
    if type(code)is int and -255<=code<=255:out['childCode']=code
    failure=value.get('failure')
    if failure is None:out['unclassifiedFailure']=False
    elif type(failure)is str:
        out['unclassifiedFailure']=True
        for cls in ['AssertionError','RuntimeError','TimeoutError']:
            for msg in FIXED_MESSAGES:
                if failure==cls+':'+msg:out['reason']=msg;out['unclassifiedFailure']=False
    events=value.get('events')
    if type(events)is list and len(events)<=64:
        unknown=False
        for event in events:
            if type(event)is not str:unknown=True;continue
            tag=event.split(':',1)[0]
            if tag in FIXED_EVENT_TAGS:out['cleanupEventTags'].append(tag)
            else:unknown=True
        out['unclassifiedCleanupEvents']=unknown
    return out
