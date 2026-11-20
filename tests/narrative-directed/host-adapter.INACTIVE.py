"""Review-only host adapter for one real Narrative writer/reader batch.
No import-time host calls. This module has no active CLI. Never use with an
unreviewed image: the exact prepared image/config/closure is a separate input.
"""
import contextlib
import hashlib
import importlib.util
import secrets
import shlex
import json
import os
from pathlib import Path
import re
import selectors
import socket
import tomllib
import shutil
import struct
import stat
import subprocess
import threading
import time

_docker_config=None
_daemon_identity=None
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}
MEMORY=536870912
TASKS=64
CPU_QUOTA=100000
TOTAL_SECONDS=120
CREATE_PROFILE={
    'memory':MEMORY,'swapTotal':MEMORY,'tasks':TASKS,'cpuPeriod':100000,
    'cpuQuota':CPU_QUOTA,'network':'none','user':'1000:1000','capDrop':['ALL'],
    'readonlyRoot':True,'workBytes':33554432,'workInodes':4096,'tmpBytes':16777216,
    'tmpfsByteInodeOwnershipEvidence':'REQUESTED_ONLY_MOUNT_FLAGS_VERIFIED'}


def need(ok,code):
    if not ok:raise RuntimeError(code)


_journal=None


class HostJournal:
    def __init__(self,path):
        self.path=Path(path);self.phase='PREPARATION';self.events=[];self.sequence=0
        self.lock=threading.RLock()
    def event(self,operation,state,error=None):
        with self.lock:
            self.sequence+=1
            value={'phase':self.phase,'operation':operation,'state':state,'sequence':self.sequence}
            if error is not None:
                value['exceptionClass']=type(error).__name__ if type(error).__name__ in ('RuntimeError','ValueError','OSError','FileNotFoundError','PermissionError','TimeoutExpired','TimeoutError','JSONDecodeError') else 'OtherException'
                if isinstance(error,OSError) and type(error.errno) is int:value['errno']=error.errno
                if re.fullmatch('[A-Z][A-Z0-9_]{0,95}',str(error)):value['code']=str(error)
                origin=getattr(error,'_directed_origin',None)
                if origin is None:
                    origin={k:value[k] for k in ('phase','operation','sequence')}
                    try:error._directed_origin=origin
                    except Exception:pass
                value['decisiveOrigin']=origin
            self.events.append(value)
            durable(self.path,{'kind':'DIRECTED_HOST_DIAGNOSTICS','events':self.events[-256:],
                'truncated':len(self.events)>256,'phase':self.phase})
            return value


def durable(path,value):
    path=Path(path);temporary=path.with_name(path.name+'.tmp')
    raw=(json.dumps(value,sort_keys=True)+'\n').encode()
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
    try:
        need(os.write(fd,raw)==len(raw),'RECEIPT_SHORT_WRITE');os.fsync(fd)
    finally:os.close(fd)
    os.replace(temporary,path)
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


@contextlib.contextmanager
def host_step(operation):
    if _journal:_journal.event(operation,'BEFORE')
    try:yield
    except BaseException as error:
        if _journal:_journal.event(operation,'FAILED',error)
        raise
    else:
        if _journal:_journal.event(operation,'AFTER')


def traced(operation):
    def decorate(function):
        def wrapper(*args,**kwargs):
            with host_step(operation):return function(*args,**kwargs)
        return wrapper
    return decorate


def docker(*args,timeout=5):
    action=args[0] if args[0] in ('create','inspect','rm','load','info','version') else 'OTHER'
    with host_step('DOCKER_'+action.upper()):
        value=subprocess.run(docker_command(*args),env=ENV,stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,check=False)
        need(value.returncode==0,'DOCKER_OPERATION_FAILED')
        need(len(value.stdout)<=262144 and len(value.stderr)<=65536,'DOCKER_REPLY_BOUND')
        return value.stdout


def proc_stat(pid):
    raw=Path('/proc/%d/stat'%pid).read_text();end=raw.rfind(')')
    need(raw.startswith(str(pid)+' (') and end>0,'PROC_IDENTITY')
    fields=raw[end+2:].split();need(len(fields)>=20 and fields[19].isdigit(),'PROC_IDENTITY')
    return int(fields[19])


@traced('INSPECT_PRODUCT_PROFILE')
def inspect_created(cid,image_id,node):
    value=json.loads(docker('inspect',cid))[0];h=value['HostConfig'];c=value['Config']
    need(value['Id']==cid and value['Image']==image_id,'CREATED_IDENTITY')
    expected={'ReadonlyRootfs':True,'NetworkMode':'none','Memory':MEMORY,'MemorySwap':MEMORY,
        'PidsLimit':TASKS,'CpuPeriod':100000,'CpuQuota':CPU_QUOTA,'Privileged':False,
        'AutoRemove':False,'CapDrop':['ALL'],'CgroupnsMode':'private','IpcMode':'private'}
    for key,wanted in expected.items():need(h.get(key)==wanted,'PROFILE_'+key.upper())
    need(c['User']=='1000:1000' and c['OpenStdin'] and not c['Tty'],'PROCESS_PROFILE')
    need(c['Entrypoint']==[node] and c['Cmd']==['-e',"require('/app/supervisor.INACTIVE.cjs').runDirected().catch(()=>{process.exitCode=1})"],'FIXED_SUPERVISOR')
    for key in ('Binds','Devices','DeviceRequests','VolumesFrom','PortBindings','ExtraHosts','Sysctls','CapAdd'):
        need(not h.get(key),'HOST_EXPOSURE')
    need(not h.get('PidMode') and not h.get('UTSMode'),'HOST_NAMESPACE')
    need(h.get('SecurityOpt')==['no-new-privileges'],'SECURITY_OPTIONS')
    need(set(h.get('Tmpfs',{}))=={'/work','/tmp'},'WRITABLE_MOUNT_SET')
    # Exact requested tmpfs strings are frozen. Effective mount flags and resource
    # files are verified after start, before the fixed RUN token is sent.
    need(h['Tmpfs']['/work']=='rw,nosuid,nodev,noexec,size=33554432,nr_inodes=4096,uid=1000,gid=1000,mode=0700','WORK_REQUEST')
    need(h['Tmpfs']['/tmp']=='rw,nosuid,nodev,noexec,size=16777216,nr_inodes=2048,uid=1000,gid=1000,mode=0700','TMP_REQUEST')
    return value


@traced('LIVE_PRODUCT_BOUNDARY')
def live_boundary(cid,pid,node):
    start=proc_stat(pid)
    status=dict(row.split(':',1) for row in Path('/proc/%d/status'%pid).read_text().splitlines() if ':' in row)
    need(status['Uid'].split()==['1000']*4 and status['Gid'].split()==['1000']*4,'LIVE_UID')
    for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb'):need(int(status[key],16)==0,'LIVE_CAPABILITY')
    need(status['NoNewPrivs'].strip()=='1' and status['Seccomp'].strip()=='2','LIVE_SECURITY')
    need(Path('/proc/%d/attr/current'%pid).read_text().startswith('docker-default '),'APPARMOR_REQUIRED')
    interfaces=Path('/proc/%d/net/dev'%pid).read_text().splitlines()[2:]
    need({row.split(':',1)[0].strip() for row in interfaces}=={'lo'},'EXTERNAL_INTERFACE_PRESENT')
    for kind in ('net','pid','mnt','ipc','uts','cgroup'):
        need(os.readlink('/proc/%d/ns/%s'%(pid,kind))!=os.readlink('/proc/self/ns/'+kind),'PRIVATE_NAMESPACE')
    cmd=Path('/proc/%d/cmdline'%pid).read_bytes().split(b'\0')
    need(cmd[0]==node.encode(),'LIVE_SUPERVISOR_COMMAND')
    relative=Path('/proc/%d/cgroup'%pid).read_text().strip()
    need(relative.startswith('0::/') and '\n' not in relative,'CGROUP_MEMBERSHIP')
    path=Path('/sys/fs/cgroup')/relative[4:]
    need(path.name=='docker-'+cid+'.scope' and '..' not in path.parts,'OWN_DOCKER_SCOPE')
    directory=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
    identity=os.fstat(directory)
    need(stat.S_ISDIR(identity.st_mode),'CGROUP_DESCRIPTOR')
    def read(name):
        fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=directory)
        try:return os.read(fd,65536).decode().strip()
        finally:os.close(fd)
    try:
        need(read('cgroup.type')=='domain','DOMAIN_REQUIRED')
        need(read('memory.max')==str(MEMORY) and read('memory.swap.max')=='0','MEMORY_EFFECTIVE')
        need(read('pids.max')==str(TASKS) and read('cpu.max')=='100000 100000','CPU_TASKS_EFFECTIVE')
        need(read('cgroup.procs').split()==[str(pid)],'SUPERVISOR_ONLY_BEFORE_RELEASE')
        # No descriptor-root fallback: inspect mount metadata through the process
        # mountinfo. This adapter does not read arbitrary container file paths.
        mounts=[]
        for line in Path('/proc/%d/mountinfo'%pid).read_text().splitlines():
            left,right=line.split(' - ',1);a=left.split();b=right.split()
            need(len(a)>=6 and len(b)>=3,'MOUNTINFO_INVALID')
            mounts.append((a[4],set(a[5].split(',')),b[0],b[2]))
        root=[row for row in mounts if row[0]=='/'];need(len(root)==1 and 'ro' in root[0][1],'READONLY_ROOT')
        for target in ('/work','/tmp'):
            rows=[row for row in mounts if row[0]==target]
            need(len(rows)==1 and {'rw','nosuid','nodev','noexec'}<=rows[0][1] and rows[0][2]=='tmpfs','TMPFS_EFFECTIVE')
        need(proc_stat(pid)==start,'PID_REPLACED')
        killfd=os.open('cgroup.kill',os.O_WRONLY|os.O_NOFOLLOW,dir_fd=directory)
        return directory,killfd,(identity.st_dev,identity.st_ino),start
    except BaseException:os.close(directory);raise



def load_reviewed_domain(repository):
    frozen={'scripts/containment/docker-p0.INACTIVE.py': '94c1f8653e700741596a3216997c8f9a5db4766053c582986a81dd24ef5b1196', 'scripts/containment/p0-retained-domain.INACTIVE.py': '1003a678f4bfd66d3e24c29293c2f857ac21a4bdf71f90157e1c5ce96f2bbf08', 'scripts/containment/p0-rooted-paths.INACTIVE.py': 'e42cad930926bfff52c719984c6db2fd819aab09811c6ab85954e1baa2e24ac0', 'scripts/containment/p0-interface-contracts.INACTIVE.py': 'daee3c04789a811d8f668f76edccad43d9fda27f166c8a9dd4e30da620f8ca89'}
    repository=Path(repository)
    for name,digest in frozen.items():
        need(hashlib.sha256((repository/name).read_bytes()).hexdigest()==digest,'REVIEWED_INSTRUMENT_BYTES_CHANGED')
    source=Path(__file__).with_name('vm-parent-derived.INACTIVE.py')
    need(hashlib.sha256(source.read_bytes()).hexdigest()=='49395f71e42e735608109ed71e74ee849119e2ed8a143ba305e402fc58d8bac0','PRODUCT_DERIVATION_PIN')
    spec=importlib.util.spec_from_file_location('directed_parent_support',source)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


@traced('PRODUCT_RECURSIVE_CENSUS')
def product_census(M,directory):
    # Separate product contract:64 total Linux tasks, not16 shell threads.
    processes,threads,directories=set(),set(),[]
    def walk(fd,relative,depth):
        need(depth<=8 and len(directories)<64,'PRODUCT_CENSUS_DIRECTORY_BOUND')
        need(M.readat(fd,'cgroup.type')=='domain','PRODUCT_DOMAIN_TYPE')
        directories.append(relative)
        processes.update(int(v) for v in M.readat(fd,'cgroup.procs').split())
        threads.update(int(v) for v in M.readat(fd,'cgroup.threads').split())
        need(len(processes)<=TASKS and len(threads)<=TASKS,'PRODUCT_CENSUS_TASK_BOUND')
        for name in sorted(os.listdir(fd)):
            value=os.stat(name,dir_fd=fd,follow_symlinks=False)
            if stat.S_ISDIR(value.st_mode):
                child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
                try:
                    current=os.fstat(child)
                    need((current.st_dev,current.st_ino)==(value.st_dev,value.st_ino),'PRODUCT_CGROUP_REPLACED')
                    walk(child,relative+'/'+name,depth+1)
                finally:os.close(child)
    walk(directory,'',0)
    return {'processes':sorted(processes),'threads':sorted(threads),'directories':directories}


def make_parent(M,ledger,checked,deadline):
    # Inherit the reviewed descriptor/manager checks and owned-only kill/stop.
    # This separate create method changes ONLY explicit product unit budgets.
    bus=M.bus;put=M.put;manager_version=M.manager_version
    unit_state=M.unit_state;ident=M.ident;readat=M.readat;outside=M.outside
    ROOT=M.ROOT
    census=lambda fd:product_census(M,fd)
    limits={'memory.max':str(MEMORY),'memory.swap.max':'0','pids.max':str(TASKS),'cpu.max':'100000 100000'}
    class ProductParent(M.Domain):
        def create(self):
            need(manager_version(self.host_deadline) == self.pre['managerVersion'], 'MANAGER_CHANGED_BEFORE_CREATE')
            self.audit_shared('BEFORE_PARENT_CREATE', required=False)
            need(not self.path.exists() and unit_state(self.name,self.host_deadline).get('LoadState') == 'not-found',
                 'OWNED_UNIT_ALREADY_EXISTS')
            props = [('Description', 's', 'Directed Narrative product test'),
                     ('StopWhenUnneeded', 'b', 'false'),
                     ('MemoryAccounting', 'b', 'true'), ('CPUAccounting', 'b', 'true'),
                     ('TasksAccounting', 'b', 'true'), ('MemoryMax', 't', str(MEMORY)),
                     ('MemorySwapMax', 't', '0'), ('TasksMax', 't', str(TASKS)),
                     ('CPUQuotaPerSecUSec', 't', '1000000'),
                     ('CPUQuotaPeriodUSec', 't', '100000')]
            args = [self.name, 'fail', str(len(props))]
            for prop in props:
                args.extend(prop)
            args.append('0')
            self.create_issued = True
            put(self.ledger / 'parent-create.json', {'result': 'IN_PROGRESS', 'ownedUnit': self.name,
                'sharedPrerequisitesVerified': True, 'allControllersAlreadyEnabled': False, 'normalManagerEnablingPermittedInDedicatedVM': True,
                'systemdCallReturned': False, 'unitIdentityVerified': False})
            bus('StartTransientUnit', 'ssa(sv)a(sa(sv))', *args,deadline=self.host_deadline)
            until = min(self.host_deadline,time.monotonic() + 2)
            while True:
                state = unit_state(self.name,self.host_deadline)
                if state.get('ActiveState') == 'active':
                    break
                need(time.monotonic() < until, 'OWNED_UNIT_NOT_ACTIVE')
                time.sleep(.01)
            parts = shlex.split(bus('GetUnit', 's', self.name,deadline=self.host_deadline))
            need(len(parts) == 2 and parts[0] == 'o' and
                 parts[1].startswith('/org/freedesktop/systemd1/unit/'), 'UNIT_OBJECT_INVALID')
            self.object_path = parts[1]
            need(state.get('Id') == self.name and state.get('Transient') == 'yes' and
                 state.get('StopWhenUnneeded') == 'no' and
                 state.get('ControlGroup') == self.relative and
                 re.fullmatch('[a-f0-9]{32}', state.get('InvocationID', '')) and
                 state['InvocationID'] != '0' * 32, 'OWNED_UNIT_IDENTITY_UNPROVED')
            self.invocation = state['InvocationID']
            self.fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            self.anchor = ident(self.fd)
            self.check()
            put(self.ledger / 'parent-create.json', {'result': 'OWNED_UNIT_IDENTITY_VERIFIED',
                'ownedUnit': self.name, 'sharedPrerequisitesVerified': True,
                'allControllersAlreadyEnabled': False, 'normalManagerEnablingPermittedInDedicatedVM': True, 'systemdCallReturned': True,
                'unitIdentityVerified': True, 'cgroupDeviceInode': self.anchor})
            try:
                self.killfd = os.open('cgroup.kill', os.O_WRONLY | os.O_NOFOLLOW, dir_fd=self.fd)
            except (FileNotFoundError, PermissionError):
                raise RuntimeError('OWNED_CGROUP_KILL_CAPABILITY_PENDING') from None
            need(readat(self.fd, 'cgroup.type') == 'domain', 'PARENT_NOT_DOMAIN')
            need({key: readat(self.fd, key) for key in limits} == limits, 'PARENT_LIMITS_CHANGED')
            initial = census(self.fd)
            need(not initial['processes'] and not initial['threads'] and
                 initial['directories'] == [''] and self.populated() == 0, 'PARENT_NOT_INITIAL_EMPTY')
            need(outside(os.getpid(), self.relative), 'CONTROLLER_INSIDE_PARENT')
            self.audit_shared('AFTER_PARENT_CREATE')
            put(self.ledger / 'parent.json', {'result': 'OWNED_ACTIVE_EMPTY',
                'ownedUnit': self.name, 'invocationId': self.invocation,
                'cgroupDeviceInode': self.anchor, 'limits': limits,
                'initialEmptyIsFinalReceipt': False})

        def kill(self):
            self.check()
            need(self.path.parent==ROOT and self.relative=='/'+self.name and M.outside(os.getpid(),self.relative),'UNSAFE_PRODUCT_KILL')
            sample=product_census(M,self.fd)
            need(all(v in ('',getattr(self,'expected_scope',None)) for v in sample['directories']),'FOREIGN_PRODUCT_DOMAIN')
            for pid in sample['processes']:
                tick=M.starttime(pid)
                need(getattr(self,'expected_scope',None) is not None and
                     M.membership(pid)==self.relative+self.expected_scope and M.starttime(pid)==tick,'FOREIGN_PRODUCT_TASK')
            # Fail on incomplete census; never substitute the old16-task census.
            os.lseek(self.killfd,0,os.SEEK_SET)
            need(os.write(self.killfd,b'1')==1,'PRODUCT_KILL_SHORT_WRITE')
            return True

    return ProductParent(ledger,checked,deadline)

@traced('VALIDATE_PREPARATION')
def validate_preparation(repository,preparation,docker_archive,expected_sha256):
    preparation=Path(preparation);docker_archive=Path(docker_archive)
    def digest(path):
        value=hashlib.sha256()
        with Path(path).open('rb') as stream:
            for raw in iter(lambda:stream.read(1048576),b''):value.update(raw)
        return value.hexdigest()
    need(re.fullmatch('[a-f0-9]{64}',expected_sha256),'EXTERNAL_PREPARATION_PIN_REQUIRED')
    need(digest(preparation)==expected_sha256,'EXTERNAL_PREPARATION_PIN_MISMATCH')
    doc=json.loads(preparation.read_text())
    need(doc['kind']=='DIRECTED_SCRATCH_IMAGE_PREPARATION_NOT_RUNTIME_EVIDENCE','PREPARATION_SCHEMA')
    need(doc['productEvaluated'] is False and doc['dockerOrInfrastructureCalled'] is False,'PREPARATION_SCOPE')
    need(digest(docker_archive)==doc['dockerArchiveSha256'] and docker_archive.stat().st_size==doc['dockerArchiveBytes'],'DOCKER_ARCHIVE_PIN')
    for row in doc['sourceFiles']:
        need(digest(Path(repository)/row['source'])==row['sourceSha256'],'CURRENT_SOURCE_PIN_CHANGED')
    for name,wanted in doc['sourceControls'].items():
        need(digest(Path(__file__).parent/name)==wanted,'DIRECTED_CONTROL_PIN_CHANGED')
    need(digest(Path(repository)/'package-lock.json')==doc['packageLockSha256'],'PACKAGE_LOCK_CHANGED')
    need(re.fullmatch('sha256:[a-f0-9]{64}',doc['imageConfigId']),'IMAGE_CONFIG_PIN')
    return doc


def docker_command(*args):
    need(_docker_config is not None,'LOCAL_DOCKER_CONTEXT_NOT_VERIFIED')
    return ['/usr/bin/docker','--config',_docker_config,'--host','unix:///run/docker.sock',*args]


def local_socket_identity(path, expected_process):
    path=Path(path)
    st=path.stat(follow_symlinks=False)
    need(stat.S_ISSOCK(st.st_mode) and st.st_uid==0,'LOCAL_DAEMON_SOCKET_REQUIRED')
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as connection:
        connection.settimeout(2);connection.connect(str(path))
        pid,uid,gid=struct.unpack('3i',connection.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
    need(uid==0 and pid>=1,'LOCAL_ROOT_DAEMON_REQUIRED')
    if pid==1:
        # docker.socket is normally activated by systemd. Bind the inherited
        # listening descriptor to the service MainPID, not the creator PID1.
        service='docker.service' if expected_process=='dockerd' else 'containerd.service'
        raw=subprocess.check_output(['/usr/bin/systemctl','show',service,'--property=MainPID','--value'],env=ENV,timeout=2)
        need(raw.strip().isdigit(),'LOCAL_SERVICE_PID_SCHEMA');pid=int(raw)
        need(pid>1,'LOCAL_SERVICE_NOT_RUNNING')
        inodes=set()
        for row in Path('/proc/net/unix').read_text().splitlines()[1:]:
            fields=row.split()
            if len(fields)==8 and fields[6].isdigit() and Path(fields[7]).resolve()==path.resolve():inodes.add(fields[6])
        need(len(inodes)==1,'LOCAL_SOCKET_KERNEL_IDENTITY')
        descriptors=list((Path('/proc')/str(pid)/'fd').iterdir())
        need(len(descriptors)<=4096,'LOCAL_DAEMON_FD_BOUND')
        found=False
        for descriptor in descriptors:
            try:target=os.readlink(descriptor)
            except FileNotFoundError:continue
            if target in {'socket:['+inode+']' for inode in inodes}:found=True
        need(found,'LOCAL_SERVICE_SOCKET_BINDING')
    proc=Path('/proc')/str(pid)
    exe=Path(os.readlink(proc/'exe'))
    need(exe.name==expected_process,'LOCAL_DAEMON_EXECUTABLE')
    for kind in ('pid','mnt','cgroup','user'):
        need(os.readlink(proc/'ns'/kind)==os.readlink('/proc/1/ns/'+kind)==
             os.readlink('/proc/self/ns/'+kind),'DAEMON_HOST_NAMESPACE')
    need(os.stat(proc/'root').st_ino==os.stat('/').st_ino and
         os.stat(proc/'root').st_dev==os.stat('/').st_dev,'DAEMON_HOST_ROOT')
    need(proc_stat(pid)>0,'DAEMON_PROCESS_IDENTITY')
    return {'pid':pid,'starttime':proc_stat(pid),'binarySha256':hashlib.sha256(exe.read_bytes()).hexdigest(),
            'socketDevice':st.st_dev,'socketInode':st.st_ino}


def verify_local_daemons(result):
    global _daemon_identity
    dockerd=local_socket_identity('/run/docker.sock','dockerd')
    cmd=(Path('/proc')/str(dockerd['pid'])/'cmdline').read_bytes().rstrip(b'\0').split(b'\0')
    words=[v.decode() for v in cmd]
    # No custom configuration or arbitrary runtime permitted in this derivation.
    # Default config may exist, but only conventional local containerd/runc.
    config=Path('/etc/docker/daemon.json')
    settings=json.loads(config.read_text()) if config.exists() else {}
    need(isinstance(settings,dict),'DAEMON_CONFIG_SCHEMA')
    need(not settings.get('runtimes') and settings.get('default-runtime','runc')=='runc','CUSTOM_DAEMON_RUNTIME')
    need(not any(v.startswith(('--config-file','--add-runtime','--default-runtime','--containerd-namespace','--containerd-plugins-namespace')) for v in words[1:]),'CUSTOM_DAEMON_CONFIGURATION')
    containerd=settings.get('containerd','/run/containerd/containerd.sock')
    for i,word in enumerate(words[1:],1):
        if word=='--containerd':
            need(i+1<len(words),'DAEMON_ARGUMENT_SCHEMA');containerd=words[i+1]
        elif word.startswith('--containerd='):containerd=word.split('=',1)[1]
    need(containerd in ('/run/containerd/containerd.sock','/var/run/containerd/containerd.sock'),'REMOTE_CONTAINERD_FORBIDDEN')
    runtime=local_socket_identity('/run/containerd/containerd.sock','containerd')
    # Reject remote/proxy runtimes and unread imports before any daemon mutation.
    runtime_words=(Path('/proc')/str(runtime['pid'])/'cmdline').read_bytes().rstrip(b'\0').split(b'\0')
    for i,word in enumerate(runtime_words[1:],1):
        if word in (b'--config',b'-c'):
            need(i+1<len(runtime_words) and runtime_words[i+1]==b'/etc/containerd/config.toml','CUSTOM_CONTAINERD_CONFIG_UNREVIEWED')
        elif word.startswith((b'--config=',b'-c=')):
            need(word.split(b'=',1)[1]==b'/etc/containerd/config.toml','CUSTOM_CONTAINERD_CONFIG_UNREVIEWED')
    runtime_config=Path('/etc/containerd/config.toml')
    settings2=tomllib.loads(runtime_config.read_text()) if runtime_config.exists() else {}
    need(not settings2.get('imports') and not settings2.get('proxy_plugins'),'REMOTE_OR_IMPORTED_RUNTIME_CONFIG')
    need(settings2.get('grpc',{}).get('address','/run/containerd/containerd.sock') in
         ('/run/containerd/containerd.sock','/var/run/containerd/containerd.sock'),'REMOTE_CONTAINERD_FORBIDDEN')
    for plugin in settings2.get('plugins',{}).values():
        need(isinstance(plugin,dict),'CONTAINERD_PLUGIN_SCHEMA')
        container=plugin.get('containerd',{})
        runtime_configs=container.get('runtimes',plugin.get('runtimes',{}))
        need(isinstance(runtime_configs,dict),'RUNTIME_CONFIG_SCHEMA')
        for value in runtime_configs.values():
            need(value.get('runtime_type','io.containerd.runc.v2')=='io.containerd.runc.v2' and
                 not value.get('runtime_path') and not value.get('runtime_engine') and
                 value.get('options',{}).get('BinaryName','runc') in ('runc','/usr/bin/runc'),
                 'NONLOCAL_OR_CUSTOM_OCI_RUNTIME')
    binaries={}
    for name in ('runc','containerd-shim-runc-v2'):
        binary=Path(shutil.which(name,path=ENV['PATH']) or '/UNAVAILABLE')
        bst=binary.stat()
        need(bst.st_uid==0 and not bst.st_mode&0o022 and binary.is_file(),'RUNTIME_BINARY_CUSTODY')
        binaries[name]=hashlib.sha256(binary.read_bytes()).hexdigest()
    runtime['configuredLocalRuntimeBinaryHashes']=binaries
    runtime['configSha256']=hashlib.sha256(runtime_config.read_bytes() if runtime_config.exists() else b'').hexdigest()
    dockerd['configSha256']=hashlib.sha256(config.read_bytes() if config.exists() else b'').hexdigest()
    identity={'dockerd':dockerd,'containerd':runtime}
    if _daemon_identity is not None:need(identity==_daemon_identity,'LOCAL_DAEMON_IDENTITY_CHANGED')
    _daemon_identity=identity
    result['localDaemonIdentity']=identity


def verify_dedicated_vm(attestation,result,receipt):
    import urllib.request
    global _docker_config
    need(isinstance(attestation,dict) and set(attestation)=={'runId','runAttempt','jobId','runnerName','runnerEnvironment','eventHead'},'HOSTED_ATTESTATION_SCHEMA')
    need(attestation['runnerEnvironment']=='github-hosted' and attestation['runAttempt']==1,'STANDARD_HOSTED_JOB_REQUIRED')
    for key in ('runId','jobId'):need(type(attestation[key]) is int and attestation[key]>0,'HOSTED_JOB_ID_SCHEMA')
    need(re.fullmatch('[a-f0-9]{40}',attestation['eventHead']) is not None,'HOSTED_HEAD_SCHEMA')
    head=subprocess.check_output(['git','rev-parse','HEAD'],env=ENV,text=True).strip()
    need(head==attestation['eventHead'],'HOSTED_JOB_CHECKOUT_CHANGED')
    api='https://api.github.com/repos/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource'
    def get(route):
        request=urllib.request.Request(api+route,headers={'Accept':'application/vnd.github+json'})
        with urllib.request.urlopen(request,timeout=5) as response:
            raw=response.read(262145);need(len(raw)<=262144,'HOSTED_API_REPLY_BOUND')
        return json.loads(raw)
    run=get('/actions/runs/'+str(attestation['runId']))
    job=get('/actions/jobs/'+str(attestation['jobId']))
    need(run['head_sha']==head and run['run_attempt']==1 and run['status']=='in_progress' and
         run['event']=='push' and run['head_branch']=='fix/shutdown-contracts-narrow-20261117' and
         run['repository']['full_name']=='haroldfabla2-hue/Silhouette-Agency-OS-OpenSource','HOSTED_RUN_BINDING')
    need(job['run_id']==run['id'] and job['run_attempt']==1 and job['status']=='in_progress' and
         job['labels']==['ubuntu-24.04'] and job['runner_group_name']=='GitHub Actions' and
         job['runner_name']==attestation['runnerName'] and job['runner_id']>0,'STANDARD_HOSTED_VM_BINDING')
    need(Path('/sys/class/dmi/id/sys_vendor').read_text().strip()=='Microsoft Corporation' and
         Path('/sys/class/dmi/id/product_name').read_text().strip()=='Virtual Machine','DEDICATED_VM_PLATFORM_UNPROVED')
    need(Path('/proc/1/comm').read_text().strip()=='systemd','HOST_SYSTEMD_REQUIRED')
    # Standard ubuntu-24.04, not ubuntu-slim or a self-hosted runner. This relies
    # on GitHub's documented new-VM-per-job boundary, not a claim of hard attestation.
    context={'kind':'STANDARD_GITHUB_HOSTED_VM','runId':run['id'],'jobId':job['id'],
             'headSha256':hashlib.sha256(head.encode()).hexdigest(),
             'providerBoundary':'NEW_VM_PER_STANDARD_HOSTED_JOB_NOT_SINGLE_CPU_SLIM'}
    durable(str(receipt)+'.hosted-vm.json',context);result['dedicatedVm']=context
    config=Path(receipt).with_name('directed-docker-'+secrets.token_hex(8))
    config.mkdir(mode=0o700);_docker_config=str(config)
    verify_local_daemons(result)
    info=json.loads(docker('info','--format','{{json .}}'))
    need(info['CgroupVersion']=='2' and info['CgroupDriver']=='systemd' and
         info['DefaultRuntime']=='runc' and info['Name']==os.uname().nodename,'LOCAL_DOCKER_SYSTEMD_REQUIRED')
    configured=info.get('Runtimes',{}).get('runc',{})
    need(configured.get('path') in ('runc','/usr/bin/runc','io.containerd.runc.v2') and not configured.get('runtimeArgs'),'DOCKER_RUNTIME_BINDING_UNREVIEWED')
    version=json.loads(docker('version','--format','{{json .}}'))
    components=[]
    for row in version['Server']['Components']:
        if row['Name'] in ('Engine','containerd','runc','docker-init'):
            need(re.fullmatch('[A-Za-z0-9.+_-]{1,80}',row['Version']) is not None,'RUNTIME_VERSION_SCHEMA')
            components.append({'name':row['Name'],'version':row['Version']})
    result['runtimeIdentity']={'components':components,'cgroupVersion':2,'driver':'systemd',
                               'daemonIdentity':_daemon_identity,'daemonInfoIsNotRuntimeBinaryBinding':True}
    durable(str(receipt)+'.runtime-identity.json',result['runtimeIdentity'])


def run_candidate(*,repository,preparation,docker_archive,expected_preparation_sha256,receipt,hosted_job_attestation):
    """Not execution authority. Requires separate review and main decision."""
    global _journal
    _journal=HostJournal(str(receipt)+'.host-diagnostics.json')
    try:
        with host_step('VALIDATE_PREPARATION'):
            prepared=validate_preparation(repository,preparation,docker_archive,expected_preparation_sha256)
    except BaseException as error:
        durable(receipt,{'kind':'DIRECTED_REAL_NARRATIVE','result':'PREPARATION_REJECTED',
            'decisiveFailure':getattr(error,'_directed_origin',None),'failureClass':type(error).__name__,
            'productReleased':False,'infrastructureStarted':False})
        raise
    image_id=prepared['imageConfigId'];node='/usr/bin/node'
    closure_sha256=prepared['rootfsManifestSha256']
    result={'kind':'DIRECTED_REAL_NARRATIVE','result':'UNKNOWN','forcedCleanup':False,
            'imageConfigId':image_id,'closureSha256':closure_sha256,'profile':CREATE_PROFILE,
            'preparationSha256':expected_preparation_sha256,'productReleased':False}
    cid=None;attach=None;directory=None;killfd=None;watcher=None;parent=None;M=None;ledger=None;image_load_issued=False
    output=b'';errors=b''
    finished=threading.Event();deadline_fired=threading.Event();watcher_error=threading.Event()
    deadline=time.monotonic()+TOTAL_SECONDS
    try:
        with host_step('VERIFY_DEDICATED_HOSTED_VM'):
            verify_dedicated_vm(hosted_job_attestation,result,receipt)
        with host_step('LOAD_FROZEN_SUPPORT'):M=load_reviewed_domain(repository)
        image_load_issued=True
        with host_step('LOAD_PINNED_SCRATCH_IMAGE'):docker('load','--input',str(docker_archive),timeout=30)
        _journal.phase='ADMISSION'
        ledger=Path(receipt).parent/('silhouette-p0-'+str(os.getpid())+'-'+str(time.monotonic_ns()))
        ledger.mkdir(mode=0o700)
        M.IO.configure(ledger)
        with host_step('HOST_PREFLIGHT'):checked=M.preflight(ledger,deadline)
        parent=make_parent(M,ledger,checked,deadline)
        with host_step('CREATE_OWNED_PRODUCT_PARENT'):parent.create()
        # Image creation is NOT hidden here. A separately audited no-RUN scratch
        # image must already exist, with emitted source and native runtime pins.
        cid=docker('create','--cgroup-parent',parent.name,'--interactive','--read-only','--network','none','--ipc','private',
            '--cgroupns','private','--user','1000:1000','--cap-drop','ALL',
            '--security-opt','no-new-privileges','--memory',str(MEMORY),'--memory-swap',str(MEMORY),
            '--pids-limit',str(TASKS),'--cpu-period','100000','--cpu-quota','100000',
            '--log-driver','none','--restart','no','--stop-timeout','2',
            '--tmpfs','/work:rw,nosuid,nodev,noexec,size=33554432,nr_inodes=4096,uid=1000,gid=1000,mode=0700',
            '--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=16777216,nr_inodes=2048,uid=1000,gid=1000,mode=0700',
            '--entrypoint',node,image_id,'-e',"require('/app/supervisor.INACTIVE.cjs').runDirected().catch(()=>{process.exitCode=1})").decode().strip()
        need(re.fullmatch('[a-f0-9]{64}',cid),'CREATED_CONTAINER_ID')
        value=inspect_created(cid,image_id,node)
        need(value['HostConfig']['CgroupParent']==parent.name,'OWNED_PARENT_REQUEST')
        parent.cid=cid;parent.expected_scope='/docker-'+cid+'.scope'
        attach=subprocess.Popen(docker_command('start','--attach','--interactive',cid),env=ENV,
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        until=min(deadline,time.monotonic()+8);pid=0
        while time.monotonic()<until:
            state=inspect_created(cid,image_id,node)['State']
            if state['Running'] and state['Pid']>0:pid=state['Pid'];break
            need(attach.poll() is None,'START_FAILED');time.sleep(.02)
        need(pid>0,'START_NOT_OBSERVED')
        with host_step('LIVE_PRODUCT_BOUNDARY'):directory,killfd,identity,start=live_boundary(cid,pid,node)
        membership=M.membership(pid)
        need(membership==parent.relative+parent.expected_scope,'LIVE_OWNED_PARENT')
        parent.manager_check(deadline)
        parent.audit_shared('AFTER_RUNTIME_BEFORE_RUN')
        occupied=product_census(M,parent.fd)
        need(occupied['processes']==[pid] and occupied['directories']==['',parent.expected_scope] and parent.populated()==1,'INITIAL_PRODUCT_OCCUPANCY')
        result['occupiedBeforeRelease']=True
        def watch():
            if finished.wait(max(0,deadline-time.monotonic())):return
            deadline_fired.set()
            _journal.event('OWNED_PARENT_WATCHDOG','DEADLINE_FIRED')
            try:
                parent.check();parent.kill()
            except BaseException as error:
                watcher_error.set()
                _journal.event('OWNED_PARENT_WATCHDOG','FAILED',error)
        watcher=threading.Thread(target=watch,daemon=False);watcher.start()
        # Release only after checks and independent-of-daemon kill descriptor.
        _journal.phase='PRODUCT'
        with host_step('RELEASE_FIXED_NARRATIVE_BATCH'):
            verify_local_daemons(result)
            parent.audit_shared('IMMEDIATELY_BEFORE_RUN')
            parent.check()
            need({k:M.readat(parent.fd,k) for k in ('memory.max','memory.swap.max','pids.max','cpu.max')}=={'memory.max':str(MEMORY),'memory.swap.max':'0','pids.max':str(TASKS),'cpu.max':'100000 100000'},'PARENT_EFFECTIVE_LIMITS_BEFORE_RUN')
            result['productReleased']=True
            attach.stdin.write(b'RUN\n');attach.stdin.close()
        output=b'';errors=b'';streams=selectors.DefaultSelector()
        streams.register(attach.stdout,selectors.EVENT_READ,'stdout');streams.register(attach.stderr,selectors.EVENT_READ,'stderr')
        try:
            while streams.get_map():
                need(time.monotonic()<deadline,'BATCH_DEADLINE')
                for key,_ in streams.select(min(.1,max(0,deadline-time.monotonic()))):
                    raw=os.read(key.fileobj.fileno(),8192)
                    if not raw:streams.unregister(key.fileobj);continue
                    if key.data=='stdout':output+=raw
                    else:errors+=raw
                    need(len(output)+len(errors)<=65536,'BATCH_OUTPUT_BOUND')
            need(attach.wait(timeout=max(.001,deadline-time.monotonic()))==0,'SUPERVISOR_EXIT_FAILED')
        finally:streams.close()
        need(not deadline_fired.is_set() and not watcher_error.is_set(),'WATCHDOG_FIRED_OR_FAILED')
        lines=output.decode().splitlines();need(len(lines)==1 and lines[0].startswith('NARRATIVE_BATCH '),'BATCH_RECEIPT_PROTOCOL')
        batch=json.loads(lines[0][16:]);need(batch.get('forcedCleanup') is False and batch.get('sameOriginalIdsAndFields') is True,'BATCH_ORACLE')
        need(len(batch.get('phases',[]))==2,'PHASE_COUNT')
        for mode,phase in zip(('write','read'),batch['phases']):
            need(phase.get('mode')==mode and phase.get('naturalExit') is True and phase.get('exitCode')==0 and
                 phase.get('pipesClosed') is True and phase.get('namespaceCensusOnlySupervisor') is True,'NATURAL_EXIT_UNPROVED')
        need(batch.get('journalSha256')==batch.get('recoveredSha256'),'JOURNAL_CHANGED_ACROSS_RESTART')
        need(not errors,'SUPERVISOR_STDERR_UNEXPECTED')
        state=inspect_created(cid,image_id,node)['State']
        need(not state['Running'] and state['Pid']==0 and state['ExitCode']==0 and not state['OOMKilled'],'TERMINAL_STATE')
        need(time.monotonic()<deadline,'BATCH_DEADLINE')
        # Parent remains addressable after Docker's child scope disappears.
        # Do NOT call Domain.cleanup: it intentionally kills first and cannot
        # establish natural termination. No kill is sent on the success path.
        previous=None
        while time.monotonic()<deadline:
            parent.check();parent.manager_check(deadline)
            before=parent.populated();sample=product_census(M,parent.fd);after=parent.populated()
            need(all(v in ('',parent.expected_scope) for v in sample['directories']),'FOREIGN_PRODUCT_DOMAIN')
            if before==after==0 and not sample['processes'] and not sample['threads']:
                if previous==sample['directories']:break
                previous=sample['directories']
            else:previous=None
            time.sleep(.01)
        else:raise RuntimeError('RETAINED_PARENT_EMPTY_UNPROVED')
        need(not deadline_fired.is_set() and not watcher_error.is_set(),'WATCHDOG_FIRED_OR_FAILED')
        M.put(parent.ledger/'empty.json',{'result':'NATURAL_PRODUCT_TREE_EMPTY','occupiedObserved':True,'emptyCensusObserved':True,'cgroupDeviceInode':parent.anchor})
        _journal.event('RETAINED_PARENT_NATURAL_EMPTY','AFTER')
        finished.set();watcher.join(2);need(not watcher.is_alive(),'WATCHDOG_JOIN')
        _journal.phase='TERMINAL_EVIDENCE'
        need(time.monotonic()<deadline and not deadline_fired.is_set() and not watcher_error.is_set(),'BATCH_DEADLINE')
        M.put(parent.ledger/'domain-terminal.json',{'knownLifecycle':True,'emptyReceiptDurable':True})
        docker('rm',cid);cid=None
        parent.stop(deadline)
        result['retainedParentEmptyBeforeStop']=True
        result.update(result='PASS_DIRECTED_NARRATIVE_ONLY',batch=batch,supervisorNaturalExit=True,
                      externalProviderNetworkDisabled=True,allSilhouetteValidated=False)
    except BaseException as error:
        origin=getattr(error,'_directed_origin',None)
        event=_journal.event('BATCH_CONTROL','FAILED',error)
        result['decisiveFailure']=origin or event['decisiveOrigin']
        result['failurePhase']=_journal.phase
        result['failureClass']=type(error).__name__
        if result['productReleased']:
            for line in output.decode(errors='replace').splitlines():
                if line.startswith('NARRATIVE_FAILURE '):
                    try:
                        row=json.loads(line[18:])
                        if (set(row)=={'phase','exceptionClass','reason'} and row['phase'] in ('PRE_RELEASE','WRITE','READ','TERMINAL_EVIDENCE') and
                            row['exceptionClass'] in ('AssertionError','Error','TypeError','SyntaxError','RangeError','OtherException') and
                            row['reason'] in ('MODULE_NOT_FOUND','ASSERTION_FAILED','PHASE_EXCEPTION')):result['supervisorFailure']=row
                    except Exception:pass
        result['failureCode']=str(error) if re.fullmatch('[A-Z][A-Z0-9_]{0,95}',str(error)) else 'UNCLASSIFIED_ADAPTER_FAILURE'
        result['forcedCleanup']=cid is not None
    finally:
        # Cleanup is never allowed to turn a failure into PASS. Removing the
        # owned container is not retroactive evidence of product natural exit.
        if cid:
            try:docker('rm','--force',cid)
            except BaseException:result['cleanupUnknown']=True
        if parent is not None and result.get('result')!='PASS_DIRECTED_NARRATIVE_ONLY':
            # Failed/partial admission is never credited as clean product exit.
            # Preserve own parent if zero population/identity cannot be proved.
            try:
                parent.check()
                if parent.populated()==0 and not product_census(M,parent.fd)['processes']:
                    M.put(parent.ledger/'domain-terminal.json',{'knownLifecycle':True,'emptyReceiptDurable':False})
                    # No StopUnit without a durable complete empty receipt.
                    result['failedParentRetained']=True
                else:result['cleanupUnknown']=True
            except BaseException:result['cleanupUnknown']=True
        if ledger is not None:
            try:
                initial=json.loads((Path(ledger)/'domain-preflight.json').read_text()).get('shared',{})
                if 'controllers' in initial and 'enabled' in initial:
                    result['initialControllers']=initial['controllers'];result['initialEnabled']=initial['enabled']
            except (OSError,ValueError):pass
        if parent is not None:
            result['controllerSnapshots']=getattr(parent,'vm_snapshots',[])
            result['initialControllers']=parent.pre['shared']['controllers']
            result['initialEnabled']=parent.pre['shared']['enabled']
        finished.set()
        if watcher:watcher.join(3)
        if watcher and watcher.is_alive():result['cleanupUnknown']=True
        if attach and attach.poll() is None:
            try:attach.kill();attach.wait(timeout=2)
            except BaseException:result['cleanupUnknown']=True
        for fd in (killfd,directory,getattr(parent,'killfd',None),getattr(parent,'fd',None)):
            if fd is not None:os.close(fd)
        result['deadlineFired']=deadline_fired.is_set();result['watchdogError']=watcher_error.is_set()
        result['deadlineScope']='CONTROLLER_LIVE_BEST_EFFORT_NOT_HARD_ADMISSION_BOUND'
        result['scratchImageRetainedUntilVMTeardown']=image_load_issued
        durable(receipt,result)
    return result


if __name__=='__main__':raise SystemExit('INACTIVE: no publication or execution authorized')
