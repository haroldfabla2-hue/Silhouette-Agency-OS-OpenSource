"""Emit only public-safe source diagnostics and fixed-label control results."""
import pathlib,sys,json,re,shutil
out=pathlib.Path(sys.argv[1]);safe=out/'safe-diagnostics';safe.mkdir(parents=True,exist_ok=True)
# Failure receipts have a closed public schema. Never copy raw exception messages/paths.
failures=[]
for candidate in [out/'controller-failure.json']+[out/(side+suffix) for side in ['baseline','candidate'] for suffix in ['.failure.json','.cleanup-failure.json']]:
 if not candidate.exists():continue
 row=json.loads(candidate.read_text());row=row if candidate.name.endswith('.cleanup-failure.json') else row.get('firstFailure',row);filtered={'origin':'CLEANUP' if candidate.name.endswith('.cleanup-failure.json') else 'FIRST_FAILURE'}
 for key,allowedValues in [('stage', ['S00_INIT', 'S01_DAEMON', 'S02_PULL', 'S03_IMAGE_INSPECT', 'S04_INPUT_MANIFEST', 'S05_CREATE', 'S06_CONFIG_INSPECT', 'S07_GUARDIAN', 'S08_START_ATTACH', 'S09_READY_READ', 'S10_CANARY_MESSAGE', 'S11_RUNNING_INSPECT', 'S12_NAMESPACE_CHECK', 'S13_GO', 'S14_DIAGNOSTICS', 'S15_EXIT_INSPECT', 'S16_POSTHASH', 'S17_CLEANUP', 'S18_DONE']), ('predicate', ['P000_UNCLASSIFIED', 'P001', 'P002', 'P003', 'P004', 'P005', 'P006', 'P007', 'P008', 'P009', 'P010', 'P011', 'P012', 'P013', 'P014', 'P015', 'P016', 'P017', 'P018', 'P019', 'P020', 'P021', 'P022', 'P023', 'P024', 'P025', 'P026', 'P027', 'P028', 'P029', 'P030', 'P031', 'P032', 'P033', 'P034', 'P035', 'P036', 'P037', 'P038', 'P039', 'P040', 'P041', 'P042', 'P043', 'P044', 'P045', 'P046', 'P047', 'P048', 'P049', 'P050', 'P051', 'P052', 'P053', 'P054']), ('errorClass', ['E_ASSERTION', 'E_SCHEMA_KEY', 'E_SCHEMA_TYPE', 'E_PARSE_VALUE', 'E_FILE_ABSENT', 'E_PERMISSION', 'E_PROCESS_TIMEOUT', 'E_OS', 'E_UNEXPECTED']), ('schemaKey', ['ALL', 'Architecture', 'CapAdd', 'CapDrop', 'CgroupVersion', 'CgroupnsMode', 'Cmd', 'Config', 'Destination', 'Devices', 'Entrypoint', 'Error', 'ExitCode', 'GITHUB_RUN_ID', 'Healthcheck', 'HostConfig', 'IpcMode', 'LogConfig', 'MemTotal', 'Memory', 'MemorySwap', 'Mounts', 'NONE', 'Name', 'NanoCpus', 'NetworkMode', 'OOMKilled', 'OSType', 'Os', 'Pid', 'PidMode', 'PidsLimit', 'PortBindings', 'Privileged', 'Propagation', 'RW', 'ReadonlyRootfs', 'RepoDigests', 'RestartPolicy', 'Running', 'SecurityOpt', 'SecurityOptions', 'Size', 'Source', 'State', 'Tmpfs', 'Type', 'UTSMode', 'User', 'VolumesFrom', 'canary', 'canaryPassed', 'cgroup', 'checks', 'classification', 'cleanupFailure', 'code', 'compilerAdmitted', 'compilerStarted', 'containerRemoved', 'data', 'exit', 'failure', 'guardianFailure', 'memory.events', 'memoryEvents', 'namespaces', 'overflow', 'signal', 'K_UNCLASSIFIED'])]:
  value=row.get(key,'')
  if value not in allowedValues:raise SystemExit('Invalid failure enum; output held')
  filtered[key]=value
 if type(row.get('compilerAdmitted')) is not bool:raise SystemExit('Invalid admission enum; output held')
 filtered['compilerAdmitted']=row['compilerAdmitted']
 failures.append(filtered)
if failures:(safe/'failure-enums.json').write_text(json.dumps({'classification':'INCOMPLETE','failures':failures},indent=2)+'\n')
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
 if p.exists():
  source=json.loads(p.read_text());entry={k:v for k,v in source.items() if k in allowed}
  guest=source.get('guestFailure')
  if guest and guest.get('guestGuard') in ['G000_UNCLASSIFIED', 'G001', 'G002', 'G003', 'G004', 'G005', 'G006', 'G007', 'G008', 'G009', 'G010', 'G011', 'G012', 'G013', 'G014', 'G015', 'G016', 'G017', 'G018', 'G019', 'G020', 'G030', 'G031', 'G032', 'G033', 'G034', 'G035', 'G036', 'G037', 'G038', 'G039', 'G040', 'G041', 'G042', 'G043', 'G044', 'G045', 'G046', 'G047', 'G048'] and guest.get('errorClass') in ['G_SCHEMA_TYPE','G_PARSE','G_ASSERT_OR_OS','G_OS','G_UNKNOWN']:entry['guestFailure']={k:guest[k] for k in ['guestGuard','errorClass']}
  runs.append(entry)
cleanup=safe/'cleanup.txt'
outerClean=cleanup.exists() and cleanup.read_text().strip()=='outer_cleanup_forced=0'
summary={'outerCleanupVerified':outerClean,'runs':runs,'inputsUnchanged':result.get('inputsUnchanged',False),'classification':result.get('classification','INCOMPLETE'),'productReadiness':False}
for p in files:shutil.copyfile(p,safe/p.name)
(safe/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
if not outerClean or summary['classification']!='COMPILER_COMPARISON_COMPLETED' or len(runs)!=2:raise SystemExit('INCOMPLETE comparison; no semantic pass')
if any(row.get('exit')!=0 for row in runs):raise SystemExit('Completed diagnostics contain compiler errors; no semantic pass')
print('Compiler commands completed with zero errors; independent evidence review still required, not product readiness.')
