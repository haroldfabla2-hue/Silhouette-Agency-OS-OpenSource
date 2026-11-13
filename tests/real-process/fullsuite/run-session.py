#!/usr/bin/env python3
"""Proposed current isolated full suite checkpoint. NOT EXECUTED."""
import hashlib,json,os,pathlib,selectors,signal,subprocess,sys,time
root=pathlib.Path('/tmp/work');out=pathlib.Path('/tmp/evidence');out.mkdir(exist_ok=True)
host=sys.argv[1]
def group(pid):
 try:os.killpg(pid,0);return 'LIVE'
 except ProcessLookupError:return 'ESRCH'
 except OSError:return 'UNKNOWN'
network={'host':host,'current':os.readlink('/proc/self/ns/net')}
links=json.loads(subprocess.run(['ip','-j','link','show'],capture_output=True,check=True,timeout=2).stdout)
network['interfaces']=[x['ifname'] for x in links]
network['routes']={p:pathlib.Path(p).read_text() for p in ['/proc/net/route','/proc/net/ipv6_route']}
(out/'network.json').write_text(json.dumps(network,indent=2))
assert host.startswith('net:[') and network['current']!=host and set(network['interfaces'])=={'lo'}
for p,text in network['routes'].items():
 for line in text.splitlines()[1:] if p.endswith('/route') else text.splitlines():
  fields=line.split()
  assert not fields or (fields[0] if p.endswith('/route') else fields[-1])=='lo'
assert subprocess.check_output(['node','--version'],text=True).strip()=='v22.18.0'
# Explicit validation policy survives clean env, never falls back to mixed.
assert os.environ.get('SILHOUETTE_INFERENCE_MODE')=='cloud-only','VALIDATION_POLICY_REQUIRED before phase admission'
env={'PATH':os.environ['PATH'],'HOME':'/tmp/home','NODE_ENV':'test','SILHOUETTE_INFERENCE_MODE':os.environ['SILHOUETTE_INFERENCE_MODE']}
print('VALIDATION_SUPERVISOR_POLICY: cloud-only',flush=True)
pathlib.Path(env['HOME']).mkdir(exist_ok=True)
phases=[('lint',['npm','run','lint'],180),('types',['npm','run','typecheck'],180),
 ('actual-owner-tests',['npm','test','--','tests/automated/fase1-chat-gateway.test.ts',
 'tests/automated/system-routes-audit.test.ts','tests/automated/consciousness-metrics.test.ts',
 '--detectAsyncLeaks'],300)]
started=time.monotonic();results=[];unsafe=False;global_exhausted=False;total_bytes=0
clock=json.loads((out/'job-clock.json').read_text())
available=clock['deadline_monotonic']-started
if available<730:
 (out/'session.json').write_text(json.dumps({'status':'FAIL','reason':'NOT_STARTED_JOB_BUDGET at actual namespace entry','remaining_seconds':available,'results':[{'phase':n,'status':'NOT_STARTED'} for n,_,_ in phases]},indent=2));raise SystemExit(1)
session_deadline=min(started+660,clock['deadline_monotonic']-70)
for name,cmd,budget in phases:
 if unsafe or global_exhausted or time.monotonic()>=session_deadline:
  results.append({'phase':name,'status':'NOT_STARTED','reason':'global16MiB exhausted' if global_exhausted else 'unsafe cleanup or session660s budget'});continue
 remaining=min(budget,session_deadline-time.monotonic())
 baseline={int(p.name) for p in pathlib.Path('/proc').iterdir() if p.name.isdigit()}
 child=None;sel=selectors.DefaultSelector();eof=False;signals=[];failure=None;observed=0;end_at=None
 log=out/(name+'.log');t0=time.monotonic()
 try:
  child=subprocess.Popen(cmd,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
  fd=child.stdout.fileno();os.set_blocking(fd,False);sel.register(fd,selectors.EVENT_READ)
  with log.open('wb') as stream:
   while True:
    now=time.monotonic();rc=child.poll()
    if rc is not None and end_at is None:end_at=now
    if now-t0>remaining:raise RuntimeError('phase/session deadline')
    if end_at is not None and now-end_at>2:raise RuntimeError('post-exit group/EOF deadline')
    for key,_ in sel.select(.05):
     try:b=os.read(key.fd,65536)
     except BlockingIOError:continue
     if not b:eof=True;sel.unregister(fd)
     else:
      observed+=len(b);total_bytes+=len(b)
      available=max(0,min(8*1024*1024-stream.tell(),16*1024*1024-(total_bytes-len(b))))
      stream.write(b[:available]);stream.flush()
      if total_bytes>=16*1024*1024:global_exhausted=True;raise RuntimeError('global16MiB log cap reached; rest session NOT_STARTED')
      if observed>8*1024*1024:raise RuntimeError('phase8MiB log cap reached; prefix retained, truncated')
    if rc is not None and eof and group(child.pid)=='ESRCH':break
 except BaseException as error:failure=str(error)
 finally:
  pre={'returncode':child.poll() if child else None,'reaped':child is not None and child.returncode is not None,'group':group(child.pid) if child else 'NOT_STARTED','pipe_eof':eof}
  if child and (child.poll() is None or group(child.pid)!='ESRCH'):
   for sig in [signal.SIGTERM,signal.SIGKILL]:
    if group(child.pid)!='ESRCH':
     try:os.killpg(child.pid,sig);signals.append(sig.name)
     except ProcessLookupError:pass
     except OSError as error:failure=failure or str(error)
    until=time.monotonic()+2
    while time.monotonic()<until:
     child.poll()
     if child.returncode is not None and group(child.pid)=='ESRCH':break
     time.sleep(.025)
  post={'returncode':child.poll() if child else None,'reaped':child is not None and child.returncode is not None,'group':group(child.pid) if child else 'NOT_STARTED','pipe_eof':eof}
  residual=sorted({int(p.name) for p in pathlib.Path('/proc').iterdir() if p.name.isdigit()}-baseline)
  unsafe=(child is not None and (not post['reaped'] or post['group']!='ESRCH')) or bool(residual)
  sel.close()
  if child and child.stdout:child.stdout.close()
  data=log.read_bytes() if log.exists() else b''
  ok=not failure and pre['returncode']==0 and pre['reaped'] and pre['group']=='ESRCH' and eof and not signals and not residual
  results.append({'phase':name,'command':cmd,'budget_seconds':remaining,'elapsed_seconds':time.monotonic()-t0,'status':'PASS' if ok else 'FAIL','error':failure,'pid':child.pid if child else None,'residual_namespace_pids':residual,'pre_cleanup':pre,'post_cleanup':post,'signals':signals,'observed_log_bytes':observed,'truncated':observed>len(data),'global_exhausted':global_exhausted,'retained_log_bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
  (out/'session.json').write_text(json.dumps({'status':'IN_PROGRESS','results':results},indent=2))
result={'status':'COMMANDS_GREEN_OWNER_EVIDENCE_REVIEW_REQUIRED' if all(r['status']=='PASS' for r in results) else 'FAIL','elapsed_seconds':time.monotonic()-started,'results':results,'scope':'Node22.18 isolated lint/types/exact 3 actual RPC-attributed test files only; command green is NOT bootstrap closure/PASS. INCOMPLETE_NOT_OBSERVED remains incomplete; raw states and RPC/collector must be reviewed. NO fullsuite/build/boot/API/provider success/global drain/mount repair; runtime exclusions unchanged'}
(out/'session.json').write_text(json.dumps(result,indent=2))
raise SystemExit(0 if result['status']=='COMMANDS_GREEN_OWNER_EVIDENCE_REVIEW_REQUIRED' else 1)
