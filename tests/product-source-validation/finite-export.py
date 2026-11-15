"""Fixed authored-fixture validation counts only; never raw compiler/source."""
from pathlib import Path
import json,os
root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui/evidence'
result={'version':1,'status':'INCOMPLETE','helperFilesystemComplete':False,'fullModuleTypecheckComplete':False,
        'realCaseCount':0,'failedCaseCount':0,'baselineOverwriteObserved':False,
        'naturalSupervisorExit':False,'outerCleanupClean':False,'productPass':False}
try:
    def read(relative):
        p=root/relative;assert p.is_file()and not p.is_symlink()and p.stat().st_size<=2*1024**2
        return json.loads(p.read_text())
    source=read('product-validation/product-validation.json')
    for key in ['helperFilesystemComplete','fullModuleTypecheckComplete']:
        assert type(source[key])is bool;result[key]=source[key]
    cases=source['realCases'];assert type(cases)is list and len(cases)<=32
    assert all(type(x)is dict and type(x.get('pass'))is bool for x in cases)
    result['realCaseCount']=len(cases);result['failedCaseCount']=sum(not x['pass']for x in cases)
    finding=source.get('baselineFinding')
    result['baselineOverwriteObserved']=type(finding)is dict and finding.get('originalReferencePreserved')is False and finding.get('actualLateBytesMatched')is True
    supervisor=read('product-validation/supervisor.json')
    result['naturalSupervisorExit']=supervisor.get('code')==0 and not supervisor.get('failure')and not supervisor.get('events')and not supervisor.get('remainingPids')and supervisor.get('cgroupRemoved')is True
    cleanup=read('outer-cleanup.json');result['outerCleanupClean']=cleanup.get('status')=='CLEAN_NO_EMERGENCY'and not cleanup.get('errors')and not cleanup.get('emergencyCleanupInvalidatesPass')
    if all(result[x]for x in ['helperFilesystemComplete','fullModuleTypecheckComplete','naturalSupervisorExit','outerCleanupClean']):
        result['status']='SCOPED_COMPILER_HELPER_FILESYSTEM_COMPLETE_NOT_PRODUCT_ACCEPTANCE'
except BaseException:pass
print(json.dumps(result,sort_keys=True))
raise SystemExit(0 if result['status']!='INCOMPLETE'else 1)
