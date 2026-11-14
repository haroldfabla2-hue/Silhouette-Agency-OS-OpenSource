"""Fixed finite receipt schema. Pure validation, no file/side effects/imports.
Used on final bytes before export; not authority for any product success.
"""
import math
MODES=['constructors','identity-existing','saturated-replay','schema-and-write-failure','power-check','timer-armed','timer-fired','threshold']
CATEGORIES={'UNCLASSIFIED','REDIS_TRANSPORT_EVENT','REDIS_CONNECT_FALLBACK','REDIS_FALLBACK_CLOSE_FAILURE','REDIS_PUBLIC_CLOSE_FAILURE','REDIS_INCIDENT_FAILURE','GRAPH_HEALTH_UNAVAILABLE','GRAPH_SCHEMA_FAILURE','GRAPH_QUERY_FAILURE','GRAPH_QUERY_RETRY_FAILURE','GRAPH_SESSION_CLOSE_FAILURE','DREAMER_STARTUP_FAILURE','DREAMER_SELECTED_ATTEMPT_FAILURE','INITIAL_CONCEPT_NOTIFICATION_FAILURE','INITIAL_IDENTITY_NOTIFICATION_FAILURE','STORE_NOTIFICATION_FAILURE','INITIAL_CONCEPT_NOTIFICATION_ABANDONED','INITIAL_IDENTITY_NOTIFICATION_ABANDONED','STORE_NOTIFICATION_ABANDONED'}
def keys(value,required,optional=()):
 assert type(value)is dict and set(required)<=set(value)<=set(required)|set(optional)
def integer(value,minimum=0,maximum=9007199254740991):assert type(value)is int and minimum<=value<=maximum
def boolean(value):assert type(value)is bool
def elapsed(value,maximum):assert type(value)in {int,float} and math.isfinite(value)and 0<=value<=maximum
def cleanup(value):assert type(value)is list and len(value)==2 and all(type(x)is str and x in {'fulfilled','rejected'}for x in value)
def category_receipt(value):
 keys(value,['historicalMapping','currentReportOnly','retainedCount','ownerFailures','taskOutcomeFailures','lifetimeFailures','acknowledged','truncated','unclassifiedCount','attribution','retained'])
 assert value['historicalMapping']=='NOT_RECONSTRUCTED'and value['currentReportOnly']is True
 for k in ['retainedCount','ownerFailures','taskOutcomeFailures','lifetimeFailures','acknowledged','unclassifiedCount']:integer(value[k])
 boolean(value['truncated'])
 assert type(value['retained'])is list and len(value['retained'])<=64
 assert len(value['retained'])==min(value['retainedCount'],64)
 assert value['truncated']==(value['retainedCount']>64)
 assert value['lifetimeFailures']==value['ownerFailures']+value['taskOutcomeFailures']
 assert value['retainedCount']+value['acknowledged']<=value['lifetimeFailures']
 ids=[]
 for failure in value['retained']:
  keys(failure,['id','kind','category']);integer(failure['id'],1)
  assert failure['kind']in {'OWNER_FAILURE','ORIGINAL_TASK_OUTCOME'}and failure['category']in CATEGORIES
  ids.append(failure['id'])
 assert len(set(ids))==len(ids)
 assert sum(x['kind']=='OWNER_FAILURE'for x in value['retained'])<=value['ownerFailures']
 assert sum(x['kind']=='ORIGINAL_TASK_OUTCOME'for x in value['retained'])<=value['taskOutcomeFailures']
 assert value['unclassifiedCount']==sum(x['category']=='UNCLASSIFIED'for x in value['retained'])
 assert value['attribution']==('INCOMPLETE'if value['truncated']or value['unclassifiedCount']else'FIXED_SOURCE_CATEGORIES_ONLY_NOT_CAUSE_OR_RECOVERY_PROOF')
def assertion_diagnostic(value,mode):
 keys(value,['stage','predicate','filesystem','schemaDisposition','thrownKind'])
 assert value['stage']in {'NOT_REACHED','SCHEMA_CALL','SCHEMA_DISPOSITION','SCHEMA_CALLBACK_COUNT','FILESYSTEM_OBSTRUCTION','CANONICAL_WRITE','FILESYSTEM_PREDICATE','WRITE_CALLBACK_COUNT','FAILED_WRITE_DISPOSITION_JOIN','BODY_ASSERTIONS_COMPLETED','HOST_CAUSE_ASSERTIONS','HOST_CAUSE_ASSERTIONS_COMPLETED'}
 assert value['predicate']in {'NOT_REACHED','NONE','SCHEMA_CALL_RESOLVES','SCHEMA_REJECTED_EXACT','SCHEMA_NO_EFFECT','NO_SCHEMA_CALLBACK','BACKUP_RENAME','CREATE_TARGET_DIRECTORY','WRITE_REJECTS','ERROR_CODE_EISDIR','ERROR_SYSCALL_RENAME','ERROR_DESTINATION_EXACT','NO_WRITE_CALLBACK','ORIGINAL_NOTIFICATION_JOIN','SCHEMA_CASE_REACHED','RETAINED_SCHEMA_ZOD','FILESYSTEM_ORIGINAL_CAPTURED','SAME_FILESYSTEM_ORIGINAL_RETAINED','FILESYSTEM_NOT_SCHEMA_ZOD'}
 assert value['schemaDisposition']in {'NOT_OBSERVED','SCHEMA_REJECTED','OTHER_OR_UNKNOWN'}
 assert value['thrownKind']in {'NOT_OBSERVED','ASSERTION_ERROR','OTHER_ERROR','NON_ERROR_OR_UNKNOWN'}
 f=value['filesystem'];keys(f,['observed','code','syscall','destinationMatches']);boolean(f['observed'])
 assert f['code']in {'NOT_OBSERVED','EISDIR','ENOTDIR','EACCES','EPERM','OTHER_OR_UNKNOWN'}
 assert f['syscall']in {'NOT_OBSERVED','RENAME','OPEN','MKDIR','READ','OTHER_OR_UNKNOWN'}
 assert f['destinationMatches']in {'NOT_OBSERVED','MATCH','MISMATCH_OR_MISSING'}
 if not f['observed']:assert f['code']==f['syscall']==f['destinationMatches']=='NOT_OBSERVED'
 if mode!='schema-and-write-failure':
  assert value['stage']==value['predicate']=='NOT_REACHED' and value['schemaDisposition']=='NOT_OBSERVED'and f['observed']is False

def mode_receipt(value,mode):
 keys(value,['version','mode','assertionsComplete','assertionDiagnostic','cleanup','productState','ownerFailures','taskOutcomeFailures','lifetimeFailures','categories','componentVerdict','productVerdict'])
 assert value['version']==1 and type(value['version'])is int and value['mode']==mode and mode in MODES
 assertion_diagnostic(value['assertionDiagnostic'],mode)
 boolean(value['assertionsComplete']);cleanup(value['cleanup']);assert value['productState']=='INCOMPLETE'
 for k in ['ownerFailures','taskOutcomeFailures','lifetimeFailures']:integer(value[k])
 category_receipt(value['categories'])
 for k in ['ownerFailures','taskOutcomeFailures','lifetimeFailures']:assert value[k]==value['categories'][k]
 assert value['componentVerdict']==('ASSERTIONS_COMPLETED_NOT_PRODUCT_PASS'if value['assertionsComplete']else'ASSERTIONS_INCOMPLETE')
 expected='FAIL_RETAINED_ORIGINAL_EVIDENCE'if 'rejected'in value['cleanup']or value['ownerFailures']or value['taskOutcomeFailures']else'INCOMPLETE_FRONTIER'
 assert value['productVerdict']==expected

def summary_receipt(value,receipts,missing):
 keys(value,['phase','status','rows','allModesAccounted','fatal','elapsed','global'])
 assert value['phase']=='continuum-regressions'and value['status']=='FAIL_OR_INCOMPLETE_NOT_PRODUCT_PASS'and value['global']=='INCOMPLETE'
 boolean(value['fatal']);boolean(value['allModesAccounted']);elapsed(value['elapsed'],180)
 rows=value['rows'];assert type(rows)is list and len(rows)<=8
 assert value['allModesAccounted']==(len(rows)==8)
 for index,row in enumerate(rows):
  assert type(row)is dict and row.get('mode')==MODES[index]
  mode=row['mode']
  if row.get('status')=='NOT_STARTED_PHASE_BUDGET':
   keys(row,['mode','status','code','timeout','receipt'])
   assert row['code']is None and row['timeout']is False and row['receipt']is False and mode not in receipts
   assert value['fatal']is True and index==len(rows)-1
   continue
  keys(row,['mode','code','timeout','failure','forcedOrGroupRemained','receipt','elapsed','status'],['assertionsComplete','cleanup','productVerdict','receiptInvalidOrMissing'])
  if row['code']is not None:integer(row['code'],-255,255)
  for k in ['timeout','forcedOrGroupRemained','receipt']:boolean(row[k])
  assert row['failure']is None or row['failure']in {'TimeoutError','RuntimeError','OSError','PermissionError','FileNotFoundError','AssertionError','InterruptedError','KeyboardInterrupt'}
  elapsed(row['elapsed'],24)
  if 'receiptInvalidOrMissing'in row:assert row['receiptInvalidOrMissing']is True and value['fatal']is True
  if row['receipt']:
   assert mode in receipts
   r=receipts[mode];boolean(row['assertionsComplete']);cleanup(row['cleanup'])
   for k in ['assertionsComplete','cleanup','productVerdict']:assert row[k]==r[k]
  else:assert not(set(row)&{'assertionsComplete','cleanup','productVerdict'})and value['fatal']is True
  failed=row['failure']is not None or row['timeout']or row['forcedOrGroupRemained']or row['code']!=0 or not row.get('assertionsComplete',False)
  assert row['status']==('FAIL_ASSERTION_TRANSPORT_OR_TIMEOUT'if failed else'ASSERTIONS_COMPLETED_PRODUCT_'+row['productVerdict'])
  if failed:assert value['fatal']is True and index==len(rows)-1
 if not value['fatal']:
  assert value['allModesAccounted']is True and not missing
  assert all(row.get('receipt')is True and row.get('assertionsComplete')is True for row in rows)
 # Never fabricate receipts for rows absent/not-started. Existing unexpected
 # mode files are invalid even if individually syntactically well formed.
 started={row['mode']for row in rows if row['status']!='NOT_STARTED_PHASE_BUDGET'}
 assert set(receipts)<=started
