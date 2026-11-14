"""Manager-specific strict receipt contract and safe physical capture."""
from pathlib import Path
import json,re,hashlib,stat
def require(condition,code):
 if not condition:raise AssertionError("NATIVE_CONTRACT:"+code)

def capture_safe_native_files(root,evidence,safe,worker_entered,emit):
 # Call BEFORE classifying worker JSON, and again in outerfinally on exceptions.
 # Unsafe/missingreceipt never authorizes source reads or deletion.
 root=Path(root);evidence=Path(evidence)
 if not worker_entered:return {'state':'NOT_STARTED','captured':False}
 require(safe is True,'CAPTURE_NAMESPACE_UNSAFE')
 supervisor=json.loads((evidence/'native-manager-start-seal-supervisor.json').read_text())
 require(supervisor['cleanupSafe']is True and supervisor['chainReaped']is True and supervisor['isolationValidated']is True and supervisor['cause']is None and supervisor['survivors']==[] and supervisor['namespaceGroupLive']is False,'CAPTURE_SAFE_SUPERVISOR')
 require((root/'native-data').is_dir()and not(root/'native-data').is_symlink(),'CAPTURE_DATA_DIRECTORY')
 receipts=[]
 for suffix in ['', '-wal','-shm']:
  source=root/'native-data'/('account-wal.sqlite'+suffix)
  if not source.exists():
   require(not source.is_symlink(),'CAPTURE_DANGLING_SYMLINK');continue
  st=source.lstat();require(stat.S_ISREG(st.st_mode)and not source.is_symlink()and st.st_size<=8*1024**2,'CAPTURE_FILE_SHAPE')
  raw=source.read_bytes();require(len(raw)==st.st_size,'CAPTURE_FILE_CHANGED')
  destination=evidence/('native-account-wal.sqlite'+suffix)
  if destination.exists():require(not destination.is_symlink()and destination.read_bytes()==raw,'CAPTURE_REPEATED_BYTES_CHANGED')
  else:
   with destination.open('xb')as out:out.write(raw)
  receipts.append({'file':destination.name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
 emit('native-physical-capture.json',{'state':'SAFE_REAPED_BYTES_NOT_YET_FUNCTIONAL_ACCEPTANCE','files':receipts,'missingMainFile':not any(x['file']=='native-account-wal.sqlite'for x in receipts),'preservesPossibleWALSHMWithoutCallingThemClosed':True})
 return {'state':'SAFE_CAPTURE_COMPLETE','captured':True,'files':receipts}


def validate_worker_report(row,manifest):
 required={'schemaVersion','scenario','scope','events','failure','cleanupFailures','assertionsCompleted','imports','tsImports','globalLifecycle','externalImportOwner','outerNaturalExitStillRequired'}
 require(type(row)is dict and set(row)==required,'MANAGER_EXACT_TOP_LEVEL_KEYS')
 require(type(row['schemaVersion'])is int and row['schemaVersion']==1,'MANAGER_SCHEMA')
 require(row['scenario']=='manager-start-seal'and row['scope']=='REAL_ADMITTED_MANAGER_OAUTH_START_SEAL_NO_REQUEST_VENDOR_TOKEN_OR_GLOBAL_CLOSURE','MANAGER_SCOPE')
 require(row['globalLifecycle']=='INCOMPLETE_UNCHANGED'and row['externalImportOwner']=='UNDICI_IMPORT_AGENT_NOT_PRODUCTION_DRAINED'and row['outerNaturalExitStillRequired']is True,'MANAGER_LIMITS')
 failure=row['failure'];allowed_names={'Error','AssertionError','OAuthCallbackError','ConnectionError','AggregateError','TypeError','TokenKeyMissing','UNCLASSIFIED_ERROR','UNVERIFIED_MANAGER_DRAIN'};allowed_codes={None,'runtime-unavailable','EADDRNOTAVAIL','EADDRINUSE','EACCES','ERR_SERVER_NOT_RUNNING','ECONNREFUSED'}
 def error(value,cleanup=False):
  require(type(value)is dict and set(value)==({'resource','name','code'}if cleanup else{'name','code'}),'MANAGER_ERROR_FIELDS')
  require(type(value['name'])is str and value['name']in allowed_names and(value['code']is None or type(value['code'])is str)and value['code']in allowed_codes,'MANAGER_ERROR_WHITELIST')
  if cleanup:require(type(value['resource'])is str,'MANAGER_ERROR_RESOURCE')
 if failure is not None:error(failure)
 require(type(row['cleanupFailures'])is list and len(row['cleanupFailures'])<=16,'MANAGER_CLEANUP_LIST')
 for item in row['cleanupFailures']:error(item,True)
 require(type(row['assertionsCompleted'])is bool and row['assertionsCompleted']is True and failure is None and row['cleanupFailures']==[],'MANAGER_NOT_COMPLETED')
 events=row['events'];require(type(events)is list and len(events)==12,'MANAGER_EVENT_COUNT')
 for event in events:
  require(type(event)is dict and type(event.get('name'))is str and type(event.get('atNs'))is str and re.fullmatch('[0-9]{1,24}',event['atNs'])is not None,'MANAGER_EVENT_SHAPE')
 require(all(int(events[i]['atNs'])<=int(events[i+1]['atNs'])for i in range(len(events)-1)),'MANAGER_EVENT_TIME_ORDER')
 names=[e['name']for e in events];expected=['manager-worker-start','real-manager-store-and-empty-ephemeral-custody','actual-start-admitted-before-seal','original-manager-sealed-before-await-start','same-admitted-start-late-waiter-published-after-seal','same-original-code-task-rejected','same-original-native-close-callback-settled','same-manager-drain-joined-before-database-close','same-original-database-closed-only-after-drain','finally-original-manager-drain-joined','harness-only-same-undici-import-agent-closed','final-scoped-file-proof']
 require(len(set(names))==len(names)and set(names)==set(expected),'MANAGER_EVENT_NAMES')
 # Code rejection and native close callback are independent microtask/nextTick
 # outcomes. Both MUST precede drain, neither is used as proxy for the other.
 require(names[:5]==expected[:5]and set(names[5:7])==set(expected[5:7])and names[7:]==expected[7:],'MANAGER_EVENT_PARTIAL_ORDER')
 fields=[
  {'node','abi','tokenKeyAbsent','dispatcherAbsentBefore','externalAgentCleanup'},
  {'nativeOpen','constructorEnvOnly','processKeyStillAbsent','tokenDirectoryEmpty'},
  {'sameStartRetained','physicalRetainedBeforeStartReturn','pendingBeforeSeal','dbStillOpen'},
  {'sameDrainPromise','dbStillOpen'},
  {'port','samePhysicalPromise','sameCodePromise','dbStillOpen'},
  {'dbStillOpen','cancelled','errorName','errorCode'},
  {'dbStillOpen'},
  {'nativeOpen','accounts','tokenFiles','activeOriginals','physicalOriginals'},
  {'beforeFdMatches','nativeOpen','operationsRejected','afterFdMatches','afterMapMatches','postSealStartRejectedBeforeAllocation','files'},
  set(),
  {'sameGlobalIdentity','closed','clientsAfter','productionDrained'},
  {'files','afterFdMatches','afterMapMatches'}]
 ev={e['name']:e for e in events}
 for event_name,facts in zip(expected,fields):require(set(ev[event_name])=={'name','atNs'}|facts,'MANAGER_EXACT_EVENT_FIELDS')
 start=ev[expected[0]];require(start.get('node')=='v22.18.0'and start.get('abi')=='127'and start.get('tokenKeyAbsent')is True and start.get('dispatcherAbsentBefore')is True and start.get('externalAgentCleanup')=='HARNESS_ONLY','MANAGER_START_FACTS')
 store=ev[expected[1]];require(all(store.get(k)is True for k in ['nativeOpen','constructorEnvOnly','processKeyStillAbsent','tokenDirectoryEmpty']),'MANAGER_REAL_CUSTODY')
 admitted=ev[expected[2]];require(all(admitted.get(k)is True for k in ['sameStartRetained','physicalRetainedBeforeStartReturn','dbStillOpen'])and type(admitted.get('pendingBeforeSeal'))is int and admitted['pendingBeforeSeal']==0,'MANAGER_ADMITTED_ORIGINAL')
 sealed=ev[expected[3]];require(sealed.get('sameDrainPromise')is True and sealed.get('dbStillOpen')is True,'MANAGER_SEAL_BEFORE_AWAIT')
 published=ev[expected[4]];require(type(published.get('port'))is int and 1<=published['port']<=65535 and all(published.get(k)is True for k in ['samePhysicalPromise','sameCodePromise','dbStillOpen']),'MANAGER_LATE_PUBLISHED')
 code=ev[expected[5]];require(code.get('dbStillOpen')is True and code.get('cancelled')is True and code.get('errorName')in ['Error','OAuthCallbackError']and code.get('errorCode')is None,'MANAGER_GENUINE_CANCELLED_CODE')
 require(ev[expected[6]].get('dbStillOpen')is True,'MANAGER_PHYSICAL_BEFORE_DB_CLOSE')
 joined=ev[expected[7]];require(joined.get('nativeOpen')is True and all(type(joined.get(k))is int and joined[k]==0 for k in ['accounts','tokenFiles','activeOriginals','physicalOriginals']),'MANAGER_DRAIN_BEFORE_DB_CLOSE')
 closed=ev[expected[8]];require(type(closed.get('beforeFdMatches'))is int and 1<=closed['beforeFdMatches']<=256 and closed.get('nativeOpen')is False and closed.get('operationsRejected')is True and closed.get('postSealStartRejectedBeforeAllocation')is True,'MANAGER_DB_CLOSE')
 # Reuse pure file-shape predicates, not the accepted factory event schema.
 from factory_worker_contract import validate_files
 for item in [closed,ev[expected[11]]]:
  require(type(item.get('afterFdMatches'))is int and item['afterFdMatches']==0 and type(item.get('afterMapMatches'))is int and item['afterMapMatches']==0,'MANAGER_NO_SCOPED_FD_MAPS');validate_files(item.get('files'))
 require(closed['files']==ev[expected[11]]['files'],'MANAGER_FINAL_FILE_STABILITY')
 agent=ev[expected[10]];require(agent.get('sameGlobalIdentity')is True and agent.get('closed')is True and type(agent.get('clientsAfter'))is int and agent['clientsAfter']==0 and agent.get('productionDrained')is False,'MANAGER_AGENT_HARNESS_ONLY')
 allowed={x['path']:x['sha256']for x in manifest['moduleEvaluationAllowlist']};imports=row['imports'];require(type(imports)is list and 1<=len(imports)<=300,'MANAGER_IMPORT_LIST');seen=set()
 for item in imports:
  require(type(item)is dict and set(item)=={'path','sha256'}and type(item['path'])is str and type(item['sha256'])is str and item['path']in allowed and item['sha256']==allowed[item['path']]and item['path']not in seen,'MANAGER_IMPORT_BYTES_UNIQUE');seen.add(item['path'])
 require({'node_modules/undici/index.js','node_modules/better-sqlite3/build/Release/better_sqlite3.node'}<=seen and not any(x.startswith('node_modules/express/')for x in seen),'MANAGER_REAL_IMPORTS_NO_FACTORY_HTTP')
 # Keep the full approved10TS source pins; evaluate ONLY the8 needed for this
 # actual manager scenario. Do not import factory/bindings just to reach10.
 expected_ts={x['path']:x['sha256']for x in manifest['typescriptEvaluationClosure']if x['path']not in ['server/routes/connections.ts','services/lifecycle/runtimeStopBindings.ts']};actual_ts=row['tsImports'];require(type(actual_ts)is list and len(actual_ts)==8,'MANAGER_TS_IMPORT_COUNT');seen_ts={}
 for item in actual_ts:
  require(type(item)is dict and set(item)=={'path','sha256'}and type(item['path'])is str and type(item['sha256'])is str and item['path']not in seen_ts,'MANAGER_TS_IMPORT_SCHEMA');seen_ts[item['path']]=item['sha256']
 require(seen_ts==expected_ts,'MANAGER_TS_EXACT_IMPORTS')
 return ev[expected[11]]['files']
