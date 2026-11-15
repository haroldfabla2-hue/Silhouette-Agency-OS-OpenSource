#!/usr/bin/env python3
"""Read-only clock anchor, fixed host budgets and bounded prefix capture. NOT RUN."""
import hashlib,json,os,pathlib,selectors,signal,subprocess,sys,time
mode=sys.argv[1];evidence=pathlib.Path(os.environ['EVIDENCE']);state=evidence/'host-budget.json';clock=evidence/'job-clock.json'
if mode=='clock':
 hz=os.sysconf('SC_CLK_TCK');pid=os.getpid();ancestors=[];anchor=None
 for _ in range(64):
  stat=(pathlib.Path('/proc')/str(pid)/'stat').read_text();tail=stat[stat.rindex(')')+2:].split()
  comm=(pathlib.Path('/proc')/str(pid)/'comm').read_text().strip()
  row={'pid':pid,'comm':comm,'start_ticks':int(tail[19])};ancestors.append(row)
  if comm=='Runner.Worker':anchor=row;break
  pid=int(tail[1])
  if pid<=1:break
 if anchor is None:raise SystemExit('BLOCKED: no Runner.Worker conservative job-start anchor')
 # /proc uptime and monotonic clocks share boot origin on Linux. Worker was
 # alive before it received the job, so its start is a conservative lower bound.
 deadline=anchor['start_ticks']/hz+1200
 data={'anchor':'Runner.Worker process start, conservative before job start','worker':anchor,'ticks_per_second':hz,'deadline_monotonic':deadline,'observed_monotonic':time.monotonic(),'cleanup_export_reserve_seconds':60,'job_limit_seconds':1200}
 clock.write_text(json.dumps(data,indent=2));state.write_text(json.dumps({'elapsed_seconds':0,'observed_bytes':0,'retained_bytes':0,'commands':[]},indent=2))
 raise SystemExit(0)
c=json.loads(clock.read_text());s=json.loads(state.read_text())
if mode=='reserve':
 remaining=c['deadline_monotonic']-time.monotonic()
 row={'remaining_seconds':remaining,'required_seconds':1015,'session_outer_seconds':940,'cleanup_export_reserve_seconds':60,'status':'ADMITTED' if remaining>=1015 else 'NOT_STARTED_JOB_BUDGET'}
 (evidence/'session-admission.json').write_text(json.dumps(row,indent=2))
 raise SystemExit(0 if remaining>=1015 else 1)
assert mode in {'capture','cleanup'}
name=sys.argv[2];limit=float(sys.argv[3]);cmd=sys.argv[4:]
assert name and '/' not in name and cmd
# Fixed aggregate host budget, covering npm ci and every captured setup command.
budget=min(limit,180-s['elapsed_seconds'],c['deadline_monotonic']-time.monotonic()-60) if mode=='capture' else min(20,c['deadline_monotonic']-time.monotonic()-35)
cap=min(512*1024,3*1024*1024-s['retained_bytes']) if mode=='capture' else 65536
row={'name':name,'command':cmd,'effective_seconds':budget,'per_command_cap':512*1024,'remaining_global_bytes':3*1024*1024-s['retained_bytes'],'observed_bytes':0,'retained_bytes':0,'signals':[],'status':'NOT_STARTED'}
child=None;eof=False;failure=None;start=time.monotonic();sel=selectors.DefaultSelector();log=evidence/(name+'.log')
def group(pid):
 try:os.killpg(pid,0);return 'LIVE'
 except ProcessLookupError:return 'ESRCH'
 except OSError:return 'UNKNOWN'
try:
 if budget<=0 or cap<=0:raise RuntimeError('host aggregate time/byte or job-reserve exhausted')
 child=subprocess.Popen(cmd,stdin=sys.stdin,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
 fd=child.stdout.fileno();os.set_blocking(fd,False);sel.register(fd,selectors.EVENT_READ);exited=None
 with log.open('wb') as stream:
  while True:
   now=time.monotonic();rc=child.poll()
   if now-start>budget:raise RuntimeError('host command/aggregate/job-reserve deadline')
   if rc is not None and exited is None:exited=now
   if exited is not None and now-exited>2:raise RuntimeError('host post-exit group/EOF deadline')
   for key,_ in sel.select(.025):
    try:b=os.read(key.fd,65536)
    except BlockingIOError:continue
    if not b:eof=True;sel.unregister(fd)
    else:
     row['observed_bytes']+=len(b);keep=b[:max(0,cap-row['retained_bytes'])]
     stream.write(keep);stream.flush();row['retained_bytes']+=len(keep)
     if keep:sys.stdout.buffer.write(keep);sys.stdout.buffer.flush()
     if row['observed_bytes']>cap:raise RuntimeError('host phase/global byte cap; prefix retained, truncated')
   if rc is not None and eof and group(child.pid)=='ESRCH':break
except BaseException as error:failure=str(error)
finally:
 row['pre_cleanup']={'returncode':child.poll() if child else None,'group':group(child.pid) if child else 'NOT_STARTED','pipe_eof':eof}
 if child and (child.poll() is None or group(child.pid)!='ESRCH'):
  for sig in [signal.SIGTERM,signal.SIGKILL]:
   if group(child.pid)!='ESRCH':
    try:os.killpg(child.pid,sig);row['signals'].append(sig.name)
    except ProcessLookupError:pass
    except OSError as error:failure=failure or str(error)
   until=time.monotonic()+2
   while time.monotonic()<until:
    child.poll()
    if child.returncode is not None and group(child.pid)=='ESRCH':break
    time.sleep(.025)
 row['post_cleanup']={'returncode':child.poll() if child else None,'group':group(child.pid) if child else 'NOT_STARTED','pipe_eof':eof}
 row.update({'error':failure,'truncated':row['observed_bytes']>row['retained_bytes'],'elapsed_seconds':time.monotonic()-start,'status':'PASS' if child and not failure and child.returncode==0 and eof and group(child.pid)=='ESRCH' and not row['signals'] else 'FAIL' if child else 'NOT_STARTED'})
 row['sha256']=hashlib.sha256(log.read_bytes() if log.exists() else b'').hexdigest()
 s['elapsed_seconds']+=row['elapsed_seconds'] if mode=='capture' else 0;s['observed_bytes']+=row['observed_bytes'];s['retained_bytes']+=row['retained_bytes'];s['commands'].append(row)
 state.write_text(json.dumps(s,indent=2));(evidence/(name+'.capture.json')).write_text(json.dumps(row,indent=2));(evidence/(name+'.exit')).write_text('0\n' if row['status']=='PASS' else '1\n')
 sel.close()
 if child and child.stdout:child.stdout.close()
raise SystemExit(0 if row['status']=='PASS' else 1)
