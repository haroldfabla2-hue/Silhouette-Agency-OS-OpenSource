"""SOURCE INTERFACE ONLY, not wired into published controller. Never run here.
Privileged execution requires a separate exact gate after code review.
"""
from pathlib import Path
import os,stat,hashlib,json,subprocess,time,signal,selectors
SYSTEM={name:Path('/usr/bin')/name for name in ['sudo','timeout','unshare','setpriv','env','python3']}

def system_binary_manifest():
 rows=[]
 for name,path in SYSTEM.items():
  # /usr/bin/python3 can be distro symlink. Resolve and validate EVERY owner
  # and parent; do not reject a legitimate system-owned symlink by default.
  assert path.exists();resolved=path.resolve(strict=True)
  for part in [path,*path.parents,resolved,*resolved.parents]:
   st=part.lstat();assert st.st_uid==0 and(stat.S_ISLNK(st.st_mode)or not(st.st_mode&0o022)),str(part)
  st=resolved.stat();assert stat.S_ISREG(st.st_mode)and st.st_mode&0o111
  rows.append({'name':name,'invocationPath':str(path),'resolvedPath':str(resolved),'uid':st.st_uid,'mode':oct(st.st_mode&0o7777),'sha256':hashlib.sha256(resolved.read_bytes()).hexdigest(),'version':subprocess.check_output([str(path),'--version'],text=True,stderr=subprocess.STDOUT,timeout=5).splitlines()[0]})
 return rows

def build_exact_namespace_command(phase,root,node,compiler,entry,evidence,env):
 assert phase in ['probe','baseline','candidate'];uid=os.getuid();gid=os.getgid();assert uid>0
 assert all(Path(p).is_absolute()for p in [root,node,compiler,entry,evidence])
 # env comes from existing fresh allowlist, NOT os.environ; no auth, GITHUB_TOKEN,
 # docker socket, askpass or caller-supplied shell strings reach this process.
 safe={key:env[key]for key in ['HOME','NODE_OPTIONS','NPM_CONFIG_USERCONFIG','NPM_CONFIG_GLOBALCONFIG','NPM_CONFIG_CACHE']}
 safe['PATH']='/usr/bin:/bin'
 safe['STATIC_EXPECTED_NODE_SHA256']=hashlib.sha256(Path(node).read_bytes()).hexdigest()
 safe['STATIC_EXPECTED_COMPILER_SHA256']=hashlib.sha256(Path(compiler).read_bytes()).hexdigest()
 assert safe['NODE_OPTIONS']==''
 parent_net=os.readlink('/proc/self/ns/net')
 # ROOT-owned GNU timeout is the non-cancellable outside-namespace watchdog.
 # Default timeout process-group behavior MUST stay: no --foreground switch.
 # KILL at280s is explicit forced failure, not clean compiler acceptance.
 argv=[str(SYSTEM['sudo']),'-n','--',str(SYSTEM['timeout']),'--signal=KILL',('8s'if phase=='probe'else'280s'),str(SYSTEM['unshare']),'--net','--',str(SYSTEM['setpriv']),'--reuid='+str(uid),'--regid='+str(gid),'--clear-groups','--inh-caps=-all','--ambient-caps=-all','--bounding-set=-all','--no-new-privs','--',str(SYSTEM['env']),'-i',*[key+'='+value for key,value in sorted(safe.items())],str(SYSTEM['python3']),str(entry),phase,str(uid),str(gid),parent_net,str(root),str(node),str(compiler),str(evidence)]
 return argv


import selectors,signal
def group_alive(pgid):
 try:os.killpg(pgid,0);return True
 except ProcessLookupError:return False
 except PermissionError:return True # privileged survivor, NEVER clean

def proc_row(pid):
 try:
  root=Path('/proc')/str(pid);raw=(root/'stat').read_text().rsplit(')',1)[1].split();status=(root/'status').read_text()
  uid=next(line.split()[1:]for line in status.splitlines()if line.startswith('Uid:'))
  return {'pid':pid,'ppid':int(raw[1]),'pgid':int(raw[2]),'sid':int(raw[3]),'startTicks':int(raw[19]),'uid':[int(x)for x in uid],'comm':(root/'comm').read_text().strip()}
 except(FileNotFoundError,ProcessLookupError,PermissionError):return None

def snapshot_descendants(leader,known):
 # Snapshot only proof, not security claim of all possible hostile escaped
 # descendants. Actual compiler/watchdog group is separately checked by kernel.
 rows={int(p.name):proc_row(int(p.name))for p in Path('/proc').iterdir()if p.name.isdecimal()};rows={k:v for k,v in rows.items()if v}
 accepted={leader}
 for pid,start in known.items():
  if pid in rows and rows[pid]['startTicks']==start:accepted.add(pid)
 while True:
  more={pid for pid,row in rows.items()if row['ppid']in accepted}
  if more<=accepted:break
  accepted|=more
 result=[rows[pid]for pid in sorted(accepted)if pid in rows]
 for row in result:known[row['pid']]=row['startTicks']
 return result

def run_namespace_phase(label,argv,cwd,env,evidence,receipt_path,deadline,root_watchdog_seconds):
 assert label in ['probe','baseline','candidate'];assert root_watchdog_seconds==(8 if label=='probe' else 280)
 wall=12 if label=='probe' else 300
 assert time.monotonic()+wall<deadline,'cleanup reserve unavailable'
 evidence=Path(evidence);receipt_path=Path(receipt_path);assert not receipt_path.exists()
 # No privileged preexec hook. Actual limits set after drop by reviewed entry.
 p=subprocess.Popen(argv,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True,close_fds=True)
 known={};samples=[];namespace_group=None;stop_cause=None;signals=[];eof=False;count=0;overflow=False;t=time.monotonic();sel=selectors.DefaultSelector();os.set_blocking(p.stdout.fileno(),False);sel.register(p.stdout,selectors.EVENT_READ)
 try:
  with(evidence/(label+'.log')).open('xb')as log:
   while True:
    elapsed=time.monotonic()-t;rows=snapshot_descendants(p.pid,known)
    # Bounded timeline, explicit sample count, not silently claimed exhaustive.
    if len(samples)<64:samples.append({'seconds':elapsed,'processes':rows})
    if receipt_path.is_file()and namespace_group is None:
     receipt=json.loads(receipt_path.read_text());namespace_group=int(receipt['pgid'])
     assert namespace_group>1
     assert receipt['rootTimeoutGroupMatchesEntry']is True and receipt['rootTimeoutAncestor']['pgid']==namespace_group
     assert receipt['rootTimeoutAncestor']['uid']==[0,0,0,0]
     # All repo-controlled code now nonroot; exact kernel receipt checked by
     # entry. Rootwatchdog is same group owner outside namespace.
     assert receipt['uid'][0]==os.getuid()>0
    for key,_ in sel.select(.05):
     data=os.read(key.fd,65536)
     if not data:sel.unregister(key.fd);eof=True;continue
     count+=len(data)
     if count<=8*1024**2 and not overflow:log.write(data)
     else:overflow=True;stop_cause=stop_cause or 'LOG_OVERFLOW_INCOMPLETE_NO_ACCEPTANCE'
    if stop_cause:
     # ONLY unprivileged proven original descendants can be signalled directly.
     # Do not attempt root shell/kill command; rootwatchdog is already armed.
     for row in rows:
      if row['uid']==[os.getuid()]*4:
       current=proc_row(row['pid'])
       if current and current['startTicks']==row['startTicks']:
        try:os.kill(row['pid'],signal.SIGKILL);signals.append({'pid':row['pid'],'signal':'SIGKILL'})
        except ProcessLookupError:pass
        except PermissionError:stop_cause='PERMISSION_DENIED_CLEANUP_INCOMPLETE'
    rc=p.poll()
    group_live=namespace_group is not None and group_alive(namespace_group)
    if rc is not None and eof and not group_live:break
    if elapsed>wall:
     stop_cause=stop_cause or 'OUTER_WALL_OR_PRIVILEGED_SURVIVOR_CLEANUP_INCOMPLETE'
     break
 except BaseException as cause:
  stop_cause=stop_cause or type(cause).__name__+':'+str(cause)
  # A signal/receipt error cannot abandon a live privileged setup. Wait only
  # to the original outside deadline while the root watchdog stays armed.
  while time.monotonic()-t<wall:
   rows=snapshot_descendants(p.pid,known)
   for row in rows:
    if row['uid']==[os.getuid()]*4 and row['pid']!=p.pid:
     current=proc_row(row['pid'])
     if current and current['startTicks']==row['startTicks']:
      try:os.kill(row['pid'],signal.SIGKILL);signals.append({'pid':row['pid'],'signal':'SIGKILL'})
      except(ProcessLookupError,PermissionError):pass
   # Drain original output without adding beyond the explicit cap.
   for key,_ in sel.select(.05):
    data=os.read(key.fd,65536)
    if not data:sel.unregister(key.fd);eof=True
    elif data:count+=len(data);overflow=True
   if p.poll()is not None and eof:break
 finally:
  sel.close();p.stdout.close()
 # NEVER cleanup source copies or start another compiler with surviving setup.
 # EOF alone does not substitute for rootwatchdog/sudo/group disappearance.
 rows=snapshot_descendants(p.pid,known);leader_done=p.poll()is not None
 original_survivors=[row for row in rows if row['pid']!=p.pid or not leader_done]
 group_live=namespace_group is not None and group_alive(namespace_group)
 if not leader_done or original_survivors or group_live:stop_cause=stop_cause or 'SURVIVORS_NO_CLEANUP_CLAIM'
 try:receipt=json.loads(receipt_path.read_text())if receipt_path.is_file()else None
 except(Exception)as invalid:receipt=None;stop_cause=stop_cause or 'INVALID_RECEIPT:'+type(invalid).__name__
 receipt_valid=bool(receipt and receipt.get('isolationValidated')is True and receipt.get('rootTimeoutGroupMatchesEntry')is True)
 if not receipt_valid:stop_cause=stop_cause or 'MISSING_OR_INVALID_NAMESPACE_LAUNCH_RECEIPT'
 if p.returncode in[124,137,-signal.SIGKILL]:stop_cause=stop_cause or 'ROOT_WATCHDOG_FORCED_TERMINATION'
 row={'phase':label,'argv':argv,'rc':p.returncode,'wallSeconds':time.monotonic()-t,'rootWatchdogSeconds':root_watchdog_seconds,'logObservedBytes':count,'logStoredBytes':(evidence/(label+'.log')).stat().st_size,'logComplete':not overflow and eof,'eof':eof,'cause':stop_cause,'signals':signals,'naturalComplete':leader_done and eof and not stop_cause,'setupChainSnapshotSamples':samples,'knownProcessIdentities':known,'supervisorPid':os.getpid(),'supervisorPgid':os.getpgrp(),'leaderPid':p.pid,'namespaceGroup':namespace_group,'namespaceGroupLive':group_live,'survivors':original_survivors,'namespaceReceipt':receipt,'chainReaped':leader_done and not original_survivors and not group_live,'isolationValidated':receipt_valid,'cleanupSafe':not stop_cause and receipt_valid and leader_done and not original_survivors and not group_live,'containment':'PER_PROCESS_AND_KNOWN_GROUP_NOT_ADVERSARIAL_CGROUP'}
 (evidence/(label+'-supervisor.json')).write_text(json.dumps(row,indent=2)+'\n')
 # Parent finally still exports all logs/receipts. If cleanupSafe false, preserve
 # tree until outer GitHub job20min kills VM; do not delete still-used sources.
 return row
