#!/usr/bin/env python3
"""Two real isolated disposable cases. Proposed, NOT EXECUTED."""
import hashlib,json,os,pathlib,selectors,shutil,signal,stat,subprocess,tempfile,time
root=pathlib.Path.cwd();evidence=pathlib.Path('/tmp/evidence/hydration-cases');evidence.mkdir();results=[]
def group(pid):
 try:os.killpg(pid,0);return 'LIVE'
 except ProcessLookupError:return 'ESRCH'
 except OSError:return 'UNKNOWN'
for mode in ['cold','malformed']:
 out=evidence/mode;out.mkdir();work=pathlib.Path(tempfile.mkdtemp(prefix='hydration-'+mode+'-'));child=None;eof=False;signals=[];error=None;events=[];observed=0;captures=[]
 try:
  (work/'FIXTURE_ONLY').write_text('HYDRATION_BOUNDARY_ONLY');(work/'data').mkdir();(work/'home').mkdir()
  migrations=work/'db/migrations/sqlite';migrations.mkdir(parents=True)
  for source in sorted((root/'db/migrations/sqlite').iterdir()):
   if not source.is_file() or source.is_symlink():raise RuntimeError('Unexpected migration asset')
   shutil.copy2(source,migrations/source.name)
  disk=work/'data/memory_snapshot.json'
  if mode=='malformed':disk.write_text('{invalid real snapshot')
  (out/'pre-import.json').write_text(json.dumps({'mode':mode,'snapshot_exists':disk.exists(),'snapshot_sha256':hashlib.sha256(disk.read_bytes()).hexdigest() if disk.exists() else None,'snapshot_bytes':disk.stat().st_size if disk.exists() else 0},indent=2))
  env={'PATH':os.environ['PATH'],'HOME':str(work/'home'),'NODE_ENV':'test','SILHOUETTE_PROVIDERS':'off','SILHOUETTE_BOOT_MODE':'acceptance','SILHOUETTE_DB_PATH':str(work/'db/fixture.sqlite'),'SILHOUETTE_IDENTITY_DB_PATH':str(work/'db/identity.sqlite'),'SILHOUETTE_TOOLS_DB_PATH':str(work/'db/tools.sqlite'),'SILHOUETTE_LANCEDB_PATH':str(work/'db/memory.lancedb')}
  child=subprocess.Popen(['node','--import',str(root/'node_modules/tsx/dist/loader.mjs'),str(root/'tests/real-process/hydration-boundary/child.mts'),mode],cwd=work,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
  sel=selectors.DefaultSelector();fd=child.stdout.fileno();os.set_blocking(fd,False);sel.register(fd,selectors.EVENT_READ);start=time.monotonic();ended=None;buffer=b''
  with (out/'child.log').open('wb') as log:
   while True:
    now=time.monotonic();rc=child.poll()
    if now-start>45:raise RuntimeError('case45s deadline')
    if rc is not None and ended is None:ended=now
    if ended is not None and now-ended>2:raise RuntimeError('post-exit2s group/EOF deadline')
    for key,_ in sel.select(.025):
     try:data=os.read(key.fd,65536)
     except BlockingIOError:continue
     if not data:eof=True;sel.unregister(fd)
     else:
      observed+=len(data);log.write(data[:max(0,1024*1024-log.tell())]);log.flush()
      if observed>1024*1024:raise RuntimeError('case1MiB cap; prefix retained, incomplete FAIL')
      buffer+=data
      while b'\n' in buffer:
       line,buffer=buffer.split(b'\n',1)
       if line.startswith(b'HYDRATION_FIXTURE:'):events.append(json.loads(line[len(b'HYDRATION_FIXTURE:'):]))
    if rc is not None and eof and group(child.pid)=='ESRCH':break
  if child.returncode!=0:raise RuntimeError('child nonzero exit')
  if [e['stage'] for e in events]!=['CALLS_RETURNED','OUTCOMES_OBSERVED','COMPLETIONS_OBSERVED','BEFORE_EXIT'] or any(e['pid']!=child.pid or e['mode']!=mode for e in events):raise RuntimeError('marker identity/order mismatch')
 except BaseException as exc:error=str(exc)
 finally:
  pre={'returncode':child.poll() if child else None,'group':group(child.pid) if child else 'NOT_STARTED','pipe_eof':eof}
  def capture(stage):
   rows=[]
   for rel in ['hydration-CALLS_RETURNED.json','hydration-OUTCOMES_OBSERVED.json','hydration-COMPLETIONS_OBSERVED.json','hydration-BEFORE_EXIT.json','data/memory_snapshot.json']:
    p=work/rel
    try: m=p.lstat()
    except FileNotFoundError:rows.append({'path':rel,'exists':False});continue
    if not stat.S_ISREG(m.st_mode):raise RuntimeError('case evidence source not regular/nosymlink')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    try:
     before_stat=os.fstat(fd)
     if (before_stat.st_dev,before_stat.st_ino)!=(m.st_dev,m.st_ino) or not stat.S_ISREG(before_stat.st_mode):raise RuntimeError('case source identity changed before open')
     with os.fdopen(fd,'rb',closefd=False) as stream:data=stream.read(262145)
     after_stat=os.fstat(fd)
     current=p.lstat()
     if len(data)>262144:raise RuntimeError('case evidence source256KiB cap; oversized prefix only, no copy')
     if (before_stat.st_dev,before_stat.st_ino,before_stat.st_size,before_stat.st_mtime_ns,before_stat.st_ctime_ns)!=(after_stat.st_dev,after_stat.st_ino,after_stat.st_size,after_stat.st_mtime_ns,after_stat.st_ctime_ns) or (current.st_dev,current.st_ino)!=(before_stat.st_dev,before_stat.st_ino) or not stat.S_ISREG(current.st_mode) or len(data)!=before_stat.st_size:raise RuntimeError('case evidence source changed during capture')
    finally:os.close(fd)
    dest=out/stage/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data);rows.append({'path':rel,'exists':True,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
   return rows
  capture_error=None;before=None;after=None
  try:before=capture('before-cleanup')
  except BaseException as exc:capture_error=str(exc)
  if child and (child.poll() is None or group(child.pid)!='ESRCH'):
   for sig in [signal.SIGTERM,signal.SIGKILL]:
    if group(child.pid)!='ESRCH':
     try:os.killpg(child.pid,sig);signals.append(sig.name)
     except ProcessLookupError:pass
     except OSError as exc:error=error or str(exc)
    until=time.monotonic()+2
    while time.monotonic()<until:
     child.poll()
     if child.returncode is not None and group(child.pid)=='ESRCH':break
     time.sleep(.025)
  post={'returncode':child.poll() if child else None,'group':group(child.pid) if child else 'NOT_STARTED','pipe_eof':eof}
  safe=not child or (child.returncode is not None and post['group']=='ESRCH')
  if safe:
   try:after=capture('after-cleanup')
   except BaseException as exc:capture_error=capture_error or str(exc)
  if before!=after:error=error or 'captured bytes changed after cleanup or capture incomplete'
  if capture_error:error=error or capture_error
  ok=not error and pre['returncode']==0 and pre['group']=='ESRCH' and eof and not signals
  result={'mode':mode,'status':'PASS_LOCAL_ONLY' if ok else 'FAIL','error':error,'events':events,'pre_cleanup':pre,'post_cleanup':post,'signals':signals,'observed_log_bytes':observed,'before':before,'after':after};results.append(result);(out/'result.json').write_text(json.dumps(result,indent=2))
  if child and child.stdout:child.stdout.close()
  if 'sel' in locals():sel.close();del sel
  if safe:shutil.rmtree(work)
  else:(out/'RETAINED_WORK.txt').write_text(str(work));break
(evidence/'result.json').write_text(json.dumps(results,indent=2))
raise SystemExit(0 if len(results)==2 and all(r['status']=='PASS_LOCAL_ONLY' for r in results) else 1)
