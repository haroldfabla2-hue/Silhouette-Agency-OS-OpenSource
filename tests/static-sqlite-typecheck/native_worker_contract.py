"""Pure JSON contract and safe post-reap byte capture. No native import."""
from pathlib import Path
import json,re,hashlib,stat
REQUIRED={'schemaVersion','scenario','scope','events','failure','cleanupFailures','assertionsCompleted','globalLifecycle','outerNaturalExitStillRequired'}
SCOPE='REAL_ACCOUNTSTORE_SQLITE_WAL_ONLY_NO_SOCKET_OAUTH_VENDOR_OR_FULL_RUNTIME'
def require(condition,code):
 if not condition:raise AssertionError('NATIVE_CONTRACT:'+code)
def validate_closed_proof(event):
 require(event.get('nativeOpen')is False,'CLOSED_NATIVE_OPEN')
 proof=event.get('proof')
 require(type(proof)is dict and set(proof)=={'beforeFdMatches','afterFdMatches','afterMapMatches','trackedIdentityCount','operationsRejected','files'},'CLOSED_PROOF_SCHEMA')
 require(type(proof['beforeFdMatches'])is int and 1<=proof['beforeFdMatches']<=256,'CLOSED_POSITIVE_FD_CONTROL')
 require(type(proof['afterFdMatches'])is int and proof['afterFdMatches']==0 and type(proof['afterMapMatches'])is int and proof['afterMapMatches']==0,'CLOSED_NO_FD_MAPS')
 require(type(proof['trackedIdentityCount'])is int and 1<=proof['trackedIdentityCount']<=6 and proof['operationsRejected']is True,'CLOSED_IDENTITY_OPERATION')
 files=proof['files'];require(type(files)is list and 1<=len(files)<=3,'CLOSED_FILES_SCHEMA')
 names=[]
 for row in files:
  require(type(row)is dict and set(row)=={'file','bytes','sha256'},'CLOSED_FILE_KEYS')
  require(type(row['file'])is str,'CLOSED_FILE_NAME_TYPE')
  require(type(row['bytes'])is int and 0<=row['bytes']<=8*1024**2 and type(row['sha256'])is str and re.fullmatch('[0-9a-f]{64}',row['sha256'])is not None,'CLOSED_FILE_SHAPE')
  names.append(row['file'])
  if row['file']=='account-wal.sqlite':require(row['bytes']>0,'CLOSED_MAIN_EMPTY')
  elif row['file']=='account-wal.sqlite-wal':require(row['bytes']==0 and row['sha256']==hashlib.sha256(b'').hexdigest(),'CLOSED_WAL_MUST_BE_EMPTY')
  elif row['file']=='account-wal.sqlite-shm':require(row['bytes']==32768,'CLOSED_SHM_SHAPE')
  else:require(False,'CLOSED_FILE_UNEXPECTED')
 require(len(names)==len(set(names))and names[0]=='account-wal.sqlite','CLOSED_FILE_NAMES')
 return files

def validate_worker_report(row):
 require(type(row)is dict and set(row)==REQUIRED,'EXACT_TOP_LEVEL_KEYS')
 require(type(row['schemaVersion'])is int and row['schemaVersion']==2,'SCHEMA_VERSION')
 require(row['scenario']=='account-wal'and row['scope']==SCOPE,'SCOPE')
 require(row['globalLifecycle']=='INCOMPLETE_UNCHANGED'and row['outerNaturalExitStillRequired']is True,'SCOPE_LIMITS')
 require(type(row['assertionsCompleted'])is bool,'ASSERTIONS_TYPE')
 failure=row['failure']
 require(failure is None or(type(failure)is dict and set(failure)=={'name','code'}and type(failure['name'])is str and(failure['code']is None or type(failure['code'])is str)),'FAILURE_SCHEMA')
 require(type(row['cleanupFailures'])is list and len(row['cleanupFailures'])<=16,'CLEANUP_SCHEMA')
 for error in row['cleanupFailures']:
  require(type(error)is dict and set(error)=={'resource','name','code'}and type(error['resource'])is str and type(error['name'])is str and(error['code']is None or type(error['code'])is str),'CLEANUP_ERROR_SCHEMA')
 events=row['events'];require(type(events)is list and len(events)<=64,'EVENTS_SCHEMA')
 for event in events:
  require(type(event)is dict and type(event.get('name'))is str and type(event.get('atNs'))is str and re.fullmatch('[0-9]{1,24}',event['atNs'])is not None,'EVENT_FIELDS')
 require(all(int(events[i]['atNs'])<=int(events[i+1]['atNs'])for i in range(len(events)-1)),'EVENT_TIME_ORDER')
 require(failure is None and row['assertionsCompleted']is True and row['cleanupFailures']==[],'WORKER_FAILED_NO_ACCEPTANCE')
 names=[event['name']for event in events]
 ordered=['worker-native-gate-start','exact-addon-loaded-and-native-sql-executed','real-account-store-wal-open','actual-account-transactions-committed','same-native-database-close-returned','read-only-reopen-durable-metadata','independent-read-only-verifier-closed','durable-file-evidence-after-all-original-and-verifier-close','assertions-completed-not-yet-outer-natural-exit','cleanup-settled']
 require(names==ordered,'EXACT_EXPECTED_EVENT_SEQUENCE')
 def event(name):return events[names.index(name)]
 require(event(ordered[0]).get('node')=='v22.18.0'and event(ordered[0]).get('abi')=='127'and event(ordered[0]).get('scenario')=='account-wal','NODE_ABI')
 require(event(ordered[1]).get('abi')=='127'and type(event(ordered[1]).get('sqliteVersion'))is str,'NATIVE_SQL')
 require(event(ordered[2]).get('file')=='account-wal.sqlite','FILE_NAME')
 require(type(event(ordered[3]).get('count'))is int and event(ordered[3])['count']==1,'COMMITTED_COUNT')
 original_files=validate_closed_proof(event(ordered[4]))
 verifier_files=validate_closed_proof(event(ordered[6]))
 require(original_files[0]==verifier_files[0],'READONLY_MAIN_BYTES_CHANGED')
 require(type(event(ordered[5]).get('rows'))is int and event(ordered[5])['rows']==1,'DURABLE_ROWS')
 file_event=event(ordered[7]);require(type(file_event.get('bytes'))is int and 0<file_event['bytes']<=8*1024**2 and type(file_event.get('sha256'))is str and re.fullmatch('[0-9a-f]{64}',file_event['sha256'])is not None,'FIXTURE_EVENT')
 require(file_event['bytes']==verifier_files[0]['bytes']and file_event['sha256']==verifier_files[0]['sha256'],'FINAL_FILE_VS_CLOSED_PROOF')
 require(event(ordered[9]).get('resource')=='same-original-account-store','CLEANUP_RESOURCE')
 return file_event

def capture_safe_native_files(root,evidence,safe,worker_entered,emit):
 # Call BEFORE classifying worker JSON, and again in outerfinally on exceptions.
 # Unsafe/missingreceipt never authorizes source reads or deletion.
 root=Path(root);evidence=Path(evidence)
 if not worker_entered:return {'state':'NOT_STARTED','captured':False}
 require(safe is True,'CAPTURE_NAMESPACE_UNSAFE')
 supervisor=json.loads((evidence/'native-account-wal-supervisor.json').read_text())
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
