#!/usr/bin/env python3
"""Outer namespace only. No package code here. REVIEW ONLY."""
import hashlib,json,os,pathlib,resource,selectors,shutil,signal,subprocess,sys,tarfile,time
bwrap='/tmp/security-bin/'+sys.argv[1];mode=sys.argv[2];duration=int(sys.argv[3]);assert mode in {'install','native','browser','checks'}and 0<duration<=1000
status=pathlib.Path('/proc/self/status').read_text();expected=(1<<31)|((1<<12)if mode=='checks'else 0)
assert int(next(l.split()[1]for l in status.splitlines()if l.startswith('CapEff:')),16)==expected
if mode=='checks':subprocess.run(['ip','link','set','lo','up'],check=True,timeout=2)
scratch=pathlib.Path('/tmp/capped');scratch.mkdir(mode=0o700);os.chmod(scratch,0o777)
work=scratch/'work';work.mkdir();ev=scratch/'evidence';ev.mkdir()
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
 for rel in ['.silhouette-native-neo4j']:cmd+=['--bind','/tmp/deps-store/'+rel,'/tmp/work/node_modules/'+rel]
if mode=='browser':
 cmd+=['--bind','/tmp/deps-store/.silhouette-browser-assets','/tmp/work/node_modules/.silhouette-browser-assets']
if mode=='checks':
 for name in ['.vite-temp','.vite']:
  # Empty destinations were prepared on fixedstore before RO mount. Only this
  # scratchdirectory becomes writable, never any dependency package bytes.
  source=scratch/('private-'+name);source.mkdir(mode=0o777);source.chmod(0o777)
  destination=pathlib.Path('/tmp/deps-store')/name
  assert destination.is_dir()and not destination.is_symlink()and not list(destination.iterdir())
  cmd+=['--bind',str(source),'/tmp/work/node_modules/'+name]
cmd+=['--remount-ro','/','--chdir','/tmp/work','/usr/bin/python3','/tmp/harness/phase-child.py',mode]
# INSTALL only: exact locked Lance binary116740704B exceeds64MiB.
#128MiB is a fixed design bound with17.5MB headroom, not proof all files fit.
file_limit=(256 if mode=='browser'else 128 if mode=='install'else 64)*1024**2
nofile_limit=4096 if mode=='install'else 256
resource.setrlimit(resource.RLIMIT_FSIZE,(file_limit,file_limit));resource.setrlimit(resource.RLIMIT_NOFILE,(nofile_limit,nofile_limit))
t=time.monotonic();child=subprocess.Popen(cmd,env={'PATH':'/usr/bin:/bin','PHASE_DEADLINE_MONOTONIC':str(t+duration)},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True);sel=selectors.DefaultSelector();sel.register(child.stdout,selectors.EVENT_READ);failure=None;signals=[];observed=0;eof=False
try:
 with(ev/'namespace.log').open('wb')as log:
  while True:
   if time.monotonic()-t>duration+5:raise TimeoutError('outer namespace deadline')
   for key,_ in sel.select(.05):
    b=os.read(key.fd,65536)
    if not b:eof=True;sel.unregister(key.fd)
    else:
     observed+=len(b);log.write(b[:max(0,1024**2-log.tell())]);log.flush()
     if observed>1024**2:raise RuntimeError('outer log cap')
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
 (ev/'source-post.json').write_text(json.dumps({'drift':post}))
 (ev/'namespace-status.json').write_text(json.dumps({'rc':child.returncode,'failure':failure,'signals':signals,'eof':eof,'seconds':time.monotonic()-t,'file_limit_bytes':file_limit,'nofile_limit':nofile_limit}))
 # Evidence is copied only by outer supervisor after package/test PID namespace ends.
 for p in sorted(ev.iterdir()):
  if p.is_symlink()or not p.is_file():raise RuntimeError('nonregular evidence')
  shutil.copyfile(p,pathlib.Path('/tmp/export')/p.name)
raise SystemExit(0 if child.returncode==0 and not failure and not signals and eof and not post else 1)
