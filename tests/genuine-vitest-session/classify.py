#!/usr/bin/env python3
"""Read genuine Vitest JSON and service evidence only. Never imports product or runs tests."""
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
r=json.loads(Path(report).read_text());s=dict(line.split('=',1)for line in Path(service).read_text().splitlines()if '='in line)
assert s['Result']in ('success','exit-code'),'NATURAL_SERVICE_EXIT_REQUIRED'
assert s['ExecMainCode']=='1','NON_EXIT_SIGNAL_OR_TIMEOUT'
assert int(s['ExecMainStatus'])==int(code),'EXIT_STATUS_MISMATCH'
assert s['MemoryMax']=='6442450944'and s['TasksMax']=='256','RESOURCE_POLICY_NOT_EFFECTIVE'
assert s['RestrictAddressFamilies'].split()==['AF_UNIX'],'RUNTIME_ADDRESS_FAMILY_POLICY_MISMATCH'
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
print(json.dumps({'session':name,'selectedAssertions':len(a),'passed':sum(x['status']=='passed'for x in a),'failed':sum(x['status']=='failed'for x in a),'status':'ASSERTIONS_COMPLETED_NOT_PRODUCT_ACCEPTANCE'if name=='candidate'else'DISCRIMINATING_OLD_SOURCE_ASSERTION_FAILURES','naturalServiceExit':True,'builtinBlobUnhandledErrors':0,'blobSha256':hashlib.sha256(Path(blob).read_bytes()).hexdigest(),'reportSha256':hashlib.sha256(Path(report).read_bytes()).hexdigest(),'memoryPeakSampleBytes':int(s['MemoryPeak'])if s.get('MemoryPeak','').isdigit()else None,'wholeProductAccepted':False}))
