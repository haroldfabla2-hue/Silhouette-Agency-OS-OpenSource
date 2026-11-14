"""Factory-specific strict receipt contract and safe physical capture."""
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
 supervisor=json.loads((evidence/'native-factory-stop-supervisor.json').read_text())
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

def validate_files(files):
 require(type(files)is list and 1<=len(files)<=3,'FACTORY_FILE_LIST')
 names=[]
 for row in files:
  require(type(row)is dict and set(row)=={'file','bytes','sha256'},'FACTORY_FILE_KEYS')
  require(type(row['file'])is str and type(row['bytes'])is int and 0<=row['bytes']<=8*1024**2 and type(row['sha256'])is str and re.fullmatch('[0-9a-f]{64}',row['sha256'])is not None,'FACTORY_FILE_FIELDS')
  name=row['file'];names.append(name)
  if name=='account-wal.sqlite':require(row['bytes']>0,'FACTORY_MAIN_EMPTY')
  elif name=='account-wal.sqlite-wal':require(row['bytes']==0 and row['sha256']==hashlib.sha256(b'').hexdigest(),'FACTORY_WAL_NONEMPTY')
  elif name=='account-wal.sqlite-shm':require(row['bytes']==32768,'FACTORY_SHM_SIZE')
  else:require(False,'FACTORY_UNEXPECTED_FILE')
 require(len(names)==len(set(names))and names[0]=='account-wal.sqlite','FACTORY_FILE_UNIQUE_ORDER')

def validate_worker_report(row,manifest):
 required={'schemaVersion','scenario','scope','events','failure','cleanupFailures','assertionsCompleted','imports','tsImports','globalLifecycle','externalImportOwner','outerNaturalExitStillRequired'}
 require(type(row)is dict and set(row)==required,'FACTORY_EXACT_TOP_LEVEL_KEYS')
 require(type(row['schemaVersion'])is int and row['schemaVersion']==1,'FACTORY_SCHEMA')
 require(row['scenario']=='factory-stop'and row['scope']=='PRODUCTION_FACTORY_DB_STOP_ONLY_NO_HTTP_OAUTH_BORROWERS_OR_GLOBAL_CLOSURE','FACTORY_SCOPE')
 require(row['globalLifecycle']=='INCOMPLETE_UNCHANGED'and row['externalImportOwner']=='UNDICI_IMPORT_AGENT_NOT_PRODUCTION_DRAINED'and row['outerNaturalExitStillRequired']is True,'FACTORY_LIMITS')
 failure=row['failure'];require(failure is None or(type(failure)is dict and set(failure)=={'name','code'}and type(failure['name'])is str and(failure['code']is None or type(failure['code'])is str)),'FACTORY_FAILURE_SCHEMA')
 require(type(row['cleanupFailures'])is list and len(row['cleanupFailures'])<=16,'FACTORY_CLEANUP_LIST')
 for error in row['cleanupFailures']:
  require(type(error)is dict and set(error)=={'resource','name','code'}and type(error['resource'])is str and type(error['name'])is str and(error['code']is None or type(error['code'])is str),'FACTORY_CLEANUP_ERROR')
 require(type(row['assertionsCompleted'])is bool and row['assertionsCompleted']is True and failure is None and row['cleanupFailures']==[],'FACTORY_NOT_COMPLETED')
 events=row['events'];require(type(events)is list and len(events)<=32,'FACTORY_EVENT_LIST')
 expected=['factory-worker-start','all-original-frontiers-unseen-not-acquired-claim','undici-import-owner-retained-not-production-drained','production-factory-published-original-db-positive','production-original-storage-stop-joined','finally-original-producers-drained','finally-original-storage-joined','harness-only-same-undici-import-agent-closed','final-scoped-file-proof']
 require([e.get('name')for e in events if type(e)is dict]==expected and len(events)==len(expected),'FACTORY_EVENT_SEQUENCE')
 for event in events:require(type(event.get('atNs'))is str and re.fullmatch('[0-9]{1,24}',event['atNs'])is not None,'FACTORY_EVENT_TIME')
 require(all(int(events[i]['atNs'])<=int(events[i+1]['atNs'])for i in range(len(events)-1)),'FACTORY_EVENT_TIME_ORDER')
 require(events[0].get('node')=='v22.18.0'and events[0].get('abi')=='127'and events[0].get('scope')=='PRODUCTION_FACTORY_DB_ONLY_NO_HTTP_OR_OAUTH'and events[0].get('dispatcherAbsentBefore')is True and events[0].get('tokenKeyAbsent')is True,'FACTORY_NODE_SCOPE')
 require(events[1].get('tokenStoreAvailable')is False,'FACTORY_TOKEN_CUSTODY_UNAVAILABLE')
 agent=events[2];require(agent.get('sameGlobalIdentity')is True and type(agent.get('clients'))is int and agent['clients']==0 and agent.get('cleanupOwner')=='HARNESS_ONLY','FACTORY_AGENT_IMPORT')
 opened=events[3];require(type(opened.get('beforeFdMatches'))is int and 1<=opened['beforeFdMatches']<=256 and opened.get('sameCachedRouter')is True and opened.get('noExtraDatabaseIdentity')is True and type(opened.get('trackedIdentityCount'))is int and 1<=opened['trackedIdentityCount']<=3,'FACTORY_POSITIVE_CONTROL')
 frontier=opened.get('frontier');require(type(frontier)is list and 1<=len(frontier)<=64,'FACTORY_FRONTIER_LIST')
 names=[]
 for slot in frontier:
  require(type(slot)is dict and set(slot)=={'name','phase'}and type(slot['name'])is str,'FACTORY_FRONTIER_SCHEMA');names.append(slot['name'])
  require(slot['phase']==('PUBLISHED'if slot['name']=='provider-account-original-database'else'UNSEEN'),'FACTORY_ONLY_PROVIDER_PUBLISHED')
 require(len(names)==len(set(names))and names.count('provider-account-original-database')==1 and set(names)==set(manifest['expectedFrontierNames']),'FACTORY_EXACT_UNIQUE_FRONTIER')
 stopped=events[4];require(stopped.get('sameCachedRouterAfterStop')is True and stopped.get('newAdmissionRejected')is True,'FACTORY_SEALED_CACHED')
 for event in [stopped,events[8]]:
  require(type(event.get('afterFdMatches'))is int and event['afterFdMatches']==0 and type(event.get('afterMapMatches'))is int and event['afterMapMatches']==0,'FACTORY_NO_FD_MAPS');validate_files(event.get('files'))
 require(stopped['files']==events[8]['files'],'FACTORY_FINAL_FILES_STABLE')
 agent=events[7];require(agent.get('sameGlobalIdentity')is True and agent.get('closed')is True and agent.get('productionDrained')is False and type(agent.get('clientsAfter'))is int and agent['clientsAfter']==0,'FACTORY_AGENT_HARNESS_ONLY_CLOSED')
 allowed={x['path']:x['sha256']for x in manifest['moduleEvaluationAllowlist']}
 imports=row['imports'];require(type(imports)is list and 1<=len(imports)<=300,'FACTORY_IMPORT_LIST');seen=set()
 for item in imports:
  require(type(item)is dict and set(item)=={'path','sha256'}and type(item['path'])is str and type(item['sha256'])is str and item['path']in allowed and item['sha256']==allowed[item['path']]and item['path']not in seen,'FACTORY_IMPORT_BYTES_UNIQUE');seen.add(item['path'])
 require({'node_modules/express/index.js','node_modules/undici/index.js','node_modules/better-sqlite3/build/Release/better_sqlite3.node'}<=seen,'FACTORY_REQUIRED_REAL_IMPORTS')
 expected_ts={x['path']:x['sha256']for x in manifest['typescriptEvaluationClosure']};actual_ts=row['tsImports'];require(type(actual_ts)is list and len(actual_ts)==10,'FACTORY_TS_IMPORT_COUNT');seen_ts={}
 for item in actual_ts:
  require(type(item)is dict and set(item)=={'path','sha256'}and type(item['path'])is str and type(item['sha256'])is str and item['path']not in seen_ts,'FACTORY_TS_IMPORT_SCHEMA');seen_ts[item['path']]=item['sha256']
 require(seen_ts==expected_ts,'FACTORY_TS_EXACT_IMPORTS')
 return events[8]['files']
