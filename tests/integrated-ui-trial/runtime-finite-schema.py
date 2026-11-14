"""Strict positive schema for credential-free lifecycle evidence. SOURCE ONLY."""
import json,re
def strict_loads(raw):
 def pairs(items):
  result={}
  for key,value in items:
   assert key not in result,'DUPLICATE_KEY';result[key]=value
  return result
 def constant(value):raise ValueError('NONFINITE_JSON')
 return json.loads(raw,object_pairs_hook=pairs,parse_constant=constant)
STAGES={'ENTRY','STARTUP_ORIGINALS','STARTUP_GATEWAYS_BOOT_TIMERS','HTTP_TRANSPORT','EVALUATED_PRODUCERS','EVALUATED_STORAGE','ROOT_HOST','ORIGINAL_DRAIN_RETURNED'}
SLOT_NAMES={'system-controller-telemetry','daemon','curiosity','nervous','scheduler','cron','dreamer','ingestion-webhook-subscription','dreamer-accepted-continuum-receiver','introspection-known-borrowers','known-voice-route-tasks','resource-manager-known-borrowers','known-telephony-tool-tasks','telephony-known-borrowers','tts-known-borrowers','voice-library-known-borrowers','integration-hub-initial-provider-discovery','provider-account-original-database','profile-constructor-hydration','consciousness-initial-identity','continuum-initial-core-effects','lance','continuousMemory','redis','graph','identity','sqlite'}
BOOT_NAMES={'original-graph-startup','asset-catalog-immediate','janitor-initial-maintenance','initial-learning-analysis','nervous-system-startup','autonomous-scheduler-startup','heartbeat-job','cost-metrics-job','system-tick-job','periodic-learning-analysis','periodic-tool-evolution'}
EVENTS={'UNHANDLED_REJECTION','UNCAUGHT_EXCEPTION','SNAPSHOT_FAILED','STARTUP_PRODUCER_FAILURE','HTTP_CLOSE_FAILURE','PRODUCER_CLOSE_FAILURE','STORAGE_CLOSE_FAILURE','HOST_STOP_FAILURE'}
CATEGORIES={'UNCLASSIFIED','REDIS_TRANSPORT_EVENT','REDIS_CONNECT_FALLBACK','REDIS_FALLBACK_CLOSE_FAILURE','REDIS_PUBLIC_CLOSE_FAILURE','REDIS_INCIDENT_FAILURE','GRAPH_HEALTH_UNAVAILABLE','GRAPH_SCHEMA_FAILURE','GRAPH_QUERY_FAILURE','GRAPH_QUERY_RETRY_FAILURE','GRAPH_SESSION_CLOSE_FAILURE','DREAMER_STARTUP_FAILURE','DREAMER_SELECTED_ATTEMPT_FAILURE','INITIAL_CONCEPT_NOTIFICATION_FAILURE','INITIAL_IDENTITY_NOTIFICATION_FAILURE','STORE_NOTIFICATION_FAILURE','INITIAL_CONCEPT_NOTIFICATION_ABANDONED','INITIAL_IDENTITY_NOTIFICATION_ABANDONED','STORE_NOTIFICATION_ABANDONED'}
SITES={'UNCLASSIFIED','PROFILE_CONSTRUCTOR_HYDRATION','PROFILE_SQLITE_LOAD','PROFILE_SQLITE_LOAD_JOIN','PROFILE_LEGACY_GRAPH_LOAD','PROFILE_LEGACY_GRAPH_LOAD_JOIN','REDIS_CONNECT_SQLITE_ADMISSION','REDIS_CONNECT_SQLITE_JOIN'}
RESOURCES={'Timeout','Immediate','TCPServerWrap','TCPSocketWrap','PipeWrap','ProcessWrap','UDPWrap','FSReqCallback','FSReqPromise','FileHandle','FileHandleCloseReq','GetAddrInfoReqWrap','GetNameInfoReqWrap','TLSWrap','SignalWrap','MessagePort','Worker','OTHER_TYPE'}
def keys(o,expected):assert type(o)is dict and set(o)==set(expected)
def n(x,cap=1000000):assert type(x)is int and 0<=x<=cap
def b(x):assert type(x)is bool
def enum(x,values):assert type(x)is str and x in values
def rows(x,cap):assert type(x)is list and len(x)<=cap

def projection(o):
 keys(o,{'historicalMapping','currentReportOnly','retainedCount','ownerFailures','taskOutcomeFailures','lifetimeFailures','acknowledged','truncated','unclassifiedCount','attribution','retained'})
 assert o['historicalMapping']=='NOT_RECONSTRUCTED' and o['currentReportOnly']is True
 for k in ['retainedCount','ownerFailures','taskOutcomeFailures','lifetimeFailures','acknowledged','unclassifiedCount']:n(o[k])
 b(o['truncated']);enum(o['attribution'],{'INCOMPLETE','FIXED_SOURCE_CATEGORIES_ONLY_NOT_CAUSE_OR_RECOVERY_PROOF'})
 rows(o['retained'],64);ids=[]
 for r in o['retained']:
  keys(r,{'id','kind','category','sourceSite','sameOriginalFirstRetainedId'});n(r['id']);ids.append(r['id']);enum(r['kind'],{'OWNER_FAILURE','ORIGINAL_TASK_OUTCOME'});enum(r['category'],CATEGORIES);enum(r['sourceSite'],SITES)
  if r['sameOriginalFirstRetainedId']is not None:n(r['sameOriginalFirstRetainedId'])
 assert len(ids)==len(set(ids))
 for r in o['retained']:assert r['sameOriginalFirstRetainedId']is None or r['sameOriginalFirstRetainedId']in ids[:ids.index(r['id'])+1]
 for r in o['retained']:
  first=r['sameOriginalFirstRetainedId']
  if first is not None:assert next(row for row in o['retained']if row['id']==first)['sameOriginalFirstRetainedId']==first
 assert o['ownerFailures']+o['taskOutcomeFailures']==o['lifetimeFailures']
 assert o['retainedCount']+o['acknowledged']<=o['lifetimeFailures'] # dropped-overcapacity rows remain lifetime failures
 assert sum(r['kind']=='OWNER_FAILURE'for r in o['retained'])<=o['ownerFailures']
 assert sum(r['kind']=='ORIGINAL_TASK_OUTCOME'for r in o['retained'])<=o['taskOutcomeFailures']
 assert o['attribution']==('INCOMPLETE'if o['truncated']or any(r['category']=='UNCLASSIFIED'for r in o['retained'])else'FIXED_SOURCE_CATEGORIES_ONLY_NOT_CAUSE_OR_RECOVERY_PROOF')
 assert o['unclassifiedCount']==sum(r['category']=='UNCLASSIFIED'for r in o['retained'])
 assert len(o['retained'])==min(64,o['retainedCount']) and o['truncated']==(o['retainedCount']>64)

def progress(o):
 if o is None:return
 keys(o,{'stage','pendingOriginals','reservedChildren','reservedResources','pendingSealCallbacks','retirementJoins','resourceCount','scopes','scopesTruncated'})
 enum(o['stage'],{'NOT_STARTED','SEAL_CALLBACKS','RETIREMENTS','ACTIVE_ORIGINALS','RESOURCE_RELEASE','CLOSED','INTERRUPTED'})
 for k in ['pendingOriginals','reservedChildren','reservedResources','pendingSealCallbacks','retirementJoins','resourceCount']:n(o[k])
 rows(o['scopes'],128);b(o['scopesTruncated'])
 for i,r in enumerate(o['scopes']):
  keys(r,{'ordinal','active','pendingSealCallbacks'});assert r['ordinal']==i;n(r['active']);n(r['pendingSealCallbacks'])

def snapshot(o):
 keys(o,{'version','kind','stage','slots','hostProgress','frontier','boot','hostEvidence'});assert o['version']==1
 enum(o['kind'],{'STAGE','HOST','DEADLINE','FINAL'});enum(o['stage'],STAGES);progress(o['hostProgress'])
 for key in ['slots','frontier']:
  rows(o[key],27);assert {r['name']for r in o[key]}==SLOT_NAMES and len(o[key])==27
  for r in o[key]:
   if key=='slots':
    keys(r,{'name','construction','stop','elapsedMs'});enum(r['construction'],{'UNSEEN','CONSTRUCTING','PUBLISHED','FAILED'});enum(r['stop'],{'NOT_STARTED','PENDING','FULFILLED','REJECTED'})
    if r['elapsedMs']is not None:n(r['elapsedMs'],1200000)
   else:keys(r,{'name','phase'});enum(r['phase'],{'UNSEEN','CONSTRUCTING','PUBLISHED','FAILED'})
 rows(o['boot'],11);assert len(o['boot'])==11 and {r['label']for r in o['boot']}==BOOT_NAMES
 for r in o['boot']:
  keys(r,{'label','phase','fires','failures'});enum(r['phase'],{'UNSEEN','SCHEDULED','RUNNING','SETTLED','CANCELLED','UNVERIFIED'});n(r['fires']);n(r['failures'])
 h=o['hostEvidence'];assert(h is not None)==(o['kind']=='HOST')
 if h is not None:
  keys(h,{'state','coverage','pending','capacity','highWater','residualCount','resourceEvidenceCount','resourceDispositions','failureProjection','productFrontierGuardPresent','resourceReasonCounts'})
  b(h['productFrontierGuardPresent']);keys(h['resourceReasonCounts'],{'EVALUATION_UNKNOWN','RESOURCE_DEPENDENCY_CYCLE','DEPENDENT_RELEASE_UNVERIFIED','NO_SUPPORTED_CLOSE','CLOSE_FAILED','VERIFY_FAILED','STOP_INTERRUPTED_BEFORE_RELEASE_EVIDENCE','OTHER_OR_NONE'})
  for v in h['resourceReasonCounts'].values():n(v)
  assert sum(h['resourceReasonCounts'].values())==h['resourceEvidenceCount']
  enum(h['state'],{'INCOMPLETE','SETTLED_NO_FAILURE_RECORDED'});assert h['coverage']=='EXPLICITLY_REGISTERED_WORK_ONLY'
  for k in ['pending','residualCount','resourceEvidenceCount']:n(h[k])
  for k in ['capacity','highWater']:
   keys(h[k],{'scopes','active','failures','resources'})
   for v in h[k].values():n(v)
  keys(h['resourceDispositions'],{'CLOSED','NOT_ACQUIRED','INCOMPLETE'})
  for v in h['resourceDispositions'].values():n(v)
  assert sum(h['resourceDispositions'].values())==h['resourceEvidenceCount'];projection(h['failureProjection'])

def resource(o):
 enum(o.get('checkpoint'),{'ORIGINAL_DRAIN_RETURNED','DRAIN_DEADLINE'});enum(o.get('status'),{'FIXED_TYPE_COUNTS_ONLY','OVERFLOW_UNVERIFIED','SNAPSHOT_FAILED_UNVERIFIED'})
 assert o.get('cap')==512 and o.get('attribution')=='UNKNOWN' and o.get('physicalClosureProven')is False
 if o['status']=='FIXED_TYPE_COUNTS_ONLY':
  keys(o,{'checkpoint','status','cap','total','counts','attribution','physicalClosureProven'});keys(o['counts'],RESOURCES)
  for v in o['counts'].values():n(v,512)
  n(o['total'],512);assert sum(o['counts'].values())==o['total']
 else:keys(o,{'checkpoint','status','cap','counts','attribution','physicalClosureProven'});assert o['counts']is None

def validate(o):
 keys(o,{'version','rawRuntimeLogs','snapshots','events','resourceCounts','markerOrder','lifecycleEvidence','identityBoundary','identityEvidence','identitySummary','global'})
 assert o['version']==1 and o['global']=='INCOMPLETE'
 keys(o['rawRuntimeLogs'],{'withheld','reason','runtimeCompletePresent','runtimeOuterPresent'});assert o['rawRuntimeLogs']['withheld']is True and o['rawRuntimeLogs']['reason']=='CREDENTIALLED_FIXTURE_PRIVATE_RAW_LOGS'
 b(o['rawRuntimeLogs']['runtimeCompletePresent']);b(o['rawRuntimeLogs']['runtimeOuterPresent'])
 rows(o['snapshots'],32);rows(o['events'],128);rows(o['resourceCounts'],2)
 assert o['identitySummary']==identity_summary(o['identityBoundary'])
 identity_boundary(o['identityBoundary']);enum(o['identityEvidence'],{'OBSERVED_NOT_AUTH_PROOF','MISSING_OR_INCOMPLETE'});assert(o['identityEvidence']=='OBSERVED_NOT_AUTH_PROOF')==identity_complete(o['identityBoundary'])
 for x in o['snapshots']:snapshot(x)
 for x in o['events']:keys(x,{'kind'});enum(x['kind'],EVENTS)
 for x in o['resourceCounts']:resource(x)
 rows(o['markerOrder'],162);seen={'snapshots':0,'events':0,'resourceCounts':0}
 for x in o['markerOrder']:
  keys(x,{'group','index'});enum(x['group'],set(seen));assert x['index']==seen[x['group']];seen[x['group']]+=1
 assert all(seen[k]==len(o[k])for k in seen)
 enum(o['lifecycleEvidence'],{'OBSERVED_NOT_GLOBAL_PASS','MISSING_OR_INCOMPLETE'})
 complete=completeness(o)
 assert(o['lifecycleEvidence']=='OBSERVED_NOT_GLOBAL_PASS')==complete
 return o

FUNCTIONAL_BOOLEANS={'freshSetup','actualDiagnostics','telemetryOff','evolutionOff','noGitEffectsObserved','setupActual','setupSessionStored','setupSqliteCorrelated','consentPersistedOff','negativeUnauthorized','negativeWrongPassword','negativeInvalidSession','negativeMasterOnly','cookieOnly','headerPrecedence','postSetupDiagnosticsRejected','realBearerPreserved','secondContextLogin','loginSessionStored','loginSqliteCorrelated','protectedSessionRequest','reloadAuthenticated','reloadUnchangedSqlite','revokedSessionRejected'}
FUNCTIONAL_STAGES={'INITIAL','FRESH_SETUP_READINESS','REAL_SETUP_FIELDS','OFF_CHOICES_VERIFIED','REAL_SETUP_COMMIT','NEGATIVE_AUTH_BOUNDARIES','NEW_CONTEXT_REAL_LOGIN','PROTECTED_REQUEST_RELOAD','REAL_SESSION_REVOCATION','NARROW_AUTH_COMPLETE'}
CHECKPOINTS={'BROWSER_LAUNCHED','PAGE_CREATED','ACTUAL_DOMCONTENTLOADED','ACTUAL_LOAD','BOOTSTRAP_BODY_ENTERED','HOST_INSTALLED','ENTRY_IMPORT_CALLED','ENTRY_IMPORT_FULFILLED','ENTRY_IMPORT_REJECTED','READINESS_REQUEST_FINISHED','BEFORE_BODY_WAIT','ORIGINAL_BROWSER_FAILURE','ACTUAL_SCREENSHOT_ATTEMPT_BEGIN','BEFORE_BROWSER_CLOSE','BROWSER_DISCONNECTED','PAGE_CRASH'}
def browser(o):
 required={'operations','console','pageErrors','failedResources','localResources','requests','responses','setupRequired','authenticated','chatStorageVerified','safeAuthenticatedPixels','lifecycleEvents','finishedResources','checkpoints','screenshot','bodyVisibleObserved','cleanupErrors'}
 optional={'preCredentialBoundary','navigation','titleObserved','functional','limitation','primaryFailure','layout','layoutFailure','layoutMetadataOverflow','captureOverflow','pendingWorkAtCleanup','credentialFixtureEntered'}
 assert type(o)is dict and required<=set(o)<=required|optional
 rows(o['operations'],64)
 for ordinal,r in enumerate(o['operations']):
  keys(r,{'ordinal','operation','startedAt','originalSettledAt','wrapperFinishedAt','originalResult','wrapperResult','deadlineKind'});assert r['ordinal']==ordinal
  enum(r['operation'],{'BROWSER_LAUNCH','FIRST_CONTEXT_CREATE','FIRST_PAGE_CREATE','BACKEND_READINESS_REQUEST','BACKEND_READINESS_JSON','FIRST_NAVIGATION','FIRST_BODY_VISIBLE','FIRST_TITLE'})
  for k in ['startedAt','originalSettledAt','wrapperFinishedAt']:
   if r[k]is not None:n(r[k],9999999999999)
  assert r['startedAt']is not None
  enum(r['originalResult'],{'PENDING','FULFILLED','REJECTED_TIMEOUT_CLASS','REJECTED_OTHER'});enum(r['wrapperResult'],{'PENDING','FULFILLED','WRAPPER_DEADLINE','ORIGINAL_REJECTED'});enum(r['deadlineKind'],{'COMMON_WORK_END','ACTION_15_SECONDS'})
  assert(r['originalResult']=='PENDING')==(r['originalSettledAt']is None)
  assert(r['wrapperResult']=='PENDING')==(r['wrapperFinishedAt']is None)
  for k in ['originalSettledAt','wrapperFinishedAt']:
   if r[k]is not None:assert r[k]>=r['startedAt']
  if r['wrapperResult']=='FULFILLED':assert r['originalResult']=='FULFILLED'
  if r['wrapperResult']=='ORIGINAL_REJECTED':assert r['originalResult']in{'REJECTED_TIMEOUT_CLASS','REJECTED_OTHER'}
 if any(r['operation']=='FIRST_BODY_VISIBLE'for r in o['operations']):assert 'preCredentialBoundary'in o
 if 'preCredentialBoundary'in o:
  p=o['preCredentialBoundary'];keys(p,{'version','status','startedAt','finishedAt','http','playwright','cdp','pendingOriginalCount','pendingDisposalCount','cleanupStatus'});assert p['version']==1;n(p['pendingOriginalCount'],8);n(p['pendingDisposalCount'],8)
  enum(p['cleanupStatus'],{'CLEAN','FAILED','RESIDUAL_UNVERIFIED'})
  if p['cleanupStatus']=='CLEAN':assert p['pendingOriginalCount']==p['pendingDisposalCount']==0
  else:assert p['status']=='FAILED_DIAGNOSTIC_CLEANUP'
  if p['cleanupStatus']=='RESIDUAL_UNVERIFIED':assert p['pendingOriginalCount']or p['pendingDisposalCount']
  enum(p['status'],{'NOT_NEEDED_ORIGINAL_SETTLED','REFUSED_CREDENTIAL_BOUNDARY','FAILED_DIAGNOSTIC_CLEANUP','FAILED_UNEXPECTED','FIXED_RESULTS_ONLY_NOT_CAUSE'})
  for k in ['startedAt','finishedAt']:
   if p[k]is not None:n(p[k],9999999999999)
  h=p['http'];keys(h,{'result','status','startedAt','finishedAt'});
  for k in ['startedAt','finishedAt']:
   if h[k]is not None:n(h[k],9999999999999)
  if h['result']=='NOT_STARTED':assert h['startedAt']is None and h['finishedAt']is None
  else:assert h['startedAt']is not None and h['finishedAt']is not None and h['finishedAt']>=h['startedAt']
  enum(h['result'],{'NOT_STARTED','RESPONSE','ACTION_TIMEOUT','COMMON_BUDGET','ORIGINAL_REJECTED'})
  if h['result']=='RESPONSE':assert type(h['status'])is int and 100<=h['status']<=599
  else:assert h['status']is None
  w=p['playwright'];keys(w,{'result'});enum(w['result'],{'NOT_STARTED','RETURNED_TRUE','INVALID_FIXED_RESULT','ACTION_TIMEOUT','COMMON_BUDGET','ORIGINAL_REJECTED'})
  c=p['cdp'];keys(c,{'session','evaluation','detach','lateDetach','geometry'});enum(c['session'],{'NOT_STARTED','CREATED','ACTION_TIMEOUT','COMMON_BUDGET','ORIGINAL_REJECTED_OR_INVALID'});enum(c['evaluation'],{'NOT_STARTED','FIXED_GEOMETRY_RETURNED','ACTION_TIMEOUT','COMMON_BUDGET','ORIGINAL_REJECTED_OR_INVALID'});enum(c['detach'],{'NOT_STARTED','DETACHED','FAILED'})
  enum(c['lateDetach'],{'NOT_NEEDED','PENDING','DETACHED','FAILED'})
  if c['lateDetach']=='FAILED':assert p['cleanupStatus']=='FAILED'
  if c['lateDetach']=='PENDING':assert p['cleanupStatus']!='CLEAN'
  if c['session']=='CREATED':
   assert c['evaluation']!='NOT_STARTED'and c['detach']in{'DETACHED','FAILED'}and c['lateDetach']=='NOT_NEEDED'
   if c['detach']=='FAILED':assert p['cleanupStatus']=='FAILED'and p['status']=='FAILED_DIAGNOSTIC_CLEANUP'
  else:assert c['evaluation']=='NOT_STARTED'and c['detach']=='NOT_STARTED'and c['geometry']is None
  if p['status']in{'NOT_NEEDED_ORIGINAL_SETTLED','FIXED_RESULTS_ONLY_NOT_CAUSE'}:assert p['cleanupStatus']=='CLEAN'
  if c['geometry']is not None:
   g=c['geometry'];keys(g,{'readyState','body'});enum(g['readyState'],{'loading','interactive','complete'})
   if g['body']is not None:
    z=g['body'];keys(z,{'children','width','height','display','visibility'});n(z['children']);enum(z['display'],{'block','flex','grid','none','contents','inline','inline-block','OTHER'});enum(z['visibility'],{'visible','hidden','collapse','OTHER'})
    for k in ['width','height']:real_number(z[k],10000000)
   assert c['evaluation']=='FIXED_GEOMETRY_RETURNED'
  else:assert c['evaluation']!='FIXED_GEOMETRY_RETURNED'
  if p['status']=='NOT_NEEDED_ORIGINAL_SETTLED':assert p['startedAt']is None and p['finishedAt']is None and h['result']==w['result']==c['session']==c['evaluation']==c['detach']=='NOT_STARTED'and c['lateDetach']=='NOT_NEEDED'and p['pendingOriginalCount']==0
  if p['status']=='FIXED_RESULTS_ONLY_NOT_CAUSE':assert p['startedAt']is not None and p['finishedAt']is not None and p['finishedAt']>=p['startedAt']
  if p['status']in{'FIXED_RESULTS_ONLY_NOT_CAUSE','FAILED_DIAGNOSTIC_CLEANUP'}:
   assert h['result']!='NOT_STARTED'and w['result']!='NOT_STARTED'and c['session']!='NOT_STARTED'
   assert p['startedAt']is not None and p['finishedAt']is not None
   assert p['startedAt']<=h['startedAt']<=h['finishedAt']<=p['finishedAt']
 for k in ['authenticated','chatStorageVerified','safeAuthenticatedPixels','bodyVisibleObserved']:b(o[k])
 assert o['chatStorageVerified']is False and(o['setupRequired']is None or type(o['setupRequired'])is bool)
 if 'pendingWorkAtCleanup'in o:n(o['pendingWorkAtCleanup'],128)
 for k in ['titleObserved','layoutMetadataOverflow','captureOverflow','credentialFixtureEntered']:
  if k in o:b(o[k])
 if 'primaryFailure'in o:keys(o['primaryFailure'],{'kind'});assert o['primaryFailure']['kind']=='ACTUAL_BROWSER_OR_FUNCTIONAL_FAILURE'
 if 'functional'in o:
  f=o['functional'];keys(f,FUNCTIONAL_BOOLEANS|{'version','status','stage','failedStage','twoIdentityIsolation','expiredSession','storeUnavailable','global'})
  assert f['version']==2 and f['global']=='INCOMPLETE';enum(f['status'],{'NOT_COMPLETE','FAILED','COMPLETE_NARROW_AUTH_ONLY'});enum(f['stage'],FUNCTIONAL_STAGES);enum(f['failedStage'],FUNCTIONAL_STAGES|{'NONE','CONTEXT_CLEANUP','PENDING_FUNCTIONAL_WORK','DRIVER_CLEANUP'})
  for k in FUNCTIONAL_BOOLEANS:b(f[k])
  for k in ['twoIdentityIsolation','expiredSession','storeUnavailable']:assert f[k]=='NOT_EXERCISED'
  if f['status']=='COMPLETE_NARROW_AUTH_ONLY':
   assert all(f[k]for k in FUNCTIONAL_BOOLEANS)and f['failedStage']=='NONE'and f['stage']=='NARROW_AUTH_COMPLETE'
   assert o['authenticated']is True and o['safeAuthenticatedPixels']is True and not o['cleanupErrors']and not o.get('captureOverflow',False)and not o.get('pendingWorkAtCleanup',0)and 'primaryFailure'not in o
   assert o['screenshot']['status']=='PRIVATE_VIEWPORT_PIXELS_NOT_EXPORTED'
   if 'preCredentialBoundary'in o:assert o['preCredentialBoundary']['cleanupStatus']=='CLEAN'and o['preCredentialBoundary']['pendingOriginalCount']==o['preCredentialBoundary']['pendingDisposalCount']==0 and o['preCredentialBoundary']['status']in{'NOT_NEEDED_ORIGINAL_SETTLED','FIXED_RESULTS_ONLY_NOT_CAUSE'}
  else:assert o['authenticated']is False
 for k,cap in [('console',100),('pageErrors',128),('failedResources',128),('localResources',128),('requests',256),('responses',256),('finishedResources',256),('lifecycleEvents',16),('checkpoints',64),('cleanupErrors',128)]:rows(o[k],cap)
 for r in o['console']:keys(r,{'kind','pageOrdinal'});page_id(r);enum(r['kind'],{'error','warning','info','log','debug','warn','OTHER'})
 for r in o['pageErrors']:keys(r,{'kind','pageOrdinal'});page_id(r);assert r['kind']=='ACTUAL_PAGE_ERROR'
 for r in o['cleanupErrors']:keys(r,{'kind'});enum(r['kind'],{'CDP_DETACH_FAILURE','BROWSER_CLOSE_FAILURE','LATE_BROWSER_SCOPE_CLOSE_FAILURE'})
 def path(x):assert type(x)is str and(x=='OMITTED'or re.fullmatch(r'/[A-Za-z0-9_./-]{0,511}',x))
 def source(r):enum(r['origin'],{'http://127.0.0.1:3005','https://fonts.googleapis.com','https://fonts.gstatic.com','OTHER_ORIGIN','UNPARSEABLE'});path(r['path'])
 kinds={'document','stylesheet','image','media','font','script','texttrack','xhr','fetch','eventsource','websocket','manifest','other'}
 for key in ['failedResources','localResources','finishedResources']:
  for r in o[key]:
   extra={'kindOfFailure'}if key=='failedResources'else({'status'}if key=='localResources'else set())
   keys(r,{'origin','path','kind','pageOrdinal'}|extra);page_id(r);source(r);enum(r['kind'],kinds)
   if key=='failedResources':assert r['kindOfFailure']=='ACTUAL_REQUEST_FAILED'
   if key=='localResources':n(r['status'],599)
 for r in o['requests']:keys(r,{'path','method','pageOrdinal'});page_id(r);path(r['path']);enum(r['method'],{'GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'})
 for r in o['responses']:keys(r,{'path','status','pageOrdinal'});page_id(r);path(r['path']);n(r['status'],599)
 for r in o['lifecycleEvents']:
  assert set(r)==({'kind','at','pageOrdinal'}if r.get('kind')=='PAGE_CRASH'else{'kind','at'});
  if 'pageOrdinal'in r:page_id(r)
  enum(r['kind'],{'BROWSER_DISCONNECTED','PAGE_CRASH'});n(r['at'],9999999999999)
 for r in o['checkpoints']:keys(r,{'stage','at','pageOrdinal'});assert type(r['pageOrdinal'])is int and 0<=r['pageOrdinal']<=2;enum(r['stage'],CHECKPOINTS);n(r['at'],9999999999999)
 if 'navigation'in o:keys(o['navigation'],{'status','origin','path'});source(o['navigation']);n(o['navigation']['status'],599)
 if 'limitation'in o:assert o['limitation']=='Narrow genuine local setup/login/session SQLite only. Chat, AI, learning and full security NOT PROVEN. Credentialed PNG retained privately, not exported or pixel-inspected. Visual correctness/privacy remain unverified; narrow authentication checks do not establish full functional success.'
 shot=o['screenshot'];assert type(shot)is dict
 enum(shot.get('status'),{'PRIVATE_VIEWPORT_PIXELS_NOT_EXPORTED','CAPTURE_FAILED','NO_VERIFIED_SECOND_PAGE_PRIVATE_PIXELS'})
 if shot['status']=='PRIVATE_VIEWPORT_PIXELS_NOT_EXPORTED':keys(shot,{'status','bytes','noFunctionalUiPassImplied','exported','visualVerification'});n(shot['bytes'],8*1024**2);assert shot['noFunctionalUiPassImplied']is True and shot['exported']is False and shot['visualVerification']=='NOT_INSPECTED_PRIVATE_ONLY'
 elif shot['status']=='CAPTURE_FAILED':keys(shot,{'status','kind','stage'});assert shot['kind']=='ACTUAL_CAPTURE_FAILURE';enum(shot['stage'],{'CDP_SESSION','CDP_SCREENSHOT'})
 else:keys(shot,{'status'})
 if 'layoutFailure'in o:keys(o['layoutFailure'],{'kind'});assert o['layoutFailure']['kind']=='ACTUAL_LAYOUT_FAILURE'
 if 'layout'in o:
  l=o['layout'];keys(l,{'scriptCount','stylesheetCount','readyState','body','root','scripts','stylesheets'});n(l['scriptCount']);n(l['stylesheetCount']);enum(l['readyState'],{'loading','interactive','complete'});rows(l['scripts'],128);rows(l['stylesheets'],128)
  for key in ['body','root']:
   r=l[key]
   if r is None:continue
   keys(r,{'tag','children','display','visibility','opacity','width','height'});enum(r['tag'],{'BODY','DIV'});n(r['children']);enum(r['display'],{'block','flex','grid','none','contents','inline','inline-block'});enum(r['visibility'],{'visible','hidden','collapse'});assert re.fullmatch(r'(?:0|1|0\.\d{1,6})',r['opacity'])
   for v in ['width','height']:assert type(r[v])in{int,float}and 0<=r[v]<=10000000
  for r in l['scripts']:
   keys(r,{'src','type'});assert r['src']is None or re.fullmatch(r'/[A-Za-z0-9_./-]{1,511}',r['src']);enum(r['type'],{'','module','text/javascript','application/javascript'})
  for x in l['stylesheets']:
   if x is None:continue
   keys(x,{'origin','path'});enum(x['origin'],{'LOCAL','GOOGLE_FONTS','JSDELIVR_XTERM','OTHER_OMITTED'})
   if x['origin']=='LOCAL':assert re.fullmatch(r'/[A-Za-z0-9_./-]{1,511}',x['path'])
   elif x['origin']=='GOOGLE_FONTS':assert x['path']=='/css2'
   elif x['origin']=='JSDELIVR_XTERM':assert x['path']=='/npm/xterm@5.3.0/css/xterm.css'
   else:assert x['path']=='OMITTED'
 return o


def completeness(o):
 expected=['STARTUP_ORIGINALS','STARTUP_GATEWAYS_BOOT_TIMERS','HTTP_TRANSPORT','EVALUATED_PRODUCERS','EVALUATED_STORAGE','ROOT_HOST','ORIGINAL_DRAIN_RETURNED']
 snapshots=o['snapshots']
 stages=[x['stage']for x in snapshots if x['kind']=='STAGE']
 hosts=[i for i,x in enumerate(snapshots)if x['kind']=='HOST']
 finals=[i for i,x in enumerate(snapshots)if x['kind']=='FINAL']
 counts=o['resourceCounts']
 return (o['rawRuntimeLogs']['runtimeCompletePresent']is True and o['rawRuntimeLogs']['runtimeOuterPresent']is True
  and [(x['kind'],x['stage'])for x in snapshots]==[('STAGE',x)for x in expected[:6]]+[('HOST','ROOT_HOST'),('STAGE','ORIGINAL_DRAIN_RETURNED'),('FINAL','ORIGINAL_DRAIN_RETURNED')]
  and stages==expected and len(hosts)==1 and len(finals)==1 and hosts[0]<finals[0]==len(snapshots)-1
  and snapshots[hosts[0]]['stage']=='ROOT_HOST'and snapshots[finals[0]]['stage']=='ORIGINAL_DRAIN_RETURNED'
  and not any(x['kind']=='DEADLINE'for x in snapshots)
  and all(x['hostProgress']is not None and not x['hostProgress']['scopesTruncated']for x in snapshots)
  and all(not x['hostEvidence']['failureProjection']['truncated']and x['hostEvidence']['failureProjection']['retainedCount']+x['hostEvidence']['failureProjection']['acknowledged']==x['hostEvidence']['failureProjection']['lifetimeFailures']for x in snapshots if x['kind']=='HOST')
  and len(counts)==1 and counts[0]['checkpoint']=='ORIGINAL_DRAIN_RETURNED'and counts[0]['status']=='FIXED_TYPE_COUNTS_ONLY'
  and not any(x['kind']=='SNAPSHOT_FAILED'for x in o['events'])
  and len(o['markerOrder'])>=2 and o['markerOrder'][-2:]==[{'group':'resourceCounts','index':0},{'group':'snapshots','index':finals[0]}])

def runtime_result(o):
 required={'started','backendPid','driverCode','ordinaryTerminationRequested','forced','backendExit','counterSamplerExit','descendantFrontierUnverified','caption','rootB'}
 assert type(o)is dict and required<=set(o)<=required|{'counterSamplerForced'}
 assert o['started']is True and o['rootB']=='INCOMPLETE';n(o['backendPid'],1000000)
 for k in ['ordinaryTerminationRequested','forced','descendantFrontierUnverified']:b(o[k])
 if 'counterSamplerForced'in o:b(o['counterSamplerForced'])
 for k in ['driverCode','backendExit','counterSamplerExit']:assert type(o[k])is int and -255<=o[k]<=255
 assert o['caption']=='Actual isolated Silhouette UI, external providers OFF; no AI/learning claim. Client backend aliases may be mocks; real API/storage unverified unless correlated.'
 return o

def exit_frontier(o):
 keys(o,{'appPidPresent','remainingPids','netTcp','netTcp6','netUnix','note'});b(o['appPidPresent']);rows(o['remainingPids'],96)
 for x in o['remainingPids']:assert type(x)is str and re.fullmatch(r'[0-9]{1,8}',x)
 assert o['note']=='Namespace-local post-app/browser snapshot; rootB sticky incomplete, not exhaustive owner ledger proof'
 for key in ['netTcp','netTcp6','netUnix']:
  value=o[key];assert type(value)is str and len(value)<=65536
  lines=value.splitlines();assert 1<=len(lines)<=1024
  expected={'netTcp':'sl  local_address rem_address','netTcp6':'sl  local_address                         remote_address','netUnix':'Num       RefCount Protocol Flags    Type St Inode Path'}
  assert lines[0].strip().startswith(expected[key])
  # Unix path-bearing records are withheld rather than export arbitrary paths.
  for line in lines[1:]:assert re.fullmatch(r'[0-9A-Fa-f: \t]*',line)
 return o

def page_id(o):assert type(o['pageOrdinal'])is int and 1<=o['pageOrdinal']<=2

def real_number(x,cap=1200000):assert type(x)in{int,float}and 0<=x<=cap

def runtime_outer(o):
 keys(o,{'code','failure','forced','bytes','elapsed'});assert type(o['code'])is int and -255<=o['code']<=255
 assert o['failure']is None or o['failure']in{'TimeoutError:COMMAND_WALL','RuntimeError:COMPLETE_OUTPUT_CAP'}
 b(o['forced']);n(o['bytes'],16*1024**2);real_number(o['elapsed'])
 return o

def process_counters(o):
 keys(o,{'status','rootNamespacePid','rootStartTicks','samplerExcluded','clockTicksPerSecond','samples'})
 assert o['status']=='COUNTERS_ONLY_NOT_UI_OR_DRAIN_PROOF'and o['samplerExcluded']is True
 for k in ['rootNamespacePid','rootStartTicks','clockTicksPerSecond']:n(o[k],9999999999999)
 rows(o['samples'],22)
 for r in o['samples']:
  enum(r.get('reason'),{'FIXED_10_SECOND_SAMPLE','ORIGINAL_BROWSER_FAILURE','ACTUAL_SCREENSHOT_ATTEMPT_BEGIN','BEFORE_BROWSER_CLOSE','SAMPLER_STOP'});real_number(r.get('elapsed'))
  if 'unverified'in r:
   keys(r,{'reason','elapsed','errorType','unverified'});assert r['unverified']is True;enum(r['errorType'],{'AssertionError','OSError','PermissionError','ProcessLookupError','FileNotFoundError','ValueError','IndexError'})
  else:
   keys(r,{'reason','elapsed','descendants','errors'});rows(r['descendants'],96);rows(r['errors'],96)
   for x in r['errors']:assert x in{'DESCENDANT_IDENTITY_CHANGED','DESCENDANT_PIPE_IDENTITY_UNVERIFIED'}
   total=0
   for d in r['descendants']:
    keys(d,{'pid','state','ppid','userTicks','systemTicks','threads','startTicks','rssPages','tasks','executableIdentity','pipeEndpointsStatus','pipeEndpoints'});enum(d['state'],{'R','S','D','Z','T','t','X','x','K','W','P','I'})
    for k in ['pid','ppid','userTicks','systemTicks','threads','startTicks','rssPages']:n(d[k],9999999999999)
    enum(d['executableIdentity'],{'NODE_EXECUTABLE','CHROMIUM_EXECUTABLE','TSX_ESBUILD_EXECUTABLE','TOPLEVEL_ESBUILD_EXECUTABLE','OTHER_OR_UNAVAILABLE'})
    enum(d['pipeEndpointsStatus'],{'PROCESS_GONE','UNAVAILABLE','NOT_SELECTED_EXECUTABLE','CAP_OVERFLOW','EXECUTABLE_CHANGED_UNVERIFIED','COLLECTED_FIXED_PIPE_INODES_ONLY'})
    if d['pipeEndpointsStatus']=='COLLECTED_FIXED_PIPE_INODES_ONLY':
     assert d['executableIdentity']in{'NODE_EXECUTABLE','TSX_ESBUILD_EXECUTABLE','TOPLEVEL_ESBUILD_EXECUTABLE'};rows(d['pipeEndpoints'],64);fds=[]
     for endpoint in d['pipeEndpoints']:
      keys(endpoint,{'fd','pipeInode'});n(endpoint['fd'],1048576);assert type(endpoint['pipeInode'])is str and re.fullmatch(r'[0-9]{1,20}',endpoint['pipeInode']);fds.append(endpoint['fd'])
     assert len(fds)==len(set(fds))
    else:assert d['pipeEndpoints']is None
    rows(d['tasks'],96);total+=len(d['tasks']);assert total<=96
    for t in d['tasks']:
     keys(t,{'tid','state','userTicks','systemTicks'});enum(t['state'],{'R','S','D','Z','T','t','X','x','K','W','P','I'})
     for k in ['tid','userTicks','systemTicks']:n(t[k],9999999999999)
 return o

def cgroup_counters(o):
 keys(o,{'phase','status','samples'});assert o['phase']=='runtime'and o['status']=='COUNTERS_ONLY_NOT_UI_OR_DRAIN_PROOF';rows(o['samples'],22)
 names={'cpu.stat','cpu.pressure','memory.current','memory.peak','memory.events','memory.pressure','pids.current','pids.events'}
 for r in o['samples']:
  keys(r,{'elapsed','values','unavailable'});real_number(r['elapsed']);assert type(r['values'])is dict and set(r['values'])<=names;rows(r['unavailable'],8)
  assert set(r['values'])|set(r['unavailable'])==names and not set(r['values'])&set(r['unavailable'])
  for name in r['unavailable']:enum(name,names)
  for value in r['values'].values():assert type(value)is str and len(value)<=8192 and re.fullmatch(r'[a-z0-9_ .\n=]*',value)
 return o


IDENTITY_NEXT={
 'INGRESS':{'AUTH_ENTERED','RESPONSE_FINISHED','RESPONSE_CLOSED'},
 'AUTH_ENTERED':{'IDENTITY_IMPORT_STARTED','RESPONSE_FINISHED','RESPONSE_CLOSED'},
 'IDENTITY_IMPORT_STARTED':{'IDENTITY_IMPORT_FULFILLED','RESPONSE_FINISHED','RESPONSE_CLOSED'},
 'IDENTITY_IMPORT_FULFILLED':{'IDENTITY_READY','RESPONSE_FINISHED','RESPONSE_CLOSED'},
 'IDENTITY_READY':{'HANDLER_ENTERED','RESPONSE_FINISHED','RESPONSE_CLOSED'},
 'HANDLER_ENTERED':{'RESPONSE_FINISHED','RESPONSE_CLOSED'},
 'RESPONSE_FINISHED':{'RESPONSE_CLOSED'},'RESPONSE_CLOSED':set()}
def identity_boundary(records):
 rows(records,258);events=0;requests={};enabled=0;overflows=0;lastAt=0
 for r in records:
  if r.get('kind')in{'ENABLED','OVERFLOW'}:
   keys(r,{'kind','version'});assert r['version']==1
   if r['kind']=='ENABLED':enabled+=1
   else:overflows+=1
   continue
  keys(r,{'kind','version','event','request','path','method','stage','status','at'});assert r['kind']=='REQUEST'and r['version']==1
  assert r['event']==events;events+=1;n(r['request'],32);assert r['request']>=1
  enum(r['path'],{'CURRENT_SESSION','SETUP_STATUS','AUTO_LOGIN'});enum(r['method'],{'GET','POST','OTHER'});enum(r['stage'],set(IDENTITY_NEXT));n(r['at'],9999999999999)
  assert r['at']>=lastAt;lastAt=r['at']
  if r['stage']in{'RESPONSE_FINISHED','RESPONSE_CLOSED'}:assert type(r['status'])is int and 100<=r['status']<=599
  else:assert r['status']is None
  if r['stage']=='INGRESS':
   assert r['request']not in requests and r['request']==len(requests)+1
   requests[r['request']]={'path':r['path'],'method':r['method'],'stage':'INGRESS','status':None}
  else:
   before=requests.get(r['request']);assert before is not None and (before['path'],before['method'])==(r['path'],r['method'])
   assert r['stage']in IDENTITY_NEXT[before['stage']]
   if r['path']!='CURRENT_SESSION':assert r['stage']not in{'IDENTITY_IMPORT_STARTED','IDENTITY_IMPORT_FULFILLED','IDENTITY_READY','HANDLER_ENTERED'}
   if before['stage']=='RESPONSE_FINISHED':assert r['status']==before['status']
   before['stage']=r['stage'];before['status']=r['status']
 assert enabled<=1 and overflows<=1 and events<=256
 if records:assert records[0]=={'kind':'ENABLED','version':1}

def identity_summary(records):
 requests={};enabled=any(r['kind']=='ENABLED'for r in records);overflow=any(r['kind']=='OVERFLOW'for r in records)
 for r in records:
  if r['kind']=='REQUEST':
   row=requests.setdefault(r['request'],{'finished':False,'closed':False})
   if r['stage']=='RESPONSE_FINISHED':row['finished']=True
   if r['stage']=='RESPONSE_CLOSED':row['closed']=True
 count=len(requests);finished=sum(r['finished']for r in requests.values());closed=sum(r['closed']for r in requests.values());outstanding=sum(not r['closed']for r in requests.values());aborted=sum(r['closed']and not r['finished']for r in requests.values())
 state='MISSING'if not enabled else'OVERFLOW_UNVERIFIED'if overflow else'ENABLED_ONLY'if not count else'OBSERVED_WITH_OUTSTANDING'if outstanding else'OBSERVED_WITH_ABORTED'if aborted else'OBSERVED_FINISHED'
 return {'state':state,'requestCount':count,'finishedCount':finished,'closedCount':closed,'outstandingCount':outstanding,'abortedCount':aborted,'sourceClaim':'UNKNOWN','correlation':'TIME_AND_REQUEST_ORDINAL_ONLY_NOT_PAGE_OR_PROBE_IDENTITY'}

def identity_complete(records):
 return identity_summary(records)['state']in{'OBSERVED_WITH_OUTSTANDING','OBSERVED_WITH_ABORTED','OBSERVED_FINISHED'}
