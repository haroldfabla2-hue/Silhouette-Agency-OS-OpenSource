"""Outer PIDnamespace supervisor only; real tests execute in nested nonroot ns.
Review-only. None of these setup operations has been executed.
"""
import json,os,pathlib,resource,signal,subprocess,sys,tarfile,time
bwrap='/tmp/security-bin/'+sys.argv[1]
# Existing route already uses CAP_NET_ADMIN solely in private netnamespace.
subprocess.run(['ip','link','set','lo','up'],check=True,timeout=2)
root=pathlib.Path('/tmp');scratch=root/'capped';scratch.mkdir(mode=0o700)
# Whole /tmp is sized512MiB, all authoredwork/logs/home live under it.
cmd=[bwrap,'--die-with-parent','--unshare-user','--uid','1000','--gid','1000','--unshare-pid','--cap-drop','ALL']
# Shares outer networknamespace which has ONLY loopback. No host net.
for source in ['/usr','/bin','/lib','/lib64','/etc','/opt']:cmd+=['--ro-bind',source,source]
cmd+=['--proc','/proc','--dev','/dev','--remount-ro','/dev','--ro-bind','/tmp/work','/tmp/work','--ro-bind','/tmp/harness','/tmp/harness','--ro-bind','/tmp/limits','/tmp/limits','--bind',str(scratch),'/tmp/capped','--remount-ro','/','--chdir','/tmp/work','/usr/bin/python3','/tmp/harness/runner-integrated.py','--repo','/tmp/work','--evidence','/tmp/capped/run','--cgroup','/tmp/limits']
# Only supervisor can export; tests do NOT mount /tmp/export or raw sidecar paths
# outside authored store. Mount keeps subtree journal operations within SQLite.
resource.setrlimit(resource.RLIMIT_FSIZE,(64*1024**2,64*1024**2))
start=time.monotonic();child=subprocess.Popen(cmd,env={'PATH':'/usr/bin:/bin','SILHOUETTE_INFERENCE_MODE':'cloud-only','SILHOUETTE_SNAPSHOT_DIAGNOSTIC':'metadata-only'},start_new_session=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
# Parent export capacity: never copy nodes/symlinks, never original user files.
import selectors
sel=selectors.DefaultSelector();sel.register(child.stdout,selectors.EVENT_READ);log=(scratch/'namespace.log').open('wb');signals=[];observed=0;failure=None
try:
 while child.poll() is None:
  if time.monotonic()-start>340:raise TimeoutError('inner scope wall340s')
  for key,_ in sel.select(.05):
   data=os.read(key.fileobj.fileno(),65536)
   observed+=len(data)
   if observed>4*1024**2:raise RuntimeError('namespace transcript4MiBcap')
   log.write(data);log.flush()
except BaseException as error:
 failure=repr(error)
 if child.poll() is None:
  os.killpg(child.pid,signal.SIGKILL);signals.append('SIGKILL_INNER_NAMESPACE_FAILURE');child.wait(timeout=3)
finally:
 log.close();sel.close()
 # Outer supervisor reads authored evidence AFTER the entire inner PIDnamespace
 # has terminated, never while any SQLiteholder lives. No fs.* sidecar reader in
 # the same process as a SQLiteowner at any point.
 (scratch/'namespace-status.json').write_text(json.dumps({'rc':child.returncode,'failure':failure,'signals':signals,'seconds':time.monotonic()-start}))
 export=pathlib.Path('/tmp/export');tarpath=export/'authored-evidence.tar.gz'
 # Export<=64MiB compressed is its own hardRLIMIT_FSIZE; source entire/tmp<=512MiB.
 with tarfile.open(tarpath,'w:gz',dereference=False) as tar:
  for f in sorted(scratch.rglob('*')):
   if f.is_symlink():continue
   if f.is_file():tar.add(f,arcname=str(f.relative_to(scratch)),recursive=False)
 # No globalnamespace/productclosure claim from killing timed-out process.
raise SystemExit(0 if child.returncode==0 and not failure and not signals else 1)
