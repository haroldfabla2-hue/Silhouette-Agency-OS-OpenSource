# Project ONLY schema-checked public fields. Raw receipts/errors never copied to artifact directory.
import pathlib,json,sys,re,hashlib
root=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve();side=sys.argv[3];safe=out/'safe-routing';safe.mkdir(exist_ok=True)
assert side in ['NODE','TSX','VITE_OPTIONAL'];infra=root/'.github/resolver-routing';control=out/'stages'/side/'control'
sha=lambda x:hashlib.sha256(x).hexdigest()
def short(value,allowed):
 assert value in allowed;return value
failurePredicates=['R_PREHASH_FAILED','R_POSTHASH_FAILED','R_CHILD_SPAWN','R_CHILD_FAILED_OR_OUTPUT_CAP','R_CHILD_JSON','R_CHILD_SCHEMA','R_TARGET_POSTHASH']
PREDICATES=['P000_UNCLASSIFIED']+['P'+str(n).zfill(3) for n in range(1,60)]
STAGES=['S'+str(n).zfill(2)+'_'+suffix for n,suffix in enumerate(['INIT','DAEMON','PULL','IMAGE_INSPECT','INPUT_MANIFEST','CREATE','CONFIG_INSPECT','GUARDIAN','START_ATTACH','READY_READ','CANARY_MESSAGE','RUNNING_INSPECT','NAMESPACE_CHECK','GO','DIAGNOSTICS','EXIT_INSPECT','POSTHASH','CLEANUP','DONE'])]
ERRORS=['E_ASSERTION','E_SCHEMA_KEY','E_SCHEMA_TYPE','E_PARSE_VALUE','E_FILE_ABSENT','E_PERMISSION','E_PROCESS_TIMEOUT','E_OS','E_UNEXPECTED']
report={'schema':1,'stage':side,'classification':'INCOMPLETE','runtimeAcceptance':False,'productReadiness':False,'sourceCommit':'825e9050407fe0cd7ce4bcafccccb03e7e0dbd53'}
# Failure path works even when hostpreparation/supervisor did not begin. No arbitrarysource strings escape.
failures=[]
for p in [out/'controller-failure.json',out/(side+'.failure.json'),out/(side+'.cleanup-failure.json')]:
 if p.exists():
  row=json.loads(p.read_text());row=row.get('firstFailure',row)
  failures.append({'stage':short(row['stage'],STAGES),'predicate':short(row['predicate'],PREDICATES),'errorClass':short(row['errorClass'],ERRORS)})
report['controlFailures']=failures
cleanup=out/'outer-cleanup.txt';report['outerCleanupVerified']=cleanup.exists() and cleanup.read_text().strip()=='outer_cleanup_forced=0'
resultPath=out/'routing-result.json';private=out/(side+'.private-receipt.json')
if resultPath.exists():
 data=json.loads(resultPath.read_text());report['inputsUnchanged']=data.get('inputsUnchanged') is True
 run=data.get('run')
 if run:
  assert run['side']==side
  report['container']={k:run[k] for k in ['canaryPassed','resolverStarted','controllerComplete','exit','memoryEventDelta','containerRemoved','forcedCleanup','elapsedSeconds']}
  assert all(type(run[k]) is bool for k in ['canaryPassed','resolverStarted','controllerComplete','containerRemoved','forcedCleanup'])
  assert type(run['exit']) is int and run['exit'] in [0,125]
  assert set(run['memoryEventDelta'])<=set(['low','high','max','oom','oom_kill','oom_group_kill','sock_throttled']) and all(type(v) is int and 0<=v<1000000 for v in run['memoryEventDelta'].values())
  assert isinstance(run['elapsedSeconds'],(float,int)) and 0<=run['elapsedSeconds']<400
if private.exists():
 assert private.stat().st_size<=131072
 receipt=json.loads(private.read_text())
 if receipt.get('status')=='INCOMPLETE':
  assert receipt['stage']==side
  report['supervisorFailure']=short(receipt['failurePredicate'],failurePredicates)
  report['childFailureCode']=short(receipt['childFailureCode'],json.loads((infra/'failure-enums.json').read_text())['childPredicates'])
 else:
  assert receipt['status']=='ROUTING_ASSERTIONS_MATCHED' and receipt['mode']==side
  for key in ['productModuleEvaluated','targetDependencyModuleEvaluated','buildExecuted','lifecycleAccepted','runtimeBehaviorAccepted']:assert receipt[key] is False
  cases=json.loads((infra/'fixtures/cases.json').read_text());assert len(receipt['rows'])==len(cases)==12
  rows=[]
  for expected,row in zip(cases,receipt['rows']):
   assert all(row[k]==expected[k] for k in ['id','parent','specifier'])
   item={k:expected[k] for k in ['id','parent','specifier']};item['route']=short(row['route'],['VITE_SSR_LOCAL_ID_ONLY','PRODUCT_ROLLUP_EXTERNAL_THEN_NODE_IMPORT','ACTUAL_REGISTERED_TSX_ESM_RESOLVE','NODE_IMPORT_META_RESOLVE'])
   for direction in ['import','require']:
    if direction not in row:assert expected.get('local') and direction=='require';continue
    value=row[direction]
    if 'error' in value:item[direction]={'error':short(value['error'],['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_PACKAGE_PATH_NOT_EXPORTED'])};continue
    target=expected.get('requireTarget') if direction=='require' else expected.get('tsxTarget') if side!='NODE' and expected.get('tsxTarget') else expected.get('importTarget')
    if expected.get('missing'):target='services/does-not-exist-resolver-probe.js'
    assert value['relative']==target and '..' not in pathlib.PurePosixPath(target).parts
    assert value['url']=='file:///source/'+target and type(value['exists']) is bool
    observed={'target':target,'regularFileExists':value['exists']}
    if value['exists']:assert re.fullmatch('[a-f0-9]{64}',value['sha256']);observed['sha256']=value['sha256']
    item[direction]=observed
   rows.append(item)
  report['routing']=rows
  # Validate both ledgers against fixed knowncontrol source expectations, never a self-declared expected array.
  controlRules=['RAW_FD_READ','UNAPPROVED_READ','UNAPPROVED_READ','NON_STRING_PATH','INVALID_FILE_URL','READ_REALPATH_UNREADABLE','COMPILE_CONTENT_MISMATCH']
  syntheticRules=['MODULE_NOT_ALLOWLISTED','MODULE_NOT_ALLOWLISTED','MODULE_NOT_ALLOWLISTED','NON_FILE_PROTOCOL','NATIVE_NOT_ALLOWLISTED','SOURCE_CODE_READ']
  ledger=receipt['loadBoundary'];assert ledger['beforeControls']['violationCount']==0 and ledger['beforeControls']['events']==[]
  main=ledger['afterControls'];assert main['violationCount']==13 and [e['rule'] for e in main['events']]==controlRules+syntheticRules
  worker=receipt['asyncLoaderBoundary']
  if side=='TSX':assert worker['controlsMatched'] is True and worker['violations']['violationCount']==7 and [e['rule'] for e in worker['violations']['events']]==controlRules
  else:assert worker is None
  allowed=json.loads((control/'allowed-loads.json').read_text());loadLists=[receipt['allowedLoadsObserved']]+([worker['loads']] if worker else [])
  observedLoads=[]
  for loads in loadLists:
   assert len(loads)<=512
   for load in loads:
    assert load['path'] in allowed['files'] and load['sha256']==allowed['files'][load['path']] and type(load['native']) is bool
    assert not load['native'] or side=='VITE_OPTIONAL' and load['path'] in allowed['nativeFiles']
    observedLoads.append({'file':load['path'].removeprefix('/tooling/').removeprefix('/control/'),'sha256':load['sha256'],'native':load['native']})
  report['loadBoundary']={'mainExpectedControlEvents':13,'workerExpectedControlEvents':7 if worker else 0,'unexpectedViolationAccepted':False,'loadReceipts':observedLoads,'scope':'PINNED_TOOLING_ENTRYPOINT_GUARDS_NOT_UNIVERSAL_MALICIOUS_JS_CONTAINMENT'}
  ident=receipt['inputIdentities'];plan=json.loads((out/'host-plan.json').read_text());assert ident['manifestSha256']==plan['stages'][side]['identitiesSha256'] and ident['preHash']==ident['postHash'] and ident['fullExactViewPrePostVerified'] is True
  hashed={}
  assert set(ident['preHash'])=={'/source','/tooling','/control','/denied'}
  for key,value in ident['preHash'].items():
   assert type(value['files']) is int and 0<=value['files']<=100000 and re.fullmatch('[a-f0-9]{64}',value['digest'])
   hashed[key.removeprefix('/')]=dict(files=value['files'],sha256=value['digest'])
  report['identities']={'manifestSha256':ident['manifestSha256'],'views':hashed,'qdrantAttribution':'SAME_EXACT_7_FILE_CANDIDATE_OVERLAY_NOT_PRISTINE_BASELINE'}
  if report.get('inputsUnchanged') and report['outerCleanupVerified'] and not failures and report.get('container',{}).get('exit')==0 and all(report['container'][k] for k in ['canaryPassed','resolverStarted','controllerComplete']) and not any(report['container']['memoryEventDelta'].get(k,0) for k in ['max','oom','oom_kill','oom_group_kill']) and report['container']['containerRemoved'] and not report['container']['forcedCleanup']:report['classification']='LIMITED_ROUTING_EVIDENCE_COMPLETE'
# No raw receipt, exception, stderr, env, transcript, or hostdirectory may become an artifact.
text=json.dumps(report,indent=2)+'\n'
patterns=[r'gh[pousr]_[A-Za-z0-9_]{20,}',r'github_pat_[A-Za-z0-9_]{20,}',r'sk-[A-Za-z0-9_-]{20,}',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'AKIA[0-9A-Z]{16}',r'https?://[^\s/:]+:[^\s/@]+@',r'wamid\.',r'agent-01[A-Z0-9]{16,}',r'chat-01[A-Z0-9]{16,}',r'/home/',r'/downloads/',r'/runner/',r'/tmp/']
assert not any(re.search(p,text) for p in patterns)
(safe/(side+'.json')).write_text(text)
if report['classification']!='LIMITED_ROUTING_EVIDENCE_COMPLETE':raise SystemExit(2)
