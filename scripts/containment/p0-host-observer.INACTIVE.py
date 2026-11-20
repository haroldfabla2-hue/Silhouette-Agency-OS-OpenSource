
"""Fixed-runtime preparation utilities. No application payload release."""
import argparse
import json
import os
from pathlib import Path
import select
import time


def need(value,code):
    if not value:raise RuntimeError(code)


def starttime(pid):


    raw=Path('/proc',str(pid),'stat').read_text()
    return int(raw[raw.rfind(')')+2:].split()[19])


def readat(directory,name):
    fd=os.open(name,os.O_RDONLY|os.O_CLOEXEC,dir_fd=directory)
    try:
        raw=os.read(fd,65537);need(len(raw)<=65536,'CGROUP_FILE_TOO_LARGE')
        return raw.decode().strip()
    finally:os.close(fd)


def inode(fd):
    value=os.fstat(fd)
    return (value.st_dev,value.st_ino)


def observe(pid,expected_start,cgroup_path,expected_inode,receipt_fd,ready_fd,deadline):
    path=Path(cgroup_path)
    need(path.is_absolute() and path.is_relative_to('/sys/fs/cgroup') and str(path)!='/sys/fs/cgroup','UNSAFE_CGROUP')
    pidfd=os.pidfd_open(pid,0)
    directory=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
    identity=inode(directory)
    result={'kind':'EMPTY_OBSERVER','emptyObservedBeforeDisappearance':False,'result':'UNKNOWN','pid':pid,'starttime':expected_start,'cgroupDeviceInode':identity}
    try:
        need(identity==tuple(expected_inode),'CGROUP_ANCHOR_CHANGED')
        need(starttime(pid)==expected_start,'PID_START_CHANGED')
        membership=Path('/proc',str(pid),'cgroup').read_text().strip()
        relative='/' + str(path.relative_to('/sys/fs/cgroup'))
        need(membership=='0::'+relative,'MEMBERSHIP_CHANGED')
        initial=readat(directory,'cgroup.procs').splitlines()
        need(initial==[str(pid)],'P0_CGROUP_NOT_EXCLUSIVELY_GATE')
        need(readat(directory,'pids.current')=='1','P0_GATE_TASK_CENSUS')


        ancestors=[];current=path
        while current!=Path('/sys/fs/cgroup'):
            entry={'path':str(current)}
            for key in ('memory.max','memory.swap.max','pids.max','cpu.max'):
                entry[key]=(current/key).read_text().strip()

            for key,minimum in (('memory.max',134217728),('pids.max',16)):
                need(entry[key]=='max' or int(entry[key])>=minimum,'ANCESTOR_TIGHTER_'+key)
            quota,period=entry['cpu.max'].split()
            need(quota=='max' or int(quota)*100000>=25000*int(period),'ANCESTOR_TIGHTER_CPU')
            ancestors.append(entry);current=current.parent
        result['ancestors']=ancestors


        os.write(ready_fd,b'R');os.close(ready_fd);ready_fd=None
        while time.monotonic()<deadline:
            try:
                st=os.stat(path);need((st.st_dev,st.st_ino)==identity,'CGROUP_PATH_REPLACED')
                need(inode(directory)==identity,'CGROUP_DESCRIPTOR_REPLACED')
                events=readat(directory,'cgroup.events').splitlines()
                procs=readat(directory,'cgroup.procs')
                threads=readat(directory,'cgroup.threads')
                if 'populated 0' in events and not procs and not threads:
                    st=os.stat(path);need((st.st_dev,st.st_ino)==identity,'CGROUP_CHANGED_AFTER_EMPTY')
                    result['emptyObservedBeforeDisappearance']=True
                    result['result']='OBSERVED_EMPTY_SAME_CGROUP'
                    result['emptyObservedMonotonicNs']=time.monotonic_ns()
                    break

                if not select.select([pidfd],[],[],0)[0]:
                    need(starttime(pid)==expected_start,'LIVE_PID_CHANGED')
            except FileNotFoundError:
                result['reason']='DISAPPEARED_BEFORE_EMPTY_PROOF';break
            time.sleep(.001)
        else:result['reason']='OBSERVER_DEADLINE'
    except Exception as error:result['reason']=str(error)[:160]
    finally:
        if ready_fd is not None:os.close(ready_fd)


        raw=(json.dumps(result,sort_keys=True)+'\n').encode()
        os.write(receipt_fd,raw);os.fsync(receipt_fd)
        os.close(receipt_fd);os.close(directory);os.close(pidfd)
    return result


if __name__=='__main__':
    raise SystemExit('INACTIVE COMPONENT: no standalone execution or controller supplied')
