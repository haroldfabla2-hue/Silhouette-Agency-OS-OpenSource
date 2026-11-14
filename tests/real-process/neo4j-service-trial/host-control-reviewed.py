#!/usr/bin/env python3
"""Read-only clock anchor, fixed host budgets and bounded complete capture. NOT RUN."""
from evidence_policy import configure,cap,limited_open,emit_text,emit_bytes,append_text,copy_bounded
import hashlib,json,math,os,pathlib,selectors,signal,subprocess,sys,time
mode=sys.argv[1];evidence=pathlib.Path(os.environ['EVIDENCE']);state=evidence/'host-budget.json';clock=evidence/'job-clock.json'
# Cleanup must still be attempted when observation/admission evidence is broken.
# 0 = cleanup + evidence valid; 2 = system cleanup observed but evidence invalid;
# 1 = system cleanup not confirmed. None permits claiming lifecycle acceptance.
def cleanup_attempt():
 name=sys.argv[2];cmd=sys.argv[4:]
 assert name in {'cgroup-cleanup','sandbox-cleanup','trial-cgroup-cleanup','dependency-volume-cleanup'} and cmd
 row={'name':name,'command':cmd,'deadline_basis':'LOCAL_FIXED_CLEANUP_WINDOW','effective_seconds':20,'observed_bytes':0,'retained_bytes':0,'signals':[],'errors':[],'state_unavailable':False,'clock_unavailable':False,'log_available':False,'status':'FAIL'}
 def error(stage,exc):row['errors'].append({'stage':stage,'type':type(exc).__name__,'errno':getattr(exc,'errno',None)})
 policy_ok=False
 try:configure(evidence);policy_ok=True
 except BaseException as exc:error('POLICY_UNAVAILABLE',exc)
 # Zero fields are unavailable placeholders, NOT evidence of remaining budget.
 aggregate={'elapsed_seconds':0,'observed_bytes':0,'retained_bytes':0,'commands':[],'budget_evidence':'UNAVAILABLE_PLACEHOLDERS_NOT_REMAINING_BUDGET'}
 try:
  value=json.loads(state.read_text());assert isinstance(value['commands'],list)
  assert all(type(value[k])in {int,float}and math.isfinite(value[k])and value[k]>=0 for k in ['elapsed_seconds','observed_bytes','retained_bytes'])
  aggregate=value
 except BaseException as exc:row['state_unavailable']=True;error('STATE_UNAVAILABLE',exc)
 clockdata=None
 try:
  clockdata=json.loads(clock.read_text());assert type(clockdata['deadline_monotonic'])in {int,float}and math.isfinite(clockdata['deadline_monotonic'])
  row['job_reserve_violated_at_start']=time.monotonic()>clockdata['deadline_monotonic']-120
 except BaseException as exc:clockdata=None;row['clock_unavailable']=True;error('CLOCK_UNAVAILABLE',exc)
 stream=None;maximum=0
 try:
  if not policy_ok:raise RuntimeError('No admitted evidence policy')
  maximum=cap(evidence/(name+'.log'));stream=limited_open(evidence/(name+'.log'));row['log_available']=True
 except BaseException as exc:error('LOG_OPEN_UNAVAILABLE',exc)
 child=None;sel=None;eof=False;start=time.monotonic();group_state='NOT_STARTED'
 def group():
  if child is None:return 'NOT_STARTED'
  try:os.killpg(child.pid,0);return 'LIVE'
  except ProcessLookupError:return 'ESRCH'
  except OSError:return 'UNKNOWN'
 try:
  # Local window does not extend the workflow deadline or guarantee completion
  # if its outer timeout kills this process before cleanup finishes.
  child=subprocess.Popen(cmd,stdin=sys.stdin,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
  os.set_blocking(child.stdout.fileno(),False);sel=selectors.DefaultSelector();sel.register(child.stdout,selectors.EVENT_READ);exited=None
  while True:
   now=time.monotonic();rc=child.poll()
   if now-start>=20:raise TimeoutError('Local cleanup window exhausted')
   if rc is not None and exited is None:exited=now
   if exited is not None and now-exited>2:raise TimeoutError('Cleanup group/EOF deadline')
   for key,_ in sel.select(.025):
    try:chunk=os.read(key.fd,65536)
    except BlockingIOError:continue
    if not chunk:eof=True;sel.unregister(key.fd);continue
    row['observed_bytes']+=len(chunk)
    if stream is not None:
     try:
      if row['retained_bytes']+len(chunk)>maximum:raise RuntimeError('Complete cleanup log exceeds cap')
      stream.write(chunk);stream.flush();row['retained_bytes']+=len(chunk)
     except BaseException as exc:
      row['log_available']=False;error('LOG_WRITE_UNAVAILABLE_DRAIN_CONTINUES',exc)
      try:stream.close()
      except BaseException as exc:error('LOG_CLOSE_UNAVAILABLE',exc)
      stream=None
   if rc is not None and eof and group()=='ESRCH':break
 except BaseException as exc:error('CLEANUP_PROCESS',exc)
 finally:
  row['pre_cleanup']={'returncode':child.poll()if child else None,'group':group(),'pipe_eof':eof}
  if child and(child.poll()is None or group()!='ESRCH'):
   for sig in [signal.SIGTERM,signal.SIGKILL]:
    if group()!='ESRCH':
     try:os.killpg(child.pid,sig);row['signals'].append(sig.name)
     except ProcessLookupError:pass
     except BaseException as exc:error('SIGNAL',exc)
    until=time.monotonic()+2
    while time.monotonic()<until:
     child.poll()
     if child.returncode is not None and group()=='ESRCH':break
     time.sleep(.025)
  row['post_cleanup']={'returncode':child.poll()if child else None,'group':group(),'pipe_eof':eof}
  if stream is not None:
   try:stream.close()
   except BaseException as exc:row['log_available']=False;error('LOG_CLOSE_UNAVAILABLE',exc)
  if sel is not None:
   try:sel.close()
   except BaseException as exc:error('SELECTOR_CLOSE_UNAVAILABLE',exc)
  if child and child.stdout:
   try:child.stdout.close()
   except BaseException as exc:error('PIPE_CLOSE_UNAVAILABLE',exc)
  row['elapsed_seconds']=time.monotonic()-start
  row['job_deadline_overrun']=None if clockdata is None else time.monotonic()>clockdata['deadline_monotonic']
  row['job_reserve_violated_at_finish']=None if clockdata is None else time.monotonic()>clockdata['deadline_monotonic']-120
  system_clean=bool(child and child.returncode==0 and eof and group()=='ESRCH'and not row['signals'] and not any(x['stage']=='CLEANUP_PROCESS'for x in row['errors']))
  row['system_cleanup_confirmed']=system_clean
  def valid():return system_clean and not row['errors'] and not row['state_unavailable'] and not row['clock_unavailable'] and row['log_available'] and not row['job_reserve_violated_at_finish']
  def receipt(path,value,stage):
   try:emit_text(path,json.dumps(value,separators=(',',':'))+'\n');return True
   except BaseException as exc:error(stage,exc);return False
  # Per-command receipts precede aggregate; all writes are independently guarded.
  row['status']='PASS'if valid()else'FAIL'
  receipt(evidence/(name+'.capture.json'),row,'CAPTURE_RECEIPT_UNAVAILABLE')
  receipt(evidence/(name+'.exit'),{'exit_code':0 if valid()else 2 if system_clean else 1,'status':row['status'],'system_cleanup_confirmed':system_clean,'provisional_until_aggregate':True},'EXIT_RECEIPT_UNAVAILABLE')
  aggregate['commands'].append(dict(row));aggregate['observed_bytes']+=row['observed_bytes'];aggregate['retained_bytes']+=row['retained_bytes']
  receipt(state,aggregate,'STATE_RECEIPT_UNAVAILABLE_OR_OVERFLOW')
  row['status']='PASS'if valid()else'FAIL'
  receipt(evidence/(name+'.capture.json'),row,'FINAL_CAPTURE_RECEIPT_UNAVAILABLE')
  receipt(evidence/(name+'.exit'),{'exit_code':0 if valid()else 2 if system_clean else 1,'status':'PASS'if valid()else'FAIL','system_cleanup_confirmed':system_clean,'errors':row['errors'],'state_receipt_overflow':any(x['stage']=='STATE_RECEIPT_UNAVAILABLE_OR_OVERFLOW'for x in row['errors'])},'FINAL_EXIT_RECEIPT_UNAVAILABLE')
  # Process result survives receipt exceptions; no claim that FS is infallible.
  raise SystemExit(0 if valid()else 2 if system_clean else 1)
if mode in {'cleanup','file-cleanup'}:cleanup_attempt()
configure(evidence)
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
 deadline=anchor['start_ticks']/hz+1800
 data={'anchor':'Runner.Worker process start, conservative before job start','worker':anchor,'ticks_per_second':hz,'deadline_monotonic':deadline,'observed_monotonic':time.monotonic(),'cleanup_export_reserve_seconds':120,'job_limit_seconds':1800}
 emit_text(clock,json.dumps(data,indent=2));emit_text(state,json.dumps({'elapsed_seconds':0,'observed_bytes':0,'retained_bytes':0,'commands':[]},indent=2))
 raise SystemExit(0)
c=json.loads(clock.read_text());s=json.loads(state.read_text())
if mode=='reserve':
 remaining=c['deadline_monotonic']-time.monotonic()
 row={'remaining_seconds':remaining,'required_seconds':1505,'session_outer_seconds':1385,'cleanup_export_reserve_seconds':120,'status':'ADMITTED' if remaining>=1505 else 'NOT_STARTED_JOB_BUDGET'}
 emit_text(evidence/'session-admission.json',json.dumps(row,indent=2))
 raise SystemExit(0 if remaining>=1505 else 1)
assert mode in {'capture','cleanup','file-setup','file-cleanup'}
name=sys.argv[2];limit=float(sys.argv[3]);cmd=sys.argv[4:]
assert name and '/' not in name and cmd
# Fixed aggregate host budget, covering npm ci and every captured setup command.
budget=min(limit,600-s['elapsed_seconds'],c['deadline_monotonic']-time.monotonic()-120) if mode in {'capture','file-setup'} else min(20,c['deadline_monotonic']-time.monotonic()-35)
output_path=evidence/(name+('.json'if mode=='file-setup'and name=='dependency-volume'else'.log'))
output_cap=min(cap(output_path),3*1024*1024-s['retained_bytes']) if mode in {'capture','file-setup'} else cap(output_path)
row={'name':name,'command':cmd,'effective_seconds':budget,'per_command_cap':output_cap,'remaining_global_bytes':3*1024*1024-s['retained_bytes'],'observed_bytes':0,'retained_bytes':0,'signals':[],'status':'NOT_STARTED'}
child=None;eof=False;failure=None;start=time.monotonic();sel=selectors.DefaultSelector();log=output_path
def group(pid):
 try:os.killpg(pid,0);return 'LIVE'
 except ProcessLookupError:return 'ESRCH'
 except OSError:return 'UNKNOWN'
try:
 if budget<=0 or output_cap<=0:raise RuntimeError('host aggregate time/byte or job-reserve exhausted')
 child=subprocess.Popen(cmd,stdin=sys.stdin,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
 fd=child.stdout.fileno();os.set_blocking(fd,False);sel.register(fd,selectors.EVENT_READ);exited=None
 with limited_open(log)as stream:
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
     row['observed_bytes']+=len(b);keep=b
     if row['retained_bytes']+len(b)>output_cap:raise RuntimeError('Host output exceeds fixed writer cap before write')
     stream.write(keep);stream.flush();row['retained_bytes']+=len(keep)
     if keep:sys.stdout.buffer.write(keep);sys.stdout.buffer.flush()
     if row['observed_bytes']>output_cap:raise RuntimeError('host phase/global byte cap; complete capture failed')
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
 s['elapsed_seconds']+=row['elapsed_seconds'] if mode in {'capture','file-setup'} else 0;s['observed_bytes']+=row['observed_bytes'];s['retained_bytes']+=row['retained_bytes'];s['commands'].append(row)
 emit_text(state,json.dumps(s,indent=2));
 if mode in {'capture','cleanup'}:
  emit_text(evidence/(name+'.capture.json'),json.dumps(row,indent=2));emit_text(evidence/(name+'.exit'),'0\n' if row['status']=='PASS' else '1\n')
 sel.close()
 if child and child.stdout:child.stdout.close()
raise SystemExit(0 if row['status']=='PASS' else 1)
