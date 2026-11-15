"""SOURCE ONLY fixed public projection. Raw runtime remains private."""
from pathlib import Path
import json,os,stat
from finite_projection import project

def read(path):
    fd=None
    try:
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or before.st_size>2*1024**2:return None,'INVALID'
        raw=bytearray()
        while len(raw)<=2*1024**2:
            data=os.read(fd,min(65536,2*1024**2+1-len(raw)))
            if not data:break
            raw.extend(data)
        after=os.fstat(fd)
        if len(raw)!=before.st_size or(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):return None,'INVALID'
        def pairs(items):
            value={}
            for k,v in items:
                if k in value:raise ValueError('DUPLICATE')
                value[k]=v
            return value
        value=json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('NONFINITE')))
        return(value,'PRESENT')if type(value)is dict else(None,'INVALID')
    except FileNotFoundError:return None,'MISSING'
    except (ValueError,UnicodeError):return None,'INVALID'
    except BaseException:return None,'UNREADABLE'
    finally:
        if fd is not None:os.close(fd)

def main():
    root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui/evidence';values={};states={}
    for name,path in [('host','docker-host.json'),('envelope','docker-envelope.json'),('outer','docker-outer-cleanup.json'),('driver','product-validation.json')]:
        try:values[name],states[name]=read(root/path)
        except BaseException:values[name]=None;states[name]='UNREADABLE'
    out=project(values['envelope'],values['outer'],values['driver']);out['receiptStates']=states
    host=values['host'];out['hostStage']=None;out['hostFailure']=None
    stages={'PUBLIC_PLATFORM','SOURCE_CUSTODY','NODE_IDENTITY','ENGINE_ANTI_DRIFT_PIN','TOOLCHAIN','SOURCE_COPY','QUALIFICATION_THEN_UNCHANGED_DRIVER','COMPLETE_SCOPED_ONLY'}
    if type(host)is dict and host.get('version')==1 and type(host.get('stage'))is str and host.get('stage')in stages and host.get('failure')in {None,'INCOMPLETE'}:
        out['hostStage']=host['stage'];out['hostFailure']=host['failure']
    if not all(s=='PRESENT'for s in states.values())or out['hostStage']!='COMPLETE_SCOPED_ONLY'or out['hostFailure']is not None or host.get('forced')is not False:out['status']='INCOMPLETE'
    print(json.dumps(out,sort_keys=True));return 0 if out['status']=='SCOPED_COMPILER_HELPER_FILESYSTEM_ONLY'else 1
if __name__=='__main__':raise SystemExit(main())
