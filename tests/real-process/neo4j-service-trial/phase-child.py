#!/usr/bin/env python3
"""No host privileges. Runs only inside reviewed capped namespace. REVIEW ONLY."""
import hashlib,json,os,pathlib,resource,selectors,signal,subprocess,sys,time
from process_evidence import snapshot,counter_delta
mode=sys.argv[1];root=pathlib.Path('/tmp/work');ev=pathlib.Path('/tmp/evidence');ev.mkdir(exist_ok=True)
assert os.geteuid()==1000 and os.getegid()==1000
status=pathlib.Path('/proc/self/status').read_text()
for k in ['CapEff:','CapPrm:','CapAmb:']:assert int(next(l.split()[1]for l in status.splitlines()if l.startswith(k)),16)==0
cg=pathlib.Path('/tmp/limits')
for k,v in [('memory.max',str(8*1024**3)),('memory.swap.max','0'),('pids.max','256' if mode=='checks' else '96'),('cpu.max','200000 100000')]:assert(cg/k).read_text().strip()==v
assert os.statvfs('/tmp').f_blocks*os.statvfs('/tmp').f_frsize<=512*1024**2
node='/opt/hostedtoolcache/node/22.18.0/x64/bin/node';npm='/opt/hostedtoolcache/node/22.18.0/x64/lib/node_modules/npm/bin/npm-cli.js'
assert subprocess.check_output([node,'--version'],text=True).strip()=='v22.18.0'
env={'GOMAXPROCS':'2','TOKIO_WORKER_THREADS':'2','LANCE_CPU_THREADS':'2','RAYON_NUM_THREADS':'2','PATH':str(pathlib.Path(node).parent)+':/usr/bin:/bin','HOME':'/tmp/home','TMPDIR':'/tmp','NODE_ENV':'test','SILHOUETTE_PROVIDERS':'off','SILHOUETTE_INFERENCE_MODE':'cloud-only','SILHOUETTE_SNAPSHOT_DIAGNOSTIC':'metadata-only','NODE_OPTIONS':'--max-old-space-size=2048','npm_config_cache':'/tmp/npm-cache','npm_config_loglevel':'verbose','npm_config_verbose':'true','PUPPETEER_SKIP_DOWNLOAD':'true','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD':'true','ELECTRON_SKIP_BINARY_DOWNLOAD':'1','SHARP_IGNORE_GLOBAL_LIBVIPS':'1'}
pathlib.Path('/tmp/home').mkdir(exist_ok=True)
# Bounded preflight is inside existing aggregate deadline, no retries or package code.
if mode in {'install','native','browser'}:
 import socket
 resolver=pathlib.Path('/etc/resolv.conf');record={'stage':'innermost','network_ns':os.readlink('/proc/self/ns/net'),'resolver_exists':resolver.exists(),'resolver_symlink':resolver.is_symlink(),'resolver_realpath':str(resolver.resolve(strict=False)),'routes_sha256':hashlib.sha256(pathlib.Path('/proc/net/route').read_bytes()).hexdigest()}
 if resolver.exists():record['resolver_sha256']=hashlib.sha256(resolver.read_bytes()).hexdigest()
 hosts=['cdn.playwright.dev','storage.googleapis.com']if mode=='browser'else['registry.npmjs.org','codeload.github.com','dist.neo4j.org']if mode=='native'else['registry.npmjs.org','codeload.github.com']
 preflight=[node,'--input-type=module','-e',"import dns from 'node:dns/promises'; for (const host of "+json.dumps(hosts)+") { try { const result=await dns.lookup(host); console.log(JSON.stringify({host,result})); } catch (e) { console.log(JSON.stringify({host,error:e.code})); process.exitCode=1; } }"]
 try:
  remaining=min(8,float(os.environ['PHASE_DEADLINE_MONOTONIC'])-time.monotonic()-5);assert remaining>0
  probe=subprocess.run(preflight,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=remaining,check=False);record.update({'returncode':probe.returncode,'stdout':probe.stdout[:4096].decode(errors='replace'),'stderr':probe.stderr[:4096].decode(errors='replace')})
 except Exception as e:record.update({'error':type(e).__name__+':'+str(e)})
 (ev/'network-preflight.json').write_text(json.dumps(record,indent=2))
 if record.get('returncode')!=0:raise SystemExit('PREPARATION_DNS_UNAVAILABLE_NOT_PRODUCT_FAILURE')

# This source candidate checks mode is a dedicated real Neo4j dependency boot only.
# No browser verification, Vite cache mounts, ownership product input or product imports.
install_preparation=None
if mode=='install':
 assert resource.getrlimit(resource.RLIMIT_NOFILE)==(4096,4096),'explicit install-only FD4096 not effective'
 # Fixed handful of source/config files only. No recursive dependency inventory
 # or extra process/telemetry writer, unchanged source-post ledger covers drift.
 npm_root=pathlib.Path(npm).parent.parent
 package=json.loads((npm_root/'package.json').read_text())
 assert package['version']=='10.9.3','exact workflow Node floor bundled npm differs'
 metadata_paths=['package.json','node_modules/@npmcli/arborist/lib/arborist/reify.js','node_modules/@npmcli/config/lib/definitions/definitions.js','node_modules/pacote/lib/fetcher.js']
 install_preparation={'nofile_soft_hard':list(resource.getrlimit(resource.RLIMIT_NOFILE)),'node':'v22.18.0','npm':package['version'],'npm_root':str(npm_root),'npm_source_hashes':{name:hashlib.sha256((npm_root/name).read_bytes()).hexdigest()for name in metadata_paths},'input_hashes_before':{name:hashlib.sha256((root/name).read_bytes()).hexdigest()for name in ['package.json','package-lock.json']},'effective_environment':{name:env[name]for name in ['npm_config_cache','npm_config_loglevel','npm_config_verbose','PUPPETEER_SKIP_DOWNLOAD','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD','ELECTRON_SKIP_BINARY_DOWNLOAD']},'command_config':'Exact argv retained in results; ci/ignore-scripts/no-audit/no-fund/fetch-retries0/maxsockets4. No fs concurrency guarantee or hidden npm alteration.'}
if mode=='install':phases=[('npm-ci',[node,npm,'ci','--ignore-scripts','--no-audit','--no-fund','--fetch-retries=0','--maxsockets=4'],root,150)]
elif mode=='native':
 # This candidate dispatch admits only static Neo4j archive bytes, no package code.
 phases=[('neo4j-admission',['/usr/bin/python3','/tmp/harness/prepare-neo4j.py'],root,55)]
elif mode=='browser':
 phases=[('browser-asset-preparation',['/usr/bin/python3','/tmp/harness/prepare-browser.py'],root,90)]
elif mode=='checks':
 phases=[('neo4j-boot-real',['/usr/bin/python3','/tmp/harness/service-entry.py'],root,185)]
else:raise SystemExit('unknown mode')
# Host also enforces remaining setup240s aggregate and absolute1800s job deadline.
results=[];total=0;unsafe=False;deadline=float(os.environ['PHASE_DEADLINE_MONOTONIC'])
for name,argv,cwd,limit in phases:
 if unsafe or time.monotonic()>=deadline:
  results.append({'name':name,'status':'NOT_STARTED','reason':'unsafe cleanup or aggregate deadline'});continue
 telemetry=[];telemetry_errors=[];fd_error_captured=False
 def capture(label):
  try:telemetry.append(dict(label=label,**snapshot(cg,sorted(int(p.name)for p in pathlib.Path('/proc').iterdir()if p.name.isdigit()))))
  except Exception as error:telemetry_errors.append({'label':label,'errorType':type(error).__name__,'errno':getattr(error,'errno',None)})
 capture('trusted-preexec-before-observer-lower'if mode=='checks'else'prelaunch')
 child=None;sel=selectors.DefaultSelector();signals=[];failure=None;eof=False;observed=0;t=time.monotonic();last=None;baseline={int(p.name)for p in pathlib.Path('/proc').iterdir()if p.name.isdigit()}
 try:
  phase_env=dict(env,NODE_OPTIONS='--max-old-space-size=4096')if name=='types'else dict(env)
  if name=='neo4j-admission':phase_env['NEO4J_ADMISSION_PHASE_DEADLINE']=str(deadline)
  if name=='neo4j-boot-real':phase_env['NEO4J_BOOT_PHASE_DEADLINE']=str(deadline)
  child=subprocess.Popen(argv,cwd=cwd,env=phase_env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
  if mode=='checks':
   # Trusted preexec launcher inherited service allowance; not a client.
   # Observer and every later client retain irreversible hard256.
   resource.setrlimit(resource.RLIMIT_NOFILE,(256,256));assert resource.getrlimit(resource.RLIMIT_NOFILE)==(256,256)
  os.set_blocking(child.stdout.fileno(),False);sel.register(child.stdout,selectors.EVENT_READ)
  with(ev/(name+'.log')).open('wb')as stream:
   while True:
    now=time.monotonic();rc=child.poll()
    if now-t>=limit or now>=deadline:raise TimeoutError('phase/aggregate deadline')
    if rc is not None and last is None:
     last=now;capture('leader-exit-before-cleanup')
    if last is not None and now-last>2:raise RuntimeError('postexit EOF/group deadline')
    for key,_ in sel.select(.025):
     try:b=os.read(key.fd,65536)
     except BlockingIOError:continue
     if not b:eof=True;sel.unregister(key.fd)
     else:
      if name=='frontend-build'and not fd_error_captured and b'EMFILE'in b:
       fd_error_captured=True;capture('first-EMFILE-output-before-cleanup')
      observed+=len(b);total+=len(b);stream.write(b[:max(0,min(2*1024**2-stream.tell(),8*1024**2-(total-len(b))))]);stream.flush()
      if observed>2*1024**2 or total>8*1024**2:raise RuntimeError('output cap')
    try:os.killpg(child.pid,0);group='LIVE'
    except ProcessLookupError:group='ESRCH'
    if rc is not None and eof and group=='ESRCH':break
 except BaseException as e:
  capture('command-exception-before-cleanup');failure=type(e).__name__+':'+str(e)
 finally:
  capture('precleanup')
  if child:
   for sig in [signal.SIGTERM,signal.SIGKILL]:
    try:os.killpg(child.pid,0)
    except ProcessLookupError:break
    capture('before-'+sig.name)
    try:os.killpg(child.pid,sig);signals.append(sig.name)
    except ProcessLookupError:break
    try:child.wait(timeout=2)
    except subprocess.TimeoutExpired:pass
   child.poll()
   try:os.killpg(child.pid,0);group='LIVE'
   except ProcessLookupError:group='ESRCH'
   if child.stdout:child.stdout.close()
  else:group='NOT_STARTED'
  sel.close();residual=sorted({int(p.name)for p in pathlib.Path('/proc').iterdir()if p.name.isdigit()}-baseline);unsafe=bool(residual)or group not in {'ESRCH','NOT_STARTED'}
  results.append({'name':name,'argv':argv,'status':'PASS'if child and child.returncode==0 and eof and not failure and not signals and not unsafe else'FAIL','rc':child.returncode if child else None,'eof':eof,'group':group,'signals':signals,'residual':residual,'error':failure,'seconds':time.monotonic()-t,'observed_bytes':observed,'requested_oldspace_mib':4096 if name=='types'else 2048,'effective_launch_NODE_OPTIONS':phase_env.get('NODE_OPTIONS'),'launch_environment_scope':'Exact environment supplied to Popen. Descendant option overrides/internal V8 limit not inferred.'})
  capture('postcleanup')
  telemetry_state='CAPTURED_WITH_EXIT_WORKER_GAP'
  if not telemetry or telemetry_errors or any(isinstance(value,dict)for cut in telemetry for value in cut['counters'].values())or any(any(not row.get('stable_identity',False)for row in cut['identity']['rows'])for cut in telemetry):telemetry_state='MISSING_TELEMETRY'
  reporter_state='NOT_APPLICABLE'
  if name=='full-existing-suite':
   try:
    reporter_rows=[json.loads(line)for line in (ev/'vitest-runtime-observation.jsonl').read_text().splitlines()]
    reporter_state='CAPTURED'if {'resolved-global','resolved-specification-pools'}<={row.get('kind')for row in reporter_rows}else 'MISSING_TELEMETRY'
   except Exception:reporter_state='MISSING_TELEMETRY'
  with (ev/(mode+'-process-observations.jsonl')).open('a')as diagnostic_stream:diagnostic_stream.write(json.dumps({'status':telemetry_state,'reporter_status':reporter_state,'cuts':telemetry,'errors':telemetry_errors,'delta':counter_delta(telemetry[0]['counters'],telemetry[-1]['counters'])if len(telemetry)>1 else {'unavailable':True},'leader_returncode':child.returncode if child else None,'leader_signal':-child.returncode if child and child.returncode is not None and child.returncode<0 else None,'worker_exit_history':'UNAVAILABLE_PUBLIC_REPORTER_NO_WORKER_EXIT_HOOK_RAPID_REAP_GAP','command':name},separators=(',',':'))+'\n')
  results[-1]['diagnostic_capture_status']=telemetry_state
  results[-1]['reporter_capture_status']=reporter_state
  if install_preparation is not None:
   install_preparation['input_hashes_after']={name:hashlib.sha256((root/name).read_bytes()).hexdigest()for name in ['package.json','package-lock.json']}
   install_preparation['input_drift']=install_preparation['input_hashes_before']!=install_preparation['input_hashes_after']
  (ev/(mode+'-session.json')).write_text(json.dumps({'mode':mode,'results':results,'unsafe':unsafe,'observer_nofile_at_close':list(resource.getrlimit(resource.RLIMIT_NOFILE)),**({'install_preparation':install_preparation}if install_preparation is not None else{})},indent=2))
raise SystemExit(0 if results and all(x['status']=='PASS'for x in results)else 1)
