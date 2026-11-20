
"""Fixed-runtime preparation utilities. No application payload release."""
import argparse
import fcntl
import http.client
import json
import os
from pathlib import Path
import re
import select
import signal
import socket
import stat
import time
import threading
import importlib.util
import subprocess
import selectors
import shutil
import urllib.parse

IMAGE = 'node@sha256:650d460b4e6b02411caa0e563838f07fafc9792314d5091859d837d8b070712b'
API = '/v1.48'
MEM = 134217728
GATE = 'IFS= read -r token; exit 97'
DEFAULT_RO = ['/proc/bus','/proc/fs','/proc/irq','/proc/sys','/proc/sysrq-trigger']
MASK_BASE = ['/proc/asound','/proc/acpi','/proc/interrupts','/proc/kcore','/proc/keys','/proc/latency_stats','/proc/timer_list','/proc/timer_stats','/proc/sched_debug','/proc/scsi','/sys/firmware','/sys/devices/virtual/powercap']
AUX = ['/proc','/dev','/dev/pts','/dev/mqueue','/dev/shm','/etc/hosts','/etc/hostname','/etc/resolv.conf']


FAILURE_CONTEXT={}

def require(value, code,actual=None,expected=None):
    if not value:
        FAILURE_CONTEXT.update({'checkCode':code,'actual':actual,'expected':expected})
        raise RuntimeError(code)


class Engine(http.client.HTTPConnection):
    def __init__(self, deadline):
        self.deadline = deadline
        super().__init__('localhost', timeout=max(.01, deadline-time.monotonic()))

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(max(.01, self.deadline-time.monotonic()))
        self.sock.connect('/var/run/docker.sock')


def request(method, route, deadline, body=None):
    require(time.monotonic() < deadline, 'CONTROL_DEADLINE')
    conn = Engine(deadline)
    try:
        conn.request(method, API+route, body=json.dumps(body) if body is not None else None,
                     headers={'Content-Type':'application/json'})
        response=conn.getresponse();raw=response.read(262145)
        require(len(raw)<=262144,'CONTROL_RESPONSE_LIMIT')
        require(200<=response.status<300,'ENGINE_HTTP_'+str(response.status))
        require(time.monotonic()<deadline,'CONTROL_DEADLINE')
        return json.loads(raw) if raw else None
    finally:
        conn.close()


def policy():


    thermal=sorted(str(p) for p in Path('/sys/devices/system/cpu').glob('cpu[0-9]*/thermal_throttle') if p.is_dir())
    return MASK_BASE+thermal


def creation(masks, parent):


    return {'Image':IMAGE,'User':'1000:1000','Entrypoint':['/bin/sh'],
            'Cmd':['-c',GATE],'WorkingDir':'/work','Env':['PATH=/usr/bin:/bin','LC_ALL=C'],
            'OpenStdin':True,'StdinOnce':False,'AttachStdin':False,'Tty':False,'StopTimeout':2,
            'HostConfig':{'CgroupParent':parent,'ReadonlyRootfs':True,'ReadonlyPaths':DEFAULT_RO+AUX+masks,
                'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges'],
                'NetworkMode':'none','IpcMode':'private','CgroupnsMode':'private','Runtime':'runc',
                'Memory':MEM,'MemorySwap':MEM,'PidsLimit':16,'CpuPeriod':100000,'CpuQuota':25000,
                'Privileged':False,'AutoRemove':False,'RestartPolicy':{'Name':'no'},
                'LogConfig':{'Type':'none'},
                'Tmpfs':{'/work':'rw,nosuid,nodev,noexec,size=1048576,nr_inodes=64,uid=1000,gid=1000,mode=0700'}}}


def text(path):
    return Path(path).read_text().strip()


def mounts(pid):
    records=[]
    for line in text('/proc/'+str(pid)+'/mountinfo').splitlines():
        left,right=line.split(' - ');a=left.split();b=right.split()


        require(not any('\\' in p for p in (a[3],a[4],b[1])),'ESCAPED_MOUNT_PATH')
        records.append({'id':a[0],'parent':a[1],'device':a[2],'root':a[3],'target':a[4],
                        'flags':a[5].split(','),'propagation':a[6:],'fs':b[0],
                        'source':b[1],'super':b[2].split(',')})
    return records


def live_cgroup(pid):
    lines=text('/proc/'+str(pid)+'/cgroup').splitlines()
    require(len(lines)==1 and lines[0].startswith('0::/'),'UNIFIED_CGROUP_REQUIRED')
    relative=Path(lines[0][3:]);require(str(relative)!='/' and '..' not in relative.parts,'ROOT_OR_UNSAFE_CGROUP')
    cg=Path('/sys/fs/cgroup').joinpath(*relative.parts[1:])
    require(str(pid) in text(cg/'cgroup.procs').splitlines(),'CGROUP_MEMBERSHIP_MISMATCH')
    return cg


def check_deadline(deadline):
    require(time.monotonic()<deadline,'GATE_DEADLINE_EXCEEDED')


def audit(cid, image_id, masks, deadline,ledger,domain):
    check_deadline(deadline)
    require(image_id.startswith('sha256:') and len(image_id)==71,'IMAGE_CONFIG_ID')
    v=request('GET','/containers/'+cid+'/json',deadline);h=v['HostConfig'];c=v['Config'];s=v['State']
    require(v['Image']==image_id and s['Running'] and s['Pid']>0,'GATE_NOT_LIVE')
    require(c['User']=='1000:1000' and c['Entrypoint']==['/bin/sh'] and c['Cmd']==['-c',GATE] and not c['Tty'],'GATE_CONFIG_CHANGED')
    expected=creation(masks,domain.name)['HostConfig']
    for key in ('CgroupParent','ReadonlyRootfs','ReadonlyPaths','CapDrop','SecurityOpt','NetworkMode','IpcMode','CgroupnsMode','Runtime','Memory','MemorySwap','PidsLimit','CpuPeriod','CpuQuota','Privileged','AutoRemove','Tmpfs'):
        require(h.get(key)==expected[key],'INSPECT_MISMATCH_'+key,h.get(key),expected[key])

    require(set(h.get('MaskedPaths') or [])==set(masks),'MASK_DEFAULTS_MISMATCH')
    for key in ('Binds','Devices','DeviceRequests','VolumesFrom','PortBindings','ExtraHosts','Sysctls','CapAdd'):
        require(not h.get(key),'UNEXPECTED_HOST_EXPOSURE_'+key)
    require(not h.get('PidMode') and not h.get('UTSMode'),'HOST_NAMESPACE')
    pid=s['Pid'];cg=live_cgroup(pid)
    expected_start=domain.occupied_anchor['starttime']
    require(pid==domain.occupied_anchor['pid'],'AUDIT_GATE_PID_CHANGED')
    root=load_component('p0-rooted-paths.INACTIVE.py').Root(pid,expected_start)
    try:
        status=dict(line.split(':',1) for line in text('/proc/'+str(pid)+'/status').splitlines() if ':' in line)
        require(status['Uid'].split()==['1000']*4 and status['Gid'].split()==['1000']*4,'LIVE_IDENTITY')
        for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb'):
            require(int(status[key],16)==0,'LIVE_CAPABILITY_'+key,int(status[key],16),0)
        require(status['NoNewPrivs'].strip()=='1' and status['Seccomp'].strip()=='2','LIVE_SECURITY')
        require(text('/proc/'+str(pid)+'/attr/current').startswith('docker-default '),'DEFAULT_APPARMOR_NOT_PROVED')
        require(Path('/proc',str(pid),'cmdline').read_bytes().split(b'\x00')[:3]==[b'/bin/sh',b'-c',GATE.encode()],'LIVE_GATE_COMMAND')
        executable=os.stat('/proc/'+str(pid)+'/exe');shell=(root/'bin/sh').stat()
        require((executable.st_dev,executable.st_ino)==(shell.st_dev,shell.st_ino),'LIVE_GATE_EXECUTABLE')
        for ns in ('mnt','net','pid','ipc','uts','cgroup'):
            require(os.readlink('/proc/'+str(pid)+'/ns/'+ns)!=os.readlink('/proc/self/ns/'+ns),'SHARED_NAMESPACE_'+ns)
        metrics={key:text(cg/key) for key in ('memory.max','memory.swap.max','pids.max','cpu.max')}
        net_lines=text('/proc/'+str(pid)+'/net/dev').splitlines()[2:]
        require({line.split(':',1)[0].strip() for line in net_lines}=={'lo'},'NONLOOPBACK_INTERFACE')
        for name in ('tcp','tcp6','udp','udp6'):
            require(len(text('/proc/'+str(pid)+'/net/'+name).splitlines())==1,'UNEXPECTED_NETWORK_SOCKET')
        require(metrics=={'memory.max':str(MEM),'memory.swap.max':'0','pids.max':'16','cpu.max':'25000 100000'},'LIVE_LIMITS')
        all_rows=mounts(pid)
        save_state(Path(ledger)/'mount-inventory.json',{'rows':all_rows})
        index={row['id']:row for row in all_rows};visible={}


        for row in all_rows:
            check_deadline(deadline)
            save_state(Path(ledger)/'audit-progress.json',{'stage':'MOUNT_RESOLUTION','target':row['target']})
            target=root/row['target'].lstrip('/')
            fd=target.open(os.O_PATH)
            try:
                fields=dict(line.split(':',1) for line in Path('/proc/self/fdinfo',str(fd)).read_text().splitlines() if ':' in line)
                resolved=fields['mnt_id'].strip()
                require(resolved in index,'MOUNT_ID_OUTSIDE_GATE_TABLE')
                effective=index[resolved]
                require(effective['target']==row['target'],'UNPROVED_MOUNT_TOPOLOGY')
                visible[resolved]=effective
            finally:os.close(fd)
        rows=list(visible.values())
        save_state(Path(ledger)/'reachable-mounts.json',{'rows':rows,'hiddenMountCount':len(all_rows)-len(rows)})
        by={}
        for row in rows:by.setdefault(row['target'],[]).append(row)

        allowed={'/','/work','/sys','/sys/fs/cgroup',*AUX,*DEFAULT_RO,*masks}
        require(set(by)<=allowed,'UNKNOWN_SUBMOUNT')
        require({'/','/work','/sys','/sys/fs/cgroup',*AUX}<=set(by),'MISSING_REQUIRED_MOUNT')
        types={'/':'overlay','/work':'tmpfs','/proc':'proc','/dev':'tmpfs','/dev/pts':'devpts','/dev/shm':'tmpfs','/dev/mqueue':'mqueue','/sys':'sysfs','/sys/fs/cgroup':'cgroup2'}
        for row in rows:
            check_deadline(deadline)
            save_state(Path(ledger)/'audit-progress.json',{'stage':'MOUNT_VALIDATION','target':row['target']})
            target=row['target'];flags=set(row['flags'])
            require(not row['propagation'],'NONPRIVATE_MOUNT')
            require(('rw' in flags and 'ro' not in flags) if target=='/work' else ('ro' in flags and 'rw' not in flags),'WRITABLE_AUXILIARY')
            if target in types:require(row['fs']==types[target],'FILESYSTEM_MISMATCH')
            if target in DEFAULT_RO:require(row['fs']=='proc','PROC_SUBMOUNT_MISMATCH')
            if target in masks:require(row['fs']=='tmpfs','MASK_FILESYSTEM_MISMATCH')
            if target not in masks and target not in ('/','/work','/dev','/etc/hosts','/etc/hostname','/etc/resolv.conf'):
                require('nosuid' in flags and 'noexec' in flags,'AUX_FLAGS')
            if target=='/work':
                require({'nosuid','nodev','noexec'}<=flags,'WORK_FLAGS')
                require({'size=1024k','nr_inodes=64'}<=set(row['super']),'WORK_CAPACITY_OPTIONS')


        null_stat=(root/'dev/null').stat()
        for target in masks:
            check_deadline(deadline)
            save_state(Path(ledger)/'audit-progress.json',{'stage':'MASK_VALIDATION','target':target})
            try:target_stat=(root/target.lstrip('/')).stat()
            except FileNotFoundError:continue
            require(target in by,'MASK_NOT_MOUNTED')
            if stat.S_ISDIR(target_stat.st_mode):
                require(all(row['root']=='/' and row['source']=='tmpfs' for row in by[target]),'MASK_DIRECTORY_ROOT')
                masked_stat=(root/target.lstrip('/')).statvfs()
                require(masked_stat.f_files in (1,2) and masked_stat.f_blocks==1,'MASK_DIRECTORY_CAPACITY')
            else:


                require(stat.S_ISCHR(target_stat.st_mode) and
                        (target_stat.st_dev,target_stat.st_ino,target_stat.st_rdev)==
                        (null_stat.st_dev,null_stat.st_ino,null_stat.st_rdev),'MASK_FILE_SOURCE_IDENTITY')
        for row in rows:
            if row['target'] in ('/proc','/sys','/dev/pts','/dev/mqueue','/sys/fs/cgroup'):
                expected_source={'/proc':'proc','/sys':'sysfs','/dev/pts':'devpts','/dev/mqueue':'mqueue','/sys/fs/cgroup':'cgroup'}[row['target']]
                require(row['source']==expected_source,'PSEUDO_SOURCE_MISMATCH')
                st=(root/row['target'].lstrip('/')).stat()
                require(row['device']==str(os.major(st.st_dev))+':'+str(os.minor(st.st_dev)),'MOUNT_DEVICE_MISMATCH')
        save_state(Path(ledger)/'audit-progress.json',{'stage':'WORK_VALIDATION','target':'/work'})
        work=root/'work';sv=work.statvfs();st=work.stat()
        require(sv.f_blocks*sv.f_frsize==1048576 and sv.f_files==64,'WORK_STATFS_CAPACITY')
        require(st.st_uid==1000 and st.st_gid==1000 and stat.S_IMODE(st.st_mode)==0o700,'WORK_OWNERSHIP')

        for target,key in (('/etc/hosts','HostsPath'),('/etc/hostname','HostnamePath'),('/etc/resolv.conf','ResolvConfPath')):
            host=Path(v[key]);a=os.stat(host);b=(root/target.lstrip('/')).stat()
            require((a.st_dev,a.st_ino)==(b.st_dev,b.st_ino) and stat.S_ISREG(b.st_mode),'GENERATED_FILE_IDENTITY')
        devices={'null':(1,3),'zero':(1,5),'full':(1,7),'random':(1,8),'urandom':(1,9),'tty':(5,0)}
        for p in (root/'dev').iterdir():
            check_deadline(deadline)
            save_state(Path(ledger)/'audit-progress.json',{'stage':'DEVICE_VALIDATION','target':'/dev'})
            if p.is_symlink():
                links={'fd':{'/proc/self/fd'},'stdin':{'/proc/self/fd/0'},
                       'stdout':{'/proc/self/fd/1'},'stderr':{'/proc/self/fd/2'},
                       'ptmx':{'pts/ptmx','/dev/pts/ptmx'},'core':{'/proc/kcore'}}
                require(p.name in links and p.readlink() in links[p.name],'UNKNOWN_DEVICE_SYMLINK')
                continue
            if p.name in ('pts','shm','mqueue'):continue
            require(p.name in devices,'UNKNOWN_DEVICE_ENTRY')
            st=p.stat();require(stat.S_ISCHR(st.st_mode) and (os.major(st.st_rdev),os.minor(st.st_rdev))==devices[p.name],'DEVICE_IDENTITY')
        try:
            socket_object=(root/'var/run/docker.sock').stat()
        except FileNotFoundError:
            socket_evidence={'result':'ROOTED_ENOENT','rootIdentity':list(root.identity)}
        else:
            socket_evidence={'result':'ROOTED_OBJECT_FOUND','inode':[socket_object.st_dev,socket_object.st_ino],
                             'objectType':stat.S_IFMT(socket_object.st_mode)}
            save_state(Path(ledger)/'socket.json',socket_evidence)
            require(False,'SOCKET_OBJECT_PRESENT_ROOTED')
        save_state(Path(ledger)/'socket.json',socket_evidence)

        fd_path=Path('/proc',str(pid),'fd')
        require(set(p.name for p in fd_path.iterdir())== {'0','1','2'},'EXTRA_OR_MISSING_HOST_FD')
        require(all(os.readlink(fd_path/str(n)).startswith('pipe:[') for n in (0,1,2)),'UNEXPECTED_STANDARD_FD_KIND')
        check_deadline(deadline)
        return {'pid':pid,'cgroup':str(cg),'limits':metrics,'reachableMounts':rows,'hiddenMountCount':len(all_rows)-len(rows),
                'characterDeviceIO':'null/zero/full/random/urandom/tty permitted, not alternate regular-file storage',
                'admittedForPreparationOnly':True}
    finally:
        root.close()


def save_state(path,value):

    path=Path(path);temporary=path.with_name(path.name+'.'+str(os.getpid())+'.tmp')
    with open(temporary,'x') as stream:
        os.fchmod(stream.fileno(),0o600);json.dump(value,stream);stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)
    directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(directory)
    finally:os.close(directory)


def operation(method,route,ledger,key,deadline,body=None):
    path=Path(ledger)/(key+'.json')

    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    state={'transportDone':False,'responseObserved':False,'daemonOutcomeKnown':False,
           'httpStatus':None,'method':method,'operation':key}
    os.write(fd,json.dumps(state).encode());os.fsync(fd);os.close(fd)
    def work():
        conn=Engine(deadline)
        try:
            conn.request(method,API+route,body=json.dumps(body) if body is not None else None,
                         headers={'Content-Type':'application/json'})
            response=conn.getresponse();raw=response.read(262145)
            require(len(raw)<=262144,'CONTROL_RESPONSE_LIMIT')
            state['httpStatus']=response.status
            state['responseObserved']=True

            if 200<=response.status<300:
                value=json.loads(raw) if raw else None
                state['value']=value;state['daemonOutcomeKnown']=True
            else:state['error']='HTTP_NON_SUCCESS'
        except Exception:
            state['daemonOutcomeKnown']=False;state['error']='TRANSPORT_OR_RESPONSE_UNCERTAIN'
        finally:
            state['transportDone']=True;conn.close();save_state(path,state)
    thread=threading.Thread(target=work,daemon=True);thread.start()
    return path,thread


def wait_operation(pair,deadline):
    path,thread=pair;thread.join(max(0,deadline-time.monotonic()))
    return json.loads(path.read_text())


def known(state):
    return state.get('responseObserved') and state.get('daemonOutcomeKnown')


def load_component(filename):
    source=Path(__file__).with_name(filename)
    spec=importlib.util.spec_from_file_location(filename.replace('.', '_'),source)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value)
    return value


def proc_identity_module():
    # Only the stat parser is shared here; the retired leaf observer is unused.
    return load_component('p0-rooted-paths.INACTIVE.py')


def identity(pid,cg):
    value=proc_identity_module();st=os.stat(cg)
    return {'pid':pid,'starttime':value.starttime(pid),'cgroup':str(cg),
            'inode':[st.st_dev,st.st_ino]}


def same_identity(anchor):
    try:
        st=os.stat(anchor['cgroup'])
        return ([st.st_dev,st.st_ino]==anchor['inode'] and
                proc_identity_module().starttime(anchor['pid'])==anchor['starttime'] and
                live_cgroup(anchor['pid'])==Path(anchor['cgroup']))
    except Exception:return False


def cleanup(cid,domain,ledger,container_deadline,host_deadline):
    began=time.monotonic()
    empty_deadline=min(host_deadline,container_deadline+2,began+2)
    receipt={'result':'UNKNOWN','emptyPhaseDeadlineMonotonic':empty_deadline,
             'hostBookkeepingDeadlineMonotonic':host_deadline,'emptyPhaseStartedMonotonic':began,
             'emptyPhaseResult':'UNKNOWN','hostBookkeepingResult':'NOT_STARTED'}
    try:
        observed=domain.cleanup(empty_deadline,known_lifecycle=True)
        require(time.monotonic()<empty_deadline,'CLEANUP_EMPTY_DEADLINE')
        receipt.update({'observer':observed,'emptyPhaseResult':'EMPTY_WITHIN_CLEANUP_BUDGET',
                        'emptyPhaseDurationSeconds':time.monotonic()-began,
                        'emptyObservedBeforeDisappearance':True})
        save_state(Path(ledger)/'cleanup.json',receipt)
        # The retained parent is already empty. Docker metadata removal, monitor
        # joins and own-unit removal are host bookkeeping, not a new payload window.
        book_began=time.monotonic()
        receipt['hostBookkeepingStartedMonotonic']=book_began
        receipt['hostBookkeepingResult']='UNKNOWN'
        state=request('GET','/containers/'+cid+'/json',host_deadline)['State']
        require(not state['Running'] and state['Pid']==0,'DOCKER_STOP_STATE_UNPROVED')
        removed=wait_operation(operation('DELETE','/containers/'+cid,ledger,'remove',host_deadline),host_deadline)
        require(known(removed),'REMOVE_OPERATION_UNCERTAIN')
        remaining=request('GET','/containers/json?all=1',host_deadline)
        require(all(v['Id']!=cid for v in remaining),'CONTAINER_REMOVAL_UNPROVED')
        for child in domain.children:
            while True:
                finished,status=os.waitpid(child,os.WNOHANG)
                if finished==child:
                    require(os.WIFEXITED(status) and os.WEXITSTATUS(status)==0,'MONITOR_EXIT_UNVERIFIED')
                    break
                require(time.monotonic()<host_deadline,'HOST_BOOKKEEPING_DEADLINE')
                time.sleep(.001)
        domain.stop(host_deadline)
        require(time.monotonic()<host_deadline,'HOST_BOOKKEEPING_DEADLINE')
        receipt.update({'parentRemovedAfterReceipt':True,
                        'hostBookkeepingResult':'HOST_BOOKKEEPING_WITHIN_BUDGET',
                        'hostBookkeepingDurationSeconds':time.monotonic()-book_began,
                        'finalState':{k:state.get(k) for k in ('Running','Pid','ExitCode','OOMKilled')},
                        'removeOperation':removed})
        require(not (Path(ledger)/'deadline-fired.json').exists(),'INDEPENDENT_DEADLINE_FIRED')
        require(not (Path(ledger)/'watcher-failure.json').exists(),'INDEPENDENT_WATCHER_FAILED')
        require(not (Path(ledger)/'observer-failure.json').exists(),'INDEPENDENT_OBSERVER_FAILED')
        receipt.update({'result':'EMPTY_THEN_HOST_REMOVED','deadlineFired':False,
                        'independentGateDeadlineEnforcement':'KNOWN_GATE_ONLY_NOT_LATE_ADMISSION'})
        return receipt
    finally:
        receipt['emptyPhaseDurationSeconds']=receipt.get('emptyPhaseDurationSeconds',time.monotonic()-began)
        receipt['emptyPhaseDeadlineExceeded']=time.monotonic()>=empty_deadline if receipt['emptyPhaseResult']!='EMPTY_WITHIN_CLEANUP_BUDGET' else False
        if 'hostBookkeepingStartedMonotonic' in receipt:
            receipt.setdefault('hostBookkeepingDurationSeconds',time.monotonic()-receipt['hostBookkeepingStartedMonotonic'])
        receipt['hostBookkeepingDeadlineExceeded']=time.monotonic()>=host_deadline
        save_state(Path(ledger)/'cleanup.json',receipt)


def reconcile(name,ledger,deadline,domain):
    # UNKNOWN never becomes PASS, even if later samples are empty. Preserve the
    # retained domain while an earlier daemon operation can still admit a gate.
    while time.monotonic()<deadline:
        if domain is not None and domain.killfd is not None and not domain.stop_issued:
            try:domain.kill()
            except Exception:
                save_state(Path(ledger)/'custody-domain.json',{'result':'UNKNOWN','reason':'DOMAIN_CUSTODY_IDENTITY_LOST'})
                break
        time.sleep(min(.05,max(0,deadline-time.monotonic())))
    return {'result':'UNKNOWN','reason':'CUSTODY_MARGIN_ENDED',
            'retainedParentNotCreditedAsEmpty':True,'residualVMTeardownObserved':False}


def acquire(deadline):


    closure=json.loads(Path(__file__).with_name('node-runtime-closure.INACTIVE.json').read_text())
    require(closure['manifestDigest']==IMAGE.split('@')[1] and closure['compressedLayerBytes']==79426563,'CLOSED_IMAGE_METADATA_CHANGED')
    info=request('GET','/info',min(deadline,time.monotonic()+5))
    require(not info.get('RegistryConfig',{}).get('Mirrors'),'UNREVIEWED_REGISTRY_MIRROR')
    space=shutil.disk_usage(info['DockerRootDir']);require(space.free>=1024*1024*1024,'PREPARATION_FREE_SPACE_BELOW_1GIB')
    try:
        local=request('GET','/images/'+IMAGE+'/json',min(deadline,time.monotonic()+5))
        return {'result':'ALREADY_LOCAL','image':local,'daemonOperationTerminal':True,'initialFreeBytes':space.free}
    except RuntimeError as error:require(str(error)=='ENGINE_HTTP_404','LOCAL_IMAGE_READ_FAILED')


    conn=Engine(deadline);progress=0;terminal=False;errors=False
    try:
        route=API+'/images/create?fromImage=docker.io/library/node&tag='+IMAGE.split('@')[1]+'&platform=linux%2Famd64'
        conn.request('POST',route,headers={'Content-Type':'application/json'})
        response=conn.getresponse();require(response.status==200,'PULL_HTTP_FAILURE')
        buffer=b''
        while time.monotonic()<deadline:
            block=response.read1(4096)
            if not block:terminal=True;break
            progress+=len(block);require(progress<=1024*1024,'PULL_PROGRESS_LIMIT')
            buffer+=block;require(len(buffer)<=65536,'PULL_LINE_LIMIT')
            while b'\n' in buffer:
                line,buffer=buffer.split(b'\n',1)
                if line:
                    value=json.loads(line);errors=errors or bool(value.get('error') or value.get('errorDetail'))
            require(shutil.disk_usage(info['DockerRootDir']).free>=512*1024*1024,'PREPARATION_FREE_SPACE_LOW')
        require(terminal and time.monotonic()<deadline,'PULL_DEADLINE_NONTERMINAL')
        if buffer.strip():
            value=json.loads(buffer);errors=errors or bool(value.get('error') or value.get('errorDetail'))
        require(not errors,'PULL_TERMINAL_ERROR')
        image=request('GET','/images/'+IMAGE+'/json',deadline)
        require(image['Id']=='sha256:8c3a0351e2535c75b4f15dcdd918612e419e829306291a93ddce97f4746581bd','ACQUIRED_CONFIG_DIGEST')
        require(image['Os']=='linux' and image['Architecture']=='amd64' and IMAGE in image.get('RepoDigests',[]),'ACQUIRED_PLATFORM_REFERENCE')
        require(image.get('RootFS',{}).get('Layers')==closure['diffIds'],'ACQUIRED_ROOTFS_CLOSURE')
        return {'result':'PULL_TERMINAL_VERIFIED','image':image,'daemonOperationTerminal':True,'progressBytes':progress,'initialFreeBytes':space.free,
                'manifestDeclaredCompressedLayerBytes':79426563,'expandedBytes':'normal daemon extraction, not capped or measured exactly'}
    except Exception as error:
        return {'result':'UNKNOWN','reason':str(error)[:160],'daemonOperationTerminal':terminal,
                'residual':'client closure is not terminal daemon cancellation'}
    finally:conn.close()


EVIDENCE_CATEGORIES=['ACQUIRED_CONFIG_DIGEST',
 'ACQUIRED_PLATFORM_REFERENCE',
 'ACQUIRED_ROOTFS_CLOSURE',
 'ACQUISITION',
 'ACQUISITION_UNKNOWN',
 'ALL',
 'ALREADY_LOCAL',
 'ANCESTOR_TIGHTER_',
 'ANCESTOR_TIGHTER_CPU',
 'ANCESTOR_TIGHTER_memory.max',
 'ANCESTOR_TIGHTER_pids.max',
 'ANCHOR_CHANGED_AFTER_AUDIT',
 'AUDIT',
 'AUDIT_GATE_PID_CHANGED',
 'AUX_FLAGS',
 'BLOCKED_IMAGE_NOT_LOCAL',
 'CGROUP_ANCHOR_CHANGED',
 'CGROUP_CHANGED_AFTER_EMPTY',
 'CGROUP_DESCRIPTOR_REPLACED',
 'CGROUP_FILE_TOO_LARGE',
 'CGROUP_KILL_PREFLIGHT_CAPABILITY_PENDING',
 'CGROUP_MEMBERSHIP_MISMATCH',
 'CGROUP_PATH_REPLACED',
 'CGROUP_ROOT_NOT_DOMAIN',
 'CGROUP_ROOT_UNAVAILABLE',
 'CHILD_CGROUP_REPLACED',
 'CLEANUP',
 'CLEANUP_EMPTY_DEADLINE',
 'CLEANUP_UNKNOWN',
 'CLOSED_IMAGE_METADATA_CHANGED',
 'CONTAINER_ID_INVALID',
 'CONTAINER_REMOVAL_UNPROVED',
 'CONTROLLER_INSIDE_PARENT',
 'CONTROL_DEADLINE',
 'CONTROL_OR_AUDIT_UNVERIFIED',
 'CONTROL_RESPONSE_LIMIT',
 'CREATE',
 'CREATE_UNCERTAIN',
 'CUSTODY_MARGIN_ENDED',
 'DAEMON_VERSION_CHANGED',
 'DEADLINE_ALREADY_FIRED',
 'DEADLINE_FIRED',
 'DEFAULT_APPARMOR_NOT_PROVED',
 'DELETE',
 'DEVICE_IDENTITY',
 'DEVICE_VALIDATION',
 'DISAPPEARED_BEFORE_EMPTY_PROOF',
 'DOCKER_STOP_STATE_UNPROVED',
 'DOMAIN_ARCH_UNSUPPORTED',
 'DOMAIN_CENSUS_BOUND',
 'DOMAIN_CENSUS_TASK_BOUND',
 'DOMAIN_CUSTODY_IDENTITY_LOST',
 'DOMAIN_FILE_TOO_LARGE',
 'DOMAIN_HOST_ROOT_REQUIRED',
 'DOMAIN_MEMBERSHIP_INVALID',
 'DOMAIN_NOT_EMPTY_AT_OBSERVER_ARM',
 'DOMAIN_NOT_EXCLUSIVE_GATE',
 'DOMAIN_PID_CHANGED',
 'DOMAIN_RECEIPT_SHORT_WRITE',
 'DOMAIN_REPOPULATED',
 'DOMAIN_TYPE_CHANGED',
 'EMPTY_AFTER_GATE_DEADLINE',
 'EMPTY_OBSERVER',
 'EMPTY_RECEIPT_INVALID',
 'EMPTY_THEN_HOST_REMOVED',
 'EMPTY_WITHIN_CLEANUP_BUDGET',
 'ENGINE_HTTP_',
 'ENGINE_HTTP_404',
 'ESCAPED_MOUNT_PATH',
 'EVIDENCE_DIRECTORY_CHANGED',
 'EVIDENCE_DIRECTORY_IDENTITY',
 'EVIDENCE_EXPORT_LIMIT',
 'EVIDENCE_FILE_BOUND',
 'EVIDENCE_FILE_CHANGED',
 'EVIDENCE_FILE_IDENTITY',
 'EVIDENCE_LEDGER_PATH',
 'EVIDENCE_OUTPUT_PATH',
 'EXECUTOR_CHANGED',
 'EXECUTOR_PREFLIGHT',
 'EXTRA_OR_MISSING_HOST_FD',
 'FILESYSTEM_MISMATCH',
 'FINAL_DOMAIN_NOT_EMPTY',
 'FOREIGN_DOMAIN_NO_KILL',
 'FOREIGN_TASK_NO_KILL',
 'GATE_ALREADY_EXPIRED',
 'GATE_CONFIG_CHANGED',
 'GATE_DEADLINE_EXCEEDED',
 'GATE_NOT_LIVE',
 'GATE_OUTSIDE_OWNED_PARENT',
 'GATE_PID_REPLACED',
 'GATE_PLACEMENT_UNPROVED',
 'GATE_START_CLOCK_UNVERIFIED',
 'GENERATED_FILE_IDENTITY',
 'GET',
 'HOST_BOOKKEEPING_DEADLINE',
 'HOST_BOOKKEEPING_WITHIN_BUDGET',
 'HOST_MANAGER_NAMESPACE_UNPROVED',
 'HOST_NAMESPACE',
 'HOST_OPERATION_DEADLINE',
 'HOST_UNIFIED_ROOT_MOUNT_UNPROVED',
 'HOST_UNIFIED_WRITABLE_ROOT_MOUNT_UNPROVED',
 'HTTP_NON_SUCCESS',
 'IDENTITY_CHANGED_BEFORE_OBSERVER',
 'IMAGE_CONFIG_ID',
 'IMAGE_REMOVE_UNKNOWN',
 'INDEPENDENT_DEADLINE_FIRED',
 'INDEPENDENT_OBSERVER_FAILED',
 'INDEPENDENT_WATCHER_FAILED',
 'INSPECT_GATE_MISMATCH',
 'INSPECT_MISMATCH_',
 'INSPECT_MISMATCH_AutoRemove',
 'INSPECT_MISMATCH_CapDrop',
 'INSPECT_MISMATCH_CgroupParent',
 'INSPECT_MISMATCH_CgroupnsMode',
 'INSPECT_MISMATCH_CpuPeriod',
 'INSPECT_MISMATCH_CpuQuota',
 'INSPECT_MISMATCH_IpcMode',
 'INSPECT_MISMATCH_Memory',
 'INSPECT_MISMATCH_MemorySwap',
 'INSPECT_MISMATCH_NetworkMode',
 'INSPECT_MISMATCH_PidsLimit',
 'INSPECT_MISMATCH_Privileged',
 'INSPECT_MISMATCH_ReadonlyPaths',
 'INSPECT_MISMATCH_ReadonlyRootfs',
 'INSPECT_MISMATCH_Runtime',
 'INSPECT_MISMATCH_SecurityOpt',
 'INSPECT_MISMATCH_Tmpfs',
 'INVALID_CONTAINER_ID',
 'INVALID_SCHEMA',
 'IN_PROGRESS',
 'KILL_OPERATION_NONTERMINAL',
 'KNOWN_GATE_ONLY_NOT_LATE_ADMISSION',
 'LC_ALL',
 'LEDGER_UNAVAILABLE',
 'LIFECYCLE_UNCERTAIN_PARENT_RETAINED',
 'LIVE_CAPABILITY_',
 'LIVE_CAPABILITY_CapAmb',
 'LIVE_CAPABILITY_CapBnd',
 'LIVE_CAPABILITY_CapEff',
 'LIVE_CAPABILITY_CapInh',
 'LIVE_CAPABILITY_CapPrm',
 'LIVE_GATE_COMMAND',
 'LIVE_GATE_EXECUTABLE',
 'LIVE_IDENTITY',
 'LIVE_LIMITS',
 'LIVE_PID_CHANGED',
 'LIVE_SECURITY',
 'LOCAL_CONFIG_IDENTITY',
 'LOCAL_IMAGE_IDENTITY',
 'LOCAL_IMAGE_READ_FAILED',
 'MANAGER_CALL_FAILED',
 'MANAGER_CALL_TIMEOUT_CAPABILITY_PENDING',
 'MANAGER_CHANGED_BEFORE_CREATE',
 'MANAGER_CLI_CAPABILITY_PENDING',
 'MANAGER_REPLY_BOUND',
 'MANAGER_VERSION_UNPARSEABLE',
 'MASK_DEFAULTS_MISMATCH',
 'MASK_DIRECTORY_CAPACITY',
 'MASK_DIRECTORY_ROOT',
 'MASK_FILESYSTEM_MISMATCH',
 'MASK_FILE_SOURCE_IDENTITY',
 'MASK_NOT_MOUNTED',
 'MASK_VALIDATION',
 'MEMBERSHIP_CHANGED',
 'MISSING_REQUIRED_MOUNT',
 'MONITOR_DIED_BEFORE_START',
 'MONITOR_EXIT_UNVERIFIED',
 'MONITOR_INSIDE_PARENT',
 'MONITOR_JOIN_UNPROVED',
 'MONITOR_NOT_READY',
 'MONITOR_OS_ERROR',
 'MONITOR_UNCLASSIFIED_FAILURE',
 'MOUNT_DEVICE_MISMATCH',
 'MOUNT_ID_OUTSIDE_GATE_TABLE',
 'MOUNT_RESOLUTION',
 'MOUNT_VALIDATION',
 'NONLOOPBACK_INTERFACE',
 'NONPRIVATE_MOUNT',
 'NOT_ESTABLISHED',
 'NOT_ROOTED_SYMLINK',
 'NOT_STARTED',
 'NOT_WRITTEN',
 'OBSERVED_EMPTY_AND_REMOVED',
 'OBSERVED_EMPTY_RETAINED_PARENT',
 'OBSERVED_EMPTY_SAME_CGROUP',
 'OBSERVER',
 'OBSERVER_DEADLINE',
 'OBSERVER_FAILED',
 'OBSERVER_NOT_READY',
 'OCCUPANCY_UNPROVED',
 'OCCUPIED_EXCLUSIVE_GATE',
 'OMITTED_HOST_SOURCE',
 'OPENAT2_CAPABILITY_PENDING',
 'OWNED_ACTIVE_EMPTY',
 'OWNED_CGROUP_KILL_CAPABILITY_PENDING',
 'OWNED_DOMAIN_KILL_WRITTEN',
 'OWNED_PARENT_REMOVED_AFTER_RECEIPT',
 'OWNED_UNIT_ALREADY_EXISTS',
 'OWNED_UNIT_IDENTITY_UNPROVED',
 'OWNED_UNIT_IDENTITY_VERIFIED',
 'OWNED_UNIT_NOT_ACTIVE',
 'P0_CGROUP_NOT_EXCLUSIVELY_GATE',
 'P0_GATE_TASK_CENSUS',
 'P0_PREPARATION_ONLY',
 'P0_TECHNICAL_EVIDENCE',
 'PARENT_CREATE',
 'PARENT_DESCRIPTOR_CHANGED',
 'PARENT_EMPTY_UNPROVED',
 'PARENT_EVENTS_INVALID',
 'PARENT_KILL_SHORT_WRITE',
 'PARENT_LIMITS_CHANGED',
 'PARENT_NOT_DOMAIN',
 'PARENT_NOT_INITIAL_EMPTY',
 'PARENT_PATH_REPLACED',
 'PARENT_REMOVAL_UNVERIFIED',
 'PARENT_RETENTION_LOST',
 'PASS',
 'PATH',
 'PIDFD_CAPABILITY_PENDING',
 'PID_START_CHANGED',
 'POST',
 'PREPARATION_FREE_SPACE_BELOW_1GIB',
 'PREPARATION_FREE_SPACE_LOW',
 'PREPARATION_MODE_REQUIRED',
 'PROCESS_ROOT_CHANGED',
 'PROC_SUBMOUNT_MISMATCH',
 'PSEUDO_SOURCE_MISMATCH',
 'PULL_ATTEMPT_DEADLINE',
 'PULL_DEADLINE_NONTERMINAL',
 'PULL_HTTP_FAILURE',
 'PULL_LINE_LIMIT',
 'PULL_PROGRESS_LIMIT',
 'PULL_TERMINAL_ERROR',
 'PULL_TERMINAL_VERIFIED',
 'REMOVE_OPERATION_UNCERTAIN',
 'REQUIRED_CONTROLLERS_MISSING',
 'ROOTED_DIRECTORY_TOO_LARGE',
 'ROOTED_ENOENT',
 'ROOTED_MAGICLINK_OR_SYMLINK_LOOP_BLOCKED',
 'ROOTED_OBJECT_FOUND',
 'ROOTED_OPEN_FAILED',
 'ROOTED_PATH_INVALID',
 'ROOTED_SYSCALL_ARCH_UNSUPPORTED',
 'ROOT_DESCRIPTOR_CHANGED',
 'ROOT_OR_UNSAFE_CGROUP',
 'ROOT_PID_CHANGED',
 'ROOT_PID_EXITED',
 'RUNTIME_VERSION_CHANGED',
 'SC_CLK_TCK',
 'SHARED_CHANGED_AFTER_CREATE',
 'SHARED_CHANGED_AFTER_STOP',
 'SHARED_CHANGED_BEFORE_CREATE',
 'SHARED_CONTROLLERS_NOT_ALREADY_ENABLED',
 'SHARED_NAMESPACE_',
 'SHARED_NAMESPACE_cgroup',
 'SHARED_NAMESPACE_ipc',
 'SHARED_NAMESPACE_mnt',
 'SHARED_NAMESPACE_net',
 'SHARED_NAMESPACE_pid',
 'SHARED_NAMESPACE_uts',
 'SHARED_STATE_CHANGED',
 'SOCKET_EXPOSED',
 'SOCKET_OBJECT_PRESENT_ROOTED',
 'START',
 'START_ALREADY_ARMED',
 'START_UNCERTAIN',
 'STATIC_ALLOWLIST_ONLY_LIVE_UNVERIFIED',
 'STOP_PARENT_NOT_EMPTY',
 'STOP_WITHOUT_TERMINAL_RECEIPT',
 'SYSTEMD_EXACT_VERSION_CAPABILITY_PENDING',
 'SYSTEMD_PACKAGE_MANAGER_VERSION_MISMATCH',
 'TRANSPORT_OR_RESPONSE_UNCERTAIN',
 'UNCLASSIFIED',
 'UNEXPECTED_HOST_EXPOSURE_',
 'UNEXPECTED_HOST_EXPOSURE_Binds',
 'UNEXPECTED_HOST_EXPOSURE_CapAdd',
 'UNEXPECTED_HOST_EXPOSURE_DeviceRequests',
 'UNEXPECTED_HOST_EXPOSURE_Devices',
 'UNEXPECTED_HOST_EXPOSURE_ExtraHosts',
 'UNEXPECTED_HOST_EXPOSURE_PortBindings',
 'UNEXPECTED_HOST_EXPOSURE_Sysctls',
 'UNEXPECTED_HOST_EXPOSURE_VolumesFrom',
 'UNEXPECTED_NETWORK_SOCKET',
 'UNEXPECTED_STANDARD_FD_KIND',
 'UNHANDLED_CONTROL_FAILURE',
 'UNIFIED_CGROUP_REQUIRED',
 'UNIT_NAME_INVALID',
 'UNIT_OBJECT_INVALID',
 'UNIT_STATE_DUPLICATE_PROPERTY',
 'UNIT_STATE_UNPARSEABLE',
 'UNKNOWN',
 'UNKNOWN_DEVICE_ENTRY',
 'UNKNOWN_DEVICE_SYMLINK',
 'UNKNOWN_FS',
 'UNKNOWN_SUBMOUNT',
 'UNPROVED_MOUNT_TOPOLOGY',
 'UNREADABLE_OR_INVALID',
 'UNRELATED_CHILD_DOMAIN',
 'UNREVIEWED_REGISTRY_MIRROR',
 'UNSAFE_CGROUP',
 'UNSAFE_KILL_DOMAIN',
 'WATCHER',
 'WATCH_ANCHOR_CHANGED',
 'WORK_CAPACITY_OPTIONS',
 'WORK_FLAGS',
 'WORK_OWNERSHIP',
 'WORK_STATFS_CAPACITY',
 'WORK_VALIDATION',
 'WRITABLE_AUXILIARY',
 'create',
 'image-remove',
 'kill',
 'remove',
 'start']

def export_sanitized(destination):
    require(destination=='/tmp/p0-sanitized-receipt.json','EVIDENCE_OUTPUT_PATH')
    output={'schemaVersion':1,'kind':'P0_TECHNICAL_EVIDENCE','payloadReleased':False,
            'image':IMAGE,'independentGateDeadlineEnforcement':'NOT_ESTABLISHED',
            'residualVMTeardownObserved':False}
    def category(value):
        return value if isinstance(value,str) and value in EVIDENCE_CATEGORIES else 'UNCLASSIFIED'
    def scalar(value):
        return value if isinstance(value,(bool,int,float)) or value is None else None
    def technical_path(value):
        if not isinstance(value,str):return None
        fixed={'/','/work','/sys','/sys/fs/cgroup',*AUX,*DEFAULT_RO,*MASK_BASE}
        return value if value in fixed or re.fullmatch('/sys/devices/system/cpu/cpu[0-9]+/thermal_throttle',value) else None
    def record(value):
        if not isinstance(value,dict):return {'state':'INVALID_SCHEMA'}
        result={}
        for key in ('transportDone','responseObserved','daemonOutcomeKnown','daemonOperationTerminal',
                    'httpStatus','emptyObservedBeforeDisappearance','emptyCensusObserved','containerRemoved',
                    'deadlineExceeded','noMutationStarted','progressBytes','initialFreeBytes',
                    'manifestDeclaredCompressedLayerBytes','pid','starttime','emptyObservedMonotonicNs',
                    'hiddenMountCount','Running','Pid','ExitCode','OOMKilled',
                    'outside','independentOfDaemonAndCustodyLock','observerPid','watcherPid','controllerPid',
                    'occupiedObserved','initialEmptyCredited','initialEmptyIsFinalReceipt',
                    'emptyObservedBoottime','observedBoottime','gateDeadlineBoottime',
                    'dispatchDeadlineBoottime','resetAfterResponseAllowed','deadlineFired',
                    'knownLifecycle','emptyReceiptDurable','parentRemovedAfterReceipt',
                    'retainedParentNotCreditedAsEmpty','objectType','sharedPrerequisitesVerified',
                    'systemdCallReturned','unitIdentityVerified','allControllersAlreadyEnabled','managerVersionAdmitted',
                    'killCount','firstKillBoottime','killFeaturePresentAndAccessMetadata',
                    'ownedKillDescriptorStillRequiresVerification','emptyPhaseDeadlineMonotonic',
                    'hostBookkeepingDeadlineMonotonic','emptyPhaseStartedMonotonic',
                    'emptyPhaseDurationSeconds','hostBookkeepingStartedMonotonic',
                    'hostBookkeepingDurationSeconds','emptyPhaseDeadlineExceeded',
                    'hostBookkeepingDeadlineExceeded','errno','processCount','threadCount','directoryCount'):


            if key in value:result[key]=scalar(value[key])
        for key in ('result','reason','failure','error','category','stage','operation','compatibility','independentGateDeadlineEnforcement','emptyPhaseResult','hostBookkeepingResult'):
            if key in value:result[key]=category(value[key])
        prop=value.get('property')
        if isinstance(prop,dict):
            result['property']={'checkCode':category(prop.get('checkCode'))}
            for k in ('actual','expected'):
                v=prop.get(k)
                if isinstance(v,(bool,int,float)) or v is None:result['property'][k]=v
                elif isinstance(v,str) and v in ('none','private','runc','1000:1000','ro','rw','max'):result['property'][k]=v
                else:result['property'][k+'Type']=type(v).__name__ if type(v).__name__ in ('str','list','dict') else 'other'
        if isinstance(value.get('ownedUnit'),str) and re.fullmatch(r'silhouettep0[a-f0-9]{32}\.slice',value['ownedUnit']):
            result['ownedUnit']=value['ownedUnit']
        if isinstance(value.get('invocationId'),str) and re.fullmatch('[a-f0-9]{32}',value['invocationId']):
            result['invocationId']=value['invocationId']
        if value.get('packageVersion')=='255.4-1ubuntu8.18':result['packageVersion']=value['packageVersion']
        version=value.get('managerVersion')
        if isinstance(version,str) and re.fullmatch('[A-Za-z0-9_.+~:-]{1,128}',version):result['managerVersion']=version
        if isinstance(value.get('rootIdentity'),list) and len(value['rootIdentity'])==2 and all(isinstance(x,int) for x in value['rootIdentity']):
            result['rootIdentity']=value['rootIdentity']
        if isinstance(value.get('shared'),dict):
            shared=value['shared'];result['shared']={}
            allowed_controllers={'cpu','cpuset','io','memory','pids','hugetlb','rdma','misc','dmem'}
            for field in ('controllers','enabled'):
                source=shared.get(field)
                if isinstance(source,list):
                    result['shared'][field]=[v for v in source if v in allowed_controllers]
                    result['shared'][field+'HasUnknown']=any(v not in allowed_controllers for v in source)
            result['shared']['limits']=record({'limits':shared.get('limits',{})}).get('limits',{})
            result['shared']['rootLimitAbsent']=[key for key,val in shared.get('limits',{}).items() if key in ('memory.max','memory.swap.max','pids.max','cpu.max') and val is None]
            result['shared']['type']=shared.get('type') if shared.get('type')=='domain' else 'UNCLASSIFIED'
        if 'exceptionClass' in value:
            result['exceptionClass']=value['exceptionClass'] if value['exceptionClass'] in ('RuntimeError','PermissionError','FileNotFoundError','TimeoutError','KeyError','ValueError','OSError','ProcessLookupError') else 'OtherException'
        if 'target' in value:result['target']=technical_path(value['target'])
        if 'inode' in value:result['inode']=value['inode'] if isinstance(value['inode'],list) and len(value['inode'])==2 and all(isinstance(x,int) for x in value['inode']) else None
        if 'cgroupDeviceInode' in value:result['cgroupDeviceInode']=value['cgroupDeviceInode'] if isinstance(value['cgroupDeviceInode'],list) and len(value['cgroupDeviceInode'])==2 and all(isinstance(x,int) for x in value['cgroupDeviceInode']) else None
        if isinstance(value.get('value'),dict):
            cid=value['value'].get('Id')
            if isinstance(cid,str) and re.fullmatch('[a-f0-9]{64}',cid):result['containerId']=cid
        for key in ('limits',):
            if isinstance(value.get(key),dict):
                result[key]={k:v for k,v in value[key].items() if k in ('memory.max','memory.swap.max','pids.max','cpu.max') and isinstance(v,str) and re.fullmatch('[0-9max ]{1,40}',v)}
        for key in ('observer','killOperation','removeOperation','finalState','cleanup','custody'):
            if key in value:result[key]=record(value[key])
        if isinstance(value.get('ancestors'),list):
            result['ancestorCount']=len(value['ancestors']);result['ancestorsTruncated']=len(value['ancestors'])>32
            result['ancestors']=[{'depth':i,**{k:v for k,v in entry.items() if k in ('memory.max','memory.swap.max','pids.max','cpu.max') and isinstance(v,str) and re.fullmatch('[0-9max ]{1,40}',v)}} for i,entry in enumerate(value['ancestors'][:32])]
        rows=value.get('rows',value.get('reachableMounts'))
        if isinstance(rows,list):
            result['mountCount']=len(rows);result['mountsTruncated']=len(rows)>256
            result['mounts']=[]
            for row in rows[:256]:
                safe={'target':technical_path(row.get('target'))}
                for k in ('id','parent','device'):
                    v=row.get(k);safe[k]=v if isinstance(v,str) and re.fullmatch('[0-9:]{1,32}',v) else None
                safe['fs']=row.get('fs') if row.get('fs') in ('overlay','tmpfs','proc','sysfs','devpts','mqueue','cgroup2','ext4','xfs') else 'UNKNOWN_FS'
                safe['sourceKind']=row.get('source') if row.get('source') in ('overlay','tmpfs','proc','sysfs','devpts','mqueue','cgroup','shm') else 'OMITTED_HOST_SOURCE'
                safe['flags']=[x for x in row.get('flags',[]) if x in ('ro','rw','nosuid','nodev','noexec','relatime','strictatime')]
                safe['propagationPrivate']=not bool(row.get('propagation'))
                safe['capacityOptions']=[x for x in row.get('super',[]) if re.fullmatch('(size|nr_inodes|nr_blocks)=[0-9]+[km]?',x)]
                result['mounts'].append(safe)
        return result
    def read_file(directory,name):
        fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=directory)
        try:
            st=os.fstat(fd)
            require(stat.S_ISREG(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022 and st.st_size<=262144,'EVIDENCE_FILE_IDENTITY')
            raw=os.read(fd,262145)
            require(len(raw)<=262144 and len(raw)==st.st_size,'EVIDENCE_FILE_BOUND')
            after=os.fstat(fd)
            require((st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns),'EVIDENCE_FILE_CHANGED')
            return json.loads(raw)
        finally:os.close(fd)
    tmp=None;directory=None
    try:
        tmp=os.open('/tmp',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
        locator=read_file(tmp,'p0-ledger-location.json')
        path=Path(locator['directory'])
        require(path.parent==Path('/tmp') and re.fullmatch('silhouette-p0-[0-9]+-[0-9]+',path.name),'EVIDENCE_LEDGER_PATH')
        directory=os.open(path.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=tmp)
        anchor=os.fstat(directory)
        require(anchor.st_uid==0 and stat.S_IMODE(anchor.st_mode)==0o700,'EVIDENCE_DIRECTORY_IDENTITY')
        output['files']={}
        names=('phase','executor','failure','acquisition','create','start','identity','audit-progress',
               'mount-inventory','reachable-mounts','audit','empty','kill','remove','cleanup',
               'image-remove','main-final','final','domain-preflight','parent-create','parent',
               'monitors','occupied','start-armed','domain-terminal','deadline-fired',
               'watcher-failure','observer-failure','parent-stop','custody-domain','socket')
        for name in names:
            try:
                value=read_file(directory,name+'.json')
                if name=='executor':
                    output['files'][name]={k:v for k,v in value.items() if k in ('daemonVersion','daemonCommit','apiVersion','runcVersion','containerdVersion','cgroupVersion','cgroupDriver','defaultRuntime') and isinstance(v,str) and re.fullmatch('[A-Za-z0-9_.-]{1,64}',v)}
                else:output['files'][name]=record(value)
            except FileNotFoundError:output['files'][name]={'state':'NOT_WRITTEN'}
            except Exception:output['files'][name]={'state':'UNREADABLE_OR_INVALID'}
        monitors=output['files'].get('monitors',{})
        for role,key in (('controller','controllerPid'),('observer','observerPid'),('watcher','watcherPid')):
            pid=monitors.get(key)
            if isinstance(pid,int) and 0<pid<2**31:
                try:output['files']['domain-kill-'+role]=record(read_file(directory,'domain-kill-'+str(pid)+'.json'))
                except FileNotFoundError:output['files']['domain-kill-'+role]={'state':'NOT_WRITTEN'}
                except Exception:output['files']['domain-kill-'+role]={'state':'UNREADABLE_OR_INVALID'}
        after=os.fstat(directory)
        require((anchor.st_dev,anchor.st_ino)==(after.st_dev,after.st_ino),'EVIDENCE_DIRECTORY_CHANGED')
    except Exception:output['evidenceState']='LEDGER_UNAVAILABLE'
    finally:
        if directory is not None:os.close(directory)
        if tmp is not None:os.close(tmp)
    files=output.get('files',{})
    if (files.get('final',{}).get('result')=='PASS' and
        files.get('empty',{}).get('result')=='OBSERVED_EMPTY_RETAINED_PARENT' and
        files.get('parent-stop',{}).get('result')=='OWNED_PARENT_REMOVED_AFTER_RECEIPT' and
        files.get('deadline-fired',{}).get('state')=='NOT_WRITTEN' and
        files.get('monitors',{}).get('outside') is True):
        output['independentGateDeadlineEnforcement']='KNOWN_GATE_ONLY_NOT_LATE_ADMISSION'
    raw=json.dumps(output,sort_keys=True,indent=2)+'\n'
    require(len(raw.encode())<=262144,'EVIDENCE_EXPORT_LIMIT')
    tmp=os.open('/tmp',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        fd=os.open('p0-sanitized-receipt.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o644,dir_fd=tmp)
        try:
            os.write(fd,raw.encode());os.fsync(fd)
        finally:os.close(fd)
    finally:os.close(tmp)



def preparation_candidate(*, receipt, acquire_fixed_image=False):
    """INACTIVE callable for review. No CLI/workflow activates this candidate.

    A future separately approved runner wrapper would have to call this exact
    function. There is deliberately no application or stdin release operation.
    """
    result={'kind':'P0_PREPARATION_ONLY','payloadReleased':False,'image':IMAGE,'result':'UNKNOWN'}
    host_end=time.monotonic()+300;custody_end=host_end+60
    name='silhouette-p0-'+str(os.getpid())+'-'+str(time.monotonic_ns())
    ledger=Path('/tmp')/name;ledger.mkdir(mode=0o700)
    save_state('/tmp/p0-ledger-location.json',{'directory':str(ledger)})
    cid=None;anchor=None;domain=None;pre=None
    try:
        save_state(ledger/'phase.json',{'stage':'EXECUTOR_PREFLIGHT'})
        v=request('GET','/version',host_end);info=request('GET','/info',host_end)
        require(v.get('Version')=='28.0.4' and v.get('GitCommit')=='6430e49','DAEMON_VERSION_CHANGED')
        components={c['Name']:c['Version'] for c in v.get('Components',[])}
        require(components.get('runc')=='1.5.3' and components.get('containerd')=='v2.4.2','RUNTIME_VERSION_CHANGED')
        require(info.get('CgroupVersion')=='2' and info.get('CgroupDriver')=='systemd' and info.get('DefaultRuntime')=='runc','EXECUTOR_CHANGED')
        save_state(ledger/'executor.json',{'daemonVersion':v.get('Version'),'daemonCommit':v.get('GitCommit'),'apiVersion':v.get('ApiVersion'),'runcVersion':components.get('runc'),'containerdVersion':components.get('containerd'),'cgroupVersion':info.get('CgroupVersion'),'cgroupDriver':info.get('CgroupDriver'),'defaultRuntime':info.get('DefaultRuntime')})
        module=load_component('p0-retained-domain.INACTIVE.py')
        # Read-only prerequisites before pull, unit creation or Docker creation.
        pre=module.preflight(ledger,host_end)
        save_state(ledger/'domain-preflight.json',pre)
        # Test syscall presence/flags against controller's own root, not a mock
        # container. Unsupported openat2 is a capability stop before mutation.
        rooted=load_component('p0-rooted-paths.INACTIVE.py')
        probe=rooted.Root(os.getpid(),module.starttime(os.getpid()))
        probe.close()
        if acquire_fixed_image:
            save_state(ledger/'phase.json',{'stage':'ACQUISITION'})
            save_state(ledger/'acquisition.json',{'result':'IN_PROGRESS','daemonOutcomeKnown':False})
            def acquisition_timeout(_number,_frame):raise RuntimeError('PULL_ATTEMPT_DEADLINE')
            old_alarm=signal.signal(signal.SIGALRM,acquisition_timeout)
            signal.setitimer(signal.ITIMER_REAL,min(240,max(.001,host_end-time.monotonic())))
            try:result['acquisition']=acquire(min(host_end,time.monotonic()+240))
            finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,old_alarm)
            save_state(ledger/'acquisition.json',result['acquisition'])
            require(result['acquisition']['result'] in ('ALREADY_LOCAL','PULL_TERMINAL_VERIFIED'),'ACQUISITION_UNKNOWN')
        try:image=request('GET','/images/'+IMAGE+'/json',host_end)
        except RuntimeError as error:
            if str(error)=='ENGINE_HTTP_404':raise RuntimeError('BLOCKED_IMAGE_NOT_LOCAL') from None
            raise
        require(image['Id']=='sha256:8c3a0351e2535c75b4f15dcdd918612e419e829306291a93ddce97f4746581bd','LOCAL_CONFIG_IDENTITY')
        require(image['Os']=='linux' and image['Architecture']=='amd64' and IMAGE in image.get('RepoDigests',[]),'LOCAL_IMAGE_IDENTITY')
        domain=module.Domain(ledger,pre,host_end)
        save_state(ledger/'phase.json',{'stage':'PARENT_CREATE'})
        domain.create()
        masks=policy();spec=creation(masks,domain.name)
        save_state(ledger/'phase.json',{'stage':'CREATE'})
        create_state=wait_operation(operation('POST','/containers/create?name='+name,ledger,'create',host_end,spec),host_end)
        require(known(create_state),'CREATE_UNCERTAIN')
        cid=create_state['value']['Id'];require(re.fullmatch('[a-f0-9]{64}',cid),'INVALID_CONTAINER_ID')
        domain.monitor(cid,custody_end)
        save_state(ledger/'phase.json',{'stage':'START'})
        domain.arm_start()
        # Dispatch bound is armed before HTTP work. Never reset on late response.
        start_end=min(host_end,time.monotonic()+20)
        start_state=wait_operation(operation('POST','/containers/'+cid+'/start',ledger,'start',start_end),start_end)
        require(known(start_state),'START_UNCERTAIN')
        s=request('GET','/containers/'+cid+'/json',start_end)['State']
        occupied=domain.await_occupied(s['Pid'],start_end)
        cg=live_cgroup(s['Pid'])
        require(cg==domain.path/('docker-'+cid+'.scope'),'GATE_OUTSIDE_OWNED_PARENT')
        dispatch=json.loads((ledger/'start-armed.json').read_text())
        gate_bound=min(occupied['gateDeadlineBoottime'],dispatch['dispatchDeadlineBoottime'])
        container_end=min(host_end,time.monotonic()+max(0,gate_bound-time.clock_gettime(time.CLOCK_BOOTTIME)))
        anchor=identity(s['Pid'],cg);save_state(ledger/'identity.json',anchor)
        def timed_out(_number,_frame):raise RuntimeError('GATE_DEADLINE_EXCEEDED')
        previous=signal.signal(signal.SIGALRM,timed_out)
        signal.setitimer(signal.ITIMER_REAL,max(.001,container_end-time.monotonic()))
        try:
            save_state(ledger/'phase.json',{'stage':'AUDIT'})
            result['audit']=audit(cid,image['Id'],masks,container_end,ledger,domain)
            save_state(ledger/'audit.json',result['audit'])
            require(same_identity(anchor),'ANCHOR_CHANGED_AFTER_AUDIT')
            domain.manager_check(container_end)
            require(time.monotonic()<container_end,'GATE_DEADLINE_EXCEEDED')
        finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,previous)
        save_state(ledger/'phase.json',{'stage':'CLEANUP'})
        result['cleanup']=cleanup(cid,domain,ledger,container_end,host_end)
        save_state(ledger/'cleanup.json',result['cleanup'])
        require(result['cleanup']['result']=='EMPTY_THEN_HOST_REMOVED','CLEANUP_UNKNOWN')
        if result.get('acquisition',{}).get('result')=='PULL_TERMINAL_VERIFIED':
            removed=wait_operation(operation('DELETE','/images/'+IMAGE+'?force=0&noprune=1',ledger,'image-remove',host_end),host_end)
            require(known(removed),'IMAGE_REMOVE_UNKNOWN')
        require(time.monotonic()<host_end,'HOST_BOOKKEEPING_DEADLINE')
        result['result']='PASS'
    except Exception as error:
        category=str(error)
        save_state(ledger/'failure.json',{'stage':json.loads((ledger/'phase.json').read_text()).get('stage'),'exceptionClass':type(error).__name__,'category':category,'property':FAILURE_CONTEXT})
        result['failure']=category if re.fullmatch('[A-Z][A-Z0-9_]*',category) else 'CONTROL_OR_AUDIT_UNVERIFIED'
        mutations=bool(domain and domain.create_issued) or any((ledger/(key+'.json')).exists() for key in ('create','start','image-remove','acquisition'))
        if mutations:result['custody']=reconcile(name,ledger,custody_end,domain)
        else:result['noMutationStarted']=True
    finally:
        save_state(ledger/'main-final.json',result)
        save_state(ledger/'final.json',result)
    Path(receipt).write_text(json.dumps(result,indent=2)+'\n')
    return 0 if result.get('result')=='PASS' else 1


if __name__=='__main__':
    raise SystemExit('INACTIVE: no standalone invocation, activation or payload release')
