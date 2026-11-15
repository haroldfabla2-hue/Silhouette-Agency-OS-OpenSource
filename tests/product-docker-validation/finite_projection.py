"""Pure fixed finite summary for the candidate route. No filesystem/authority."""
def project(envelope,outer,driver):
    out={'version':1,'status':'INCOMPLETE','safetyQualified':None,'driverNaturalExit':None,'outerCleanupClean':None,'helperFilesystemComplete':None,'fullModuleTypecheckComplete':None,'realCaseCount':None,'failedCaseCount':None,'productPass':False}
    if type(envelope)is dict and envelope.get('version')==1 and type(envelope.get('actualSafetyChecksComplete'))is bool:
        out['safetyQualified']=envelope['actualSafetyChecksComplete']
        out['driverNaturalExit']=envelope.get('status')=='ENVELOPE_AND_SCOPED_DRIVER_ONLY'and envelope.get('released')is True and envelope.get('actualSafetyChecksComplete')is True and type(envelope.get('code'))is int and envelope['code']==0 and envelope.get('failureType')is None and envelope.get('lateFailureTypes')==[]and envelope.get('forced')is False and envelope.get('oomObserved')is False
    if type(outer)is dict and outer.get('version')==1:
        out['outerCleanupClean']=outer.get('status')=='CLEAN'and outer.get('absent')is True and outer.get('forced')is False and type(outer.get('errors'))is int and outer['errors']==0
    if type(driver)is dict:
        cases=driver.get('realCases');compiles=driver.get('fullModuleTypechecks');helpers=driver.get('helperCompiles')
        if type(cases)is list and len(cases)<=32 and all(type(x)is dict and type(x.get('pass'))is bool for x in cases):
            out['realCaseCount']=len(cases);out['failedCaseCount']=sum(x['pass']is False for x in cases)
            out['helperFilesystemComplete']=driver.get('helperFilesystemComplete')is True and len(cases)==16 and out['failedCaseCount']==0 and type(helpers)is list and len(helpers)==4 and all(type(x)is dict and x.get('complete')is True for x in helpers)and driver.get('receiptWriteFailed')is False
        if type(compiles)is list and len(compiles)==4 and all(type(x)is dict and x.get('complete')is True for x in compiles):out['fullModuleTypecheckComplete']=driver.get('fullModuleTypecheckComplete')is True
    if all(out[k]is True for k in ['safetyQualified','driverNaturalExit','outerCleanupClean','helperFilesystemComplete','fullModuleTypecheckComplete']):out['status']='SCOPED_COMPILER_HELPER_FILESYSTEM_ONLY'
    return out
