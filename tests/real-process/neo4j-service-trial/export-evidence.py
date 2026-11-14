"""Review-only complete export or explicit bounded incomplete fallback.
No product verdict mutation, deletion, selective success, cap increase or followlinks.
"""
import base64,hashlib,io,json,os,pathlib,stat,sys,tarfile,time
root=pathlib.Path(sys.argv[1]);MAX_FILES=128;MAX_RAW=20*1024**2;MAX_GZIP=4*1024**2
MAX_SCAN=4096;MAX_PATH=256;MAX_DETAIL=4096;MAX_EMERGENCY=64*1024
start=time.monotonic();deadline=start+25;files=[];issues=[];raw=0;scanned=0;complete_scan=True

def problem(kind):
 if kind not in issues:issues.append(kind)

def scan(directory):
 global raw,scanned,complete_scan
 try:
  with os.scandir(directory)as entries:
   for entry in entries:
    scanned+=1
    if scanned>MAX_SCAN or time.monotonic()>=deadline:
     complete_scan=False;problem('SCAN_LIMIT');return
    path=pathlib.Path(entry.path);rel=path.relative_to(root).as_posix()
    if len(rel.encode())>MAX_PATH:problem('PATH_LIMIT');continue
    try:metadata=entry.stat(follow_symlinks=False)
    except OSError:problem('STAT_UNAVAILABLE');continue
    if stat.S_ISDIR(metadata.st_mode):
     scan(path)
     if not complete_scan:return
    elif stat.S_ISREG(metadata.st_mode):files.append((rel,path,metadata));raw+=metadata.st_size
    else:problem('NONREGULAR_PATH')
 except OSError:problem('SCAN_UNAVAILABLE')

SAFE_FIELDS={'status','state','mode','phase','rc','waitStatus','waitstatus','leader_rc','eof','signals','group','unsafe','natural_empty','removed','remove_error','cgroup_rc','volume_rc','trial_rc','diagnostic_capture_status','reporter_capture_status','pending','lifetimeFailures','ownerFailures','taskOutcomeFailures','count','truncated','command','name','seconds','errorType','errno','diagnostic_issues'}
SAFE_TEXT={'PASS','FAIL','FINAL_PASS','FINAL_FAIL','NOT_STARTED','PREPARED_NOT_STARTED','INCOMPLETE','SETTLED_NO_FAILURE_RECORDED','ESRCH','LIVE','CAPTURED','CAPTURED_WITH_EXIT_WORKER_GAP','MISSING_TELEMETRY','NOT_APPLICABLE','SIGKILL','SIGTERM','install','native','checks'}

def sanitized(value,depth=0):
 if depth>5:return {'truncated':True}
 if value is None or type(value)in(bool,int,float):return value
 if isinstance(value,str):return value if value in SAFE_TEXT else 'TEXT_REDACTED'
 if isinstance(value,list):return [sanitized(x,depth+1)for x in value[:16]]+([{'omitted':len(value)-16}]if len(value)>16 else [])
 if isinstance(value,dict):return {key:sanitized(v,depth+1)for key,v in value.items()if key in SAFE_FIELDS or key in {'results','events','scope_cleanup'}}
 return 'REDACTED'

def emergency(reason):
 # Logs limited64KiB here, no archive alleged. This is an explicitly selected
 # metadata-only fallback; missing raw remains missing. Never prints credentials.
 emitted=0
 def emit(row):
  nonlocal emitted
  text=json.dumps(row,separators=(',',':'))
  size=len((text+'\n').encode())
  if emitted+size>MAX_EMERGENCY:return False
  print(text,flush=True);emitted+=size;return True
 selected=[];omitted=[]
 emit({'kind':'EVIDENCE_INCOMPLETE','reason':reason,'raw_complete':False,'files_count_observed':len(files),'raw_bytes_observed':raw,'scan_complete':complete_scan,'scan_entries':scanned,'issues':issues,'selection':'control/final/session metadata plus inventory, not raw archive','limits':{'files':MAX_FILES,'raw':MAX_RAW,'gzip':MAX_GZIP,'emergency_stdout':MAX_EMERGENCY}})
 # Priority bounded boot diagnostic, before bulky details/inventory.
 # Dedicated producer emits only fixed schema, enum types, hashes, counters.
 boot_rel='checks/neo4j-boot-emergency.json';boot_path=root/boot_rel
 try:
  fd=os.open(boot_path,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb')as stream:
   meta=os.fstat(stream.fileno());assert stat.S_ISREG(meta.st_mode)and meta.st_size<=MAX_DETAIL
   data=stream.read(MAX_DETAIL+1);assert len(data)<=MAX_DETAIL
  value=json.loads(data);assert value.get('schema')=='NEO4J_BOOT_EMERGENCY_V1'
  def safe_boot(v,depth=0):
   if depth>5:return 'DEPTH_LIMIT'
   if v is None or type(v)in(bool,int,float):return v
   if isinstance(v,str):
    allowed={'NEO4J_BOOT_EMERGENCY_V1','NOT_STARTED','FAIL','INCOMPLETE','ONE_BOOT_QUERY_READBACK_CONTROLLED_SHUTDOWN_PASS_NOT_PRODUCT','PREFLIGHT','LAUNCH','READINESS','SERVER_IDENTITY','CREATE','MATCH','SHUTDOWN','NOT_WRITTEN','WRITE_FAILED','WRITTEN_COMPLETE','WRITTEN_INCOMPLETE','AssertionError','RuntimeError','TimeoutError','OSError','FileNotFoundError','PermissionError','ValueError','HTTPError','URLError','ConnectionError','JSONDecodeError','BrokenPipeError','ProcessLookupError','KeyError','TypeError','SystemExit','KeyboardInterrupt','OTHER_EXCEPTION'}
    return v if v in allowed or len(v)==64 and all(c in '0123456789abcdef'for c in v)else'TEXT_REDACTED'
   if isinstance(v,list):return [safe_boot(x,depth+1)for x in v[:4]]
   if isinstance(v,dict):
    keys={'schema','status','original_failure','stage','error_type','error_sha256','last_stage','envelope_state','raw_complete','cleanup','leader_rc','signal_count','eof','group_empty','ports_closed','remaining_identity_count','errors','console_missing_bytes','runtime_evidence_incomplete','evidence_failure_type','observer_error_count'}
    return{k:safe_boot(x,depth+1)for k,x in v.items()if k in keys}
   return 'REDACTED'
  emit({'kind':'EMERGENCY_BOOT_CAUSE_CLEANUP','path':boot_rel,'selection':safe_boot(value),'raw_fields_omitted':True});selected.append(boot_rel)
 except Exception as error:
  emit({'kind':'EMERGENCY_BOOT_DIAGNOSTIC_UNAVAILABLE','path':boot_rel,'cause_and_cleanup_unverified':True,'detail_missing':True,'error_type':type(error).__name__ if type(error).__name__ in {'FileNotFoundError','PermissionError','AssertionError','JSONDecodeError','OSError'}else'OTHER_EXCEPTION'})
 fixed=['trial-cleanup.json','host-budget.json','security-helpers-state.json']
 for phase in ['install','native','checks']:
  fixed +=[phase+'/'+name for name in ['containment-host.json','scope-cleanup.json',phase+'-session.json','namespace-status.json']]
 fixed+=['owner-harness/containment-host.json','owner-harness/scope-cleanup.json']
 lookup={rel:(path,metadata)for rel,path,metadata in files}
 for rel in fixed:
  if rel not in lookup:
   omitted.append({'path':rel,'reason':'MISSING'});continue
  path,metadata=lookup[rel]
  try:
   with path.open('rb')as stream:data=stream.read(MAX_DETAIL+1)
   if len(data)>MAX_DETAIL:
    omitted.append({'path':rel,'reason':'DETAIL_LIMIT','bytes':metadata.st_size});continue
   value=json.loads(data);row={'kind':'EMERGENCY_SANITIZED_DETAIL','path':rel,'selection':sanitized(value),'raw_fields_omitted':True,'original_bytes':len(data)}
   if emit(row):selected.append(rel)
   else:omitted.append({'path':rel,'reason':'EMERGENCY_STDOUT_LIMIT'})
  except Exception:omitted.append({'path':rel,'reason':'READ_OR_PARSE_UNAVAILABLE'})
 inventory_count=0
 for rel,path,metadata in sorted(files):
  if inventory_count>=128:break
  if not emit({'kind':'EMERGENCY_INVENTORY','path':rel,'bytes':metadata.st_size}):break
  inventory_count+=1
 emit({'kind':'EVIDENCE_INCOMPLETE_END','selected_details':selected,'omitted_details':omitted,'inventory_emitted':inventory_count,'inventory_omitted_observed':max(0,len(files)-inventory_count),'unknown_unscanned_files':not complete_scan,'raw_payloads_omitted':len(files),'diagnostic_not_product_verdict':True})
 raise SystemExit(1)

class CappedBytes(io.BytesIO):
 def write(self,data):
  if self.tell()+len(data)>MAX_GZIP:raise ValueError('GZIP_LIMIT')
  return super().write(data)

scan(root);files.sort()
if '--emergency-only'in sys.argv:emergency('PRIMARY_EXPORT_TIMEOUT_OR_FAILURE')
print('CURRENT_SUITE_EVIDENCE_FILES:'+str(len(files)),flush=True);print('CURRENT_SUITE_EVIDENCE_RAW_BYTES:'+str(raw),flush=True)
if issues or not complete_scan:emergency('PATH_OR_SCAN_INCOMPLETE')
if len(files)>MAX_FILES or raw>MAX_RAW:emergency('COUNT_OR_RAW_LIMIT')
out=CappedBytes()
try:
 with tarfile.open(fileobj=out,mode='w:gz',dereference=False)as archive:
  for rel,path,metadata in files:
   if time.monotonic()>=deadline:raise TimeoutError('EXPORT_WALL')
   # Preserve original entire regular files, refuse stat races/symlinks.
   fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
   with os.fdopen(fd,'rb')as stream:
    current=os.fstat(stream.fileno())
    if not stat.S_ISREG(current.st_mode)or(current.st_dev,current.st_ino,current.st_size,current.st_mtime_ns)!=(metadata.st_dev,metadata.st_ino,metadata.st_size,metadata.st_mtime_ns):raise ValueError('FILE_CHANGED')
    info=tarfile.TarInfo(rel);info.size=current.st_size;info.mode=current.st_mode&0o777;info.mtime=current.st_mtime;archive.addfile(info,stream)
except Exception as error:emergency(type(error).__name__+'_FULL_ARCHIVE_UNAVAILABLE')
data=out.getvalue();print('CURRENT_SUITE_EVIDENCE_SHA256:'+hashlib.sha256(data).hexdigest());print('CURRENT_SUITE_EVIDENCE_BYTES:'+str(len(data)));print('CURRENT_SUITE_EVIDENCE_BASE64_BEGIN')
for offset in range(0,len(data),3072):print(base64.b64encode(data[offset:offset+3072]).decode())
print('CURRENT_SUITE_EVIDENCE_BASE64_END',flush=True)
