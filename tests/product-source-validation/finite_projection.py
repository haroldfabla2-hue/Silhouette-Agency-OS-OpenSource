from supervisor_projection import project_supervisor, fixed_driver, NAMESPACE_STAGES
"""Fixed explicit-input projection; no filesystem, imports or runtime acceptance."""
RECEIPT_NAMES=('host','security','validation','supervisor','cleanup','namespace','driverLaunch','driverStarted','driverReceiptFailure','supervisorReceiptFailure')
def project(receipts,states):
    result={'version':2,'status':'INCOMPLETE','receiptStates':{},'hostStage':None,'hostFailure':None,
        'helperFilesystemComplete':None,'fullModuleTypecheckComplete':None,'realCaseCount':None,
        'failedCaseCount':None,'baselineOverwriteObserved':None,'naturalSupervisorExit':None,
        'outerCleanupClean':None,'securityStaged':None,'rootKeyScopeAbsent':None,'supervisorDiagnostic':None,'namespaceOperation':None,'nodeLaunchAttempted':None,'driverStarted':None,'driverFirstFailure':None,'driverLateFailures':None,'driverReceiptWriteFailed':None,'supervisorReceiptWriteFailed':None,'productPass':False}
    for name in RECEIPT_NAMES:
        state=states.get(name,'MISSING')
        result['receiptStates'][name]=state if state in ('PRESENT','MISSING','INVALID','UNREADABLE')else'INVALID'
    host=receipts.get('host')
    if result['receiptStates']['host']=='PRESENT':
        if type(host)is dict and host.get('version')==1 and host.get('stage')in {'SOURCE_GATE','PLATFORM','NODE_IDENTITY','SOURCE_IDENTITY','ISOLATION_STAGING','TOOLCHAIN','SOURCE_COPY','SUPERVISOR','COMPLETE'} and host.get('failure')in {None,'INCOMPLETE','BUDGET','CHILD_NONZERO','RECEIPT_WRITE_FAILED'}:
            result['hostStage']=host['stage'];result['hostFailure']=host['failure']
        else:result['receiptStates']['host']='INVALID'
    v=receipts.get('validation')
    if result['receiptStates']['validation']=='PRESENT':
        if type(v)is dict and all(type(v.get(k))is bool for k in ['helperFilesystemComplete','fullModuleTypecheckComplete'])and type(v.get('realCases'))is list and len(v['realCases'])<=32 and all(type(x)is dict and type(x.get('pass'))is bool for x in v['realCases']):
            result['helperFilesystemComplete']=v['helperFilesystemComplete'];result['fullModuleTypecheckComplete']=v['fullModuleTypecheckComplete']
            result['realCaseCount']=len(v['realCases']);result['failedCaseCount']=sum(not x['pass']for x in v['realCases'])
            f=v.get('baselineFinding')
            if type(f)is dict and type(f.get('originalReferencePreserved'))is bool and type(f.get('actualLateBytesMatched'))is bool:
                result['baselineOverwriteObserved']=f['originalReferencePreserved']is False and f['actualLateBytesMatched']is True
        else:result['receiptStates']['validation']='INVALID'
    s=receipts.get('supervisor')
    if result['receiptStates']['supervisor']=='PRESENT':
        if type(s)is dict and type(s.get('code'))is int and type(s.get('events'))is list and type(s.get('remainingPids'))is list and type(s.get('cgroupRemoved'))is bool and 'failure'in s:
            result['naturalSupervisorExit']=s['code']==0 and s['failure']is None and not s['events']and not s['remainingPids']and s['cgroupRemoved']is True
        else:result['receiptStates']['supervisor']='INVALID'
    c=receipts.get('cleanup')
    if result['receiptStates']['cleanup']=='PRESENT':
        if type(c)is dict and c.get('status')in {'CLEAN_NO_EMERGENCY','FAIL'}and type(c.get('errors'))is list and type(c.get('groups'))is list and type(c.get('emergencyCleanupInvalidatesPass'))is bool and type(c.get('cleanupFailureInvalidatesPass'))is bool:
            result['outerCleanupClean']=c['status']=='CLEAN_NO_EMERGENCY'and not c['errors']and not c['emergencyCleanupInvalidatesPass']and not c['cleanupFailureInvalidatesPass']and all(type(x)is dict and x.get('forced')is False and x.get('removed')is True and x.get('afterPids')==[]for x in c['groups'])and type(c.get('keyScope'))is dict and c['keyScope'].get('code')==0 and c['keyScope'].get('presentBefore')is False and c['keyScope'].get('absentAfter')is True
        else:result['receiptStates']['cleanup']='INVALID'
    security=receipts.get('security')
    if result['receiptStates']['security']=='PRESENT':
        if type(security)is dict and security.get('status')in {'AUTHENTICATED_STAGED_NOT_RUNTIME_PASS','PREPARATION_FAIL'}and type(security.get('forced'))is bool and type(security.get('cleanupErrors'))is list and type(security.get('rootKeyScopeAbsent'))is bool:
            result['securityStaged']=security['status']=='AUTHENTICATED_STAGED_NOT_RUNTIME_PASS'and not security['forced']and not security['cleanupErrors']
            result['rootKeyScopeAbsent']=security['rootKeyScopeAbsent']
        else:result['receiptStates']['security']='INVALID'
    supervisor=receipts.get('supervisor')
    if states.get('supervisor')=='PRESENT':result['supervisorDiagnostic']=project_supervisor(supervisor)
    fallback=receipts.get('supervisorReceiptFailure')
    if states.get('supervisorReceiptFailure')=='PRESENT'and type(fallback)is dict and fallback.get('version')==1 and fallback.get('receiptWriteFailed')is True:
        result['supervisorReceiptWriteFailed']=True
        if result['supervisorDiagnostic']is None:result['supervisorDiagnostic']=project_supervisor(fallback)
    n=receipts.get('namespace')
    if states.get('namespace')=='PRESENT'and type(n)is dict and n.get('version')==1 and n.get('operation')in NAMESPACE_STAGES:result['namespaceOperation']=n['operation']
    for name,key in [('driverLaunch','nodeLaunchAttempted'),('driverStarted','driverStarted')]:
        value=receipts.get(name)
        if states.get(name)=='PRESENT'and type(value)is dict and value.get('version')==1 and value.get(key)is True:result[key]=True
    for name in ['validation','driverReceiptFailure']:
        value=receipts.get(name)
        if states.get(name)!='PRESENT'or type(value)is not dict:continue
        first=fixed_driver(value.get('firstFailure'))
        if first is not None and result['driverFirstFailure']is None:result['driverFirstFailure']=first
        late=value.get('lateFailures')
        if type(late)is list and len(late)<=32 and all(fixed_driver(x)is not None for x in late):result['driverLateFailures']=[fixed_driver(x)for x in late]
        if value.get('receiptWriteFailed')is True:result['driverReceiptWriteFailed']=True
    if all(result[k]is True for k in ['helperFilesystemComplete','fullModuleTypecheckComplete','naturalSupervisorExit','outerCleanupClean','securityStaged','rootKeyScopeAbsent'])and result['hostStage']=='COMPLETE'and result['hostFailure']is None and all(result['receiptStates'][name]=='PRESENT'for name in ['host','security','validation','supervisor','cleanup'])and result['driverReceiptWriteFailed']is not True and result['supervisorReceiptWriteFailed']is not True:
        result['status']='SCOPED_COMPILER_HELPER_FILESYSTEM_COMPLETE_NOT_PRODUCT_ACCEPTANCE'
    return result
