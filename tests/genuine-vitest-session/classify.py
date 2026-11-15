#!/usr/bin/env python3
"""Read genuine Vitest JSON and root-owned actual direct-child evidence only. Never imports product or runs tests."""
from pathlib import Path
import json,sys,re,hashlib
name,report,blob,service,code=sys.argv[1:]
# Built-in JSON does not expose all unhandled errors in 4.1.12. Its own built-in
# blob reporter serializes [version, files, unhandledErrors, coverage, time, modules].
# Read only the two top-level flatted references needed here; no product/library imports.
pool=json.loads(Path(blob).read_text());top=pool[0]
assert isinstance(top,list)and len(top)==6,'UNKNOWN_BUILTIN_BLOB_SCHEMA'
def reference(value):
 assert isinstance(value,str)and value.isdigit(),'UNKNOWN_FLATTED_REFERENCE'
 return pool[int(value)]
assert reference(top[0])=='4.1.12','WRONG_GENUINE_VITEST_VERSION'
assert reference(top[2])==[],'GENUINE_VITEST_UNHANDLED_ERRORS'
r=json.loads(Path(report).read_text());s=json.loads(Path(service).read_text())
assert s['schema']==1 and s['phase']==name and s['natural'] is True,'NATURAL_WHOLE_CHILD_REQUIRED'
assert s['forced'] is False and s['residualUidProcesses']==0,'FORCED_OR_RESIDUAL_CHILD'
assert s['rawReturnCode']==int(code),'ACTUAL_EXIT_MISMATCH'
assert s['aggregateMemoryMax']==10737418240 and s['swapMax']==0 and s['aggregateTasksMax']==384 and s['cpuCount']==2,'AGGREGATE_BOUNDS_NOT_VERIFIED'
assert s['boundary']=='DIRECT_CHILD_BWRAP_AF_UNIX_VERIFIED','ACTUAL_NAMESPACE_ADMISSION_REQUIRED'
assert all(s['oomAfter'].get(k,0)==s['oomBefore'].get(k,0)for k in ('oom','oom_kill','oom_group_kill')),'OOM_INVALIDATES_ACCEPTANCE'
assert r.get('numRuntimeErrorTestSuites',0)==0 and not r.get('unhandledErrors')and not r.get('errors'),'RUNTIME_OR_UNHANDLED_ERROR'
assert len(r['testResults'])==1 and all(f.get('message')==''for f in r['testResults']),'FILE_SETUP_TEARDOWN_ERROR'
a=[a for f in r['testResults']for a in f['assertionResults']if a['status']not in ('skipped','pending','todo')]
# Explicit known setup/teardown/native failures may not count as discriminating assertion-red.
private_text=json.dumps(r)
for forbidden in ['Original test generation teardown failed','Original generation failures:','INDEPENDENT_MEMORY_SCOPE_INVALID','Missing explicit test preparation capacity','Cannot find module','Failed to load url','Unhandled Error','Worker exited unexpectedly','Hook timed out','beforeAll hook','afterAll hook','beforeEach hook','afterEach hook']:
 assert forbidden not in private_text,'INFRASTRUCTURE_OR_CLEANUP_FAILURE_NOT_NEGATIVE_CONTROL'
if name=='candidate':
 assert int(code)==0 and r['success']is True and r['numFailedTests']==0 and all(x['status']=='passed'for x in a),'CANDIDATE_TEST_FAILURE'
 assert any('journal rejection does not publish'in x['fullName']for x in a),'STATE_CASES_NOT_COLLECTED'
 assert any('transition admission payload ownership'in x['fullName']for x in a),'ADMISSION_CASES_NOT_COLLECTED'
 assert len(a)==5,'EXACT_FIVE_GENUINE_CASES_REQUIRED'
else:
 expected=3 if name=='baseline-admission'else 2
 assert int(code)==1 and r['success']is False and len(a)==expected and r['numFailedTests']==expected,'EXPECTED_EXACT_NEGATIVE_CASES_NOT_OBSERVED'
 assert all(x['status']=='failed'and len(x.get('failureMessages',[]))==1for x in a),'NO_DISCRIMINATING_ASSERTION_FAILURE'
 allowed=('captures typed payload','owns Float32Array','rejects mutation of an admitted')if name=='baseline-admission'else('keeps PENDING when destination','keeps VERIFIED when COMMITTED')
 assert all(any(t in x['fullName']for t in allowed)for x in a),'WRONG_BASELINE_TEST_SELECTION'
 signatures=(
  [('captures typed payload',104,r'expected.*not to be'),('owns Float32Array',125,r'instance of ArrayBuffer'),('rejects mutation of an admitted',136,r'promise resolved')]
  if name=='baseline-admission'else
  [('keeps PENDING when destination',161,r'WRITTEN[\s\S]*PENDING|PENDING[\s\S]*WRITTEN'),('keeps VERIFIED when COMMITTED',187,r'COMMITTED[\s\S]*VERIFIED|VERIFIED[\s\S]*COMMITTED')]
 )
 for assertion in a:
  label,line,pattern=next(sig for sig in signatures if sig[0]in assertion['fullName'])
  message='\n'.join(assertion['failureMessages'])
  assert re.search(r'memory-transitions-p0\.test\.ts:'+str(line)+r'(?::|\b)',message),'WRONG_ASSERTION_LOCATION'
  assert re.search(pattern,message,re.I|re.S),'WRONG_DISCRIMINATING_FAILURE_SHAPE' 
print(json.dumps({'session':name,'selectedAssertions':len(a),'passed':sum(x['status']=='passed'for x in a),'failed':sum(x['status']=='failed'for x in a),'status':'ASSERTIONS_COMPLETED_NOT_PRODUCT_ACCEPTANCE'if name=='candidate'else'DISCRIMINATING_OLD_SOURCE_ASSERTION_FAILURES','naturalWholeChildExit':True,'builtinBlobUnhandledErrors':0,'blobSha256':hashlib.sha256(Path(blob).read_bytes()).hexdigest(),'reportSha256':hashlib.sha256(Path(report).read_bytes()).hexdigest(),'memoryPeakSampleBytes':None,'wholeProductAccepted':False}))
