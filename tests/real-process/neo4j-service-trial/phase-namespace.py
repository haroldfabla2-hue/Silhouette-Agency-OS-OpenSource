#!/usr/bin/env python3
"""Outer namespace only. No package code here. REVIEW ONLY."""
from evidence_policy import configure,cap,limited_open,emit_text,emit_bytes,append_text,copy_bounded
import hashlib,json,os,pathlib,resource,selectors,shutil,signal,subprocess,sys,tarfile,time
bwrap='/tmp/security-bin/'+sys.argv[1];mode=sys.argv[2];duration=int(sys.argv[3]);assert mode in {'install','native','browser','checks'}and 0<duration<=1000
status=pathlib.Path('/proc/self/status').read_text();expected=(1<<31)|((1<<12)if mode=='checks'else 0)
assert int(next(l.split()[1]for l in status.splitlines()if l.startswith('CapEff:')),16)==expected
if mode=='checks':subprocess.run(['ip','link','set','lo','up'],check=True,timeout=2)
scratch=pathlib.Path('/tmp/capped');scratch.mkdir(mode=0o700);os.chmod(scratch,0o777)
work=scratch/'work';work.mkdir();ev=scratch/'evidence';ev.mkdir();configure(ev,mode)
# Only reviewed source copy, not host checkout/.git/runtime. All scratch counted.
manifest=json.loads(pathlib.Path('/tmp/harness/integral-inputs.json').read_text())
for row in manifest:
 rel=pathlib.PurePosixPath(row['path']);assert not rel.is_absolute()and'..'not in rel.parts
 src=pathlib.Path('/tmp/work')/rel;assert src.is_file()and not src.is_symlink();b=src.read_bytes();assert hashlib.sha256(b).hexdigest()==row['sha256']
 dst=work/rel;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes(b);dst.chmod(src.stat().st_mode&0o777)
(work/'node_modules').mkdir();os.chmod(work,0o777);os.chmod(ev,0o777)
# uid1000 can author outputs, but no host or unrelated dependency writes.
for p in work.rglob('*'):
 if p.is_dir():p.chmod(0o777)
 else:p.chmod(p.stat().st_mode&0o777)
cmd=[bwrap,'--die-with-parent','--unshare-user','--uid','1000','--gid','1000','--unshare-pid','--cap-drop','ALL']
for p in ['/usr','/bin','/lib','/lib64','/etc','/opt']:cmd+=['--ro-bind',p,p]
if mode in {'install','native','browser'}:
 target=pathlib.Path('/etc/resolv.conf').resolve(strict=True)
 assert target==pathlib.Path('/etc/resolv.conf')or(target.is_relative_to('/run')and len(target.parts)<=8)
 if target!=pathlib.Path('/etc/resolv.conf'):
  for directory in reversed(target.parent.parents):
   if str(directory)!='/':cmd+=['--dir',str(directory)]
  cmd+=['--dir',str(target.parent)]
 cmd+=['--ro-bind','/etc/resolv.conf',str(target)]
cmd+=['--proc','/proc','--dev','/dev','--remount-ro','/dev','--bind',str(scratch),'/tmp','--ro-bind','/tmp/harness','/tmp/harness','--ro-bind','/tmp/limits','/tmp/limits']
# Capped scratch is /tmp, original complete deps reside in separately fixed store.
cmd+=['--bind'if mode=='install'else'--ro-bind','/tmp/deps-store','/tmp/work/node_modules']
if mode=='native':
 for rel in ['.silhouette-native-neo4j','.silhouette-native-redis','better-sqlite3','@xenova/transformers/node_modules/sharp']:cmd+=['--bind','/tmp/deps-store/'+rel,'/tmp/work/node_modules/'+rel]
if mode=='browser':
 cmd+=['--bind','/tmp/deps-store/.silhouette-browser-assets','/tmp/work/node_modules/.silhouette-browser-assets']
if mode=='checks':
 # Disposable writable fixture source root contains exact admitted config and
 # private percase SQLite/Lance, never host or persisted production state.
 (scratch/'product-runtime').mkdir();(scratch/'product-runtime').chmod(0o777)
 runtime=scratch/'neo4j-runtime';runtime.mkdir();runtime.chmod(0o777)
 for name in ['conf','data','home','run','logs','transactions','java-tmp','plugins-empty','import-empty']:
  (runtime/name).mkdir();(runtime/name).chmod(0o777)
 for source,target in [('neo4j-auth.conf','neo4j.conf'),('neo4j-boot-logs.xml','server-logs.xml'),('neo4j-boot-user-logs.xml','user-logs.xml')]:
  shutil.copyfile('/tmp/harness/'+source,runtime/'conf'/target)
 # Config is exact fixture input copied once before product processes exist.
 config=(pathlib.Path('/tmp/harness')/'silhouette.config.json').read_bytes()
 assert len(config)<=131072;(work/'silhouette.config.json').write_bytes(config)
# No Vite/browser cache mounts. Normal product modules stay enabled.
cmd+=['--remount-ro','/','--chdir','/tmp/work','/usr/bin/python3','/tmp/harness/phase-child.py',mode]
# INSTALL only: exact locked Lance binary116740704B exceeds64MiB.
#128MiB is a fixed design bound with17.5MB headroom, not proof all files fit.
file_limit=(256 if mode=='browser'else 128 if mode=='install'else 64)*1024**2
inherited_nofile=resource.getrlimit(resource.RLIMIT_NOFILE)
if mode=='checks':assert inherited_nofile[1]==resource.RLIM_INFINITY or inherited_nofile[1]>=40000,'NOT_STARTED_INHERITED_HARD_LT_SERVICE_ROLE'
nofile_limit=40000 if mode=='checks'else 4096 if mode=='install'else 256
resource.setrlimit(resource.RLIMIT_FSIZE,(file_limit,file_limit));resource.setrlimit(resource.RLIMIT_NOFILE,(nofile_limit,nofile_limit))
host_pid_namespace=json.loads(pathlib.Path('/tmp/export/node-host.json').read_text())['host_pid_namespace']
t=time.monotonic();child=subprocess.Popen(cmd,env={'PATH':'/usr/bin:/bin','PHASE_DEADLINE_MONOTONIC':str(t+duration),'JOINT_HOST_PID_NAMESPACE':host_pid_namespace},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
if mode=='checks':resource.setrlimit(resource.RLIMIT_NOFILE,(256,256))
observer_nofile_at_runtime=list(resource.getrlimit(resource.RLIMIT_NOFILE))
sel=selectors.DefaultSelector();sel.register(child.stdout,selectors.EVENT_READ);failure=None;failure_cause=None;signals=[];observed=0;eof=False
try:
 with limited_open(ev/'namespace.log')as log:
  while True:
   if time.monotonic()-t>duration+5:raise TimeoutError('outer namespace deadline')
   for key,_ in sel.select(.05):
    b=os.read(key.fd,65536)
    if not b:eof=True;sel.unregister(key.fd)
    else:
     observed+=len(b)
     if observed>cap(ev/'namespace.log'):
      failure_cause='EVIDENCE_NAMESPACE_CAP';raise RuntimeError('outer log cap before write')
     log.write(b);log.flush()
   if child.poll()is not None and eof:break
except BaseException as e:
 failure=repr(e)
 try:os.killpg(child.pid,signal.SIGKILL);signals.append('SIGKILL')
 except ProcessLookupError:pass
 child.wait(timeout=3)
finally:
 sel.close();child.stdout.close();post=[]
 # After nested PID namespace exit, compare every original source byte.
 for row in manifest:
  p=work/row['path']
  if not p.is_file()or p.is_symlink()or hashlib.sha256(p.read_bytes()).hexdigest()!=row['sha256']:post.append(row['path'])
 emit_text(ev/'source-post.json',json.dumps({'drift':post}))
 emit_text(ev/'namespace-status.json',json.dumps({'rc':child.returncode,'failure':failure,'failure_cause':failure_cause,'checks_pipe_cause_authority':'This outer receipt establishes cap cause when inner checks-session is absent after group kill','signals':signals,'eof':eof,'seconds':time.monotonic()-t,'file_limit_bytes':file_limit,'nofile_limit':nofile_limit,'namespace_observer_nofile_at_runtime':observer_nofile_at_runtime,'inherited_nofile_before_role_lower':list(inherited_nofile),'role_scope':'SEPARATE_SERVICE40000_CLIENT256'if mode=='checks'else'ARCHIVE_NATIVE256'}))
 # Evidence is copied only by outer supervisor after package/test PID namespace ends.
 for p in sorted(ev.iterdir()):
  if p.is_symlink()or not p.is_file():raise RuntimeError('nonregular evidence')
  # Same reviewed phase prefix when crossing the fixed export root.
  configure(pathlib.Path('/tmp/export'),mode);copy_bounded(p,pathlib.Path('/tmp/export')/p.name)
raise SystemExit(0 if child.returncode==0 and not failure and not signals and eof and not post else 1)
