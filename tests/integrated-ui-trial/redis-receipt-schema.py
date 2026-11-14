"""SOURCE ONLY. Exact scenario and final-byte evidence contract, no success grant."""
import math
MODES=['natural-expiry','pending-terminal','fired-terminal','inflight-terminal','release-reacquire-terminal','multikey-guard','postseal-idempotency','open-survivor','supplement-batch']
SCENARIOS=['NATURAL_EXPIRY_AND_HELD_GUARD','PUBLIC_DISCONNECT_NOT_TERMINAL','FIRED_BEFORE_TERMINAL','ACQUISITION_PENDING_AT_SEAL','TWO_GENERATIONS_CANCEL_WITHOUT_UNLOCK','MULTIKEY_AND_UNSELECTED_GUARD','PENDING_BEFORE_POSTSEAL_ASSERTION','OLD_EXPIRY_MUST_NOT_DELETE_NEW_LOCK']
TERMINAL='ACTUAL_TERMINAL_DISPOSITION_AND_PHYSICAL_CANCEL'
FIXED=['QUEUED_NOT_FIRED_RACE','NATIVE_SETUP_OR_CANCELLATION_FAILURE','ACTUAL_REDIS_NX_PX']
# Exact observations required when both physical/assertion paths claim exercised.
COUNTS={'natural-expiry':(2,1,1),'pending-terminal':(1,1,0),'fired-terminal':(1,0,1),'inflight-terminal':(1,1,0),'release-reacquire-terminal':(2,2,0),'multikey-guard':(2,2,0),'postseal-idempotency':(1,1,0),'open-survivor':(2,1,1)}
def integer(v,lo=0,hi=9007199254740991):assert type(v)is int and lo<=v<=hi
def keys(v,k):assert type(v)is dict and set(v)==set(k.split())
def number(v,hi):assert type(v)in {float,int}and math.isfinite(v)and 0<=v<=hi
STAGES={'PRECONDITION_NOT_REACHED','MIGRATION_SOURCE','SQLITE_PRECONDITION','REDIS_IMPORT','READONLY_SHAPE','NATIVE_TIMER_CAPTURE','ACQUIRE_BODY','TERMINAL_ASSERTIONS','OPEN_SURVIVOR'}
PREDICATES={'NONE','PINNED_SOURCE_AND_PRIVATE_DESTINATION','ACTUAL_INCIDENTS_TABLE','ACTUAL_MIGRATION_004','ACTUAL_PRODUCTION_SINGLETON','OWN_FIELDS_AND_CAPS','EXACT_TIMEOUT_RESOURCE_ID','PUBLIC_ORIGINAL_PROMISE','REAL_ACQUISITION_TRUE','HOST_AND_CANCELLATION_TYPE','SELECTED_SAME_ORIGINAL_ERROR','EXACT_NATIVE_DESTROY','NEW_LOCK_SURVIVES_OLD_EXPIRY'}
def diagnostic_receipt(d):
 keys(d,'stage failedStage predicate failedPredicate errorKind migrationSource migrationCount incidentsTable migration004')
 assert d['stage']in STAGES and d['failedStage']in STAGES|{'NONE'}
 assert d['predicate']in PREDICATES and d['failedPredicate']in PREDICATES
 assert d['errorKind']in {'NOT_OBSERVED','ASSERTION_ERROR','SQLITE_ERROR','OTHER_ERROR','NON_ERROR_OR_UNKNOWN'}
 assert (d['failedStage']=='NONE')==(d['errorKind']=='NOT_OBSERVED')
 if d['failedStage']=='NONE':assert d['failedPredicate']=='NONE'
 integer(d['migrationCount'],0,4)
 assert d['migrationSource']in {'NOT_OBSERVED','MATCH_ALL_FOUR'}
 if d['migrationSource']=='MATCH_ALL_FOUR':assert d['migrationCount']==4
 assert d['incidentsTable']in {'NOT_OBSERVED','PRESENT','ABSENT'}and d['migration004']in {'NOT_OBSERVED','APPLIED','ABSENT_OR_MISMATCH'}
 if d['migration004']=='APPLIED':assert d['incidentsTable']=='PRESENT'and d['migrationSource']=='MATCH_ALL_FOUR'
def mode_receipt(v,mode):
 if mode=='supplement-batch':
  from redis_supplement_schema import batch_receipt
  batch_receipt(v);return
 keys(v,'version mode diagnostic assertionsComplete results cleanup hostSealedEarly productState productVerdict survivor sameBodyObserved postSealRejected exactNativeTimers actualDestroyObserved cancelledSameOriginal firedOriginal ownerFailures taskOutcomeFailures lifetimeFailures rawPrivateLogExported global')
 diagnostic_receipt(v['diagnostic'])
 assert type(v['version'])is int and v['version']==1 and v['mode']==mode and mode in MODES
 for k in ['assertionsComplete','sameBodyObserved','postSealRejected','hostSealedEarly']:assert type(v[k])is bool
 assert v['productVerdict']=='FAIL_OR_INCOMPLETE_NOT_PRODUCT_PASS'and v['global']=='INCOMPLETE'and v['rawPrivateLogExported']is False
 assert v['productState']in {'INCOMPLETE','UNVERIFIED'}and v['survivor']in {'NOT_REACHED','SURVIVES','DELETED'}
 for k in ['exactNativeTimers','actualDestroyObserved','cancelledSameOriginal','firedOriginal']:integer(v[k],0,32)
 n,c,f=(v[k]for k in ['exactNativeTimers','cancelledSameOriginal','firedOriginal'])
 assert v['actualDestroyObserved']<=n and c+f<=n
 for k in ['ownerFailures','taskOutcomeFailures','lifetimeFailures']:
  if v[k]is not None:integer(v[k])
 if v['productState']=='INCOMPLETE':
  assert all(v[k]is not None for k in ['ownerFailures','taskOutcomeFailures','lifetimeFailures'])
  assert v['lifetimeFailures']==v['ownerFailures']+v['taskOutcomeFailures']
 else:assert all(v[k]is None for k in ['ownerFailures','taskOutcomeFailures','lifetimeFailures'])
 assert type(v['cleanup'])is list and len(v['cleanup'])==2
 if v['hostSealedEarly']:
  assert mode=='inflight-terminal'and v['sameBodyObserved']is True
  assert v['cleanup']==['NOT_ATTEMPTED_HOST_ALREADY_SEALED']*2
 else:assert all(x in {'fulfilled','rejected'}for x in v['cleanup'])
 assert type(v['results'])is list and len(v['results'])==5
 expected=[SCENARIOS[MODES.index(mode)],TERMINAL,*FIXED]
 for i,r in enumerate(v['results']):
  keys(r,'name status');assert r['name']==expected[i]
  assert r['status']in {'EXERCISED_PASSED','EXERCISED_FAILED','NOT_REACHED','NOTEXERCISED','NOTRUN'}
 scenario=v['results'][0]['status'];terminal=v['results'][1]['status']
 assert scenario in {'EXERCISED_PASSED','EXERCISED_FAILED','NOT_REACHED'}|({'NOTEXERCISED'}if mode=='inflight-terminal'else set())
 assert terminal in {'EXERCISED_PASSED','EXERCISED_FAILED','NOT_REACHED'}
 assert [r['status']for r in v['results'][2:]]==['NOTEXERCISED','NOTEXERCISED','NOTRUN']
 if scenario=='NOT_REACHED':assert v['assertionsComplete']is False
 if scenario=='EXERCISED_PASSED':
  assert v['diagnostic']['migration004']=='APPLIED'and v['diagnostic']['incidentsTable']=='PRESENT'and v['diagnostic']['migrationSource']=='MATCH_ALL_FOUR'
  assert v['sameBodyObserved']is True and n>=1
 if mode=='inflight-terminal'and scenario=='EXERCISED_PASSED':assert v['hostSealedEarly']is True
 if terminal=='EXERCISED_PASSED':
  assert v['productState']=='INCOMPLETE'and v['postSealRejected']is True
  assert n>0 and c+f==n and v['actualDestroyObserved']>=c
  if c:assert v['ownerFailures']>=c
 if v['postSealRejected']:assert v['productState']=='INCOMPLETE'
 if not v['sameBodyObserved']:assert n==c==f==0 and scenario!='EXERCISED_PASSED'
 if scenario=='EXERCISED_PASSED'and terminal=='EXERCISED_PASSED':assert (n,c,f)==COUNTS[mode]
 if v['assertionsComplete']:
  assert scenario==terminal=='EXERCISED_PASSED'and v['sameBodyObserved']and v['postSealRejected']
  assert v['productState']=='INCOMPLETE'
  if not v['hostSealedEarly']:assert v['cleanup']==['fulfilled']*2
 if v['survivor']=='DELETED':
  assert mode=='open-survivor'and v['assertionsComplete']is False and scenario=='EXERCISED_FAILED'
  if terminal=='EXERCISED_PASSED':assert (n,c,f)==COUNTS[mode]
 if v['survivor']=='SURVIVES':assert mode=='open-survivor'
 if mode!='open-survivor':assert v['survivor']=='NOT_REACHED'
 if mode=='open-survivor'and scenario=='EXERCISED_PASSED':assert v['survivor']=='SURVIVES'
def summary_receipt(v,receipts):
 keys(v,'version phase status rows allModesAccounted fatal elapsed global')
 assert type(v['version'])is int and v['version']==1 and v['phase']=='redis-regressions'
 assert v['status']=='FAIL_OR_INCOMPLETE_NOT_PRODUCT_PASS'and v['global']=='INCOMPLETE'
 assert type(v['allModesAccounted'])is bool and type(v['fatal'])is bool
 number(v['elapsed'],180)
 assert type(v['rows'])is list and 1<=len(v['rows'])<=9
 assert v['allModesAccounted']==(len(v['rows'])==9)
 present=set();fatal_indices=[]
 for i,r in enumerate(v['rows']):
  keys(r,'mode code timeout failure forcedOrGroupRemained receipt assertionsComplete elapsed')
  mode=MODES[i];assert r['mode']==mode
  if r['code']is not None:integer(r['code'],-255,255)
  for k in ['timeout','forcedOrGroupRemained','receipt','assertionsComplete']:assert type(r[k])is bool
  assert r['failure']in {None,'DRIVER_FAILURE','RECEIPT_INVALID','PHASE_BUDGET'};number(r['elapsed'],180)
  fatal_row=r['timeout']or r['forcedOrGroupRemained']or r['failure']is not None or not r['receipt']
  if fatal_row:fatal_indices.append(i)
  if r['failure']=='PHASE_BUDGET':
   assert r['code']is None and r['receipt']is False and r['assertionsComplete']is False and not r['timeout']and not r['forcedOrGroupRemained']and r['elapsed']==0
  else:assert r['code']is not None
  if r['receipt']:
   assert mode in receipts;present.add(mode);mode_receipt(receipts[mode],mode)
   assert r['assertionsComplete']==receipts[mode]['assertionsComplete']
   if not fatal_row:assert r['code']==(0 if r['assertionsComplete']else 1)
  else:assert r['assertionsComplete']is False
 assert set(receipts)==present
 assert v['fatal']==bool(fatal_indices)
 if fatal_indices:assert fatal_indices==[len(v['rows'])-1]
 else:assert v['allModesAccounted']is True and len(v['rows'])==9 and set(receipts)==set(MODES)
