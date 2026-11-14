#!/usr/bin/env python3
"""REVIEW ONLY. Inside fresh user/net/PID namespace. No external network."""
import os,pathlib,socket,fcntl,struct,subprocess,json,sys,signal,time
# Bring only lo up. No address/route to external networks is installed.
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);ifr=struct.pack('16sH14s',b'lo',0x1|0x8,b'');fcntl.ioctl(s,0x8914,ifr);s.close()
# Validate both IP families and root exposure BEFORE dependency/plugin/app eval.
interfaces=socket.if_nameindex();assert {n for _,n in interfaces}=={'lo'}
routes=pathlib.Path('/proc/net/route').read_text();assert all(not x.strip()or x.split()[0]=='lo'for x in routes.splitlines()[1:])
v6=pathlib.Path('/proc/net/ipv6_route').read_text();assert all(not x.strip()or x.split()[-1]=='lo'for x in v6.splitlines())
for forbidden in ['/root','/run','/var/run','/home/runner','/home/sandbox','/memory','/downloads','/opt/silhouette','/etc/shadow','/app/.git','/home/test/.ssh','/var/run/docker.sock']:
 assert not pathlib.Path(forbidden).exists(),'FORBIDDEN_HOST_PATH_EXPOSED'
# Drop setup-only network/setpcap authority irreversibly before app/build/browser.
import ctypes,errno
libc=ctypes.CDLL(None,use_errno=True)
assert libc.prctl(28,15,0,0,0)==0 # PR_SET_SECUREBITS: NOROOT and NO_SETUID_FIXUP locked
for cap in range(41):
 rc=libc.prctl(24,cap,0,0,0)
 assert rc==0 or ctypes.get_errno()==errno.EINVAL
assert libc.prctl(38,1,0,0,0)==0 # no_new_privs
class Header(ctypes.Structure):_fields_=[('version',ctypes.c_uint32),('pid',ctypes.c_int)]
class Data(ctypes.Structure):_fields_=[('effective',ctypes.c_uint32),('permitted',ctypes.c_uint32),('inheritable',ctypes.c_uint32)]
h=Header(0x20080522,0);d=(Data*2)();assert libc.capset(ctypes.byref(h),ctypes.byref(d))==0
status=dict(l.split(':',1)for l in pathlib.Path('/proc/self/status').read_text().splitlines()if ':'in l)
assert all(int(status[k].strip(),16)==0 for k in ['CapEff','CapPrm','CapBnd','CapInh'])and status['NoNewPrivs'].strip()=='1'
pathlib.Path('/evidence/root-preflight.json').write_text(json.dumps({'rootEntries':sorted(os.listdir('/')),'mountinfo':pathlib.Path('/proc/self/mountinfo').read_text(),'forbiddenPathsAbsent':True,'capabilitiesZero':True,'noNewPrivs':True,'HOME':'/home/test','TMPDIR':'/tmp','dependencies':'readonly except empty .vite-temp tmpfs','freshApp':True},indent=2)+'\n')
pathlib.Path('/evidence/network.json').write_text(json.dumps({'routesV4':routes,'routesV6':v6,'interfaces':interfaces,'network':'isolated namespace loopback only'})+'\n')
phase=sys.argv[1];env={'PATH':'/node/bin:/usr/bin:/bin','HOME':'/home/test','TMPDIR':'/tmp','NODE_ENV':'production','SILHOUETTE_PROVIDERS':'off','SILHOUETTE_INFERENCE_MODE':'cloud-only','SILHOUETTE_BOOT_MODE':'normal','SILHOUETTE_HOST':'127.0.0.1','PORT':'3005','WORKSPACE_ROOT':'/app/workspace','PROPOSAL_OWNER_DIR':'/app/data','INGRESS_REPLAY_DIR':'/app/data','CONFIRMATION_GATE_DIR':'/app/data','SILHOUETTE_DB_PATH':'/app/db/test.db','SILHOUETTE_IDENTITY_DB_PATH':'/app/db/identity.sqlite','SILHOUETTE_TOOLS_DB_PATH':'/app/data/tools.db','SILHOUETTE_LANCEDB_PATH':'/app/data/lance','SILHOUETTE_OWNER_SCOPES':'128','SILHOUETTE_OWNER_ACTIVE':'512','SILHOUETTE_OWNER_FAILURES':'64','SILHOUETTE_OWNER_RESOURCES':'256','GOMAXPROCS':'1','TOKIO_WORKER_THREADS':'1','LANCE_CPU_THREADS':'1','RAYON_NUM_THREADS':'1'}
# API token stays ephemeral in process-local env, never printed or saved.
import secrets
env['SILHOUETTE_API_TOKEN']=secrets.token_urlsafe(32)
# Exporter-only exact-value deny material. Not allowlisted, never printed or
# framed; stored before any consumer can log it. Fresh per-phase private path.
fd=os.open('/evidence/.export-deny-api-token',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
try:
 tokenBytes=env['SILHOUETTE_API_TOKEN'].encode('ascii');assert os.write(fd,tokenBytes)==len(tokenBytes)
finally:os.close(fd)
if phase.endswith('build'):
 cmd=['/node/bin/node','/app/node_modules/vite/bin/vite.js','build']
 if phase=='server-build':cmd+=['--config','vite.server.config.ts']
 raise SystemExit(subprocess.call(cmd,env=env))
app=subprocess.Popen(['/node/bin/node','--import','tsx/esm','server/bootstrap.preparation.ts'],env=env)
result={'started':True,'backendPid':app.pid,'driverCode':None,'ordinaryTerminationRequested':False,'forced':False}
try:
 # Actual UI route and backend responses, no auth bypass or mocked backend.
 result['driverCode']=subprocess.call(['/node/bin/node','/driver/browser-driver.cjs'],env=env)
finally:
 if app.poll()is None:
  app.send_signal(signal.SIGTERM);result['ordinaryTerminationRequested']=True
 try:result['backendExit']=app.wait(timeout=30)
 except subprocess.TimeoutExpired:
  result['forced']=True;app.kill();result['backendExit']=app.wait()
 frontier={'appPidPresent':pathlib.Path('/proc/'+str(app.pid)).exists(),'remainingPids':[x.name for x in pathlib.Path('/proc').iterdir()if x.name.isdigit()and int(x.name)not in {1,os.getpid()}],'netTcp':pathlib.Path('/proc/net/tcp').read_text(),'netTcp6':pathlib.Path('/proc/net/tcp6').read_text(),'netUnix':pathlib.Path('/proc/net/unix').read_text(),'note':'Namespace-local post-app/browser snapshot; rootB sticky incomplete, not exhaustive owner ledger proof'}
 pathlib.Path('/evidence/exit-frontier.json').write_text(json.dumps(frontier,indent=2)+'\n')
 result['descendantFrontierUnverified']=bool(frontier['remainingPids']or frontier['appPidPresent']);
 result['caption']= 'Actual isolated Silhouette UI, external providers OFF; no AI/learning claim. Client backend aliases may be mocks; real API/storage unverified unless correlated.'
 result['rootB']='INCOMPLETE'
 pathlib.Path('/evidence/runtime-result.json').write_text(json.dumps(result,indent=2)+'\n')
raise SystemExit(1 if result['forced']or result.get('descendantFrontierUnverified',True)or result['backendExit']or result['driverCode'] else 0)
