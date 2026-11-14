"""Review-only Linux runner. No auto-install/provision/network/cgroup creation.
Requires externally reviewed dedicated containment before it will launch Node.
This script has NOT been executed. All outputs are authored sandbox evidence.
"""
import argparse, hashlib, json, os, pathlib, resource, selectors, shutil, signal, stat, subprocess, time
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);p.add_argument('--cgroup',required=True);p.add_argument('--node-executable',required=True);p.add_argument('--node-sha256',required=True);a=p.parse_args()
repo=pathlib.Path(a.repo).resolve(); evidence=pathlib.Path(a.evidence).resolve(); cg=pathlib.Path(a.cgroup).resolve()
# Require this already-contained supervisor and all descendants to share a dedicated scope.
assert cg==pathlib.Path('/tmp/limits'), 'only host-verified read-only current-scope view'
# host-launch verifies membership BEFORE exec through a pipegate, then mounts
# only this exact scope read-only. No writable cgroup exposed to test process.
assert not os.access(cg/'cgroup.procs',os.W_OK)
assert os.geteuid()==1000 and os.getegid()==1000
status=pathlib.Path('/proc/self/status').read_text()
for field in ['CapEff:','CapPrm:','CapAmb:']:
 assert int(next(line.split()[1] for line in status.splitlines() if line.startswith(field)),16)==0
mem=(cg/'memory.max').read_text().strip();assert mem!='max' and int(mem)<=8*1024**3
assert (cg/'memory.swap.max').read_text().strip()=='0'
pids=(cg/'pids.max').read_text().strip();assert pids!='max' and int(pids)<=96
quota,period=(cg/'cpu.max').read_text().split();assert quota!='max' and int(quota)/int(period)<=2
# Must run in preconfigured network namespace with loopback only, no external route.
assert {row['ifname'] for row in json.loads(subprocess.check_output(['ip','-j','link','show'],timeout=2))}=={'lo'}
for source in ['/proc/net/route','/proc/net/ipv6_route']:
 for line in pathlib.Path(source).read_text().splitlines()[1:] if source.endswith('/route') else pathlib.Path(source).read_text().splitlines():
  fields=line.split();assert not fields or (fields[0] if source.endswith('/route') else fields[-1])=='lo'
assert os.geteuid()!=0, 'real permission-denial coverage requires non-root'
# Dedicated externally-mounted tmpfs imposes a hard combined storage cap.
mounts=[line.split() for line in pathlib.Path('/proc/mounts').read_text().splitlines()]
mount=next((row for row in mounts if pathlib.Path(row[1]).resolve()==evidence.parent),None)
assert mount and mount[2]=='tmpfs', 'evidence parent must be a dedicated tmpfs mount'
volume=os.statvfs(evidence.parent)
assert volume.f_blocks*volume.f_frsize<=512*1024**2
assert evidence.parent.stat().st_dev!=repo.stat().st_dev
assert not evidence.exists(), 'never overwrite previous evidence'
evidence.mkdir(parents=True); work=evidence/'authored-work';work.mkdir()
loader=repo/'node_modules/tsx/dist/loader.mjs';assert loader.is_file()
script=repo/'tests/real-process/wal-owner-control-child.ts';assert script.is_file()
# Additional source-fixed harness inputs, never modify original fixture bytes.
capacity_inputs=json.loads(pathlib.Path('/tmp/preparation/preparation-capacity.json').read_text())
assert capacity_inputs['status']=='REVIEWED_FOR_EXACT_PACKET'
prepared_wal=pathlib.Path('/tmp/preparation/wal-prepared-entry.mts');prepared_accepted=pathlib.Path('/tmp/preparation/accepted-prepared-entry.mts')
assert prepared_wal.is_file()and prepared_accepted.is_file()
# One private writable runtime temp root, on the ALREADY bounded authored tmpfs.
# tsx cache remains enabled; esbuild and Node share the same explicit temp root.
runtime_tmp=evidence/'runtime-tmp';temporary_cut={'requested':str(runtime_tmp),'paths':[],'dependencies':[]}
try:
 runtime_tmp.mkdir(mode=0o700)
 assert runtime_tmp.resolve(strict=True)==runtime_tmp and runtime_tmp.stat().st_dev==evidence.stat().st_dev
 assert runtime_tmp.stat().st_uid==os.geteuid() and runtime_tmp.stat().st_mode & 0o777==0o700
 probe=runtime_tmp/'.authored-write-probe'
 with probe.open('xb') as stream:stream.write(b'authored-runtime-temp-check\n')
 probe.unlink()
 for path in [pathlib.Path('/tmp'),evidence.parent,evidence,work,runtime_tmp]:
  item={'path':str(path)}
  try:
   st=path.stat();item.update({'realpath':str(path.resolve(strict=True)),'uid':st.st_uid,'gid':st.st_gid,'mode':oct(st.st_mode),'device':st.st_dev,'writable':os.access(path,os.W_OK),'readOnly':bool(os.statvfs(path).f_flag & os.ST_RDONLY)})
  except OSError as error:item.update({'errorType':type(error).__name__,'errno':error.errno,'filename':error.filename})
  temporary_cut['paths'].append(item)
 # Metadata only, no dependency execution/import or alternative installation.
 for path in [repo/'node_modules/tsx/node_modules/@esbuild/linux-x64/bin/esbuild',repo/'node_modules/better-sqlite3/build/Release/better_sqlite3.node']:
  item={'path':str(path),'gate':False,'scope':'EXPECTED_LAYOUT_METADATA_ONLY_NOT_ABI_PROOF'}
  try:
   st=path.stat();item.update({'realpath':str(path.resolve(strict=True)),'uid':st.st_uid,'gid':st.st_gid,'mode':oct(st.st_mode),'size':st.st_size,'readOnly':bool(os.statvfs(path).f_flag & os.ST_RDONLY)})
  except OSError as error:item.update({'errorType':type(error).__name__,'errno':error.errno,'filename':error.filename})
  temporary_cut['dependencies'].append(item)
 temporary_cut['status']='PRIVATE_TMPFS_RUNTIME_DIRECTORY_WRITABLE_NOT_FUNCTIONAL_COVERAGE'
except Exception as error:
 temporary_cut.update({'status':'FAIL','errorType':type(error).__name__,'errno':getattr(error,'errno',None),'filename':getattr(error,'filename',None),'error':str(error)[:1024]});raise
finally:(evidence/'runtime-paths.json').write_text(json.dumps(temporary_cut,indent=2))
# No secret-bearing inherited environment or provider fallback. No generic PATH expansion.
env={'PATH':os.environ['PATH'],'HOME':str(work),'TMPDIR':str(runtime_tmp),'TEMP':str(runtime_tmp),'TMP':str(runtime_tmp),'NODE_ENV':'test','SILHOUETTE_PROVIDERS':'off','SILHOUETTE_INFERENCE_MODE':'cloud-only','NODE_OPTIONS':'--max-old-space-size=2048'}
# Per-file hard cap complements mount/cgroup bounds; includes node descendants.
resource.setrlimit(resource.RLIMIT_FSIZE,(64*1024**2,64*1024**2))
resource.setrlimit(resource.RLIMIT_NOFILE,(256,256))
start=time.monotonic(); children=[]; results=[]
(evidence/'containment.json').write_text(json.dumps({'cgroup':str(cg),'memoryMax':mem,'cpuMax':[quota,period],'pidsMax':pids,'swapMax':0,'wallSeconds':320,'storageBytes':volume.f_blocks*volume.f_frsize,'network':'loopback-only','providers':'off','oldspaceMiB':2048},indent=2))
def wall_expired(signum,frame):raise TimeoutError('hard supervisor wall deadline')
signal.signal(signal.SIGALRM,wall_expired);signal.alarm(320)
# Evidence is written even when identity/version/exec admission fails.
node_cut={'requested':a.node_executable,'expectedSha256':a.node_sha256,'legacyLookup':shutil.which('node'),'innerPATH':os.environ['PATH']}
try:
 node=pathlib.Path(a.node_executable).resolve(strict=True);node_cut['realpath']=str(node)
 assert node==pathlib.Path('/opt/hostedtoolcache/node/22.18.0/x64/bin/node') and str(node)==a.node_executable
 ns=node.stat();node_cut.update({'size':ns.st_size,'mode':oct(ns.st_mode),'uid':ns.st_uid,'gid':ns.st_gid,'mountReadOnly':bool(os.statvfs(node).f_flag & os.ST_RDONLY)})
 assert stat.S_ISREG(ns.st_mode) and 0<ns.st_size<=256*1024**2 and os.access(node,os.X_OK)
 assert ns.st_mode & 0o022==0 and node_cut['mountReadOnly']
 with node.open('rb') as stream:node_cut['sha256']=hashlib.file_digest(stream,'sha256').hexdigest()
 assert len(a.node_sha256)==64 and node_cut['sha256']==a.node_sha256,'host/inner Node digest differs'
 version=subprocess.run([str(node),'--version'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=2,check=True)
 node_cut['version']=version.stdout[:128].decode('utf-8',errors='replace').strip()
 assert version.stdout==b'v22.18.0\n','exact workflow Node version differs'
 node_cut['status']='INNER_RO_IDENTITY_VERSION_PASS_NOT_FUNCTIONAL_COVERAGE'
except Exception as error:
 node_cut.update({'status':'FAIL','errorType':type(error).__name__,'errno':getattr(error,'errno',None),'filename':getattr(error,'filename',None),'error':str(error)[:1024]});raise
finally:(evidence/'node-inner.json').write_text(json.dumps(node_cut,indent=2))
launch_errors=[]
class Child:
 def __init__(self,directory,label,custom=None):
  directory.mkdir(parents=True,exist_ok=True);self.label=label;self.serial=0
  original_args=([str(x) for x in custom] if isinstance(custom,list) else [str(custom or script)])
  # Preserve every original argument after the fixed original entry. No eval,
  # generic loader target, argv rewrite inside fixtures or assertion changes.
  if original_args[0]==str(script):prepared=prepared_wal;profile=capacity_inputs['wal']
  elif original_args[0]==str(repo/'tests/real-process/accepted-owner-natural-child.ts'):prepared=prepared_accepted;profile=capacity_inputs['accepted']
  else:raise ValueError('Unreviewed original fixture entry')
  child_env=dict(env)
  for key,name in [('scopes','SILHOUETTE_OWNER_SCOPES'),('active','SILHOUETTE_OWNER_ACTIVE'),('failures','SILHOUETTE_OWNER_FAILURES'),('resources','SILHOUETTE_OWNER_RESOURCES')]:
   value=profile[key]
   if type(value)is not int or value<1:raise ValueError('Unreviewed explicit capacity: '+key)
   child_env[name]=str(value)
  command=[str(node),'--import',str(loader),str(prepared),*original_args[1:]]
  (evidence/(label+'-launch-input.json')).write_text(json.dumps({'original_argv':[str(node),'--import',str(loader),*original_args],'actual_argv':command,'NODE_OPTIONS':child_env.get('NODE_OPTIONS'),'preparation_capacity':profile,'input_kind':'ADDITIONAL_OPERATIONAL_ENTRY_ORIGINAL_FIXTURE_UNCHANGED'},indent=2))
  try:self.p=subprocess.Popen(command,cwd=directory,env=child_env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True,bufsize=0)
  except OSError as error:
   launch_errors.append({'label':label,'requestedExecutable':command[0],'cwd':str(directory),'errorType':type(error).__name__,'errno':error.errno,'filename':error.filename,'filename2':error.filename2,'error':str(error)[:1024]})
   (evidence/'launch-errors.json').write_text(json.dumps(launch_errors,indent=2));raise
  children.append(self);self.sel=selectors.DefaultSelector();self.sel.register(self.p.stdout,selectors.EVENT_READ);self.buf=b'';self.log=(evidence/(label+'.log')).open('wb')
 def read(self,prefix,seconds=30):
  deadline=time.monotonic()+seconds
  while time.monotonic()<deadline:
   safety()
   if b'\n' not in self.buf:
    events=self.sel.select(min(.25,max(0,deadline-time.monotonic())))
    if not events:continue
    data=os.read(self.p.stdout.fileno(),65536)
    if not data:raise AssertionError(self.label+' ended before '+prefix)
    self.log.write(data);self.log.flush();self.buf+=data
   while b'\n' in self.buf:
    line,self.buf=self.buf.split(b'\n',1)
    if line.startswith(prefix.encode()):return json.loads(line[len(prefix):])
  raise TimeoutError(self.label+' checkpoint '+prefix)
 def call(self,op,**kw):
  self.serial+=1;self.p.stdin.write((json.dumps(dict(op=op,serial=self.serial,**kw))+'\n').encode());self.p.stdin.flush()
  reply=self.read('OWNER_IPC ');assert reply['serial']==self.serial;return reply
 def good(self,op,**kw):
  r=self.call(op,**kw);assert r['ok'],r;return r['result']
 def natural(self,seconds=15):
  # Drain logs while observing actual exit; no SIGTERM/exit0 used to pass.
  deadline=time.monotonic()+seconds
  while self.p.poll() is None and time.monotonic()<deadline:
   safety()
   for key,_ in self.sel.select(.1):
    data=os.read(key.fileobj.fileno(),65536)
    if data:self.log.write(data);self.log.flush()
  assert self.p.poll()==0,(self.label,'NATURAL_EXIT_UNVERIFIED',self.p.poll())
  # Exit status alone must not hide descendants retaining pipe/processgroup.
  eof=False;group_live=True;reap_deadline=time.monotonic()+2
  while time.monotonic()<reap_deadline:
   try:os.killpg(self.p.pid,0);group_live=True
   except ProcessLookupError:group_live=False
   if not eof:
    for key,_ in self.sel.select(.05):
     data=os.read(key.fileobj.fileno(),65536)
     if data:self.log.write(data);self.log.flush()
     else:eof=True;self.sel.unregister(key.fileobj)
   if eof and not group_live:break
  assert eof and not group_live,(self.label,'NATURAL_GROUP_EOF_UNVERIFIED',eof,group_live)
  self.log.close();self.sel.close()
 def close(self,expect_error=False):
  r=self.call('close');assert r['ok']!=expect_error,r;self.natural()
def safety():
 assert time.monotonic()-start<320,'inner320s wall cap'
 used=sum(f.stat().st_size for f in evidence.rglob('*') if f.is_file())
 assert used<=512*1024**2,'512MiB evidence+authored-store cap'
 assert sum(f.stat().st_size for f in evidence.glob('*.log'))<=64*1024**2,'64MiB aggregate log cap'
def record(name,fn):
 t=time.monotonic()
 try:fn();results.append(dict(case=name,status='PASS',seconds=time.monotonic()-t))
 except Exception as error:
  results.append(dict(case=name,status='FAIL_OR_INCOMPLETE',error=repr(error),seconds=time.monotonic()-t))
  for child in children:
   if child.p.poll() is None:
    os.killpg(child.p.pid,signal.SIGKILL);child.p.wait(timeout=5)
    results[-1].setdefault('cleanupSignals',[]).append(dict(label=child.label,signal='SIGKILL_AFTER_FAILURE_NOT_NATURAL_PASS'))
  safety() # Global resource exhaustion stops the run, not merely this case.
 finally:(evidence/'results.json').write_text(json.dumps(results,indent=2))
def records(d):return json.loads((d/'data/wal/memory_wal.json').read_text())
def memory(d,agent='wal-fixture'):return d/('data/agents/'+agent+'/MEMORY.md')
def pending(d,i):assert_record(d,i,'PENDING')
def assert_record(d,i,status):
 r=next(e for e in records(d) if e['id']==i);assert r['status']==status;return r

def competition():
 d=work/'compete';one=Child(d,'holder');one.good('init');entry=one.good('add',input='accepted holder original');before=(d/'data/wal/memory_wal.json').read_bytes()
 one.good('competing-object');assert (d/'data/wal/memory_wal.json').read_bytes()==before
 two=Child(d,'contender');r=two.call('init');assert not r['ok'] and r['error']['code']=='SQLITE_BUSY',r
 two.good('same-failure');two.close(expect_error=True);assert (d/'data/wal/memory_wal.json').read_bytes()==before
 # Distinct lexical cwd, same canonical data directory; no fresh data-store escape.
 alias=work/'alias';alias.mkdir();(alias/'data').symlink_to((d/'data').resolve(),target_is_directory=True)
 other=Child(alias,'alias-contender');r=other.call('init');assert not r['ok'] and r['error']['code']=='SQLITE_BUSY',r;other.close(expect_error=True)
 second=one.good('add',input='holder after rejection');one.close()
 successor=Child(d,'after-close');successor.good('init')
 for old in [entry,second]:
  r=assert_record(d,old['id'],'INTERRUPTED');assert r['timestamp']==old['timestamp'] and r['data']['input']==old['data']['input']
 successor.close()
def crash():
 for committed in [False,True]:
  d=work/('crash-'+str(committed));one=Child(d,'killed-'+str(committed));one.good('init');entry=one.good('add',input='original crash payload')
  if committed:one.good('commit',id=entry['id'],output='authored caller completion')
  os.killpg(one.p.pid,signal.SIGKILL);assert one.p.wait(timeout=5)==-signal.SIGKILL;one.log.close();one.sel.close()
  successor=Child(d,'successor-'+str(committed));successor.good('init');r=assert_record(d,entry['id'],'COMMITTED' if committed else 'INTERRUPTED');assert r['timestamp']==entry['timestamp'] and r['data']['input']==entry['data']['input']
  marker=('WAL_COMMIT:' if committed else 'WAL_INTERRUPTION:')+entry['id'];assert memory(d).read_text().count(marker)==1;successor.close()
def failures():
 d=work/'append-failure';one=Child(d,'append-failure');one.good('init');entry=one.good('add',input='append denial original');m=memory(d);m.mkdir(parents=True)
 r=one.call('commit',id=entry['id'],output='authored');assert not r['ok'] and r['error']['code']=='EISDIR',r;pending(d,entry['id']);m.rmdir();one.good('commit',id=entry['id'],output='authored');one.good('commit',id=entry['id'],output='authored');assert m.read_text().count('WAL_COMMIT:'+entry['id'])==1;one.close()
 # Visible marker from an earlier failed commit, still not fenced. No fabricated model data.
 d=work/'marker';one=Child(d,'marker');one.good('init');entry=one.good('add',input='preexisting original');m=memory(d);m.parent.mkdir(parents=True,exist_ok=True);marker='<!-- WAL_COMMIT:'+entry['id']+' -->\n**Message Processed**\npreexisting original';m.write_text(marker);m.chmod(0o400)
 r=one.call('commit',id=entry['id'],output='authored');assert not r['ok'] and r['error']['code']=='EACCES',r;pending(d,entry['id']);assert m.read_text()==marker
 m.chmod(0o600);one.good('commit',id=entry['id'],output='authored');assert m.read_text()==marker;one.close()
 d=work/'wal-write';one=Child(d,'wal-write');one.good('init');entry=one.good('add',input='retained');f=d/'data/wal/memory_wal.json';old=f.with_suffix('.retained');f.rename(old);f.mkdir();r=one.call('add',input='must fail');assert not r['ok'];f.rmdir();old.rename(f);one.good('same-failure');pending(d,entry['id']);one.close(expect_error=True)
 d=work/'corrupt';f=d/'data/wal/memory_wal.json';f.parent.mkdir(parents=True);f.write_text('{original corruption');one=Child(d,'corrupt');r=one.call('init');assert not r['ok'];assert f.read_text()=='{original corruption';one.good('same-failure')
 # Explicit repair of authored fixture only; original failed instance stays terminal.
 f.write_text('[]');two=Child(d,'after-corrupt-release');two.good('init');two.close();one.close(expect_error=True)
def cost():
 one=Child(work/'cost','cost');one.good('init');r=one.good('cost');(evidence/'latency-raw.json').write_text(json.dumps(r,indent=2));one.close()
def accepted(denied=False):
 label='accepted-denied' if denied else 'accepted'
 d=work/label;child=Child(d,label,[repo/'tests/real-process/accepted-owner-natural-child.ts']+(['post-delivery-memory-denied'] if denied else []));child.p.stdin.close();result=child.read('ACCEPTED_OWNER ',seconds=75);(evidence/(label+'-checkpoint.json')).write_text(json.dumps(result,indent=2));assert result['accepted'] and result['joined']
 child.natural(seconds=30) # Real timer leak must fail here, not be normalized away.
 if denied: memory(d,'core-01').chmod(0o600)
 successor=Child(d,label+'-successor');successor.good('init');r=assert_record(d,result['walId'],'INTERRUPTED' if denied else 'COMMITTED');assert r['data']['input']=='RECHAZAR TODO'
 if not denied:assert r['data']['metadata']['deliveryReceipt']['id']==result['receipt']
 assert memory(d,'core-01').read_text().count(('WAL_INTERRUPTION:' if denied else 'WAL_COMMIT:')+result['walId'])==1
 successor.close()
try:
 for name,fn in [('ownership-first-same-and-two-process-alias',competition),('sigkill-successor',crash),('original-errors-pending-marker-idempotency',failures),('latency-measurement-only',cost),('accepted-join-natural-restart',accepted),('accepted-post-delivery-failure-natural-restart',lambda:accepted(True))]:record(name,fn)
finally:
 # Failure cleanup is never success. Preserve logs/store and record every signal.
 cleanup=[]
 for child in children:
  if child.p.poll() is None:
   os.killpg(child.p.pid,signal.SIGKILL);child.p.wait(timeout=5);cleanup.append(dict(label=child.label,signal='SIGKILL_AFTER_FAILURE_NOT_NATURAL_PASS'))
 (evidence/'cleanup-signals.json').write_text(json.dumps(cleanup,indent=2))
 for metric in ['memory.events','memory.peak','cpu.stat','pids.events']:
  source=cg/metric
  if source.is_file():(evidence/metric.replace('.','-')).write_text(source.read_text())
 signal.alarm(0)

if any(r['status']!='PASS' for r in results):raise SystemExit(1)
