"""PRODUCT DERIVATION for an authenticated standard GitHub-hosted dedicated job VM.
Historical V2 remains unchanged. This copy permits normal systemd/runc changes
ONLY to root enabled-controller lists, records actual snapshots, and never
writes a shared controller file itself. No CLI. Not authorized for other hosts.
"""
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import signal
import stat
import subprocess
import time

# Shared operation journal singleton across separately loaded inactive components.
import importlib.util as _iu
import sys as _sys
from pathlib import Path as _SourcePath
if '_p0_interface_contracts' not in _sys.modules:
    _spec=_iu.spec_from_file_location('_p0_interface_contracts',_SourcePath(__file__).resolve().parents[2]/'scripts/containment/p0-interface-contracts.INACTIVE.py')
    _module=_iu.module_from_spec(_spec)
    _sys.modules['_p0_interface_contracts']=_module
    _spec.loader.exec_module(_module)
IO=_sys.modules['_p0_interface_contracts']
Path=IO.Path
os=IO.os

MEM = 134217728
LIMITS = {'memory.max': str(MEM), 'memory.swap.max': '0',
          'pids.max': '16', 'cpu.max': '25000 100000'}
ROOT = Path('/sys/fs/cgroup')
SUPPORTED_MANAGER_VERSIONS = frozenset({'255.4-1ubuntu8.18'})
SERVICE = 'org.freedesktop.systemd1'
MANAGER_PATH = '/org/freedesktop/systemd1'
MANAGER_IFACE = SERVICE + '.Manager'
GATE = b'/bin/sh\x00-c\x00IFS= read -r token; exit 97\x00'


MONITOR_REASON_CODES=frozenset(['CGROUP_KILL_PREFLIGHT_CAPABILITY_PENDING',
 'CGROUP_ROOT_NOT_DOMAIN',
 'CGROUP_ROOT_UNAVAILABLE',
 'CHILD_CGROUP_REPLACED',
 'CLEANUP_EMPTY_DEADLINE',
 'CONTAINER_ID_INVALID',
 'CONTROLLER_INSIDE_PARENT',
 'CUSTODY_MARGIN_ENDED',
 'DEADLINE_ALREADY_FIRED',
 'DEADLINE_FIRED',
 'DOMAIN_ARCH_UNSUPPORTED',
 'DOMAIN_CENSUS_BOUND',
 'DOMAIN_CENSUS_TASK_BOUND',
 'DOMAIN_FILE_TOO_LARGE',
 'DOMAIN_HOST_ROOT_REQUIRED',
 'DOMAIN_MEMBERSHIP_INVALID',
 'DOMAIN_NOT_EMPTY_AT_OBSERVER_ARM',
 'DOMAIN_PID_CHANGED',
 'DOMAIN_RECEIPT_SHORT_WRITE',
 'DOMAIN_REPOPULATED',
 'DOMAIN_TYPE_CHANGED',
 'EMPTY_RECEIPT_INVALID',
 'FINAL_DOMAIN_NOT_EMPTY',
 'FOREIGN_DOMAIN_NO_KILL',
 'FOREIGN_TASK_NO_KILL',
 'GATE_ALREADY_EXPIRED',
 'GATE_PID_REPLACED',
 'GATE_PLACEMENT_UNPROVED',
 'HOST_BOOKKEEPING_DEADLINE',
 'HOST_CGROUP_NAMESPACE_UNPROVED',
 'HOST_MANAGER_NAMESPACE_UNPROVED',
 'HOST_OPERATION_DEADLINE',
 'HOST_UNIFIED_WRITABLE_ROOT_MOUNT_UNPROVED',
 'INSPECT_GATE_MISMATCH',
 'IN_PROGRESS',
 'LC_ALL',
 'LIFECYCLE_UNCERTAIN_PARENT_RETAINED',
 'MANAGER',
 'MANAGER_CALL',
 'MANAGER_CALL_FAILED',
 'MANAGER_CALL_TIMEOUT_CAPABILITY_PENDING',
 'MANAGER_CHANGED_BEFORE_CREATE',
 'MANAGER_CLI_CAPABILITY_PENDING',
 'MANAGER_GET_UNIT',
 'MANAGER_OPERATION_NOT_IN_CONTRACT',
 'MANAGER_OTHER_REJECTED',
 'MANAGER_REPLY_BOUND',
 'MANAGER_START_TRANSIENT',
 'MANAGER_STOP_UNIT',
 'MANAGER_UNIT_STATE',
 'MANAGER_VERSION',
 'MANAGER_VERSION_UNPARSEABLE',
 'MONITOR_DIED_BEFORE_START',
 'MONITOR_INSIDE_PARENT',
 'MONITOR_NOT_READY',
 'MONITOR_OS_ERROR',
 'MONITOR_UNCLASSIFIED_FAILURE',
 'OBSERVED_EMPTY_RETAINED_PARENT',
 'OBSERVER_DEADLINE',
 'OBSERVER_FAILED',
 'OCCUPANCY_UNPROVED',
 'OCCUPIED_EXCLUSIVE_GATE',
 'OWNED_ACTIVE_EMPTY',
 'OWNED_CGROUP_KILL_CAPABILITY_PENDING',
 'OWNED_DOMAIN_KILL_WRITTEN',
 'OWNED_PARENT_REMOVED_AFTER_RECEIPT',
 'OWNED_UNIT_ALREADY_EXISTS',
 'OWNED_UNIT_IDENTITY_UNPROVED',
 'OWNED_UNIT_IDENTITY_VERIFIED',
 'OWNED_UNIT_NOT_ACTIVE',
 'PACKAGE_VERSION',
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
 'PATH',
 'PIDFD_CAPABILITY_PENDING',
 'REQUIRED_CONTROLLERS_MISSING',
 'ROOT_SPECIAL',
 'SC_CLK_TCK',
 'SHARED_CHANGED_AFTER_CREATE',
 'SHARED_CHANGED_AFTER_STOP',
 'SHARED_CHANGED_BEFORE_CREATE',
 'SHARED_CONTROLLERS_NOT_ALREADY_ENABLED',
 'SHARED_STATE_CHANGED',
 'START_ALREADY_ARMED',
 'STATIC_ALLOWLIST_ONLY_LIVE_UNVERIFIED',
 'STOP_PARENT_NOT_EMPTY',
 'STOP_WITHOUT_TERMINAL_RECEIPT',
 'SYSTEMD_EXACT_VERSION_CAPABILITY_PENDING',
 'SYSTEMD_PACKAGE_MANAGER_VERSION_MISMATCH',
 'UNIT_NAME_INVALID',
 'UNIT_OBJECT_INVALID',
 'UNIT_STATE_DUPLICATE_PROPERTY',
 'UNIT_STATE_UNPARSEABLE',
 'UNKNOWN',
 'UNRELATED_CHILD_DOMAIN',
 'UNSAFE_KILL_DOMAIN',
 'WATCH_ANCHOR_CHANGED'])

def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def put(path, value):
    path = Path(path)
    tmp = path.with_name(path.name + '.%d.tmp' % os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        raw = (json.dumps(value, sort_keys=True) + '\n').encode()
        need(os.write(fd, raw) == len(raw), 'DOMAIN_RECEIPT_SHORT_WRITE')
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def text(path):
    return Path(path).read_text().strip()


def ident(fd):
    st = os.fstat(fd)
    return [st.st_dev, st.st_ino]


def readat(fd, name):
    child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
    try:
        raw = os.read(child, 65537)
        need(len(raw) <= 65536, 'DOMAIN_FILE_TOO_LARGE')
        return raw.decode().strip()
    finally:
        os.close(child)


def command(argv,allowed=(0,),deadline=None):
    op=('PACKAGE_VERSION' if argv[0]=='dpkg-query' else 'MANAGER_UNIT_STATE' if argv[0]=='systemctl' else
        'MANAGER_VERSION' if 'Version' in argv else 'MANAGER_GET_UNIT' if 'GetUnit' in argv else
        'MANAGER_START_TRANSIENT' if 'StartTransientUnit' in argv else
        'MANAGER_STOP_UNIT' if 'StopUnit' in argv else 'MANAGER_OTHER_REJECTED')
    with IO.envelope(op,'MANAGER'):
        return _command(argv,allowed,deadline)


def _command(argv, allowed=(0,), deadline=None):
    remaining = 2 if deadline is None else deadline-time.monotonic()
    need(remaining>0, 'HOST_OPERATION_DEADLINE')
    try:
        op=('PACKAGE_VERSION' if argv[0]=='dpkg-query' else
            'MANAGER_UNIT_STATE' if argv[0]=='systemctl' else
            'MANAGER_VERSION' if 'Version' in argv else
            'MANAGER_GET_UNIT' if 'GetUnit' in argv else
            'MANAGER_START_TRANSIENT' if 'StartTransientUnit' in argv else
            'MANAGER_STOP_UNIT' if 'StopUnit' in argv else 'MANAGER_OTHER_REJECTED')
        need(op!='MANAGER_OTHER_REJECTED','MANAGER_OPERATION_NOT_IN_CONTRACT')
        result=IO.invoke(op,'MANAGER','MANAGER_CALL',lambda:subprocess.run(
            argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            timeout=min(2,remaining),check=False,
            env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}))
    except FileNotFoundError:
        raise RuntimeError('MANAGER_CLI_CAPABILITY_PENDING') from None
    except subprocess.TimeoutExpired:
        raise RuntimeError('MANAGER_CALL_TIMEOUT_CAPABILITY_PENDING') from None
    need(deadline is None or time.monotonic()<deadline, 'HOST_OPERATION_DEADLINE')
    need(result.returncode in allowed, 'MANAGER_CALL_FAILED')
    need(len(result.stdout) <= 32768, 'MANAGER_REPLY_BOUND')
    return result.stdout.decode().strip()


def bus(method, signature=None, *args, deadline=None):
    argv = ['busctl', '--system', '--timeout=1s', 'call', SERVICE,
            MANAGER_PATH, MANAGER_IFACE, method]
    if signature:
        argv.extend([signature, *map(str, args)])
    return command(argv,deadline=deadline)


@IO.contract('MANAGER_VERSION','MANAGER')
def manager_version(deadline=None):
    out = command(['busctl', '--system', '--timeout=1s', 'get-property', SERVICE,
                   MANAGER_PATH, MANAGER_IFACE, 'Version'],deadline=deadline)
    parts = shlex.split(out)
    need(len(parts) == 2 and parts[0] == 's', 'MANAGER_VERSION_UNPARSEABLE')
    return parts[1]


@IO.contract('MANAGER_UNIT_STATE','MANAGER')
def unit_state(name,deadline=None):
    props = ('Id', 'LoadState', 'ActiveState', 'SubState', 'Transient', 'InvocationID',
             'ControlGroup', 'StopWhenUnneeded', 'Slice')
    out = command(['systemctl', '--system', '--no-pager', 'show', name,
                   '--property=' + ','.join(props)], allowed=(0, 1, 4),deadline=deadline)
    pairs = [line.split('=', 1) for line in out.splitlines()]
    need(all(len(p) == 2 for p in pairs), 'UNIT_STATE_UNPARSEABLE')
    result = dict(pairs)
    need(len(result) == len(pairs), 'UNIT_STATE_DUPLICATE_PROPERTY')
    return result


@IO.contract('ROOT_MOUNTINFO','HOST_PROC')
def validate_root_mount():
    mount_rows = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        left, right = line.split(' - ', 1)
        fields = left.split()
        need(len(fields)>=6 and len(right.split())>=3,'HOST_UNIFIED_WRITABLE_ROOT_MOUNT_UNPROVED')
        if fields[4] == str(ROOT):
            mount_rows.append((fields[3], right.split()[0], fields[5]))
    need(len(mount_rows)==1 and mount_rows[0][:2] == ('/', 'cgroup2') and
         'rw' in mount_rows[0][2].split(','), 'HOST_UNIFIED_WRITABLE_ROOT_MOUNT_UNPROVED')


@IO.contract('ROOT_NAMESPACE','HOST_PROC')
def validate_root_namespaces():
    namespaces=[os.readlink('/proc/%s/ns/cgroup'%v) for v in ('1','self')]
    need(namespaces[0]==namespaces[1] and re.fullmatch(r'cgroup:\[[0-9]+\]',namespaces[0]),'HOST_CGROUP_NAMESPACE_UNPROVED')


def root_controllers(require_all):
    with IO.envelope('ROOT_CONTROLLERS','ROOT_SPECIAL'):
        controllers=set(text(ROOT/'cgroup.controllers').split())
        need(all(re.fullmatch('[a-z][a-z0-9_]*',v) for v in controllers),'REQUIRED_CONTROLLERS_MISSING')
        if require_all:need({'cpu','memory','pids'}<=controllers,'REQUIRED_CONTROLLERS_MISSING')
    with IO.envelope('ROOT_SUBTREE_CONTROL','ROOT_SPECIAL'):
        enabled=set(text(ROOT/'cgroup.subtree_control').split())
        need(all(re.fullmatch('[a-z][a-z0-9_]*',v) for v in enabled),'SHARED_CONTROLLERS_NOT_ALREADY_ENABLED')
        if require_all:need(controllers<=enabled,'SHARED_CONTROLLERS_NOT_ALREADY_ENABLED')
    return controllers,enabled


@IO.contract('VERIFIER_CONTRACT','ROOT_SPECIAL')
def shared_snapshot(require_all=False):
    need(ROOT.is_dir() and not ROOT.is_symlink(), 'CGROUP_ROOT_UNAVAILABLE')
    validate_root_mount()
    validate_root_namespaces()
    controllers,enabled=root_controllers(require_all)
    rootstat = ROOT.stat()
    limits={key:IO.absence(key) for key in LIMITS}
    # Kernel CFTYPE_NOT_ON_ROOT: no read/probe/fabrication of root type/events/kill.
    for field in ('cgroup.type','cgroup.events','cgroup.kill'):IO.absence(field)
    return {'controllers':sorted(controllers),'enabled':sorted(enabled),
            'limits':limits,'inode':[rootstat.st_dev,rootstat.st_ino],
            'type':'ROOT_SPECIAL','namespaceMatched':True}


@IO.contract('VERIFIER_CONTRACT','HOST_METADATA')
def preflight(ledger,deadline):
    need(os.geteuid() == 0, 'DOMAIN_HOST_ROOT_REQUIRED')
    version = manager_version(deadline)
    result = {'managerVersion': version, 'managerVersionAdmitted': version in SUPPORTED_MANAGER_VERSIONS,
              'compatibility': 'STATIC_ALLOWLIST_ONLY_LIVE_UNVERIFIED'}
    put(Path(ledger) / 'domain-preflight.json', result)
    need(version in SUPPORTED_MANAGER_VERSIONS, 'SYSTEMD_EXACT_VERSION_CAPABILITY_PENDING')
    package=command(['dpkg-query','-W','-f=${Version}','systemd'],deadline=deadline)
    need(package==version, 'SYSTEMD_PACKAGE_MANAGER_VERSION_MISMATCH')
    result['packageVersion']=package
    need(os.uname().machine == 'x86_64', 'DOMAIN_ARCH_UNSUPPORTED')
    need(text('/proc/1/comm') == 'systemd' and
         os.readlink('/proc/1/ns/cgroup') == os.readlink('/proc/self/ns/cgroup') and
         os.readlink('/proc/1/ns/pid') == os.readlink('/proc/self/ns/pid'),
         'HOST_MANAGER_NAMESPACE_UNPROVED')
    need(hasattr(os, 'pidfd_open'), 'PIDFD_CAPABILITY_PENDING')
    # Read-only feature/access prerequisite on the controller's existing cgroup.
    # Never write it. A controller in root has no cgroup.kill to inspect and is
    # conservatively unsupported rather than probing someone else's subtree.
    current = membership(os.getpid())
    need(current != '/' and '..' not in Path(current).parts,
         'CGROUP_KILL_PREFLIGHT_CAPABILITY_PENDING')
    kill_feature = ROOT.joinpath(*Path(current).parts[1:]) / 'cgroup.kill'
    try:
        st = kill_feature.stat(follow_symlinks=False)
    except FileNotFoundError:
        raise RuntimeError('CGROUP_KILL_PREFLIGHT_CAPABILITY_PENDING') from None
    need(stat.S_ISREG(st.st_mode) and os.access(kill_feature, os.W_OK, effective_ids=True),
         'CGROUP_KILL_PREFLIGHT_CAPABILITY_PENDING')
    result['killFeaturePresentAndAccessMetadata'] = True
    result['ownedKillDescriptorStillRequiresVerification'] = True
    result['shared'] = shared_snapshot(require_all=False)
    put(Path(ledger) / 'domain-preflight.json', result)
    need({'cpu', 'memory', 'pids'} <= set(result['shared']['controllers']),
         'REQUIRED_CONTROLLERS_MISSING')
    return result


@IO.contract('PROC_STAT','HOST_PROC')
def starttime(pid):
    raw = text('/proc/%d/stat' % pid)
    return IO.proc_starttime(raw,pid)


@IO.contract('SELF_CGROUP','HOST_PROC')
def membership(pid):
    value = text('/proc/%d/cgroup' % pid)
    need(value.startswith('0::/') and '\n' not in value, 'DOMAIN_MEMBERSHIP_INVALID')
    return value[3:]


@IO.contract('CGROUP_CGROUP_EVENTS','OWNED_PARENT')
def parse_events(raw):
    pairs=[line.split() for line in raw.splitlines()]
    need(all(len(pair)==2 for pair in pairs),'PARENT_EVENTS_INVALID')
    values=dict(pairs)
    need(len(values)==len(pairs) and values.get('populated') in ('0','1'),'PARENT_EVENTS_INVALID')
    return int(values['populated'])


def outside(pid, relative):
    value = membership(pid)
    return value != relative and not value.startswith(relative + '/')


@IO.contract('CGROUP_INTERFACE','OWNED_PARENT')
def census(directory):
    """A disappearing child invalidates this sample, never becomes empty by omission."""
    processes, threads, directories = set(), set(), []
    def walk(fd, rel, depth):
        need(depth <= 8 and len(directories) <= 64, 'DOMAIN_CENSUS_BOUND')
        need(readat(fd, 'cgroup.type') == 'domain', 'DOMAIN_TYPE_CHANGED')
        directories.append(rel)
        processes.update(int(v) for v in readat(fd, 'cgroup.procs').split())
        threads.update(int(v) for v in readat(fd, 'cgroup.threads').split())
        need(len(processes) <= 16 and len(threads) <= 16, 'DOMAIN_CENSUS_TASK_BOUND')
        for name in sorted(os.listdir(fd)):
            st = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISDIR(st.st_mode):
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=fd)
                try:
                    need(ident(child) == [st.st_dev, st.st_ino], 'CHILD_CGROUP_REPLACED')
                    walk(child, rel + '/' + name, depth + 1)
                finally:
                    os.close(child)
    walk(directory, '', 0)
    return {'processes': sorted(processes), 'threads': sorted(threads),
            'directories': directories}


class Domain:
    def __init__(self, ledger, checked,host_deadline):
        self.host_deadline=host_deadline
        self.ledger, self.pre = Path(ledger), checked
        self.name = 'silhouettep0' + secrets.token_hex(16) + '.slice'
        need(re.fullmatch(r'silhouettep0[a-f0-9]{32}\.slice', self.name), 'UNIT_NAME_INVALID')
        self.relative = '/' + self.name
        self.path = ROOT / self.name
        self.fd = self.killfd = None
        self.anchor = None
        self.children = []
        self.start_issued = False
        self.stop_issued = False
        self.create_issued = False
        self.watch = None
        self.observer = None

    def record_shared_sample(self, stage, current, read_error=None, required=True):
        initial = self.pre['shared']
        if not hasattr(self, 'vm_snapshots'):self.vm_snapshots=[]
        sample={'stage':stage,'sampleState':'READ_ERROR' if read_error else 'OBSERVED',
                'validationResult':'NOT_EVALUATED'}
        if current is not None:
            sample['controllers']=current['controllers'];sample['enabled']=current['enabled']
        if read_error is not None:
            sample['exceptionClass']=type(read_error).__name__ if type(read_error).__name__ in (
                'OSError','FileNotFoundError','PermissionError','RuntimeError') else 'OtherException'
            if isinstance(read_error,OSError) and type(read_error.errno) is int:sample['errno']=read_error.errno
            sample['failureCode']=str(read_error) if re.fullmatch('[A-Z][A-Z0-9_]{0,95}',str(read_error)) else 'VM_SHARED_SNAPSHOT_READ_FAILED'
        # Bounded history keeps the initial record separately and the decisive
        # current row even when the number of observations exceeds the budget.
        self.vm_snapshots.append(sample);self.vm_snapshots=self.vm_snapshots[-256:]
        def save():
            put(self.ledger/'vm-controller-snapshots.json', {'initial':initial,
                'samples':self.vm_snapshots,'enabledChangesPermittedWithinDedicatedVMOnly':True})
        save()  # The actual sample is durable BEFORE any admission assertion.
        try:
            if read_error is not None:raise read_error
            need({k:v for k,v in current.items() if k!='enabled'} ==
                 {k:v for k,v in initial.items() if k!='enabled'}, 'VM_ROOT_STATIC_IDENTITY_CHANGED')
            need(set(current['enabled']) <= set(current['controllers']), 'VM_ENABLED_NOT_AVAILABLE')
            if required:
                need({'cpu','memory','pids'} <= set(current['enabled']), 'VM_REQUIRED_CONTROLLERS_NOT_ENABLED')
        except BaseException as error:
            sample['validationResult']='REJECTED'
            if 'failureCode' not in sample:
                sample['failureCode']=str(error) if re.fullmatch('[A-Z][A-Z0-9_]{0,95}',str(error)) else 'VM_SNAPSHOT_VALIDATION_FAILED'
            save()
            raise
        sample['validationResult']='ACCEPTED';save()
        return current

    def audit_shared(self, stage, required=True):
        try:current=shared_snapshot(require_all=False)
        except BaseException as error:
            self.record_shared_sample(stage,None,read_error=error,required=required)
            raise
        return self.record_shared_sample(stage,current,required=required)

    @IO.contract('MANAGER_START_TRANSIENT','MANAGER')
    def create(self):
        need(manager_version(self.host_deadline) == self.pre['managerVersion'], 'MANAGER_CHANGED_BEFORE_CREATE')
        self.audit_shared('BEFORE_PARENT_CREATE', required=False)
        need(not self.path.exists() and unit_state(self.name,self.host_deadline).get('LoadState') == 'not-found',
             'OWNED_UNIT_ALREADY_EXISTS')
        props = [('Description', 's', 'Silhouette fixed gate preparation'),
                 ('StopWhenUnneeded', 'b', 'false'),
                 ('MemoryAccounting', 'b', 'true'), ('CPUAccounting', 'b', 'true'),
                 ('TasksAccounting', 'b', 'true'), ('MemoryMax', 't', str(MEM)),
                 ('MemorySwapMax', 't', '0'), ('TasksMax', 't', '16'),
                 ('CPUQuotaPerSecUSec', 't', '250000'),
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
        need({key: readat(self.fd, key) for key in LIMITS} == LIMITS, 'PARENT_LIMITS_CHANGED')
        initial = census(self.fd)
        need(not initial['processes'] and not initial['threads'] and
             initial['directories'] == [''] and self.populated() == 0, 'PARENT_NOT_INITIAL_EMPTY')
        need(outside(os.getpid(), self.relative), 'CONTROLLER_INSIDE_PARENT')
        self.audit_shared('AFTER_PARENT_CREATE')
        put(self.ledger / 'parent.json', {'result': 'OWNED_ACTIVE_EMPTY',
            'ownedUnit': self.name, 'invocationId': self.invocation,
            'cgroupDeviceInode': self.anchor, 'limits': LIMITS,
            'initialEmptyIsFinalReceipt': False})

    @IO.contract('CGROUP_INTERFACE','OWNED_PARENT')
    def check(self):
        need(self.fd is not None and ident(self.fd) == self.anchor, 'PARENT_DESCRIPTOR_CHANGED')
        st = self.path.stat()
        need([st.st_dev, st.st_ino] == self.anchor, 'PARENT_PATH_REPLACED')

    @IO.contract('MANAGER_GET_UNIT','MANAGER')
    def manager_check(self,deadline=None):
        deadline=self.host_deadline if deadline is None else min(deadline,self.host_deadline)
        need(time.monotonic()<deadline,'HOST_OPERATION_DEADLINE')
        self.check()
        self.audit_shared('ACTIVE_PARENT')
        state = unit_state(self.name,deadline)
        parts = shlex.split(bus('GetUnit', 's', self.name,deadline=deadline))
        need(parts == ['o', self.object_path] and state.get('InvocationID') == self.invocation and
             state.get('ActiveState') == 'active' and state.get('ControlGroup') == self.relative and
             state.get('Id') == self.name and state.get('Transient') == 'yes' and
             state.get('StopWhenUnneeded') == 'no', 'PARENT_RETENTION_LOST')

    @IO.contract('CGROUP_CGROUP_EVENTS','OWNED_PARENT')
    def populated(self):
        return parse_events(readat(self.fd,'cgroup.events'))

    @IO.contract('CGROUP_CGROUP_KILL','OWNED_PARENT')
    def kill(self):
        self.check()
        need(self.relative == '/' + self.name and self.path.parent == ROOT and
             outside(os.getpid(), self.relative), 'UNSAFE_KILL_DOMAIN')
        # Never use ownership of a pathname as permission to kill an observed
        # unrelated process/container. A foreign child or task stops containment.
        try:
            sample = census(self.fd)
            self.last_census_summary={'processCount':len(sample['processes']),
                'threadCount':len(sample['threads']),'directoryCount':len(sample['directories'])}
            expected = getattr(self, 'expected_scope', None)
            need(all(rel == '' or rel == expected for rel in sample['directories']),
                 'FOREIGN_DOMAIN_NO_KILL')
            for pid in sample['processes']:
                tick = starttime(pid)
                need(expected is not None and membership(pid) == self.relative + expected and
                     starttime(pid) == tick, 'FOREIGN_TASK_NO_KILL')
                # A runtime-init intermediate in our scope may also require
                # deadline containment. It never earns the fixed-gate receipt.
        except FileNotFoundError:
            self.check()
            return False  # Retry the complete census, never omit a raced child.
        os.lseek(self.killfd, 0, os.SEEK_SET)
        need(os.write(self.killfd, b'1') == 1, 'PARENT_KILL_SHORT_WRITE')
        # Each writer has a separate ledger filename, avoiding overwrite races.
        self.kill_count = getattr(self, 'kill_count', 0) + 1
        self.first_kill = getattr(self, 'first_kill', time.clock_gettime(time.CLOCK_BOOTTIME))
        put(self.ledger / ('domain-kill-%d.json' % os.getpid()),
            {'result': 'OWNED_DOMAIN_KILL_WRITTEN', 'cgroupDeviceInode': self.anchor,
             'pid': os.getpid(), 'killCount': self.kill_count,
             'firstKillBoottime': self.first_kill,
             'observedBoottime': time.clock_gettime(time.CLOCK_BOOTTIME)})
        return True

    def monitor(self, cid, custody_end):
        need(re.fullmatch('[a-f0-9]{64}', cid), 'CONTAINER_ID_INVALID')
        self.cid = cid
        self.expected_scope = '/docker-' + cid + '.scope'
        reservations=IO.expect_monitors()
        for role in ('observer', 'watcher'):
            r, w = os.pipe()
            child = os.fork()
            if child == 0:
                IO.bind_writer(self.ledger,role,reservations[role]['writerNonce'])
                os.close(r)
                exitcode = 0
                try:
                    need(outside(os.getpid(), self.relative), 'MONITOR_INSIDE_PARENT')
                    if role == 'observer':
                        self.observe(w, custody_end)
                    else:
                        self.watch_deadline(w, custody_end)
                except BaseException as error:
                    exitcode = 1
                    # Best-effort immediate containment on a monitor failure,
                    # but kill() still refuses a missing/replaced own parent.
                    try:
                        self.kill()
                    except BaseException:
                        pass
                    reason=str(error)
                    if reason not in MONITOR_REASON_CODES:
                        reason='MONITOR_OS_ERROR' if isinstance(error,OSError) else 'MONITOR_UNCLASSIFIED_FAILURE'
                    evidence={'result':'UNKNOWN','exceptionClass':type(error).__name__,
                              'failureReference':IO.failure_reference(error),
                              'reason':reason,'stage':role.upper(),
                              'cgroupDeviceInode':self.anchor,'ownedUnit':self.name,
                              'invocationId':self.invocation,'pid':os.getpid()}
                    if isinstance(error,OSError) and isinstance(error.errno,int):evidence['errno']=error.errno
                    summary=getattr(self,'last_census_summary',None)
                    if summary:evidence.update(summary)
                    put(self.ledger / (role + '-failure.json'),evidence)
                finally:
                    os._exit(exitcode)
            IO.expect_pid(role,child)
            os.close(w)
            import select
            need(select.select([r], [], [], 2)[0] and os.read(r, 1) == b'R',
                 'MONITOR_NOT_READY')
            os.close(r)
            need(outside(child, self.relative), 'MONITOR_INSIDE_PARENT')
            setattr(self, role if role == 'observer' else 'watch', child)
            self.children.append(child)
        put(self.ledger / 'monitors.json', {'observerPid': self.observer,
            'watcherPid': self.watch, 'controllerPid': os.getpid(), 'outside': True,
            'independentOfDaemonAndCustodyLock': True})

    @IO.contract('CGROUP_INTERFACE','OWNED_PARENT')
    def observe(self, ready, custody_end):
        self.check()
        need(self.populated() == 0 and census(self.fd)['directories'] == [''],
             'DOMAIN_NOT_EMPTY_AT_OBSERVER_ARM')
        os.write(ready, b'R'); os.close(ready)
        occupied = None
        previous_empty = None
        while time.monotonic() < custody_end:
            self.check()
            before = self.populated()
            try:
                sample = census(self.fd)
            except FileNotFoundError:
                # Child removal races invalidate this complete sample. Reconcile
                # again within this same window; missing parent still fails check.
                self.check()
                previous_empty = None
                time.sleep(.001)
                continue
            after = self.populated()
            self.last_census_summary={'processCount':len(sample['processes']),
                'threadCount':len(sample['threads']),'directoryCount':len(sample['directories'])}
            need(all(v in ('', self.expected_scope) for v in sample['directories']),
                 'UNRELATED_CHILD_DOMAIN')
            if occupied is None and before == after == 1:
                # Runtime places its init in the scope before exec(/bin/sh).
                # Do not credit that intermediate occupancy or kill it merely
                # because the configured fixed shell has not reached exec yet.
                if (len(sample['processes']) != 1 or len(sample['threads']) != 1 or
                    sample['directories'] != ['', self.expected_scope]):
                    time.sleep(.001)
                    continue
                pid = sample['processes'][0]
                try:
                    tick = starttime(pid)
                    pidfd = os.pidfd_open(pid)
                    try:
                        need(membership(pid) == self.relative + self.expected_scope,
                             'GATE_PLACEMENT_UNPROVED')
                        cmd = Path('/proc/%d/cmdline' % pid).read_bytes()
                        need(starttime(pid) == tick, 'GATE_PID_REPLACED')
                        if cmd != GATE:
                            time.sleep(.001)
                            continue
                        occupied = {'pid': pid, 'starttime': tick, 'cgroupDeviceInode': self.anchor,
                                    'observedBoottime': time.clock_gettime(time.CLOCK_BOOTTIME),
                                    'gateDeadlineBoottime': tick / os.sysconf('SC_CLK_TCK') + 20,
                                    'result': 'OCCUPIED_EXCLUSIVE_GATE'}
                        put(self.ledger / 'occupied.json', occupied)
                    finally:
                        os.close(pidfd)
                except (FileNotFoundError, ProcessLookupError):
                    self.check()
                    previous_empty = None
                    continue
            elif occupied is not None and sample['processes']:
                need(sample['processes'] == [occupied['pid']], 'DOMAIN_PID_CHANGED')
                try:
                    tick = starttime(occupied['pid'])
                except FileNotFoundError:
                    self.check()
                    previous_empty = None
                    continue
                need(tick == occupied['starttime'], 'DOMAIN_PID_CHANGED')
            if occupied is not None and before == after == 0 and not sample['processes'] and not sample['threads']:
                # Two entire reconciled empty censuses, never an initial-empty receipt.
                if previous_empty == sample['directories']:
                    self.manager_check(min(custody_end,self.host_deadline))
                    need(self.populated() == 0, 'DOMAIN_REPOPULATED')
                    put(self.ledger / 'empty.json', {'result': 'OBSERVED_EMPTY_RETAINED_PARENT',
                        'cgroupDeviceInode': self.anchor, 'occupiedObserved': True,
                        'emptyCensusObserved': True, 'emptyObservedBeforeDisappearance': True,
                        'emptyObservedMonotonicNs': time.monotonic_ns(),
                        'emptyObservedBoottime': time.clock_gettime(time.CLOCK_BOOTTIME),
                        'initialEmptyCredited': False})
                    return
                previous_empty = sample['directories']
            else:
                previous_empty = None
            time.sleep(.001)
        put(self.ledger / 'observer-failure.json', {'result': 'UNKNOWN', 'reason': 'OBSERVER_DEADLINE',
            'failureReference':IO.reported_failure('MONITOR_DEADLINE','OWNED_PARENT','OBSERVER_DEADLINE')})

    @IO.contract('EVIDENCE_JSON','EVIDENCE_LEDGER')
    def watch_deadline(self, ready, custody_end):
        self.check()
        os.write(ready, b'R'); os.close(ready)
        fired = False
        effective_deadline = None
        while time.monotonic() < custody_end:
            done = self.ledger / 'domain-terminal.json'
            if done.exists():
                value = IO.read_json(done)
                if value.get('knownLifecycle') and value.get('emptyReceiptDurable'):
                    return
            self.check()
            armed = self.ledger / 'start-armed.json'
            if armed.exists():
                dispatch = IO.read_json(armed)['dispatchDeadlineBoottime']
                effective_deadline = dispatch if effective_deadline is None else min(effective_deadline, dispatch)
            occupied = self.ledger / 'occupied.json'
            if occupied.exists():
                anchor = IO.read_json(occupied)
                observed_deadline = anchor['gateDeadlineBoottime']
                effective_deadline = observed_deadline if effective_deadline is None else min(effective_deadline, observed_deadline)
                need(anchor['cgroupDeviceInode'] == self.anchor, 'WATCH_ANCHOR_CHANGED')
            if effective_deadline is not None and time.clock_gettime(time.CLOCK_BOOTTIME) >= effective_deadline:
                if not fired:
                    # Persist sticky failure before writing kill, not after it.
                    put(self.ledger / 'deadline-fired.json', {'result': 'DEADLINE_FIRED',
                        'deadlineFired': True, 'gateDeadlineBoottime': effective_deadline})
                    fired = True
                self.kill()
            time.sleep(.005 if not fired else .05)
        self.kill()
        put(self.ledger / 'watcher-failure.json', {'result': 'UNKNOWN',
            'reason': 'CUSTODY_MARGIN_ENDED', 'deadlineFired': fired,
            'failureReference':IO.reported_failure('MONITOR_DEADLINE','OWNED_PARENT','CUSTODY_MARGIN_ENDED')})

    @IO.contract('EVIDENCE_JSON','EVIDENCE_LEDGER')
    def arm_start(self):
        self.manager_check()
        need(not (self.ledger / 'start-armed.json').exists(), 'START_ALREADY_ARMED')
        for child in self.children:
            need(outside(child, self.relative), 'MONITOR_INSIDE_PARENT')
            need(os.waitpid(child, os.WNOHANG) == (0, 0), 'MONITOR_DIED_BEFORE_START')
        put(self.ledger / 'start-armed.json', {
            'dispatchDeadlineBoottime': time.clock_gettime(time.CLOCK_BOOTTIME) + 20,
            'resetAfterResponseAllowed': False})
        self.start_issued = True

    @IO.contract('EVIDENCE_JSON','EVIDENCE_LEDGER')
    def await_occupied(self, pid, deadline):
        while time.monotonic() < deadline:
            self.check()
            path = self.ledger / 'occupied.json'
            if path.exists():
                value = IO.read_json(path)
                need(value['pid'] == pid and starttime(pid) == value['starttime'], 'INSPECT_GATE_MISMATCH')
                need(time.clock_gettime(time.CLOCK_BOOTTIME) < value['gateDeadlineBoottime'], 'GATE_ALREADY_EXPIRED')
                self.occupied_anchor = value
                return value
            need(not (self.ledger / 'observer-failure.json').exists(), 'OBSERVER_FAILED')
            time.sleep(.001)
        raise RuntimeError('OCCUPANCY_UNPROVED')

    @IO.contract('EVIDENCE_JSON','EVIDENCE_LEDGER')
    def cleanup(self, deadline, known_lifecycle):
        need(time.monotonic()<deadline,'CLEANUP_EMPTY_DEADLINE')
        self.kill()
        while time.monotonic() < deadline:
            self.check()
            path = self.ledger / 'empty.json'
            if path.exists():
                value = IO.read_json(path)
                need(value.get('cgroupDeviceInode') == self.anchor and
                     value.get('occupiedObserved') and value.get('emptyCensusObserved') and
                     value.get('result') == 'OBSERVED_EMPTY_RETAINED_PARENT', 'EMPTY_RECEIPT_INVALID')
                need(known_lifecycle, 'LIFECYCLE_UNCERTAIN_PARENT_RETAINED')
                self.manager_check(deadline)
                need(self.populated() == 0 and not census(self.fd)['processes'], 'FINAL_DOMAIN_NOT_EMPTY')
                need(time.monotonic()<deadline,'CLEANUP_EMPTY_DEADLINE')
                need(not (self.ledger / 'deadline-fired.json').exists(), 'DEADLINE_ALREADY_FIRED')
                put(self.ledger / 'domain-terminal.json', {'knownLifecycle': True,
                    'emptyReceiptDurable': True, 'deadlineFired': (self.ledger / 'deadline-fired.json').exists()})
                return value
            time.sleep(.001)
        raise RuntimeError('PARENT_EMPTY_UNPROVED')

    @IO.contract('MANAGER_STOP_UNIT','MANAGER')
    def stop(self,deadline):
        need(time.monotonic()<deadline,'HOST_BOOKKEEPING_DEADLINE')
        # Only after known lifecycle, final empty receipt and persisted terminal.
        need((self.ledger / 'domain-terminal.json').exists(), 'STOP_WITHOUT_TERMINAL_RECEIPT')
        self.manager_check(deadline)
        need(self.populated() == 0, 'STOP_PARENT_NOT_EMPTY')
        self.stop_issued = True
        bus('StopUnit', 'ss', self.name, 'fail',deadline=deadline)
        until = min(deadline,self.host_deadline)
        while self.path.exists() and time.monotonic() < until:
            time.sleep(.01)
        need(not self.path.exists(), 'PARENT_REMOVAL_UNVERIFIED')
        need(time.monotonic()<deadline,'HOST_BOOKKEEPING_DEADLINE')
        self.audit_shared('AFTER_PARENT_STOP', required=False)
        put(self.ledger / 'parent-stop.json', {'result': 'OWNED_PARENT_REMOVED_AFTER_RECEIPT'})


if __name__ == '__main__':
    raise SystemExit('INACTIVE COMPONENT: no controller invocation permitted')
