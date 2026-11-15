#!/usr/bin/env python3
"""Read genuine Vitest JSON and root-owned actual direct-child evidence only. Never imports product or runs tests."""
from pathlib import Path
import json,sys,re,hashlib
def selected_failure_diagnostic(name,report,blob,service,code):
 # Only the existing exact public-fixture selections, never arbitrary stdout/files.
 import os,stat,base64
 expected=Path('/mnt/silhouette-genuine-vitest/runtime/candidate')
 if name not in ('mcp',)or Path(report)!=expected/(name+'.report.json')or Path(blob)!=expected/(name+'.blob.json')or Path(service)!=Path('/mnt/silhouette-genuine-vitest/private')/(name+'.child.json'):
  raise ValueError('EXACT_SELECTED_REPORT_PATHS_REQUIRED')
 out={'schema':1,'selection':name,'origin':'SELECTED_VITEST_REPORTS_UNTRUSTED_NOT_AUTHORITY','status':'UNKNOWN','exitCode':int(code),'textBudgetBytes':12288,'records':[],'truncated':False}
 remaining=12288
 def text(value,limit=2048):
  nonlocal remaining
  if not isinstance(value,str):return None
  raw=value.encode('utf-8',errors='replace');take=min(len(raw),limit,remaining);remaining-=take
  if take<len(raw):out['truncated']=True
  captured=raw if take==len(raw)else(raw[:take//2]+raw[-(take-take//2):]if take else b'')
  return captured.decode('utf-8',errors='ignore')
 def record(kind,**fields):
  if len(out['records'])>=24:out['truncated']=True;return
  out['records'].append({'kind':kind,**fields})
 def read(path,label):
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
  try:
   before=os.fstat(fd)
   if not stat.S_ISREG(before.st_mode)or before.st_size>8388608:raise ValueError('REPORT_SIZE_OR_KIND')
   with os.fdopen(fd,'rb',closefd=False)as f:raw=f.read(8388609)
   after=os.fstat(fd)
   if len(raw)>8388608 or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):raise ValueError('REPORT_CHANGED')
   out[label+'Bytes']=len(raw);out[label+'Sha256']=hashlib.sha256(raw).hexdigest()
   return json.loads(raw)
  finally:os.close(fd)
 ok=True
 try:
  receipt=json.loads(Path(service).read_text())
  if receipt.get('schema')!=1 or receipt.get('phase')!='candidate'or receipt.get('residualUidProcesses')!=0:
   raise ValueError('REPORT_WRITER_NOT_QUIESCENT')
 except (OSError,ValueError,TypeError,KeyError,RecursionError):
  # Do not read product-owned files if writer quiescence cannot be established.
  print('VITEST_FAILURE_DIAGNOSTIC '+json.dumps({'schema':1,'status':'ROOT_RECEIPT_UNVERIFIED_NO_REPORT_READ_NO_ACCEPTANCE'},separators=(',',':')),flush=True)
  return False
 try:
  r=read(report,'report')
  if not isinstance(r,dict)or not isinstance(r.get('testResults'),list):raise ValueError('REPORT_SCHEMA')
  keys=('numTotalTests','numPassedTests','numFailedTests','numPendingTests','numTotalTestSuites','numFailedTestSuites','numRuntimeErrorTestSuites')
  out['reportedCounts']={k:r[k]for k in keys if type(r.get(k))is int and 0<=r[k]<=100000}
  out['reportedSuccess']=r.get('success')if type(r.get('success'))is bool else None
  files=sorted(r['testResults'],key=lambda f:0 if isinstance(f,dict)and f.get('status')=='failed'else 1)
  for f in files[:16]:
   if not isinstance(f,dict)or not isinstance(f.get('assertionResults'),list):raise ValueError('FILE_SCHEMA')
   assertions=sorted(f['assertionResults'],key=lambda a:0 if isinstance(a,dict)and a.get('status')=='failed'else 1)
   filename=text(f.get('name'),512)
   record('file',name=filename,status=text(f.get('status'),64),message=text(f.get('message')))
   for a in assertions[:32]:
    if not isinstance(a,dict):raise ValueError('ASSERTION_SCHEMA')
    messages=a.get('failureMessages',[])
    if not isinstance(messages,list):raise ValueError('FAILURE_SCHEMA')
    record('assertion',name=text(a.get('fullName')or a.get('title'),512),status=text(a.get('status'),64),errors=[text(v)for v in messages[:3]if isinstance(v,str)])
    if len(messages)>3:out['truncated']=True
   if len(f['assertionResults'])>32:out['truncated']=True
  if len(r['testResults'])>16:out['truncated']=True
  for key in ('errors','unhandledErrors'):
   values=r.get(key,[])
   if not isinstance(values,list):raise ValueError('ERRORS_SCHEMA')
   for v in values[:8]:
    if isinstance(v,str):record(key,message=text(v))
    elif isinstance(v,dict):record(key,**{k:text(v.get(k))for k in ('name','message','stack')if isinstance(v.get(k),str)})
    else:record(key,message='UNSUPPORTED_ERROR_SHAPE')
   if len(values)>8:out['truncated']=True
 except (OSError,ValueError,TypeError,KeyError,IndexError,RecursionError,UnicodeError)as error:
  out['reportStatus']='UNAVAILABLE_OR_MALFORMED';out['reportErrorType']=type(error).__name__;ok=False
 try:
  pool=read(blob,'blob')
  if not isinstance(pool,list)or not pool or not isinstance(pool[0],list)or len(pool[0])!=6:raise ValueError('BLOB_SCHEMA')
  def ref(v):
   if not isinstance(v,str)or not v.isascii()or not v.isdigit()or len(v)>8:raise ValueError('BLOB_REFERENCE')
   return pool[int(v)]
  if ref(pool[0][0])!='4.0.16':raise ValueError('BLOB_VERSION')
  errors=ref(pool[0][2])
  if not isinstance(errors,list):raise ValueError('BLOB_ERRORS_SCHEMA')
  out['blobUnhandledErrorCount']=len(errors)
  for item in errors[:8]:
   v=ref(item)
   if not isinstance(v,dict):record('blobUnhandled',message='UNSUPPORTED_ERROR_SHAPE');continue
   fields={}
   for k in ('name','message','stack'):
    if k in v:
     value=ref(v[k])if isinstance(v[k],str)else v[k]
     if isinstance(value,str):fields[k]=text(value)
   record('blobUnhandled',**fields)
  if len(errors)>8:out['truncated']=True
 except (OSError,ValueError,TypeError,KeyError,IndexError,RecursionError,UnicodeError)as error:
  out['blobStatus']='UNAVAILABLE_OR_MALFORMED';out['blobErrorType']=type(error).__name__;ok=False
 out['status']='PROJECTED_UNTRUSTED'if ok else'UNAVAILABLE_OR_MALFORMED_NO_ACCEPTANCE'
 raw=json.dumps(out,ensure_ascii=False,separators=(',',':')).encode()
 # Hard output cap as well as bounded records/strings. Never emit partial JSON.
 if len(raw)>24576:
  raw=json.dumps({'schema':1,'selection':name,'origin':'SELECTED_VITEST_REPORTS_UNTRUSTED_NOT_AUTHORITY','status':'PROJECTION_OVERSIZE_NO_ACCEPTANCE','truncated':True},separators=(',',':')).encode();ok=False
 print('VITEST_FAILURE_DIAGNOSTIC '+json.dumps({'schema':1,'encoding':'base64','capturedBytes':len(raw),'capturedSha256':hashlib.sha256(raw).hexdigest(),'data':base64.b64encode(raw).decode()},separators=(',',':')),flush=True)
 return ok

if len(sys.argv)==7 and sys.argv[1]=='--failure-diagnostic':
 selection,report_path,blob_path,receipt_path,exit_code=sys.argv[2:]
 sys.exit(0 if selected_failure_diagnostic(selection,report_path,blob_path,receipt_path,exit_code)else 1)
name,report,blob,service,code=sys.argv[1:]
assert name in ('typecheck','mcp'),'UNKNOWN_VALIDATION_SELECTION'
s=json.loads(Path(service).read_text())
assert s['schema']==1 and s['phase']=='candidate' and s['natural'] is True,'NATURAL_WHOLE_CHILD_REQUIRED'
assert s['forced'] is False and s['residualUidProcesses']==0,'FORCED_OR_RESIDUAL_CHILD'
assert s['rawReturnCode']==int(code),'ACTUAL_EXIT_MISMATCH'
assert s['aggregateMemoryMax']==10737418240 and s['swapMax']==0 and s['aggregateTasksMax']==384 and s['cpuCount']==2,'AGGREGATE_BOUNDS_NOT_VERIFIED'
assert s['boundary']=='DIRECT_CHILD_BWRAP_OFFLINE_CONFIGURED_NOT_EXECUTION_PROOF','BOUNDARY_CONFIGURATION_REQUIRED_NOT_EXECUTION_PROOF'
assert all(s['oomAfter'].get(k,0)==s['oomBefore'].get(k,0)for k in ('oom','oom_kill','oom_group_kill')),'OOM_INVALIDATES_ACCEPTANCE'
if name=='typecheck':
 assert int(code)==0,'TYPECHECK_FAILED_NO_ACCEPTANCE'
 print(json.dumps({'session':name,'status':'COMPILER_NATURAL_EXIT_ZERO_NOT_RUNTIME_PROOF','naturalWholeChildExit':True,'fullProductAccepted':False}))
 sys.exit(0)
# Built-in JSON does not expose all unhandled errors in 4.0.16. Its own built-in
# blob reporter serializes [version, files, unhandledErrors, coverage, time, modules].
# Read only the two top-level flatted references needed here; no product/library imports.
pool=json.loads(Path(blob).read_text());top=pool[0]
assert isinstance(top,list)and len(top)==6,'UNKNOWN_BUILTIN_BLOB_SCHEMA'
def reference(value):
 assert isinstance(value,str)and value.isdigit(),'UNKNOWN_FLATTED_REFERENCE'
 return pool[int(value)]
assert reference(top[0])=='4.0.16','WRONG_GENUINE_VITEST_VERSION'
assert reference(top[2])==[],'GENUINE_VITEST_UNHANDLED_ERRORS'
r=json.loads(Path(report).read_text())
assert r.get('numRuntimeErrorTestSuites',0)==0 and not r.get('unhandledErrors')and not r.get('errors'),'RUNTIME_OR_UNHANDLED_ERROR'
assert len(r['testResults'])==1 and all(f.get('message')==''for f in r['testResults']),'FILE_SETUP_TEARDOWN_ERROR'
a=[a for f in r['testResults']for a in f['assertionResults']]
# Explicit known setup/teardown/native failures may not count as discriminating assertion-red.
private_text=json.dumps(r)
for forbidden in ['Original test generation teardown failed','Original generation failures:','INDEPENDENT_MEMORY_SCOPE_INVALID','Missing explicit test preparation capacity','Cannot find module','Failed to load url','Unhandled Error','Worker exited unexpectedly','Hook timed out','beforeAll hook','afterAll hook','beforeEach hook','afterEach hook']:
 assert forbidden not in private_text,'INFRASTRUCTURE_OR_CLEANUP_FAILURE_NOT_NEGATIVE_CONTROL'
assert name=='mcp' and int(code)==0 and r['success']is True and r['numFailedTests']==0,'MCP_TEST_FAILURE'
assert len(a)==3 and all(x['status']=='passed'for x in a)and r['numPendingTests']==0,'EXACT_THREE_REAL_CASES_NO_SKIP'
assert {Path(f['name']).name for f in r['testResults']}=={'mcp-client-isolation-real.test.ts'},'EXACT_MCP_FILE'
print(json.dumps({'session':'mcp','selectedAssertions':3,'passed':3,'failed':0,'status':'REAL_COMPOSED_EPHEMERAL_SQLITE_CUSTODY_SHARED_KEY_LOGIC_NOT_PRODUCTION_CREDENTIAL_PERSISTENCE','keyStoreKind':'fresh-exclusive-ephemeral-sqlite','productionCredentialPersistenceVerified':False,'productionStoreCorruptionVerified':False,'fullApplicationBoot':False,'naturalWholeChildExit':True,'builtinBlobUnhandledErrors':0,'blobSha256':hashlib.sha256(Path(blob).read_bytes()).hexdigest(),'reportSha256':hashlib.sha256(Path(report).read_bytes()).hexdigest(),'wholeProductAccepted':False,'usefulLearningAccepted':False}))
