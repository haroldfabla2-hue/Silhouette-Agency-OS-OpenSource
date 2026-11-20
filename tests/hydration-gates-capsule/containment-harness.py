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

def ancestors(path):
 p=pathlib.PurePosixPath(path);out=[]
 while True:
  row={'path':str(p)}
  for key in ('memory.max','memory.swap.max','pids.max','cpu.max'):row[key]=read_text(safe_cg(str(p))/key) if str(p)!='/' else 'root-not-applicable'
  out.append(row)
  if str(p)=='/':break
  p=p.parent
 return out

def counters(path):
 result={}
 for file in ('memory.events','pids.events','cgroup.events'):
  result[file]={k:int(v) for k,v in (l.split() for l in read_text(path/file).splitlines())}
 return result

def members(path):
 # Read recursively, no process-global scans and no arbitrary killing.
 assert path.is_dir(),'CGROUP_DISAPPEARED'
 out=set()
 for parent,dirs,files in os.walk(path,followlinks=False):
  assert not any(pathlib.Path(parent,d).is_symlink() for d in dirs),'CGROUP_LINK'
  if 'cgroup.procs' in files:out.update(int(x) for x in read_text(pathlib.Path(parent,'cgroup.procs')).split())
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
 p=ctl(env,owned['unit']);assert p['Id']==owned['unit'] and p['InvocationID']==owned['invocationId'] and p['Description']==owned['description'],'UNIT_CHANGED'
 return p

def empty_receipt(cg):
 ev=counters(cg);assert ev['cgroup.events']['populated']==0 and not members(cg),'UNIT_POPULATED'
 return {'populated':0,'members':[],'events':ev}

def quiesce(env,owned,cg,natural):
 # Never stop by a name alone. Even bookkeeping stop requires same invocation.
 p=same_owned(env,owned)
 before=empty_receipt(cg) if natural else None
 if natural:assert p['SubState']=='exited' and p['ActiveState']=='active' and int(p['MainPID'])==0,'NATURAL_NOT_EXITED'
 ctl(env,owned['unit'],'stop')
 end=time.monotonic()+3;after=None
 while time.monotonic()<end:
  p=ctl(env,owned['unit'])
  if p.get('LoadState')=='not-found':
   assert before is not None,'UNIT_UNLOADED_BEFORE_EMPTY_EVIDENCE';after=before;break
  assert p['InvocationID']==owned['invocationId'],'POSTSTOP_INVOCATION_CHANGED'
  if int(p['MainPID'])==0 and p['ActiveState'] in ('inactive','failed'):
   # If the cgroup disappears after a proven empty observation, retain it.
   after=empty_receipt(cg) if cg.exists() else before
   break
  time.sleep(.02)
 assert after is not None,'CLEANUP_EVIDENCE_UNKNOWN'
 return {'before':before,'after':after,'inactive':True,'forced':not natural}

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
 owncg=contract.parse_proc_cgroup(read_text('/proc/self/cgroup'));parent_ns={k:os.readlink('/proc/self/ns/'+k) for k in ('user','mnt','pid','net','ipc','uts')}
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
  ready=wait_record(directory,'ready.json',start+5)
  props=ctl(env,name);cg=safe_cg(props['ControlGroup']);rows=ancestors(props['ControlGroup'])
  verified=contract.validate_receipt(nonce,props,ready,read_text('/proc/'+str(ready['pid'])+'/cgroup'),rows)
  assert not str(owncg).startswith(props['ControlGroup']+'/') and str(owncg)!=props['ControlGroup'],'CONTROLLER_INSIDE_TARGET'
  assert contract.parse_proc_cgroup(read_text('/proc/self/cgroup'))==owncg,'CONTROLLER_MEMBERSHIP_CHANGED'
  assert ancestor_before==ancestors(str(owncg)),'ANCESTOR_SETTINGS_CHANGED'
  owned={**verified,'description':'Hydration core containment '+nonce}
  before=counters(cg)
  gate={'nonce':nonce,'pid':ready['pid'],'invocationId':props['InvocationID']}
  atomic_record(directory,'release.json',gate)
  result,state=observe_until_terminal(lambda:read_json(directory/'result.json') if (directory/'result.json').exists() else None,lambda:same_owned(env,owned),start+24)
  state=same_owned(env,owned);events=counters(cg)
  probe_ready=(directory/'probe-ready.json').exists() and read_json(directory/'probe-ready.json')=={'nonce':nonce,'case':case}
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
  def cleanup_owned_after_failure():
   if not completed and creation_attempted:
    # Recover only the exact random identity, even if creation was interrupted.
    state=ctl(env,name)
    if state.get('LoadState')!='not-found':
     assert state.get('Id')==name and state.get('Description')=='Hydration core containment '+nonce,'CREATION_IDENTITY_UNKNOWN'
     recovered={'unit':name,'invocationId':state['InvocationID'],'description':state['Description']}
     assert len(recovered['invocationId'])==32,'CREATION_INVOCATION_UNKNOWN'
     atomic_record(directory,'controller-failure.json',{'case':case,'status':'FAIL','reasonType':type(sys.exc_info()[1]).__name__,'payloadPass':False})
     try:quiesce(env,recovered,safe_cg(state['ControlGroup']),natural=False)
     except Exception:atomic_record(directory,'cleanup-unknown.json',{'case':case,'status':'FAIL_CLEANUP_UNKNOWN'});raise
  cleanup_with_restored_handlers(cleanup_owned_after_failure,handlers)

def controller(anchorfile):
 anchor,binds=verify_anchor(anchorfile)
 output=pathlib.Path('/tmp/hg-core-evidence');output.mkdir(mode=0o700,exist_ok=False)
 receipts=[]
 for case in CASES:
  # Fail immediately on the first denied admission/core or resource error.
  receipts.append(run_case(anchor,binds,case,output))
 atomic_record(output,'suite.json',{'scope':'Real core containment evidence only. No product validation or shutdown repair. Dynamic negative cases are distinct expected FAILs, never a payload PASS after forced cleanup.','cases':receipts})
 print('CORE_CONTAINMENT_EVIDENCE '+json.dumps({'caseCount':len(receipts),'outputPathSha256':hashlib.sha256(str(output).encode()).hexdigest(),'productValidated':False}))

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
 return {'status':'OK' if child.returncode==0 and not forced and not err else 'FAIL','forced':forced,'exitCode':child.returncode,'stderr':bool(err),'stdout':out.decode('utf8')}

def helper(control,nonce):
 directory=pathlib.Path(control);cfg=read_json(directory/'config.json',limit=262144);assert cfg['nonce']==nonce and cfg['case'] in CASES,'HELPER_CONFIG'
 for name,digest in cfg['sources'].items():assert sha(D/name)==digest,'HELPER_SOURCE_CHANGED'
 atomic_record(directory,'ready.json',{'nonce':nonce,'pid':os.getpid(),'state':'waiting-for-release'})
 gate=wait_record(directory,'release.json',time.monotonic()+5);assert set(gate)=={'nonce','pid','invocationId'} and gate['nonce']==nonce and type(gate['pid']) is int and gate['pid']==os.getpid() and len(gate['invocationId'])==32,'RELEASE_INVALID'
 contract=load_module('containment-control-contract.py')
 env=manager_env();props=ctl(env,contract.unit_name(nonce))
 contract.validate_receipt(nonce,props,{'nonce':nonce,'pid':os.getpid(),'state':'waiting-for-release'},read_text('/proc/self/cgroup'),ancestors(props['ControlGroup']))
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
 except CaptureSetupFatal:
  base.update({'reason':'capture-setup-fatal','forced':True});atomic_record(directory,'result.json',base);raise
 except (TimeoutError,AssertionError,subprocess.TimeoutExpired):
  base.update({'reason':'outer-capture-failure','forced':True});atomic_record(directory,'result.json',base);raise
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

if __name__=='__main__':
 if sys.flags.optimize:raise SystemExit('OPTIMIZATION_DISABLES_REQUIRED_GATES')
 if sys.argv[1:2]==['controller'] and len(sys.argv)==3:controller(sys.argv[2])
 elif len(sys.argv)==5 and sys.argv[1]=='--control' and sys.argv[3]=='--nonce':helper(sys.argv[2],sys.argv[4])
 elif sys.argv[1:]==['inner']:inner()
 elif sys.argv[1:]==['probe']:probe()
 else:raise SystemExit('UNWIRED: explicit controller with external anchor required; no default execution')
