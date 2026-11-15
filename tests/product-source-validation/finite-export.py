"""Read every available receipt independently. Missing evidence is unknown."""
from pathlib import Path
import json,os,stat
from finite_projection import project

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
    result=project(receipts,states)
    print(json.dumps(result,sort_keys=True))
    return 0 if result['status']!='INCOMPLETE'else 1
if __name__=='__main__':raise SystemExit(main())
