"""Emit only public-safe source diagnostics and fixed-label control results."""
import pathlib,sys,json,re,shutil
out=pathlib.Path(sys.argv[1]);safe=out/'safe-diagnostics';safe.mkdir(parents=True,exist_ok=True)
# Failure receipts have a closed public schema. Never copy raw exception messages/paths.
failures=[]
for candidate in [out/'controller-failure.json']+[out/(side+suffix) for side in ['baseline','candidate','candidate-aligned'] for suffix in ['.failure.json','.cleanup-failure.json']]:
 if not candidate.exists():continue
 row=json.loads(candidate.read_text());row=row if candidate.name.endswith('.cleanup-failure.json') else row.get('firstFailure',row);filtered={'origin':'CLEANUP' if candidate.name.endswith('.cleanup-failure.json') else 'FIRST_FAILURE'}
 for key,allowedValues in [('stage', ['S00_INIT', 'S01_DAEMON', 'S02_PULL', 'S03_IMAGE_INSPECT', 'S04_INPUT_MANIFEST', 'S05_CREATE', 'S06_CONFIG_INSPECT', 'S07_GUARDIAN', 'S08_START_ATTACH', 'S09_READY_READ', 'S10_CANARY_MESSAGE', 'S11_RUNNING_INSPECT', 'S12_NAMESPACE_CHECK', 'S13_GO', 'S14_DIAGNOSTICS', 'S15_EXIT_INSPECT', 'S16_POSTHASH', 'S17_CLEANUP', 'S18_DONE']), ('predicate', ['P000_UNCLASSIFIED', 'P001', 'P002', 'P003', 'P004', 'P005', 'P006', 'P007', 'P008', 'P009', 'P010', 'P011', 'P012', 'P013', 'P014', 'P015', 'P016', 'P017', 'P018', 'P019', 'P020', 'P021', 'P022', 'P023', 'P024', 'P025', 'P026', 'P027', 'P028', 'P029', 'P030', 'P031', 'P032', 'P033', 'P034', 'P035', 'P036', 'P037', 'P038', 'P039', 'P040', 'P041', 'P042', 'P043', 'P044', 'P045', 'P046', 'P047', 'P048', 'P049', 'P050', 'P051', 'P052', 'P053', 'P054', 'P055', 'P056', 'P057', 'P058', 'P059']), ('errorClass', ['E_ASSERTION', 'E_SCHEMA_KEY', 'E_SCHEMA_TYPE', 'E_PARSE_VALUE', 'E_FILE_ABSENT', 'E_PERMISSION', 'E_PROCESS_TIMEOUT', 'E_OS', 'E_UNEXPECTED']), ('schemaKey', ['ALL', 'Architecture', 'CapAdd', 'CapDrop', 'CgroupVersion', 'CgroupnsMode', 'Cmd', 'Config', 'Destination', 'Devices', 'Entrypoint', 'Error', 'ExitCode', 'GITHUB_RUN_ID', 'Healthcheck', 'HostConfig', 'IpcMode', 'LogConfig', 'MemTotal', 'Memory', 'MemorySwap', 'Mounts', 'NONE', 'Name', 'NanoCpus', 'NetworkMode', 'OOMKilled', 'OSType', 'Os', 'Pid', 'PidMode', 'PidsLimit', 'PortBindings', 'Privileged', 'Propagation', 'RW', 'ReadonlyRootfs', 'RepoDigests', 'RestartPolicy', 'Running', 'SecurityOpt', 'SecurityOptions', 'Size', 'Source', 'State', 'Tmpfs', 'Type', 'UTSMode', 'User', 'VolumesFrom', 'canary', 'canaryPassed', 'cgroup', 'checks', 'classification', 'cleanupFailure', 'code', 'compilerAdmitted', 'compilerStarted', 'containerRemoved', 'data', 'exit', 'failure', 'guardianFailure', 'memory.events', 'memoryEvents', 'namespaces', 'overflow', 'signal', 'K_UNCLASSIFIED'])]:
  value=row.get(key,'')
  if value not in allowedValues:raise SystemExit('Invalid failure enum; output held')
  filtered[key]=value
 if type(row.get('compilerAdmitted')) is not bool:raise SystemExit('Invalid admission enum; output held')
 filtered['compilerAdmitted']=row['compilerAdmitted']
 failures.append(filtered)
if failures:(safe/'failure-enums.json').write_text(json.dumps({'classification':'INCOMPLETE','failures':failures},indent=2)+'\n')
COMPILER_STAGES=['C00_INIT', 'C01_PLAN', 'C02_PARSE', 'C03_PROGRAM', 'C04_DIAGNOSTICS', 'C05_GRAPH', 'C06_SERIALIZE']
COMPILER_PREDICATES=['C_COMPILER_HASH', 'C_COMPILER_VERSION', 'C_CONFIG_HASH', 'C_CONFIG_PARSE', 'C_CONTRACT', 'C_DIAGNOSTIC_CAP', 'C_EDGE_CAP', 'C_EMIT_FORBIDDEN', 'C_EXPORT_TARGET_CAP', 'C_FILE_CAP', 'C_MANIFEST_CAP', 'C_MODULE_INVARIANT', 'C_OPTION_INVARIANTS', 'C_PACKAGE_BYTES', 'C_PACKAGE_CAP', 'C_PACKAGE_METADATA_CAP', 'C_PATH_OUTSIDE_INPUTS', 'C_PINNED_CACHE_ENUMERATION', 'C_RESOLVER_CONTRACT', 'C_SPECIFIER_CAP', 'C_UNEXPECTED']
for side in ['baseline','candidate','candidate-aligned']:
 evidence=out/(side+'.evidence-failure.json')
 if evidence.exists():
  row=json.loads(evidence.read_text())
  if row.get('stage') not in COMPILER_STAGES or row.get('predicate') not in COMPILER_PREDICATES or row.get('errorClass') not in ['E_PARSE','E_TYPE','E_ABSENT','E_OS','E_EVIDENCE'] or row.get('classification')!='INCOMPLETE' or row.get('graphComplete') is not False:raise SystemExit('Invalid compiler failure enum; output held')
  (safe/evidence.name).write_text(json.dumps({key:row[key] for key in ['stage','predicate','errorClass','classification','graphComplete']},sort_keys=True)+'\n')
path=out/'docker-result.json'
if not path.exists():raise SystemExit('No complete container comparison result; preflight/control failure, no retry')
result=json.loads(path.read_text());raw=[];files=[];graphs={}
for side in ['baseline','candidate','candidate-aligned']:
 for suffix in ['stdout','stderr','manifest']:
  p=out/(side+'.'+suffix)
  if p.exists():
   if p.stat().st_size>16777216:raise SystemExit('Output cap exceeded; diagnostics held')
   raw.append(p.read_text(errors='replace'));files.append(p)
# Check graph schema/path allowlist before any publication; raw traces are never exported.
for p in files:
 if p.suffix!='.manifest':continue
 graph=json.loads(p.read_text());graphs[p.stem]=graph
 if graph.get('schema')!=1 or graph.get('graphComplete') is not True or graph.get('runtimeResolutionExecuted') is not False or graph.get('runtimeCorrespondence')!='REVIEW_REQUIRED_NOT_INFERRED_FROM_TYPES':raise SystemExit('Invalid compiler graph; output held')
 if graph.get('contract') not in ['BASELINE_HISTORICAL','CANDIDATE_LEGACY','CANDIDATE_ALIGNED']:raise SystemExit('Invalid compiler contract; output held')
 if len(graph.get('files',[]))>20000 or len(graph.get('edges',[]))>100000 or len(graph.get('packages',[]))>5000 or p.stat().st_size>8388608:raise SystemExit('Compiler graph cap; output held')
 def graphpath(value):return isinstance(value,str) and (value.startswith('source/') or value.startswith('compiler/')) and '..' not in pathlib.PurePosixPath(value).parts and '\\' not in value
 if not all(graphpath(row['path']) and re.fullmatch(r'[0-9a-f]{64}',row['sha256']) for row in graph['files']+graph['packages']):raise SystemExit('Compiler graph path/hash; output held')
 if not all(graphpath(row['from']) and (row['to'] is None or graphpath(row['to'])) and row['kind'] in ['MODULE','TYPE_REFERENCE','AUTOMATIC_TYPE_REFERENCE'] and row['mode'] in ['DEFAULT','IMPORT','REQUIRE','OTHER'] for row in graph['edges']):raise SystemExit('Compiler graph edge; output held')
# This comparison is observational. Changed exports/conditions still require independent review.
if all(side in graphs for side in ['baseline','candidate','candidate-aligned']):
 old=graphs['candidate'];new=graphs['candidate-aligned']
 if old['rootFiles']!=new['rootFiles']:raise SystemExit('Candidate root-set changed; output held')
 def sourceident(g):return {x['path']:x['sha256'] for x in g['files'] if x['path'].startswith('source/') and not x['path'].startswith('source/node_modules/')}
 # Reachability may change but shared source bytes may not.
 a=sourceident(old);b=sourceident(new)
 if any(a[key]!=b[key] for key in a.keys()&b.keys()):raise SystemExit('Candidate source bytes changed; output held')
 def edgeindex(g):
  result={}
  for row in g['edges']:
   key=json.dumps([row['kind'],row['from'],row['specifier'],row['mode']])
   if key in result and result[key]!=row:raise SystemExit('Ambiguous graph edge; output held')
   result[key]=row
  return result
 left=edgeindex(old);right=edgeindex(new)
 delta={'schema':1,'classification':'OBSERVED_RESOLVER_DELTA_REQUIRES_REVIEW','sameCandidateSourceSharedFilesVerified':True,'underlyingInputIdentitiesVerified':result.get('inputsUnchanged',False),'oldContract':old['contract'],'newContract':new['contract'],'effectiveOptions':{'legacy':old['options'],'aligned':new['options']},'counts':{side:{'files':len(g['files']),'edges':len(g['edges']),'packages':len(g['packages']),'diagnostics':g['diagnosticCount']} for side,g in graphs.items()},'edgesRemoved':[left[k] for k in sorted(left.keys()-right.keys())],'edgesAdded':[right[k] for k in sorted(right.keys()-left.keys())],'edgesChanged':[{'before':left[k],'after':right[k]} for k in sorted(left.keys()&right.keys()) if left[k]!=right[k]],'runtimeCorrespondenceVerified':False,'publicExportsReviewRequired':True,'strictFullSdkValidation':False}
 deltaBytes=json.dumps(delta,sort_keys=True)+'\n'
 if len(deltaBytes.encode())>8388608:raise SystemExit('Delta cap exceeded; output held')
 # Defer write until source/private-value scan passes along with raw graph bytes.
 raw.append(deltaBytes)
else:deltaBytes=None
text=''.join(raw)
patterns=[r'gh[pousr]_[A-Za-z0-9_]{20,}',r'github_pat_[A-Za-z0-9_]{20,}',r'sk-[A-Za-z0-9_-]{20,}',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'AKIA[0-9A-Z]{16}',r'https?://[^\s/:]+:[^\s/@]+@',r'wamid\.',r'agent-01[A-Z0-9]{16,}',r'chat-01[A-Z0-9]{16,}']
if any(re.search(pattern,text) for pattern in patterns):raise SystemExit('Potential sensitive diagnostics; all raw output held')
# Only controller's fixed-key, source-derived public-safe result schema is eligible.
allowed=['side','classification','canaryPassed','compilerStarted','controllerComplete','exit','memoryEventDelta','diagnosticBytes','containerRemoved','forcedCleanup','elapsedSeconds']
runs=[]
for side in ['baseline','candidate','candidate-aligned']:
 p=out/(side+'.result.json')
 if p.exists():
  source=json.loads(p.read_text());entry={k:v for k,v in source.items() if k in allowed}
  guest=source.get('guestFailure')
  if guest and guest.get('guestGuard') in ['G000_UNCLASSIFIED', 'G001', 'G002', 'G003', 'G004', 'G005', 'G006', 'G007', 'G008', 'G009', 'G010', 'G011', 'G012', 'G013', 'G014', 'G015', 'G016', 'G017', 'G018', 'G019', 'G020', 'G030', 'G031', 'G032', 'G033', 'G034', 'G035', 'G036', 'G037', 'G038', 'G039', 'G040', 'G041', 'G042', 'G043', 'G044', 'G045', 'G046', 'G047', 'G048'] and guest.get('errorClass') in ['G_SCHEMA_TYPE','G_PARSE','G_ASSERT_OR_OS','G_OS','G_UNKNOWN']:entry['guestFailure']={k:guest[k] for k in ['guestGuard','errorClass']}
  runs.append(entry)
cleanup=safe/'cleanup.txt'
outerClean=cleanup.exists() and cleanup.read_text().strip()=='outer_cleanup_forced=0'
summary={'outerCleanupVerified':outerClean,'runs':runs,'inputsUnchanged':result.get('inputsUnchanged',False),'classification':result.get('classification','INCOMPLETE'),'productReadiness':False,'historicalResultRewritten':False,'checkerImplementation':'PINNED_COMPILER_API_NOT_HISTORICAL_CLI','resolverAlignmentAccepted':False,'strictFullSdkValidation':False}
for p in files:shutil.copyfile(p,safe/p.name)
if deltaBytes is not None:(safe/'resolver-delta.json').write_text(deltaBytes)
(safe/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
if not outerClean or summary['classification']!='COMPILER_COMPARISON_COMPLETED' or len(runs)!=3:raise SystemExit('INCOMPLETE comparison; no semantic pass')
if any(row.get('exit')!=0 for row in runs):raise SystemExit('Completed diagnostics contain compiler errors; no semantic pass')
print('Compiler commands completed with zero errors; independent evidence review still required, not product readiness.')
