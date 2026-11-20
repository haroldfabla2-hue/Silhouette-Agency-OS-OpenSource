"""Unwired core-only containment harness. No product/native-addon imports.
Run only after review of the complete source and an external immutable anchor.
No workflow calls this file. Dynamic cases have NOT been run by its unit tests.
"""
import os,sys,pathlib,json,hashlib,subprocess,time,stat,secrets,signal,selectors,errno,socket,ctypes,importlib.util,re
D=pathlib.Path(__file__).resolve().parent
CASES=('core','work-bytes','work-inodes','pids','memory','descendant','pipe','timeout')
SOURCE_NAMES={'containment-harness.py','containment-control-contract.py','containment-bootstrap-contract.py'}
KEYS=('Id','Description','InvocationID','MainPID','ControlGroup','ActiveState','SubState','KillMode','RuntimeMaxUSec','TimeoutStopUSec','OOMPolicy','Restart','RemainAfterExit','SendSIGKILL','Type','Result','ExecMainCode','ExecMainStatus')

def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def load_module(name):
 spec=importlib.util.spec_from_file_location(name,D/name);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def exact_int(v,minimum=0):assert type(v) is int and v>=minimum,'INTEGER_SCHEMA';return v

def read_json(path,limit=16384):
 p=pathlib.Path(path);s=p.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_size<=limit and not s.st_mode&0o077,'PRIVATE_RECORD'
 return json.loads(p.read_text())

def atomic_record(directory,name,value,limit=16384):
 raw=json.dumps(value,sort_keys=True).encode();assert len(raw)<=limit and '/' not in name,'RECORD_LIMIT'
 temp=directory/(name+'.'+secrets.token_hex(8));fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  os.link(temp,directory/name,follow_symlinks=False) # atomic, fails if final exists
 finally:temp.unlink(missing_ok=True)

def safe_cg(path):
 p=pathlib.PurePosixPath(path);assert p.is_absolute() and '..' not in p.parts,'CGROUP_CANONICAL'
 return pathlib.Path('/sys/fs/cgroup')/str(p).lstrip('/')

def read_text(path):
 with pathlib.Path(path).open() as f:s=f.read(65537)
 assert len(s)<=65536,'READ_BOUND';return s.strip()

def ancestors(path,stage='controller'):
 p=pathlib.PurePosixPath(path);out=[]
 while True:
  row={'path':str(p)}
  for key in ('memory.max','memory.swap.max','pids.max','cpu.max'):row[key]=observed_read('READ_ANCESTOR_LIMITS',lambda:read_text(safe_cg(str(p))/key),stage=stage) if str(p)!='/' else 'root-not-applicable'
  out.append(row)
  if str(p)=='/':break
  p=p.parent
 return out

def counters(path):
 result={}
 for file in ('memory.events','pids.events','cgroup.events'):
  reason={'memory.events':'READ_MEMORY_EVENTS','pids.events':'READ_PIDS_EVENTS','cgroup.events':'READ_CGROUP_EVENTS'}[file]
  result[file]=observed_read(reason,lambda:{k:int(v) for k,v in (l.split() for l in read_text(path/file).splitlines())})
 return result

def members(path):
 # Read recursively, no process-global scans and no arbitrary killing.
 assert observed_read('READ_CGROUP_DIRECTORY',path.is_dir),'CGROUP_DISAPPEARED'
 out=set()
 for parent,dirs,files in os.walk(path,followlinks=False):
  assert not any(pathlib.Path(parent,d).is_symlink() for d in dirs),'CGROUP_LINK'
  if 'cgroup.procs' in files:out.update(int(x) for x in observed_read('READ_CGROUP_PROCS',lambda:read_text(pathlib.Path(parent,'cgroup.procs'))).split())
 return sorted(out)

def manager_env():
 runtime=pathlib.Path('/run/user')/str(os.getuid());private=runtime/'systemd/private';s=private.stat();assert stat.S_ISSOCK(s.st_mode) and s.st_uid==os.getuid(),'EXISTING_MANAGER_SOCKET'
 return {'PATH':'/usr/bin:/bin','LC_ALL':'C','XDG_RUNTIME_DIR':str(runtime),'DBUS_SESSION_BUS_ADDRESS':'unix:path='+str(private),'SYSTEMD_COLORS':'0','SYSTEMD_PAGER':'cat','SYSTEMD_PAGERSECURE':'1'}

def ctl(env,name,verb='show'):
 assert name.startswith('hg-containment-') and name.endswith('.service') and verb in ('show','stop','reset-failed'),'OWN_UNIT_VERB'
 cmd=['/usr/bin/systemctl','--user','--no-ask-password','--no-pager',verb,name]
 if verb=='show':cmd+=['--all','--property='+','.join(KEYS)+',LoadState']
 p=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=4)
 if verb!='show':assert p.returncode==0,'OWN_UNIT_OPERATION';return {}
 assert len(p.stdout)<=16384,'UNIT_OUTPUT_LIMIT'
 rows=dict(l.split('=',1) for l in p.stdout.splitlines() if '=' in l)
 assert p.returncode==0 or rows.get('LoadState')=='not-found','UNIT_READ_FAILED'
 return rows

def same_owned(env,owned):
 p=observed_read('READ_UNIT_SHOW',lambda:ctl(env,owned['unit']));assert p['Id']==owned['unit'] and p['InvocationID']==owned['invocationId'] and p['Description']==owned['description'],'UNIT_CHANGED'
 return p

def empty_receipt(cg):
 ev=counters(cg);assert ev['cgroup.events']['populated']==0 and not members(cg),'UNIT_POPULATED'
 return {'populated':0,'members':[],'events':ev}

ERROR_TYPES=frozenset(('AssertionError','PermissionError','FileNotFoundError','OSError','TimeoutError','InterruptedError','MemoryError','ValueError','KeyError','TypeError','CalledProcessError','TimeoutExpired','CaptureSetupFatal','unknown'))
ERROR_STAGES=frozenset(('controller','inner','probe','trusted-helper','namespace-child','unknown'))
ERROR_REASONS=frozenset(('DIAGNOSTIC_CONFLICT','DIAGNOSTIC_OVERFLOW','DIAGNOSTIC_TRUNCATED','DIAGNOSTIC_CONFLICT_OVERFLOW','DIAGNOSTIC_CONFLICT_TRUNCATED','DIAGNOSTIC_OVERFLOW_TRUNCATED','DIAGNOSTIC_CONFLICT_OVERFLOW_TRUNCATED','EXTERNAL_NAMESPACE_DENIED_FORMAT','EXTERNAL_NAMESPACE_ERROR_FORMAT','EXTERNAL_BIND_ERROR_FORMAT','EXTERNAL_EXEC_ERROR_FORMAT','EXTERNAL_LOADER_ERROR_FORMAT','EXTERNAL_PYTHON_OPEN_ERROR_FORMAT','READ_MEMORY_EVENTS','READ_PIDS_EVENTS','READ_CGROUP_EVENTS','READ_CGROUP_DIRECTORY','READ_CGROUP_PROCS','READ_UNIT_SHOW','READ_HELPER_RESULT','READ_PROBE_READY','READ_READY_RECORD','READ_READY_MEMBERSHIP','READ_CONTROLLER_MEMBERSHIP','READ_ANCESTOR_LIMITS',
 'ABSOLUTE_STAGED_PATH','ALLOWLIST_ANCHOR','AMBIENT_CLEAR','ANCESTORS_INCOMPLETE','ANCESTOR_CHAIN',
 'ANCESTOR_REPEAT','ANCESTOR_SCHEMA','ANCESTOR_SETTINGS_CHANGED','ANCESTOR_TYPES','ANCHOR_FIELDS',
 'ANCHOR_MUST_BE_READ_ONLY','ANCHOR_SCHEMA','ARCHIVE_ANCHOR','BSET_DROP','BWRAP_ARGV_LIMIT',
 'BYTE_QUOTA_NOT_OBSERVED','CAPSET_ZERO','CAPTURE_SETUP_FATAL_OWN_UNIT_CLEANUP_REQUIRED','CASE',
 'CGROUP_CANONICAL','CGROUP_DISAPPEARED','CGROUP_LINK','CGROUP_NOT_EMPTY','CGROUP_PATH',
 'CHILD_OR_PIPE_DEADLINE','CLEANUP_EVIDENCE_UNKNOWN_AFTER_OWNED_STOP','CLEANUP_UNIT_CHANGED',
 'CONTROLLER_INSIDE_TARGET','CONTROLLER_INTERRUPTED','CONTROLLER_MEMBERSHIP_CHANGED','CONTROLLER_WALL',
 'CORE_FILE_IDENTITY','CORE_MOUNT_SET','CPU_PERIOD','CPU_QUOTA','CPU_RATE_BOUND',
 'CREATION_IDENTITY_UNAVAILABLE','CREATION_IDENTITY_UNKNOWN','CREATION_INVOCATION_UNKNOWN','DEADLINE',
 'DESCENDANT_EVIDENCE','DESCENDANT_NEGATIVE_NOT_OBSERVED','DROP_READBACK','EGRESS','EVENT_SCHEMA',
 'EXISTING_MANAGER_SOCKET','EXTERNAL_IDENTITY','EXTRA_FD','FINAL_SCHEMA','FORCED_CLEANUP_NEVER_PASS',
 'HANDSHAKE_TIMEOUT','HELPER_CONFIG','HELPER_SOURCE_CHANGED','HOST_BINARY_ANCHOR_OR_PRIVILEGE',
 'HOST_CAPS_FORBIDDEN','HOST_IDS','HOST_NAMESPACE','INNER_DESCENDANTS','INNER_LINES','INNER_PROBE_LIFECYCLE',
 'INNER_PROTOCOL','INNER_ROOT','INODE_QUOTA_NOT_OBSERVED','INTEGER_SCHEMA','INVOCATION_ID',
 'LEAF_CPU_FINITE_AND_PERIOD','LEAF_FIRST','LIFECYCLE_NEGATIVE_REASON','LIFECYCLE_NOT_NATURAL',
 'MANAGER_RESULT','MEMORY_CEILING_NOT_OBSERVED','MEMORY_REJECTION_NOT_OBSERVED','MEMORY_RESULT',
 'MISSING_RESULT_NOT_OOM','NATURAL_NOT_EXITED','NEGATIVE_STDERR','NETWORK_INTERFACES',
 'NETWORK_NOT_UNREACHABLE','NNP_SET','NONCE_FORMAT','NONPRIVILEGED_HOST_ID','NONZERO_OR_MANAGER_FAILURE',
 'NOT_ACTIVE_EXITED','NO_VALIDATED_CGROUP_LOCATION','NS_EQUAL_PARENT','OOM_TERMINATION_NOT_CORROBORATED',
 'OS_ERROR','OTHER_WRITABLE_SURFACE','OUTER_DEVICE_ANCHOR','OWNED_UNIT_ID','OWN_CGROUP','OWN_UNIT_OPERATION',
 'OWN_UNIT_VERB','PID_QUOTA_NOT_OBSERVED','PIPE_BYTES_LIMIT','POSITIVE_LIFECYCLE','POSITIVE_NOT_QUIESCENT',
 'POSITIVE_RESULT','POSTSTOP_INVOCATION_CHANGED','PRESTART_SOURCE_CHANGED','PRIVATE_PROC_MEMBERSHIP',
 'PRIVATE_PROC_MOUNT','PRIVATE_RECORD','PRIVATE_WORK_REMOUNT_FAILED','PROBE_DROP','PROBE_NOT_READY',
 'PROBE_PROTOCOL','PROBE_RESULT','PROC_FOREIGN_PID','PROPAGATION_NOT_PRIVATE','READY_FIELDS',
 'READY_PID_NONCE','READY_SCHEMA','READY_STATE','READ_BOUND','REAL_CANARY_VISIBLE','REAL_PID_MEMBERSHIP',
 'RECORD_LIMIT','RELEASE_INVALID','RELEASE_INVOCATION_CHANGED','REMOUNT_AFTER_DROP','RESULT_CONTEXT',
 'RESULT_CONTEXT_TYPES','RESULT_EXIT_SCHEMA','RESULT_SCHEMA','RESULT_TYPES','ROOT_MUST_ALREADY_BE_RO',
 'ROOT_NOT_LAST','RO_ERROR','RO_SENTINEL_BYTES','RO_WRITE_ALLOWED','SECUREBITS_READBACK','SECUREBITS_SET',
 'SERVICE_CREATE_REJECTED','SERVICE_STATE','SINGLE_INNER_MAP','SOURCE_ANCHOR','SOURCE_CONTAINMENT',
 'SOURCE_PATH','SOURCE_SET','STDIO_FDS','TIMEOUT_EVIDENCE','UNEXPECTED_INNER_DEADLINE',
 'UNEXPECTED_MEMORY_EVENTS','UNEXPECTED_PID_EVENTS','UNIT_CHANGED','UNIT_COLLISION','UNIT_MAINPID_LIVE',
 'UNIT_NOT_QUIESCENT','UNIT_OUTPUT_LIMIT','UNIT_POPULATED','UNIT_READ_FAILED','UNKNOWN','V2_REQUIRED',
 'WORK_CAPS','WORK_FLAGS','WORK_INSTANCE_CHANGED','WORK_MODE','WORK_MOUNT_SINGLE','WORK_NOT_EMPTY_DIRECTORY',
 'WORK_NOT_NEW_PRIVATE_TMPFS',
))
HELPER_REASONS=frozenset(('verified','unverified','capture-setup-fatal','outer-capture-failure','pipe-eof-deadline','wall-deadline','descendant-live','memory-oom-kill','memory-enomem','unknown'))

class DiagnosticFailure(Exception):
 def __init__(self,diagnostic):self.diagnostic=closed_diagnostic(diagnostic)

def closed_diagnostic(value):
 value=value if type(value) is dict else {}
 return {'type':value.get('type') if type(value.get('type')) is str and value.get('type') in ERROR_TYPES else 'unknown',
         'stage':value.get('stage') if type(value.get('stage')) is str and value.get('stage') in ERROR_STAGES else 'unknown',
         'reason':value.get('reason') if type(value.get('reason')) is str and value.get('reason') in ERROR_REASONS else 'UNKNOWN'}

def exception_diagnostic(error,stage):
 if isinstance(error,DiagnosticFailure):return closed_diagnostic(error.diagnostic)
 reason='UNKNOWN'
 # Exception arguments are compared for exact membership, never copied freely.
 for value in getattr(error,'args',()):
  if type(value) is str and value in ERROR_REASONS:reason=value;break
 return closed_diagnostic({'type':type(error).__name__,'stage':stage,'reason':reason})

def observed_read(reason,callback,stage='controller'):
 try:return callback()
 except OSError as error:raise DiagnosticFailure({'type':type(error).__name__,'stage':stage,'reason':reason}) from None

def diagnostic_record(value):
 d=closed_diagnostic(value)
 return {'status':'FAIL','helperErrorType':d['type'],'helperStage':d['stage'],'helperReason':d['reason']}

def bounded_number(value,minimum,maximum,string=False):
 if string and type(value) is str and value.isascii() and value.isdecimal() and len(value)<=10:value=int(value)
 return value if type(value) is int and minimum<=value<=maximum else 'unknown'

def terminal_snapshot(state,result):
 enums={'ActiveState':{'active','inactive','failed','activating','deactivating'},'SubState':{'running','exited','dead','failed','start','stop','stop-sigterm','stop-sigkill','auto-restart'},'Result':{'success','exit-code','signal','core-dump','watchdog','timeout','oom-kill','resources','start-limit-hit','protocol'}}
 out={k:state.get(k) if type(state.get(k)) is str and state.get(k) in values else 'unknown' for k,values in enums.items()}
 for key,limit in (('MainPID',4194304),('ExecMainCode',6),('ExecMainStatus',255)):out[key]=bounded_number(state.get(key),0,limit,string=True)
 value=state.get('ControlGroup');out['controlGroupAbsolute']=type(value) is str and pathlib.PurePosixPath(value).is_absolute() and '..' not in pathlib.PurePosixPath(value).parts
 if type(result) is dict:
  for key in ('forced','stderr','naturalExit','pipeEOF'):
   if key in result:out['helper_'+key]=result[key] if type(result[key]) is bool else 'unknown'
  for key,lo,hi in (('exitCode',-64,255),('descendants',-1,16)):
   if key in result:out['helper_'+key]=None if result[key] is None and key=='exitCode' else bounded_number(result[key],lo,hi)
  for key,values in (('status',{'OK','FAIL'}),('reason',HELPER_REASONS),('helperErrorType',ERROR_TYPES),('helperStage',ERROR_STAGES),('helperReason',ERROR_REASONS)):
   if key in result:out['helper_'+key]=result[key] if type(result[key]) is str and result[key] in values else 'unknown'
 return out

def persist_terminal(directory,state,result):
 # Save the exact state already observed before any new manager/file query.
 atomic_record(directory,'terminal-snapshot.json',terminal_snapshot(state,result))

def cleanup_failed_case(directory,case,env,owned,cg,error):
 # Primary failure evidence is independent of every subsequent manager query.
 atomic_record(directory,'controller-failure.json',{'case':case,'status':'FAIL','diagnostic':exception_diagnostic(error,'controller'),'payloadPass':False})
 try:
  if owned is None:raise AssertionError('CREATION_IDENTITY_UNAVAILABLE')
  quiesce(env,owned,cg,natural=False)
 except BaseException as cleanup_error:
  atomic_record(directory,'cleanup-unknown.json',{'case':case,'status':'FAIL_CLEANUP_UNKNOWN','diagnostic':exception_diagnostic(cleanup_error,'controller')})
  raise

def quiesce(env,owned,cg,natural):
 # Identity rechecked before stop, but missing resource files must not prevent
 # an exact owned-unit stop. The previously validated cg path is only evidence
 # location, never a fresh target authority obtained from terminal properties.
 p=same_owned(env,owned);before=None;evidence_error=False
 try:
  assert cg is not None,'NO_VALIDATED_CGROUP_LOCATION'
  # Retain a pre-stop empty proof only when no live main process can repopulate.
  if p.get('MainPID')=='0' and (p.get('ActiveState') in ('inactive','failed') or p.get('SubState')=='exited'):before=empty_receipt(cg)
 except (OSError,AssertionError,DiagnosticFailure):evidence_error=True
 if natural:assert p['SubState']=='exited' and p['ActiveState']=='active' and int(p['MainPID'])==0,'NATURAL_NOT_EXITED'
 ctl(env,owned['unit'],'stop')
 end=time.monotonic()+3;after=None;inactive=False
 while time.monotonic()<end:
  p=ctl(env,owned['unit'])
  if p.get('LoadState')=='not-found':inactive=True;after=before;break
  assert p['InvocationID']==owned['invocationId'],'POSTSTOP_INVOCATION_CHANGED'
  if int(p['MainPID'])==0 and p['ActiveState'] in ('inactive','failed'):
   inactive=True
   try:
    assert cg is not None,'NO_VALIDATED_CGROUP_LOCATION'
    after=empty_receipt(cg)
   except (OSError,AssertionError,DiagnosticFailure):after=before;evidence_error=True
   break
  time.sleep(.02)
 assert inactive and after is not None,'CLEANUP_EVIDENCE_UNKNOWN_AFTER_OWNED_STOP'
 return {'before':before,'after':after,'inactive':True,'forced':not natural,'evidenceReadError':evidence_error}

def verify_anchor(path):
 assert os.getuid()==os.geteuid()>0 and os.getgid()==os.getegid()>0,'NONPRIVILEGED_HOST_ID'
 hoststatus={k:v.strip() for k,v in (l.split(':',1) for l in read_text('/proc/self/status').splitlines() if ':' in l)}
 assert all(int(hoststatus[k],16)==0 for k in ('CapEff','CapPrm','CapAmb')),'HOST_CAPS_FORBIDDEN'
 assert not pathlib.Path(path).stat().st_mode&0o222,'ANCHOR_MUST_BE_READ_ONLY'
 a=read_json(path);assert set(a)=={'schema','commit','runId','artifactId','archive','archiveSha256','artifactRoot','allowlistSha256','sources','hostBinaries'},'ANCHOR_SCHEMA'
 assert type(a['schema']) is int and a['schema']==1 and re.fullmatch(r'[0-9a-f]{40}',a['commit']) and type(a['runId']) is int and a['runId']>0 and type(a['artifactId']) is int and a['artifactId']>0,'EXTERNAL_IDENTITY'
 assert set(a['sources'])==SOURCE_NAMES,'SOURCE_SET'
 for name,digest in a['sources'].items():assert sha(D/name)==digest,'SOURCE_ANCHOR'
 for name in ('/usr/bin/bwrap','/usr/bin/systemd-run','/usr/bin/systemctl','/usr/bin/env','/usr/bin/python3'):
  assert name in a['hostBinaries'] and sha(name)==a['hostBinaries'][name] and not os.stat(name).st_mode&(stat.S_ISUID|stat.S_ISGID),'HOST_BINARY_ANCHOR_OR_PRIVILEGE'
 assert sha(a['archive'])==a['archiveSha256'],'ARCHIVE_ANCHOR'
 root=pathlib.Path(a['artifactRoot']).resolve();assert sha(root/'ALLOWLIST.json')==a['allowlistSha256'],'ALLOWLIST_ANCHOR'
 manifest=json.loads((root/'ALLOWLIST.json').read_text());binds=[]
 for e in manifest:
  target=e['target']
  # Only Python core, IP tool and system runtime libraries. NEVER /app, Node,
  # npm paths, native product addons, models, checkout or user configuration.
  if e['disposition']!='mountable' or not target:continue
  wanted=target in ('/usr/bin/python3','/usr/sbin/ip') or target.startswith(('/usr/lib/python3.12/','/lib/','/lib64/','/usr/lib/x86_64-linux-gnu/'))
  if not wanted:continue
  rel=pathlib.PurePosixPath(e['source']);assert not rel.is_absolute() and '..' not in rel.parts,'SOURCE_PATH'
  p=root/str(rel);assert root in p.resolve().parents and not p.is_symlink() and p.is_file(),'SOURCE_CONTAINMENT'
  assert sha(p)==e['sha256'] and stat.S_IMODE(p.stat().st_mode)==int(e['mode'],8),'CORE_FILE_IDENTITY'
  binds.append([str(p),target])
 assert len(binds)<1000 and any(t=='/usr/bin/python3' for _,t in binds) and any(t=='/usr/sbin/ip' for _,t in binds),'CORE_MOUNT_SET'
 return a,binds

def wait_record(directory,name,deadline):
 while time.monotonic()<deadline:
  if (directory/name).exists():return read_json(directory/name)
  time.sleep(.01)
 raise TimeoutError('HANDSHAKE_TIMEOUT')

def cleanup_with_restored_handlers(callback,handlers):
 try:return callback()
 finally:
  for sig,handler in handlers.items():signal.signal(sig,handler)

def observe_until_terminal(read_result_if_present,read_state,deadline,clock=time.monotonic,pause=time.sleep):
 result=None
 while clock()<deadline:
  available=read_result_if_present()
  if available is not None:result=available
  state=read_state()
  if state['SubState'] in ('exited','failed') or state['ActiveState']=='failed':
   # Helper may publish after our first read but before manager returned its
   # terminal state. One final bounded read closes that race, no extra wait.
   available=read_result_if_present()
   if available is not None:result=available
   return result,state
  pause(.02)
 raise TimeoutError('CONTROLLER_WALL')

def run_case(anchor,binds,case,output):
 contract=load_module('containment-control-contract.py');env=manager_env();nonce=secrets.token_hex(16);name=contract.unit_name(nonce)
 assert ctl(env,name).get('LoadState')=='not-found','UNIT_COLLISION'
 directory=output/nonce;directory.mkdir(mode=0o700)
 owncg=contract.parse_proc_cgroup(observed_read('READ_CONTROLLER_MEMBERSHIP',lambda:read_text('/proc/self/cgroup')));parent_ns={k:os.readlink('/proc/self/ns/'+k) for k in ('user','mnt','pid','net','ipc','uts')}
 devices=[r.split()[2] for r in read_text('/proc/self/mountinfo').splitlines()]
 canary=directory/'outside-canary';canary.write_bytes(b'outside-allowlist\n');canary.chmod(0o400)
 sentinel=directory/'readonly-sentinel';sentinel.write_bytes(b'core-readonly-sentinel\n');sentinel.chmod(0o600)
 config={'nonce':nonce,'case':case,'sources':anchor['sources'],'binds':binds,'parentNS':parent_ns,'outerDevices':devices,'hostUID':os.getuid(),'hostGID':os.getgid(),'canary':str(canary),'sentinel':str(sentinel),'ownCgroup':str(owncg)}
 atomic_record(directory,'config.json',config,limit=262144)
 # Save ancestor settings outside own future unit and verify no change before
 # release. No set-property or controller writes anywhere in cgroupfs.
 ancestor_before=ancestors(str(owncg));owned=None;cg=None;creation_attempted=False;completed=False
 def interrupted(signum,frame):raise InterruptedError('CONTROLLER_INTERRUPTED')
 handlers={sig:signal.signal(sig,interrupted) for sig in (signal.SIGINT,signal.SIGTERM)}
 start=time.monotonic()
 try:
  for n,digest in anchor['sources'].items():assert sha(D/n)==digest,'PRESTART_SOURCE_CHANGED'
  plan=contract.service_plan(nonce,'/usr/bin/python3',str(D/'containment-harness.py'),str(directory))
  creation_attempted=True
  p=subprocess.run(plan['command'],env=env,capture_output=True,timeout=5)
  assert p.returncode==0,'SERVICE_CREATE_REJECTED'
  ready=observed_read('READ_READY_RECORD',lambda:wait_record(directory,'ready.json',start+5))
  props=ctl(env,name);candidate_cg=safe_cg(props['ControlGroup']);rows=ancestors(props['ControlGroup'])
  verified=contract.validate_receipt(nonce,props,ready,observed_read('READ_READY_MEMBERSHIP',lambda:read_text('/proc/'+str(ready['pid'])+'/cgroup')),rows)
  assert not str(owncg).startswith(props['ControlGroup']+'/') and str(owncg)!=props['ControlGroup'],'CONTROLLER_INSIDE_TARGET'
  assert contract.parse_proc_cgroup(observed_read('READ_CONTROLLER_MEMBERSHIP',lambda:read_text('/proc/self/cgroup')))==owncg,'CONTROLLER_MEMBERSHIP_CHANGED'
  assert ancestor_before==ancestors(str(owncg)),'ANCESTOR_SETTINGS_CHANGED'
  owned={**verified,'description':'Hydration core containment '+nonce}
  cg=candidate_cg # Freeze evidence location only after the complete readiness gate.
  before=counters(cg)
  gate={'nonce':nonce,'pid':ready['pid'],'invocationId':props['InvocationID']}
  atomic_record(directory,'release.json',gate)
  result,state=observe_until_terminal(lambda:observed_read('READ_HELPER_RESULT',lambda:read_json(directory/'result.json')) if (directory/'result.json').exists() else None,lambda:same_owned(env,owned),start+24)
  persist_terminal(directory,state,result)
  # Revalidate for further actions, never before preserving observed state.
  state=same_owned(env,owned)
  events=counters(cg)
  probe_ready=(directory/'probe-ready.json').exists() and observed_read('READ_PROBE_READY',lambda:read_json(directory/'probe-ready.json'))=={'nonce':nonce,'case':case}
  if result is not None:contract.verify_result_context(result,nonce,owned['invocationId'])
  decision=contract.evaluate_case_result(case,result,before,events,probe_ready,state)
  natural_helper=state['SubState']=='exited' and int(state['MainPID'])==0
  preempty=empty_receipt(cg) if natural_helper else None
  if decision['payloadPass']:
   assert preempty is not None,'POSITIVE_NOT_QUIESCENT'
   # Invoke the SAME final validator exercised by pure tests, using live
   # saved observations before bookkeeping stop, not inferred observations.
   contract.verify_final_receipt(owned,state,preempty['events']['cgroup.events'],preempty['members'],False,result,pre_bookkeeping=True)
  cleanup=quiesce(env,owned,cg,natural=natural_helper)
  receipt={'case':case,**decision,'cleanup':cleanup}
  completed=True
  atomic_record(directory,'controller-receipt.json',receipt)
  return receipt
 finally:
  error=sys.exc_info()[1]
  def cleanup_owned_after_failure():
   if not completed and creation_attempted:cleanup_failed_case(directory,case,env,owned,cg,error)
  cleanup_with_restored_handlers(cleanup_owned_after_failure,handlers)

# This source stage measures only the first failing boundary. It never runs
# resource/lifecycle negatives or product, even when the core observation passes.
OBSERVATION_CASES=('core',)

def observe_core_once(anchor,binds,output):
 return [run_case(anchor,binds,case,output) for case in OBSERVATION_CASES]

def controller(anchorfile):
 anchor,binds=verify_anchor(anchorfile)
 output=pathlib.Path('/tmp/hg-core-evidence');output.mkdir(mode=0o700,exist_ok=False)
 receipts=observe_core_once(anchor,binds,output)
 atomic_record(output,'suite.json',{'scope':'One first-core diagnostic observation only. No negative-case coverage, product validation or shutdown repair. Stops after this observation regardless of outcome; UNKNOWN/conflict/cap is final, never automatic retry.','cases':receipts})
 print('CORE_DIAGNOSTIC_OBSERVATION '+json.dumps({'caseCount':len(receipts),'productValidated':False,'negativeCasesRun':False}))

EXTERNAL_CATEGORIES=frozenset(('bwrap-namespace-denied','bwrap-namespace-error','bwrap-bind-error','bwrap-exec-error','loader-error','python-open-error','unknown'))

def external_line_category(line):
 # Source-format recognition only. Never publish path, errno text or line body.
 # Categories report matching stderr format, not independently proven root cause.
 if re.fullmatch(r'bwrap: Creating new namespace failed: (Operation not permitted|Permission denied)',line):return 'bwrap-namespace-denied'
 if re.fullmatch(r'bwrap: Creating new namespace failed: [^\r\n]{1,512}',line):return 'bwrap-namespace-error'
 if line.startswith('bwrap: No permissions to creating new namespace, likely because the kernel does not allow non-privileged user namespaces.'):return 'bwrap-namespace-denied'
 if re.fullmatch(r"bwrap: Can't bind mount [^\r\n]{1,2048} on [^\r\n]{1,2048}: [^\r\n]{1,2048}",line):return 'bwrap-bind-error'
 if re.fullmatch(r'bwrap: execvp [^\r\n]{1,2048}: [^\r\n]{1,512}',line):return 'bwrap-exec-error'
 if re.fullmatch(r'[^\r\n]{1,1024}: error while loading shared libraries: [^\r\n]{1,2048}',line):return 'loader-error'
 if re.fullmatch(r"/usr/bin/python3: can't open file [^\r\n]{1,2048}: \[Errno [0-9]{1,3}\] [^\r\n]{1,512}",line):return 'python-open-error'
 return 'unknown'

UNCERTAINTY_FLAGS={
 'DIAGNOSTIC_CONFLICT':(True,False,False),'DIAGNOSTIC_OVERFLOW':(False,True,False),'DIAGNOSTIC_TRUNCATED':(False,False,True),
 'DIAGNOSTIC_CONFLICT_OVERFLOW':(True,True,False),'DIAGNOSTIC_CONFLICT_TRUNCATED':(True,False,True),
 'DIAGNOSTIC_OVERFLOW_TRUNCATED':(False,True,True),'DIAGNOSTIC_CONFLICT_OVERFLOW_TRUNCATED':(True,True,True)}

def stderr_diagnostics(raw):
 # Scan every complete line within the existing4096-byte budget. Keep only4
 # unique public markers, but never let that publication cap hide ambiguity.
 truncated=len(raw)>4096
 raw=raw[:4096]
 markers=[];seen=set();categories=set();unknown=0;marker_lines=0
 conflict=False;overflow=False;inherited_truncation=False
 lines=raw.decode('utf8',errors='replace').splitlines()
 if truncated and raw and not raw.endswith(b'\n'):lines=lines[:-1]
 for line in lines:
  if line.startswith('CORE_ERROR '):
   try:
    obj=json.loads(line[len('CORE_ERROR '):]);assert type(obj) is dict and set(obj)=={'type','stage','reason'}
    closed=closed_diagnostic(obj)
    if closed==obj and closed['stage']!='unknown':
     marker_lines+=1
     reason=closed['reason']
     flags=UNCERTAINTY_FLAGS.get(reason,(False,False,False))
     conflict=conflict or flags[0]
     overflow=overflow or flags[1]
     inherited_truncation=inherited_truncation or flags[2]
     identity=json.dumps(closed,sort_keys=True)
     seen.add(identity)
     if len(markers)<4 and closed not in markers:markers.append(closed)
     continue
   except (ValueError,TypeError,AssertionError):pass
  category=external_line_category(line);categories.add(category)
  if category=='unknown':unknown+=1
 conflict=conflict or len(seen)>1
 overflow=overflow or len(seen)>4
 truncated=truncated or inherited_truncation
 if truncated:categories.add('unknown')
 return {'byteCount':len(raw),'byteCountCapped':len(raw)==4096 and truncated,'markerCount':min(marker_lines,4096),'markers':markers,'markerConflict':conflict,'markerOverflow':overflow,'diagnosticTruncated':truncated,'categories':sorted(categories),'unknownLineCount':min(unknown,4096)}

def diagnostic_from_summary(summary):
 # Uncertainty itself crosses the same typed marker boundary, never a guessed
 # external category standing in for conflicting or incomplete marker evidence.
 flags=tuple(bool(summary.get(key)) for key in ('markerConflict','markerOverflow','diagnosticTruncated'))
 if any(flags):
  reason=next(key for key,value in UNCERTAINTY_FLAGS.items() if value==flags)
  return {'type':'unknown','stage':'probe','reason':reason}
 distinct={json.dumps(value,sort_keys=True) for value in summary['markers']}
 return json.loads(next(iter(distinct))) if len(distinct)==1 else closed_diagnostic({})

def sanitized_child_error(raw):
 return diagnostic_from_summary(stderr_diagnostics(raw)) if raw else None

def child_error_record(captured):
 record=diagnostic_record(captured['errorType']);summary=captured['stderrDiagnostic']
 record.update({'exitCode':bounded_number(captured['exitCode'],-64,255),'stderrByteCount':summary['byteCount'],'stderrByteCountCapped':summary['byteCountCapped'],'markerCount':summary['markerCount'],'markers':summary['markers'],'markerConflict':summary['markerConflict'],'markerOverflow':summary['markerOverflow'],'diagnosticTruncated':summary['diagnosticTruncated'],'externalCategories':summary['categories'],'unknownLineCount':summary['unknownLineCount']})
 return record

def propagate_child_error(result):
 diagnostic=result.get('errorType')
 if diagnostic is not None:
  summary=result.get('stderrDiagnostic',{})
  if summary.get('diagnosticTruncated') or summary.get('markerOverflow') or summary.get('markerConflict'):
   diagnostic=diagnostic_from_summary(summary)
  elif closed_diagnostic(diagnostic)==closed_diagnostic({}) and not summary.get('markerCount',0):
   mapping={'bwrap-namespace-denied':'EXTERNAL_NAMESPACE_DENIED_FORMAT','bwrap-namespace-error':'EXTERNAL_NAMESPACE_ERROR_FORMAT','bwrap-bind-error':'EXTERNAL_BIND_ERROR_FORMAT','bwrap-exec-error':'EXTERNAL_EXEC_ERROR_FORMAT','loader-error':'EXTERNAL_LOADER_ERROR_FORMAT','python-open-error':'EXTERNAL_PYTHON_OPEN_ERROR_FORMAT'}
   categories=set(summary.get('categories',[]))-{'unknown'}
   if len(categories)==1 and next(iter(categories)) in mapping:diagnostic={'type':'unknown','stage':'probe','reason':mapping[next(iter(categories))]}
  raise DiagnosticFailure(diagnostic)

class CaptureSetupFatal(RuntimeError):pass

def capture_child(argv,timeout,on_output=None):
 child=None;pidfd=None;sel=None;setup=False;forced=False;out=bytearray();err=bytearray()
 try:
  child=subprocess.Popen(argv,env={},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,close_fds=True)
  pidfd=os.pidfd_open(child.pid,0)
  child.stdin.close();sel=selectors.DefaultSelector()
  for fd,kind in [(child.stdout,'out'),(child.stderr,'err')]:sel.register(fd,selectors.EVENT_READ,kind)
  setup=True;end=time.monotonic()+timeout
  while child.poll() is None or sel.get_map():
   if time.monotonic()>end:raise TimeoutError('CHILD_OR_PIPE_DEADLINE')
   for key,_ in sel.select(.02):
    buf=os.read(key.fileobj.fileno(),4096)
    if not buf:sel.unregister(key.fileobj);continue
    (out if key.data=='out' else err).extend(buf)
    assert len(out)<=8192 and len(err)<=4096,'PIPE_BYTES_LIMIT'
    if key.data=='out' and on_output is not None:on_output(bytes(out))
 except BaseException as e:
  if not setup:raise CaptureSetupFatal('CAPTURE_SETUP_FATAL_OWN_UNIT_CLEANUP_REQUIRED') from e
  raise
 finally:
  # Covers EVERY stage after Popen. Without a usable pidfd never kill by
  # bare PID/PGID: propagate fatal receipt to the outside own-unit controller.
  try:
   if child is not None:
    if child.poll() is None or sel is not None and sel.get_map():
     forced=True
     if child.poll() is None and pidfd is not None:
      try:signal.pidfd_send_signal(pidfd,signal.SIGKILL)
      except ProcessLookupError:pass
    if pidfd is not None:child.wait(timeout=2)
  finally:
   try:
    if sel is not None:sel.close()
   finally:
    try:
     if child is not None:
      for stream in (child.stdin,child.stdout,child.stderr):stream.close()
    finally:
     if pidfd is not None:os.close(pidfd)
 return {'status':'OK' if child.returncode==0 and not forced and not err else 'FAIL','forced':forced,'exitCode':child.returncode,'stderr':bool(err),'stdout':out.decode('utf8'),'errorType':sanitized_child_error(bytes(err)),'stderrDiagnostic':stderr_diagnostics(bytes(err))}

def helper(control,nonce):
 directory=pathlib.Path(control);cfg=read_json(directory/'config.json',limit=262144);assert cfg['nonce']==nonce and cfg['case'] in CASES,'HELPER_CONFIG'
 for name,digest in cfg['sources'].items():assert sha(D/name)==digest,'HELPER_SOURCE_CHANGED'
 atomic_record(directory,'ready.json',{'nonce':nonce,'pid':os.getpid(),'state':'waiting-for-release'})
 gate=wait_record(directory,'release.json',time.monotonic()+5);assert set(gate)=={'nonce','pid','invocationId'} and gate['nonce']==nonce and type(gate['pid']) is int and gate['pid']==os.getpid() and len(gate['invocationId'])==32,'RELEASE_INVALID'
 contract=load_module('containment-control-contract.py')
 env=manager_env();props=ctl(env,contract.unit_name(nonce))
 contract.validate_receipt(nonce,props,{'nonce':nonce,'pid':os.getpid(),'state':'waiting-for-release'},read_text('/proc/self/cgroup'),ancestors(props['ControlGroup'],stage='trusted-helper'))
 assert gate['invocationId']==props['InvocationID'],'RELEASE_INVOCATION_CHANGED'
 # No manager/cgroup/control file descriptors survive exec into bwrap.
 argv=['/usr/bin/bwrap','--clearenv','--unshare-user','--unshare-pid','--unshare-net','--unshare-ipc','--unshare-uts','--uid','0','--gid','0','--cap-add','CAP_NET_ADMIN','--cap-add','CAP_SETPCAP','--cap-add','CAP_SYS_ADMIN','--die-with-parent','--new-session','--proc','/proc','--remount-ro','/proc','--size','1048576','--tmpfs','/work','--chdir','/work']
 for source,target in cfg['binds']:argv+=['--ro-bind',source,target]
 for name in SOURCE_NAMES:argv+=['--ro-bind',str(D/name),'/app/'+name]
 argv+=['--ro-bind',str(directory/'config.json'),'/app/config.json','--ro-bind',cfg['sentinel'],'/app/readonly-sentinel','--remount-ro','/','/usr/bin/python3','-I','-B','-S','/app/containment-harness.py','inner']
 ready_seen=False
 def observed(raw):
  nonlocal ready_seen
  if not ready_seen and ('CORE_PROBE_READY '+cfg['case']).encode() in raw.splitlines():
   atomic_record(directory,'probe-ready.json',{'nonce':nonce,'case':cfg['case']});ready_seen=True
 assert all(len(a.encode())<os.sysconf('SC_PAGE_SIZE')*32 for a in argv) and sum(len(a.encode())+1+8 for a in argv)<min(os.sysconf('SC_ARG_MAX')-65536,524288),'BWRAP_ARGV_LIMIT'
 base={'case':cfg['case'],'nonce':nonce,'invocationId':gate['invocationId'],'status':'FAIL','forced':False,'exitCode':None,'stderr':False,'reason':'unverified','naturalExit':False,'pipeEOF':False,'descendants':-1}
 try:captured=capture_child(argv,12,observed)
 except CaptureSetupFatal as e:
  atomic_record(directory,'helper-error.json',diagnostic_record(exception_diagnostic(e,'trusted-helper')))
  base.update({'reason':'capture-setup-fatal','forced':True});atomic_record(directory,'result.json',base);raise
 except (TimeoutError,AssertionError,subprocess.TimeoutExpired) as e:
  atomic_record(directory,'helper-error.json',diagnostic_record(exception_diagnostic(e,'trusted-helper')))
  base.update({'reason':'outer-capture-failure','forced':True});atomic_record(directory,'result.json',base);raise
 if captured['errorType'] is not None:atomic_record(directory,'helper-error.json',child_error_record(captured))
 base.update({'exitCode':captured['exitCode'],'stderr':captured['stderr'],'forced':captured['forced']})
 if captured['status']=='OK':
  lines=captured['stdout'].splitlines();assert lines[0]=='CORE_PROBE_READY '+cfg['case'] and len(lines)==2,'INNER_LINES'
  parsed=json.loads(lines[1]);assert set(parsed)=={'case','reason','forced','exitCode','naturalExit','pipeEOF','descendants'} and parsed['case']==cfg['case'],'INNER_PROTOCOL'
  base.update(parsed);base['status']='OK' if parsed['reason']=='verified' else 'FAIL'
 atomic_record(directory,'result.json',base)
 # A failing witness is represented in the receipt. The trusted helper exits
 # naturally so the controller can record cgroup emptiness before bookkeeping.


def inner():
 cfg=json.loads(pathlib.Path('/app/config.json').read_text());case=cfg['case'];bootstrap=load_module('containment-bootstrap-contract.py')
 anchor={'outerUserNS':cfg['parentNS']['user'],'outerMountNS':cfg['parentNS']['mnt'],'outerDevices':cfg['outerDevices'],'hostUID':cfg['hostUID'],'hostGID':cfg['hostGID']}
 bootstrap.bound_work(anchor)
 # Only fixed trusted setup while namespace capabilities remain, no shell.
 subprocess.run(['/usr/sbin/ip','link','set','lo','up'],env={},check=True,close_fds=True)
 bootstrap.drop_all()
 # No inherited control, namespace, manager or cgroup descriptors. Only stdio
 # pipes remain; close_fds on outer Popen and this exact check are both required.
 assert sorted(int(p.name) for p in pathlib.Path('/proc/self/fd').iterdir() if p.name.isdigit() and int(p.name)<3)==[0,1,2],'STDIO_FDS'
 for n in os.listdir('/proc/self/fd'):
  if int(n)>2:
   try:os.fstat(int(n))
   except OSError as e:assert e.errno==errno.EBADF;continue
   raise AssertionError('EXTRA_FD')
 # A separate core-only probe runs AFTER drop; this inner supervisor observes
 # its exit, EOF and remaining PIDs BEFORE the bwrap PID1 reaper tears down.
 ready=False
 def observed(raw):
  nonlocal ready
  if not ready and ('CORE_PROBE_READY '+case).encode() in raw.splitlines():
   print('CORE_PROBE_READY '+case,flush=True);ready=True
 try:result=capture_child(['/usr/bin/python3','-I','-B','-S','/app/containment-harness.py','probe'],3 if case in ('descendant','pipe','timeout') else 10,observed)
 except TimeoutError:
  assert ready and case in ('pipe','timeout'),'UNEXPECTED_INNER_DEADLINE'
  print(json.dumps({'case':case,'reason':'pipe-eof-deadline' if case=='pipe' else 'wall-deadline','forced':True,'exitCode':None,'naturalExit':False,'pipeEOF':False,'descendants':0}),flush=True);return
 propagate_child_error(result)
 assert ready,'PROBE_NOT_READY'
 remaining={int(p.name) for p in pathlib.Path('/proc').iterdir() if p.name.isdigit()}-{1,os.getpid()}
 if case=='descendant':
  assert result['exitCode']==0 and not result['forced'] and not result['stderr'] and remaining,'DESCENDANT_NEGATIVE_NOT_OBSERVED'
  print(json.dumps({'case':case,'reason':'descendant-live','forced':False,'exitCode':0,'naturalExit':True,'pipeEOF':True,'descendants':len(remaining)}),flush=True);return
 if case=='memory' and result['exitCode']==-9 and not result['forced'] and not result['stderr']:
  print(json.dumps({'case':case,'reason':'memory-oom-kill','forced':False,'exitCode':-9,'naturalExit':False,'pipeEOF':True,'descendants':len(remaining)}),flush=True);return
 assert result['status']=='OK' and not result['forced'] and not result['stderr'],'INNER_PROBE_LIFECYCLE'
 lines=result['stdout'].splitlines();assert len(lines)==2 and lines[0]=='CORE_PROBE_READY '+case,'PROBE_PROTOCOL'
 parsed=json.loads(lines[1]);assert parsed=={'case':case,'verified':True} or case=='memory' and parsed=={'case':case,'rejected':'ENOMEM'},'PROBE_RESULT'
 assert not remaining,'INNER_DESCENDANTS'
 print(json.dumps({'case':case,'reason':'memory-enomem' if case=='memory' else 'verified','forced':False,'exitCode':0,'naturalExit':True,'pipeEOF':True,'descendants':0}),flush=True)

def probe():
 cfg=json.loads(pathlib.Path('/app/config.json').read_text());case=cfg['case'];bootstrap=load_module('containment-bootstrap-contract.py')
 values={k:v.strip() for k,v in (l.split(':',1) for l in read_text('/proc/self/status').splitlines() if ':' in l)}
 assert all(int(values[k],16)==0 for k in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb')) and values['NoNewPrivs']=='1','PROBE_DROP'
 for name,value in cfg['parentNS'].items():assert os.readlink('/proc/self/ns/'+name)!=value,'NS_EQUAL_PARENT'
 procs=[int(p.name) for p in pathlib.Path('/proc').iterdir() if p.name.isdigit()]
 assert set(procs)=={1,os.getppid(),os.getpid()} and os.getpid()>1,'PRIVATE_PROC_MEMBERSHIP'
 for pid in procs:
  assert os.readlink('/proc/'+str(pid)+'/ns/pid')==os.readlink('/proc/self/ns/pid'),'PROC_FOREIGN_PID'
 assert len([r for r in bootstrap.mounts() if r['target']=='/proc' and r['type']=='proc' and 'ro' in r['flags']])==1,'PRIVATE_PROC_MOUNT'
 assert not pathlib.Path(cfg['canary']).exists(),'REAL_CANARY_VISIBLE'
 assert pathlib.Path('/app/readonly-sentinel').read_bytes()==b'core-readonly-sentinel\n','RO_SENTINEL_BYTES'
 try:fd=os.open('/app/readonly-sentinel',os.O_WRONLY|os.O_NOFOLLOW)
 except OSError as e:assert e.errno==errno.EROFS,'RO_ERROR'
 else:os.close(fd);raise AssertionError('RO_WRITE_ALLOWED')
 libc=ctypes.CDLL(None,use_errno=True)
 assert libc.mount(None,b'/work',None,32,None)==-1 and ctypes.get_errno()==errno.EPERM,'REMOUNT_AFTER_DROP'
 assert [l.split(':')[0].strip() for l in read_text('/proc/net/dev').splitlines()[2:]]==['lo'],'NETWORK_INTERFACES'
 for family,address in ((socket.AF_INET,('192.0.2.1',9)),(socket.AF_INET6,('2001:db8::1',9))):
  try:s=socket.socket(family,socket.SOCK_STREAM)
  except OSError as e:assert family==socket.AF_INET6 and e.errno==errno.EAFNOSUPPORT;continue
  try:
   s.settimeout(.2)
   try:s.connect(address)
   except OSError as e:assert e.errno==errno.ENETUNREACH,'NETWORK_NOT_UNREACHABLE'
   else:raise AssertionError('EGRESS')
  finally:s.close()
 print('CORE_PROBE_READY '+case,flush=True)
 if case=='work-bytes':
  failed=False
  try:
   with open('/work/bytes','xb',buffering=0) as f:
    for i in range(512):f.write(b'x'*4096)
  except OSError as e:assert e.errno==errno.ENOSPC;failed=True
  assert failed and os.statvfs('/work').f_bavail==0,'BYTE_QUOTA_NOT_OBSERVED'
 elif case=='work-inodes':
  failed=False
  try:
   for i in range(80):
    fd=os.open('/work/i'+str(i),os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
  except OSError as e:assert e.errno==errno.ENOSPC;failed=True
  assert failed and os.statvfs('/work').f_favail==0,'INODE_QUOTA_NOT_OBSERVED'
 elif case=='pids':
  children=[];failed=False
  try:
   for i in range(20):
    try:pid=os.fork()
    except OSError as e:assert e.errno==errno.EAGAIN;failed=True;break
    if pid==0:time.sleep(3);os._exit(0)
    children.append(pid)
   assert failed,'PID_QUOTA_NOT_OBSERVED'
  finally:
   for pid in children:
    try:os.kill(pid,signal.SIGKILL)
    except ProcessLookupError:pass
   for pid in children:os.waitpid(pid,0)
 elif case=='memory':
  blocks=[]
  try:
   for i in range(40):
    block=bytearray(4*1024*1024)
    for offset in range(0,len(block),4096):block[offset]=1
    blocks.append(block)
  except MemoryError:
   blocks.clear();print(json.dumps({'case':case,'rejected':'ENOMEM'}),flush=True);return
  raise AssertionError('MEMORY_CEILING_NOT_OBSERVED')
 elif case in ('descendant','pipe'):
  pid=os.fork()
  if pid==0:
   if case=='descendant':os.close(1);os.close(2)
   time.sleep(8);os._exit(0)
  os._exit(0)
 elif case=='timeout':time.sleep(8)
 print(json.dumps({'case':case,'verified':True}),flush=True)

def namespace_entry(stage,callback):
 try:callback();return 0
 except BaseException as error:
  print('CORE_ERROR '+json.dumps(exception_diagnostic(error,stage)),file=sys.stderr,flush=True)
  return 1

if __name__=='__main__':
 if sys.flags.optimize:raise SystemExit('OPTIMIZATION_DISABLES_REQUIRED_GATES')
 if sys.argv[1:2]==['controller'] and len(sys.argv)==3:raise SystemExit(namespace_entry('controller',lambda:controller(sys.argv[2])))
 elif len(sys.argv)==5 and sys.argv[1]=='--control' and sys.argv[3]=='--nonce':
  try:helper(sys.argv[2],sys.argv[4])
  except BaseException as e:
   directory=pathlib.Path(sys.argv[2])
   if not (directory/'helper-error.json').exists():atomic_record(directory,'helper-error.json',diagnostic_record(exception_diagnostic(e,'trusted-helper')))
   raise SystemExit(1)
 elif sys.argv[1:] in (['inner'],['probe']):
  raise SystemExit(namespace_entry(sys.argv[1],inner if sys.argv[1]=='inner' else probe))
 else:raise SystemExit('UNWIRED: explicit controller with external anchor required; no default execution')
