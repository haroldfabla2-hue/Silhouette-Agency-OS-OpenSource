"""Fixed explicit-input projection; no filesystem, imports or runtime acceptance."""
RECEIPT_NAMES=('host','security','validation','supervisor','cleanup')
def project(receipts,states):
    result={'version':2,'status':'INCOMPLETE','receiptStates':{},'hostStage':None,'hostFailure':None,
        'helperFilesystemComplete':None,'fullModuleTypecheckComplete':None,'realCaseCount':None,
        'failedCaseCount':None,'baselineOverwriteObserved':None,'naturalSupervisorExit':None,
        'outerCleanupClean':None,'securityStaged':None,'rootKeyScopeAbsent':None,'productPass':False}
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
    if all(result[k]is True for k in ['helperFilesystemComplete','fullModuleTypecheckComplete','naturalSupervisorExit','outerCleanupClean','securityStaged','rootKeyScopeAbsent'])and result['hostStage']=='COMPLETE'and result['hostFailure']is None and all(x=='PRESENT'for x in result['receiptStates'].values()):
        result['status']='SCOPED_COMPILER_HELPER_FILESYSTEM_COMPLETE_NOT_PRODUCT_ACCEPTANCE'
    return result
