"""INACTIVE complete once-only stage launcher. Explicit CLI only in future job.
External bootstrap hashes this file before import; every stage rechecks all pins.
No retry after UNKNOWN. Job exit is NOT proof of VM teardown.
"""
from pathlib import Path
import hashlib,importlib.util,json,os,re,shutil,stat,sys,time,secrets
HERE=Path(__file__).resolve().parent
STATE=Path('/run/daemon-fs-finite-once.json')
ROOT=Path('/tmp/daemon-fs-sealed')
CLOSED_ERROR_CODES=frozenset(('ADMISSION_CHANGED', 'ADMISSION_DEADLINE_NO_NODE', 'ADMISSION_IDENTITY_CHANGED', 'ADMISSION_MANAGER_CONTROLS', 'ADMISSION_OOM_EXEMPT', 'ADMISSION_READY', 'ADMISSION_SHORT_WRITE', 'ADMISSION_TIMEOUT_NO_NODE', 'ADMISSION_UNIT_TERMINATED', 'ASSEMBLY_BASE_CUSTODY', 'ASSEMBLY_BINDING', 'ASSEMBLY_CLOSURE_PIN', 'ASSEMBLY_DIAGNOSTIC_PHASE', 'ASSEMBLY_MOUNT_IDENTITY_CHANGED', 'ASSEMBLY_MOUNT_RETAINED', 'ASSEMBLY_RECEIPT_CUSTODY', 'ASSEMBLY_RECEIPT_PUBLIC_BOUND', 'ASSEMBLY_RECEIPT_PUBLIC_CUSTODY', 'ASSEMBLY_RESERVED_BASE_EXISTS', 'ASSEMBLY_RESERVED_BASE_SCHEMA', 'BOOTSTRAP_ACTION', 'BOOTSTRAP_ARGUMENTS', 'BOOTSTRAP_COMPONENT_FILE', 'BOOTSTRAP_COMPONENT_ROOT', 'BOOTSTRAP_EVENT_SCOPE', 'BOOTSTRAP_EVENT_VALUES', 'BOOTSTRAP_FIRST_HOSTED', 'BOOTSTRAP_NATIVE_PIN', 'BOOTSTRAP_NO_SECOND_VM_ATTEMPT', 'BOOTSTRAP_OCI_COPY_PIN', 'BOOTSTRAP_OCI_LAYER_PIN', 'BOOTSTRAP_OCI_MANIFEST', 'BOOTSTRAP_PATH', 'BOOTSTRAP_PAYLOAD_PIN', 'BOOTSTRAP_ROOT_PIN', 'BOOTSTRAP_SOURCE', 'CAPTURE_CODE', 'CAPTURE_FAILURE', 'CAPTURE_GROUP_ID', 'CAPTURE_LOG_BOUND', 'CAPTURE_SCHEMA', 'CAPTURE_TERMINAL', 'CAPTURE_UNCERTAINTY', 'CG_ANCHOR_CLOSED', 'CG_CHILD_COUNTER_STATE', 'CG_CHILD_OOM_EVENT', 'CG_COMPONENT', 'CG_CONTROL_BOUND', 'CG_CONTROL_FILE', 'CG_COUNTER_SCHEMA', 'CG_CROSS_MOUNT', 'CG_DISAPPEARED_DURING_LIVE_PROOF', 'CG_DOMAIN', 'CG_EXACT_MANAGER_PATH', 'CG_FD_MOUNT_ID', 'CG_FINAL_OOM_MISSING', 'CG_HELD_IDENTITY_CHANGED', 'CG_INITIAL_OOM_UNVERIFIED', 'CG_INVOCATION', 'CG_KERNEL_CONTROLS', 'CG_MANAGER_NOT_TERMINAL', 'CG_MANAGER_PATH_CHANGED', 'CG_MEMORY_LOCAL_EVENTS', 'CG_MOUNT_CHANGED', 'CG_MOUNT_ENTRY', 'CG_MOUNT_NAMESPACE_CHANGED', 'CG_NOT_ACQUIRED_LIVE', 'CG_OOM_BEFORE_EMPTY_PROOF', 'CG_PARENT_COUNTER_FIELDS', 'CG_PARENT_COUNTER_RANGE', 'CG_PARENT_COUNTER_RESET_OR_MISSING', 'CG_PARENT_REPLACED', 'CG_POPULATED', 'CG_REAPPEARED', 'CG_REPLACED', 'CG_REPOPULATED', 'CG_ROOT_REPLACED', 'CG_SUBTREE_BOUND', 'CG_SUBTREE_MOUNT', 'CG_SUBTREE_SYMLINK', 'CG_TERMINAL_UNIT_IDENTITY', 'CG_UNIFIED_MOUNT', 'CG_UNIT_NAME', 'CG_WRAPPER_MEMBERSHIP', 'CG_WRAPPER_NOT_LISTED', 'CG_WRAPPER_PID', 'CG_WRITERS_PRESENT', 'CLEANUP_CUSTODY_CHANGED', 'CLEANUP_UNIT_SOURCE_CHANGED', 'CLEAN_SOURCE_ARCHIVE_PIN', 'CLEAN_SOURCE_BYTES', 'CLEAN_SOURCE_HASH', 'CLEAN_SOURCE_MANIFEST_PIN', 'CLEAN_SOURCE_METADATA', 'CLEAN_SOURCE_PATH', 'CLEAN_SOURCE_SET', 'CLEAN_SOURCE_TYPE', 'COMMAND_REPLY_BOUND', 'CONTEXT_EXPECTED_EXISTS', 'CONTEXT_EXPECTED_HASH_SCHEMA', 'CONTEXT_SNAPSHOT_BOUND', 'CONTEXT_SNAPSHOT_CHANGED', 'CONTEXT_SNAPSHOT_CUSTODY', 'CONTEXT_SNAPSHOT_EVENT_BINDING', 'CONTEXT_SNAPSHOT_HASH_MISMATCH', 'CONTEXT_SNAPSHOT_HOSTED_BINDING', 'CONTEXT_SNAPSHOT_MODE', 'CONTEXT_SNAPSHOT_SCHEMA', 'CONTEXT_SNAPSHOT_SHORT_WRITE', 'CONTEXT_SNAPSHOT_STALE_OR_FUTURE', 'CONTEXT_UNPRIVILEGED_PHASE', 'DISPOSABLE_ROOT_REQUIRED', 'ENVELOPE_ADMISSION', 'ENVELOPE_ADMISSION_IDENTITY', 'ENVELOPE_CHILD_COUNTER_BINDING', 'ENVELOPE_CHILD_DESTROYED', 'ENVELOPE_CHILD_OBSERVED', 'ENVELOPE_CONTEXT_SCHEMA', 'ENVELOPE_CONTEXT_STATE', 'ENVELOPE_DESTROYED_PROOF', 'ENVELOPE_EMPTY_PROOF', 'ENVELOPE_MANAGER_TERMINAL', 'ENVELOPE_OOM_BINDING', 'ENVELOPE_OOM_COUNTERS', 'ENVELOPE_OOM_KIND', 'ENVELOPE_PREPARATION_CONTROLS', 'ENVELOPE_PROOFS_SCHEMA', 'ENVELOPE_RESULT_SCOPE', 'ENVELOPE_SAME_RUN_JOB_EVENT', 'ENVELOPE_STABLE_PROOF', 'ENVELOPE_TERMINAL_IDENTITY', 'ENVELOPE_UNCERTAINTY', 'EVIDENCE_BOUND', 'EVIDENCE_TYPE', 'EXEC_ATTEMPT_RECEIPT', 'EXPORT_ALREADY_EXISTS', 'EXPORT_SOURCE_TYPE', 'EXPORT_TOTAL_BOUND', 'EXPORT_TYPE', 'FINAL_CLEANUP_CUSTODY_CHANGED', 'GATE_BOUNDING_CAPABILITY', 'GATE_CAPABILITIES', 'GATE_CAPGET', 'GATE_DEDICATED_IDENTITY', 'GATE_EXPECTED_FAMILY_FILTER_ERRNO', 'GATE_FORBIDDEN_SOCKET_FAMILY', 'GATE_LATE_OR_LARGE_PERMISSION', 'GATE_NO_NEW_PRIVILEGES', 'GATE_PERMISSION_BINDING', 'GATE_PERMISSION_TIMEOUT', 'GATE_PROBE_DEADLINE', 'GATE_SHORT_WRITE', 'HANDOFF_ACTUAL_SOURCE_PINS', 'HANDOFF_CLOSURE_EXACT_PIN', 'HANDOFF_CLOSURE_HASH', 'HANDOFF_EFFECTIVE_OCI_BINDING', 'HANDOFF_FINAL_LEDGER_HASH', 'HANDOFF_LEDGER_NOT_FINAL', 'HANDOFF_PREPARATION_NOT_TERMINAL_CLEAN', 'HANDOFF_SOURCE_ARCHIVE', 'HANDOFF_SOURCE_NOT_READONLY_TMPFS', 'HANDOFF_SOURCE_RO_RECEIPT', 'HOSTED_API_REPLY_BOUND', 'HOSTED_EXPECTED_SCHEMA', 'HOSTED_JOB_LIST_BOUND', 'HOSTED_JOB_LIST_IDENTITY', 'HOSTED_JOB_LIST_MISMATCH', 'HOSTED_RUN_BINDING', 'HOST_ADMISSION_DEADLINE', 'HOST_COMMAND_FAILED', 'HOST_DEADLINE', 'HOST_DEADLINE_EXPIRED', 'HOST_ENDPOINT_REACHABLE', 'HOST_FORWARDING_DISABLED_NO_AUTOMATIC_SYSCTL_CHANGE', 'HOST_LATE_PERMISSION_PUBLICATION', 'HOST_NO_REMAINING_BUDGET', 'HOST_READ_DEADLINE', 'INVALID_HOST_PERMIT', 'ISOLATION_NEEDS_DISPOSABLE_ROOT', 'LATE_NPM_EXEC', 'LATE_NPM_PERMISSION', 'LATE_NPM_PERMIT', 'LATE_PROBE_PERMISSION', 'LAUNCH_ARGUMENTS', 'LAUNCH_CODE_CUSTODY', 'LAUNCH_HOSTED_FIRST_ATTEMPT', 'LAUNCH_ORDER_OFFLINE', 'LAUNCH_ORDER_OFFLINE_ASSEMBLY', 'LAUNCH_ORDER_PREPARE', 'LAUNCH_PATH', 'LAUNCH_PIN', 'LAUNCH_REVIEW_ROOT', 'LAUNCH_ROOT_CUSTODY', 'LAUNCH_ROOT_SEALED_LOCATION', 'LAUNCH_SAME_JOB_BINDING', 'LAUNCH_SAME_JOB_ID', 'LAUNCH_STAGE', 'LAUNCH_STATE_CUSTODY', 'LAUNCH_STATE_ROOT', 'LAUNCH_STATE_SHORT', 'MANAGER_ADMISSION', 'NATIVE_COUNT', 'NATIVE_MISSING', 'NATIVE_ORIGINAL_ZIP_PIN', 'NATIVE_PUBLIC_ARTIFACT_UNAVAILABLE', 'NATIVE_REDIRECT_NOT_HTTPS', 'NATIVE_ZIP_FILE_PIN', 'NATIVE_ZIP_METADATA', 'NATIVE_ZIP_PATH_COUNT', 'NETWORK_PROOF_BINDING', 'NET_CLEANUP_FOREIGN_NAMESPACE_LINK', 'NET_CLEANUP_FOREIGN_NAMESPACE_TABLE', 'NET_CLEANUP_NAMESPACE_IDENTITY_NOT_ACQUIRED', 'NET_CLEANUP_NAMESPACE_REPLACED', 'NET_CLEANUP_NAMESPACE_TABLE_CHANGED_BEFORE_DELETE', 'NET_CLEANUP_NAMESPACE_TABLE_IDENTITY_NOT_ACQUIRED_OR_CHANGED', 'NET_CLEANUP_TABLE_IDENTITY_NOT_ACQUIRED_OR_CHANGED', 'NET_CLEANUP_TABLE_REPLACED', 'NET_CLEANUP_UNKNOWN', 'NET_CLEANUP_VETH_CHANGED_BEFORE_DELETE', 'NET_CLEANUP_VETH_IDENTITIES_NOT_ACQUIRED_OR_CHANGED', 'NET_CLEANUP_VETH_REPLACED', 'NET_CLEANUP_VETH_RETAINED_BEFORE_NAMESPACE_DELETE', 'NET_COMMAND_FAILED', 'NET_COUNTER_NOT_FRESH', 'NET_COUNTER_SET', 'NET_CREATED_VETH_PAIR', 'NET_CREATION_ALREADY_ATTEMPTED', 'NET_CREATION_MUTATION_NOT_ACKNOWLEDGED', 'NET_CREATION_NOT_ACKNOWLEDGED', 'NET_DEADLINE', 'NET_DENIED_ENDPOINT_REACHED', 'NET_DNS_RESULT_BOUND', 'NET_ENFORCEMENT_COUNTER_DELTA', 'NET_FAILURE_JOURNAL_BOUND', 'NET_FINAL_VETH_PAIR_CHANGED', 'NET_FINITE_IP_BOUND', 'NET_FOREIGN_NAMESPACE_LINK', 'NET_FORWARDING_CHANGED', 'NET_HOSTNAME_SET', 'NET_HOST_ADDRESSES_CHANGED', 'NET_HOST_FORWARDING_DISABLED_NO_GLOBAL_SYSCTL_CHANGE', 'NET_HOST_IP_FORBIDDEN', 'NET_HOST_TABLE_HANDLE', 'NET_HOST_TABLE_REPLACED', 'NET_HOST_TABLE_RETAINED', 'NET_INTERRUPTED_PENDING_CUSTODY', 'NET_JSON_DIAGNOSTIC_BOUND', 'NET_JSON_EVIDENCE_PER_READ_BOUND', 'NET_JSON_EVIDENCE_TOTAL_BOUND', 'NET_JSON_OPERATION_CLOSED', 'NET_LEDGER_SHORT', 'NET_LISTENER_LOST', 'NET_MOVED_VETH_PAIR', 'NET_MUTATION_WITHOUT_RESERVATION', 'NET_NAMESPACE_REPLACED', 'NET_NAMESPACE_RETAINED', 'NET_NAMESPACE_SYMLINK', 'NET_NAMESPACE_TABLE_REPLACED', 'NET_NETNS_CLI_DIRECTORY_MISMATCH', 'NET_NETNS_DIRECTORY_ALIAS', 'NET_NETNS_DIRECTORY_BOUND', 'NET_NETNS_DIRECTORY_CUSTODY', 'NET_NETNS_DIRECTORY_RACE', 'NET_NETNS_EMPTY_WITH_DIRECTORY', 'NET_NETNS_ENTRY_NAME', 'NET_NETNS_ENTRY_SYMLINK', 'NET_NETNS_JSON_SCHEMA', 'NET_NETNS_JSON_WITH_ABSENT_DIRECTORY', 'NET_NETNS_PARENT_CHANGED', 'NET_NETNS_PARENT_CUSTODY', 'NET_NETNS_PREFLIGHT_CHANGED_BEFORE_RESERVATION', 'NET_NONPUBLIC_IP', 'NET_OWNED_IDENTIFIER_COLLISION', 'NET_OWN_PREFIX_COLLISION', 'NET_POLICY_IP_COUNT', 'NET_PROBE_DEADLINE', 'NET_PROBE_RESULT', 'NET_RECOVERY_IDENTIFIERS', 'NET_RECOVERY_LEDGER_CUSTODY', 'NET_RECOVERY_TAG', 'NET_REPLY_BOUND', 'NET_ROOT_REQUIRED', 'NET_RULESET_OR_TOPOLOGY_CHANGED_DURING_PROBE', 'NET_SNAPSHOT_VETH_PAIR_CHANGED', 'NET_SPECIAL_OR_PLATFORM_IP', 'NET_TABLE_HANDLE_SCHEMA', 'NET_VETH_ENDPOINT_IDENTITIES_DISTINCT', 'NET_VETH_HOST_NAMESPACE_CHANGED', 'NET_VETH_LINK_LIST_SCHEMA', 'NET_VETH_LOCAL_REFERENCES_NOT_RECIPROCAL', 'NET_VETH_NETNS_MAP_SCHEMA', 'NET_VETH_PAIR_INCOMPLETE', 'NET_VETH_PAIR_NOT_RECIPROCAL', 'NET_VETH_PAIR_SCHEMA', 'NET_VETH_REMOTE_NAMESPACE_UNPROVED', 'NET_VETH_REMOTE_REFERENCE_SCHEMA', 'NET_VETH_REMOTE_SOURCE_IDENTITY_CHANGED', 'NET_VETH_RETAINED', 'NO_ACQUIRED_ANCHOR', 'NO_ANCHOR_FOR_CLEANUP', 'NO_DEDICATED_UID', 'NO_SECOND_ATTEMPT_AFTER_UNKNOWN', 'NO_SECOND_ATTEMPT_SAME_VM', 'OCI_ALIAS_COLLISION', 'OCI_COMPONENT', 'OCI_COMPRESSED_PIN', 'OCI_COUNTS', 'OCI_DESCRIPTOR_PIN', 'OCI_DEST_EXISTS', 'OCI_DIFF_ID_PIN', 'OCI_DIRECTORY_ALIAS', 'OCI_ENTRY_METADATA', 'OCI_EXACT_DERIVED_OVERLAYS', 'OCI_EXPANSION_BOUND', 'OCI_FILES_MISSING', 'OCI_FILE_OVERFLOW', 'OCI_FILE_PIN', 'OCI_FINAL_ENTRY_TYPE', 'OCI_FINAL_FILE', 'OCI_FINAL_HARDLINK', 'OCI_FINAL_MODE', 'OCI_FINAL_PATH_SET', 'OCI_FINAL_SYMLINK', 'OCI_FINAL_UID_GID', 'OCI_LAYER_CUSTODY', 'OCI_LAYER_DIRECTORY_CUSTODY', 'OCI_LAYER_DUPLICATE', 'OCI_LAYER_REDIRECT_HTTPS', 'OCI_LAYER_UNAVAILABLE', 'OCI_LINK_COLLISION', 'OCI_LINK_ESCAPE', 'OCI_LINK_LOOP', 'OCI_LINK_PIN', 'OCI_PATH', 'OCI_PREPARATION_FREE_DISK_12GIB', 'OCI_ROOT_ENTRY_PIN', 'OCI_ROOT_HEADER_METADATA', 'OCI_ROOT_HEADER_MISSING', 'OCI_ROOT_HEADER_TYPE', 'OCI_ROOT_REQUIRED', 'OCI_SPECIAL_FORBIDDEN', 'OCI_STAGE_EXISTS', 'OCI_UNEXPECTED_WHITEOUT', 'OCI_UNEXPECTED_XATTR', 'OFFLINE_ASSEMBLY_CUSTODY', 'OFFLINE_ASSEMBLY_PATH', 'OFFLINE_ASSEMBLY_ROOT_BINDING', 'OFFLINE_PRESPAWN_NATIVE_PIN', 'OFFLINE_PRESPAWN_SOURCE_PIN', 'OFFLINE_UNKNOWN_OR_FAILED', 'ONLINE_ISOLATION_TOOLCHAIN_SOURCE_PRODUCER_NOT_IMPLEMENTED', 'OOM_ADJUST_CHANGED', 'OOM_EVIDENCE_CONTAMINATED', 'OUTPUT_OVERFLOW', 'PACKAGE_COUNT', 'PACKAGE_HASH', 'PACKAGE_PATH', 'PACKAGE_SYMLINK', 'PERMIT_OVERSIZE', 'PERMIT_SHORT_WRITE', 'PREPARATION_ENVELOPE_PIN', 'PREPARATION_LOG_OVERFLOW', 'PREPARATION_NOT_NATURAL_SUCCESS', 'PREPARATION_RECEIPT_PIN', 'PREPARATION_UNIT_FAILED', 'PREPARATION_UNKNOWN_OR_FAILED', 'PROBE_BINDING', 'PROBE_FIXED_PEER', 'PROBE_TLS_SOCKET', 'PRODUCER_CLEANUP_CUSTODY', 'PRODUCER_COMMAND_FAILED', 'PRODUCER_DIRECTORY_CUSTODY', 'PRODUCER_ENFORCEMENT_PROOF', 'PRODUCER_HANDOFF_BYTES', 'PRODUCER_HOST_NAMESPACE_EVIDENCE', 'PRODUCER_NETWORK_CLOSURE', 'PRODUCER_OCI_BINDING', 'PRODUCER_PACKAGE_CUSTODY', 'PRODUCER_PATH', 'PRODUCER_PAYLOAD_PIN', 'PRODUCER_REAL_COUNTERS', 'PRODUCER_REPLY_BOUND', 'PRODUCER_REVIEW_ROOT', 'PRODUCER_ROOT_BINDING', 'PRODUCER_ROOT_HANDOFF_PIN', 'PRODUCER_SOCKET_FILTER_EVIDENCE', 'PRODUCER_TLS_DENIAL_RESULT', 'PRODUCER_TYPES_CLOSURE', 'PUBLIC_DOWNLOAD_BOUND', 'PUBLIC_DOWNLOAD_PIN', 'PUBLIC_INPUT_ALREADY_EXISTS', 'PUBLIC_TLS_PROBE_FAILED', 'READY_IDENTITY', 'READY_PRIVILEGES', 'REAL_NETNS_BINDING', 'RECEIPT_NOT_REGULAR', 'RECEIPT_SHORT', 'RECEIPT_SIZE', 'RECOVERY_ADMISSION_BINDING', 'RECOVERY_BASE_CUSTODY', 'RECOVERY_CLOSEOUT_CUSTODY', 'RECOVERY_INVOCATION_CHANGED_AFTER_STOP', 'RECOVERY_NO_ACQUIRED_UNIT_IDENTITY', 'RECOVERY_REVIEW_BINDING', 'RECOVERY_UNIT_IDENTITY', 'RECOVERY_UNIT_REPLACED', 'RECOVERY_UNIT_SOURCE_CUSTODY', 'ROOT_EXTRA_FILES', 'ROOT_MANIFEST_PIN', 'ROOT_STAGE_UID', 'ROOT_SYMLINK', 'RUNTIME_FAILED', 'RUNTIME_MARKER', 'RUNTIME_METADATA', 'RUNTIME_WALL_TIMEOUT', 'SEAL_CONTEXT_ONCE', 'SEAL_CONTEXT_PHASE', 'SEAL_CONTEXT_SOURCE', 'SERVICE_PATH', 'SERVICE_TEMPLATE', 'SOURCE_ARCHIVE_CUSTODY', 'SOURCE_DIRECTORY_CUSTODY', 'STANDARD_HOSTED_JOB_REQUIRED', 'STANDARD_HOSTED_VM_BINDING', 'SYSTEMD_HOST_REQUIRED', 'TAP_EXACT_ELEVEN_NAMES', 'TAP_FAILED', 'TAP_SUMMARY', 'TERMINAL_NOT_NATURAL_SUCCESS', 'TEST_SOURCE_PIN', 'TRANSPORT_ARGUMENT', 'TYPECHECK_ALREADY_EXISTS', 'TYPECHECK_CAPTURE_HELPER_PIN', 'TYPECHECK_COMPILER_PIN', 'TYPECHECK_DEPENDENCY_INSTALL_FAILED', 'TYPECHECK_DEPENDENCY_VERSION_MISMATCH', 'TYPECHECK_EXPECTED_DEPENDENCY_VERSIONS', 'TYPECHECK_FINAL_LOCK_CHANGED', 'TYPECHECK_IMAGE_TOOLCHAIN_PIN', 'TYPECHECK_LOCK_MUTATED', 'TYPECHECK_LOCK_PIN', 'TYPECHECK_RECEIPT_SHORT', 'TYPECHECK_REPOSITORY_TYPES_FAILED', 'TYPECHECK_SOURCE_PIN', 'TYPECHECK_SOURCE_SET', 'TYPES_CLOSURE_BINDING', 'TYPES_COMPILER', 'TYPES_ISOLATION_CONTRACT_MISSING', 'TYPES_LOCK', 'TYPES_PASS', 'TYPES_SCOPE', 'TYPES_SOURCE', 'TYPES_STATE', 'UID_BECAME_ASSIGNED', 'UID_HOST_PROCESS_COLLISION', 'UNBOUNDED_DESCRIPTOR_LIMIT', 'UNCLASSIFIED_CLOSED_CODE', 'UNIT_CLEANUP_SOURCE_CHANGED', 'UNIT_DIED_BEFORE_PERMISSION', 'UNIT_TEMPLATE', 'UNIT_VALUE'))
CLOSED_ERROR_CLASSES=frozenset(('RuntimeError','JSONDecodeError','OSError','FileNotFoundError','FileExistsError','PermissionError','TimeoutError','TimeoutExpired','CalledProcessError','ValueError','KeyError','TypeError','AssertionError','MemoryError','KeyboardInterrupt','SystemExit'))
def public_failure(error):
 def scalar(item):
  cls=type(item).__name__;code=item.args[0] if type(item) is RuntimeError and len(item.args)==1 and type(item.args[0]) is str else None
  value={'failureClass':cls if cls in CLOSED_ERROR_CLASSES else 'OTHER_EXCEPTION','failureCode':code if code in CLOSED_ERROR_CODES else 'UNCLASSIFIED_CLOSED_CODE'}
  if isinstance(item,json.JSONDecodeError):value.update(errorOffset=item.pos,errorLine=item.lineno,errorColumn=item.colno)
  return value
 value=scalar(error);chain=[];seen={id(error)};current=error
 for _ in range(4):
  cause=current.__cause__;context=current.__context__;following=cause if cause is not None else context
  if following is None:break
  if id(following) in seen:value['exceptionChainTruncated']=True;break
  seen.add(id(following));chain.append({'relation':'CAUSE' if cause is not None else 'CONTEXT',**scalar(following)});current=following
 else:
  if current.__cause__ is not None or current.__context__ is not None:value['exceptionChainTruncated']=True
 if chain:value['exceptionChain']=chain
 return value
def need(x,c):
 if not x:raise RuntimeError(c)
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def durable(path,v):
 raw=(json.dumps(v,sort_keys=True,indent=2)+'\n').encode();tmp=path.with_suffix('.pending');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:need(os.write(fd,raw)==len(raw),'LAUNCH_STATE_SHORT');os.fsync(fd)
 finally:os.close(fd)
 os.replace(tmp,path);d=os.open(path.parent,os.O_DIRECTORY)
 try:os.fsync(d)
 finally:os.close(d)
def verify(reviewroot):
 need(sha(HERE/'SHA256.json')==reviewroot,'LAUNCH_REVIEW_ROOT')
 rows=json.loads((HERE/'SHA256.json').read_text())
 for name,digest in rows.items():
  rel=Path(name);need(not rel.is_absolute() and '..' not in rel.parts,'LAUNCH_PATH');p=HERE/rel;need(p.is_file() and not p.is_symlink() and sha(p)==digest,'LAUNCH_PIN')
 return rows
def load(relative):
 spec=importlib.util.spec_from_file_location(relative.replace('/','_').replace('.','_'),HERE/relative);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def same_job(st,current):
 for k in ('runId','runAttempt','runnerName','runnerEnvironment','eventHead'):need(st['event'][k]==current[k],'LAUNCH_SAME_JOB_BINDING')
 if 'jobId' in st:need(st['jobId']==current['jobId'],'LAUNCH_SAME_JOB_ID')
def root_stage(stage,reviewroot,argument=None):
 rows=verify(reviewroot);need(os.geteuid()==0 and HERE==ROOT,'LAUNCH_ROOT_SEALED_LOCATION');need(HERE.stat().st_uid==0 and not HERE.stat().st_mode&0o022,'LAUNCH_ROOT_CUSTODY')
 for name in rows:
  st=(HERE/name).lstat();need(st.st_uid==0 and st.st_nlink==1 and not st.st_mode&0o022,'LAUNCH_CODE_CUSTODY')
 pins=json.loads((HERE/'COMPONENT-PINS.json').read_text());producer_root=pins['producerRootSha256'];offline_root=pins['offlineRootSha256']
 if stage=='assemble':
  need(not STATE.exists(),'NO_SECOND_ATTEMPT_SAME_VM');event=json.loads((HERE/'event.json').read_text());need(event['runAttempt']==1 and event['runnerEnvironment']=='github-hosted','LAUNCH_HOSTED_FIRST_ATTEMPT')
  reserved_base=Path('/tmp')/('daemon-oci-prep-'+secrets.token_hex(8));state={'state':'ASSEMBLY_ATTEMPTED','phase':'ASSEMBLY_ENTRY_PENDING','assemblyReservedBase':str(reserved_base),'assemblyReceiptReserved':str(reserved_base/'assembly-closeout.json'),'event':event,'reviewRootSha256':reviewroot,'secondAttemptForbidden':True,'vmTeardownProved':False,'retainedResourcesPossible':True};durable(STATE,state)
 else:
  need(STATE.is_file() and STATE.stat().st_uid==0 and stat.S_IMODE(STATE.stat().st_mode)==0o600,'LAUNCH_STATE_CUSTODY');state=json.loads(STATE.read_text());need(state['reviewRootSha256']==reviewroot,'LAUNCH_STATE_ROOT');need(stage=='export' or state['state']!='UNKNOWN_TEARDOWN_REQUIRED','NO_SECOND_ATTEMPT_AFTER_UNKNOWN')
 try:
  if stage!='export':state['phase']={'assemble':'ASSEMBLY_ENTRY_PENDING','prepare':'PREPARATION_ENTRY_PENDING','offline-assemble':'OFFLINE_ASSEMBLY_ENTRY_PENDING','offline':'OFFLINE_ENTRY_PENDING','export':'EXPORT_ENTRY_PENDING'}.get(stage,'UNKNOWN_STAGE');durable(STATE,state)
  if stage=='assemble':
   result=load('producer/producer.INACTIVE.py').assemble(HERE/'inputs/layers',HERE/'source.tar.gz',producer_root,state['assemblyReservedBase']);state.update(state='ASSEMBLED',assembly=result)
  elif stage=='prepare':
   need(state['state']=='ASSEMBLED','LAUNCH_ORDER_PREPARE');expected=json.loads((HERE/'prepare-context.expected.json').read_text());same_job(state,expected);state['jobId']=expected['jobId'];state['state']='PREPARATION_ATTEMPTED';durable(STATE,state)
   value=load('producer/producer.INACTIVE.py').prepare(state['assembly']['assemblyReceipt'],state['assembly']['assemblyReceiptSha256'],producer_root,HERE/'prepare-context.json',expected);state['preparation']=value;need(value['result']['state']=='PREPARED_FULLTYPES_ONLY','PREPARATION_UNKNOWN_OR_FAILED');state['state']='PREPARED'
  elif stage=='offline-assemble':
   need(state['state']=='PREPARED','LAUNCH_ORDER_OFFLINE_ASSEMBLY');state['state']='OFFLINE_ASSEMBLY_ATTEMPTED';durable(STATE,state);prep=state['preparation'];envelope=Path(prep['receipt']);result=load('offline/isolated-controller.INACTIVE.py').assemble_offline(HERE/'inputs/native-original.zip',envelope,sha(envelope),offline_root,HERE/'producer',producer_root);state.update(state='OFFLINE_ASSEMBLED',offlineAssembly=result)
  elif stage=='offline':
   need(state['state']=='OFFLINE_ASSEMBLED','LAUNCH_ORDER_OFFLINE');expected=json.loads((HERE/'offline-context.expected.json').read_text());same_job(state,expected);state['state']='OFFLINE_ATTEMPTED';durable(STATE,state)
   value=load('offline/isolated-controller.INACTIVE.py').run(state['offlineAssembly']['receipt'],state['offlineAssembly']['sha256'],offline_root,HERE/'offline-context.json',expected);state['offline']=value;need(value['result']['state']=='PASS_FS_HELPER_OWNER_11_ONLY','OFFLINE_UNKNOWN_OR_FAILED');state['state']='PASS_FULLTYPES_AND_FS11_ONLY';state['retainedResourcesPossible']=True
  elif stage=='export':
   return export_selected(state)
  else:raise RuntimeError('LAUNCH_STAGE')
  durable(STATE,state);return state
 except BaseException as error:
  state.update(state='UNKNOWN_TEARDOWN_REQUIRED',retainedResourcesPossible=True,vmTeardownProved=False,**public_failure(error));state['stageFailure']=public_failure(error)
  nested=state.get('preparation',{}).get('result',{}) if stage=='prepare' else state.get('offline',{}).get('result',{}) if stage=='offline' else {}
  state['primaryFailure']=nested.get('primaryFailure') or getattr(error,'daemonFailureEvidence',{}).get('primary') or public_failure(error)
  if hasattr(error,'daemonFailureEvidence'):state['failurePersistenceEvidence']=error.daemonFailureEvidence
  try:durable(STATE,state)
  except BaseException as persistence_error:error.daemonFailureEvidence={'primary':state['primaryFailure'],'launcherPersistence':public_failure(persistence_error)}
  raise

ASSEMBLY_PHASES=frozenset(('BEFORE_PREREQUISITES','BEFORE_FORWARDING_READ','BEFORE_ENDPOINT_DISCOVERY','BEFORE_UID_SELECTION','BEFORE_WORK_DIRECTORY','BEFORE_VALIDATION_DIRECTORY','BEFORE_OCI_RECONSTRUCTION','BEFORE_HOST_METADATA','BEFORE_PUBLIC_OVERLAYS','BEFORE_WORK_TMPFS','BEFORE_SOURCE_EXTRACTION','BEFORE_VALIDATION_COPY','BEFORE_CLOSURE_WRITE','ASSEMBLY_COMPLETE'))
LAUNCH_PHASES=frozenset(('ASSEMBLY_ENTRY_PENDING','PREPARATION_ENTRY_PENDING','OFFLINE_ASSEMBLY_ENTRY_PENDING','OFFLINE_ENTRY_PENDING','EXPORT_ENTRY_PENDING','UNKNOWN_STAGE'))
def assembly_public_projection(state):
 # Closed scalar projection, never raw source/receipt/argv/path or exception text.
 result={'kind':'PUBLIC_ASSEMBLY_DIAGNOSTIC_V2','receiptStatus':'NOT_RESERVED','productExecuted':False,'vmTeardownProved':False,'retainedResourcesPossible':True}
 locator=state.get('assemblyReceiptReserved');base=state.get('assemblyReservedBase')
 if not locator or not base:return result
 if not isinstance(base,str) or re.fullmatch('/tmp/daemon-oci-prep-[a-f0-9]{16}',base) is None or locator!=base+'/assembly-closeout.json':result['receiptStatus']='LOCATOR_INVALID';return result
 path=Path(locator)
 try:
  parent=Path(base).lstat();need(stat.S_ISDIR(parent.st_mode) and parent.st_uid==0 and stat.S_IMODE(parent.st_mode)==0o700,'ASSEMBLY_RECEIPT_PUBLIC_CUSTODY')
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:
   st=os.fstat(fd);need(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600,'ASSEMBLY_RECEIPT_PUBLIC_CUSTODY');raw=os.read(fd,1048577);need(len(raw)<=1048576 and len(raw)==st.st_size,'ASSEMBLY_RECEIPT_PUBLIC_BOUND');after=os.fstat(fd);need((st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'ASSEMBLY_RECEIPT_PUBLIC_CUSTODY')
  finally:os.close(fd)
  value=json.loads(raw);result['receiptStatus']='OBSERVED';result['receiptSha256']=hashlib.sha256(raw).hexdigest();result['receiptBytes']=len(raw)
  result['phase']=value.get('phase') if value.get('phase') in ASSEMBLY_PHASES else 'UNCLASSIFIED_PHASE'
  result['state']=value.get('state') if value.get('state') in ('ASSEMBLY_ATTEMPTED','ASSEMBLY_FAILED','ASSEMBLED_PUBLIC_SOURCE_TOOLCHAIN_ONLY') else 'UNKNOWN'
  result['failureClass']=value.get('failureClass') if value.get('failureClass') in CLOSED_ERROR_CLASSES else 'OTHER_EXCEPTION'
  result['failureCode']=value.get('failureCode') if value.get('failureCode') in CLOSED_ERROR_CODES else 'UNCLASSIFIED_CLOSED_CODE'
  result['cleanupUnknown']=value.get('cleanupUnknown') is not False
  ledger=value.get('mountLedger',{});result['workMountAttemptRecorded']=bool(ledger);result['workMountAcknowledged']=ledger.get('state')=='COMMAND_ACKNOWLEDGED';result['workMountRemovalVerified']=ledger.get('cleanupState')=='REMOVAL_VERIFIED'
  for key in ('reviewRootSha256','preparationClosureSha256','sourceArchiveSha256'):
   val=value.get(key)
   if isinstance(val,str) and re.fullmatch('[a-f0-9]{64}',val):result[key]=val
 except FileNotFoundError:result['receiptStatus']='MISSING_BEFORE_FIRST_RECEIPT_OR_CUSTODY_LOSS'
 except BaseException as error:result.update(receiptStatus='UNREADABLE_UNKNOWN',**public_failure(error))
 return result

def technical_evidence_bytes(name,raw,partial):
 # Retain oracle-bearing structure and fixture identities in the SAME artifact.
 # Only these two host-version strings are superfluous. No recursive redaction.
 if partial or not name.endswith('.json'):return raw,[]
 try:value=json.loads(raw)
 except (ValueError,UnicodeDecodeError):return raw,[]
 if not isinstance(value,dict):return raw,[]
 removed=[]
 for key in ('hostKernel','hostSystemdVersion'):
  if key in value:removed.append(key);del value[key]
 if not removed:return raw,[]
 return (json.dumps(value,sort_keys=True,indent=2)+'\n').encode(),removed

def classified_failure_projection(value):
 # Fixed shallow schema. Never pass arbitrary saved state or exception payload.
 if not isinstance(value,dict):return None
 result={'failureClass':value.get('failureClass') if value.get('failureClass') in CLOSED_ERROR_CLASSES else 'OTHER_EXCEPTION','failureCode':value.get('failureCode') if value.get('failureCode') in CLOSED_ERROR_CODES else 'UNCLASSIFIED_CLOSED_CODE'}
 for key in ('errorOffset','errorLine','errorColumn'):
  if type(value.get(key)) is int and 0<=value[key]<=262144:result[key]=value[key]
 chain=value.get('exceptionChain',[])
 if isinstance(chain,list):
  result['exceptionChain']=[{'relation':row.get('relation') if row.get('relation') in ('CAUSE','CONTEXT') else 'UNKNOWN', 'failureClass':row.get('failureClass') if row.get('failureClass') in CLOSED_ERROR_CLASSES else 'OTHER_EXCEPTION','failureCode':row.get('failureCode') if row.get('failureCode') in CLOSED_ERROR_CODES else 'UNCLASSIFIED_CLOSED_CODE'} for row in chain[:4] if isinstance(row,dict)]
  if len(chain)>4 or value.get('exceptionChainTruncated') is True:result['exceptionChainTruncated']=True
 return result
FAILURE_PHASES=frozenset(('ASSEMBLY_PRIMARY_PERSISTENCE','ASSEMBLY_UNMOUNT','ASSEMBLY_FINAL_PERSISTENCE','PREPARATION_FORCED_STOP','PREPARATION_SELECTED_EXPORT','PREPARATION_OWNED_CLEANUP','PREPARATION_FINAL_LEDGER_EXPORT','PREPARATION_ANCHOR_CLOSE','PREPARATION_FINAL_PERSISTENCE','OFFLINE_FORCED_STOP','OFFLINE_SELECTED_EXPORT','OFFLINE_OWNED_CLEANUP','OFFLINE_ANCHOR_CLOSE','OFFLINE_FINAL_PERSISTENCE'))
def persistence_failure_projection(state):
 value=state.get('failurePersistenceEvidence');result={'availableFromDurableLauncherState':isinstance(value,dict),'notProofFinalReceiptRecovered':True,'launcherStateWriteFailureNotRecoverableHere':True}
 if not isinstance(value,dict):return result
 result['primary']=classified_failure_projection(value.get('primary'))
 for key in ('persistence','launcherPersistence'):
  if key in value:result[key]=classified_failure_projection(value[key])
 rows=value.get('secondary',[])
 if isinstance(rows,list):
  result['secondary']=[{'phase':row.get('phase') if row.get('phase') in FAILURE_PHASES else 'UNKNOWN_PHASE',**{key:item for key,item in classified_failure_projection(row).items() if key in ('failureClass','failureCode','errorOffset','errorLine','errorColumn')}} for row in rows[:16] if isinstance(row,dict)]
  result['secondaryTruncated']=len(rows)>16
 return result
def export_selected(state):
 # May run after UNKNOWN, but never mutates/stops resources or retries stages.
 target=Path('/tmp/daemon-fs-final-selected');need(not target.exists(),'EXPORT_ALREADY_EXISTS');target.mkdir(mode=0o755);count=0;total=0;entries=[];receipt_failures=[]
 names={'types-receipt.json':32768,'types-install.log':1048576,'types-types.log':1048576,'preparation.log':1048576,'network-proof.json':262144,'network-ledger.json':262144,'network-ledger-before-cleanup.json':262144,'preparation-closure.json':32768,'closeout.json':262144,'contracts.log':1048576,'ready.json':1024,'attempted.json':1024}
 for phase,key in (('prepare','preparation'),('offline','offline')):
  value=state.get(key)
  if value:receipt=Path(value['receipt'])
  elif key=='preparation' and state.get('assembly'):receipt=Path(state['assembly']['assemblyReceipt']).parent/'closeout.json'
  elif key=='offline' and state.get('offlineAssembly'):receipt=Path(state['offlineAssembly']['receipt']).parent/'closeout.json'
  else:continue
  directory=receipt.parent/'selected'
  if not directory.is_dir():continue
  upstream=value.get('result',{}) if isinstance(value,dict) else {}
  if not upstream:
   try:
    fd=os.open(receipt,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
     st=os.fstat(fd);need(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_nlink==1 and st.st_size<=1048576,'ASSEMBLY_RECEIPT_PUBLIC_CUSTODY');upstream=json.loads(os.read(fd,1048577))
    finally:os.close(fd)
   except BaseException as receipt_error:
    # No unknown partial lineage is promoted to complete selected evidence.
    receipt_failures.append({'phase':phase,**public_failure(receipt_error)});continue
  upstream_exports={x.get('file'):x for x in upstream.get('exports',[]) if isinstance(x,dict)}
  dest=target/phase;dest.mkdir(mode=0o755)
  for source in directory.iterdir():
   if source.name not in names:continue
   need(source.is_file() and not source.is_symlink(),'EXPORT_SOURCE_TYPE');limit=names[source.name]
   with source.open('rb') as f:raw=f.read(limit+1)
   partial=len(raw)>limit or upstream_exports.get(source.name,{}).get('partial') is True;original=raw[:limit];technical,removed=technical_evidence_bytes(source.name,original,partial);need(len(technical)<=limit,'EXPORT_TOTAL_BOUND');(dest/source.name).write_bytes(technical);count+=1;total+=len(technical);need(count<=32 and total<=12582912,'EXPORT_TOTAL_BOUND');entries.append({'phase':phase,'file':source.name,'bytes':len(technical),'partial':partial,'sha256':sha(dest/source.name),'originalBytesObserved':len(original),'originalPartial':partial,'upstreamPartial':upstream_exports.get(source.name,{}).get('partial') is True,'originalSha256':hashlib.sha256(original).hexdigest(),'omittedSuperfluousFields':removed,'oracleStructurePreserved':not partial})

 # Scalar projection only, never whole launch/context/token/instructions artifact.
 status={'failureClass':state.get('failureClass') if state.get('failureClass') in CLOSED_ERROR_CLASSES else 'OTHER_EXCEPTION','failureCode':state.get('failureCode') if state.get('failureCode') in CLOSED_ERROR_CODES else 'UNCLASSIFIED_CLOSED_CODE','failurePhase':state.get('phase') if state.get('phase') in LAUNCH_PHASES else 'UNKNOWN_STAGE','state':('PASS_FULLTYPES_AND_FS11_ONLY' if state['state']=='PASS_FULLTYPES_AND_FS11_ONLY' else 'UNKNOWN_TEARDOWN_REQUIRED'),'lastDurableLauncherStage':state['state'],'scope':'FULL_REPOSITORY_TYPES_AND_ELEVEN_FS_HELPER_OWNER_CONTRACTS_ONLY','fullApplicationValidated':False,'allShutdownValidated':False,'daemonIntegrationValidated':False,'vmTeardownProved':False,'retainedResourcesPossible':True,'noSecondAttemptSameVM':True,'selected':entries,'partial':any(x['partial'] for x in entries)}
 status['primaryFailure']=classified_failure_projection(state.get('primaryFailure'));status['stageFailure']=classified_failure_projection(state.get('stageFailure'))
 status['failurePersistenceEvidence']=persistence_failure_projection(state);status['receiptReadFailures']=receipt_failures;status['evidenceUnknown']=bool(receipt_failures) or state.get('state')!='PASS_FULLTYPES_AND_FS11_ONLY'
 diagnostic_bytes=json.dumps({'failurePersistenceEvidence':status['failurePersistenceEvidence'],'receiptReadFailures':receipt_failures},sort_keys=True).encode();need(len(diagnostic_bytes)<=8192,'EXPORT_TOTAL_BOUND')
 diagnostic=assembly_public_projection(state)
 if diagnostic.get('receiptStatus')=='OBSERVED':
  original_path=Path(state['assemblyReceiptReserved']);fd=os.open(original_path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:
   st=os.fstat(fd);need(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600 and st.st_size<=1048576,'ASSEMBLY_RECEIPT_PUBLIC_CUSTODY');original=os.read(fd,1048577);need(len(original)==st.st_size and hashlib.sha256(original).hexdigest()==diagnostic['receiptSha256'],'ASSEMBLY_RECEIPT_PUBLIC_CUSTODY')
  finally:os.close(fd)
  technical,removed=technical_evidence_bytes('assembly-closeout.json',original,False);count+=1;total+=len(technical);need(count<=32 and total<=12582912,'EXPORT_TOTAL_BOUND');target_path=target/'assembly-closeout.json';target_path.write_bytes(technical);entries.append({'phase':'assembly','file':'assembly-closeout.json','bytes':len(technical),'partial':False,'sha256':sha(target_path),'originalBytesObserved':len(original),'originalPartial':False,'originalSha256':hashlib.sha256(original).hexdigest(),'omittedSuperfluousFields':removed,'oracleStructurePreserved':True})
 diagnostic_path=target/'assembly-diagnostic.json';diagnostic_raw=(json.dumps(diagnostic,sort_keys=True,indent=2)+'\n').encode();need(len(diagnostic_raw)<=8192,'EXPORT_TOTAL_BOUND');count+=1;total+=len(diagnostic_raw);need(count<=32 and total<=12582912,'EXPORT_TOTAL_BOUND');diagnostic_path.write_bytes(diagnostic_raw);entries.append({'phase':'assembly','file':'assembly-diagnostic.json','bytes':diagnostic_path.stat().st_size,'partial':False,'sha256':sha(diagnostic_path)});status['diagnosticReceiptStatus']=diagnostic['receiptStatus'];status['assemblyDiagnosticAvailable']=diagnostic['receiptStatus']=='OBSERVED';status['causalCodeAvailable']=diagnostic.get('failureCode','UNCLASSIFIED_CLOSED_CODE')!='UNCLASSIFIED_CLOSED_CODE' or status['failureCode']!='UNCLASSIFIED_CLOSED_CODE'
 if status['partial'] or status['evidenceUnknown']:status['state']='UNKNOWN_TEARDOWN_REQUIRED'
 summary_raw=(json.dumps(status,sort_keys=True,indent=2)+'\n').encode();need(total+len(summary_raw)<=12582912,'EXPORT_TOTAL_BOUND');(target/'summary.json').write_bytes(summary_raw);return status
if __name__=='__main__':
 need(len(sys.argv)==3,'LAUNCH_ARGUMENTS');root_stage(sys.argv[1],sys.argv[2])
