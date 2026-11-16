# Futurehostprojectiononly. No rawdiagnostic/sourcecode publication.
import pathlib,json,sys,hashlib,re,runpy,shutil,tempfile,os
transport=pathlib.Path(sys.argv[1]).resolve();infra=transport/'.github/server-ssr';out=pathlib.Path(sys.argv[2]).resolve();safe=out/'safe-ssr'
# Remove stale prior publication before even schema bootstrap. No positive partial survives failure.
if safe.exists():
 assert safe.is_dir()and not safe.is_symlink();shutil.rmtree(safe)
staging=pathlib.Path(tempfile.mkdtemp(prefix='projection-private-',dir=out))
S=runpy.run_path(str(infra/'projection-schema.py'))
sha=lambda b:hashlib.sha256(b).hexdigest()
def read(p,cap):
 assert p.is_file()and not p.is_symlink()and p.stat().st_size<=cap
 with p.open('rb')as stream:b=stream.read(cap+1)
 assert len(b)<=cap;return json.loads(b)
def scan(v):
 data=json.dumps(v,sort_keys=True)
 for pattern in [r'-----BEGIN [A-Z ]*PRIVATE KEY',r'gh[pousr]_[A-Za-z0-9]{20,}',r'github_pat_[A-Za-z0-9_]+',r'sk-[A-Za-z0-9_-]{20,}',r'AIza[0-9A-Za-z_-]{30,}',r'(?i)(bearer\s+|password\s*[:=]\s*|api[_-]?key\s*[:=]\s*)[^\s"\\]{8,}',r'/home/runner/',r'/github/workspace/',r'(?i)authorization:']:
  assert not re.search(pattern,data),'SENSITIVE_SCAN_FAILED'
 return v
raw=read(out/'SSR.private-receipt.json',131072)if(out/'SSR.private-receipt.json').exists()else{'schema':1,'stage':'SSR','status':'INCOMPLETE','failurePredicate':'NO_CHILD_RECEIPT','runtimeAcceptance':False}
controller=read(out/'ssr-result.json',131072)if(out/'ssr-result.json').exists()else{'classification':'INCOMPLETE'}
cleanup=(out/'outer-cleanup.txt').read_text().strip()if(out/'outer-cleanup.txt').exists()else'outer_cleanup_unverifiable'
assert cleanup in ['outer_cleanup_forced=0','outer_cleanup_forced=1','outer_cleanup_unverifiable']
projected=S['receipt'](raw);c=S['controller'](controller)
complete=c['classification']=='SSR_ARTIFACT_COMMAND_COMPLETED'and c['inputsUnchanged']and cleanup=='outer_cleanup_forced=0'and projected['status']=='SSR_BUILD_RETURNED'
result={'schema':1,'classification':'LIMITED_SSR_ARTIFACT_EVIDENCE_COMPLETE'if complete else'INCOMPLETE','experiment':projected,'controller':c,'outerCleanup':cleanup,'noRuntimeOrTypeAcceptance':True}
# All validation/scans/serialization/hashes complete in PRIVATE staging first.
try:
 projectedFiles={}
 for name,schema in S['MAP_SCHEMAS'].items():
  p=out/'stages/SSR/control'/name
  if not p.exists():assert not complete;continue
  value=S['project'](schema,read(p,16777216));scan(value)
  projectedFiles[name]=(json.dumps(value,sort_keys=True)+'\n').encode()
 scan(result);projectedFiles['ssr.json']=(json.dumps(result,sort_keys=True,indent=2)+'\n').encode()
 hashes={name:sha(data)for name,data in projectedFiles.items()}
 projectedFiles['evidence-hashes.json']=(json.dumps(hashes,sort_keys=True)+'\n').encode()
 for name,data in projectedFiles.items():(staging/name).write_bytes(data)
 assert set(p.name for p in staging.iterdir())==set(projectedFiles)
 for name,data in projectedFiles.items():assert (staging/name).read_bytes()==data
 # One same-filesystem directory rename publishes only fully checked evidence.
 os.replace(staging,safe)
except BaseException:
 if staging.exists():shutil.rmtree(staging)
 if safe.exists():shutil.rmtree(safe)
 raise
assert complete,'SSR_INCOMPLETE_REASON_ONLY_AS_RETAINED_NO_RETRY'
