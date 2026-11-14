#!/usr/bin/env python3
"""SOURCE REVIEW ONLY: one real console boot/query/controlled SIGINT, no retries.
No product imports, external network, credentials, second boot, or cap changes.
"""
import base64,hashlib,json,os,pathlib,resource,selectors,signal,socket,stat,subprocess,time,urllib.error,urllib.request
H=pathlib.Path('/tmp/harness');EV=pathlib.Path('/tmp/evidence');R=pathlib.Path('/tmp/neo4j-runtime');A=pathlib.Path('/tmp/work/node_modules/.silhouette-native-neo4j/neo4j-community-5.26.32');P=json.loads((H/'neo4j-admission-inputs.json').read_text())
T=time.monotonic();DEADLINE=min(T+175,float(os.environ['NEO4J_BOOT_PHASE_DEADLINE'])-10);STARTUP=90;STOP=30
result={'status':'INCOMPLETE','scope':'ONE_REAL_NEO4J_BOOT_CYPHER_WRITE_READ_CONTROLLED_SHUTDOWN_NOT_PRODUCT_OR_DRIVER','queries':[],'signals':[],'startup_errors':{'count':0,'samples':[]},'cleanup':{},'resource_maxima':'SAMPLED_NOT_ABSOLUTE_PEAK'}
child=None;sel=selectors.DefaultSelector();log=bytearray();eof=False;stop_sent=False;identity=None;owned_history={};failure=None;cleanup_errors=[];observed={};stage='PREFLIGHT';original_failure=None;last_scan=0;fd_history={};console_total=0;console_hash=hashlib.sha256();console_missing=0

def digest(path):
 with path.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def proc(pid):
 try:
  f=(pathlib.Path('/proc')/str(pid)/'stat').read_text();fields=f[f.rindex(')')+2:].split();return {'pid':pid,'ppid':int(fields[1]),'pgid':int(fields[2]),'start_ticks':int(fields[19]),'state':fields[0]}
 except FileNotFoundError:return None

def inspect_processes():
 rows=[]
 for f in pathlib.Path('/proc').iterdir():
  if f.name.isdigit():
   row=proc(int(f.name))
   if row and child and row['pgid']==child.pid:
    rows.append(row);owned_history[(row['pid'],row['start_ticks'])]=row
    try:
     fdcount=len(list((f/'fd').iterdir()));observed['maximum_sampled_fd_per_process']=max(observed.get('maximum_sampled_fd_per_process',0),fdcount);fd_history[(row['pid'],row['start_ticks'])]=max(fd_history.get((row['pid'],row['start_ticks']),0),fdcount)
    except FileNotFoundError:pass
 assert len(rows)<=256,'processscanexcess'
 return rows

def scan_scratch():
 total=0;entries=0;biggest=0
 for root,dirs,files in os.walk('/tmp',followlinks=False):
  # /tmp/work/node_modules is separate read-only dependency store.
  dirs[:]=[d for d in dirs if str(pathlib.Path(root)/d)!='/tmp/work/node_modules']
  for name in dirs+files:
   f=pathlib.Path(root)/name;s=f.lstat();entries+=1;assert entries<=12000,'scratchscanentrycap'
   assert not stat.S_ISLNK(s.st_mode),'scratchsymlinknotadmitted'
   if stat.S_ISREG(s.st_mode):total+=s.st_size;biggest=max(biggest,s.st_size)
 assert total<=384*1024**2,'scratchwatermark384MiB'
 observed['maximum_sampled_scratch_file_bytes']=max(observed.get('maximum_sampled_scratch_file_bytes',0),total)
 observed['maximum_sampled_file_bytes']=max(observed.get('maximum_sampled_file_bytes',0),biggest)
 return total

def drain(wait=.05,check=True):
 global eof,last_scan,console_total,console_missing
 if check:assert time.monotonic()<DEADLINE,'bootfixtureabsolute175s'
 for key,_ in sel.select(wait):
  b=os.read(key.fd,65536)
  if not b:eof=True;sel.unregister(key.fd)
  else:
   console_total+=len(b);console_hash.update(b);keep=b[:max(0,2*1024**2-len(log))];log.extend(keep);console_missing+=len(b)-len(keep)
   if check:assert console_total<=1024**2,'consolelog1MiBsoftstop2MiBabsoluteevidence'
 inspect_processes()
 if check and time.monotonic()-last_scan>=1:
  last_scan=time.monotonic();scan_scratch()

def request(statement,parameters,timeout=2):
 payload=json.dumps({'statement':statement,'parameters':parameters},separators=(',',':')).encode();assert len(payload)<=16384
 req=urllib.request.Request('http://127.0.0.1:7474/db/neo4j/query/v2',data=payload,headers={'Content-Type':'application/json','Accept':'application/json'},method='POST')
 # Explicit no-proxy opener, only this fixed loopback endpoint.
 try:
  with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=timeout)as r:status=r.status;raw=r.read(65537)
 except urllib.error.HTTPError as error:
  status=error.code;raw=error.read(65537);result['last_http_failure']={'statement':statement,'status':status,'raw_base64':base64.b64encode(raw).decode('ascii'),'response_cap_exceeded':len(raw)>65536};raise
 result['last_http_response']={'statement':statement,'status':status,'raw_base64':base64.b64encode(raw).decode('ascii'),'response_cap_exceeded':len(raw)>65536}
 assert status==202 and len(raw)<=65536,'QueryAPIstatusorresponsecap'
 answer=json.loads(raw);assert not answer.get('errors'),'Cyphererrors';return answer

def query(statement,parameters,fields,values):
 answer=request(statement,parameters);assert answer.get('data')=={'fields':fields,'values':values},'realqueryreadbackmismatch'
 result['queries'].append({'statement':statement,'parameters':parameters,'response':answer,'verified_expected_fields':fields,'verified_expected_values':values});drain(0)

def signal_stop(reason):
 global stop_sent
 if child and child.poll()is None and not stop_sent:
  current=proc(child.pid);assert current and current['start_ticks']==identity['start_ticks']and current['pgid']==child.pid,'launcheridentitychanged'
  # Vendor5.26.32 launcher forwards Process.destroy(TERM) to its actual server child.
  # We signal ONLY original launcher PID once, not entire group and not a retry.
  os.kill(child.pid,signal.SIGINT);stop_sent=True
  result['signals'].append({'kind':'CONTROLLED_SHUTDOWN_REQUESTED','signal':'SIGINT','target':'ORIGINAL_LAUNCHER_PID_ONLY','pid':child.pid,'start_ticks':identity['start_ticks'],'reason':reason,'monotonic':time.monotonic()})

def wait_stop(cleanup=False):
 until=min(time.monotonic()+STOP,DEADLINE)
 while time.monotonic()<until:
  drain(.05,check=not cleanup)
  rows=inspect_processes()
  if child.poll()is not None and eof and not rows:break
 assert child.poll()==0,'originalconsoleexitmustbe0not130or143'
 assert eof,'consoleEOFmissing';assert not inspect_processes(),'ownedgroupnotempty'
 for port in [7474,7787]:
  with socket.socket()as s:
   s.settimeout(.2);assert s.connect_ex(('127.0.0.1',port))!=0,'portremainedopen'
 result['cleanup'].update(leader_rc=child.returncode,eof=eof,owned_group_empty=True,loopback_ports_closed=True)

try:
 assert DEADLINE-T>=170,'insufficientfixturebudget'
 assert resource.getrlimit(resource.RLIMIT_NOFILE)==(256,256)and resource.getrlimit(resource.RLIMIT_FSIZE)==(64*1024**2,64*1024**2)
 # /proc belongs to the existing private network/PID namespace; /sys is not mounted.
 # Inspect actual interfaces/routes without external probes or new mounts.
 network={}
 for name in ['dev','route','ipv6_route']:
  with(pathlib.Path('/proc/net')/name).open('rb')as stream:data=stream.read(65537)
  assert len(data)<=65536,'networkpreflightfilecap'
  network[name]={'sha256':hashlib.sha256(data).hexdigest(),'lines':data.decode('ascii').splitlines()}
 interfaces=[]
 for line in network['dev']['lines'][2:]:
  if line.strip():
   name,sep,counters=line.partition(':');assert sep and len(counters.split())==16,'networkinterfacerecord'
   interfaces.append(name.strip())
 assert interfaces==['lo'],'externalnetworkinterfacepresent'
 routes4=[line.split()for line in network['route']['lines'][1:]if line.strip()]
 assert all(len(row)==11 and row[0]=='lo'and row[2]=='00000000'for row in routes4),'externalIPv4routepresent'
 routes6=[line.split()for line in network['ipv6_route']['lines']if line.strip()]
 assert all(len(row)==10 and row[-1]=='lo'and row[4]=='0'*32 for row in routes6),'externalIPv6routepresent'
 result['network_preflight']={'source':'EXISTING_PRIVATE_NAMESPACE_PROC_NO_EXTERNAL_PROBE','network_namespace':os.readlink('/proc/self/ns/net'),'interfaces':interfaces,'files':network,'ipv4_route_count':len(routes4),'ipv6_route_count':len(routes6)}
 assert os.statvfs(A).f_flag&os.ST_RDONLY,'assetmustRO'
 pins=json.loads((H/'neo4j-asset-pin.json').read_text())
 for row in pins:
  f=A.joinpath(*pathlib.PurePosixPath(row['path']).parts[1:]);s=f.lstat();assert not f.is_symlink()
  if row['type']=='0':assert stat.S_ISREG(s.st_mode)and s.st_size==row['bytes']and digest(f)==row['sha256']
  else:assert stat.S_ISDIR(s.st_mode)
 jdk=P['jdk'];home=pathlib.Path(jdk['home']);assert home.resolve(strict=True)==home and os.statvfs(home).f_flag&os.ST_RDONLY
 assert digest(home/'release')==jdk['release_sha256']
 for name,h in jdk['files'].items():assert digest(home/name)==h and os.statvfs(home/name).f_flag&os.ST_RDONLY
 # Reserve exact loopback endpoints before startup, no port alternative/fallback.
 probes=[]
 try:
  for port in [7474,7787]:
   s=socket.socket();s.bind(('127.0.0.1',port));probes.append(s)
 finally:
  for s in probes:s.close()
 R.mkdir(mode=0o700)
 for name in ['conf','data','logs','run','plugins-empty','import-empty','transactions','java-tmp','home']:(R/name).mkdir(mode=0o700)
 conf=(H/'neo4j-boot.conf').read_bytes();xml=(H/'neo4j-boot-logs.xml').read_bytes()
 (R/'conf/neo4j.conf').write_bytes(conf);(R/'conf/server-logs.xml').write_bytes(xml);(R/'conf/user-logs.xml').write_bytes((H/'neo4j-boot-user-logs.xml').read_bytes())
 result['config_sha256']=hashlib.sha256(conf).hexdigest();result['log_config_sha256']=hashlib.sha256(xml).hexdigest()
 env={'PATH':'/usr/bin:/bin','JAVA_HOME':str(home),'JAVACMD':str(home/'bin/java'),'NEO4J_HOME':str(A),'NEO4J_CONF':str(R/'conf'),'HOME':str(R/'home'),'TMPDIR':str(R/'java-tmp'),'LANG':'C.UTF-8','NEO4J_CONFIG_FILE_CHARSET':'utf8'}
 stage='LAUNCH'
 child=subprocess.Popen([str(A/'bin/neo4j'),'console'],cwd=R,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
 identity=proc(child.pid);assert identity and identity['pgid']==child.pid;result['launcher_initial_identity']=identity
 os.set_blocking(child.stdout.fileno(),False);sel.register(child.stdout,selectors.EVENT_READ)
 ready_until=min(time.monotonic()+STARTUP,DEADLINE-STOP-15);ready=False;next_try=0
 stage='READINESS'
 while time.monotonic()<ready_until:
  drain(.05);assert child.poll()is None,'serverexitedbeforequeryreadiness'
  if time.monotonic()>=next_try:
   next_try=time.monotonic()+1
   try:
    answer=request('RETURN 1 AS one',{},timeout=1);assert answer.get('data')=={'fields':['one'],'values':[[1]]};result['queries'].append({'statement':'RETURN 1 AS one','response':answer});ready=True;break
   except urllib.error.HTTPError:raise # Wrong API/auth/status is not a readiness retry.
   except (urllib.error.URLError,TimeoutError,ConnectionError)as e:
    errors=result['startup_errors'];errors['count']+=1
    if len(errors['samples'])<4:errors['samples'].append({'error_type':type(e).__name__,'error':str(e)[:256]})
 assert ready,'readiness90snotmet'
 stage='SERVER_IDENTITY'
 rows=inspect_processes();assert len(rows)>=2,'actualconsolelauncherandserverchildnotobserved';result['owned_ready_identities']=rows
 # Bind HTTP listen socket inode to actual JVM server PID, not just launcher/group.
 listeners=set();bolt_listeners=set();listener_rows=[]
 for table,loopbacks in [('tcp',{'0100007F'}),('tcp6',{'0000000000000000FFFF00000100007F','00000000000000000000000001000000'})]:
  for line in pathlib.Path('/proc/net/'+table).read_text().splitlines()[1:]:
   fields=line.split();address,port=fields[1].split(':')
   if fields[3]=='0A'and port in {'1D32','1E6B'}:
    assert address in loopbacks,'nonloopbackNeo4jlistener'
    (listeners if port=='1D32'else bolt_listeners).add(fields[9]);listener_rows.append({'table':table,'address':address,'port_hex':port,'inode':fields[9]})
 assert len(listeners)==len(bolt_listeners)==1,'HTTP7474Bolt7787loopbacklisteneridentity'
 servers=[]
 for row in rows:
  if row['pid']==child.pid:continue
  fdlinks=[]
  for fd in(pathlib.Path('/proc')/str(row['pid'])/'fd').iterdir():
   try:fdlinks.append(os.readlink(fd))
   except FileNotFoundError:pass
  if all('socket:['+inode+']'in fdlinks for inode in listeners|bolt_listeners):servers.append(row)
 assert len(servers)==1,'actualHTTPserverPIDnotunique';server=servers[0]
 assert server['ppid']==child.pid and server['pgid']==child.pid,'vendorconsolechildmappingnotmet'
 assert(pathlib.Path('/proc')/str(server['pid'])/'exe').resolve(strict=True)==(home/'bin/java').resolve(strict=True),'actualservernotpinnedjava'
 result['actual_server_identity']={**server,'proof':'unique loopback7474LISTENinode owned by pinned Java direct child of original launcher','http_listen_inodes':sorted(listeners),'bolt_listen_inodes':sorted(bolt_listeners),'listener_rows':listener_rows}
 stage='CREATE'
 query('CREATE (n:StageBBootFixture {id: $id, value: $value, stamp: $stamp}) RETURN n.id AS id, n.value AS value, n.stamp AS stamp',{'id':'stageB-oneboot-fixture','value':'synthetic-isolated-boot','stamp':1700000000000},['id','value','stamp'],[['stageB-oneboot-fixture','synthetic-isolated-boot',1700000000000]])
 stage='MATCH'
 query('MATCH (n:StageBBootFixture {id: $id}) RETURN n.id AS id, n.value AS value, n.stamp AS stamp',{'id':'stageB-oneboot-fixture'},['id','value','stamp'],[['stageB-oneboot-fixture','synthetic-isolated-boot',1700000000000]])
 result['query_work']='REAL_RETURN1_CREATE_INDEPENDENT_MATCH_READBACK'
 stage='SHUTDOWN'
 signal_stop('QUERY_WORK_FINISHED');wait_stop()
 runtime_parts=[];runtime_bytes=0
 for f in sorted((R/'logs').iterdir()):
  size=f.stat().st_size;assert f.is_file()and not f.is_symlink()and runtime_bytes+size<=4*1024**2,'shutdownlogreadcap';runtime_bytes+=size;runtime_parts.append(f.read_bytes())
 runtime=b''.join(runtime_parts)
 assert b'Neo4j Server shutdown initiated by request'in runtime and b'Stopped.'in runtime,'Neo4jshutdownhookcompletionlogmissing'
 result['status']='ONE_BOOT_QUERY_READBACK_CONTROLLED_SHUTDOWN_PASS_NOT_PRODUCT'
except BaseException as original:
 original_failure={'stage':stage,'error_type':type(original).__name__,'error_sha256':hashlib.sha256(str(original).encode()).hexdigest()}
 failure=original;result.update(status='FAIL',error_type=type(original).__name__,error=str(original)[:512])
finally:
 # Preserve original failure; controlled SIGINT once also handles startup failures.
 if child and child.poll()is None:
  try:signal_stop('FAILURE_CLEANUP');wait_stop(cleanup=True)
  except Exception as error:cleanup_errors.append({'error_type':type(error).__name__,'error':str(error)[:256]})
 if child:
  try:
   while sel.get_map()and time.monotonic()<DEADLINE and child.poll()is not None:drain(.01,check=False)
   if child.poll()is not None:child.wait(timeout=.1)
   result['cleanup']['final_owned_identities']=inspect_processes()
  except Exception as error:cleanup_errors.append({'error_type':type(error).__name__})
 sel.close()
 if child and child.stdout:child.stdout.close()
 if result.get('actual_server_identity'):
  sv=result['actual_server_identity'];observed['maximum_sampled_actual_server_jvm_fd']=fd_history.get((sv['pid'],sv['start_ticks']))
 result['owned_process_history']=list(owned_history.values());result['sampled_observations']=observed;result['seconds']=time.monotonic()-T;result['cleanup_errors']=cleanup_errors
 if cleanup_errors or console_total>1024**2:result['status']='FAIL'
 result['budgets']={'fixture_absolute_seconds':175,'startup_seconds':90,'stop_seconds':30,'command_seconds':185,'phase_namespace_seconds_max':205,'outer_watchdog_seconds_max':210,'host_scope_wall_seconds_max':220}
 def publish_summary(envelope_state):
  # No raw error text, requests, parameters, console, paths or user data.
  safe_types={'AssertionError','RuntimeError','TimeoutError','OSError','FileNotFoundError','PermissionError','ValueError','HTTPError','URLError','ConnectionError','JSONDecodeError','BrokenPipeError','ProcessLookupError','KeyError','TypeError','SystemExit','KeyboardInterrupt'}
  def typ(value):return value if value in safe_types else 'OTHER_EXCEPTION'
  cause=None if original_failure is None else {**original_failure,'error_type':typ(original_failure['error_type'])}
  summary={'schema':'NEO4J_BOOT_EMERGENCY_V1','status':'FAIL'if result['status']=='FAIL'else'INCOMPLETE'if envelope_state!='WRITTEN_COMPLETE'else result['status'],'original_failure':cause,'last_stage':stage,'envelope_state':envelope_state,'raw_complete':envelope_state=='WRITTEN_COMPLETE','cleanup':{'leader_rc':child.returncode if child else None,'signal_count':len(result['signals']),'eof':eof,'group_empty':result['cleanup'].get('owned_group_empty',False),'ports_closed':result['cleanup'].get('loopback_ports_closed',False),'remaining_identity_count':len(result['cleanup'].get('final_owned_identities',[])),'errors':[{'error_type':typ(e.get('error_type')),'error_sha256':hashlib.sha256(e.get('error','').encode()).hexdigest()}for e in cleanup_errors[:4]]},'console_missing_bytes':console_missing,'runtime_evidence_incomplete':bool(result.get('evidence_error')),'evidence_failure_type':typ(result.get('evidence_error',{}).get('error_type'))if result.get('evidence_error')else None}
  text=json.dumps(summary,separators=(',',':'));assert len(text.encode())<=4096,'emergencysummary4096'
  try:(EV/'neo4j-boot-emergency.json').write_text(text+'\n')
  except Exception:
   # Still a failed/incomplete run; bounded stdout survives sidecar failure.
   print('NEO4J_BOOT_EMERGENCY:'+text,flush=True)
 publish_summary('NOT_WRITTEN')
 # One lossless evidence envelope, all runtime logs/conf in bounded raw representation.
 attachments=[];total=0
 try:
  files=[]
  if R.exists():
   for directory in ['conf','logs']:
    for f in (R/directory).iterdir():
     s=f.lstat();assert stat.S_ISREG(s.st_mode)and not f.is_symlink();files.append(f)
  assert len(files)<=20,'runtimeevidencefilecount'
  result['runtime_log_rotation_observed']=any(f.name.endswith(('.1.log','.2.log'))for f in files)
  if result['runtime_log_rotation_observed']:result['status']='FAIL';result['evidence_error']={'error_type':'RuntimeRotationLifetimeCompletenessUnproven'}
  for f in sorted(files):
   size=f.stat().st_size;assert total+size<=4*1024**2,'runtimeevidence4MiB';data=f.read_bytes();assert len(data)==size;total+=len(data);attachments.append({'path':str(f.relative_to(R)),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'base64':base64.b64encode(data).decode('ascii')})
 except Exception as error:
  result['status']='FAIL';result['evidence_error']={'error_type':type(error).__name__,'error':str(error)[:256]}
 if console_missing:result['status']='FAIL';result['evidence_error']={'error_type':'ConsoleEvidenceOverflow','missing_raw_bytes':console_missing}
 envelope={'result':result,'console':{'observed_bytes':console_total,'observed_sha256':console_hash.hexdigest(),'missing_raw_bytes':console_missing,'bytes':len(log),'sha256':hashlib.sha256(log).hexdigest(),'base64':base64.b64encode(log).decode('ascii')},'runtime_files':attachments,'scope':'LOSSLESS_ACTUAL_LOGS_CONFIG_NOT_DATABASE_DUMP','runtime_files_complete':not bool(result.get('evidence_error'))}
 try:
  (EV/'neo4j-boot-evidence.json').write_text(json.dumps(envelope,separators=(',',':'))+'\n')
 except Exception as error:
  result['status']='FAIL';result['evidence_error']={'error_type':type(error).__name__};publish_summary('WRITE_FAILED');raise SystemExit(1)
 publish_summary('WRITTEN_COMPLETE'if envelope['runtime_files_complete']else'WRITTEN_INCOMPLETE')
 print('NEO4J_ONEBOOT_RESULT',result['status'],flush=True)
 if failure or result['status']=='FAIL':raise SystemExit(1)
