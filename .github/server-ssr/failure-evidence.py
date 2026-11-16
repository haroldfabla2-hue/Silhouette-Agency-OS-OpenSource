# Independent fixed-enum observability. No projection-schema import/raw receipt/error text.
import pathlib,sys,json,re,hashlib
transport=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve();safe=out/'safe-ssr';safe.mkdir(exist_ok=True)
STAGES={'S00_INIT','S01_DAEMON','S02_PULL','S03_IMAGE_INSPECT','S04_INPUT_MANIFEST','S05_CREATE','S06_CONFIG_INSPECT','S07_GUARDIAN','S08_START_ATTACH','S09_READY_READ','S10_CANARY_MESSAGE','S11_RUNNING_INSPECT','S12_NAMESPACE_CHECK','S13_GO','S14_DIAGNOSTICS','S15_EXIT_INSPECT','S16_POSTHASH','S17_CLEANUP','S18_DONE'}
ERRORS={'E_ASSERTION','E_SCHEMA_KEY','E_SCHEMA_TYPE','E_PARSE_VALUE','E_FILE_ABSENT','E_PERMISSION','E_PROCESS_TIMEOUT','E_OS','E_UNEXPECTED','E_NONE'}
# Exact documentedcontrollerpredicates P001..P059 plusunclassified. No source/error strings copied.
PREDICATES={'P000_UNCLASSIFIED'}|{'P%03d'%n for n in range(1,60)}
def failure(v):
 assert type(v)is dict
 assert v.get('stage')in STAGES and v.get('predicate')in PREDICATES and v.get('errorClass')in ERRORS and v.get('classification')=='INCOMPLETE'
 assert type(v.get('schemaKey'))is str
 # Schema-key names are intentionally reduced to generic presence; no unknown-string relay.
 r={'classification':'INCOMPLETE','stage':v['stage'],'predicate':v['predicate'],'errorClass':v['errorClass'],'schemaKeyPresent':v['schemaKey']!='K_UNCLASSIFIED'}
 if 'buildAdmitted'in v:assert type(v['buildAdmitted'])is bool;r['buildAdmitted']=v['buildAdmitted']
 return r
def bounded(p,cap=65536):
 assert not p.is_symlink()and p.is_file()and p.stat().st_size<=cap
 with p.open('rb')as stream:b=stream.read(cap+1)
 assert len(b)<=cap;return json.loads(b)
receipts=[];unavailable=[]
for name in ['controller-failure.json','SSR.failure.json','SSR.cleanup-failure.json']:
 p=out/name
 if not p.exists():continue
 try:
  value=bounded(p);r=failure(value)
  if 'firstFailure'in value:r['firstFailure']=failure(value['firstFailure'])
  receipts.append({'source':name,'receipt':r})
 except Exception:unavailable.append({'source':name,'reason':'ENUM_OR_SCHEMA_UNAVAILABLE'})
# The host's driver-progressbooleans are context, not an assertionactualbuildexecuted.
context={};p=out/'SSR.result.json'
if p.exists():
 try:
  value=bounded(p)
  for key in ['canaryPassed','buildStarted','controllerComplete','containerRemoved','forcedCleanup','guardianFailure']:
   if key in value:assert type(value[key])is bool;context[key]=value[key]
  if 'exit'in value:assert type(value['exit'])is int and value['exit']in [0,125];context['exit']=value['exit']
 except Exception:context={'classification':'CONTEXT_UNAVAILABLE'}
cleanup='UNAVAILABLE';p=out/'outer-cleanup.txt'
if p.exists():
 value=p.read_text()[:128].strip()
 cleanup={'outer_cleanup_forced=0':'NAMED_CONTAINER_ABSENT_AT_OUTER_CHECK','outer_cleanup_forced=1':'OUTER_FORCED_CLEANUP','outer_cleanup_unverifiable':'UNVERIFIABLE'}.get(value,'UNAVAILABLE')
# Never attest a primary positive unless its entire fixed file set/index validates.
PRIMARY={'ssr.json','identities.json','source-hashes.json','public-assets.json','boundary-plan.json','evidence-hashes.json'}
primaryState='NO_COMPLETE_PRIMARY_PROJECTION'
try:
 names={p.name for p in safe.iterdir()if p.name not in ['controller-enums.json','observability-hashes.json']}
 if names:
  assert names<=PRIMARY and 'ssr.json'in names and 'evidence-hashes.json'in names
  index=bounded(safe/'evidence-hashes.json');assert type(index)is dict and set(index)==names-{'evidence-hashes.json'}
  for name,digest in index.items():
   assert name in PRIMARY and type(digest)is str and re.fullmatch('[a-f0-9]{64}',digest)
   p=safe/name;assert p.is_file()and not p.is_symlink()and p.stat().st_size<=16777216
   assert hashlib.sha256(p.read_bytes()).hexdigest()==digest
  terminal=bounded(safe/'ssr.json',131072);assert type(terminal)is dict
  if terminal.get('classification')=='LIMITED_SSR_ARTIFACT_EVIDENCE_COMPLETE':assert names==PRIMARY
  else:assert terminal.get('classification')=='INCOMPLETE'
  primaryState='PRIMARY_FULL_INDEX_VERIFIED'
except Exception:
 # Discard unfinished primary publication, never relabel its unverified positive body.
 for name in PRIMARY:
  p=safe/name
  if p.exists():assert p.is_file()and not p.is_symlink();p.unlink()
 primaryState='PARTIAL_PRIMARY_DISCARDED'
result={'schema':1,'classification':'OBSERVABILITY_ONLY_NOT_BUILD_ACCEPTANCE','controllerFailures':receipts,'unavailable':unavailable,'hostProgressOnly':context,'outerCleanup':cleanup,'noSSRArtifactOrRuntimeAcceptance':True,'primaryProjection':primaryState,'reason': 'FIXED_ENUMS_RETAINED'if receipts else'CONTROLLER_REASON_UNAVAILABLE'}
# Outputconstructedonlyfromfixedenumsets,boundedbooleans,exitintegersandfixedfilenames.
(safe/'controller-enums.json').write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
# Independentlyattest currentevidencefiles without relying on primaryemitter completion.
files={}
for p in safe.iterdir():
 assert p.is_file()and not p.is_symlink()
 if p.name=='observability-hashes.json':continue
 assert p.name in ['ssr.json','identities.json','source-hashes.json','public-assets.json','boundary-plan.json','evidence-hashes.json','controller-enums.json']
 files[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
(safe/'observability-hashes.json').write_text(json.dumps(files,sort_keys=True)+'\n')
