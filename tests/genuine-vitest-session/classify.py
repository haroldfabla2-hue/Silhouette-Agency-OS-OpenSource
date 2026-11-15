#!/usr/bin/env python3
"""Read genuine Vitest JSON and root-owned actual direct-child evidence only. Never imports product or runs tests."""
from pathlib import Path
import json,sys,re,hashlib
name,report,blob,service,code=sys.argv[1:]
assert name in ('typecheck','regressions','mechanisms'),'UNKNOWN_VALIDATION_SELECTION'
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
r=json.loads(Path(report).read_text())
assert r.get('numRuntimeErrorTestSuites',0)==0 and not r.get('unhandledErrors')and not r.get('errors'),'RUNTIME_OR_UNHANDLED_ERROR'
assert len(r['testResults'])==(5 if name=='mechanisms'else 1) and all(f.get('message')==''for f in r['testResults']),'FILE_SETUP_TEARDOWN_ERROR'
a=[a for f in r['testResults']for a in f['assertionResults']if a['status']not in ('skipped','pending','todo')]
# Explicit known setup/teardown/native failures may not count as discriminating assertion-red.
private_text=json.dumps(r)
for forbidden in ['Original test generation teardown failed','Original generation failures:','INDEPENDENT_MEMORY_SCOPE_INVALID','Missing explicit test preparation capacity','Cannot find module','Failed to load url','Unhandled Error','Worker exited unexpectedly','Hook timed out','beforeAll hook','afterAll hook','beforeEach hook','afterEach hook']:
 assert forbidden not in private_text,'INFRASTRUCTURE_OR_CLEANUP_FAILURE_NOT_NEGATIVE_CONTROL'
if name in ('regressions','mechanisms'):
 assert int(code)==0 and r['success']is True and r['numFailedTests']==0 and all(x['status']=='passed'for x in a),'CANDIDATE_TEST_FAILURE'
 if name=='regressions':
  assert any('journal rejection does not publish'in x['fullName']for x in a),'STATE_CASES_NOT_COLLECTED'
  assert any('transition admission payload ownership'in x['fullName']for x in a),'ADMISSION_CASES_NOT_COLLECTED'
  assert len(a)==5,'EXACT_FIVE_GENUINE_CASES_REQUIRED'
 else:
  assert len(a)==7,'EXACT_SEVEN_AUTHORED_MECHANISM_ASSERTIONS_REQUIRED'
  expected={'product-learning-proposal-real.test.ts':1,'selfdev-preservation.test.ts':1,'independent-verifier-receipt-contract.test.ts':3,'learning-analysis-input.test.ts':1,'learning-status-copy.test.ts':1}
  assert {Path(f['name']).name:len(f['assertionResults'])for f in r['testResults']}==expected,'WRONG_AUTHORED_MECHANISM_SELECTION'

print(json.dumps({'session':name,'selectedAssertions':len(a),'passed':sum(x['status']=='passed'for x in a),'failed':sum(x['status']=='failed'for x in a),'status':'FIVE_REAL_REGRESSIONS_ONLY'if name=='regressions'else'AUTHORED_MECHANISMS_NOT_GENERATED_USEFUL_REPAIR','naturalWholeChildExit':True,'builtinBlobUnhandledErrors':0,'blobSha256':hashlib.sha256(Path(blob).read_bytes()).hexdigest(),'reportSha256':hashlib.sha256(Path(report).read_bytes()).hexdigest(),'wholeProductAccepted':False,'usefulLearningAccepted':False}))
