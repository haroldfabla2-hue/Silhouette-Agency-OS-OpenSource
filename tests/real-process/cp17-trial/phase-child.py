#!/usr/bin/env python3
"""No host privileges. Runs only inside reviewed capped namespace. REVIEW ONLY."""
import hashlib,json,os,pathlib,selectors,signal,subprocess,sys,time
mode=sys.argv[1];root=pathlib.Path('/tmp/work');ev=pathlib.Path('/tmp/evidence');ev.mkdir(exist_ok=True)
assert os.geteuid()==1000 and os.getegid()==1000
status=pathlib.Path('/proc/self/status').read_text()
for k in ['CapEff:','CapPrm:','CapAmb:']:assert int(next(l.split()[1]for l in status.splitlines()if l.startswith(k)),16)==0
cg=pathlib.Path('/tmp/limits')
for k,v in [('memory.max',str(8*1024**3)),('memory.swap.max','0'),('pids.max','96'),('cpu.max','200000 100000')]:assert(cg/k).read_text().strip()==v
assert os.statvfs('/tmp').f_blocks*os.statvfs('/tmp').f_frsize<=512*1024**2
node='/opt/hostedtoolcache/node/22.18.0/x64/bin/node';npm='/opt/hostedtoolcache/node/22.18.0/x64/lib/node_modules/npm/bin/npm-cli.js'
assert subprocess.check_output([node,'--version'],text=True).strip()=='v22.18.0'
env={'PATH':str(pathlib.Path(node).parent)+':/usr/bin:/bin','HOME':'/tmp/home','TMPDIR':'/tmp','NODE_ENV':'test','SILHOUETTE_PROVIDERS':'off','SILHOUETTE_INFERENCE_MODE':'cloud-only','SILHOUETTE_SNAPSHOT_DIAGNOSTIC':'metadata-only','NODE_OPTIONS':'--max-old-space-size=2048','npm_config_cache':'/tmp/npm-cache','npm_config_loglevel':'verbose','npm_config_verbose':'true','PUPPETEER_SKIP_DOWNLOAD':'true','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD':'true','ELECTRON_SKIP_BINARY_DOWNLOAD':'1','SHARP_IGNORE_GLOBAL_LIBVIPS':'1'}
pathlib.Path('/tmp/home').mkdir(exist_ok=True)
# Bounded preflight is inside existing aggregate deadline, no retries or package code.
if mode in {'install','native'}:
 import socket
 resolver=pathlib.Path('/etc/resolv.conf');record={'stage':'innermost','network_ns':os.readlink('/proc/self/ns/net'),'resolver_exists':resolver.exists(),'resolver_symlink':resolver.is_symlink(),'resolver_realpath':str(resolver.resolve(strict=False)),'routes_sha256':hashlib.sha256(pathlib.Path('/proc/net/route').read_bytes()).hexdigest()}
 if resolver.exists():record['resolver_sha256']=hashlib.sha256(resolver.read_bytes()).hexdigest()
 preflight=[node,'--input-type=module','-e',"import dns from 'node:dns/promises'; for (const host of ['registry.npmjs.org','codeload.github.com']) { try { const result=await dns.lookup(host); console.log(JSON.stringify({host,result})); } catch (e) { console.log(JSON.stringify({host,error:e.code})); process.exitCode=1; } }"]
 try:
  remaining=min(8,float(os.environ['PHASE_DEADLINE_MONOTONIC'])-time.monotonic()-5);assert remaining>0
  probe=subprocess.run(preflight,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=remaining,check=False);record.update({'returncode':probe.returncode,'stdout':probe.stdout[:4096].decode(errors='replace'),'stderr':probe.stderr[:4096].decode(errors='replace')})
 except Exception as e:record.update({'error':type(e).__name__+':'+str(e)})
 (ev/'network-preflight.json').write_text(json.dumps(record,indent=2))
 if record.get('returncode')!=0:raise SystemExit('PREPARATION_DNS_UNAVAILABLE_NOT_PRODUCT_FAILURE')

if mode=='install':phases=[('npm-ci',[node,npm,'ci','--ignore-scripts','--no-audit','--no-fund','--fetch-retries=0','--maxsockets=4'],root,150)]
elif mode=='native':
 audit=json.loads(pathlib.Path('/tmp/harness/native-entry-hashes.json').read_text())
 for rel,expected in audit.items():
  p=root/rel;assert p.is_file()and not p.is_symlink()and hashlib.sha256(p.read_bytes()).hexdigest()==expected,'native source mismatch:'+rel
 phases=[('better-sqlite3',['/bin/sh','-c','prebuild-install || node-gyp rebuild --release'],root/'node_modules/better-sqlite3',90),('sharp-032',['/bin/sh','-c','(node install/libvips && node install/dll-copy && prebuild-install) || (node install/can-compile && node-gyp rebuild && node install/dll-copy)'],root/'node_modules/@xenova/transformers/node_modules/sharp',90)]
 env['PATH']=str(root/'node_modules/.bin')+':'+env['PATH']
elif mode=='checks':
 phases=[('native-smoke',[node,'/tmp/harness/native-smoke.cjs'],root,20),('esbuild025',[str(root/'node_modules/@esbuild/linux-x64/bin/esbuild'),'--version'],root,3),('esbuild027',[str(root/'node_modules/tsx/node_modules/@esbuild/linux-x64/bin/esbuild'),'--version'],root,3),('ffmpeg',[str(root/'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),'-version'],root,3),('lint',[node,npm,'run','lint'],root,90),('types',[node,npm,'run','typecheck'],root,120),('full-existing-suite',[node,npm,'test'],root,180),('frontend-build',[node,npm,'run','build'],root,70),('server-build',[node,str(root/'node_modules/vite/bin/vite.js'),'build','--config','vite.server.config.ts'],root,40)]
else:raise SystemExit('unknown mode')
# Host also enforces remaining setup180s aggregate and absolute1200s job deadline.
results=[];total=0;unsafe=False;deadline=float(os.environ['PHASE_DEADLINE_MONOTONIC'])
for name,argv,cwd,limit in phases:
 if unsafe or time.monotonic()>=deadline:
  results.append({'name':name,'status':'NOT_STARTED','reason':'unsafe cleanup or aggregate deadline'});continue
 child=None;sel=selectors.DefaultSelector();signals=[];failure=None;eof=False;observed=0;t=time.monotonic();last=None;baseline={int(p.name)for p in pathlib.Path('/proc').iterdir()if p.name.isdigit()}
 try:
  child=subprocess.Popen(argv,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True);os.set_blocking(child.stdout.fileno(),False);sel.register(child.stdout,selectors.EVENT_READ)
  with(ev/(name+'.log')).open('wb')as stream:
   while True:
    now=time.monotonic();rc=child.poll()
    if now-t>=limit or now>=deadline:raise TimeoutError('phase/aggregate deadline')
    if rc is not None and last is None:last=now
    if last is not None and now-last>2:raise RuntimeError('postexit EOF/group deadline')
    for key,_ in sel.select(.025):
     try:b=os.read(key.fd,65536)
     except BlockingIOError:continue
     if not b:eof=True;sel.unregister(key.fd)
     else:
      observed+=len(b);total+=len(b);stream.write(b[:max(0,min(2*1024**2-stream.tell(),8*1024**2-(total-len(b))))]);stream.flush()
      if observed>2*1024**2 or total>8*1024**2:raise RuntimeError('output cap')
    try:os.killpg(child.pid,0);group='LIVE'
    except ProcessLookupError:group='ESRCH'
    if rc is not None and eof and group=='ESRCH':break
 except BaseException as e:failure=type(e).__name__+':'+str(e)
 finally:
  if child:
   for sig in [signal.SIGTERM,signal.SIGKILL]:
    try:os.killpg(child.pid,0)
    except ProcessLookupError:break
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
  results.append({'name':name,'argv':argv,'status':'PASS'if child and child.returncode==0 and eof and not failure and not signals and not unsafe else'FAIL','rc':child.returncode if child else None,'eof':eof,'group':group,'signals':signals,'residual':residual,'error':failure,'seconds':time.monotonic()-t,'observed_bytes':observed})
  (ev/(mode+'-session.json')).write_text(json.dumps({'mode':mode,'results':results,'unsafe':unsafe},indent=2))
raise SystemExit(0 if results and all(x['status']=='PASS'for x in results)else 1)
