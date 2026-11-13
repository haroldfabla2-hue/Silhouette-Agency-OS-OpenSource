#!/usr/bin/env python3
"""Proposed current isolated full suite checkpoint. NOT EXECUTED."""
import hashlib,json,os,pathlib,re,selectors,signal,subprocess,sys,time
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
assert os.environ.get('SILHOUETTE_SNAPSHOT_DIAGNOSTIC')=='metadata-only','DIAGNOSTIC_POLICY_REQUIRED'
env={'SILHOUETTE_SNAPSHOT_DIAGNOSTIC':'metadata-only','PATH':os.environ['PATH'],'HOME':'/tmp/home','NODE_ENV':'test','SILHOUETTE_INFERENCE_MODE':os.environ['SILHOUETTE_INFERENCE_MODE']}
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
  phase_env=dict(env)
  if name=='actual-owner-tests':phase_env['SILHOUETTE_TEST_MEMORY_MODE']='independent-three-focals'
  child=subprocess.Popen(cmd,cwd=root,env=phase_env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
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
# Diagnostic lines stay in original capped raw log; source parser is bounded.
diag={'status':'DIAGNOSTIC_INCOMPLETE','event_cap':256,'byte_cap':131072,'events':0,'bytes':0,'normalized_bytes':0,'raw_sha256':hashlib.sha256().hexdigest(),'normalized_sha256':hashlib.sha256().hexdigest(),'terminals':0,'issues':[],'issues_omitted':0}
def issue(reason):
 if len(diag['issues'])<32:diag['issues'].append(reason)
 else:diag['issues_omitted']+=1
owners={};context=None
raw_digest=hashlib.sha256();normalized_digest=hashlib.sha256()
allowed={'tests/automated/'+n+'.test.ts' for n in ['fase1-chat-gateway','system-routes-audit','consciousness-metrics']}
testlog=out/'actual-owner-tests.log'
if testlog.exists():
 for line in testlog.read_bytes().splitlines():
  # Normalize only a parsing copy. Raw line bytes still own accounting/hash.
  parsed=re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',line)
  # Owner-local ordinal checks do not establish cross-owner causal print order.
  if parsed.startswith(b'stdout | ') or parsed.startswith(b'stderr | '):
   context=parsed.decode('utf8',errors='replace').split(' | ',1)[1].split(' > ',1)[0]
  terminal=parsed.startswith(b'SNAPSHOT_DIAGNOSTIC_TERMINAL ')
  if not terminal and not parsed.startswith(b'SNAPSHOT_DIAGNOSTIC '):continue
  diag['events']+=1;diag['bytes']+=len(line)+1;diag['normalized_bytes']+=len(parsed)+1
  raw_digest.update(line+b'\n');normalized_digest.update(parsed+b'\n')
  if diag['events']>256 or diag['bytes']>131072:issue('aggregate cap exceeded');continue
  try:
   item=json.loads(parsed.split(b' ',1)[1]);g=item.get('graphId')
   if not isinstance(g,str) or not g or len(g)>80:raise ValueError('invalid graph id')
   if context not in allowed:raise ValueError('missing focal worker context')
   if g not in owners:
    if len(owners)>=3:raise ValueError('extra graph owner')
    owners[g]={'events':0,'bytes':0,'raw_bytes':0,'raw_sha256':hashlib.sha256().hexdigest(),'normalized_sha256':hashlib.sha256().hexdigest(),'ordinal':0,'declared':False,'context':context,'worker':None,'ops':{},'terminal':False}
   owner=owners[g]
   if owner['context']!=context:raise ValueError('graph changed file context')
   if terminal:
    diag['terminals']+=1
    if owner['terminal']:raise ValueError('duplicate owner terminal')
    owner['terminal']=True
    if item.get('enabled') is not True or item.get('status')!='OBSERVED_METADATA_ONLY':issue('owner incomplete')
    if item.get('eventCap')!=64 or item.get('byteCap')!=32768:issue('owner cap mismatch')
    if item.get('events')!=owner['events'] or item.get('bytes')!=owner['bytes']:issue('owner counter mismatch')
    continue
   if owner['terminal']:issue('event after terminal')
   owner['events']+=1;owner['bytes']+=len(parsed)+1;owner['raw_bytes']+=len(line)+1
   # Counters reconcile emitted normalized bytes; raw transport ledger remains separate.
   owner.setdefault('_raw_digest',hashlib.sha256()).update(line+b'\n')
   owner.setdefault('_normalized_digest',hashlib.sha256()).update(parsed+b'\n')
   if owner['events']>64 or owner['bytes']>32768:issue('owner observed cap exceeded')
   ordinal=item.get('ordinal')
   if type(ordinal) is not int or ordinal!=owner['ordinal']+1:issue('noncontiguous owner ordinal')
   owner['ordinal']=ordinal
   stage=item.get('stage')
   if item.get('storeLabel')!='disposable-test-owner/memory_snapshot.json' or item.get('ownerModel')!='INDEPENDENT_TEST_SCOPE_BOUND':issue('independent scope binding unverified')
   scope_digest=item.get('scopeDigest')
   if not isinstance(scope_digest,str) or len(scope_digest)!=64 or any(c not in '0123456789abcdef' for c in scope_digest):issue('invalid independent scope digest')
   if stage=='OWNER_DECLARED':
    if any(other is not owner and other.get('scopeDigest')==scope_digest for other in owners.values()):issue('independent owners share scope digest')
    owner['scopeDigest']=scope_digest
   elif scope_digest!=owner.get('scopeDigest'):issue('owner scope digest changed')
   if stage=='OWNER_DECLARED':
    if owner['declared'] or owner['events']!=1:issue('invalid owner declaration order')
    worker=item.get('worker')
    if not isinstance(worker,str) or not worker or worker=='UNKNOWN':issue('worker id unavailable')
    if type(item.get('pid')) is not int or item['pid']<=0:issue('pid unavailable')
    owner['worker']=worker;owner['declared']=True
    continue
   if not owner['declared']:issue('stage before owner declared')
   if item.get('worker')!=owner['worker']:issue('owner worker changed')
   if stage=='DIAGNOSTIC_ERROR':issue('callback/stat/close error');continue
   seq=item.get('sequence');key=item.get('operationKey')
   if type(seq) is not int or seq<=0 or key!=g+':'+str(seq):raise ValueError('invalid operation key')
   checksum=item.get('checksum');length=item.get('utf8Bytes')
   if not isinstance(checksum,str) or len(checksum)!=64 or any(c not in '0123456789abcdef' for c in checksum):raise ValueError('invalid captured checksum')
   if type(length) is not int or length<0:raise ValueError('invalid payload length')
   ops=owner['ops']
   if stage=='SNAPSHOT_CAPTURED':
    if key in ops:issue('duplicate capture')
    ops[key]={'stages':['SNAPSHOT_CAPTURED'],'checksum':checksum,'length':length};continue
   if key not in ops:raise ValueError('operation missing capture')
   op=ops[key]
   if checksum!=op['checksum'] or length!=op['length']:issue('captured metadata changed')
   expected={'SNAPSHOT_CAPTURED':'TEMP_READY','TEMP_READY':'RENAME_RETURNED','RENAME_RETURNED':'READBACK','READBACK':None}
   prior=op['stages'][-1]
   if not ((prior=='READBACK' and stage in ['MATCH','MISMATCH']) or expected.get(prior)==stage):issue('invalid operation stage order')
   if stage in ['TEMP_READY','READBACK']:
    if not all(isinstance(item.get(k),str) and item[k].isdigit() for k in ['dev','ino','size']):issue('descriptor identity unavailable')
   if stage in ['READBACK','MATCH','MISMATCH']:
    rh=item.get('readbackChecksum');rl=item.get('readbackBytes')
    if not isinstance(rh,str) or len(rh)!=64 or any(c not in '0123456789abcdef' for c in rh) or type(rl) is not int or rl<0:issue('invalid readback metadata')
    if stage=='READBACK':op['readbackChecksum']=rh;op['readbackBytes']=rl
    elif rh!=op.get('readbackChecksum') or rl!=op.get('readbackBytes'):issue('readback terminal metadata changed')
    if stage=='MATCH' and rh!=checksum:issue('false match')
    if stage=='MISMATCH' and rh==checksum:issue('false mismatch')
   op['stages'].append(stage)
  except Exception as error:issue('invalid diagnostic record: '+str(error)[:100])
if diag['terminals']!=3 or len(owners)!=3:issue('three owner terminals not observed')
if {v['context'] for v in owners.values()}!=allowed:issue('three focal contexts not observed')
if len({v['worker'] for v in owners.values()})!=3:issue('three worker ids not observed')
for owner in owners.values():
 if not owner['declared'] or not owner['terminal'] or not owner['ops']:issue('owner operation ledger not observed')
 for op in owner['ops'].values():
  if op['stages'] not in [['SNAPSHOT_CAPTURED','TEMP_READY','RENAME_RETURNED','READBACK','MATCH'],['SNAPSHOT_CAPTURED','TEMP_READY','RENAME_RETURNED','READBACK','MISMATCH']]:issue('operation incomplete')
if not diag['issues'] and not diag['issues_omitted']:diag['status']='OBSERVED_METADATA_ONLY_NOT_CAUSAL_PROOF'
diag['raw_sha256']=raw_digest.hexdigest();diag['normalized_sha256']=normalized_digest.hexdigest()
for owner in owners.values():
 owner['raw_sha256']=owner.pop('_raw_digest',hashlib.sha256()).hexdigest()
 owner['normalized_sha256']=owner.pop('_normalized_digest',hashlib.sha256()).hexdigest()
diag['owners']=owners
(out/'snapshot-diagnostic-summary.json').write_text(json.dumps(diag,indent=2))
print('SNAPSHOT_DIAGNOSTIC_SOURCE_STATUS:'+diag['status'],flush=True)
result={'status':'COMMANDS_GREEN_OWNER_EVIDENCE_REVIEW_REQUIRED' if all(r['status']=='PASS' for r in results) else 'FAIL','elapsed_seconds':time.monotonic()-started,'results':results,'scope':'Node22.18 isolated lint/types/exact 3 actual RPC-attributed test files only; command green is NOT bootstrap closure/PASS. INCOMPLETE_NOT_OBSERVED remains incomplete; raw states and RPC/collector must be reviewed. NO fullsuite/build/boot/API/provider success/global drain/mount repair; runtime exclusions unchanged'}
(out/'session.json').write_text(json.dumps(result,indent=2))
raise SystemExit(0 if result['status']=='COMMANDS_GREEN_OWNER_EVIDENCE_REVIEW_REQUIRED' else 1)
