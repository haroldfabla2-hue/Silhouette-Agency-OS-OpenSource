"""Trusted host controller. No Docker operation is performed by import or by local tests."""
import pathlib,subprocess,os,json,sys,time,selectors,signal,base64,hashlib,re
IMAGE='docker.io/library/node@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292'
DIGEST=IMAGE.split('@')[1];CAP=131072
class ControlFailure(RuntimeError):pass
class CompletedCompilerErrors(RuntimeError):pass
# Public receipts contain only fixed stage/predicate/error-class enums and integer codes.
STAGE='S00_INIT'
LAST_PREDICATE='P000_UNCLASSIFIED'
LAST_ERROR_CLASS='E_NONE'
FIRST_FAILURE=None
BUILD_ADMITTED=False
STAGES={'S00_INIT','S01_DAEMON','S02_PULL','S03_IMAGE_INSPECT','S04_INPUT_MANIFEST','S05_CREATE','S06_CONFIG_INSPECT','S07_GUARDIAN','S08_START_ATTACH','S09_READY_READ','S10_CANARY_MESSAGE','S11_RUNNING_INSPECT','S12_NAMESPACE_CHECK','S13_GO','S14_DIAGNOSTICS','S15_EXIT_INSPECT','S16_POSTHASH','S17_CLEANUP','S18_DONE'}
PREDICATES={'subprocess deadline': 'P001', 'subprocess output cap': 'P002', 'docker command failed (raw diagnostics retained privately only)': 'P003', 'network/root/privilege': 'P004', 'hard resource config': 'P005', 'private namespaces': 'P006', 'user/capabilities': 'P007', 'security profiles': 'P008', 'AppArmor profile': 'P009', 'host exposure': 'P010', 'restart/logging': 'P011', 'entrypoint override': 'P012', 'bind mount count': 'P013', 'unexpected mount type': 'P014', 'bounded private tmpfs': 'P015', 'exact readonly rprivate bind': 'P016', 'no recursive submounts': 'P017', 'container name': 'P018', 'mount input path': 'P019', 'guardian startup': 'P020', 'guardian not armed': 'P021', 'container wall deadline': 'P022', 'guardian died': 'P023', 'guardian failure': 'P024', 'docker CLI output cap': 'P025', 'protocol frame cap': 'P026', 'duplicate ready': 'P027', 'guest canary': 'P028', 'guest PID': 'P029', 'namespace key': 'P030', 'unexpected diagnostic frame': 'P031', 'compiler output cap': 'P032', 'unexpected exit frame': 'P033', 'truncated protocol or unexpected Docker stderr': 'P034', 'attached container command exit': 'P035', 'container exit state': 'P036', 'compiler completion': 'P037', 'cgroup pressure/OOM': 'P038', 'container still exists': 'P039', 'incomplete container/result/cleanup': 'P040', 'local Docker socket absent': 'P041', 'daemon Linux/cgroupv2': 'P042', 'daemon security options': 'P043', 'unexpected rootless mode': 'P044', 'daemon memory envelope': 'P045', 'image digest/platform': 'P046', 'image volumes': 'P047', 'unexpected image healthcheck': 'P048', 'image expanded size': 'P049', 'incomplete result': 'P050', 'namespace separation ': 'P051', 'guest failure or unknown protocol': 'P052', 'controller interrupted': 'P053'}
PREDICATES['guest failure enum']='P054'
PREDICATES['explicit requested AppArmor policy']='P055'
PREDICATES['SSR receipt once']='P056'
PREDICATES['trusted host input pins']='P057'
PREDICATES['SSR receipt cap']='P058'
PREDICATES['host inventory deadline']='P059'
GUEST_GUARDS=['G000_UNCLASSIFIED', 'G001', 'G002', 'G003', 'G004', 'G005', 'G006', 'G007', 'G008', 'G009', 'G010', 'G011', 'G012', 'G013', 'G014', 'G015', 'G016', 'G017', 'G018', 'G019', 'G020', 'G030', 'G031', 'G032', 'G033', 'G034', 'G035', 'G036', 'G037', 'G038', 'G039', 'G040', 'G041', 'G042', 'G043', 'G044', 'G045', 'G046', 'G047', 'G048']
def stage(value):
 global STAGE
 if value not in STAGES:raise RuntimeError('invalid static stage')
 STAGE=value
def error_class(error):
 if isinstance(error,ControlFailure):return 'E_ASSERTION'
 if isinstance(error,KeyError):return 'E_SCHEMA_KEY'
 if isinstance(error,TypeError):return 'E_SCHEMA_TYPE'
 if isinstance(error,ValueError):return 'E_PARSE_VALUE'
 if isinstance(error,FileNotFoundError):return 'E_FILE_ABSENT'
 if isinstance(error,PermissionError):return 'E_PERMISSION'
 if isinstance(error,subprocess.TimeoutExpired):return 'E_PROCESS_TIMEOUT'
 if isinstance(error,OSError):return 'E_OS'
 return 'E_UNEXPECTED'
SCHEMA_KEYS=['ALL', 'Architecture', 'CapAdd', 'CapDrop', 'CgroupVersion', 'CgroupnsMode', 'Cmd', 'Config', 'Destination', 'Devices', 'Entrypoint', 'Error', 'ExitCode', 'GITHUB_RUN_ID', 'Healthcheck', 'HostConfig', 'IpcMode', 'LogConfig', 'MemTotal', 'Memory', 'MemorySwap', 'Mounts', 'NONE', 'Name', 'NanoCpus', 'NetworkMode', 'OOMKilled', 'OSType', 'Os', 'Pid', 'PidMode', 'PidsLimit', 'PortBindings', 'Privileged', 'Propagation', 'RW', 'ReadonlyRootfs', 'RepoDigests', 'RestartPolicy', 'Running', 'SecurityOpt', 'SecurityOptions', 'Size', 'Source', 'State', 'Tmpfs', 'Type', 'UTSMode', 'User', 'VolumesFrom', 'canary', 'canaryPassed', 'cgroup', 'checks', 'classification', 'cleanupFailure', 'code', 'buildAdmitted', 'buildStarted', 'containerRemoved', 'data', 'exit', 'failure', 'guardianFailure', 'memory.events', 'memoryEvents', 'namespaces', 'overflow', 'signal']
def failure_receipt(out,error,name='controller-failure.json'):
 global LAST_ERROR_CLASS,FIRST_FAILURE
 LAST_ERROR_CLASS=error_class(error)
 schema=error.args[0] if isinstance(error,KeyError) and error.args and error.args[0] in SCHEMA_KEYS else 'K_UNCLASSIFIED'
 result={'stage':STAGE,'predicate':LAST_PREDICATE if isinstance(error,ControlFailure) else 'P000_UNCLASSIFIED','errorClass':LAST_ERROR_CLASS,'schemaKey':schema,'classification':'INCOMPLETE','buildAdmitted':BUILD_ADMITTED}
 if FIRST_FAILURE is None:FIRST_FAILURE=dict(result)
 result['firstFailure']=FIRST_FAILURE
 pathlib.Path(out,name).write_text(json.dumps(result,sort_keys=True)+'\n')
 return result
def require(value,label):
 global LAST_PREDICATE
 key='namespace separation ' if label.startswith('namespace separation ') else label
 LAST_PREDICATE=PREDICATES.get(key,'P000_UNCLASSIFIED')
 if not value:raise ControlFailure('fixed assertion failure')
def bounded_process(argv,timeout=30,cap=1048576,env=None):
 p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,start_new_session=True);sel=selectors.DefaultSelector();data={}
 for f in [p.stdout,p.stderr]:sel.register(f,selectors.EVENT_READ);data[f.fileno()]=bytearray()
 start=time.monotonic()
 try:
  while sel.get_map():
   require(time.monotonic()-start<timeout,'subprocess deadline')
   for key,_ in sel.select(.1):
    chunk=os.read(key.fd,65536)
    if not chunk:sel.unregister(key.fileobj);continue
    data[key.fd].extend(chunk);require(len(data[key.fd])<=cap,'subprocess output cap')
  rc=p.wait(timeout=max(1,timeout-(time.monotonic()-start)));return rc,bytes(data[p.stdout.fileno()]),bytes(data[p.stderr.fileno()])
 finally:
  if p.poll() is None:os.killpg(p.pid,signal.SIGKILL);p.wait()
  sel.close();p.stdout.close();p.stderr.close()
def same_process(pid,start):
 try:
  fields=pathlib.Path('/proc',str(pid),'stat').read_text().split(') ',1)[1].split();return fields[0]!='Z' and fields[19]==start
 except (FileNotFoundError,ProcessLookupError):return False
def docker_env(out):
 config=out/'empty-docker-config';config.mkdir(exist_ok=True)
 return {'PATH':'/usr/bin:/bin','HOME':'/nonexistent','DOCKER_CONFIG':str(config)}
def docker(args,out,timeout=30):
 rc,stdout,stderr=bounded_process(['/usr/bin/docker','--host','unix:///var/run/docker.sock']+args,timeout=timeout,env=docker_env(out))
 if rc!=0:
  (out/('private-docker-'+STAGE+'.stdout')).write_bytes(stdout)
  (out/('private-docker-'+STAGE+'.stderr')).write_bytes(stderr)
 require(rc==0,'docker command failed (raw diagnostics retained privately only)');return stdout

def inspect_config(row,mounts,side,identity):
 h=row['HostConfig'];c=row['Config']
 require(h['NetworkMode']=='none' and h['ReadonlyRootfs'] and not h['Privileged'],'network/root/privilege')
 require(h['ShmSize']==16777216,'hard resource config')
 require(h['Memory']==6442450944 and h['MemorySwap']==6442450944 and h['PidsLimit']==32 and h['NanoCpus']==1000000000,'hard resource config')
 require(h['PidMode']=='' and h['IpcMode']=='private' and h['CgroupnsMode']=='private' and h['UTSMode']=='','private namespaces')
 require(c['User']=='65534:65534' and h['CapDrop']==['ALL'] and not h['CapAdd'],'user/capabilities')
 require('no-new-privileges=true' in h['SecurityOpt'] and not any('unconfined' in s for s in h['SecurityOpt']),'security profiles')
 require('apparmor=docker-default' in h['SecurityOpt'],'explicit requested AppArmor policy')
 require(not h['Devices'] and not h.get('DeviceRequests') and not h['PortBindings'] and not h['VolumesFrom'],'host exposure')
 require(h['RestartPolicy']['Name']=='no' and h['LogConfig']['Type']=='none','restart/logging')
 require(c['Entrypoint']==['/usr/bin/env'] and c['Cmd']==['-i','PATH=/usr/local/bin','HOME=/nonexistent','TMPDIR=/tmp','LANG=C.UTF-8','NODE_DISABLE_COMPILE_CACHE=1','/usr/local/bin/node','/control/driver.cjs',side,identity],'entrypoint override')
 actual=[x for x in row['Mounts'] if x['Type']=='bind'];require(len(actual)==len(mounts),'bind mount count')
 require(all(x['Type']=='bind' or (x['Type']=='tmpfs' and x['Destination'] in ['/tmp','/source/dist','/source/node_modules/.vite-temp']) for x in row['Mounts']),'unexpected mount type')
 require(set(h['Tmpfs'])=={'/tmp','/source/dist','/source/node_modules/.vite-temp'} and all(all(flag in h['Tmpfs'][target].split(',') for flag in ['rw','noexec','nosuid','nodev','size='+size,'mode=1777']) for target,size in [('/tmp','8m'),('/source/dist','48m'),('/source/node_modules/.vite-temp','8m')]),'bounded private tmpfs')
 for x in actual:
  require(x['Type']=='bind' and not x['RW'] and x['Propagation']=='rprivate' and mounts.get(x['Destination'])==x['Source'],'exact readonly rprivate bind')
 require(all(x.get('BindOptions',{}).get('NonRecursive') is True and x.get('ReadOnly') is True for x in h['Mounts']),'no recursive submounts')

def inspect_running_profile(row):
 # Applied profile is resolved by Docker at start, not implicit-policy create.
 require(row.get('AppArmorProfile')=='docker-default','AppArmor profile')

def guardian_reason(parent,start,deadline):
 if not same_process(parent,start):return 'CONTROLLER_DIED'
 if time.monotonic()>deadline:return 'GUARDIAN_DEADLINE'
 return None

def guardian(name,parent,start,out):
 # Separate process survives controller exit; no compilation without an armed guardian.
 out=pathlib.Path(out);stop=out/(name+'.guardian-stop');ready=out/(name+'.guardian-ready');ready.write_text('armed');deadline=time.monotonic()+330
 while not stop.exists():
  reason=guardian_reason(parent,start,deadline)
  if reason:
   for args in [['kill',name],['wait',name],['rm','-f',name]]:
    try:docker(args,out,15)
    except Exception:pass
   (out/(name+'.guardian-failure')).write_text(reason);return 1
  time.sleep(.1)
 return 0

def run_side(side,root,out):
 global BUILD_ADMITTED
 BUILD_ADMITTED=False
 name='ssr-'+os.environ['GITHUB_RUN_ID']+'-'+side.lower().replace('_','-')
 require(name.replace('-','').isalnum(),'container name')
 plan=json.loads((out/'host-plan.json').read_text());item=plan['stages'][side];identity=item['identitiesSha256']
 control=out/'stages'/side/'control';denied=out/'stages'/side/'denied'
 require(hashlib.sha256((control/'identities.json').read_bytes()).hexdigest()==identity,'trusted host input pins')
 require(hashlib.sha256((control/'stage-runner.cjs').read_bytes()).hexdigest()==plan['supervisorSha256'] and hashlib.sha256((control/'driver.cjs').read_bytes()).hexdigest()==plan['driverSha256'],'trusted host input pins')
 mounts={'/source':str(out/'snapshots/candidate'),'/source/node_modules':str(out/'deps/node_modules'),'/source/node_modules/@qdrant/js-client-rest':str(out/'candidate-qdrant'),'/control':str(control),'/denied':str(denied)}
 args=['create','--pull=never','--platform=linux/amd64','--name',name,'--restart=no','--network=none','--ipc=private','--cgroupns=private','--user=65534:65534','--cap-drop=ALL','--security-opt=no-new-privileges=true','--security-opt=apparmor=docker-default','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=8m,mode=1777','--tmpfs','/source/dist:rw,noexec,nosuid,nodev,size=48m,mode=1777','--tmpfs','/source/node_modules/.vite-temp:rw,noexec,nosuid,nodev,size=8m,mode=1777','--shm-size=16m','--memory=6g','--memory-swap=6g','--pids-limit=32','--cpus=1','--ulimit','core=0:0','--ulimit','nofile=128:128','--ulimit','fsize=16777216:16777216','--ulimit','cpu=280:280','--log-driver=none','--no-healthcheck','--entrypoint=/usr/bin/env','--workdir=/source','-i']
 for target,source in mounts.items():
  require(pathlib.Path(source).exists() and not pathlib.Path(source).is_symlink(),'mount input path')
  args+=['--mount','type=bind,src='+source+',dst='+target+',readonly,bind-propagation=rprivate,bind-recursive=disabled']
 args += [IMAGE,'-i','PATH=/usr/local/bin','HOME=/nonexistent','TMPDIR=/tmp','LANG=C.UTF-8','NODE_DISABLE_COMPILE_CACHE=1','/usr/local/bin/node','/control/driver.cjs',side,identity]
 p=None;guard=None;created=False;forced=False;success=False;started=time.monotonic();record={'side':side,'classification':'INCOMPLETE','canaryPassed':False,'buildStarted':False,'controllerComplete':False}
 result=None;receipt=None;receiptSeen=False;size=0
 try:
  stage('S05_CREATE');docker(args,out);created=True
  stage('S06_CONFIG_INSPECT');row=json.loads(docker(['inspect',name],out))[0];inspect_config(row,mounts,side,identity)
  stage('S07_GUARDIAN')
  start=pathlib.Path('/proc/self/stat').read_text().split(') ',1)[1].split()[19]
  guard=subprocess.Popen([sys.executable,__file__,'--guardian',name,str(os.getpid()),start,str(out)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=(out/(name+'.guardian.stderr')).open('wb'),start_new_session=True)
  for _ in range(50):
   if (out/(name+'.guardian-ready')).exists():break
   require(guard.poll() is None,'guardian startup');time.sleep(.1)
  require((out/(name+'.guardian-ready')).exists(),'guardian not armed')
  stage('S08_START_ATTACH')
  p=subprocess.Popen(['/usr/bin/docker','--host','unix:///var/run/docker.sock','start','-a','-i',name],env=docker_env(out),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
  sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ,'protocol');sel.register(p.stderr,selectors.EVENT_READ,'cli-stderr');buffer=b'';cli=bytearray();ready=False;exited=False
  try:
   stage('S09_READY_READ')
   while sel.get_map():
    require(time.monotonic()-started<310,'container wall deadline');require(guard.poll() is None,'guardian died');require(not (out/(name+'.guardian-failure')).exists(),'guardian failure')
    for key,_ in sel.select(.1):
     chunk=os.read(key.fd,65536)
     if not chunk:sel.unregister(key.fileobj);continue
     if key.data=='cli-stderr':cli.extend(chunk);require(len(cli)<65536,'docker CLI output cap');continue
     buffer+=chunk;require(len(buffer)<262144,'protocol frame cap')
     while b'\n' in buffer:
      raw,buffer=buffer.split(b'\n',1);message=json.loads(raw);kind=message.get('kind')
      if kind=='ready':
       stage('S10_CANARY_MESSAGE')
       require(not ready and not exited,'duplicate ready');canary=message['canary'];require(canary['checks']=='ALL_CANARIES_PASSED','guest canary')
       stage('S11_RUNNING_INSPECT');row=json.loads(docker(['inspect',name],out))[0];inspect_config(row,mounts,side,identity);inspect_running_profile(row);pid=row['State']['Pid'];require(pid>0,'guest PID')
       stage('S12_NAMESPACE_CHECK')
       for ns,value in canary['namespaces'].items():
        require(ns in ['pid','mnt','net','ipc','uts','cgroup'],'namespace key')
        rc,nsread,_=bounded_process(['/usr/bin/sudo','-n','/usr/bin/readlink','/proc/'+str(pid)+'/ns/'+ns],env={'PATH':'/usr/bin:/bin'},timeout=5)
        require(rc==0 and value==nsread.decode().strip() and value!=os.readlink('/proc/self/ns/'+ns),'namespace separation '+ns)
       stage('S13_GO');record['canaryPassed']=True;ready=True;p.stdin.write(b'GO\n');p.stdin.flush();record['buildStarted']=True;BUILD_ADMITTED=True
      elif kind=='receipt':
       require(ready and not exited and not receiptSeen,'SSR receipt once');receiptSeen=True
       data=base64.b64decode(message['data'],validate=True);size=len(data);require(size<=CAP,'SSR receipt cap')
       receipt=json.loads(data);(out/(side+'.private-receipt.json')).write_bytes(data)
      elif kind=='exit':require(ready and not exited and receiptSeen,'unexpected exit frame');result=message;exited=True
      elif kind=='failure':
       require(message.get('guestGuard') in GUEST_GUARDS,'guest failure enum')
       record['guestFailure']={'guestGuard':message['guestGuard'],'errorClass':message.get('errorClass') if message.get('errorClass') in ['G_SCHEMA_TYPE','G_PARSE','G_ASSERT_OR_OS','G_OS'] else 'G_UNKNOWN'}
       require(False,'guest failure or unknown protocol')
      else:require(False,'guest failure or unknown protocol')
   require(not buffer and not cli,'truncated protocol or unexpected Docker stderr');p.stdin.close();require(p.wait(timeout=5) in [0,125],'attached container command exit')
   stage('S15_EXIT_INSPECT');row=json.loads(docker(['inspect',name],out))[0];state=row['State'];require(not state['Running'] and not state['OOMKilled'] and not state['Error'],'container exit state')
   require(result is not None and result['code'] in [0,125] and result['signal'] is None and not result['overflow'] and state['ExitCode']==result['code'],'compiler completion')
   before={k:int(v) for k,v in (line.split() for line in canary['cgroup']['memory.events'].splitlines())};after={k:int(v) for k,v in (line.split() for line in result['memoryEvents'].splitlines())};delta={k:after[k]-before.get(k,0) for k in after};require(not any(delta.get(k,0) for k in ['max','oom','oom_kill','oom_group_kill']),'cgroup pressure/OOM')
   record.update({'exit':result['code'],'memoryEventDelta':delta,'diagnosticBytes':size,'classification':'SSR_ARTIFACT_COMMAND_COMPLETED','controllerComplete':True});success=True
  finally:sel.close()
 except BaseException as error:
  record['failure']=failure_receipt(out,error,side+'.failure.json')
  raise
 finally:
  stage('S17_CLEANUP')
  if created:
   try:
    row=json.loads(docker(['inspect',name],out))[0]
    if row['State']['Running']:
     forced=True;docker(['kill',name],out);docker(['wait',name],out)
    docker(['rm','-f',name],out)
    remaining=docker(['ps','-a','--filter','name=^/'+name+'$','--format','{{.ID}}'],out);require(not remaining.strip(),'container still exists')
    record['containerRemoved']=True
   except Exception as error:record['cleanupFailure']=failure_receipt(out,error,side+'.cleanup-failure.json');record['containerRemoved']=False;success=False
  if guard is not None:
   (out/(name+'.guardian-stop')).write_text('stop');guard.wait(timeout=3)
   if guard.returncode!=0 or (out/(name+'.guardian-failure')).exists():success=False;record['guardianFailure']=True
  if p is not None:
   if p.poll() is None:os.killpg(p.pid,signal.SIGKILL);p.wait()
   for f in [p.stdin,p.stdout,p.stderr]:
    if not f.closed:f.close()
  record.update({'forcedCleanup':forced,'elapsedSeconds':round(time.monotonic()-started,3)})
  if forced or not success:record['classification']='INCOMPLETE'
  (out/(side+'.result.json')).write_text(json.dumps(record,indent=2))
 require(success and not forced,'incomplete container/result/cleanup');return record

def main(root,out):
 root=pathlib.Path(root).resolve();out=pathlib.Path(out).resolve();out.mkdir(parents=True,exist_ok=True)
 side=sys.argv[3];require(side in ['SSR'],'trusted host input pins')
 # Optional Vite is never selected by this packet's workflow. It requires a separate explicit gate.
 stage('S04_INPUT_MANIFEST')
 pins=json.loads((root/'.github/server-ssr/host-pins.json').read_text())
 for rel,digest in pins['files'].items():require(hashlib.sha256((root/'.github/server-ssr'/rel).read_bytes()).hexdigest()==digest,'trusted host input pins')
 require(hashlib.sha256((out/'host-plan.json').read_bytes()).hexdigest()==(out/'host-plan.sha256').read_text().strip(),'trusted host input pins')
 plan=json.loads((out/'host-plan.json').read_text());require(plan['sourceCommit']=='825e9050407fe0cd7ce4bcafccccb03e7e0dbd53' and plan['deltaManifestSha256']==pins['files']['delta-hashes.json'] and plan['supervisorSha256']==pins['files']['stage-runner.cjs'] and plan['driverSha256']==pins['files']['driver.cjs'],'trusted host input pins')
 stage('S01_DAEMON');require(os.path.exists('/var/run/docker.sock'),'local Docker socket absent')
 info=json.loads(docker(['info','--format','{{json .}}'],out));require(info['OSType']=='linux' and info['CgroupVersion']=='2','daemon Linux/cgroupv2')
 require(all(any(word in x for x in info['SecurityOptions']) for word in ['seccomp','apparmor']),'daemon security options');require(not any('rootless' in x for x in info['SecurityOptions']),'unexpected rootless mode');require(info['MemTotal']>=12*1024**3,'daemon memory envelope')
 stage('S02_PULL');docker(['pull','--quiet','--platform=linux/amd64',IMAGE],out,timeout=120)
 stage('S03_IMAGE_INSPECT');image=json.loads(docker(['image','inspect',IMAGE],out))[0]
 require(image['Architecture']=='amd64' and image['Os']=='linux' and any(x.endswith('@'+DIGEST) for x in image['RepoDigests']),'image digest/platform')
 require(not image['Config'].get('Volumes'),'image volumes');require(not image['Config'].get('Healthcheck') or image['Config']['Healthcheck'].get('Test')==['NONE'],'unexpected image healthcheck');require(image['Size']<=512*1024**2,'image expanded size')
 expected=json.loads((out/'host-inputs.json').read_text());report=None
 try:report=run_side(side,root,out)
 finally:
  stage('S16_POSTHASH');start=time.monotonic()
  actualSet={p.relative_to(out).as_posix() for folder in ['snapshots','deps','compiler','candidate-qdrant','checks','stages'] for p in (out/folder).rglob('*') if p.is_file()}
  unchanged=actualSet==set(expected)
  for rel,digest in expected.items():
   require(time.monotonic()-start<=80,'host inventory deadline')
   path=out/rel
   if not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:unchanged=False;break
  require(time.monotonic()-start<=80,'host inventory deadline')
  result={'stage':side,'run':report,'inputsUnchanged':unchanged,'runtimeAcceptance':False,'productReadiness':False,'classification':'SSR_ARTIFACT_COMMAND_COMPLETED' if report and unchanged and report.get('exit')==0 else 'INCOMPLETE'}
  (out/'ssr-result.json').write_text(json.dumps(result,indent=2))
 require(result['classification']=='SSR_ARTIFACT_COMMAND_COMPLETED','incomplete result')
 if report['exit']!=0:raise CompletedCompilerErrors('SSR artifact incomplete; no retry')
def interrupted(signum,frame):require(False,'controller interrupted')
if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='--guardian':sys.exit(guardian(sys.argv[2],int(sys.argv[3]),sys.argv[4],sys.argv[5]))
 signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
 try:main(sys.argv[1],sys.argv[2])
 except CompletedCompilerErrors:
  print('SSR artifact stage INCOMPLETE; no automatic retry',file=sys.stderr);sys.exit(2)
 except BaseException as error:
  try:failure_receipt(pathlib.Path(sys.argv[2]),error)
  except Exception:pass
  print('Docker artifact control/result failed; fixed-enum failure receipt retained, no automatic retry',file=sys.stderr);sys.exit(1)
