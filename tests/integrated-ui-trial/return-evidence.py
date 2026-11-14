#!/usr/bin/env python3
"""Project test evidence only. Public log transport, NOT privacy by encoding."""
from pathlib import Path
import os,hashlib,tarfile,io,json,re,base64,stat
assert os.geteuid()==0,'ROOT_READER_REQUIRED_FOR_PRIVATE_PHASE_RECEIPTS'
root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui/evidence';assert root.is_dir(),'NO_EVIDENCE_NO_PASS'
# Deliberately not generic file upload. Only this project's receipts, test logs,
# and actual fresh providerOFF UI PNG. No source tree, env, browser HAR/storage,
# authentication payloads, cookies, profile/database or operating transcripts.
allowed={'runtime/browser-checkpoints.json','runtime/runtime-process-counters.json','runtime/runtime-cgroup-counters.json','ui-build/finite-validation.json','ui-build/telemetry-regression.json','ui-build/emitted-bootstrap-inspection.json','dependency-archive-verification.json',*(phase+'/identity-map.json'for phase in ['environment-probe','runtime-prerequisites','ui-build','continuum-regressions','redis-regressions','server-build','runtime']),'host-qualification.log','host-qualification-receipt.json','host-qualification.json','security-preparation.log','security-preparation-receipt.json','security-preparation.json','security-chain/result.json','security-chain/gpgv-status.txt','security-chain/selected-stanza.json','security-chain/loader.txt','security-chain/key-fingerprints.txt','security-chain/ip-identity.json','security-helpers-state.json','environment-probe.log','environment-probe-receipt.json','environment-probe/root-preflight.json','environment-probe/network.json','environment-probe/supervisor.json','environment-probe/complete.log','runtime-prerequisites/root-preflight.json','runtime-prerequisites/network.json','runtime-prerequisites/supervisor.json','runtime-prerequisites/complete.log','environment-probe/qualification.json','runtime-prerequisites/prerequisites.json','runtime-prerequisites/prerequisites-failure.json','runtime-prerequisites.log','runtime-prerequisites-receipt.json','ui-build/root-preflight.json','server-build/root-preflight.json','runtime/root-preflight.json','outer-cleanup.json','npm-config-preflight.log','npm-config-preflight-receipt.json','source-materialization.json','dependency-members.json','result.json','failure.json','dependency-acquisition.log','dependency-acquisition-receipt.json','ui-build.log','server-build.log','runtime.log','ui-build-receipt.json','server-build-receipt.json','runtime-receipt.json','ui-build/complete.log','server-build/complete.log','runtime/complete.log','ui-build/supervisor.json','server-build/supervisor.json','runtime/supervisor.json','ui-build/network.json','server-build/network.json','runtime/network.json','runtime/actual-ui.png','runtime/browser.json','runtime/browser-failure.json','runtime/runtime-result.json','runtime/exit-frontier.json'}
# Private evidence root is exactly the launcher-selected temporary test scope.
# Never follow symlinks in the root ancestry or allowlisted children.
cur=root
while cur!=cur.parent:
 assert not cur.is_symlink(),'EVIDENCE_ROOT_SYMLINK'
 cur=cur.parent
allowed.update({'continuum-regressions/continuum-validation.json',*( 'continuum-regressions/continuum-mode-'+m+'.json' for m in ['constructors','identity-existing','saturated-replay','schema-and-write-failure','power-check','timer-armed','timer-fired','threshold']),*( 'continuum-regressions/'+n for n in ['root-preflight.json','network.json','supervisor.json','complete.log','identity-map.json']),'continuum-regressions.log','continuum-regressions-receipt.json'})
# Fixed only: NEVER redis-mode-*.log or redis complete.log/raw logs.
redisModes=['natural-expiry','pending-terminal','fired-terminal','inflight-terminal','release-reacquire-terminal','multikey-guard','postseal-idempotency','open-survivor','supplement-batch']
allowed.update({'redis-regressions/redis-validation.json',*('redis-regressions/redis-mode-'+m+'.json'for m in redisModes),*('redis-regressions/'+n for n in ['root-preflight.json','network.json','supervisor.json','identity-map.json']),'redis-regressions.log','redis-regressions-receipt.json'})
def bounded_evidence_read(p,cap):
 assert p.is_relative_to(root)
 cur=root
 for part in p.relative_to(root).parts:
  cur=cur/part
  try:st=cur.lstat()
  except FileNotFoundError:return None
  assert not stat.S_ISLNK(st.st_mode),'SYMLINK_IN_ALLOWLISTED_EVIDENCE'
 st=p.lstat();assert stat.S_ISREG(st.st_mode)and st.st_size<=cap,'INVALID_EVIDENCE_TYPE_OR_CAP'
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as stream:
  first=os.fstat(stream.fileno());b=stream.read(cap+1);last=os.fstat(stream.fileno())
 assert len(b)==first.st_size<=cap and(first.st_dev,first.st_ino,first.st_size,first.st_mtime_ns,first.st_ctime_ns)==(last.st_dev,last.st_ino,last.st_size,last.st_mtime_ns,last.st_ctime_ns),'EVIDENCE_CHANGED_DURING_BOUNDED_READ'
 return b
# Secret markers quarantine whole file. No lossy log rewrite or truncation.
secret=re.compile(rb'(?i)(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|nvapi-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:authorization|_authToken|api[_-]?key|password|set-cookie)\s*[:=]\s*["\x27]?(?!null\b|undefined\b|false\b|\$NVIDIA_API_KEY)[A-Za-z0-9+/=_-]{12,}|https?://[^/\s:@]+:[^/\s@]+@)')
# Read exact ephemeral values privately, never include them in any receipt,
# error, hash list or frame. Refuse symlink/mode/length irregularities.
denyValues=[]
for phase in ['runtime-prerequisites','ui-build','continuum-regressions','redis-regressions','server-build','runtime']:
 d=root/phase/'.export-deny-api-token'
 if d.exists():
  assert d.is_file()and not d.is_symlink()and d.stat().st_mode&0o777==0o600,'EXPORT_DENY_FILE_INVALID'
  value=bounded_evidence_read(d,43);assert value is not None and re.fullmatch(rb'[A-Za-z0-9_-]{43}',value),'EXPORT_DENY_VALUE_INVALID'
  denyValues.append(value)
# Catch labeled assignments/headers too, including a value not yet in the deny
# file if setup was interrupted. Matching quarantines the ENTIRE original file.
credentialPattern=re.compile(rb'(?i)(?:SILHOUETTE_API_(?:TOKEN|KEY)\s*[=:]\s*[\"\x27]?[A-Za-z0-9_+/=-]{8,}|(?:authorization|proxy-authorization)\s*[\"\x27]?\s*[:=]\s*[\"\x27]?(?:Bearer|Basic)\s+[A-Za-z0-9_+/=.-]{8,}|(?:x-api-key|x-auth-token)\s*[\"\x27]?\s*[:=]\s*[\"\x27]?[A-Za-z0-9_+/=.-]{8,})')
# Enumerate ONLY fixed allowlisted paths, never recursively traverse private
# app/state/unknown evidence directories, even with privileged read access.
# Capture transport completeness is separate from mandatory diagnostic receipts.
missing=[];invalid=[]
def diagnostic_error(path,kind):
 # Fixed path/category only, never echo possibly secret JSON content/messages.
 invalid.append({'path':path,'reason':kind})
def mandatory_presence(rel):
 try:
  st=(root/rel).lstat()
  assert stat.S_ISREG(st.st_mode),'INVALID_MANDATORY_TYPE'
  return True
 except FileNotFoundError:return False
 except BaseException:
  diagnostic_error(rel,'INVALID_OR_UNREADABLE_MANDATORY_PATH');return True
for phase in ['environment-probe','runtime-prerequisites','ui-build','continuum-regressions','redis-regressions','server-build','runtime']:
 activation=phase+'.log'
 if mandatory_presence(activation):
  if not mandatory_presence(phase+'/identity-map.json'):missing.append(phase+'/identity-map.json')
  name=phase+'/supervisor.json'
  try:
   rawReceipt=bounded_evidence_read(root/name,1024**2)
   if rawReceipt is None:missing.append(name);continue
   receipt=json.loads(rawReceipt)
   assert isinstance(receipt,dict)and 'code'in receipt
   code=receipt['code'];assert code is None or(type(code)is int and -255<=code<=255)
   assert receipt.get('phase')==('preflight'if phase=='environment-probe'else phase)
   assert type(receipt.get('failure'))in {str,type(None)}
   assert type(receipt.get('events'))is list and type(receipt.get('remainingPids'))is list
   assert type(receipt.get('cgroupRemoved'))is bool
   if code is not None and not mandatory_presence(phase+'/complete.log'):missing.append(phase+'/complete.log')
  except BaseException:diagnostic_error(name,'INVALID_UNREADABLE_OR_MALFORMED_SUPERVISOR_RECEIPT')
if mandatory_presence('ui-build/complete.log'):
 if not mandatory_presence('ui-build/finite-validation.json'):missing.append('ui-build/finite-validation.json')
if mandatory_presence('continuum-regressions/complete.log'):
 for name in ['continuum-validation.json',*('continuum-mode-'+m+'.json'for m in ['constructors','identity-existing','saturated-replay','schema-and-write-failure','power-check','timer-armed','timer-fired','threshold'])]:
  if not mandatory_presence('continuum-regressions/'+name):missing.append('continuum-regressions/'+name)
if not mandatory_presence('outer-cleanup.json'):missing.append('outer-cleanup.json')
# Validate precisely the FINAL bounded bytes that can enter the evidence tar.
# No invalid/mutated payload can pass merely because an earlier driver read it.
from importlib.util import spec_from_file_location,module_from_spec
schemaSpec=spec_from_file_location('finite_continuum_schema',Path(__file__).with_name('continuum-receipt-schema.py'))
schema=module_from_spec(schemaSpec);schemaSpec.loader.exec_module(schema)
continuumPrefix='continuum-regressions/'
continuumJson={continuumPrefix+'continuum-validation.json',*(continuumPrefix+'continuum-mode-'+mode+'.json'for mode in schema.MODES)}
validatedContinuum={};invalidContinuum=set();continuumObjects={};continuumModeObjects={}
continuumPresent=mandatory_presence(continuumPrefix+'complete.log')
if continuumPresent:
 for rel in sorted(continuumJson):
  try:
   data=bounded_evidence_read(root/rel,65536)
   if data is None:
    if rel not in missing:missing.append(rel)
    continue
   # Reject duplicate keys and non-finite JSON constants, not last-wins parse.
   def exact_object(pairs):
    result={}
    for key,value in pairs:
     assert key not in result
     result[key]=value
    return result
   value=json.loads(data,object_pairs_hook=exact_object,parse_constant=lambda _value:(_ for _ in ()).throw(ValueError()))
   if rel.endswith('/continuum-validation.json'):continuumObjects[rel]=value
   else:
    mode=rel[len(continuumPrefix+'continuum-mode-'):-5]
    schema.mode_receipt(value,mode);continuumModeObjects[mode]=value
   validatedContinuum[rel]=data
  except BaseException:
   invalidContinuum.add(rel);diagnostic_error(rel,'INVALID_FIXED_CONTINUUM_RECEIPT')
 summaryRel=continuumPrefix+'continuum-validation.json'
 if summaryRel in continuumObjects:
  try:schema.summary_receipt(continuumObjects[summaryRel],continuumModeObjects,[mode for mode in schema.MODES if mode not in continuumModeObjects])
  except BaseException:
   invalidContinuum.add(summaryRel);diagnostic_error(summaryRel,'INVALID_OR_INCOHERENT_CONTINUUM_SUMMARY')
 for rel in invalidContinuum:validatedContinuum.pop(rel,None)
# Final-byte fixed Redis validation, same duplicate/nonfinite rejection as
# continuum. A raw mode log can never substitute for missing finite receipt.
redisSpec=spec_from_file_location('finite_redis_schema',Path(__file__).with_name('redis-receipt-schema.py'))
redisSchema=module_from_spec(redisSpec);redisSpec.loader.exec_module(redisSchema)
redisPrefix='redis-regressions/'
redisJson={redisPrefix+'redis-validation.json',*(redisPrefix+'redis-mode-'+m+'.json'for m in redisSchema.MODES)}
validatedRedis={};invalidRedis=set();redisReceipts={};redisSummary=None
if mandatory_presence('redis-regressions.log'):
 for rel in sorted(redisJson):
  try:
   data=bounded_evidence_read(root/rel,16384)
   if data is None:missing.append(rel);continue
   def redis_object(pairs):
    value={}
    for key,item in pairs:assert key not in value;value[key]=item
    return value
   value=json.loads(data,object_pairs_hook=redis_object,parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
   if rel.endswith('/redis-validation.json'):redisSummary=value
   else:
    mode=rel[len(redisPrefix+'redis-mode-'):-5];redisSchema.mode_receipt(value,mode);redisReceipts[mode]=value
   validatedRedis[rel]=data
  except BaseException:invalidRedis.add(rel);diagnostic_error(rel,'INVALID_FIXED_REDIS_RECEIPT')
 if redisSummary is not None:
  try:redisSchema.summary_receipt(redisSummary,redisReceipts)
  except BaseException:invalidRedis.add(redisPrefix+'redis-validation.json');diagnostic_error(redisPrefix+'redis-validation.json','INVALID_OR_INCOHERENT_REDIS_SUMMARY')
 for rel in invalidRedis:validatedRedis.pop(rel,None)
rows=[];total=0;quarantine=[];buf=io.BytesIO()
with tarfile.open(fileobj=buf,mode='w:gz')as t:
 for rel in sorted(allowed):
  p=root/rel
  try:b=bounded_evidence_read(p,16*1024**2)
  except BaseException:
   diagnostic_error(rel,'INVALID_UNREADABLE_OVERSIZE_OR_MUTATING_ALLOWLISTED_FILE');continue
  if b is None:continue
  if rel in continuumJson:
   if rel in invalidContinuum or rel not in validatedContinuum or b!=validatedContinuum.get(rel):
    diagnostic_error(rel,'INVALID_OR_MUTATED_FIXED_CONTINUUM_RECEIPT')
    quarantine.append({'path':rel,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'reason':'INVALID_FIXED_RECEIPT_QUARANTINE'})
    continue
  if rel in redisJson and (rel in invalidRedis or rel not in validatedRedis or b!=validatedRedis.get(rel)):
   diagnostic_error(rel,'INVALID_OR_MUTATED_FIXED_REDIS_RECEIPT');quarantine.append({'path':rel,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'reason':'INVALID_FIXED_RECEIPT_QUARANTINE'});continue
  if any(value in b for value in denyValues)or(not rel.endswith('.png')and(secret.search(b)or credentialPattern.search(b))):quarantine.append({'path':rel,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'reason':'POSSIBLE_SECRET_QUARANTINE'});continue
  total+=len(b);assert total<=64*1024**2,'RAW_CAPTURE_CAP'
  row={'path':rel,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()};rows.append(row);info=tarfile.TarInfo(rel);info.size=len(b);info.mode=0o600;t.addfile(info,io.BytesIO(b))
 receipt=(json.dumps({'files':rows,'quarantine':quarantine,'completeAllowlistedFiles':not invalid,'diagnosticReceiptsComplete':not(missing or invalid),'missingMandatoryReceipts':missing,'invalidMandatoryDiagnostics':invalid,'publicAudience':'sanitized project test evidence only','status':'FAIL_INVALID_MANDATORY_DIAGNOSTIC'if invalid else('FAIL_MISSING_MANDATORY_RECEIPT'if missing else('FAIL_QUARANTINED_EVIDENCE'if quarantine else'CAPTURED_NOT_PRODUCT_PASS'))},indent=2)+'\n').encode();ti=tarfile.TarInfo('capture.json');ti.size=len(receipt);t.addfile(ti,io.BytesIO(receipt))
raw=buf.getvalue();assert len(raw)<=8*1024**2,'ENCODED_CAPTURE_CAP_NO_TRUNCATION';digest=hashlib.sha256(raw).hexdigest();enc=base64.b64encode(raw).decode();chunks=[enc[i:i+2048]for i in range(0,len(enc),2048)]
print('SILHOUETTE_PUBLIC_TEST_FRAME_BEGIN '+json.dumps({'sha256':digest,'bytes':len(raw),'chunks':len(chunks),'encoding':'base64-tar.gz','quarantined':len(quarantine),'missingMandatoryReceipts':len(missing),'invalidMandatoryDiagnostics':len(invalid)}))
for i,c in enumerate(chunks):print('SILHOUETTE_PUBLIC_TEST_CHUNK '+str(i)+' '+c)
print('SILHOUETTE_PUBLIC_TEST_FRAME_END '+digest)
if quarantine or missing or invalid:raise SystemExit(1)
