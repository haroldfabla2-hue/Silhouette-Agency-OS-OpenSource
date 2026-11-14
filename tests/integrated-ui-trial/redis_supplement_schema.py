"""Fixed finite supplemental evidence only. No product success grant."""
import math
MODES=['generation-mutations','live-borrow','before-borrow']
SCENARIOS=['REAL_GENERATION_MUTATIONS','COALESCED_LIVE_BORROW_AND_LATE_REJECTION','REJECTION_BEFORE_BORROW']
EXTRA='delSurvives setValueSurvives evictionSurvives unchangedCap coalescedSame borrowLive joinPendingAtBarrier originalPendingAtBarrier joinSame incidentPersisted newRootRejected rejectedBodyNotEntered beforeBorrowSameError'.split()
COUNTS={'generation-mutations':(5,2,3),'live-borrow':(1,1,0),'before-borrow':(0,0,0)}
KINDS={'ADMISSION_CLOSED','AGGREGATE_ERROR','ASSERTION_ERROR','OTHER_ERROR','NON_ERROR'}
def keys(v,k):assert type(v)is dict and set(v)==set(k.split())
def integer(v,lo=0,hi=9007199254740991):assert type(v)is int and lo<=v<=hi
def child_receipt(v,mode):
 keys(v,'version mode extra nested diagnostic assertionsComplete results cleanup hostSealedEarly productState productVerdict survivor sameBodyObserved postSealRejected exactNativeTimers actualDestroyObserved cancelledSameOriginal firedOriginal ownerFailures taskOutcomeFailures lifetimeFailures rawPrivateLogExported global')
 assert type(v['version'])is int and v['version']==1 and v['mode']==mode and mode in MODES
 keys(v['extra'],' '.join(EXTRA));assert all(type(x)is bool for x in v['extra'].values())
 for k in ['assertionsComplete','sameBodyObserved','postSealRejected','hostSealedEarly']:assert type(v[k])is bool
 assert v['hostSealedEarly']is False and v['survivor']=='NOT_REACHED'
 assert v['rawPrivateLogExported']is False and v['global']=='INCOMPLETE'and v['productVerdict']=='FAIL_OR_INCOMPLETE_NOT_PRODUCT_PASS'
 assert v['productState']in {'UNVERIFIED','INCOMPLETE'}
 assert type(v['cleanup'])is list and len(v['cleanup'])==2 and all(x in {'fulfilled','rejected'}for x in v['cleanup'])
 for k in ['exactNativeTimers','actualDestroyObserved','cancelledSameOriginal','firedOriginal']:integer(v[k],0,32)
 n,c,f=(v[k]for k in ['exactNativeTimers','cancelledSameOriginal','firedOriginal']);assert c+f<=n and c<=v['actualDestroyObserved']<=n
 for k in ['ownerFailures','taskOutcomeFailures','lifetimeFailures']:
  if v[k]is not None:integer(v[k])
 if v['productState']=='INCOMPLETE':assert v['lifetimeFailures']==v['ownerFailures']+v['taskOutcomeFailures']
 else:assert all(v[k]is None for k in ['ownerFailures','taskOutcomeFailures','lifetimeFailures'])
 names=[SCENARIOS[MODES.index(mode)],'ACTUAL_TERMINAL_DISPOSITION_AND_PHYSICAL_CANCEL','QUEUED_NOT_FIRED_RACE','NATIVE_SETUP_OR_CANCELLATION_FAILURE','ACTUAL_REDIS_NX_PX']
 assert type(v['results'])is list and len(v['results'])==5
 for i,r in enumerate(v['results']):
  keys(r,'name status');assert r['name']==names[i];assert r['status']in ({'EXERCISED_PASSED','EXERCISED_FAILED','NOT_REACHED'}if i<2 else {'NOTEXERCISED','NOTRUN'})
 assert [r['status']for r in v['results'][2:]]==['NOTEXERCISED','NOTEXERCISED','NOTRUN']
 d=v['diagnostic'];keys(d,'stage failedStage predicate failedPredicate errorKind migrationSource migrationCount incidentsTable migration004')
 # Reuse exact diagnostic stage vocabulary, never permit arbitrary strings.
 stages={'PRECONDITION_NOT_REACHED','MIGRATION_SOURCE','SQLITE_PRECONDITION','REDIS_IMPORT','READONLY_SHAPE','NATIVE_TIMER_CAPTURE','ACQUIRE_BODY','TERMINAL_ASSERTIONS','OPEN_SURVIVOR'}
 predicates={'NONE','PINNED_SOURCE_AND_PRIVATE_DESTINATION','ACTUAL_INCIDENTS_TABLE','ACTUAL_MIGRATION_004','ACTUAL_PRODUCTION_SINGLETON','OWN_FIELDS_AND_CAPS','EXACT_TIMEOUT_RESOURCE_ID','PUBLIC_ORIGINAL_PROMISE','REAL_ACQUISITION_TRUE','HOST_AND_CANCELLATION_TYPE','SELECTED_SAME_ORIGINAL_ERROR','EXACT_NATIVE_DESTROY','NEW_LOCK_SURVIVES_OLD_EXPIRY'}
 assert d['stage']in stages and d['failedStage']in stages|{'NONE'}and d['predicate']in predicates and d['failedPredicate']in predicates
 assert d['errorKind']in {'NOT_OBSERVED','ASSERTION_ERROR','SQLITE_ERROR','OTHER_ERROR','NON_ERROR_OR_UNKNOWN'}
 assert (d['failedStage']=='NONE')==(d['errorKind']=='NOT_OBSERVED');integer(d['migrationCount'],0,4)
 assert d['migrationSource']in {'NOT_OBSERVED','MATCH_ALL_FOUR'}and d['incidentsTable']in {'NOT_OBSERVED','PRESENT','ABSENT'}and d['migration004']in {'NOT_OBSERVED','APPLIED','ABSENT_OR_MISMATCH'}
 if d['migrationSource']=='MATCH_ALL_FOUR':assert d['migrationCount']==4
 if d['migration004']=='APPLIED':assert d['incidentsTable']=='PRESENT'and d['migrationSource']=='MATCH_ALL_FOUR'
 if d['failedStage']=='NONE':assert d['failedPredicate']=='NONE'
 z=v['nested'];keys(z,'root cause children causeSameRoot childSameRoot childSameCause truncated')
 assert z['root']in KINDS|{'NOT_OBSERVED'}and z['cause']in KINDS|{'NOT_OBSERVED','ABSENT'}
 assert type(z['children'])is list and len(z['children'])<=4 and all(x in KINDS for x in z['children'])
 for k in ['causeSameRoot','childSameRoot','childSameCause','truncated']:assert type(z[k])is bool
 if z['root']=='NOT_OBSERVED':
  assert z['cause']=='NOT_OBSERVED'and z['children']==[]
  assert not any(z[k]for k in ['causeSameRoot','childSameRoot','childSameCause','truncated'])
 else:assert z['cause']!='NOT_OBSERVED'
 if z['causeSameRoot']:assert z['cause']in KINDS and z['cause']==z['root']
 if z['childSameRoot']:assert z['root']in z['children']
 if z['childSameCause']:assert z['cause']in KINDS and z['cause']in z['children']
 if z['truncated']:assert len(z['children'])==4
 if z['children']or z['truncated']:assert z['root']=='AGGREGATE_ERROR'
 if v['results'][0]['status']=='EXERCISED_PASSED':
  required=EXTRA[:4]if mode=='generation-mutations'else EXTRA[4:12]if mode=='live-borrow'else EXTRA[12:]
  assert all(v['extra'][k]for k in required)
  assert d['migrationSource']=='MATCH_ALL_FOUR'and d['migrationCount']==4 and d['incidentsTable']=='PRESENT'and d['migration004']=='APPLIED'
 if all(r['status']=='EXERCISED_PASSED'for r in v['results'][:2]):assert (n,c,f)==COUNTS[mode]
 if v['assertionsComplete']:
  assert all(r['status']=='EXERCISED_PASSED'for r in v['results'][:2])and v['cleanup']==['fulfilled']*2
  assert v['productState']=='INCOMPLETE'and v['postSealRejected']and d['errorKind']=='NOT_OBSERVED'and z['root']=='NOT_OBSERVED'
  assert v['sameBodyObserved']==(mode!='before-borrow')
  assert all(not v['extra'][k]for k in EXTRA if k not in required)
def batch_receipt(v):
 keys(v,'version mode assertionsComplete children codes global rawPrivateLogExported')
 assert type(v['version'])is int and v['version']==1 and v['mode']=='supplement-batch'and v['global']=='INCOMPLETE'and v['rawPrivateLogExported']is False
 assert type(v['assertionsComplete'])is bool and type(v['children'])is list and len(v['children'])==3 and type(v['codes'])is list and len(v['codes'])==3
 for mode,child,code in zip(MODES,v['children'],v['codes']):
  child_receipt(child,mode);integer(code,-255,255);assert code==(0 if child['assertionsComplete']else 1)
 assert v['assertionsComplete']==all(x['assertionsComplete']for x in v['children'])
