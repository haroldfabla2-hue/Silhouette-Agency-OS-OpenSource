#!/usr/bin/env python3
"""Private raw log -> exact-schema fixed evidence only. No raw/hash export."""
import os,stat,json,sys,importlib.util
from pathlib import Path
schemaSpec=importlib.util.spec_from_file_location('runtime_finite_schema',Path(__file__).with_name('runtime-finite-schema.py'));schema=importlib.util.module_from_spec(schemaSpec);schemaSpec.loader.exec_module(schema)
root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui/evidence'
# Root phase logs remain private. No generic path argument or traversal.
def read(rel,cap):
 p=root/rel;cur=root
 for part in Path(rel).parts:
  cur/=part
  if not cur.exists():return None
  assert not cur.is_symlink()
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  before=os.fstat(f.fileno());assert stat.S_ISREG(before.st_mode)and before.st_size<=cap
  data=f.read(cap+1);after=os.fstat(f.fileno())
 assert len(data)==before.st_size<=cap and(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)
 return data
raw=read('runtime/complete.log',16*1024**2);outer=read('runtime.log',16*1024**2)
result={'version':1,'rawRuntimeLogs':{'withheld':True,'reason':'CREDENTIALLED_FIXTURE_PRIVATE_RAW_LOGS','runtimeCompletePresent':raw is not None,'runtimeOuterPresent':outer is not None},'snapshots':[],'events':[],'resourceCounts':[],'markerOrder':[],'lifecycleEvidence':'MISSING_OR_INCOMPLETE','identityBoundary':[],'identityEvidence':'MISSING_OR_INCOMPLETE','global':'INCOMPLETE'}
try:
 for line in(raw or b'').splitlines():
  if line.startswith(b'[IDENTITY_BOUNDARY] '):
   assert len(line)<=2048 and len(result['identityBoundary'])<258
   result['identityBoundary'].append(schema.strict_loads(line[len(b'[IDENTITY_BOUNDARY] '):]));continue
  for prefix,key,validator,cap in [(b'[RUNTIME_FINITE_SNAPSHOT] ','snapshots',schema.snapshot,32),(b'[RUNTIME_FINITE_EVENT] ','events',lambda x:(schema.keys(x,{'kind'}),schema.enum(x['kind'],schema.EVENTS)),128),(b'[DRAIN_RESOURCE_COUNTS] ','resourceCounts',schema.resource,2)]:
   if line.startswith(prefix):
    assert len(line)<=65536 and len(result[key])<cap
    value=schema.strict_loads(line[len(prefix):]);validator(value);result[key].append(value);result['markerOrder'].append({'group':key,'index':len(result[key])-1})
 if schema.completeness(result):result['lifecycleEvidence']='OBSERVED_NOT_GLOBAL_PASS'
 result['identitySummary']=schema.identity_summary(result['identityBoundary'])
 if schema.identity_complete(result['identityBoundary']):result['identityEvidence']='OBSERVED_NOT_AUTH_PROOF'
 schema.validate(result)
 # This receipt's own path must be absent, regular fresh creation only.
 p=root/'runtime/runtime-finite.json';fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write((json.dumps(result,indent=2)+'\n').encode())
except BaseException:
 # Never echo malformed JSON, private raw data, exception strings or hashes.
 print('FIXED_RUNTIME_EVIDENCE_INVALID',file=sys.stderr);raise SystemExit(1)
