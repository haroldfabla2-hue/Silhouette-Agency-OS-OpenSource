"""Read every available receipt independently. Missing evidence is unknown."""
from pathlib import Path
import json,os,stat
from finite_projection import project
from launcher.bootstrap_projection import project_bootstrap

def read_receipt(path):
    fd=None
    try:
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or before.st_size>2*1024**2:return None,'INVALID'
        raw=bytearray()
        while len(raw)<=2*1024**2:
            block=os.read(fd,min(65536,2*1024**2+1-len(raw)))
            if not block:break
            raw.extend(block)
        after=os.fstat(fd)
        if len(raw)>2*1024**2 or len(raw)!=before.st_size or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):return None,'INVALID'
        def pairs(items):
            result={}
            for key,value in items:
                if key in result:raise ValueError('DUPLICATE_KEY')
                result[key]=value
            return result
        value=json.loads(bytes(raw),object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('NONFINITE')))
        return (value,'PRESENT')if type(value)is dict else(None,'INVALID')
    except FileNotFoundError:return None,'MISSING'
    except (ValueError,UnicodeError):return None,'INVALID'
    except BaseException:return None,'UNREADABLE'
    finally:
        if fd is not None:os.close(fd)

def main():
    root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui/evidence'
    paths={'host':'host-validation.json','security':'security-preparation.json','validation':'product-validation/product-validation.json','supervisor':'product-validation/supervisor.json','cleanup':'outer-cleanup.json','namespace':'product-validation/namespace-fixed.json','driverLaunch':'product-validation/driver-launch.json','driverStarted':'product-validation/driver-started.json','driverReceiptFailure':'product-validation/driver-receipt-failure.json','supervisorReceiptFailure':'product-validation/supervisor-receipt-failure.json'}
    receipts={};states={}
    for name,relative in paths.items():
        # Per-receipt read/close failures never skip any other receipt.
        try:receipts[name],states[name]=read_receipt(root/relative)
        except BaseException:receipts[name]=None;states[name]='UNREADABLE'
    bootstrap=None;bootstrapState='MISSING';fd=None
    try:
        fd=os.open(root/'product-validation/python-bootstrap.jsonl',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or before.st_size>4096:bootstrapState='INVALID'
        else:
            raw=os.read(fd,4097);after=os.fstat(fd)
            if len(raw)!=before.st_size or(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):bootstrapState='INVALID'
            else:bootstrap=project_bootstrap(raw);bootstrapState='PRESENT'
    except FileNotFoundError:pass
    except BaseException:bootstrapState='UNREADABLE'
    finally:
        try:
            if fd is not None:os.close(fd)
        except BaseException:bootstrapState='UNREADABLE'
    try:bootstrapFallback,bootstrapFallbackState=read_receipt(root/'product-validation/python-bootstrap-receipt-failure.json')
    except BaseException:bootstrapFallback=None;bootstrapFallbackState='UNREADABLE'
    result=project(receipts,states)
    result['pythonBootstrapState']=bootstrapState;result['pythonBootstrap']=bootstrap
    result['pythonBootstrapReceiptFailureState']=bootstrapFallbackState;result['pythonBootstrapReceiptWriteFailed']=None
    if bootstrapFallbackState=='PRESENT':
        if type(bootstrapFallback)is dict and set(bootstrapFallback)=={'version','operation','receiptWriteFailed','productPass'}and type(bootstrapFallback['version'])is int and bootstrapFallback['version']==1 and type(bootstrapFallback['operation'])is str and bootstrapFallback['operation']in {'PYTHON_STARTED','SOURCE_READ','SOURCE_COMPILE','SOURCE_EXEC'}and bootstrapFallback['receiptWriteFailed']is True and bootstrapFallback['productPass']is False:result['pythonBootstrapReceiptWriteFailed']=True
        else:result['pythonBootstrapReceiptFailureState']='INVALID'
    if bootstrapFallbackState!='MISSING'or bootstrapState!='PRESENT'or bootstrap is None or bootstrap['status']!='OBSERVED_NOT_ACCEPTANCE'or bootstrap['operation']!='SOURCE_EXEC'or result['bwrapStatus']is None or result['bwrapStatus']['status']!='PRE_EXEC_MARKER_WITHOUT_REPORTED_EXEC_FAILURE'or result['bwrapStatus']['exitCode']!=0:result['status']='INCOMPLETE'
    print(json.dumps(result,sort_keys=True))
    return 0 if result['status']!='INCOMPLETE'else 1
if __name__=='__main__':raise SystemExit(main())
