#!/usr/bin/env python3
"""Trusted direct-child boundary. No product imports/replacement test logic."""
import os,sys,json,signal,subprocess,time,resource,struct,socket,errno,stat,selectors
from pathlib import Path
ROOT=Path('/mnt/silhouette-genuine-vitest')
def cg():
 rows=Path('/proc/self/cgroup').read_text().splitlines();assert len(rows)==1 and rows[0].startswith('0::/')
 p=Path('/sys/fs/cgroup'+rows[0][3:]);assert p.name=='silhouette-vitest-coordinator.service'
 assert(p/'memory.max').read_text().strip()=='10737418240'
 assert(p/'memory.swap.max').read_text().strip()=='0'
 assert(p/'pids.max').read_text().strip()=='384'
 q,t=map(int,(p/'cpu.max').read_text().split());assert q==2*t
 return p
def events(p):return dict((k,int(v))for k,v in(line.split()for line in(p/'memory.events').read_text().splitlines()))
def owned_pids(uid):
 out=[]
 for p in Path('/proc').iterdir():
  if p.name.isdigit():
   try:
    if p.stat().st_uid==uid:out.append(int(p.name))
   except FileNotFoundError:pass
 return out
def policy(target,transport=False):
 assert os.uname().machine=='x86_64'
 # cBPF little-endian x86_64 only. Refuse x32/foreign ABI; require AF_UNIX.
 ins=[]
 def emit(code,jt,jf,k):ins.append(struct.pack('HBBI',code,jt,jf,k))
 emit(0x20,0,0,4);emit(0x15,1,0,0xc000003e);emit(0x06,0,0,0x80000000)
 emit(0x20,0,0,0);emit(0x45,0,1,0x40000000);emit(0x06,0,0,0x80000000)
 for n in (41,53):
  domains=(1,2,10)if transport else(1,)
  emit(0x15,0,len(domains)+3,n);emit(0x20,0,0,16)
  for index,domain in enumerate(domains):emit(0x15,len(domains)-index,0,domain)
  emit(0x06,0,0,0x50000|errno.EPERM);emit(0x06,0,0,0x7fff0000)
 # No new namespaces/mounts, hostname, ptrace, realtime/personalities, kernel module/BPF.
 for n in (101,135,144,155,161,165,166,170,171,175,176,246,272,308,313,321):
  emit(0x15,0,1,n);emit(0x06,0,0,0x50000|errno.EPERM)
 emit(0x15,0,1,435);emit(0x06,0,0,0x50000|errno.ENOSYS)
 emit(0x15,0,4,56);emit(0x20,0,0,16);emit(0x45,0,1,0x7e020080);emit(0x06,0,0,0x50000|errno.EPERM);emit(0x06,0,0,0x7fff0000)
 emit(0x06,0,0,0x7fff0000)
 target.write_bytes(b''.join(ins));target.chmod(0o444)
STAGE='UNKNOWN'
STAGES={'UNKNOWN','UID_GROUPS','CAPS_NNP','APPARMOR','NET_PID','AF_POLICY','RLIMIT','CGROUP','MOUNT_POLICY','EXEC'}
ERRORS={'AssertionError','OSError','PermissionError','FileNotFoundError','ValueError','KeyError'}
def parse_mountinfo(line):
 a,b=line.split(' - ',1);a=a.split();b=b.split()
 return a[4],set(a[5].split(',')),set(b[2].split(',')),b[0]
def mount_writable(per_mount,superblock):
 # Both levels can deny writes. A bind's per-mount ro is not undone by superblock rw.
 assert ('ro'in per_mount)^('rw'in per_mount)
 assert ('ro'in superblock)^('rw'in superblock)
 return 'rw'in per_mount and 'rw'in superblock
def prefix_evidence(raw,overflow):
 result={'authority':'UNAUTHENTICATED_CORROBORATION_ONLY','status':'MISSING_UNKNOWN'}
 if overflow:return {**result,'status':'OVERSIZE_UNKNOWN'}
 if not raw:return result
 try:
  row=json.loads(raw);assert type(row)is dict and set(row)=={'stage','exception','errno'}
  assert row['stage']in STAGES and row['exception']in ERRORS|{'OTHER'}
  assert row['errno']=='UNKNOWN'or(type(row['errno'])is int and 0<=row['errno']<=4095)
  return {**result,'status':'CAPTURED','receipt':row}
 except BaseException:return {**result,'status':'INVALID_UNKNOWN'}
def admit():
 global STAGE
 STAGE='UID_GROUPS'
 global DIAG
 DIAG=os.dup(1);os.set_inheritable(DIAG,False)
 phase,uid,gid,hostnet,hostpid,executable,*args=sys.argv[2:];uid=int(uid);gid=int(gid)
 assert uid>0 and gid>0 and os.getresuid()==(uid,uid,uid)and os.getresgid()==(gid,gid,gid)
 assert not os.getgroups()
 STAGE='CAPS_NNP'
 status=dict(l.split(':',1)for l in Path('/proc/self/status').read_text().splitlines()if':'in l)
 assert all(int(status[k],16)==0 for k in('CapInh','CapPrm','CapEff','CapBnd','CapAmb'))
 assert status['NoNewPrivs'].strip()=='1'and status['Seccomp'].strip()=='2'
 STAGE='APPARMOR'
 aa=Path('/proc/self/attr/current').read_text().strip()
 assert aa=='bwrap//&unpriv_bwrap (enforce)','UNEXPECTED_APPARMOR_STACK'
 STAGE='NET_PID'
 assert os.readlink('/proc/self/ns/pid')!=hostpid
 assert(os.readlink('/proc/self/ns/net')==hostnet)==(phase=='transport')
 if phase!='transport':assert all(l.split(':')[0].strip()=='lo'for l in Path('/proc/net/dev').read_text().splitlines()[2:])
 STAGE='AF_POLICY'
 for af in(()if phase=='transport'else(socket.AF_INET,socket.AF_INET6)):
  try:s=socket.socket(af,socket.SOCK_STREAM)
  except OSError as e:assert e.errno==errno.EPERM
  else:s.close();raise AssertionError('ADDRESS_FAMILY_NOT_DENIED')
 s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.close()
 STAGE='RLIMIT'
 expected=134217728 if phase=='acquire'else(67108864 if phase=='transport'else 8388608)
 assert resource.getrlimit(resource.RLIMIT_FSIZE)==(expected,expected)
 assert resource.getrlimit(resource.RLIMIT_NOFILE)==(4096,4096)
 assert resource.getrlimit(resource.RLIMIT_CORE)==(0,0)
 # Read-only exact aggregate cgroup bind, no host cgroup control tree.
 STAGE='CGROUP'
 p=Path('/control');assert(p/'memory.max').read_text().strip()=='10737418240'
 assert(p/'memory.swap.max').read_text().strip()=='0'and(p/'pids.max').read_text().strip()=='384'
 q,t=map(int,(p/'cpu.max').read_text().split());assert q==2*t
 assert not os.access(p,os.W_OK)
 STAGE='MOUNT_POLICY'
 writable={str(ROOT/('work'if phase=='acquire'else('transport'if phase=='transport'else'runtime/'+phase)))}
 if phase=='acquire':writable.add(str(ROOT/'diagnostic/acquire.json'))
 else:writable.update({str(ROOT/'sources'/phase/'db'),str(ROOT/'sources'/phase/'data')})
 mounts=[]
 for line in Path('/proc/self/mountinfo').read_text().splitlines():
  mounts.append(parse_mountinfo(line))
 for path,per_mount,superblock,kind in mounts:
  if path=='/proc':continue
  if mount_writable(per_mount,superblock):assert path in writable,'UNEXPECTED_WRITABLE_MOUNT'
 assert not any(str(p)in('/run/systemd','/run/docker.sock','/home/runner')for p in Path('/run').iterdir())
 for path in('/run','/tmp','/var/tmp','/dev/shm'):
  assert not os.access(path,os.W_OK)
 # Root has no host filesystem bind; source/fixtures RO, session-only data writable.
 STAGE='EXEC'
 assert os.path.isabs(executable)
 os.environ.pop('LC_CTYPE',None)
 # Prefix alone may write the bounded status pipe. Target output remains null.
 null=os.open('/dev/null',os.O_WRONLY);os.dup2(null,1);os.close(null)
 os.execve(executable,[executable,*args],dict(os.environ))
def run():
 phase,uid,gid,seconds,hostnet,hostpid,executable,*argv=sys.argv[2:];uid=int(uid);gid=int(gid);seconds=int(seconds)
 assert phase in('transport','acquire','baseline-admission','baseline-state','candidate')
 assert seconds==({'transport':180,'acquire':360}.get(phase,85))
 assert uid>0 and gid>0 and not owned_pids(uid)
 p=cg();before=events(p);start=time.monotonic();process=None;forced=False;receipt=ROOT/'private'/(phase+'.child.json')
 env={'PATH':str(ROOT/'fixtures/toolchain/bin')+':/usr/sbin:/usr/bin:/sbin:/bin'}
 fd=None;code=None;stream=None;diagnostic=bytearray();observed=0;wrapper_error='NONE'
 def stop(*unused):
  nonlocal forced
  forced=True
  if process is not None:
   try:os.killpg(process.pid,signal.SIGKILL)
   except ProcessLookupError:pass
 signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
 try:
  cmd=['/usr/bin/setpriv','--reuid='+str(uid),'--regid='+str(gid),'--clear-groups','--inh-caps=-all','--ambient-caps=-all','--bounding-set=-all']
  fd=os.open(ROOT/('fixtures/transport-filter.bpf'if phase=='transport'else'fixtures/filter.bpf'),os.O_RDONLY|os.O_CLOEXEC)
  cmd+=['/usr/bin/bwrap','--unshare-user','--uid',str(uid),'--gid',str(gid),'--unshare-pid','--unshare-ipc','--unshare-uts','--cap-drop','ALL','--die-with-parent','--new-session','--clearenv']
  if phase!='transport':cmd+=['--unshare-net']
  for a in('/usr','/lib','/lib64'):cmd+=['--ro-bind',a,a]
  cmd+=['--symlink','usr/bin','/bin','--symlink','usr/sbin','/sbin','--proc','/proc','--dev','/dev']
  for a in('/tmp','/var/tmp','/run','/dev/shm','/dev/pts'):cmd+=['--ro-bind',str(ROOT/'fixtures/empty'),a]
  cmd+=['--remount-ro','/dev','--remount-ro','/proc']
  cmd+=['--ro-bind',str(p),'/control','--ro-bind',str(ROOT/'fixtures'),str(ROOT/'fixtures')]
  if phase=='transport':
   cmd+=['--bind',str(ROOT/'transport'),str(ROOT/'transport')]
   for path in('/etc/resolv.conf','/etc/hosts','/etc/nsswitch.conf','/etc/ssl/certs'):cmd+=['--ro-bind',path,path]
   data=ROOT/'transport';home=data/'home';tmp=data/'tmp';cwd=data
  elif phase=='acquire':
   cmd+=['--bind',str(ROOT/'work'),str(ROOT/'work'),'--bind',str(ROOT/'diagnostic/acquire.json'),str(ROOT/'diagnostic/acquire.json')]
   data=ROOT/'work';home=data/'npm-home';tmp=data/'tmp';cwd=data
  else:
   data=ROOT/'runtime'/phase;src=ROOT/'sources'/phase;home=data/'home';tmp=data/'tmp';cwd=src
   cmd+=['--ro-bind',str(src),str(src),'--ro-bind',str(ROOT/'work/acquisition/node_modules'),str(src/'node_modules'),'--bind',str(data),str(data),'--bind',str(data/'db'),str(src/'db'),'--bind',str(data/'data'),str(src/'data')]
  env.update({'HOME':str(home),'TMPDIR':str(tmp)})
  if phase not in('acquire','transport'):env.update({'NODE_ENV':'test','NODE_OPTIONS':'--max-old-space-size=2048','SILHOUETTE_INFERENCE_MODE':'cloud-only','SILHOUETTE_OWNER_SCOPES':'128','SILHOUETTE_OWNER_ACTIVE':'512','SILHOUETTE_OWNER_FAILURES':'64','SILHOUETTE_OWNER_RESOURCES':'256','GOMAXPROCS':'1','TOKIO_WORKER_THREADS':'1','LANCE_CPU_THREADS':'1','RAYON_NUM_THREADS':'1'})
  for k,v in env.items():cmd+=['--setenv',k,v]
  cmd+=['--chdir',str(cwd),'--remount-ro','/','--seccomp',str(fd),'/usr/bin/python3','-I',str(ROOT/'fixtures/direct.py'),'admit',phase,str(uid),str(gid),hostnet,hostpid,executable,*argv]
  def limits():
   resource.setrlimit(resource.RLIMIT_FSIZE,(134217728 if phase=='acquire'else(67108864 if phase=='transport'else 8388608),)*2)
   resource.setrlimit(resource.RLIMIT_NOFILE,(4096,4096));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
  process=subprocess.Popen(cmd,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env,start_new_session=True,pass_fds=(()if fd is None else(fd,)),preexec_fn=limits)
  stream=selectors.DefaultSelector();os.set_blocking(process.stdout.fileno(),False);stream.register(process.stdout,selectors.EVENT_READ)
  deadline=time.monotonic()+seconds
  while stream.get_map()or process.poll()is None:
   remaining=deadline-time.monotonic()
   if forced or remaining<=0:stop();break
   for key,_ in stream.select(min(.05,remaining)):
    b=os.read(key.fileobj.fileno(),4096)
    if not b:stream.unregister(key.fileobj);continue
    observed=min(2**63-1,observed+len(b))
    if len(diagnostic)<1024:diagnostic.extend(b[:1024-len(diagnostic)])
  code=process.wait(timeout=2)
 except BaseException as error:
  wrapper_error=type(error).__name__ if type(error).__name__ in ERRORS else'OTHER'
  if process is not None and process.poll()is None:stop()
  if process is not None:code=process.poll()
 finally:
  if process is not None and process.poll()is None:stop();process.wait(timeout=2)
  if process is not None:code=process.returncode
  if stream is not None:stream.close()
  if process is not None and process.stdout is not None:process.stdout.close()
  if fd is not None:os.close(fd)
  residual=owned_pids(uid);after=events(p)
  # Any UID residual is a failure, not a completed child. Cleanup owns removing it.
  natural=type(code)is int and code>=0 and wrapper_error=='NONE'and not forced and not residual and all(after.get(k,0)==before.get(k,0)for k in('oom','oom_kill','oom_group_kill'))
  row={'schema':1,'phase':phase,'rawReturnCode':code,'natural':natural,'forced':forced,'residualUidProcesses':len(residual),'oomBefore':before,'oomAfter':after,'aggregateMemoryMax':10737418240,'aggregateTasksMax':384,'swapMax':0,'cpuCount':2,'elapsedSeconds':round(time.monotonic()-start,3),'boundary':'DIRECT_CHILD_BWRAP_OFFLINE_CONFIGURED_NOT_EXECUTION_PROOF'if phase!='transport'else'DIRECT_BWRAP_TRANSPORT_CONFIGURED_NOT_EXECUTION_PROOF'}
  row['wrapperError']=wrapper_error
  row['prefix']=prefix_evidence(bytes(diagnostic),observed>1024)
  # Root-created finite fields only; emit before private receipt write and cleanup.
  print('DIRECT_CHILD_RECEIPT '+json.dumps(row,separators=(',',':')),flush=True)
  receipt.write_text(json.dumps(row)+'\n');receipt.chmod(0o600)
 if not natural:sys.exit(124 if forced else 125)
 sys.exit(code)
if __name__=='__main__':
 if sys.argv[1]=='policy':policy(Path(sys.argv[2]),len(sys.argv)>3 and sys.argv[3]=='transport')
 elif sys.argv[1]=='admit':
  try:admit()
  except BaseException as error:
   row={'stage':STAGE if STAGE in STAGES else'UNKNOWN','exception':type(error).__name__ if type(error).__name__ in ERRORS else'OTHER','errno':error.errno if isinstance(error,OSError)and type(error.errno)is int and 0<=error.errno<=4095 else'UNKNOWN'}
   try:os.write(globals().get('DIAG',1),(json.dumps(row,separators=(',',':'))+'\n').encode())
   except BaseException:pass
   os._exit(125)
 elif sys.argv[1]=='run':run()
 else:raise ValueError('BAD_MODE')
