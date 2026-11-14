#!/usr/bin/env python3
"""Review-only project integration supervisor. No approval inferred from flags."""
import argparse,json,os,pathlib,resource,signal,subprocess,hashlib,time,selectors,shutil
P=pathlib.Path;p=argparse.ArgumentParser()
for name in ['bwrap','phase','app','deps','browser','review-dir','node-root','cgroup-parent','cgroup-tag','memory-bytes','wall-seconds','evidence']:p.add_argument('--'+name,required=True)
a=p.parse_args();assert a.phase in ['preflight','runtime-prerequisites','ui-build','server-build','runtime'];memory=int(a.memory_bytes);wall=int(a.wall_seconds);assert memory==3*1024**3 and wall==180 and a.cgroup_tag.isdigit()
app=P(a.app).resolve();evidence=P(a.evidence).resolve();assert not evidence.exists();evidence.mkdir(mode=0o700)
start=time.monotonic();childcg=None;proc=None;failure=None;events=[];receipts=[];mem={};written=0;procs=[];memoryEvents='UNVERIFIED';code=None;removed=False

def interrupted(signum,frame):raise RuntimeError('SUPERVISOR_INTERRUPTED:'+str(signum))
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
try:
 cg=P(a.cgroup_parent).resolve();assert cg==P('/sys/fs/cgroup')or str(cg).startswith('/sys/fs/cgroup/');assert os.access(cg,os.W_OK),'HARD_CGROUP_UNAVAILABLE'
 cur=cg
 while True:
  if(cur/'memory.max').exists():
   maximum=(cur/'memory.max').read_text().strip();current=int((cur/'memory.current').read_text());receipts.append({'path':str(cur),'max':maximum,'current':current})
   if maximum!='max':assert int(maximum)-current>=memory+256*1024**2,'INSUFFICIENT_ANCESTOR_HEADROOM'
  if cur==P('/sys/fs/cgroup'):break
  cur=cur.parent
 mem=dict((l.split(':')[0],l.split(':')[1].strip())for l in P('/proc/meminfo').read_text().splitlines());assert int(mem['MemAvailable'].split()[0])*1024>=memory+1024**3,'INSUFFICIENT_PHYSICAL_HEADROOM'
 assert {'memory','pids','cpu'}<=set((cg/'cgroup.subtree_control').read_text().split()),'CGROUP_CONTROLLERS_NOT_DELEGATED'
 assert shutil.disk_usage(app).free>=1024**3,'INSUFFICIENT_DISK_HEADROOM'
 assert(app/'RUNTIME-MATERIALIZATION-REVIEWED.json').is_file(),'STATE_MATERIALIZATION_NOT_REVIEWED'
 assert not any((app/x).exists()for x in ['.env','.env.local','.git','data/tools.db','silhouette/silhouette_discovery.db']),'HISTORICAL_STATE_PRESENT'
 childcg=cg/('silhouette-ui-'+a.cgroup_tag+'-'+str(os.getpid()));assert not childcg.exists();childcg.mkdir()
 for name,value in [('memory.max',str(memory)),('memory.swap.max','0'),('pids.max','96'),('cpu.max','100000 100000')]: (childcg/name).write_text(value)
 def setup():
  os.setsid();(childcg/'cgroup.procs').write_text(str(os.getpid()))
  for typ,val in [(resource.RLIMIT_CORE,0),(resource.RLIMIT_NOFILE,256),(resource.RLIMIT_NPROC,96),(resource.RLIMIT_CPU,120),(resource.RLIMIT_FSIZE,64*1024**2)]:resource.setrlimit(typ,(val,val))
  os.sched_setaffinity(0,{min(os.sched_getaffinity(0))})
 # Explicit empty root first. Only reviewed bind roots enter it, never '/' host.
 bwrap=P(a.bwrap).resolve(strict=True);assert hashlib.sha256(bwrap.read_bytes()).hexdigest()=='e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71'
 cmd=[str(bwrap),'--die-with-parent','--new-session','--unshare-user','--uid','0','--gid','0','--unshare-net','--unshare-pid','--unshare-ipc','--unshare-uts','--cap-drop','ALL','--cap-add','CAP_NET_ADMIN','--cap-add','CAP_SETPCAP','--clearenv','--tmpfs','/','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/home','--dir','/home/test']
 for x in ['/usr','/bin','/lib','/lib64','/etc/fonts','/etc/ld.so.cache','/etc/ssl/certs']:
  if P(x).exists():cmd+=['--ro-bind',x,x]
 for src,dst,mode in [(app,'/app','--bind'),(P(a.deps),'/app/node_modules','--ro-bind'),(P(a.browser),'/browser-assets','--ro-bind'),(P(a.review_dir),'/driver','--ro-bind'),(P(a.node_root),'/node','--ro-bind'),(evidence,'/evidence','--bind')]:cmd+=[mode,str(src.resolve()),dst]
 cmd+=['--tmpfs','/app/node_modules/.vite-temp','--chdir','/app','--setenv','PATH','/node/bin:/usr/bin:/bin','--setenv','HOST_NETNS',os.readlink('/proc/self/ns/net'),'--setenv','HOME','/home/test','--setenv','TMPDIR','/tmp','/usr/bin/python3','/driver/namespace-entry.py',a.phase]
 proc=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env={'PATH':'/usr/bin:/bin'},preexec_fn=setup);sel=selectors.DefaultSelector();os.set_blocking(proc.stdout.fileno(),False);sel.register(proc.stdout,selectors.EVENT_READ);eof=False
 with(evidence/'complete.log').open('xb')as log:
  while True:
   if time.monotonic()-start>wall:raise TimeoutError('WALL_LIMIT')
   if sum(f.stat().st_size for f in app.rglob('*')if f.is_file())>512*1024**2:raise RuntimeError('DISK_OUTPUT_CAP')
   for r in receipts:
    maximum=(P(r['path'])/'memory.max').read_text().strip();current=int((P(r['path'])/'memory.current').read_text())
    if maximum!='max'and int(maximum)-current<256*1024**2:raise RuntimeError('PARENT_MEMORY_RESERVE')
   for key,_ in sel.select(.1):
    b=os.read(key.fd,65536)
    if not b:eof=True;sel.unregister(key.fd);continue
    written+=len(b)
    if written>32*1024**2:raise RuntimeError('LOG_CAP_NO_TRUNCATION_PASS')
    log.write(b)
   if proc.poll()is not None and eof:break
 code=proc.returncode
except BaseException as e:failure=type(e).__name__+':'+str(e)
finally:
 # Receipt is owed even when setup, fork, root-preflight or wait fails.
 try:
  if childcg is not None and childcg.exists():
   procs=(childcg/'cgroup.procs').read_text().split()
   if procs:
    events.append('EMERGENCY_CGROUP_KILL_INVALIDATES_PASS');(childcg/'cgroup.kill').write_text('1');end=time.monotonic()+10
    while(childcg/'cgroup.procs').read_text().split()and time.monotonic()<end:time.sleep(.05)
   procs=(childcg/'cgroup.procs').read_text().split();memoryEvents=(childcg/'memory.events').read_text()
   counters=dict(l.split()for l in memoryEvents.splitlines())
   if int(counters.get('oom_kill','0'))or int(counters.get('oom_group_kill','0')):events.append('KERNEL_OOM_KILL_INVALIDATES_PASS')
   if not procs:childcg.rmdir();removed=True
  if proc is not None:
   try:code=proc.wait(timeout=5)
   except BaseException as e:events.append('WAIT_UNVERIFIED:'+type(e).__name__)
 except BaseException as e:events.append('CLEANUP_UNVERIFIED:'+type(e).__name__)
 verdict={'phase':a.phase,'code':code,'failure':failure,'events':events,'seconds':time.monotonic()-start,'logBytes':written,'remainingPids':procs,'memoryEvents':memoryEvents,'cgroupRemoved':removed,'ancestorPreflight':receipts,'physicalPreflight':mem,'memoryCap':memory,'reserveBytes':256*1024**2,'status':'PHASE_EXIT_ONLY_NOT_PRODUCT_COMPLETE','rootBComplete':False}
 (evidence/'supervisor.json').write_text(json.dumps(verdict,indent=2)+'\n')
raise SystemExit(1 if failure or events or procs or code!=0 or not removed else 0)
