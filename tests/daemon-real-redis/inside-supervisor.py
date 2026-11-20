"""Proposed trusted namespace control. NOT executed. Runtime hash gate belongs outside."""
import os,sys,pathlib,json,socket,time,subprocess,resource,selectors,signal,ctypes,errno
W=pathlib.Path('/work');children=[];buf={};force=False
TASKS=['Heartbeat','Narrator','Evolution_Goals','Curiosity','Tool_Evolution','Janitor','SelfDev','Dreamer','Self-Healing Kernel']
def drop():
 libc=ctypes.CDLL(None,use_errno=True)
 # Only trusted namespace setup ever has NET_ADMIN; no product evaluates here.
 subprocess.run(['/usr/sbin/ip','link','set','lo','up'],check=True,env={'PATH':'/usr/bin'})
 for name in ['db','data','logs','redis']:(W/name).mkdir()
 for p in [W,*W.iterdir()]:os.chown(p,65534,65534);os.chmod(p,0o700)
 for cap in range(64):
  if libc.prctl(24,cap,0,0,0)!=0 and ctypes.get_errno()!=errno.EINVAL:raise OSError('CAP_BSET_DROP')
 assert libc.prctl(8,0,0,0,0)==0
 os.setgroups([]);os.setgid(65534);os.setuid(65534)
 # Explicitly clear capability sets after UID transition; bounding was dropped first.
 class Header(ctypes.Structure):_fields_=[('version',ctypes.c_uint32),('pid',ctypes.c_int)]
 class Data(ctypes.Structure):_fields_=[('effective',ctypes.c_uint32),('permitted',ctypes.c_uint32),('inheritable',ctypes.c_uint32)]
 assert libc.capset(ctypes.byref(Header(0x20080522,0)),(Data*2)())==0
 assert libc.prctl(47,4,0,0,0)==0 # PR_CAP_AMBIENT_CLEAR_ALL
 assert libc.prctl(38,1,0,0,0)==0 # no-new-privs
 status=pathlib.Path('/proc/self/status').read_text()
 for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']:
  assert int(next(l.split()[1] for l in status.splitlines() if l.startswith(k+':')),16)==0,k
 assert 'NoNewPrivs:\t1' in status and os.getuid()==os.getgid()==65534
 s=socket.socket();s.settimeout(.2)
 try:s.connect(('192.0.2.1',9));raise AssertionError('EXTERNAL_EGRESS')
 except OSError as e:assert e.errno==errno.ENETUNREACH
 finally:s.close()
 assert [l.split(':')[0].strip() for l in pathlib.Path('/proc/net/dev').read_text().splitlines()[2:]]==['lo']
def limits(asbytes):
 def f():
  libc=ctypes.CDLL(None);assert libc.prctl(1,signal.SIGKILL)==0
  if os.getppid()==1:os.kill(os.getpid(),signal.SIGKILL)
  for k,v in [(resource.RLIMIT_AS,asbytes),(resource.RLIMIT_CPU,10),(resource.RLIMIT_FSIZE,1048576),(resource.RLIMIT_NOFILE,64),(resource.RLIMIT_NPROC,32),(resource.RLIMIT_CORE,0)]:resource.setrlimit(k,(v,v))
 return f
def spawn(argv,env,asbytes):
 c=subprocess.Popen(argv,env=env,cwd='/work',stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,preexec_fn=limits(asbytes));children.append(c);return c
def resp(*args):
 with socket.create_connection(('127.0.0.1',16379),timeout=.3) as s:
  data=b'*'+str(len(args)).encode()+b'\r\n'
  for a in args:
   a=str(a).encode();data+=b'$'+str(len(a)).encode()+b'\r\n'+a+b'\r\n'
  s.sendall(data);return s.recv(4096)
def phase(child,redis,deadline):
 sel=selectors.DefaultSelector();streams={};out=bytearray();err=bytearray();total=0
 for c,label in [(child,'node'),(redis,'redis')]:
  for pipe,channel in [(c.stdout,'stdout'),(c.stderr,'stderr')]:sel.register(pipe,selectors.EVENT_READ,(label,channel))
 try:
  while child.poll() is None:
   if time.monotonic()>deadline:raise TimeoutError('OUTER_WALL')
   if redis.poll() is not None:raise RuntimeError('REDIS_EXITED')
   for key,_ in sel.select(.02):
    chunk=os.read(key.fileobj.fileno(),4096)
    if not chunk:sel.unregister(key.fileobj);continue
    total+=len(chunk)
    if total>65536:raise RuntimeError('OUTPUT_LIMIT')
    if key.data==('node','stdout'):
     out.extend(chunk)
     if b'DAEMON_FIXTURE_READY\n' in out and not (W/'logs/system_errors.log').exists():os.mkfifo(W/'logs/system_errors.log',0o600)
    elif key.data==('node','stderr'):err.extend(chunk)
    elif key.data[1]=='stderr':raise RuntimeError('REDIS_STDERR')
   if err:raise RuntimeError('NODE_STDERR')
  child.wait(timeout=.1)
  # Must drain remaining node pipes to EOF, still bounded.
  for pipe,target in [(child.stdout,out),(child.stderr,err)]:
   tail=pipe.read(65537-len(out)-len(err));target.extend(tail)
  assert len(out)+len(err)<=65536 and not err and child.returncode==0
  lines=out.decode('utf8').splitlines();receipt=json.loads(lines[-1]);print(out.decode(),end='',flush=True)
  # Real logs can't silently become provider triggers; unknown warning/error fails.
  assert not any(any(t in l.lower() for t in ['failed','error','warning','fallback','unavailable']) for l in lines[:-1])
  return receipt
 finally:sel.close()
def main():
 drop();env=json.loads(pathlib.Path('/app/runtime-env.json').read_text());os.environ.clear();os.environ.update(env)
 (W/'silhouette.config.json').write_text(pathlib.Path('/app/fixture-config.json').read_text())
 now=int(time.time()*1000);state={'tasks':{n:{'lastRun':now if n=='Janitor' else 0,'runCount':0,'errCount':0} for n in TASKS},'updatedAt':now}
 (W/'data/daemon_state.json').write_text(json.dumps(state))
 redis=spawn(['/usr/bin/redis-server','--bind','127.0.0.1','--port','16379','--protected-mode','yes','--save','','--appendonly','no','--maxmemory','32mb','--maxmemory-policy','noeviction','--maxclients','8','--dir','/work/redis','--loglevel','warning','--daemonize','no'],env,256*1024**2)
 deadline=time.monotonic()+30;ready=False
 for _ in range(50):
  if redis.poll() is not None:raise RuntimeError('REDIS_EARLY_EXIT')
  try:ready=resp('PING')==b'+PONG\r\n'
  except OSError:pass
  if ready:break
  time.sleep(.05)
 assert ready,'REAL_REDIS_HEALTH'
 first=spawn(['/usr/bin/node','--jitless','--no-expose-wasm','--max-old-space-size=128','/app/daemon-entry.cjs','first'],env,4*1024**3)
 r1=phase(first,redis,deadline);assert r1['nonMock'] and r1['runCount']==1 and r1['drainWaitedForRealFIFO'] and r1['allKnownHandlesClosed']
 # Explicit second phase, not retry: same real heldlock with ordinary persisted due metadata.
 state=json.loads((W/'data/daemon_state.json').read_text());assert state['tasks']['Self-Healing Kernel']['runCount']==1
 state['tasks']['Self-Healing Kernel']['lastRun']=0;(W/'data/daemon_state.json').write_text(json.dumps(state))
 (W/'logs/system_errors.log').unlink()
 second=spawn(['/usr/bin/node','--jitless','--no-expose-wasm','--max-old-space-size=128','/app/daemon-entry.cjs','held-lock'],env,4*1024**3)
 r2=phase(second,redis,deadline);assert r2['metadataUnchanged'] and r2['nonMock'] and r2['allKnownHandlesClosed']
 try:resp('SHUTDOWN','NOSAVE')
 except OSError:pass
 redis.wait(timeout=2);assert redis.returncode==0
 assert not list((W/'redis').iterdir());assert not (W/'data/daemon_state.json.tmp').exists()
 print(json.dumps({'accepted':True,'scope':'actual-daemon-selfHealing-realRedis-only','phase1':r1,'phase2':r2,'allRootsNatural':True}),flush=True)
if __name__=='__main__':
 try:main()
 finally:
  for c in children:
   if c.poll() is None:
    force=True
    try:os.killpg(c.pid,signal.SIGTERM);c.wait(timeout=1)
    except (ProcessLookupError,subprocess.TimeoutExpired):
     try:os.killpg(c.pid,signal.SIGKILL);c.wait(timeout=2)
     except ProcessLookupError:pass
  if force:raise RuntimeError('FORCED_CLEANUP_NO_PASS')
