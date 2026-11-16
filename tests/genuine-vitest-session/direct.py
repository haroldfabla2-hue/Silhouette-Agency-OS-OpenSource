#!/usr/bin/env python3
"""Trusted direct-child boundary. No product imports/replacement test logic."""
import os,sys,json,signal,subprocess,time,resource,struct,socket,errno,stat,selectors,hashlib,base64
from pathlib import Path
ROOT=Path('/mnt/silhouette-genuine-vitest')
def exact_compiler(phase,executable,argv):
 return (phase=='candidate' and executable==str(ROOT/'fixtures/toolchain/bin/node')
  and argv==[str(ROOT/'sources/candidate/node_modules/typescript/bin/tsc'),'--noEmit','--incremental','false','--pretty','false'])
def cg():
 rows=Path('/proc/self/cgroup').read_text().splitlines();assert len(rows)==1 and rows[0].startswith('0::/')
 p=Path('/sys/fs/cgroup'+rows[0][3:]);assert p.name=='silhouette-vitest-coordinator.service'
 assert(p/'memory.max').read_text().strip()=='10737418240'
 assert(p/'memory.swap.max').read_text().strip()=='0'
 assert(p/'pids.max').read_text().strip()=='384'
 q,t=map(int,(p/'cpu.max').read_text().split());assert q==2*t
 return p
def events(p):return dict((k,int(v))for k,v in(line.split()for line in(p/'memory.events').read_text().splitlines()))
# Diagnostic metadata only. Never selects kill targets or changes natural gates.
# st_uid is the SAME predicate as the existing owned_pids gate, not pgrep -u.
def process_metadata(pid,uid=None):
 p=Path('/proc')/str(pid)
 def bounded_read(path):
  with path.open('rb')as f:raw=f.read(8193)
  if len(raw)>8192:raise ValueError('METADATA_OVERFLOW')
  return raw
 def stat_fields():
  raw=bounded_read(p/'stat').decode(errors='replace');tail=raw.rsplit(') ',1)[1].split()
  return {'state':tail[0]if tail[0]in {'R','S','D','Z','T','t','X','x','K','W','P','I'}else'UNKNOWN',
   'ppid':int(tail[1]),'session':int(tail[3]),'startTicks':int(tail[19])}
 try:
  st=p.stat()
  if uid is not None and st.st_uid!=uid:return {'pid':pid,'status':'UNKNOWN_OWNERSHIP_CHANGED'}
  first=stat_fields();status={}
  for line in bounded_read(p/'status').decode('ascii',errors='replace').splitlines():
   if line.startswith(('Uid:','NSpid:')):
    key,values=line.split(':',1);status[key]=[int(x)for x in values.split()]
  second=stat_fields();end=p.stat()
  if first['startTicks']!=second['startTicks']or st.st_uid!=end.st_uid or uid is not None and end.st_uid!=uid:
   return {'pid':pid,'status':'UNKNOWN_IDENTITY_CHANGED'}
  ns=status.get('NSpid',[]);uids=status.get('Uid',[])
  if not 1<=len(ns)<=8 or len(uids)!=4 or second['state']=='UNKNOWN':return {'pid':pid,'status':'UNKNOWN_METADATA_SHAPE'}
  # Compare the complete cgroup record privately. Never export cgroup paths.
  cgroup=bounded_read(p/'cgroup');same=cgroup==bounded_read(Path('/proc/self/cgroup'))
  return {'pid':pid,'status':'OBSERVED_NOT_CAUSE','statUid':st.st_uid,'realUid':uids[0],
   'effectiveUid':uids[1],'ppid':second['ppid'],'session':second['session'],
   'state':second['state'],'startTicks':second['startTicks'],'nspid':ns,
   'sameObserverCgroup':same,'cgroupRecordSha256':hashlib.sha256(cgroup).hexdigest(),'identityStableAcrossReads':True}
 except (OSError,ValueError,IndexError,KeyError,UnicodeError):return {'pid':pid,'status':'UNKNOWN_GONE_OR_UNREADABLE'}
def owned_pids(uid,observation=None,direct_child=None):
 out=[];rows=[];loss=False;began=time.monotonic_ns()
 for p in Path('/proc').iterdir():
  if p.name.isdigit():
   try:
    if p.stat().st_uid==uid:
     pid=int(p.name);out.append(pid)
     if observation is not None and len(rows)<4:
      row=process_metadata(pid,uid);rows.append(row)
      if row['status']!='OBSERVED_NOT_CAUSE':loss=True
   except FileNotFoundError:
    if observation is not None:loss=True
 if observation is not None:
  overflow=len(out)>4
  if direct_child is not None and (direct_child.get('identityAfterSpawn')or{}).get('status')!='OBSERVED_NOT_CAUSE':loss=True
  payload={'schema':1,'origin':'OWNED_UID_METADATA_OBSERVATION_NOT_CAUSAL_OR_KILL_AUTHORITY',
   'phase':observation,'ownership':'PROC_DIRECTORY_STAT_UID_EQUALS_OWNED_UID',
   'uid':uid,'matchedCount':len(out),'capturedLimit':4,'overflow':overflow,'loss':loss,
   'state':'UNKNOWN'if loss or overflow else'OBSERVED_NOT_CAUSE',
   'beganMonotonicNs':began,'endedMonotonicNs':time.monotonic_ns(),'rows':rows,
   'directChild':direct_child}
  # Fixed schema/numbers/enums only. Never argv/env/comm/exe/paths or raw errors.
  encoded=json.dumps(payload,separators=(',',':'))
  if len(encoded.encode())>8192:encoded=json.dumps({'schema':1,'state':'UNKNOWN','reason':'OUTPUT_OVERFLOW','matchedCount':len(out),'uid':uid,'phase':observation},separators=(',',':'))
  print('OWNED_UID_OBSERVATION '+encoded,flush=True)
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
# Same six device capabilities previously installed implicitly by --dev.
DEVICES={'/dev/null':(1,3),'/dev/zero':(1,5),'/dev/full':(1,7),'/dev/random':(1,8),'/dev/urandom':(1,9),'/dev/tty':(5,0)}
DEVLINKS={'fd':'/proc/self/fd','stdin':'/proc/self/fd/0','stdout':'/proc/self/fd/1','stderr':'/proc/self/fd/2','core':'/proc/kcore','ptmx':'pts/ptmx'}
def parse_mountinfo(line):
 a,b=line.split(' - ',1);a=a.split();b=b.split()
 assert len(a)>=6 and len(b)>=3
 path=a[4]
 # Fixed generated paths have no mountinfo escapes; unexpected topology fails closed.
 assert path.startswith('/')and chr(92)not in path
 return path,set(a[5].split(',')),set(b[2].split(',')),b[0]
def mount_writable(per_mount,superblock):
 assert ('ro'in per_mount)^('rw'in per_mount)
 assert ('ro'in superblock)^('rw'in superblock)
 return 'rw'in per_mount and 'rw'in superblock
def mount_spec(phase):
 assert phase in('transport','acquire','baseline-admission','baseline-state','candidate')
 ro_dirs={'/usr','/lib','/lib64','/tmp','/var/tmp','/run','/dev/shm','/dev/pts','/control',str(ROOT/'fixtures')}
 ro_files=set()
 writable={str(ROOT/('work'if phase=='acquire'else('transport'if phase=='transport'else'runtime/'+phase)))}
 if phase=='acquire':writable.add(str(ROOT/'diagnostic/acquire.json'))
 else:writable.update({str(ROOT/'sources'/phase/'db'),str(ROOT/'sources'/phase/'data')})
 if phase=='transport':
  writes={str(ROOT/'transport')};ro_dirs.add('/etc/ssl/certs');ro_files.update({'/etc/resolv.conf','/etc/hosts','/etc/nsswitch.conf'})
 elif phase=='acquire':writes=set(writable)
 else:
  writes=set(writable);ro_dirs.update({str(ROOT/'sources'/phase),str(ROOT/'sources'/phase/'node_modules')})
 return ro_dirs,ro_files,writable,writes
def check_mounts(rows,phase,devices):
 ro_dirs,ro_files,writable,writes=mount_spec(phase)
 points=[r[0]for r in rows]
 # No intentionally covered mounts in construction. Refuse any unexpected stack,
 # rather than implementing a general visibility graph or ignoring hidden RW rows.
 assert len(points)==len(set(points)),'STACKED_OR_DUPLICATE_MOUNT'
 required={'/','/proc',*DEVICES,*ro_dirs,*ro_files,*writes}
 assert required<=set(points),'MISSING_CONSTRUCTED_MOUNT'
 assert '/dev'not in points,'UNEXPECTED_DEV_FILESYSTEM'
 for path,per_mount,superblock,kind in rows:
  effective_write=mount_writable(per_mount,superblock)
  if path in DEVICES:
   mode,major,minor=devices[path]
   assert stat.S_ISCHR(mode)and(major,minor)==DEVICES[path],'WRONG_FIXED_CHARACTER_DEVICE'
   assert kind in('tmpfs','devtmpfs')and'nosuid'in per_mount and'nodev'not in per_mount,'WRONG_DEVICE_MOUNT_FLAGS'
   # Character-device I/O is not a writable filesystem-data bind. No directory,
   # regular file, symlink or other device can use this fixed six-node branch.
   continue
  assert path=='/'or path=='/proc'or path.startswith('/proc/')or path in ro_files or path in writes or any(path==r or path.startswith(r+'/')for r in ro_dirs),'UNEXPECTED_MOUNT'
  if path=='/'or path in writes or path==str(ROOT/'fixtures')or path.startswith(str(ROOT/'fixtures')+'/')or path in('/tmp','/var/tmp','/run','/dev/shm','/dev/pts'):
   assert kind=='tmpfs','WRONG_SESSION_OR_EMPTY_FILESYSTEM'
  if path=='/':assert{'nosuid','nodev'}<=per_mount,'WRONG_ROOT_FLAGS'
  if path=='/control':assert kind=='cgroup2','WRONG_CONTROL_FILESYSTEM'
  if path=='/proc'or path.startswith('/proc/'):
   assert kind=='proc'and{'nosuid','nodev','noexec'}<=per_mount,'WRONG_PRIVATE_PROC_MOUNT'
  if path not in writable:assert not effective_write,'UNEXPECTED_WRITABLE_MOUNT'
  if path not in writes:assert'ro'in per_mount,'EXPECTED_READONLY_MOUNT'
  if path!='/'and path not in writes:assert'nodev'in per_mount,'EXPECTED_NODEV_READONLY_BIND'
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
def acquisition_row(raw):
 def unique(pairs):
  out={}
  for key,value in pairs:
   if key in out:raise ValueError()
   out[key]=value
  return out
 data=json.loads(raw,object_pairs_hook=unique)
 keys=('version','origin','stage','event','exception','errno','role','subprocessExit')
 assert type(data)is dict and set(data)==set(keys)
 assert type(data['version'])is int and data['version']==1
 assert data['origin']=='ACQUIRE'
 assert data['stage']in {'PAYLOAD_INIT','SOURCE_COPY','PUBLIC_SOURCE_READ','INSTALLER_IDENTITY','NPM_CONFIG','NPM_CI','LOCK_VERIFY','ARCHIVE_VERIFY','MEMBER_VERIFY','NATIVE_PROVENANCE','COMPLETE'}
 assert data['event']in {'ENTERED','UNCAUGHT_EXCEPTION','COMPLETED'}
 assert data['exception']in {'NONE','OTHER','AssertionError','OSError','PermissionError','FileNotFoundError','FileExistsError','TimeoutError','CalledProcessError','TimeoutExpired','ValueError','KeyError','JSONDecodeError','HTTPError','URLError'}
 assert data['errno']=='UNKNOWN'or(type(data['errno'])is int and data['errno']in {1,2,5,7,8,12,13,20,21,22,24,27,28,30,31,32,38,95,110,111})
 assert data['role']in {'NONE','NPM_CONFIG','NPM_CI'}
 assert data['subprocessExit']=='UNKNOWN'or(type(data['subprocessExit'])is int and -128<=data['subprocessExit']<=255)
 # Reconstruct only validated finite fields. Never retain the raw bytes.
 return {key:data[key]for key in keys}
def acquisition_evidence(quiescent):
 result={'authority':'UNAUTHENTICATED_CORROBORATION_ONLY','status':'MISSING_UNKNOWN'}
 if not quiescent:return {**result,'status':'NONQUIESCENT_UNKNOWN'}
 fd=None
 try:
  # Existing fixed root-created endpoint only, never caller-selected paths or logs.
  fd=os.open(ROOT/'diagnostic/acquire.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK)
  before=os.fstat(fd)
  if not(stat.S_ISREG(before.st_mode)and before.st_uid==0 and before.st_nlink==1 and stat.S_IMODE(before.st_mode)==0o620):
   return {**result,'status':'INVALID_FILE_UNKNOWN'}
  if before.st_size>1024:return {**result,'status':'OVERSIZE_UNKNOWN'}
  raw=os.read(fd,1025);after=os.fstat(fd)
  if len(raw)>1024:return {**result,'status':'OVERSIZE_UNKNOWN'}
  stable=('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns')
  if any(getattr(before,key)!=getattr(after,key)for key in stable)or len(raw)!=before.st_size:return {**result,'status':'CHANGED_UNKNOWN'}
  if not raw:return result
  return {**result,'status':'CAPTURED','receipt':acquisition_row(raw)}
 except FileNotFoundError:return result
 except BaseException:return {**result,'status':'INVALID_OR_UNREADABLE_UNKNOWN'}
 finally:
  if fd is not None:
   try:os.close(fd)
   except OSError:pass
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
 device_metadata={}
 for path in DEVICES:
  st=os.lstat(path);device_metadata[path]=(st.st_mode,os.major(st.st_rdev),os.minor(st.st_rdev))
 check_mounts([parse_mountinfo(line)for line in Path('/proc/self/mountinfo').read_text().splitlines()],phase,device_metadata)
 assert set(os.listdir('/dev'))=={*(Path(p).name for p in DEVICES),*DEVLINKS,'shm','pts'},'UNEXPECTED_DEV_ENTRY'
 for name,target in DEVLINKS.items():assert os.readlink('/dev/'+name)==target,'WRONG_DEV_SYMLINK'
 assert not any(str(p)in('/run/systemd','/run/docker.sock','/home/runner')for p in Path('/run').iterdir())
 for path in('/run','/tmp','/var/tmp','/dev/shm'):
  assert not os.access(path,os.W_OK)
 # Root has no host filesystem bind; source/fixtures RO, session-only data writable.
 STAGE='EXEC'
 assert os.path.isabs(executable)
 os.environ.pop('LC_CTYPE',None)
 # Only the exact compiler retains fd1 in the existing bounded outer pipe.
 # Its fd2 already shares that pipe; every other target keeps stdout null.
 if not exact_compiler(phase,executable,args):
  null=os.open('/dev/null',os.O_WRONLY);os.dup2(null,1);os.close(null)
 os.execve(executable,[executable,*args],dict(os.environ))
def run():
 phase,uid,gid,seconds,hostnet,hostpid,executable,*argv=sys.argv[2:];uid=int(uid);gid=int(gid);seconds=int(seconds)
 assert phase in('transport','acquire','baseline-admission','baseline-state','candidate')
 assert seconds==({'transport':180,'acquire':360}.get(phase,85))
 assert uid>0 and gid>0 and not owned_pids(uid)
 p=cg();before=events(p);start=time.monotonic();process=None;forced=False;receipt=ROOT/'private'/(phase+'.child.json')
 env={'PATH':str(ROOT/'fixtures/toolchain/bin')+':/usr/sbin:/usr/bin:/sbin:/bin'}
 fd=None;code=None;stream=None;diagnostic=bytearray();observed=0;wrapper_error='NONE';direct_identity=None
 # Exact reviewed compiler invocation only. No general output-export switch.
 compiler_diagnostic=exact_compiler(phase,executable,argv)
 compiler_head=bytearray();compiler_tail=bytearray();compiler_hash=hashlib.sha256();compiler_eof=False
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
  cmd+=['--symlink','usr/bin','/bin','--symlink','usr/sbin','/sbin','--proc','/proc','--dir','/dev']
  for path in DEVICES:cmd+=['--dev-bind',path,path]
  for name,target in DEVLINKS.items():cmd+=['--symlink',target,'/dev/'+name]
  for a in('/tmp','/var/tmp','/run','/dev/shm','/dev/pts'):cmd+=['--ro-bind',str(ROOT/'fixtures/empty'),a]
  cmd+=['--remount-ro','/proc']
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
  if phase not in('acquire','transport'):env.update({'NODE_ENV':'test','NODE_OPTIONS':'--max-old-space-size=2048','SILHOUETTE_INFERENCE_MODE':'cloud-only','SILHOUETTE_PROVIDERS':'off','SILHOUETTE_OWNER_SCOPES':'128','SILHOUETTE_OWNER_ACTIVE':'512','SILHOUETTE_OWNER_FAILURES':'64','SILHOUETTE_OWNER_RESOURCES':'256','GOMAXPROCS':'1','TOKIO_WORKER_THREADS':'1','LANCE_CPU_THREADS':'1','RAYON_NUM_THREADS':'1'})
  # Only the exact full application compiler, never Vitest/product children.
  if compiler_diagnostic:env['NODE_OPTIONS']='--max-old-space-size=4096'
  for k,v in env.items():cmd+=['--setenv',k,v]
  cmd+=['--chdir',str(cwd),'--remount-ro','/','--seccomp',str(fd),'/usr/bin/python3','-I',str(ROOT/'fixtures/direct.py'),'admit',phase,str(uid),str(gid),hostnet,hostpid,executable,*argv]
  def limits():
   resource.setrlimit(resource.RLIMIT_FSIZE,(134217728 if phase=='acquire'else(67108864 if phase=='transport'else 8388608),)*2)
   resource.setrlimit(resource.RLIMIT_NOFILE,(4096,4096));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
  process=subprocess.Popen(cmd,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=(subprocess.STDOUT if compiler_diagnostic else subprocess.DEVNULL),env=env,start_new_session=True,pass_fds=(()if fd is None else(fd,)),preexec_fn=limits)
  stream=selectors.DefaultSelector();os.set_blocking(process.stdout.fileno(),False);stream.register(process.stdout,selectors.EVENT_READ)
  deadline=time.monotonic()+seconds
  # This is our own Popen child only. Metadata time consumes the same deadline.
  direct_identity=process_metadata(process.pid)
  while stream.get_map()or process.poll()is None:
   remaining=deadline-time.monotonic()
   if forced or remaining<=0:stop();break
   for key,_ in stream.select(min(.05,remaining)):
    b=os.read(key.fileobj.fileno(),4096)
    if not b:
     compiler_eof=True;stream.unregister(key.fileobj);continue
    if compiler_diagnostic:
     compiler_hash.update(b)
     if len(compiler_head)<16384:compiler_head.extend(b[:16384-len(compiler_head)])
     compiler_tail.extend(b)
     if len(compiler_tail)>16384:del compiler_tail[:-16384]
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
  child={'identityAfterSpawn':direct_identity,'pid':process.pid if process is not None else None,'returnCodeAfterWait':code}
  residual=owned_pids(uid,'POST_WAIT_'+phase.upper(),child);after=events(p)
  # Any UID residual is a failure, not a completed child. Cleanup owns removing it.
  natural=type(code)is int and code>=0 and wrapper_error=='NONE'and not forced and not residual and all(after.get(k,0)==before.get(k,0)for k in('oom','oom_kill','oom_group_kill'))
  row={'schema':1,'phase':phase,'rawReturnCode':code,'natural':natural,'forced':forced,'residualUidProcesses':len(residual),'oomBefore':before,'oomAfter':after,'aggregateMemoryMax':10737418240,'aggregateTasksMax':384,'swapMax':0,'cpuCount':2,'elapsedSeconds':round(time.monotonic()-start,3),'boundary':'DIRECT_CHILD_BWRAP_OFFLINE_CONFIGURED_NOT_EXECUTION_PROOF'if phase!='transport'else'DIRECT_BWRAP_TRANSPORT_CONFIGURED_NOT_EXECUTION_PROOF'}
  row['wrapperError']=wrapper_error
  # Compiler bytes share the bootstrap pipe, so none can be attributed to prefix.
  # Do not let arbitrary compiler text populate a pre-exec failure classification.
  row['prefix']=({'authority':'UNAUTHENTICATED_CORROBORATION_ONLY','status':'COMPILER_SHARED_PIPE_NOT_PREFIX_ATTRIBUTABLE'} if compiler_diagnostic else prefix_evidence(bytes(diagnostic),observed>1024))
  if phase=='acquire':row['acquisition']=acquisition_evidence(not residual)
  if compiler_diagnostic:
   # Encode arbitrary child bytes so log command/control text cannot execute.
   # At most32768raw bytes / ~44KiBencoded, existing root log channel only.
   captured=bytes(compiler_head) if observed<=16384 else (bytes(compiler_head)+bytes(compiler_tail)[max(0,32768-observed):] if observed<32768 else bytes(compiler_head)+bytes(compiler_tail))
   print('COMPILER_DIAGNOSTIC '+json.dumps({'schema':1,'origin':'EXACT_COMPILER_INVOCATION_MERGED_PIPE_UNTRUSTED_TEXT_NOT_AUTHORITY','fdScope':'EXACT_COMPILER_FD1_FD2_AND_BOOTSTRAP_SHARED_PIPE_NOT_SEPARATELY_ATTRIBUTABLE','observedBytes':observed,'observedSha256':compiler_hash.hexdigest(),'pipeEOF':compiler_eof,'truncated':observed>32768,'headLimit':16384,'tailLimit':16384,'capturedBytes':len(captured),'capturedSha256':hashlib.sha256(captured).hexdigest(),'encoding':'base64','data':base64.b64encode(captured).decode('ascii'),'exitCode':code},separators=(',',':')),flush=True)
  # Root-created finite fields only; emit before private receipt write and cleanup.
  print('DIRECT_CHILD_RECEIPT '+json.dumps(row,separators=(',',':')),flush=True)
  receipt.write_text(json.dumps(row)+'\n');receipt.chmod(0o600)
 if not natural:sys.exit(124 if forced else 125)
 sys.exit(code)
if __name__=='__main__':
 if sys.argv[1]=='observe-cleanup':
  uid=int(sys.argv[2]);stage=sys.argv[3]
  import pwd
  owned_uids=set()
  for account in ('silhouette-acquire','silhouette-runtime'):
   try:owned_uids.add(pwd.getpwnam(account).pw_uid)
   except KeyError:pass
  assert uid>0 and uid in owned_uids and stage in {'CLEANUP_PRE_KILL_CHECK','CLEANUP_POST_KILL_CHECK'}
  owned_pids(uid,stage)
 elif sys.argv[1]=='policy':policy(Path(sys.argv[2]),len(sys.argv)>3 and sys.argv[3]=='transport')
 elif sys.argv[1]=='admit':
  try:admit()
  except BaseException as error:
   row={'stage':STAGE if STAGE in STAGES else'UNKNOWN','exception':type(error).__name__ if type(error).__name__ in ERRORS else'OTHER','errno':error.errno if isinstance(error,OSError)and type(error.errno)is int and 0<=error.errno<=4095 else'UNKNOWN'}
   try:os.write(globals().get('DIAG',1),(json.dumps(row,separators=(',',':'))+'\n').encode())
   except BaseException:pass
   os._exit(125)
 elif sys.argv[1]=='run':run()
 else:raise ValueError('BAD_MODE')
