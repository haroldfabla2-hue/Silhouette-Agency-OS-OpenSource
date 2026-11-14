"""Pure helper receipt validation and safe reaped directory metadata capture."""
from pathlib import Path
import json,stat

def require(ok,code):
 if not ok:raise AssertionError('NATIVE_CONTRACT:BODY_HELPER_'+code)

def capture_safe_native_files(root,evidence,safe,worker_entered,emit):
 if not worker_entered:return {'state':'NOT_STARTED','captured':False}
 require(safe is True,'CAPTURE_UNSAFE')
 row=json.loads((Path(evidence)/'native-body-helper-uds-supervisor.json').read_text())
 require(row['cleanupSafe']is True and row['chainReaped']is True and row['isolationValidated']is True and row['cause']is None and row['survivors']==[]and row['namespaceGroupLive']is False,'CAPTURE_REAPED')
 data=Path(root)/'native-data';require(data.is_dir()and not data.is_symlink(),'CAPTURE_DIRECTORY')
 entries=list(data.iterdir());require(len(entries)<=8,'CAPTURE_DIRECTORY_CAP');inventory=[]
 for p in entries:
  st=p.lstat()
  if not(p.name=='body.sock'and stat.S_ISSOCK(st.st_mode)and not p.is_symlink()):
   emit('body-helper-physical-capture.json',{'state':'UNEXPECTED_ENTRY_PRESERVE_SOURCE','entryCount':len(entries),'unexpectedTypeOrName':True,'noSocketBytesReadOrRequests':True})
   require(False,'CAPTURE_UNEXPECTED_ENTRY')
  # A leftover socket is metadata evidence of failure. Never read/connect it.
  inventory.append({'name':'body.sock','kind':'UDS_SOCKET_REMAINS','bytes':st.st_size})
 receipt={'state':'SAFE_REAPED_DIRECTORY_METADATA_ONLY','entries':inventory,'empty':not inventory,'noSocketBytesReadOrRequests':True}
 emit('body-helper-physical-capture.json',receipt)
 require(not inventory,'UDS_PATH_REMAINS_PRESERVE_SOURCE')
 return {'captured':True,'receipt':receipt}

def validate_worker_report(row,manifest):
 require(type(row)is dict and set(row)=={'schemaVersion','imports','tsImports','scope','events','failureCode','cleanupCodes','bodyFailure','productCallsiteAccepted','globalLifecycleAccepted','naturalScopeExitRequired'},'TOP_KEYS')
 require(type(row['schemaVersion'])is int and row['schemaVersion']==1 and row['scope']=='A_HELPER_REAL_HTTP_UDS_ONLY_NOT_TELEPHONY_CALLSITE_NOT_DEFAULTGLOBAL','SCOPE')
 require(row['failureCode']is None and row['cleanupCodes']==[]and row['productCallsiteAccepted']is False and row['globalLifecycleAccepted']is False and row['naturalScopeExitRequired']is True,'DISPOSITION')
 events=row['events'];expected=['REAL_UDS_SERVER_AND_PRIVATE_AGENT_CREATED','STATUS_BODY_ACTUAL_CANCEL_JOINED','JSON_EOF_CONSUMED','INVALID_JSON_AFTER_EOF_NOT_BODY_FAILURE','LOCKED_NATIVE_READER_CALLER_MISUSE','SAME_PRIVATE_AGENT_ORIGINAL_CLOSE_JOINED','REAL_SERVER_AND_ALL_SEEN_NATIVE_SOCKETS_CLOSED','OWNED_UDS_PATH_CLEANUP_AFTER_PHYSICAL_JOIN','HARNESS_ONLY_IMPORT_AGENT_CLOSED','FINAL_SCOPED_UDS_PROOF']
 require(type(events)is list and len(events)==len(expected)and [x.get('code')for x in events]==expected,'EVENT_ORDER')
 fields=[{'privateAgent','defaultGlobalTest'},{'positiveServerSockets','bodyWasContinuing','resultIdentity'},{'bodyUsed'},{'semanticSyntaxError','cleanupCount'},{'samePrimaryIdentity','bodyFailure','productionCallsite'},{'closed','positiveSocketCount'},{'sameSeenSocketCount','closedSocketCount','trackedNativeSocketInodes','remainingTrackedNativeSocketFds','newNativeSocketFds'},{'disposition','socketPathAbsent','sameParentIdentity'},{'productionDrained'},{'socketPathAbsent','remainingTrackedNativeSocketFds','newNativeSocketFds'}]
 for event,keys in zip(events,fields):require(type(event)is dict and set(event)==keys|{'code'},'EVENT_KEYS')
 require(events[0]['privateAgent']is True and events[0]['defaultGlobalTest']is False,'PRIVATE_ONLY')
 require(type(events[1]['positiveServerSockets'])is int and 1<=events[1]['positiveServerSockets']<=16 and events[1]['bodyWasContinuing']is True and events[1]['resultIdentity']is True,'POSITIVE_BODY')
 require(events[2]['bodyUsed']is True and events[3]['semanticSyntaxError']is True and type(events[3]['cleanupCount'])is int and events[3]['cleanupCount']==0,'JSON_EOF')
 def body(value):
  require(type(value)is dict and set(value)=={'name','code','count','overflow','sampleCount','sources'},'BODY_KEYS')
  require(value['name']=='HttpBodyCustodyDrainError'and value['code']=='BODY_CLEANUP_UNVERIFIED'and type(value['count'])is int and value['count']==1 and value['overflow']is False and type(value['sampleCount'])is int and value['sampleCount']==1 and value['sources']==['telephony-hangup'],'EXPECTED_REAL_LOCKED_MISUSE')
 require(events[4]['samePrimaryIdentity']is True and events[4]['productionCallsite']is False,'LOCKED_PRIMARY');body(events[4]['bodyFailure']);body(row['bodyFailure'])
 require(events[5]['closed']is True and type(events[5]['positiveSocketCount'])is int and 1<=events[5]['positiveSocketCount']<=16,'ORIGINAL_AGENT_CLOSE')
 closed=events[6];require(type(closed['sameSeenSocketCount'])is int and 1<=closed['sameSeenSocketCount']<=16 and type(closed['closedSocketCount'])is int and closed['closedSocketCount']==closed['sameSeenSocketCount']and type(closed['trackedNativeSocketInodes'])is int and closed['trackedNativeSocketInodes']>=3,'ORIGINAL_SOCKET_CLOSE')
 require(events[7]['disposition']in ['ALREADY_ABSENT_AFTER_NATIVE_CLOSE','EXPLICIT_SAME_CREATED_SOCKET_UNLINKED']and events[7]['socketPathAbsent']is True and events[7]['sameParentIdentity']is True,'OWNED_POST_CLOSE_PATH');require(events[8]['productionDrained']is False,'HARNESS_ONLY')
 for event in [closed,events[9]]:
  require(all(type(event[k])is int and event[k]==0 for k in ['remainingTrackedNativeSocketFds','newNativeSocketFds']),'FINAL_PHYSICAL_FDS')
 require(events[9]['socketPathAbsent']is True,'UDS_PATH_ABSENT')
 require(manifest['scope']=='A_HELPER_REAL_HTTP_UDS_ONLY','MANIFEST_SCOPE')
 require(type(row['imports'])is list and 1<=len(row['imports'])<=96,'IMPORT_COUNT');allowed={x['path']:x['sha256']for x in manifest['moduleEvaluationAllowlist']};seen=set()
 for item in row['imports']:
  require(type(item)is dict and set(item)=={'path','sha256'}and type(item['path'])is str and item['path']in allowed and item['path']not in seen and item['sha256']==allowed[item['path']],'IMPORT_BYTES');seen.add(item['path'])
 require('node_modules/undici/index.js'in seen and not any(x.endswith('.node')for x in seen),'UNDICI_ONLY_NO_ADDON')
 require(row['tsImports']==manifest['typescriptEvaluationClosure'],'EXACT_ONE_PRODUCT_HELPER_TS')
 return True
