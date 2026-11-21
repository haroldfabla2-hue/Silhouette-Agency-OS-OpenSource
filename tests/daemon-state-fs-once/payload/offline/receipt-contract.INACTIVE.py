"""INACTIVE source contract validation. No product imports or effects.
Receipt validation is not authorization. SHA approval must be supplied externally.
"""
import re
KEYS=('runId','runAttempt','jobId','runnerName','runnerEnvironment','eventHead','repository','branch','event','jobName','runnerGroup','runnerId','labels')

def need(ok,code):
 if not ok:raise RuntimeError(code)

def validate_capture(value):
 need(isinstance(value,dict),'CAPTURE_SCHEMA')
 need(value.get('successful') is True and value.get('reaped') is True and value.get('pipeEOF') is True and value.get('groupAbsent') is True,'CAPTURE_TERMINAL')
 need(type(value.get('returnCode')) is int and value['returnCode']==0,'CAPTURE_CODE')
 for key in ('logOverflow','wallTimeout','descendantsUnknown'):need(value.get(key) is False,'CAPTURE_UNCERTAINTY')
 need(value.get('primaryFailure') is None and value.get('killRequests')==[] and value.get('cleanupFailures')==[],'CAPTURE_FAILURE')
 need(value.get('logCapBytes')==1048576 and type(value.get('bytesObserved')) is int and type(value.get('bytesStored')) is int and 0<=value['bytesStored']==value['bytesObserved']<=1048576,'CAPTURE_LOG_BOUND')
 need(type(value.get('pgid')) is int and value['pgid']>1,'CAPTURE_GROUP_ID')

def validate_terminal(terminal,admission,manager,oom):
 need(isinstance(terminal,dict) and isinstance(admission,dict) and isinstance(manager,dict) and isinstance(oom,dict),'ENVELOPE_PROOFS_SCHEMA')
 need(admission.get('kind')=='ACQUIRED_CGROUP2_BEFORE_NODE' and admission.get('parentScope')=='system.slice_NOT_ROOT' and admission.get('parentAndCgroupHandlesRetained') is True and admission.get('hierarchicalMemoryEvents') is True,'ENVELOPE_ADMISSION')
 unit=admission.get('unit');invocation=admission.get('invocationId');cg=admission.get('controlGroup')
 need(isinstance(unit,str) and re.fullmatch('daemon-state-fs-[a-f0-9]{16}\\.service',unit) and re.fullmatch('[a-f0-9]{32}',invocation or '') and cg=='/system.slice/'+unit,'ENVELOPE_ADMISSION_IDENTITY')
 need(admission.get('kernelControls')=={'memory.max':'4294967296','memory.swap.max':'0','memory.oom.group':'1','pids.max':'256','cpu.max':'200000 100000'},'ENVELOPE_PREPARATION_CONTROLS')
 need(manager.get('Id')==unit and manager.get('InvocationID')==invocation and manager.get('NRestarts')=='0' and manager.get('MainPID')==manager.get('ControlPID')=='0' and manager.get('ActiveState')=='active' and manager.get('SubState')=='exited' and manager.get('Result')=='success' and manager.get('ExecMainCode')=='1' and manager.get('ExecMainStatus')=='0','ENVELOPE_MANAGER_TERMINAL')
 need(terminal.get('kind') in ('ACQUIRED_IDENTITY_DESTROYED_CGROUP2','SAME_IDENTITY_EXTANT_EMPTY_SUBTREE') and terminal.get('controlGroup')==cg and terminal.get('identity')==admission.get('cgroupIdentity') and terminal.get('noLiveWriters') is True,'ENVELOPE_TERMINAL_IDENTITY')
 if terminal['kind']=='ACQUIRED_IDENTITY_DESTROYED_CGROUP2':
  need(terminal.get('invocationId')==invocation and terminal.get('parentContinuity') is True and terminal.get('mountContinuity') is True and terminal.get('relativeLookup')=='ENOENT_TWICE','ENVELOPE_DESTROYED_PROOF')
 else:
  need(terminal.get('populatedBefore')==terminal.get('populatedAfter')==0 and terminal.get('recursiveProcsEmpty') is True and type(terminal.get('directoriesChecked')) is int and 1<=terminal['directoriesChecked']<=128,'ENVELOPE_EMPTY_PROOF')
 keys=('oom','oom_kill','oom_group_kill')
 need(oom.get('kind')=='ANCHORED_NONROOT_ANCESTOR_ZERO_OOM_DELTA' and oom.get('assumedZero') is False and oom.get('scope')=='PARENT_NO_EVENTS_IMPLIES_ACQUIRED_CHILD_NO_EVENTS' and oom.get('foreignEvents')=='CONSERVATIVE_UNKNOWN_NOT_ATTRIBUTED','ENVELOPE_OOM_KIND')
 need(oom.get('before')==admission.get('parentMemoryEventsBeforeChildZero') and oom.get('delta')=={k:0 for k in keys},'ENVELOPE_OOM_BINDING')
 for k in keys:
  before=oom.get('before',{}).get(k);after=oom.get('after',{}).get(k)
  need(type(before) is int and type(after) is int and 0<=before==after<2**62,'ENVELOPE_OOM_COUNTERS')
 child=terminal.get('memoryEvents');need(oom.get('childTerminalCounters')==child and isinstance(child,dict) and child.get('assumedZero') is False,'ENVELOPE_CHILD_COUNTER_BINDING')
 if terminal['kind']=='ACQUIRED_IDENTITY_DESTROYED_CGROUP2':need(child.get('state')=='UNAVAILABLE_AFTER_DESTRUCTION','ENVELOPE_CHILD_DESTROYED')
 else:
  need(child.get('state')=='OBSERVED' and all(child.get('values',{}).get(k)==0 for k in keys),'ENVELOPE_CHILD_OBSERVED')

def validate_envelope(envelope,context,root_sha):
 need(envelope.get('state')=='PREPARED_FULLTYPES_ONLY' and envelope.get('reviewRootSha256')==root_sha and envelope.get('productExecuted') is False,'ENVELOPE_RESULT_SCOPE')
 for key in ('forcedCleanup','cleanupUnknown','evidenceUnknown'):need(envelope.get(key) is False,'ENVELOPE_UNCERTAINTY')
 need(envelope.get('cleanupSafe') is True,'ENVELOPE_STABLE_PROOF')
 old=envelope.get('publicContext');need(isinstance(old,dict),'ENVELOPE_CONTEXT_SCHEMA')
 for key in KEYS:need(key in old and key in context and old[key]==context[key],'ENVELOPE_SAME_RUN_JOB_EVENT')
 need(context.get('runnerEnvironment')=='github-hosted' and context.get('runAttempt')==1 and context.get('jobStatus')=='in_progress','ENVELOPE_CONTEXT_STATE')
 validate_terminal(envelope.get('terminal'),envelope.get('admission'),envelope.get('terminalManager'),envelope.get('oom'))

def validate_types(value,patch_sha):
 need(value.get('state')=='PREPARED_TYPES_PASSED' and value.get('stage')=='OFFLINE_RUNTIME_NOT_STARTED' and value.get('kind')=='REAL_LOCKFILE_TYPECHECK','TYPES_STATE')
 need(value.get('fullRepositoryTypesPassed') is True and value.get('installExitCode')==value.get('typesExitCode')==0,'TYPES_PASS')
 for key in ('productExecuted','nativeAddonsExecuted','lifecycleScriptsEnabled','productExecutionAttempted'):need(value.get(key) is False,'TYPES_SCOPE')
 need(value.get('sourceBaseline')=='cd0066be67748f5948515bf3d20e6edc36d7b7c0' and value.get('candidatePatchSha256')==patch_sha,'TYPES_SOURCE')
 lock='f8cad2766f4c9d32310625e8951a53f17355c94409424aeb917e6ad5c01e9512'
 need(value.get('packageLockSha256')==value.get('lockBeforeSha256')==value.get('lockAfterSha256')==lock,'TYPES_LOCK')
 need(value.get('compilerVersion')=='5.8.3' and value.get('nodeTypesVersion')=='22.19.1' and value.get('compilerSha256')=='2cffde0b8c6760dfb0b5b0382bbb7e00ba6a8b2d981b9205b256a700a481d983','TYPES_COMPILER')
 validate_capture(value.get('installCapture'));validate_capture(value.get('typesCapture'))
 # H1/H2 cannot be filled with a caller assertion. No valid V3 preparation
 # exists until its complete source/toolchain rootfs producer is reviewed.
 need(value.get('preparationIsolationContract')=='ROOTFS_PUBLIC_SOURCE_TOOLCHAIN_V3' and isinstance(value.get('preparationClosureSha256'),str) and re.fullmatch('[a-f0-9]{64}',value['preparationClosureSha256']),'TYPES_ISOLATION_CONTRACT_MISSING')
