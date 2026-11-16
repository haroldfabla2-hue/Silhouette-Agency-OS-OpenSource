# Futurehostprojectiononly. No rawdiagnostic/sourcecode publication.
import pathlib,json,sys,hashlib,re,runpy
infra=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve();safe=out/'safe-ssr';safe.mkdir(exist_ok=True)
S=runpy.run_path(str(infra/'projection-schema.py'))
sha=lambda b:hashlib.sha256(b).hexdigest()
def read(p,cap):
 b=p.read_bytes();assert len(b)<=cap;return json.loads(b)
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
# Constructorconstants are typedabove; all nonconstantleaves come exclusivelyfromschema.project.
scan(result);(safe/'ssr.json').write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
for name,schema in S['MAP_SCHEMAS'].items():
 p=out/'stages/SSR/control'/name
 if not p.exists():assert not complete;continue
 value=S['project'](schema,read(p,16777216));scan(value);(safe/name).write_text(json.dumps(value,sort_keys=True)+'\n')
(safe/'evidence-hashes.json').write_text(json.dumps({p.name:sha(p.read_bytes())for p in safe.iterdir()if p.is_file()},sort_keys=True)+'\n')
assert complete,'SSR_INCOMPLETE_REASON_ONLY_AS_RETAINED_NO_RETRY'
