"""INACTIVE finite producer. Explicit reviewed prepare() only, no CLI.
Official image is DATA. Reuses systemd, netns/nft and anchored cgroup evidence.
"""
from pathlib import Path
import hashlib,importlib.util,json,os,pwd,grp,re,secrets,shutil,stat,subprocess,tarfile,time
HERE=Path(__file__).resolve().parent
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}
CLOSED_ERROR_CODES=frozenset(('ADMISSION_CHANGED', 'ADMISSION_DEADLINE_NO_NODE', 'ADMISSION_IDENTITY_CHANGED', 'ADMISSION_MANAGER_CONTROLS', 'ADMISSION_OOM_EXEMPT', 'ADMISSION_READY', 'ADMISSION_SHORT_WRITE', 'ADMISSION_TIMEOUT_NO_NODE', 'ADMISSION_UNIT_TERMINATED', 'ASSEMBLY_BASE_CUSTODY', 'ASSEMBLY_BINDING', 'ASSEMBLY_CLOSURE_PIN', 'ASSEMBLY_DIAGNOSTIC_PHASE', 'ASSEMBLY_MOUNT_IDENTITY_CHANGED', 'ASSEMBLY_MOUNT_RETAINED', 'ASSEMBLY_RECEIPT_CUSTODY', 'ASSEMBLY_RECEIPT_PUBLIC_BOUND', 'ASSEMBLY_RECEIPT_PUBLIC_CUSTODY', 'ASSEMBLY_RESERVED_BASE_EXISTS', 'ASSEMBLY_RESERVED_BASE_SCHEMA', 'BOOTSTRAP_ACTION', 'BOOTSTRAP_ARGUMENTS', 'BOOTSTRAP_COMPONENT_FILE', 'BOOTSTRAP_COMPONENT_ROOT', 'BOOTSTRAP_EVENT_SCOPE', 'BOOTSTRAP_EVENT_VALUES', 'BOOTSTRAP_FIRST_HOSTED', 'BOOTSTRAP_NATIVE_PIN', 'BOOTSTRAP_NO_SECOND_VM_ATTEMPT', 'BOOTSTRAP_OCI_COPY_PIN', 'BOOTSTRAP_OCI_LAYER_PIN', 'BOOTSTRAP_OCI_MANIFEST', 'BOOTSTRAP_PATH', 'BOOTSTRAP_PAYLOAD_PIN', 'BOOTSTRAP_ROOT_PIN', 'BOOTSTRAP_SOURCE', 'CAPTURE_CODE', 'CAPTURE_FAILURE', 'CAPTURE_GROUP_ID', 'CAPTURE_LOG_BOUND', 'CAPTURE_SCHEMA', 'CAPTURE_TERMINAL', 'CAPTURE_UNCERTAINTY', 'CG_ANCHOR_CLOSED', 'CG_CHILD_COUNTER_STATE', 'CG_CHILD_OOM_EVENT', 'CG_COMPONENT', 'CG_CONTROL_BOUND', 'CG_CONTROL_FILE', 'CG_COUNTER_SCHEMA', 'CG_CROSS_MOUNT', 'CG_DISAPPEARED_DURING_LIVE_PROOF', 'CG_DOMAIN', 'CG_EXACT_MANAGER_PATH', 'CG_FD_MOUNT_ID', 'CG_FINAL_OOM_MISSING', 'CG_HELD_IDENTITY_CHANGED', 'CG_INITIAL_OOM_UNVERIFIED', 'CG_INVOCATION', 'CG_KERNEL_CONTROLS', 'CG_MANAGER_NOT_TERMINAL', 'CG_MANAGER_PATH_CHANGED', 'CG_MEMORY_LOCAL_EVENTS', 'CG_MOUNT_CHANGED', 'CG_MOUNT_ENTRY', 'CG_MOUNT_NAMESPACE_CHANGED', 'CG_NOT_ACQUIRED_LIVE', 'CG_OOM_BEFORE_EMPTY_PROOF', 'CG_PARENT_COUNTER_FIELDS', 'CG_PARENT_COUNTER_RANGE', 'CG_PARENT_COUNTER_RESET_OR_MISSING', 'CG_PARENT_REPLACED', 'CG_POPULATED', 'CG_REAPPEARED', 'CG_REPLACED', 'CG_REPOPULATED', 'CG_ROOT_REPLACED', 'CG_SUBTREE_BOUND', 'CG_SUBTREE_MOUNT', 'CG_SUBTREE_SYMLINK', 'CG_TERMINAL_UNIT_IDENTITY', 'CG_UNIFIED_MOUNT', 'CG_UNIT_NAME', 'CG_WRAPPER_MEMBERSHIP', 'CG_WRAPPER_NOT_LISTED', 'CG_WRAPPER_PID', 'CG_WRITERS_PRESENT', 'CLEANUP_CUSTODY_CHANGED', 'CLEANUP_UNIT_SOURCE_CHANGED', 'CLEAN_SOURCE_ARCHIVE_PIN', 'CLEAN_SOURCE_BYTES', 'CLEAN_SOURCE_HASH', 'CLEAN_SOURCE_MANIFEST_PIN', 'CLEAN_SOURCE_METADATA', 'CLEAN_SOURCE_PATH', 'CLEAN_SOURCE_SET', 'CLEAN_SOURCE_TYPE', 'COMMAND_REPLY_BOUND', 'CONTEXT_EXPECTED_EXISTS', 'CONTEXT_EXPECTED_HASH_SCHEMA', 'CONTEXT_SNAPSHOT_BOUND', 'CONTEXT_SNAPSHOT_CHANGED', 'CONTEXT_SNAPSHOT_CUSTODY', 'CONTEXT_SNAPSHOT_EVENT_BINDING', 'CONTEXT_SNAPSHOT_HASH_MISMATCH', 'CONTEXT_SNAPSHOT_HOSTED_BINDING', 'CONTEXT_SNAPSHOT_MODE', 'CONTEXT_SNAPSHOT_SCHEMA', 'CONTEXT_SNAPSHOT_SHORT_WRITE', 'CONTEXT_SNAPSHOT_STALE_OR_FUTURE', 'CONTEXT_UNPRIVILEGED_PHASE', 'DISPOSABLE_ROOT_REQUIRED', 'ENVELOPE_ADMISSION', 'ENVELOPE_ADMISSION_IDENTITY', 'ENVELOPE_CHILD_COUNTER_BINDING', 'ENVELOPE_CHILD_DESTROYED', 'ENVELOPE_CHILD_OBSERVED', 'ENVELOPE_CONTEXT_SCHEMA', 'ENVELOPE_CONTEXT_STATE', 'ENVELOPE_DESTROYED_PROOF', 'ENVELOPE_EMPTY_PROOF', 'ENVELOPE_MANAGER_TERMINAL', 'ENVELOPE_OOM_BINDING', 'ENVELOPE_OOM_COUNTERS', 'ENVELOPE_OOM_KIND', 'ENVELOPE_PREPARATION_CONTROLS', 'ENVELOPE_PROOFS_SCHEMA', 'ENVELOPE_RESULT_SCOPE', 'ENVELOPE_SAME_RUN_JOB_EVENT', 'ENVELOPE_STABLE_PROOF', 'ENVELOPE_TERMINAL_IDENTITY', 'ENVELOPE_UNCERTAINTY', 'EVIDENCE_BOUND', 'EVIDENCE_TYPE', 'EXEC_ATTEMPT_RECEIPT', 'EXPORT_ALREADY_EXISTS', 'EXPORT_SOURCE_TYPE', 'EXPORT_TOTAL_BOUND', 'EXPORT_TYPE', 'FINAL_CLEANUP_CUSTODY_CHANGED', 'GATE_BOUNDING_CAPABILITY', 'GATE_CAPABILITIES', 'GATE_CAPGET', 'GATE_DEDICATED_IDENTITY', 'GATE_EXPECTED_FAMILY_FILTER_ERRNO', 'GATE_FORBIDDEN_SOCKET_FAMILY', 'GATE_LATE_OR_LARGE_PERMISSION', 'GATE_NO_NEW_PRIVILEGES', 'GATE_PERMISSION_BINDING', 'GATE_PERMISSION_TIMEOUT', 'GATE_PROBE_DEADLINE', 'GATE_SHORT_WRITE', 'HANDOFF_ACTUAL_SOURCE_PINS', 'HANDOFF_CLOSURE_EXACT_PIN', 'HANDOFF_CLOSURE_HASH', 'HANDOFF_EFFECTIVE_OCI_BINDING', 'HANDOFF_FINAL_LEDGER_HASH', 'HANDOFF_LEDGER_NOT_FINAL', 'HANDOFF_PREPARATION_NOT_TERMINAL_CLEAN', 'HANDOFF_SOURCE_ARCHIVE', 'HANDOFF_SOURCE_NOT_READONLY_TMPFS', 'HANDOFF_SOURCE_RO_RECEIPT', 'HOSTED_API_REPLY_BOUND', 'HOSTED_EXPECTED_SCHEMA', 'HOSTED_JOB_LIST_BOUND', 'HOSTED_JOB_LIST_IDENTITY', 'HOSTED_JOB_LIST_MISMATCH', 'HOSTED_RUN_BINDING', 'HOST_ADMISSION_DEADLINE', 'HOST_COMMAND_FAILED', 'HOST_DEADLINE', 'HOST_DEADLINE_EXPIRED', 'HOST_ENDPOINT_REACHABLE', 'HOST_FORWARDING_DISABLED_NO_AUTOMATIC_SYSCTL_CHANGE', 'HOST_LATE_PERMISSION_PUBLICATION', 'HOST_NO_REMAINING_BUDGET', 'HOST_READ_DEADLINE', 'INVALID_HOST_PERMIT', 'ISOLATION_NEEDS_DISPOSABLE_ROOT', 'LATE_NPM_EXEC', 'LATE_NPM_PERMISSION', 'LATE_NPM_PERMIT', 'LATE_PROBE_PERMISSION', 'LAUNCH_ARGUMENTS', 'LAUNCH_CODE_CUSTODY', 'LAUNCH_HOSTED_FIRST_ATTEMPT', 'LAUNCH_ORDER_OFFLINE', 'LAUNCH_ORDER_OFFLINE_ASSEMBLY', 'LAUNCH_ORDER_PREPARE', 'LAUNCH_PATH', 'LAUNCH_PIN', 'LAUNCH_REVIEW_ROOT', 'LAUNCH_ROOT_CUSTODY', 'LAUNCH_ROOT_SEALED_LOCATION', 'LAUNCH_SAME_JOB_BINDING', 'LAUNCH_SAME_JOB_ID', 'LAUNCH_STAGE', 'LAUNCH_STATE_CUSTODY', 'LAUNCH_STATE_ROOT', 'LAUNCH_STATE_SHORT', 'MANAGER_ADMISSION', 'NATIVE_COUNT', 'NATIVE_MISSING', 'NATIVE_ORIGINAL_ZIP_PIN', 'NATIVE_PUBLIC_ARTIFACT_UNAVAILABLE', 'NATIVE_REDIRECT_NOT_HTTPS', 'NATIVE_ZIP_FILE_PIN', 'NATIVE_ZIP_METADATA', 'NATIVE_ZIP_PATH_COUNT', 'NETWORK_PROOF_BINDING', 'NET_CLEANUP_NAMESPACE_REPLACED', 'NET_CLEANUP_TABLE_REPLACED', 'NET_CLEANUP_UNKNOWN', 'NET_CLEANUP_VETH_REPLACED', 'NET_COMMAND_FAILED', 'NET_COUNTER_NOT_FRESH', 'NET_COUNTER_SET', 'NET_DEADLINE', 'NET_DENIED_ENDPOINT_REACHED', 'NET_DNS_RESULT_BOUND', 'NET_ENFORCEMENT_COUNTER_DELTA', 'NET_FINITE_IP_BOUND', 'NET_FORWARDING_CHANGED', 'NET_HOSTNAME_SET', 'NET_HOST_ADDRESSES_CHANGED', 'NET_HOST_FORWARDING_DISABLED_NO_GLOBAL_SYSCTL_CHANGE', 'NET_HOST_IP_FORBIDDEN', 'NET_HOST_TABLE_HANDLE', 'NET_HOST_TABLE_REPLACED', 'NET_HOST_TABLE_RETAINED', 'NET_INTERRUPTED_PENDING_CUSTODY', 'NET_JSON_DIAGNOSTIC_BOUND', 'NET_JSON_OPERATION_CLOSED', 'NET_LEDGER_SHORT', 'NET_LISTENER_LOST', 'NET_MUTATION_WITHOUT_RESERVATION', 'NET_NAMESPACE_REPLACED', 'NET_NAMESPACE_RETAINED', 'NET_NONPUBLIC_IP', 'NET_OWNED_IDENTIFIER_COLLISION', 'NET_OWN_PREFIX_COLLISION', 'NET_POLICY_IP_COUNT', 'NET_PROBE_DEADLINE', 'NET_PROBE_RESULT', 'NET_RECOVERY_IDENTIFIERS', 'NET_RECOVERY_LEDGER_CUSTODY', 'NET_RECOVERY_TAG', 'NET_REPLY_BOUND', 'NET_ROOT_REQUIRED', 'NET_RULESET_OR_TOPOLOGY_CHANGED_DURING_PROBE', 'NET_SPECIAL_OR_PLATFORM_IP', 'NET_VETH_RETAINED', 'NO_ACQUIRED_ANCHOR', 'NO_ANCHOR_FOR_CLEANUP', 'NO_DEDICATED_UID', 'NO_SECOND_ATTEMPT_AFTER_UNKNOWN', 'NO_SECOND_ATTEMPT_SAME_VM', 'OCI_ALIAS_COLLISION', 'OCI_COMPONENT', 'OCI_COMPRESSED_PIN', 'OCI_COUNTS', 'OCI_DESCRIPTOR_PIN', 'OCI_DEST_EXISTS', 'OCI_DIFF_ID_PIN', 'OCI_DIRECTORY_ALIAS', 'OCI_ENTRY_METADATA', 'OCI_EXACT_DERIVED_OVERLAYS', 'OCI_EXPANSION_BOUND', 'OCI_FILES_MISSING', 'OCI_FILE_OVERFLOW', 'OCI_FILE_PIN', 'OCI_FINAL_ENTRY_TYPE', 'OCI_FINAL_FILE', 'OCI_FINAL_HARDLINK', 'OCI_FINAL_MODE', 'OCI_FINAL_PATH_SET', 'OCI_FINAL_SYMLINK', 'OCI_FINAL_UID_GID', 'OCI_LAYER_CUSTODY', 'OCI_LAYER_DIRECTORY_CUSTODY', 'OCI_LAYER_DUPLICATE', 'OCI_LAYER_REDIRECT_HTTPS', 'OCI_LAYER_UNAVAILABLE', 'OCI_LINK_COLLISION', 'OCI_LINK_ESCAPE', 'OCI_LINK_LOOP', 'OCI_LINK_PIN', 'OCI_PATH', 'OCI_PREPARATION_FREE_DISK_12GIB', 'OCI_ROOT_ENTRY_PIN', 'OCI_ROOT_HEADER_METADATA', 'OCI_ROOT_HEADER_MISSING', 'OCI_ROOT_HEADER_TYPE', 'OCI_ROOT_REQUIRED', 'OCI_SPECIAL_FORBIDDEN', 'OCI_STAGE_EXISTS', 'OCI_UNEXPECTED_WHITEOUT', 'OCI_UNEXPECTED_XATTR', 'OFFLINE_ASSEMBLY_CUSTODY', 'OFFLINE_ASSEMBLY_PATH', 'OFFLINE_ASSEMBLY_ROOT_BINDING', 'OFFLINE_PRESPAWN_NATIVE_PIN', 'OFFLINE_PRESPAWN_SOURCE_PIN', 'OFFLINE_UNKNOWN_OR_FAILED', 'ONLINE_ISOLATION_TOOLCHAIN_SOURCE_PRODUCER_NOT_IMPLEMENTED', 'OOM_ADJUST_CHANGED', 'OOM_EVIDENCE_CONTAMINATED', 'OUTPUT_OVERFLOW', 'PACKAGE_COUNT', 'PACKAGE_HASH', 'PACKAGE_PATH', 'PACKAGE_SYMLINK', 'PERMIT_OVERSIZE', 'PERMIT_SHORT_WRITE', 'PREPARATION_ENVELOPE_PIN', 'PREPARATION_LOG_OVERFLOW', 'PREPARATION_NOT_NATURAL_SUCCESS', 'PREPARATION_RECEIPT_PIN', 'PREPARATION_UNIT_FAILED', 'PREPARATION_UNKNOWN_OR_FAILED', 'PROBE_BINDING', 'PROBE_FIXED_PEER', 'PROBE_TLS_SOCKET', 'PRODUCER_CLEANUP_CUSTODY', 'PRODUCER_COMMAND_FAILED', 'PRODUCER_DIRECTORY_CUSTODY', 'PRODUCER_ENFORCEMENT_PROOF', 'PRODUCER_HANDOFF_BYTES', 'PRODUCER_HOST_NAMESPACE_EVIDENCE', 'PRODUCER_NETWORK_CLOSURE', 'PRODUCER_OCI_BINDING', 'PRODUCER_PACKAGE_CUSTODY', 'PRODUCER_PATH', 'PRODUCER_PAYLOAD_PIN', 'PRODUCER_REAL_COUNTERS', 'PRODUCER_REPLY_BOUND', 'PRODUCER_REVIEW_ROOT', 'PRODUCER_ROOT_BINDING', 'PRODUCER_ROOT_HANDOFF_PIN', 'PRODUCER_SOCKET_FILTER_EVIDENCE', 'PRODUCER_TLS_DENIAL_RESULT', 'PRODUCER_TYPES_CLOSURE', 'PUBLIC_DOWNLOAD_BOUND', 'PUBLIC_DOWNLOAD_PIN', 'PUBLIC_INPUT_ALREADY_EXISTS', 'PUBLIC_TLS_PROBE_FAILED', 'READY_IDENTITY', 'READY_PRIVILEGES', 'REAL_NETNS_BINDING', 'RECEIPT_NOT_REGULAR', 'RECEIPT_SHORT', 'RECEIPT_SIZE', 'RECOVERY_ADMISSION_BINDING', 'RECOVERY_BASE_CUSTODY', 'RECOVERY_CLOSEOUT_CUSTODY', 'RECOVERY_INVOCATION_CHANGED_AFTER_STOP', 'RECOVERY_NO_ACQUIRED_UNIT_IDENTITY', 'RECOVERY_REVIEW_BINDING', 'RECOVERY_UNIT_IDENTITY', 'RECOVERY_UNIT_REPLACED', 'RECOVERY_UNIT_SOURCE_CUSTODY', 'ROOT_EXTRA_FILES', 'ROOT_MANIFEST_PIN', 'ROOT_STAGE_UID', 'ROOT_SYMLINK', 'RUNTIME_FAILED', 'RUNTIME_MARKER', 'RUNTIME_METADATA', 'RUNTIME_WALL_TIMEOUT', 'SEAL_CONTEXT_ONCE', 'SEAL_CONTEXT_PHASE', 'SEAL_CONTEXT_SOURCE', 'SERVICE_PATH', 'SERVICE_TEMPLATE', 'SOURCE_ARCHIVE_CUSTODY', 'SOURCE_DIRECTORY_CUSTODY', 'STANDARD_HOSTED_JOB_REQUIRED', 'STANDARD_HOSTED_VM_BINDING', 'SYSTEMD_HOST_REQUIRED', 'TAP_EXACT_ELEVEN_NAMES', 'TAP_FAILED', 'TAP_SUMMARY', 'TERMINAL_NOT_NATURAL_SUCCESS', 'TEST_SOURCE_PIN', 'TRANSPORT_ARGUMENT', 'TYPECHECK_ALREADY_EXISTS', 'TYPECHECK_CAPTURE_HELPER_PIN', 'TYPECHECK_COMPILER_PIN', 'TYPECHECK_DEPENDENCY_INSTALL_FAILED', 'TYPECHECK_DEPENDENCY_VERSION_MISMATCH', 'TYPECHECK_EXPECTED_DEPENDENCY_VERSIONS', 'TYPECHECK_FINAL_LOCK_CHANGED', 'TYPECHECK_IMAGE_TOOLCHAIN_PIN', 'TYPECHECK_LOCK_MUTATED', 'TYPECHECK_LOCK_PIN', 'TYPECHECK_RECEIPT_SHORT', 'TYPECHECK_REPOSITORY_TYPES_FAILED', 'TYPECHECK_SOURCE_PIN', 'TYPECHECK_SOURCE_SET', 'TYPES_CLOSURE_BINDING', 'TYPES_COMPILER', 'TYPES_ISOLATION_CONTRACT_MISSING', 'TYPES_LOCK', 'TYPES_PASS', 'TYPES_SCOPE', 'TYPES_SOURCE', 'TYPES_STATE', 'UID_BECAME_ASSIGNED', 'UID_HOST_PROCESS_COLLISION', 'UNBOUNDED_DESCRIPTOR_LIMIT', 'UNCLASSIFIED_CLOSED_CODE', 'UNIT_CLEANUP_SOURCE_CHANGED', 'UNIT_DIED_BEFORE_PERMISSION', 'UNIT_TEMPLATE', 'UNIT_VALUE'))
CLOSED_ERROR_CLASSES=frozenset(('RuntimeError','JSONDecodeError','OSError','FileNotFoundError','FileExistsError','PermissionError','TimeoutError','TimeoutExpired','CalledProcessError','ValueError','KeyError','TypeError','AssertionError','MemoryError','KeyboardInterrupt','SystemExit'))
def public_failure(error):
 cls=type(error).__name__;code=error.args[0] if type(error) is RuntimeError and len(error.args)==1 and type(error.args[0]) is str else None
 return {'failureClass':cls if cls in CLOSED_ERROR_CLASSES else 'OTHER_EXCEPTION','failureCode':code if code in CLOSED_ERROR_CODES else 'UNCLASSIFIED_CLOSED_CODE'}
def need(x,c):
 if not x:raise RuntimeError(c)
def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def verify(rootsha):
 need(HERE.stat().st_uid==0 and not HERE.stat().st_mode&0o022,'PRODUCER_DIRECTORY_CUSTODY')
 need(re.fullmatch('[a-f0-9]{64}',rootsha or '') and sha(HERE/'SHA256.json')==rootsha,'PRODUCER_REVIEW_ROOT')
 for name,wanted in json.loads((HERE/'SHA256.json').read_text()).items():
  rel=Path(name);need(not rel.is_absolute() and '..' not in rel.parts,'PRODUCER_PATH');p=HERE/rel
  need(not any(q.is_symlink() for q in [p,*p.parents] if q!=HERE.parent) and p.is_file() and sha(p)==wanted,'PRODUCER_PAYLOAD_PIN');st=p.stat();need(st.st_uid==0 and st.st_nlink==1 and not st.st_mode&0o022,'PRODUCER_PACKAGE_CUSTODY')
def load(name):
 spec=importlib.util.spec_from_file_location(name.replace('.','_'),HERE/name);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def command(*args,timeout=5):
 p=subprocess.run(args,env=ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 need(len(p.stdout)<=262144 and len(p.stderr)<=65536,'PRODUCER_REPLY_BOUND');need(p.returncode==0,'PRODUCER_COMMAND_FAILED');return p.stdout.decode().strip()
def bounded(path,limit):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  need(stat.S_ISREG(os.fstat(fd).st_mode),'RECEIPT_NOT_REGULAR');raw=os.read(fd,limit+1);need(len(raw)<=limit,'RECEIPT_SIZE');return raw
 finally:os.close(fd)
def durable(path,value,uid=None,deadline=None,anchor=None):
 raw=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode();tmp=path.with_name(path.name+'.pending');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o400 if uid is not None else 0o600)
 try:
  need(os.write(fd,raw)==len(raw),'RECEIPT_SHORT');os.fsync(fd)
  if uid is not None:os.fchown(fd,uid,uid)
 finally:os.close(fd)
 if anchor is not None:anchor.continuity()
 if deadline is not None:need(time.monotonic()<deadline,'HOST_LATE_PERMISSION_PUBLICATION')
 os.rename(tmp,path);d=os.open(path.parent,os.O_DIRECTORY)
 try:os.fsync(d)
 finally:os.close(d)
def unused_uid():
 assigned={x.pw_uid for x in pwd.getpwall()}|{x.gr_gid for x in grp.getgrall()};live=set()
 for directory in Path('/proc').iterdir():
  if not directory.name.isdigit():continue
  try:
   lines=(directory/'status').read_text().splitlines()
  except FileNotFoundError:continue
  for line in lines:
   if line.startswith(('Uid:','Gid:')):live.update(map(int,line.split()[1:]))
 choices=[n for n in range(62000,64000) if n not in assigned|live];need(bool(choices),'NO_DEDICATED_UID');return choices[secrets.randbelow(len(choices))]
def still_unused(uid):
 need(uid not in {x.pw_uid for x in pwd.getpwall()} and uid not in {x.gr_gid for x in grp.getgrall()},'UID_BECAME_ASSIGNED')
 for directory in Path('/proc').iterdir():
  if not directory.name.isdigit():continue
  try:lines=(directory/'status').read_text().splitlines()
  except FileNotFoundError:continue
  need(not any(uid in map(int,l.split()[1:]) for l in lines if l.startswith(('Uid:','Gid:'))),'UID_HOST_PROCESS_COLLISION')
def extract_source(archive,work,uid,extractor):
 receipt=json.loads((HERE/'PUBLIC-SOURCE-RECEIPT.json').read_text());archive=Path(archive);st=archive.lstat();need(archive.parent.stat().st_uid==0 and not archive.parent.stat().st_mode&0o022,'SOURCE_DIRECTORY_CUSTODY');need(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_nlink==1 and not st.st_mode&0o022,'SOURCE_ARCHIVE_CUSTODY');need(sha(archive)==receipt['sourceArchiveSha256'] and Path(archive).stat().st_size==receipt['sourceArchiveBytes'],'CLEAN_SOURCE_ARCHIVE_PIN');rows=json.loads((HERE/'PUBLIC-SOURCE-MANIFEST.json').read_text());need(sha(HERE/'PUBLIC-SOURCE-MANIFEST.json')==receipt['sourceManifestSha256'],'CLEAN_SOURCE_MANIFEST_PIN');wanted={r['path']:r for r in rows};source=work/'source';source.mkdir(mode=0o755);seen=set();total=0
 with tarfile.open(archive,'r:gz') as t:
  for row in t:
   name=extractor.relpath(row.name.rstrip('/'));need(name.split('/')[0]!='.git' and name not in seen,'CLEAN_SOURCE_PATH');seen.add(name);need(row.isdir() or row.isfile(),'CLEAN_SOURCE_TYPE')
   path=source/name
   if row.isdir():path.mkdir(mode=0o755,parents=True,exist_ok=True);continue
   item=wanted[name];need(row.size==item['bytes'] and row.mode==item['mode'],'CLEAN_SOURCE_METADATA');total+=row.size;need(total<=33554432,'CLEAN_SOURCE_BYTES');path.parent.mkdir(mode=0o755,parents=True,exist_ok=True);parent,leaf=extractor.parentfd(source,name);fd=os.open(leaf,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent);h=hashlib.sha256()
   try:
    with t.extractfile(row) as f:
     while True:
      b=f.read(1048576)
      if not b:break
      h.update(b);view=memoryview(b)
      while view:view=view[os.write(fd,view):]
    need(h.hexdigest()==item['sha256'],'CLEAN_SOURCE_HASH');os.fchmod(fd,row.mode);os.fchown(fd,uid,uid)
   finally:os.close(fd);os.close(parent)
 need({p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}==set(wanted),'CLEAN_SOURCE_SET')
 for p in [source,*[p for p in source.rglob('*') if p.is_dir()]]:os.chown(p,uid,uid)
 return source
PROPS='Id,InvocationID,NRestarts,LoadState,ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,MainPID,ControlPID,ControlGroup,Type,ExitType,RemainAfterExit,User,Group,RootDirectory,NetworkNamespacePath,RestrictAddressFamilies,SystemCallArchitectures,NoNewPrivileges,CapabilityBoundingSet,AmbientCapabilities,ProtectSystem,ProtectHome,KillMode,Restart,RuntimeMaxUSec,TimeoutStopUSec,OOMPolicy,OOMScoreAdjust,MemoryMax,MemorySwapMax,TasksMax,CPUQuotaPerSecUSec,CPUQuotaPeriodUSec'
def state(unit,deadline):
 remaining=deadline-time.monotonic();need(remaining>0,'HOST_DEADLINE');raw=command('/usr/bin/systemctl','show',unit,'--property='+PROPS,timeout=min(5,remaining));need(time.monotonic()<deadline,'HOST_DEADLINE');return dict(l.split('=',1) for l in raw.splitlines())
def wait_file(path,limit,deadline,unit):
 while True:
  need(time.monotonic()<deadline,'HOST_ADMISSION_DEADLINE');s=state(unit,deadline);need(s.get('ActiveState') not in ('failed','inactive'),'UNIT_DIED_BEFORE_PERMISSION')
  try:raw=bounded(path,limit)
  except FileNotFoundError:time.sleep(.02);continue
  need(time.monotonic()<deadline,'HOST_READ_DEADLINE');return json.loads(raw),s

def assemble(layer_directory,source_archive,reviewroot,reserved_base):
 # Launcher persists exact reserved locator and ASSEMBLY_ATTEMPTED before this
 # first directory creation. No second attempt, even if create outcome is lost.
 verify(reviewroot);need(os.geteuid()==0,'DISPOSABLE_ROOT_REQUIRED');base=Path(reserved_base);need(re.fullmatch('/tmp/daemon-oci-prep-[a-f0-9]{16}',str(base)) and base.parent==Path('/tmp'),'ASSEMBLY_RESERVED_BASE_SCHEMA');need(not base.exists() and not base.is_symlink(),'ASSEMBLY_RESERVED_BASE_EXISTS')
 base.mkdir(mode=0o700);root=base/'root';work=base/'work';validation=base/'validation';receipt=base/'assembly-closeout.json';result={'state':'ASSEMBLY_ATTEMPTED','reviewRootSha256':reviewroot,'productExecuted':False,'phase':'BEFORE_PREREQUISITES','cleanupUnknown':False};mounted=False;durable(receipt,result)
 def checkpoint(phase):
  need(phase in ('BEFORE_FORWARDING_READ','BEFORE_ENDPOINT_DISCOVERY','BEFORE_UID_SELECTION','BEFORE_WORK_DIRECTORY','BEFORE_VALIDATION_DIRECTORY','BEFORE_OCI_RECONSTRUCTION','BEFORE_HOST_METADATA','BEFORE_PUBLIC_OVERLAYS','BEFORE_WORK_TMPFS','BEFORE_SOURCE_EXTRACTION','BEFORE_VALIDATION_COPY','BEFORE_CLOSURE_WRITE','ASSEMBLY_COMPLETE'),'ASSEMBLY_DIAGNOSTIC_PHASE');result['phase']=phase;durable(receipt,result)
 try:
  checkpoint('BEFORE_FORWARDING_READ');need(Path('/proc/sys/net/ipv4/ip_forward').read_text().strip()=='1','HOST_FORWARDING_DISABLED_NO_AUTOMATIC_SYSCTL_CHANGE')
  checkpoint('BEFORE_ENDPOINT_DISCOVERY');networkmod=load('network.INACTIVE.py');policy=networkmod.discover({'registry.npmjs.org','github.com','codeload.github.com','objects.githubusercontent.com','release-assets.githubusercontent.com'});result['networkPolicy']=policy
  checkpoint('BEFORE_UID_SELECTION');uid=unused_uid();result['uid']=uid;extractor=load('oci-rootfs.INACTIVE.py')
  checkpoint('BEFORE_WORK_DIRECTORY');work.mkdir(mode=0o700);checkpoint('BEFORE_VALIDATION_DIRECTORY');validation.mkdir(mode=0o755)
  checkpoint('BEFORE_OCI_RECONSTRUCTION')
  result['rootfs']=extractor.build(layer_directory,root);checkpoint('BEFORE_HOST_METADATA');result['hostSystemdVersion']=command('/usr/bin/systemctl','--version')[:4096];result['hostKernel']=os.uname().release;durable(receipt,result)
  # Explicit deterministic public overlays, not host resolver/config binds.
  checkpoint('BEFORE_PUBLIC_OVERLAYS');hosts='127.0.0.1 localhost\n'+''.join(ip+' '+host+'\n' for host,ips in policy['endpoints'].items() for ip in ips)
  (root/'etc/hosts').write_text(hosts);(root/'etc/resolv.conf').write_text('');(root/'etc/nsswitch.conf').write_text('hosts: files\n');(root/'etc/gitconfig').write_text('')
  for d in ('validation','work'): (root/d).mkdir(mode=0o755,exist_ok=True)
  overlay={'etc/hosts':hashlib.sha256(hosts.encode()).hexdigest(),'etc/resolv.conf':sha(root/'etc/resolv.conf'),'etc/nsswitch.conf':sha(root/'etc/nsswitch.conf'),'etc/gitconfig':sha(root/'etc/gitconfig')};result['publicOverlay']=overlay
  checkpoint('BEFORE_WORK_TMPFS');result['mountLedger']={'target':str(work),'kind':'tmpfs','state':'ATTEMPTED_RESULT_UNKNOWN'};durable(receipt,result);command('/usr/bin/mount','-t','tmpfs','-o',f'rw,nosuid,nodev,size=8589934592,nr_inodes=1048576,uid={uid},gid={uid},mode=0700','tmpfs',str(work));mounted=True;result['mountLedger']['state']='COMMAND_ACKNOWLEDGED';durable(receipt,result);checkpoint('BEFORE_SOURCE_EXTRACTION');extract_source(source_archive,work,uid,extractor)
  checkpoint('BEFORE_VALIDATION_COPY')
  for name in ('online-gate.INACTIVE.py','fulltypes.INACTIVE.py','bounded-public-command.INACTIVE.py','PUBLIC-SOURCE-MANIFEST.json','TOOLCHAIN-PINS.json','candidate.patch','CHILD-CODE-PINS.json'):
   (validation/name).write_bytes((HERE/name).read_bytes());(validation/name).chmod(0o444)
  checkpoint('BEFORE_CLOSURE_WRITE');closure={'schemaVersion':1,'ociPlatformDigest':'sha256:'+extractor.MANIFEST,'ociInventorySha256':sha(HERE/'OCI-FINAL-LOGICAL-INVENTORY.json'),'modeOverlaySha256':sha(HERE/'MODE-OVERLAY.json'),'ownerOverlaySha256':sha(HERE/'OWNER-OVERLAY.json'),'effectiveManifestSha256':result['rootfs']['effectiveManifestSha256'],'sourceManifestSha256':sha(HERE/'PUBLIC-SOURCE-MANIFEST.json'),'sourceArchiveSha256':sha(source_archive),'publicOverlay':overlay,'toolchainPinsSha256':sha(HERE/'TOOLCHAIN-PINS.json'),'reviewRootSha256':reviewroot,'networkPolicy':policy};durable(validation/'PREPARATION-CLOSURE.json',closure);(validation/'PREPARATION-CLOSURE.json').chmod(0o444);result['preparationClosureSha256']=sha(validation/'PREPARATION-CLOSURE.json')
  checkpoint('ASSEMBLY_COMPLETE');result.update(state='ASSEMBLED_PUBLIC_SOURCE_TOOLCHAIN_ONLY',base=str(base),sourceArchiveSha256=sha(source_archive),mountedWork=True,assemblyProcessExecutedProduct=False);durable(receipt,result)
  return {'assemblyReceipt':str(receipt),'assemblyReceiptSha256':sha(receipt)}
 except BaseException as error:
  result.update(state='ASSEMBLY_FAILED',cleanupUnknown=False,**public_failure(error));durable(receipt,result)
  if result.get('mountLedger'):
   try:
    rows=[line for line in Path('/proc/self/mountinfo').read_text().splitlines() if line.split()[4]==str(work)]
    if rows:
     need(len(rows)==1 and rows[0].split(' - ',1)[1].split()[0]=='tmpfs','ASSEMBLY_MOUNT_IDENTITY_CHANGED');result['mountLedger']['cleanupState']='UNMOUNT_ATTEMPTED';durable(receipt,result);command('/usr/bin/umount',str(work))
    need(not any(line.split()[4]==str(work) for line in Path('/proc/self/mountinfo').read_text().splitlines()),'ASSEMBLY_MOUNT_RETAINED');result['mountLedger']['cleanupState']='REMOVAL_VERIFIED'
   except BaseException:result['cleanupUnknown']=True
  result['privateStageRetainedUntilVMTeardown']=True;durable(receipt,result)
  raise

def prepare(assembly_receipt,assembly_sha,reviewroot,context_path,expected_context):
 verify(reviewroot);need(os.geteuid()==0,'DISPOSABLE_ROOT_REQUIRED');need(Path('/proc/1/comm').read_text().strip()=='systemd','SYSTEMD_HOST_REQUIRED')
 assembly_path=Path(assembly_receipt);need(assembly_path.stat().st_uid==0 and not assembly_path.stat().st_mode&0o022 and sha(assembly_path)==assembly_sha,'ASSEMBLY_RECEIPT_CUSTODY');assembled=json.loads(bounded(assembly_path,65536));need(assembled.get('state')=='ASSEMBLED_PUBLIC_SOURCE_TOOLCHAIN_ONLY' and assembled.get('reviewRootSha256')==reviewroot and assembled.get('productExecuted') is False,'ASSEMBLY_BINDING')
 # Fresh authenticated context is obtained by the future launcher AFTER the
 # potentially long data reconstruction, never before it.
 contextmod=load('reviewed/context-snapshot.INACTIVE.py');context=contextmod.read_for_root(context_path,expected_context)
 base=Path(assembled['base']);need(re.fullmatch('/tmp/daemon-oci-prep-[a-f0-9]{16}',str(base)) and base==assembly_path.parent and base.stat().st_uid==0 and not base.stat().st_mode&0o077,'ASSEMBLY_BASE_CUSTODY');root=base/'root';work=base/'work';validation=base/'validation';uid=assembled['uid'];policy=assembled['networkPolicy'];need(sha(validation/'PREPARATION-CLOSURE.json')==assembled['preparationClosureSha256'],'ASSEMBLY_CLOSURE_PIN');networkmod=load('network.INACTIVE.py');observer=load('reviewed/anchored-cgroup.INACTIVE.py');contracts=load('reviewed/receipt-contract.INACTIVE.py');still_unused(uid)
 receipt=base/'closeout.json';unit='daemon-state-fs-'+secrets.token_hex(8)+'.service';unitfile=Path('/run/systemd/system')/unit;result={**assembled,'state':'UNKNOWN','publicContext':context,'forcedCleanup':False,'cleanupUnknown':False,'evidenceUnknown':False,'cleanupSafe':False};network=None;anchor=None;started=False;terminal=False;mounted=True;durable(receipt,result)
 def owned_command(*args,timeout=5):
  owned=result.setdefault('ownedResourceLedger',{'networkLedger':str(base/'network-ledger.json'),'unit':unit,'unitFile':str(unitfile),'unitWriteAttempted':False,'startAttempted':False});entry={'argv':list(args),'state':'ATTEMPTED_RESULT_UNKNOWN'};owned.setdefault('hostMutations',[]).append(entry);durable(receipt,result)
  value=command(*args,timeout=timeout);entry['state']='COMMAND_ACKNOWLEDGED';durable(receipt,result);return value
 try:
  network=networkmod.OwnedNetwork(policy,base/'network-ledger.json');result['ownedResourceLedger']={'networkLedger':str(base/'network-ledger.json'),'unit':unit,'unitFile':str(unitfile),'unitWriteAttempted':False,'startAttempted':False};durable(receipt,result);before=network.setup();result['networkBefore']=before;still_unused(uid);contextmod.read_for_root(context_path,expected_context)
  text=(HERE/'preparation.service.INACTIVE').read_text()
  for key,value in (('@UID@',uid),('@ROOT@',root),('@VALIDATION@',validation),('@WORK@',work),('@NETNS@',network.namespace)):
   need(re.fullmatch('[A-Za-z0-9_./-]+',str(value)),'UNIT_VALUE');text=text.replace(key,str(value))
  need('@' not in text and not unitfile.exists(),'UNIT_TEMPLATE');result['ownedResourceLedger']['unitWriteAttempted']=True;result['ownedResourceLedger']['unitSourceSha256']=hashlib.sha256(text.encode()).hexdigest();durable(receipt,result);unitfile.write_text(text);unitfile.chmod(0o600);owned_command('/usr/bin/systemctl','daemon-reload');started=True;result['ownedResourceLedger']['startAttempted']=True;durable(receipt,result);owned_command('/usr/bin/systemctl','start','--no-block',unit);deadline=time.monotonic()+8;ready,s=wait_file(work/'ready.json',2048,deadline,unit)
  need(ready.get('kind')=='ONLINE_BEFORE_NPM_AND_PROBE' and str(ready.get('pid'))==s.get('MainPID') and re.fullmatch('[a-f0-9]{64}',ready.get('nonce','')),'READY_IDENTITY');need(ready.get('uid')==ready.get('gid')==uid and ready.get('supplementaryGroups')==[] and ready.get('noNewPrivileges') is True and ready.get('allCapabilitiesZero') is True and ready.get('nonStdioDescriptorsClosedBeforeGate') is True and ready.get('familyDenials')==[{'family':f,'socketType':k,'protocol':proto,'errno':97} for f,k,proto in ((1,1,0),(10,1,0),(17,2,768),(16,3,0))],'READY_PRIVILEGES')
  wanted={'Id':unit,'User':str(uid),'Group':str(uid),'RootDirectory':str(root),'NetworkNamespacePath':'/run/netns/'+network.namespace,'RestrictAddressFamilies':'AF_INET','SystemCallArchitectures':'native','NoNewPrivileges':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','ProtectSystem':'strict','ProtectHome':'yes','OOMPolicy':'kill','OOMScoreAdjust':'0','MemoryMax':'4294967296','MemorySwapMax':'0','TasksMax':'256','CPUQuotaPerSecUSec':'2s','CPUQuotaPeriodUSec':'100ms','RuntimeMaxUSec':'10min','TimeoutStopUSec':'5s','Type':'exec','ExitType':'cgroup','RemainAfterExit':'yes','KillMode':'control-group','Restart':'no','NRestarts':'0','ActiveState':'active','SubState':'running','ControlPID':'0'}
  need(all(s.get(k)==v for k,v in wanted.items()),'MANAGER_ADMISSION');need(Path('/proc/'+str(ready['pid'])+'/ns/net').stat().st_ino==Path('/run/netns/'+network.namespace).stat().st_ino,'REAL_NETNS_BINDING')
  controls={'memory.max':'4294967296','memory.swap.max':'0','memory.oom.group':'1','pids.max':'256','cpu.max':'200000 100000'};anchor=observer.Anchor(s.get('ControlGroup'),unit,s.get('InvocationID'),ready['pid'],expected_controls=controls);result['admission']=anchor.record();result['ownedResourceLedger']['acquiredUnitIdentity']={'unit':unit,'invocationId':s.get('InvocationID'),'controlGroup':s.get('ControlGroup'),'admission':result['admission']};durable(receipt,result);again=state(unit,deadline);need(all(again.get(k)==s.get(k) for k in ('InvocationID','MainPID','ControlGroup','SubState','NRestarts')),'ADMISSION_CHANGED');need(Path('/proc/'+str(ready['pid'])+'/oom_score_adj').read_text().strip()=='0','OOM_ADJUST_CHANGED');anchor.continuity();need(time.monotonic()<deadline,'LATE_PROBE_PERMISSION');durable(work/'probe-permit.json',{'pid':ready['pid'],'nonce':ready['nonce'],'peerHostIP':network.hostip,'peerHostPort':network.probePort},uid=uid,deadline=deadline,anchor=anchor)
  deadline=time.monotonic()+9;probe,s=wait_file(work/'network-probe.json',2048,deadline,unit);need(probe.get('nonce')==ready['nonce'] and probe.get('pid')==ready['pid'] and probe.get('tlsVerified') is True,'PROBE_BINDING');result['networkProof']=network.confirm_probe(before,probe,deadline);durable(base/'network-proof.json',result['networkProof']);proofsha=sha(base/'network-proof.json');result['networkProofSha256']=proofsha;result['familyFilterEvidence']=ready['familyDenials'];result['nonStdioDescriptorsClosedBeforeGate']=True;durable(receipt,result)
  anchor.continuity();contextmod.read_for_root(context_path,expected_context);need(time.monotonic()<deadline,'LATE_NPM_PERMISSION');durable(work/'npm-permit.json',{'pid':ready['pid'],'nonce':ready['nonce'],'networkProofSha256':proofsha},uid=uid,deadline=deadline,anchor=anchor);deadline=time.monotonic()+600
  while True:
   s=state(unit,deadline)
   for name in ('preparation.log','result/install.log','result/types.log'):
    path=work/name
    if path.exists():need(path.stat().st_size<=1048576,'PREPARATION_LOG_OVERFLOW')
   need(s.get('ActiveState')!='failed','PREPARATION_UNIT_FAILED')
   if s.get('ActiveState')=='active' and s.get('SubState')=='exited':break
   time.sleep(.1)
  result['terminalManager']=s;need(s.get('Result')=='success' and s.get('ExecMainCode')=='1' and s.get('ExecMainStatus')=='0','PREPARATION_NOT_NATURAL_SUCCESS');result['terminal']=anchor.prove_empty(s);terminal=True;result['cleanupSafe']=True;durable(receipt,result);result['oom']=anchor.prove_no_oom(result['terminal']);durable(receipt,result)
  types_path=work/'result/receipt.json';types=json.loads(bounded(types_path,32768));contracts.validate_types(types,sha(HERE/'candidate.patch'));need(types.get('preparationClosureSha256')==result['preparationClosureSha256'],'TYPES_CLOSURE_BINDING');result.update(state='PREPARED_FULLTYPES_ONLY',preparationReceipt=str(types_path),preparationReceiptSha256=sha(types_path));contracts.validate_envelope(result,context,reviewroot)
 except BaseException as error:
  result['state']='UNKNOWN';result['failureClass']=type(error).__name__;msg=str(error);result['failureCode']=msg if re.fullmatch('[A-Z][A-Z0-9_]{0,100}',msg) else 'PREPARATION_UNCLASSIFIED'
 finally:
  if started and not terminal:
   result['forcedCleanup']=True
   try:
    owned_command('/usr/bin/systemctl','stop',unit,timeout=8);s=state(unit,time.monotonic()+5);result['cleanupManager']=s;need(anchor is not None,'NO_ANCHOR_FOR_CLEANUP');result['cleanupTerminal']=anchor.prove_empty(s);terminal=True;result['cleanupSafe']=True;durable(receipt,result)
   except BaseException:result['cleanupUnknown']=True
  if terminal or not started:
   try:
    selected=base/'selected';selected.mkdir(mode=0o700);exports=[]
    for path,name,limit in ((work/'result/receipt.json','types-receipt.json',32768),(work/'result/install.log','types-install.log',1048576),(work/'result/types.log','types-types.log',1048576),(work/'preparation.log','preparation.log',1048576),(base/'network-proof.json','network-proof.json',262144),(base/'network-ledger.json','network-ledger-before-cleanup.json',262144),(validation/'PREPARATION-CLOSURE.json','preparation-closure.json',32768)):
     if not path.exists():continue
     need(path.is_file() and not path.is_symlink(),'EXPORT_TYPE')
     with path.open('rb') as f:raw=f.read(limit+1)
     partial=len(raw)>limit;(selected/name).write_bytes(raw[:limit]);exports.append({'file':name,'bytes':len(raw[:limit]),'partial':partial,'sha256':sha(selected/name)})
     if partial:result['evidenceUnknown']=True
    result['exports']=exports
   except BaseException:result['evidenceUnknown']=True
   try:
    if started:owned_command('/usr/bin/systemctl','stop',unit,timeout=8)
    if unitfile.exists():need(sha(unitfile)==result['ownedResourceLedger']['unitSourceSha256'],'UNIT_CLEANUP_SOURCE_CHANGED');unitfile.unlink();owned_command('/usr/bin/systemctl','daemon-reload')
    result['ownedUnitRemoved']=True
    if network:network.cleanup();result['ownedNetworkRemoved']=True
    if mounted:owned_command('/usr/bin/mount','-o','remount,ro,nosuid,nodev',str(work));result['workRemountedReadOnly']=True
    # Work/source must stay mounted and immutable after stop until offline
    # consumer verifies receipt+source then copies its FOUR pinned files. Only
    # public data retained. DisposableVM teardown is the final cleanup route.
   except BaseException:result['cleanupUnknown']=True
  # Final ledger is exported AFTER cleanup attempts, never mistaken for the
  # earlier snapshot. Even UNKNOWN cleanup retains its final state and hash.
  ledger_path=base/'network-ledger.json'
  if (base/'selected').is_dir() and ledger_path.exists():
   try:
    raw=bounded(ledger_path,262144);target=base/'selected/network-ledger.json';target.write_bytes(raw);result['networkLedgerFinal']={'file':'network-ledger.json','bytes':len(raw),'sha256':sha(target),'copiedAfterCleanupAttempt':True};result.setdefault('exports',[]).append({**result['networkLedgerFinal'],'partial':False})
   except BaseException:result['evidenceUnknown']=True
  if anchor:anchor.close()
  if result['forcedCleanup'] or result['cleanupUnknown'] or result['evidenceUnknown']:result['state']='UNKNOWN'
  if result.get('state')=='PREPARED_FULLTYPES_ONLY' and result.get('workRemountedReadOnly') is not True:result['state']='UNKNOWN'
  result['publicSourceRetainedUntilOfflineCopyOrVMTeardown']=True;result['workTmpfsRetained']=mounted
  if result['state']=='PREPARED_FULLTYPES_ONLY':
   try:load('producer-contract.INACTIVE.py').validate(result,json.loads((validation/'PREPARATION-CLOSURE.json').read_text()),reviewroot,types)
   except BaseException as error:result['state']='UNKNOWN';result['contractFailureClass']=type(error).__name__
  durable(receipt,result)
  if (base/'selected').is_dir():(base/'selected/closeout.json').write_bytes(receipt.read_bytes())
 return {'receipt':str(receipt),'result':result}
def reconcile_owned(closeout_path,closeout_sha,reviewroot):
 # This entry cannot resurrect held cgroup/pidfd handles from a JSON record.
 # It may request stop ONLY under verified acquired invocation custody. Without
 # current no-live-writers proof it NEVER removes network, unit or evidence.
 verify(reviewroot);path=Path(closeout_path);st=path.lstat();need(st.st_uid==0 and st.st_nlink==1 and not st.st_mode&0o077 and not path.is_symlink() and sha(path)==closeout_sha,'RECOVERY_CLOSEOUT_CUSTODY');result=json.loads(bounded(path,262144));need(result.get('reviewRootSha256')==reviewroot,'RECOVERY_REVIEW_BINDING');owned=result.get('ownedResourceLedger',{});base=path.parent;need(re.fullmatch('/tmp/daemon-oci-prep-[a-f0-9]{16}',str(base)) and base.stat().st_uid==0 and not base.stat().st_mode&0o077,'RECOVERY_BASE_CUSTODY');unit=owned.get('unit');need(re.fullmatch('daemon-state-fs-[a-f0-9]{16}\.service',unit or '') and owned.get('unitFile')=='/run/systemd/system/'+unit,'RECOVERY_UNIT_IDENTITY')
 recovery={'state':'UNKNOWN_INTERRUPTED_RUN_NOT_VALIDATION','networkRetained':True,'unitFileRetained':True,'evidenceRetained':True,'stopRequested':False,'noLiveWritersProved':False,'managerZeroIsNotCgroupProof':True,'workAndRootRetainedUntilVMTeardown':True,'noPrefixSweep':True,'blocker':'HELD_CGROUP_CUSTODY_NOT_RECOVERABLE_FROM_JSON','resourceReconciliationFailures':[]}
 record=base/('recovery-'+secrets.token_hex(4)+'.json');durable(record,recovery)
 try:
  file=Path(owned['unitFile']);need(file.is_file() and not file.is_symlink() and file.stat().st_uid==0 and not file.stat().st_mode&0o077 and sha(file)==owned.get('unitSourceSha256'),'RECOVERY_UNIT_SOURCE_CUSTODY')
  acquired=owned.get('acquiredUnitIdentity');need(isinstance(acquired,dict) and acquired.get('unit')==unit and acquired.get('admission')==result.get('admission'),'RECOVERY_NO_ACQUIRED_UNIT_IDENTITY');invocation=acquired.get('invocationId');need(re.fullmatch('[a-f0-9]{32}',invocation or '') and acquired['admission'].get('invocationId')==invocation and acquired['admission'].get('controlGroup')==acquired.get('controlGroup'),'RECOVERY_ADMISSION_BINDING')
  current=state(unit,time.monotonic()+5);need(current.get('Id')==unit and current.get('InvocationID')==invocation and current.get('NRestarts')=='0' and current.get('ControlGroup') in ('',acquired['controlGroup']),'RECOVERY_UNIT_REPLACED')
  if owned.get('startAttempted'):
   recovery['stopRequested']=True;recovery['stopAttemptState']='ATTEMPTED_RESULT_UNKNOWN';durable(record,recovery);command('/usr/bin/systemctl','stop',unit,timeout=8);recovery['stopAttemptState']='COMMAND_ACKNOWLEDGED';recovery['managerAfterStop']=state(unit,time.monotonic()+5);need(recovery['managerAfterStop'].get('InvocationID')==invocation,'RECOVERY_INVOCATION_CHANGED_AFTER_STOP');durable(record,recovery)
  # manager0 and a historical persisted terminal proof cannot recreate held
  # kernel identities. Safe conservative fallback is VM teardown, even after
  # acknowledged stop. No network.cleanup(), unlink or remount follows here.
 except BaseException as error:
  recovery['resourceReconciliationFailures'].append({'resource':'unitStopCustody','error':type(error).__name__});durable(record,recovery)
 durable(record,recovery);return {'receipt':str(record),'result':recovery}
if __name__=='__main__':raise SystemExit('INACTIVE: no producer execution/activation authorized')
