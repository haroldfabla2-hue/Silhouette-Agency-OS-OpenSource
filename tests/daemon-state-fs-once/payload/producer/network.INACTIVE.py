"""INACTIVE standard netns/veth/nft lifecycle for finite public preparation.
No effects on import. No proxy, Docker or packet-filter code in Python.
"""
import hashlib,ipaddress,json,os,re,secrets,socket,stat,subprocess,time
from pathlib import Path
JSON_READ_OPERATIONS=frozenset(('CLEANUP_LINKS', 'CLEANUP_NAMESPACE_TABLES', 'CLEANUP_NFT_TABLES', 'CLEANUP_OWNED_NFT', 'CLEANUP_VERIFY_LINKS', 'CLEANUP_VERIFY_TABLES', 'OWNERSHIP_HOST_LINKS', 'OWNERSHIP_PEER_LINKS', 'OWNERSHIP_TABLE', 'PREFLIGHT_LINKS', 'PREFLIGHT_NAMESPACES', 'PREFLIGHT_NFT_TABLES', 'SETUP_CREATED_LINK_ID', 'SETUP_FINAL_LINK_ID', 'SETUP_HOST_ADDRESSES', 'SETUP_ROUTE_TABLES', 'SNAPSHOT_HOST_LINK', 'SNAPSHOT_HOST_NFT', 'SNAPSHOT_HOST_ROUTES', 'SNAPSHOT_NAMESPACE_NFT', 'SNAPSHOT_NAMESPACE_ROUTES', 'SNAPSHOT_PEER_LINK'))
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}
CLOSED_ERROR_CODES=frozenset(('ADMISSION_CHANGED', 'ADMISSION_DEADLINE_NO_NODE', 'ADMISSION_IDENTITY_CHANGED', 'ADMISSION_MANAGER_CONTROLS', 'ADMISSION_OOM_EXEMPT', 'ADMISSION_READY', 'ADMISSION_SHORT_WRITE', 'ADMISSION_TIMEOUT_NO_NODE', 'ADMISSION_UNIT_TERMINATED', 'ASSEMBLY_BASE_CUSTODY', 'ASSEMBLY_BINDING', 'ASSEMBLY_CLOSURE_PIN', 'ASSEMBLY_DIAGNOSTIC_PHASE', 'ASSEMBLY_MOUNT_IDENTITY_CHANGED', 'ASSEMBLY_MOUNT_RETAINED', 'ASSEMBLY_RECEIPT_CUSTODY', 'ASSEMBLY_RECEIPT_PUBLIC_BOUND', 'ASSEMBLY_RECEIPT_PUBLIC_CUSTODY', 'ASSEMBLY_RESERVED_BASE_EXISTS', 'ASSEMBLY_RESERVED_BASE_SCHEMA', 'BOOTSTRAP_ACTION', 'BOOTSTRAP_ARGUMENTS', 'BOOTSTRAP_COMPONENT_FILE', 'BOOTSTRAP_COMPONENT_ROOT', 'BOOTSTRAP_EVENT_SCOPE', 'BOOTSTRAP_EVENT_VALUES', 'BOOTSTRAP_FIRST_HOSTED', 'BOOTSTRAP_NATIVE_PIN', 'BOOTSTRAP_NO_SECOND_VM_ATTEMPT', 'BOOTSTRAP_OCI_COPY_PIN', 'BOOTSTRAP_OCI_LAYER_PIN', 'BOOTSTRAP_OCI_MANIFEST', 'BOOTSTRAP_PATH', 'BOOTSTRAP_PAYLOAD_PIN', 'BOOTSTRAP_ROOT_PIN', 'BOOTSTRAP_SOURCE', 'CAPTURE_CODE', 'CAPTURE_FAILURE', 'CAPTURE_GROUP_ID', 'CAPTURE_LOG_BOUND', 'CAPTURE_SCHEMA', 'CAPTURE_TERMINAL', 'CAPTURE_UNCERTAINTY', 'CG_ANCHOR_CLOSED', 'CG_CHILD_COUNTER_STATE', 'CG_CHILD_OOM_EVENT', 'CG_COMPONENT', 'CG_CONTROL_BOUND', 'CG_CONTROL_FILE', 'CG_COUNTER_SCHEMA', 'CG_CROSS_MOUNT', 'CG_DISAPPEARED_DURING_LIVE_PROOF', 'CG_DOMAIN', 'CG_EXACT_MANAGER_PATH', 'CG_FD_MOUNT_ID', 'CG_FINAL_OOM_MISSING', 'CG_HELD_IDENTITY_CHANGED', 'CG_INITIAL_OOM_UNVERIFIED', 'CG_INVOCATION', 'CG_KERNEL_CONTROLS', 'CG_MANAGER_NOT_TERMINAL', 'CG_MANAGER_PATH_CHANGED', 'CG_MEMORY_LOCAL_EVENTS', 'CG_MOUNT_CHANGED', 'CG_MOUNT_ENTRY', 'CG_MOUNT_NAMESPACE_CHANGED', 'CG_NOT_ACQUIRED_LIVE', 'CG_OOM_BEFORE_EMPTY_PROOF', 'CG_PARENT_COUNTER_FIELDS', 'CG_PARENT_COUNTER_RANGE', 'CG_PARENT_COUNTER_RESET_OR_MISSING', 'CG_PARENT_REPLACED', 'CG_POPULATED', 'CG_REAPPEARED', 'CG_REPLACED', 'CG_REPOPULATED', 'CG_ROOT_REPLACED', 'CG_SUBTREE_BOUND', 'CG_SUBTREE_MOUNT', 'CG_SUBTREE_SYMLINK', 'CG_TERMINAL_UNIT_IDENTITY', 'CG_UNIFIED_MOUNT', 'CG_UNIT_NAME', 'CG_WRAPPER_MEMBERSHIP', 'CG_WRAPPER_NOT_LISTED', 'CG_WRAPPER_PID', 'CG_WRITERS_PRESENT', 'CLEANUP_CUSTODY_CHANGED', 'CLEANUP_UNIT_SOURCE_CHANGED', 'CLEAN_SOURCE_ARCHIVE_PIN', 'CLEAN_SOURCE_BYTES', 'CLEAN_SOURCE_HASH', 'CLEAN_SOURCE_MANIFEST_PIN', 'CLEAN_SOURCE_METADATA', 'CLEAN_SOURCE_PATH', 'CLEAN_SOURCE_SET', 'CLEAN_SOURCE_TYPE', 'COMMAND_REPLY_BOUND', 'CONTEXT_EXPECTED_EXISTS', 'CONTEXT_EXPECTED_HASH_SCHEMA', 'CONTEXT_SNAPSHOT_BOUND', 'CONTEXT_SNAPSHOT_CHANGED', 'CONTEXT_SNAPSHOT_CUSTODY', 'CONTEXT_SNAPSHOT_EVENT_BINDING', 'CONTEXT_SNAPSHOT_HASH_MISMATCH', 'CONTEXT_SNAPSHOT_HOSTED_BINDING', 'CONTEXT_SNAPSHOT_MODE', 'CONTEXT_SNAPSHOT_SCHEMA', 'CONTEXT_SNAPSHOT_SHORT_WRITE', 'CONTEXT_SNAPSHOT_STALE_OR_FUTURE', 'CONTEXT_UNPRIVILEGED_PHASE', 'DISPOSABLE_ROOT_REQUIRED', 'ENVELOPE_ADMISSION', 'ENVELOPE_ADMISSION_IDENTITY', 'ENVELOPE_CHILD_COUNTER_BINDING', 'ENVELOPE_CHILD_DESTROYED', 'ENVELOPE_CHILD_OBSERVED', 'ENVELOPE_CONTEXT_SCHEMA', 'ENVELOPE_CONTEXT_STATE', 'ENVELOPE_DESTROYED_PROOF', 'ENVELOPE_EMPTY_PROOF', 'ENVELOPE_MANAGER_TERMINAL', 'ENVELOPE_OOM_BINDING', 'ENVELOPE_OOM_COUNTERS', 'ENVELOPE_OOM_KIND', 'ENVELOPE_PREPARATION_CONTROLS', 'ENVELOPE_PROOFS_SCHEMA', 'ENVELOPE_RESULT_SCOPE', 'ENVELOPE_SAME_RUN_JOB_EVENT', 'ENVELOPE_STABLE_PROOF', 'ENVELOPE_TERMINAL_IDENTITY', 'ENVELOPE_UNCERTAINTY', 'EVIDENCE_BOUND', 'EVIDENCE_TYPE', 'EXEC_ATTEMPT_RECEIPT', 'EXPORT_ALREADY_EXISTS', 'EXPORT_SOURCE_TYPE', 'EXPORT_TOTAL_BOUND', 'EXPORT_TYPE', 'FINAL_CLEANUP_CUSTODY_CHANGED', 'GATE_BOUNDING_CAPABILITY', 'GATE_CAPABILITIES', 'GATE_CAPGET', 'GATE_DEDICATED_IDENTITY', 'GATE_EXPECTED_FAMILY_FILTER_ERRNO', 'GATE_FORBIDDEN_SOCKET_FAMILY', 'GATE_LATE_OR_LARGE_PERMISSION', 'GATE_NO_NEW_PRIVILEGES', 'GATE_PERMISSION_BINDING', 'GATE_PERMISSION_TIMEOUT', 'GATE_PROBE_DEADLINE', 'GATE_SHORT_WRITE', 'HANDOFF_ACTUAL_SOURCE_PINS', 'HANDOFF_CLOSURE_EXACT_PIN', 'HANDOFF_CLOSURE_HASH', 'HANDOFF_EFFECTIVE_OCI_BINDING', 'HANDOFF_FINAL_LEDGER_HASH', 'HANDOFF_LEDGER_NOT_FINAL', 'HANDOFF_PREPARATION_NOT_TERMINAL_CLEAN', 'HANDOFF_SOURCE_ARCHIVE', 'HANDOFF_SOURCE_NOT_READONLY_TMPFS', 'HANDOFF_SOURCE_RO_RECEIPT', 'HOSTED_API_REPLY_BOUND', 'HOSTED_EXPECTED_SCHEMA', 'HOSTED_JOB_LIST_BOUND', 'HOSTED_JOB_LIST_IDENTITY', 'HOSTED_JOB_LIST_MISMATCH', 'HOSTED_RUN_BINDING', 'HOST_ADMISSION_DEADLINE', 'HOST_COMMAND_FAILED', 'HOST_DEADLINE', 'HOST_DEADLINE_EXPIRED', 'HOST_ENDPOINT_REACHABLE', 'HOST_FORWARDING_DISABLED_NO_AUTOMATIC_SYSCTL_CHANGE', 'HOST_LATE_PERMISSION_PUBLICATION', 'HOST_NO_REMAINING_BUDGET', 'HOST_READ_DEADLINE', 'INVALID_HOST_PERMIT', 'ISOLATION_NEEDS_DISPOSABLE_ROOT', 'LATE_NPM_EXEC', 'LATE_NPM_PERMISSION', 'LATE_NPM_PERMIT', 'LATE_PROBE_PERMISSION', 'LAUNCH_ARGUMENTS', 'LAUNCH_CODE_CUSTODY', 'LAUNCH_HOSTED_FIRST_ATTEMPT', 'LAUNCH_ORDER_OFFLINE', 'LAUNCH_ORDER_OFFLINE_ASSEMBLY', 'LAUNCH_ORDER_PREPARE', 'LAUNCH_PATH', 'LAUNCH_PIN', 'LAUNCH_REVIEW_ROOT', 'LAUNCH_ROOT_CUSTODY', 'LAUNCH_ROOT_SEALED_LOCATION', 'LAUNCH_SAME_JOB_BINDING', 'LAUNCH_SAME_JOB_ID', 'LAUNCH_STAGE', 'LAUNCH_STATE_CUSTODY', 'LAUNCH_STATE_ROOT', 'LAUNCH_STATE_SHORT', 'MANAGER_ADMISSION', 'NATIVE_COUNT', 'NATIVE_MISSING', 'NATIVE_ORIGINAL_ZIP_PIN', 'NATIVE_PUBLIC_ARTIFACT_UNAVAILABLE', 'NATIVE_REDIRECT_NOT_HTTPS', 'NATIVE_ZIP_FILE_PIN', 'NATIVE_ZIP_METADATA', 'NATIVE_ZIP_PATH_COUNT', 'NETWORK_PROOF_BINDING', 'NET_CLEANUP_FOREIGN_NAMESPACE_LINK', 'NET_CLEANUP_FOREIGN_NAMESPACE_TABLE', 'NET_CLEANUP_NAMESPACE_IDENTITY_NOT_ACQUIRED', 'NET_CLEANUP_NAMESPACE_REPLACED', 'NET_CLEANUP_NAMESPACE_TABLE_CHANGED_BEFORE_DELETE', 'NET_CLEANUP_NAMESPACE_TABLE_IDENTITY_NOT_ACQUIRED_OR_CHANGED', 'NET_CLEANUP_TABLE_IDENTITY_NOT_ACQUIRED_OR_CHANGED', 'NET_CLEANUP_TABLE_REPLACED', 'NET_CLEANUP_UNKNOWN', 'NET_CLEANUP_VETH_CHANGED_BEFORE_DELETE', 'NET_CLEANUP_VETH_IDENTITIES_NOT_ACQUIRED_OR_CHANGED', 'NET_CLEANUP_VETH_REPLACED', 'NET_CLEANUP_VETH_RETAINED_BEFORE_NAMESPACE_DELETE', 'NET_COMMAND_FAILED', 'NET_COUNTER_NOT_FRESH', 'NET_COUNTER_SET', 'NET_CREATED_VETH_PAIR', 'NET_CREATION_ALREADY_ATTEMPTED', 'NET_CREATION_MUTATION_NOT_ACKNOWLEDGED', 'NET_CREATION_NOT_ACKNOWLEDGED', 'NET_DEADLINE', 'NET_DENIED_ENDPOINT_REACHED', 'NET_DNS_RESULT_BOUND', 'NET_ENFORCEMENT_COUNTER_DELTA', 'NET_FAILURE_JOURNAL_BOUND', 'NET_FINAL_VETH_PAIR_CHANGED', 'NET_FINITE_IP_BOUND', 'NET_FOREIGN_NAMESPACE_LINK', 'NET_FORWARDING_CHANGED', 'NET_HOSTNAME_SET', 'NET_HOST_ADDRESSES_CHANGED', 'NET_HOST_FORWARDING_DISABLED_NO_GLOBAL_SYSCTL_CHANGE', 'NET_HOST_IP_FORBIDDEN', 'NET_HOST_TABLE_HANDLE', 'NET_HOST_TABLE_REPLACED', 'NET_HOST_TABLE_RETAINED', 'NET_INTERRUPTED_PENDING_CUSTODY', 'NET_JSON_DIAGNOSTIC_BOUND', 'NET_JSON_EVIDENCE_PER_READ_BOUND', 'NET_JSON_EVIDENCE_TOTAL_BOUND', 'NET_JSON_OPERATION_CLOSED', 'NET_LEDGER_SHORT', 'NET_LISTENER_LOST', 'NET_MOVED_VETH_PAIR', 'NET_MUTATION_WITHOUT_RESERVATION', 'NET_NAMESPACE_REPLACED', 'NET_NAMESPACE_RETAINED', 'NET_NAMESPACE_SYMLINK', 'NET_NAMESPACE_TABLE_REPLACED', 'NET_NETNS_CLI_DIRECTORY_MISMATCH', 'NET_NETNS_DIRECTORY_ALIAS', 'NET_NETNS_DIRECTORY_BOUND', 'NET_NETNS_DIRECTORY_CUSTODY', 'NET_NETNS_DIRECTORY_RACE', 'NET_NETNS_EMPTY_WITH_DIRECTORY', 'NET_NETNS_ENTRY_NAME', 'NET_NETNS_ENTRY_SYMLINK', 'NET_NETNS_JSON_SCHEMA', 'NET_NETNS_JSON_WITH_ABSENT_DIRECTORY', 'NET_NETNS_PARENT_CHANGED', 'NET_NETNS_PARENT_CUSTODY', 'NET_NETNS_PREFLIGHT_CHANGED_BEFORE_RESERVATION', 'NET_NONPUBLIC_IP', 'NET_OWNED_IDENTIFIER_COLLISION', 'NET_OWN_PREFIX_COLLISION', 'NET_POLICY_IP_COUNT', 'NET_PROBE_DEADLINE', 'NET_PROBE_RESULT', 'NET_RECOVERY_IDENTIFIERS', 'NET_RECOVERY_LEDGER_CUSTODY', 'NET_RECOVERY_TAG', 'NET_REPLY_BOUND', 'NET_ROOT_REQUIRED', 'NET_RULESET_OR_TOPOLOGY_CHANGED_DURING_PROBE', 'NET_SNAPSHOT_VETH_PAIR_CHANGED', 'NET_SPECIAL_OR_PLATFORM_IP', 'NET_TABLE_HANDLE_SCHEMA', 'NET_VETH_PAIR_INCOMPLETE', 'NET_VETH_PAIR_NOT_RECIPROCAL', 'NET_VETH_PAIR_SCHEMA', 'NET_VETH_RETAINED', 'NO_ACQUIRED_ANCHOR', 'NO_ANCHOR_FOR_CLEANUP', 'NO_DEDICATED_UID', 'NO_SECOND_ATTEMPT_AFTER_UNKNOWN', 'NO_SECOND_ATTEMPT_SAME_VM', 'OCI_ALIAS_COLLISION', 'OCI_COMPONENT', 'OCI_COMPRESSED_PIN', 'OCI_COUNTS', 'OCI_DESCRIPTOR_PIN', 'OCI_DEST_EXISTS', 'OCI_DIFF_ID_PIN', 'OCI_DIRECTORY_ALIAS', 'OCI_ENTRY_METADATA', 'OCI_EXACT_DERIVED_OVERLAYS', 'OCI_EXPANSION_BOUND', 'OCI_FILES_MISSING', 'OCI_FILE_OVERFLOW', 'OCI_FILE_PIN', 'OCI_FINAL_ENTRY_TYPE', 'OCI_FINAL_FILE', 'OCI_FINAL_HARDLINK', 'OCI_FINAL_MODE', 'OCI_FINAL_PATH_SET', 'OCI_FINAL_SYMLINK', 'OCI_FINAL_UID_GID', 'OCI_LAYER_CUSTODY', 'OCI_LAYER_DIRECTORY_CUSTODY', 'OCI_LAYER_DUPLICATE', 'OCI_LAYER_REDIRECT_HTTPS', 'OCI_LAYER_UNAVAILABLE', 'OCI_LINK_COLLISION', 'OCI_LINK_ESCAPE', 'OCI_LINK_LOOP', 'OCI_LINK_PIN', 'OCI_PATH', 'OCI_PREPARATION_FREE_DISK_12GIB', 'OCI_ROOT_ENTRY_PIN', 'OCI_ROOT_HEADER_METADATA', 'OCI_ROOT_HEADER_MISSING', 'OCI_ROOT_HEADER_TYPE', 'OCI_ROOT_REQUIRED', 'OCI_SPECIAL_FORBIDDEN', 'OCI_STAGE_EXISTS', 'OCI_UNEXPECTED_WHITEOUT', 'OCI_UNEXPECTED_XATTR', 'OFFLINE_ASSEMBLY_CUSTODY', 'OFFLINE_ASSEMBLY_PATH', 'OFFLINE_ASSEMBLY_ROOT_BINDING', 'OFFLINE_PRESPAWN_NATIVE_PIN', 'OFFLINE_PRESPAWN_SOURCE_PIN', 'OFFLINE_UNKNOWN_OR_FAILED', 'ONLINE_ISOLATION_TOOLCHAIN_SOURCE_PRODUCER_NOT_IMPLEMENTED', 'OOM_ADJUST_CHANGED', 'OOM_EVIDENCE_CONTAMINATED', 'OUTPUT_OVERFLOW', 'PACKAGE_COUNT', 'PACKAGE_HASH', 'PACKAGE_PATH', 'PACKAGE_SYMLINK', 'PERMIT_OVERSIZE', 'PERMIT_SHORT_WRITE', 'PREPARATION_ENVELOPE_PIN', 'PREPARATION_LOG_OVERFLOW', 'PREPARATION_NOT_NATURAL_SUCCESS', 'PREPARATION_RECEIPT_PIN', 'PREPARATION_UNIT_FAILED', 'PREPARATION_UNKNOWN_OR_FAILED', 'PROBE_BINDING', 'PROBE_FIXED_PEER', 'PROBE_TLS_SOCKET', 'PRODUCER_CLEANUP_CUSTODY', 'PRODUCER_COMMAND_FAILED', 'PRODUCER_DIRECTORY_CUSTODY', 'PRODUCER_ENFORCEMENT_PROOF', 'PRODUCER_HANDOFF_BYTES', 'PRODUCER_HOST_NAMESPACE_EVIDENCE', 'PRODUCER_NETWORK_CLOSURE', 'PRODUCER_OCI_BINDING', 'PRODUCER_PACKAGE_CUSTODY', 'PRODUCER_PATH', 'PRODUCER_PAYLOAD_PIN', 'PRODUCER_REAL_COUNTERS', 'PRODUCER_REPLY_BOUND', 'PRODUCER_REVIEW_ROOT', 'PRODUCER_ROOT_BINDING', 'PRODUCER_ROOT_HANDOFF_PIN', 'PRODUCER_SOCKET_FILTER_EVIDENCE', 'PRODUCER_TLS_DENIAL_RESULT', 'PRODUCER_TYPES_CLOSURE', 'PUBLIC_DOWNLOAD_BOUND', 'PUBLIC_DOWNLOAD_PIN', 'PUBLIC_INPUT_ALREADY_EXISTS', 'PUBLIC_TLS_PROBE_FAILED', 'READY_IDENTITY', 'READY_PRIVILEGES', 'REAL_NETNS_BINDING', 'RECEIPT_NOT_REGULAR', 'RECEIPT_SHORT', 'RECEIPT_SIZE', 'RECOVERY_ADMISSION_BINDING', 'RECOVERY_BASE_CUSTODY', 'RECOVERY_CLOSEOUT_CUSTODY', 'RECOVERY_INVOCATION_CHANGED_AFTER_STOP', 'RECOVERY_NO_ACQUIRED_UNIT_IDENTITY', 'RECOVERY_REVIEW_BINDING', 'RECOVERY_UNIT_IDENTITY', 'RECOVERY_UNIT_REPLACED', 'RECOVERY_UNIT_SOURCE_CUSTODY', 'ROOT_EXTRA_FILES', 'ROOT_MANIFEST_PIN', 'ROOT_STAGE_UID', 'ROOT_SYMLINK', 'RUNTIME_FAILED', 'RUNTIME_MARKER', 'RUNTIME_METADATA', 'RUNTIME_WALL_TIMEOUT', 'SEAL_CONTEXT_ONCE', 'SEAL_CONTEXT_PHASE', 'SEAL_CONTEXT_SOURCE', 'SERVICE_PATH', 'SERVICE_TEMPLATE', 'SOURCE_ARCHIVE_CUSTODY', 'SOURCE_DIRECTORY_CUSTODY', 'STANDARD_HOSTED_JOB_REQUIRED', 'STANDARD_HOSTED_VM_BINDING', 'SYSTEMD_HOST_REQUIRED', 'TAP_EXACT_ELEVEN_NAMES', 'TAP_FAILED', 'TAP_SUMMARY', 'TERMINAL_NOT_NATURAL_SUCCESS', 'TEST_SOURCE_PIN', 'TRANSPORT_ARGUMENT', 'TYPECHECK_ALREADY_EXISTS', 'TYPECHECK_CAPTURE_HELPER_PIN', 'TYPECHECK_COMPILER_PIN', 'TYPECHECK_DEPENDENCY_INSTALL_FAILED', 'TYPECHECK_DEPENDENCY_VERSION_MISMATCH', 'TYPECHECK_EXPECTED_DEPENDENCY_VERSIONS', 'TYPECHECK_FINAL_LOCK_CHANGED', 'TYPECHECK_IMAGE_TOOLCHAIN_PIN', 'TYPECHECK_LOCK_MUTATED', 'TYPECHECK_LOCK_PIN', 'TYPECHECK_RECEIPT_SHORT', 'TYPECHECK_REPOSITORY_TYPES_FAILED', 'TYPECHECK_SOURCE_PIN', 'TYPECHECK_SOURCE_SET', 'TYPES_CLOSURE_BINDING', 'TYPES_COMPILER', 'TYPES_ISOLATION_CONTRACT_MISSING', 'TYPES_LOCK', 'TYPES_PASS', 'TYPES_SCOPE', 'TYPES_SOURCE', 'TYPES_STATE', 'UID_BECAME_ASSIGNED', 'UID_HOST_PROCESS_COLLISION', 'UNBOUNDED_DESCRIPTOR_LIMIT', 'UNCLASSIFIED_CLOSED_CODE', 'UNIT_CLEANUP_SOURCE_CHANGED', 'UNIT_DIED_BEFORE_PERMISSION', 'UNIT_TEMPLATE', 'UNIT_VALUE'))
CLOSED_ERROR_CLASSES=frozenset(('RuntimeError', 'JSONDecodeError', 'OSError', 'FileNotFoundError', 'FileExistsError', 'PermissionError', 'TimeoutError', 'TimeoutExpired', 'CalledProcessError', 'ValueError', 'KeyError', 'TypeError', 'AssertionError', 'MemoryError', 'KeyboardInterrupt', 'SystemExit'))
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
def command(*args,timeout=5,input=None,deadline=None):
 if deadline is not None:
  timeout=min(timeout,deadline-time.monotonic());need(timeout>0,'NET_DEADLINE')
 p=subprocess.run(args,input=input,env=ENV,stdin=subprocess.DEVNULL if input is None else None,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 need(len(p.stdout)<=262144 and len(p.stderr)<=65536,'NET_REPLY_BOUND');need(p.returncode==0,'NET_COMMAND_FAILED')
 if deadline is not None:need(time.monotonic()<deadline,'NET_DEADLINE')
 return p.stdout.decode()
def public_ip(value,host_addresses):
 address=ipaddress.ip_address(value);special=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.88.99.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4','168.63.129.16/32'];need(address.version==4 and not any(address in ipaddress.ip_network(n) for n in special),'NET_SPECIAL_OR_PLATFORM_IP');need(address.version==4 and address.is_global and not address.is_multicast and not address.is_reserved,'NET_NONPUBLIC_IP');need(value not in host_addresses,'NET_HOST_IP_FORBIDDEN');return str(address)
def discover(hostnames):
 need(set(hostnames)=={'registry.npmjs.org','github.com','codeload.github.com','objects.githubusercontent.com','release-assets.githubusercontent.com'},'NET_HOSTNAME_SET')
 interfaces=json.loads(command('/usr/sbin/ip','-j','address','show'));host={a['local'] for item in interfaces for a in item.get('addr_info',[])};endpoints={}
 for name in sorted(hostnames):
  answers=sorted({row[4][0] for row in socket.getaddrinfo(name,443,family=socket.AF_INET,type=socket.SOCK_STREAM)});need(1<=len(answers)<=16,'NET_DNS_RESULT_BOUND');endpoints[name]=[public_ip(a,host) for a in answers]
 need(sum(map(len,endpoints.values()))<=48,'NET_FINITE_IP_BOUND');return {'endpoints':endpoints,'hostAddresses':sorted(host),'discoveredAtMonotonicNs':time.monotonic_ns(),'addressFamilies':['AF_INET'],'transportPorts':[443],'runtimeDNS':False}
class OwnedNetwork:
 def __init__(self,policy,ledger_path):
  self.policy=policy;self.tag=secrets.token_hex(4);self.namespace='dfsp'+self.tag;self.hostif='dfh'+self.tag;self.peerif='dfp'+self.tag;self.table='dfsp_'+self.tag;self.hostip='10.203.173.1';self.peerip='10.203.173.2';self.prefix='10.203.173.0/30';self.created=False;self.hosttable=False;self.forwardBefore=None;self.listener=None;self.probePort=None;self.ledger_path=Path(ledger_path);self.ledger={'schemaVersion':1,'tag':self.tag,'policy':policy,'namespace':self.namespace,'hostInterface':self.hostif,'peerInterface':self.peerif,'hostTable':self.table,'mutations':[],'preflightAbsent':False,'identities':{},'cleanupState':'NOT_STARTED'};self.persist()
 @classmethod
 def recover(cls,ledger_path):
  path=Path(ledger_path);st=path.lstat();need(st.st_uid==0 and st.st_nlink==1 and not st.st_mode&0o077 and not path.is_symlink() and st.st_size<=262144,'NET_RECOVERY_LEDGER_CUSTODY');value=json.loads(path.read_text());tag=value.get('tag');need(re.fullmatch('[a-f0-9]{8}',tag or ''),'NET_RECOVERY_TAG')
  need(value.get('namespace')=='dfsp'+tag and value.get('hostInterface')=='dfh'+tag and value.get('peerInterface')=='dfp'+tag and value.get('hostTable')=='dfsp_'+tag,'NET_RECOVERY_IDENTIFIERS')
  obj=cls.__new__(cls);obj.policy=value['policy'];obj.tag=tag;obj.namespace=value['namespace'];obj.hostif=value['hostInterface'];obj.peerif=value['peerInterface'];obj.table=value['hostTable'];obj.hostip='10.203.173.1';obj.peerip='10.203.173.2';obj.prefix='10.203.173.0/30';obj.listener=None;obj.probePort=None;obj.created=False;obj.hosttable=False;obj.ledger_path=path;obj.ledger=value
  pending=path.with_suffix('.pending')
  if pending.exists():
   ps=pending.lstat();need(ps.st_uid==0 and not ps.st_mode&0o077 and ps.st_nlink==1 and not pending.is_symlink(),'NET_INTERRUPTED_PENDING_CUSTODY');saved=path.with_name(path.name+'.interrupted-'+secrets.token_hex(4));os.rename(pending,saved);obj.ledger['interruptedPendingEvidence']=str(saved)
  return obj
 def persist(self):
  raw=(json.dumps(self.ledger,sort_keys=True,indent=2)+'\n').encode();tmp=self.ledger_path.with_suffix('.pending');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  try:need(os.write(fd,raw)==len(raw),'NET_LEDGER_SHORT');os.fsync(fd)
  finally:os.close(fd)
  os.replace(tmp,self.ledger_path);d=os.open(self.ledger_path.parent,os.O_DIRECTORY)
  try:os.fsync(d)
  finally:os.close(d)
 def record_failure(self,error,stage):
  # Diagnostic failures must never replace the error being diagnosed.
  value={'stage':stage,**public_failure(error)};rows=self.ledger.setdefault('failureJournal',[])
  if len(rows)<16:rows.append(value)
  else:self.ledger['diagnosticEvidenceUnknown']=True
  try:self.persist()
  except BaseException as persistence_error:
   self.ledger['diagnosticEvidenceUnknown']=True
   if len(rows)<16:rows.append({'stage':'FAILURE_PERSISTENCE',**public_failure(persistence_error)})
   # Also retain bounded sanitized data on the live exception for the caller.
   error.daemonFailureEvidence={'primary':value,'persistence':public_failure(persistence_error)}
  return value
 def mutate(self,*args,input=None,resource=None):
  entry={'argv':list(args),'inputSha256':hashlib.sha256(input).hexdigest() if input else None,'state':'ATTEMPTED_RESULT_UNKNOWN'};self.ledger['mutations'].append(entry)
  if resource is not None:
   ownership=self.ledger.setdefault('creation',{});need(resource not in ownership,'NET_CREATION_ALREADY_ATTEMPTED');ownership[resource]={'attempted':True,'acknowledged':False,'mutationIndex':len(self.ledger['mutations'])-1}
  self.persist()
  try:
   value=command(*args,input=input);entry['state']='COMMAND_ACKNOWLEDGED'
   if resource is not None:self.ledger['creation'][resource]['acknowledged']=True
   self.persist();return value
  except BaseException as error:
   self.record_failure(error,'MUTATION');raise
 def read_json(self,operation,*args,**kwargs):
  # Diagnostic only. Never normalizes empty bytes or changes parser semantics.
  need(operation in JSON_READ_OPERATIONS,'NET_JSON_OPERATION_CLOSED');entries=self.ledger.setdefault('jsonReads',[]);need(len(entries)<64,'NET_JSON_DIAGNOSTIC_BOUND');entry={'operation':operation,'state':'READ_ATTEMPTED_RESULT_UNKNOWN'};entries.append(entry);self.persist()
  try:
   text=command(*args,**kwargs);raw=text.encode('utf-8');entry.update(state='COMMAND_ZERO_STDOUT_OBSERVED',stdoutBytes=len(raw),stdoutSha256=hashlib.sha256(raw).hexdigest(),stdoutEmpty=len(raw)==0,stdoutWhitespaceOnly=bool(raw) and not raw.strip())
   # Every JSON decision, including link/table identity and cleanup, retains the
   # exact original UTF-8 stdout within the same technical evidence artifact.
   used=sum(row.get('evidenceBytes',0) for row in entries);within_read=len(raw)<=32768;within_total=used+len(raw)<=98304
   entry.update(evidenceState='EXACT' if within_read and within_total else 'OMITTED_BOUND_FAILURE',evidenceBytes=len(raw) if within_read and within_total else 0)
   if within_read and within_total:entry['stdoutExact']=text
   else:self.ledger['diagnosticEvidenceUnknown']=True
   self.persist();need(within_read,'NET_JSON_EVIDENCE_PER_READ_BOUND');need(within_total,'NET_JSON_EVIDENCE_TOTAL_BOUND')
   try:value=json.loads(text)
   except json.JSONDecodeError as error:
    entry.update(state='JSON_INVALID',errorOffset=error.pos,errorLine=error.lineno,errorColumn=error.colno);self.record_failure(error,'JSON_PARSE');raise
   kind=type(value).__name__;entry.update(state='JSON_PARSED',topLevelKind=kind if kind in ('list','dict','str','int','float','bool','NoneType') else 'OTHER');self.persist()
   if kwargs.get('deadline') is not None:need(time.monotonic()<kwargs['deadline'],'NET_DEADLINE')
   return value
  except BaseException as error:
   if entry['state'] not in ('JSON_INVALID','JSON_PARSED'):
    entry.update(state='READ_FAILED',**public_failure(error))
   self.record_failure(error,'JSON_READ')
   raise
 def namespace_preflight(self):
  # Empty CLI bytes alone prove nothing. Anchor directory state around CLI.
  flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
  runfd=None
  def identity(st):return (st.st_dev,st.st_ino,st.st_mode,st.st_uid,st.st_gid,st.st_mtime_ns,st.st_ctime_ns)
  def snapshot():
   runst=os.fstat(runfd);need(runst.st_uid==0 and not runst.st_mode&0o022,'NET_NETNS_PARENT_CUSTODY');pathst=os.stat('/run',follow_symlinks=False);need(identity(runst)==identity(pathst),'NET_NETNS_PARENT_CHANGED');need(Path('/var/run').resolve(strict=True)==Path('/run'),'NET_NETNS_DIRECTORY_ALIAS')
   try:fd=os.open('netns',flags,dir_fd=runfd)
   except FileNotFoundError:
    try:os.stat('netns',dir_fd=runfd,follow_symlinks=False)
    except FileNotFoundError:return {'state':'ENOENT','parentIdentity':identity(runst),'entries':{}}
    raise RuntimeError('NET_NETNS_DIRECTORY_RACE')
   try:
    before=os.fstat(fd);need(before.st_uid==0 and not before.st_mode&0o022,'NET_NETNS_DIRECTORY_CUSTODY');names=os.listdir(fd);need(len(names)<=4096,'NET_NETNS_DIRECTORY_BOUND');entries={}
    for name in names:
     need(name not in ('.','..') and '/' not in name and '\x00' not in name,'NET_NETNS_ENTRY_NAME');entry=os.stat(name,dir_fd=fd,follow_symlinks=False);need(not stat.S_ISLNK(entry.st_mode),'NET_NETNS_ENTRY_SYMLINK');entries[name]=identity(entry)
    after=os.fstat(fd);path=os.stat('netns',dir_fd=runfd,follow_symlinks=False);need(identity(before)==identity(after)==identity(path),'NET_NETNS_DIRECTORY_RACE');return {'state':'DIRECTORY','parentIdentity':identity(runst),'directoryIdentity':identity(before),'entries':entries}
   finally:os.close(fd)
  entry={'operation':'PREFLIGHT_NAMESPACES','state':'DIRECTORY_CHECK_ATTEMPTED'}
  try:
   runfd=os.open('/run',flags);reads=self.ledger.setdefault('jsonReads',[]);need(len(reads)<64,'NET_JSON_DIAGNOSTIC_BOUND');reads.append(entry);self.persist()
   before=snapshot();text=command('/usr/sbin/ip','-j','netns','list');raw=text.encode('utf-8');after=snapshot();need(before==after,'NET_NETNS_DIRECTORY_RACE');entry.update(stdoutBytes=len(raw),stdoutSha256=hashlib.sha256(raw).hexdigest(),stdoutEmpty=not raw,stdoutWhitespaceOnly=bool(raw) and not raw.strip(),directoryState=before['state'],directoryEntryCount=len(before['entries']),parentIdentity=before['parentIdentity'],directoryIdentity=before.get('directoryIdentity'),directoryEntries=before['entries']);self.persist()
   if text=='':
    need(before['state']=='ENOENT','NET_NETNS_EMPTY_WITH_DIRECTORY');entry['state']='EMPTY_ACCEPTED_TWO_OBSERVED_ENOENT';self.persist();return set()
   try:value=json.loads(text)
   except json.JSONDecodeError as error:entry.update(state='JSON_INVALID',errorOffset=error.pos,errorLine=error.lineno,errorColumn=error.colno);self.record_failure(error,'NAMESPACE_JSON_PARSE');raise
   need(isinstance(value,list) and all(isinstance(row,dict) and isinstance(row.get('name'),str) for row in value),'NET_NETNS_JSON_SCHEMA');names=[row['name'] for row in value];need(len(names)==len(set(names)) and set(names)==set(before['entries']),'NET_NETNS_CLI_DIRECTORY_MISMATCH');need(before['state']=='DIRECTORY','NET_NETNS_JSON_WITH_ABSENT_DIRECTORY');entry['state']='JSON_DIRECTORY_NAMES_MATCH';self.persist();return set(names)
  except BaseException as error:
   entry.update(state='NAMESPACE_PREFLIGHT_FAILED',**public_failure(error));self.record_failure(error,'NAMESPACE_PREFLIGHT');raise
  finally:
   if runfd is not None:os.close(runfd)
 def creation_acknowledged(self,resource):
  record=self.ledger.get('creation',{}).get(resource,{})
  need(record.get('attempted') is True and record.get('acknowledged') is True,'NET_CREATION_NOT_ACKNOWLEDGED')
  index=record.get('mutationIndex');rows=self.ledger['mutations'];need(type(index) is int and 0<=index<len(rows) and rows[index]['state']=='COMMAND_ACKNOWLEDGED','NET_CREATION_MUTATION_NOT_ACKNOWLEDGED')
 def namespace_identity(self):
  st=os.stat('/run/netns/'+self.namespace,follow_symlinks=False);need(not stat.S_ISLNK(st.st_mode),'NET_NAMESPACE_SYMLINK');return {'namespaceInode':st.st_ino,'namespaceDevice':st.st_dev}
 def require_namespace_identity(self):
  self.creation_acknowledged('namespace');actual=self.namespace_identity();need(all(self.ledger['identities'].get(k)==v for k,v in actual.items()),'NET_NAMESPACE_REPLACED');return actual
 def table_identity(self,resource,family,inside=False):
  self.creation_acknowledged(resource)
  args=('/usr/sbin/ip','netns','exec',self.namespace) if inside else ()
  if inside:self.require_namespace_identity()
  value=self.read_json('OWNERSHIP_TABLE',*args,'/usr/sbin/nft','-a','-j','list','table',family,self.table);rows=[x['table'] for x in value['nftables'] if x.get('table',{}).get('name')==self.table and x['table'].get('family')==family];need(len(rows)==1 and type(rows[0].get('handle')) is int,'NET_TABLE_HANDLE_SCHEMA');return rows[0]['handle']
 def veth_identity(self,hostlinks=None,namespace_present=True,deadline=None):
  hostlinks=self.read_json('OWNERSHIP_HOST_LINKS','/usr/sbin/ip','-j','-d','link','show',deadline=deadline) if hostlinks is None else hostlinks
  hosts=[x for x in hostlinks if x.get('ifname')==self.hostif];peers=[(x,'HOST') for x in hostlinks if x.get('ifname')==self.peerif]
  if namespace_present:
   self.require_namespace_identity();links=self.read_json('OWNERSHIP_PEER_LINKS','/usr/sbin/ip','-n',self.namespace,'-j','-d','link','show',deadline=deadline);need(all(x.get('ifname') in ('lo',self.peerif) for x in links),'NET_FOREIGN_NAMESPACE_LINK');peers += [(x,'NAMESPACE') for x in links if x.get('ifname')==self.peerif]
  if not hosts and not peers:return None
  need(len(hosts)==len(peers)==1,'NET_VETH_PAIR_INCOMPLETE');host=hosts[0];peer,location=peers[0]
  need(all(x.get('linkinfo',{}).get('info_kind')=='veth' and type(x.get('ifindex')) is int and type(x.get('link_index')) is int for x in (host,peer)),'NET_VETH_PAIR_SCHEMA');need(host['link_index']==peer['ifindex'] and peer['link_index']==host['ifindex'],'NET_VETH_PAIR_NOT_RECIPROCAL')
  return {'hostIfindex':host['ifindex'],'peerIfindex':peer['ifindex'],'peerLocation':location}
 def setup(self):
  need(os.geteuid()==0,'NET_ROOT_REQUIRED');need(Path('/proc/sys/net/ipv4/ip_forward').read_text().strip()=='1','NET_HOST_FORWARDING_DISABLED_NO_GLOBAL_SYSCTL_CHANGE')
  # Never mutate a global sysctl to make this fixture work. Existing route
  # collision is a blocker requiring another externally reviewed owned prefix.
  routes=self.read_json('SETUP_ROUTE_TABLES','/usr/sbin/ip','-j','route','show','table','all');prefix=ipaddress.ip_network(self.prefix)
  for route in routes:
   dst=route.get('dst','default')
   if dst=='default':continue
   try:network=ipaddress.ip_network(dst,strict=False)
   except ValueError:continue
   need(network.version!=4 or not network.overlaps(prefix),'NET_OWN_PREFIX_COLLISION')
  current=self.read_json('SETUP_HOST_ADDRESSES','/usr/sbin/ip','-j','address','show');host={a['local'] for item in current for a in item.get('addr_info',[])};need(host==set(self.policy['hostAddresses']),'NET_HOST_ADDRESSES_CHANGED')
  allowed=sorted({public_ip(a,host) for values in self.policy['endpoints'].values() for a in values});need(1<=len(allowed)<=48,'NET_POLICY_IP_COUNT');ips=', '.join(allowed)
  try:
   names=self.namespace_preflight();links=self.read_json('PREFLIGHT_LINKS','/usr/sbin/ip','-j','link','show');tables=self.read_json('PREFLIGHT_NFT_TABLES','/usr/sbin/nft','-j','list','tables')
   need(self.namespace_preflight()==names,'NET_NETNS_PREFLIGHT_CHANGED_BEFORE_RESERVATION');need(self.namespace not in names and not any(x.get('ifname') in (self.hostif,self.peerif) for x in links) and not any(x.get('table',{}).get('name')==self.table for x in tables['nftables']),'NET_OWNED_IDENTIFIER_COLLISION');self.ledger['preflightAbsent']=True;self.persist()
   self.mutate('/usr/sbin/ip','netns','add',self.namespace,resource='namespace');self.created=True;self.ledger['identities'].update(self.namespace_identity());self.persist()
   self.require_namespace_identity();self.mutate('/usr/sbin/ip','link','add',self.hostif,'type','veth','peer','name',self.peerif,resource='veth');pair=self.veth_identity();need(pair is not None and pair['peerLocation']=='HOST','NET_CREATED_VETH_PAIR');self.ledger['identities']['vethPair']=pair;self.persist();self.mutate('/usr/sbin/ip','link','set',self.peerif,'netns',self.namespace);moved=self.veth_identity();need(moved is not None and moved==dict(pair,peerLocation='NAMESPACE'),'NET_MOVED_VETH_PAIR');self.ledger['identities']['vethPair']=moved;self.persist()
   self.mutate('/usr/sbin/ip','address','add',self.hostip+'/30','dev',self.hostif);self.mutate('/usr/sbin/ip','link','set',self.hostif,'up')
   for args in [('address','add',self.peerip+'/30','dev',self.peerif),('link','set',self.peerif,'up'),('link','set','lo','up'),('route','add','default','via',self.hostip)]:self.mutate('/usr/sbin/ip','-n',self.namespace,*args)
   self.ledger['listener']={'state':'BIND_ATTEMPTED_RESULT_UNKNOWN','address':self.hostip,'port':0,'lifetime':'PROCESS_FD_ONLY'};self.persist();self.listener=socket.socket();self.listener.settimeout(.5);self.listener.bind((self.hostip,0));self.listener.listen(4);self.probePort=self.listener.getsockname()[1];self.ledger['listener'].update(state='BOUND',port=self.probePort);self.persist()
   # Controlled host endpoint actually listens. Local baseline connects and is
   # accepted before any child denial observation. No private service probes.
   baseline=socket.create_connection((self.hostip,self.probePort),timeout=1);accepted,_=self.listener.accept();baseline.close();accepted.close()
   rules=f'''create table inet {self.table}
table inet {self.table} {{
 set public4 {{ type ipv4_addr; elements = {{ {ips} }} }}
 counter denied_probe {{ }}
 counter public_https {{ }}
 counter denied_other {{ }}
 chain output {{ type filter hook output priority -100; policy drop;
 ip daddr {self.hostip} tcp dport {self.probePort} counter name denied_probe drop
 ip daddr @public4 tcp dport 443 counter name public_https accept
 counter name denied_other drop
 }}
 chain input {{ type filter hook input priority -100; policy drop;
 ct state established,related accept
 }}
 chain forward {{ type filter hook forward priority -100; policy drop; }}
}}'''
   self.require_namespace_identity();self.mutate('/usr/sbin/ip','netns','exec',self.namespace,'/usr/sbin/nft','-f','-',input=rules.encode(),resource='namespaceTable');self.ledger['identities']['namespaceTableHandle']=self.table_identity('namespaceTable','inet',inside=True);self.persist()
   hostrules=f'''create table ip {self.table}
table ip {self.table} {{
 set public4 {{ type ipv4_addr; elements = {{ {ips} }} }}
 chain forward {{ type filter hook forward priority -100; policy accept;
 iifname "{self.hostif}" ip saddr {self.peerip} ip daddr @public4 tcp dport 443 accept
 iifname "{self.hostif}" drop
 oifname "{self.hostif}" ip daddr {self.peerip} ct state established,related accept
 oifname "{self.hostif}" drop
 }}
 chain postrouting {{ type nat hook postrouting priority srcnat; policy accept;
 iifname "{self.hostif}" ip saddr {self.peerip} ip daddr @public4 tcp dport 443 masquerade
 }}
}}'''
   self.mutate('/usr/sbin/nft','-f','-',input=hostrules.encode(),resource='hostTable');self.hosttable=True;self.ledger['identities']['hostTableHandle']=self.table_identity('hostTable','ip');self.persist();self.rules=rules;self.hostrules=hostrules
   need(self.veth_identity()==self.ledger['identities']['vethPair'],'NET_FINAL_VETH_PAIR_CHANGED')
   snapshot=self.snapshot();need(snapshot['deniedProbePackets']==0,'NET_COUNTER_NOT_FRESH');return snapshot
  except BaseException as error:
   self.ledger.setdefault('primaryFailure',public_failure(error));self.record_failure(error,'SETUP_PRIMARY')
   if self.ledger['preflightAbsent']:
    try:self.cleanup()
    except BaseException as cleanup_error:self.record_failure(cleanup_error,'SETUP_CLEANUP_SECONDARY')
   # Re-raise exactly the initial failure, even when cleanup/persistence failed.
   raise
 def snapshot(self,deadline=None):
  self.require_namespace_identity();need(self.veth_identity(deadline=deadline)==self.ledger['identities'].get('vethPair'),'NET_SNAPSHOT_VETH_PAIR_CHANGED');self.creation_acknowledged('namespaceTable');self.creation_acknowledged('hostTable')
  value=self.read_json('SNAPSHOT_NAMESPACE_NFT','/usr/sbin/ip','netns','exec',self.namespace,'/usr/sbin/nft','-a','-j','list','table','inet',self.table,deadline=deadline);counters={}
  for row in value['nftables']:
   c=row.get('counter')
   if c:counters[c['name']]=c
  table_rows=[x['table'] for x in value['nftables'] if x.get('table',{}).get('name')==self.table and x['table'].get('family')=='inet'];need(len(table_rows)==1 and table_rows[0].get('handle')==self.ledger['identities'].get('namespaceTableHandle'),'NET_NAMESPACE_TABLE_REPLACED')
  need(set(counters)=={'denied_probe','public_https','denied_other'},'NET_COUNTER_SET')
  hostvalue=self.read_json('SNAPSHOT_HOST_NFT','/usr/sbin/nft','-a','-j','list','table','ip',self.table,deadline=deadline);host_table=next(x['table'] for x in hostvalue['nftables'] if x.get('table',{}).get('name')==self.table);handle=host_table.get('handle');need(type(handle) is int,'NET_HOST_TABLE_HANDLE');expected_handle=self.ledger['identities'].get('hostTableHandle');need(type(expected_handle) is int and handle==expected_handle,'NET_HOST_TABLE_REPLACED');routes=self.read_json('SNAPSHOT_NAMESPACE_ROUTES','/usr/sbin/ip','-n',self.namespace,'-j','route','show','table','all',deadline=deadline);hostroutes=self.read_json('SNAPSHOT_HOST_ROUTES','/usr/sbin/ip','-j','route','show','dev',self.hostif,deadline=deadline);hostlinks=self.read_json('SNAPSHOT_HOST_LINK','/usr/sbin/ip','-j','-d','link','show','dev',self.hostif,deadline=deadline);peerlinks=self.read_json('SNAPSHOT_PEER_LINK','/usr/sbin/ip','-n',self.namespace,'-j','-d','link','show','dev',self.peerif,deadline=deadline);namespace_inode=Path('/run/netns',self.namespace).stat().st_ino;need(namespace_inode==self.ledger['identities']['namespaceInode'],'NET_NAMESPACE_REPLACED');need(Path('/proc/sys/net/ipv4/ip_forward').read_text().strip()=='1','NET_FORWARDING_CHANGED')
  return {'hostNamespaceInode':Path('/proc/self/ns/net').stat().st_ino,'hostRoutes':hostroutes,'hostRuleset':hostvalue,'namespaceRoutes':routes,'hostLink':hostlinks,'peerLink':peerlinks,'namespaceInode':namespace_inode,'forwardingBefore':'1','forwardingObserved':'1','namespace':self.namespace,'table':self.table,'hostInterface':self.hostif,'peerInterface':self.peerif,'peerHostIP':self.hostip,'peerHostPort':self.probePort,'namespaceIP':self.peerip,'deniedProbePackets':counters['denied_probe']['packets'],'publicHttpsPackets':counters['public_https']['packets'],'ruleset':value,'policy':self.policy}
 def confirm_probe(self,before,child_receipt,deadline):
  after=self.snapshot(deadline)
  def stable(value):
   if isinstance(value,dict):return {k:stable(v) for k,v in value.items() if k not in ('packets','bytes','handle')}
   if isinstance(value,list):return [stable(v) for v in value]
   return value
  need(all(stable(before[k])==stable(after[k]) for k in ('ruleset','hostRuleset','namespaceRoutes','hostLink','peerLink','hostRoutes','hostNamespaceInode','namespaceInode','forwardingObserved')),'NET_RULESET_OR_TOPOLOGY_CHANGED_DURING_PROBE');need(child_receipt.get('hostConnectSucceeded') is False and child_receipt.get('httpsStatus')==200,'NET_PROBE_RESULT');need(after['deniedProbePackets']>before['deniedProbePackets'] and after['publicHttpsPackets']>before['publicHttpsPackets'],'NET_ENFORCEMENT_COUNTER_DELTA');need(self.listener is not None,'NET_LISTENER_LOST')
  remaining=deadline-time.monotonic();need(remaining>0,'NET_PROBE_DEADLINE');self.listener.settimeout(min(.5,remaining))
  try:unexpected,_=self.listener.accept()
  except socket.timeout:pass
  else:unexpected.close();raise RuntimeError('NET_DENIED_ENDPOINT_REACHED')
  need(time.monotonic()<deadline,'NET_PROBE_DEADLINE')
  return {'kind':'NETNS_NFT_ACTUAL_CONTROLLED_DENIAL_AND_PUBLIC_TLS_SUCCESS','before':before,'after':after,'controlledHostBaselineConnected':True,'hostListenerReceivedChild':False,'childProbe':child_receipt,'notTextualReadbackOnly':True}
 def cleanup(self):
  # Validate the entire dependency set before deleting anything. A name,
  # reservation, attempted command or a later observed identity is not ownership.
  self.ledger['cleanupState']='RECONCILING';self.persist()
  if self.listener:self.listener.close();self.listener=None
  if not self.ledger['preflightAbsent']:
   need(not self.ledger['mutations'],'NET_MUTATION_WITHOUT_RESERVATION');self.ledger['cleanupState']='NO_EFFECT_ATTEMPTED';self.persist();return
  try:
   identities=self.ledger['identities'];namespace_present=self.namespace in self.namespace_preflight()
   if namespace_present:self.require_namespace_identity()
   tables=self.read_json('CLEANUP_NFT_TABLES','/usr/sbin/nft','-j','list','tables');host_present=any(x.get('table',{}).get('family')=='ip' and x['table'].get('name')==self.table for x in tables['nftables'])
   if host_present:
    self.creation_acknowledged('hostTable');need(type(identities.get('hostTableHandle')) is int and self.table_identity('hostTable','ip')==identities['hostTableHandle'],'NET_CLEANUP_TABLE_IDENTITY_NOT_ACQUIRED_OR_CHANGED')
   namespace_table_present=False
   if namespace_present:
    tables=self.read_json('CLEANUP_NAMESPACE_TABLES','/usr/sbin/ip','netns','exec',self.namespace,'/usr/sbin/nft','-j','list','tables');namespace_tables=[x['table'] for x in tables['nftables'] if 'table' in x];need(all(x.get('family')=='inet' and x.get('name')==self.table for x in namespace_tables),'NET_CLEANUP_FOREIGN_NAMESPACE_TABLE');namespace_table_present=bool(namespace_tables)
    if namespace_table_present:
     self.creation_acknowledged('namespaceTable');need(type(identities.get('namespaceTableHandle')) is int and self.table_identity('namespaceTable','inet',inside=True)==identities['namespaceTableHandle'],'NET_CLEANUP_NAMESPACE_TABLE_IDENTITY_NOT_ACQUIRED_OR_CHANGED')
   pair=self.veth_identity(namespace_present=namespace_present)
   if pair is not None:
    self.creation_acknowledged('veth');need(pair==identities.get('vethPair'),'NET_CLEANUP_VETH_IDENTITIES_NOT_ACQUIRED_OR_CHANGED')
   self.ledger['cleanupGuarantees']={'namespace':'ACQUIRED_DEVICE_INODE_MATCH' if namespace_present else 'ABSENT','hostTable':'ACK_AND_ACQUIRED_HANDLE_MATCH' if host_present else 'ABSENT','namespaceTable':'ACK_AND_ACQUIRED_HANDLE_MATCH' if namespace_table_present else 'ABSENT','veth':'ACK_AND_ACQUIRED_RECIPROCAL_ENDPOINTS_MATCH' if pair is not None else 'ABSENT'};self.persist()
   if host_present:self.mutate('/usr/sbin/nft','delete','table','ip','handle',str(identities['hostTableHandle']))
   if pair is not None:
    need(self.veth_identity(namespace_present=namespace_present)==pair,'NET_CLEANUP_VETH_CHANGED_BEFORE_DELETE');self.mutate('/usr/sbin/ip','link','delete',self.hostif)
   if namespace_table_present:
    self.require_namespace_identity();need(self.table_identity('namespaceTable','inet',inside=True)==identities['namespaceTableHandle'],'NET_CLEANUP_NAMESPACE_TABLE_CHANGED_BEFORE_DELETE');self.mutate('/usr/sbin/ip','netns','exec',self.namespace,'/usr/sbin/nft','delete','table','inet','handle',str(identities['namespaceTableHandle']))
   if namespace_present:
    self.require_namespace_identity();need(self.veth_identity() is None,'NET_CLEANUP_VETH_RETAINED_BEFORE_NAMESPACE_DELETE');tables=self.read_json('CLEANUP_NAMESPACE_TABLES','/usr/sbin/ip','netns','exec',self.namespace,'/usr/sbin/nft','-j','list','tables');need(not any('table' in x for x in tables['nftables']),'NET_CLEANUP_FOREIGN_NAMESPACE_TABLE');links=self.read_json('OWNERSHIP_PEER_LINKS','/usr/sbin/ip','-n',self.namespace,'-j','-d','link','show');need(len(links)==1 and links[0].get('ifname')=='lo' and links[0].get('ifindex')==1,'NET_CLEANUP_FOREIGN_NAMESPACE_LINK');self.mutate('/usr/sbin/ip','netns','delete',self.namespace)
   need(self.namespace not in self.namespace_preflight(),'NET_NAMESPACE_RETAINED');need(not any(x.get('ifname') in (self.hostif,self.peerif) for x in self.read_json('CLEANUP_VERIFY_LINKS','/usr/sbin/ip','-j','link','show')),'NET_VETH_RETAINED');tables=self.read_json('CLEANUP_VERIFY_TABLES','/usr/sbin/nft','-j','list','tables');need(not any(x.get('table',{}).get('family')=='ip' and x['table'].get('name')==self.table for x in tables['nftables']),'NET_HOST_TABLE_RETAINED')
  except BaseException as error:
   self.ledger['cleanupState']='UNKNOWN';self.ledger['cleanupFailures']=[{'resource':'ownership_set_or_removal',**public_failure(error)}];self.record_failure(error,'CLEANUP_PRIMARY');raise RuntimeError('NET_CLEANUP_UNKNOWN') from error
  self.ledger['cleanupState']='REMOVAL_VERIFIED';self.ledger['cleanupFailures']=[];self.persist()
if __name__=='__main__':raise SystemExit('INACTIVE: no namespace/filter/probe execution authorized')
