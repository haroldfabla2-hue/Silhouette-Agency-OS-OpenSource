"""Emit only public-safe source diagnostics and fixed-label control results."""
import pathlib,sys,json,re,shutil
out=pathlib.Path(sys.argv[1]);safe=out/'safe-diagnostics';safe.mkdir(parents=True,exist_ok=True)
path=out/'docker-result.json'
if not path.exists():raise SystemExit('No complete container comparison result; preflight/control failure, no retry')
result=json.loads(path.read_text());raw=[];files=[]
for side in ['baseline','candidate']:
 for suffix in ['stdout','stderr']:
  p=out/(side+'.'+suffix)
  if p.exists():
   if p.stat().st_size>16777216:raise SystemExit('Output cap exceeded; diagnostics held')
   raw.append(p.read_text(errors='replace'));files.append(p)
text=''.join(raw)
patterns=[r'gh[pousr]_[A-Za-z0-9_]{20,}',r'github_pat_[A-Za-z0-9_]{20,}',r'sk-[A-Za-z0-9_-]{20,}',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'AKIA[0-9A-Z]{16}',r'https?://[^\s/:]+:[^\s/@]+@',r'wamid\.',r'agent-01[A-Z0-9]{16,}',r'chat-01[A-Z0-9]{16,}']
if any(re.search(pattern,text) for pattern in patterns):raise SystemExit('Potential sensitive diagnostics; all raw output held')
# Only controller's fixed-key, source-derived public-safe result schema is eligible.
allowed=['side','classification','canaryPassed','compilerStarted','controllerComplete','exit','memoryEventDelta','diagnosticBytes','containerRemoved','forcedCleanup','elapsedSeconds']
runs=[]
for side in ['baseline','candidate']:
 p=out/(side+'.result.json')
 if p.exists():runs.append({k:v for k,v in json.loads(p.read_text()).items() if k in allowed})
cleanup=safe/'cleanup.txt'
outerClean=cleanup.exists() and cleanup.read_text().strip()=='outer_cleanup_forced=0'
summary={'outerCleanupVerified':outerClean,'runs':runs,'inputsUnchanged':result.get('inputsUnchanged',False),'classification':result.get('classification','INCOMPLETE'),'productReadiness':False}
for p in files:shutil.copyfile(p,safe/p.name)
(safe/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
if not outerClean or summary['classification']!='COMPILER_COMPARISON_COMPLETED' or len(runs)!=2:raise SystemExit('INCOMPLETE comparison; no semantic pass')
if any(row.get('exit')!=0 for row in runs):raise SystemExit('Completed diagnostics contain compiler errors; no semantic pass')
print('Compiler commands completed with zero errors; independent evidence review still required, not product readiness.')
