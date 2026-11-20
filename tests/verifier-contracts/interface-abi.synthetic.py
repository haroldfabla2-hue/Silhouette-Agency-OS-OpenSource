"""SYNTHETIC VERIFIER TESTS ONLY. Not containment, runtime or product evidence.

No Docker/systemd/network/real proc or cgroup access is permitted. Fixtures model
interface ABI and injected failures of this verifier, not Silhouette behavior.
"""
import ast
import builtins
import contextlib
import ctypes
import errno
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import time
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[2]/'scripts/containment'


def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('.','_'),BASE/name)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def forbidden(*args,**kwargs):
    raise AssertionError('REAL_INFRASTRUCTURE_BACKEND_FORBIDDEN')


# Install hard guards BEFORE imports/calls. Local source/fixture/journal files
# remain permitted. No general operation provider ever falls through to backend.
_real_open=os.open
_real_stat=os.stat
_real_readlink=os.readlink
_real_io_open=io.open
_real_builtin_open=builtins.open
_real_listdir=os.listdir

def guard_path(path):
    if isinstance(path,(str,bytes,os.PathLike)):
        value=os.fsdecode(path)
        if value=='/proc' or value.startswith('/proc/') or value=='/sys' or value.startswith('/sys/') or value.startswith('/var/run/'):
            forbidden()

def guarded_open(path,*a,**kw):
    guard_path(path)
    return _real_open(path,*a,**kw)

def guarded_stat(path,*a,**kw):
    guard_path(path)
    return _real_stat(path,*a,**kw)

def guarded_readlink(path,*a,**kw):
    guard_path(path)
    return _real_readlink(path,*a,**kw)


def guarded_io_open(path,*a,**kw):
    guard_path(path)
    return _real_io_open(path,*a,**kw)

def guarded_builtin_open(path,*a,**kw):
    guard_path(path)
    return _real_builtin_open(path,*a,**kw)

def guarded_listdir(path,*a,**kw):
    guard_path(path)
    return _real_listdir(path,*a,**kw)

class BlockedLibc:
    def __init__(self,*a,**kw):
        self.syscall=forbidden


class Fixture:
    def __init__(self,fail=None,error=None):
        self.fail,self.error=fail,error
        self.calls=[]
    def __call__(self,op,cls,action,backend):
        self.calls.append((op,cls,action))
        if self.fail==(op,cls,action):raise self.error
        if action=='ABI_ABSENCE':return 'ROOT_EXEMPT'
        if cls=='EVIDENCE_LEDGER' or (op=='HOST_FILE' and action in ('OPEN','FSTAT','READ_FD','STAT','READ_TEXT','EXISTS')):
            # Only local temporary fixture/evidence IO, subject to the hard guards.
            return backend()
        if op=='UNAME':return SimpleNamespace(machine='x86_64')
        if op=='PROC_COMM':return 'systemd'
        if op=='SELF_CGROUP':return '0::/system.slice/controller.service'
        if op=='KILL_FEATURE_METADATA':
            if action=='LSTAT':return os.stat_result((stat.S_IFREG|0o200,888,31,1,0,0,0,0,0,0))
            if action=='ACCESS':return True
        if op=='ROOT_INODE' and action in ('STAT','LSTAT'):
            return os.stat_result((stat.S_IFDIR|0o755,777,31,2,0,0,0,0,0,0))
        if op=='ROOT_MOUNTINFO' and action=='READ_TEXT':
            return '30 1 0:31 / /sys/fs/cgroup rw,nosuid,nodev,noexec - cgroup2 cgroup rw\n'
        if op=='ROOT_NAMESPACE' and action=='READLINK':return 'cgroup:[1234]'
        if op in ('ROOT_CONTROLLERS','ROOT_SUBTREE_CONTROL') and action=='READ_TEXT':
            return 'cpuset cpu io memory pids hugetlb rdma misc'
        if action=='MANAGER_CALL':
            stdout=b's "255.4-1ubuntu8.18"\n' if op=='MANAGER_VERSION' else b'255.4-1ubuntu8.18\n'
            return subprocess.CompletedProcess([],0,stdout=stdout,stderr=b'')
        if action=='OPEN':return 9001
        if op.startswith('CGROUP_') and action=='READ_FD':return b'domain\n'
        raise AssertionError('UNDECLARED_SYNTHETIC_FIXTURE_OPERATION:'+op+':'+cls+':'+action)


class VerifierInterfaces(unittest.TestCase):
    examples=[]
    full_exports=[]
    @classmethod
    def setUpClass(cls):
        cls.domain=load('p0-retained-domain.INACTIVE.py')
        cls.rooted=load('p0-rooted-paths.INACTIVE.py')
        cls.controller=load('docker-p0.INACTIVE.py')
        cls.io=cls.domain.IO
        assert cls.rooted.IO is cls.io and cls.controller.IO is cls.io
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='verifier-synthetic-')
        self.directory=Path(self.tmp.name)
        self.fixture=Fixture()
        self.journal=self.io.configure(self.directory,self.fixture)
    def tearDown(self):
        self.io.provider=None
        self.io.recorder=None
        self.io.fd_classes.clear()
        self.tmp.cleanup()
    def projected(self):
        # This is the SAME closed projection called by export_sanitized.
        value=self.controller.export_operation_diagnostics([p.name for p in self.directory.iterdir()],
                    lambda name:json.loads((self.directory/name).read_text()))['interfaceOperations']
        encoded=json.dumps(value,sort_keys=True)
        self.assertNotIn('PRIVATE_INJECTED_PATH',encoded)
        self.assertNotIn('PRIVATE_INJECTED_ERROR',encoded)
        return json.loads(encoded)
    def full_export(self,failure=None,extra=None):
        # The exporter executes its real aggregation, closed records, identity
        # checks, JSON parsing and output writes. Only owner UID is a fixture,
        # since these local tests run unprivileged. All paths are in this tempdir.
        ledger=self.directory/'silhouette-p0-123-456'
        ledger.mkdir(mode=0o700,exist_ok=True)
        for source in self.directory.glob('interface-*.json'):
            (ledger/source.name).write_bytes(source.read_bytes())
        if failure is not None:
            value={'category':'NATIVE_INTERFACE_FAILURE','failureReference':getattr(failure,'_p0_failure',None)}
            (ledger/'failure.json').write_text(json.dumps(value))
        for name,value in (extra or {}).items():(ledger/name).write_text(value)
        (self.directory/'p0-ledger-location.json').write_text(json.dumps({'directory':str(ledger)}))
        destination=self.directory/'p0-sanitized-receipt.json'
        destination.unlink(missing_ok=True)
        previous=self.io.provider
        def local_only(op,cls,action,backend):
            value=backend()
            if action=='FSTAT':
                # Preserve actual identity, type, permissions, size, timestamps.
                return SimpleNamespace(st_mode=value.st_mode,st_uid=0,st_size=value.st_size,
                    st_dev=value.st_dev,st_ino=value.st_ino,st_mtime_ns=value.st_mtime_ns)
            return value
        self.io.provider=local_only
        try:self.controller.export_sanitized(str(destination),evidence_root=str(self.directory))
        finally:self.io.provider=previous
        value=json.loads(destination.read_text())
        self.assertNotEqual(value.get('evidenceState'),'LEDGER_UNAVAILABLE',value)
        encoded=json.dumps(value)
        self.assertNotIn('PRIVATE_INJECTED',encoded)
        self.full_exports.append({'control':self._testMethodName,
            'operationEvidenceComplete':value['operationEvidenceComplete'],
            'incompleteReasons':value['operationEvidenceIncompleteReasons'],
            'interfaceIncompleteReasons':value.get('interfaceOperations',{}).get('incompleteReasons',[]),
            'writerPhase':value.get('interfaceOperations',{}).get('writerPhase'),
            'writerCount':len(value.get('interfaceOperations',{}).get('writers',[]))})
        return value

    def test_real_export_pre_monitor_single_expected_controller_complete(self):
        self.io.provider=lambda *args:'fixture'
        self.io.invoke('PROC_COMM','HOST_PROC','READ_TEXT',forbidden)
        value=self.full_export()
        self.assertTrue(value['operationEvidenceComplete'],value)
        self.assertEqual(value['interfaceOperations']['writerPhase'],'PREMONITOR')

    def test_pending_cannot_be_overwritten_by_later_read_real_export(self):
        call=self.journal.event('PROC_STAT','HOST_PROC','READ_TEXT','BEFORE')
        self.io.provider=lambda *args:'fixture'
        self.io.invoke('PROC_COMM','HOST_PROC','READ_TEXT',forbidden)
        value=self.full_export()
        self.assertFalse(value['operationEvidenceComplete'])
        pending=value['interfaceOperations']['writers'][0]['pending']
        self.assertEqual([e['callId'] for e in pending],[call])
        self.assertIn('PENDING_OPERATIONS',value['interfaceOperations']['writers'][0]['incompleteReasons'])

    def test_nested_calls_keep_outer_pending_until_same_call_finishes(self):
        self.io.provider=lambda *args:'fixture'
        with self.io.envelope('ENGINE_ACQUIRE','HOST_METADATA'):
            self.io.invoke('PROC_COMM','HOST_PROC','READ_TEXT',forbidden)
            self.assertFalse(self.full_export()['operationEvidenceComplete'])
        self.assertTrue(self.full_export()['operationEvidenceComplete'])

    def test_concurrent_inflight_call_not_hidden_by_finished_call(self):
        entered=threading.Event();release=threading.Event();errors=[]
        def provider(op,cls,action,backend):
            if op=='PROC_STAT':entered.set();release.wait(5)
            return 'fixture'
        self.io.provider=provider
        def run():
            try:self.io.invoke('PROC_STAT','HOST_PROC','READ_TEXT',forbidden)
            except BaseException as error:errors.append(error)
        thread=threading.Thread(target=run);thread.start()
        try:
            self.assertTrue(entered.wait(2))
            self.io.invoke('PROC_COMM','HOST_PROC','READ_TEXT',forbidden)
            self.assertFalse(self.full_export()['operationEvidenceComplete'])
        finally:release.set();thread.join(3)
        self.assertFalse(thread.is_alive());self.assertEqual(errors,[])
        self.assertTrue(self.full_export()['operationEvidenceComplete'])

    def test_expected_monitor_writer_missing_is_incomplete_real_export(self):
        reservations=self.io.expect_monitors()
        self.io.expect_pid('observer',123456)
        self.io.expect_pid('watcher',123457)
        self.assertEqual(set(reservations),{'controller','observer','watcher'})
        value=self.full_export()
        self.assertFalse(value['operationEvidenceComplete'])
        self.assertIn('EXPECTED_WRITER_MISSING_OR_UNEXPECTED',value['interfaceOperations']['incompleteReasons'])

    def test_writer_identity_and_phase_tampering_rejected_real_export(self):
        manifest=self.directory/'interface-writers.json'
        for mutation in ('pid','nonce','role','phase'):
            with self.subTest(mutation=mutation):
                expected=json.loads(manifest.read_text())
                if mutation=='pid':expected['writers']['controller']['writerPid']+=1
                elif mutation=='nonce':expected['writers']['controller']['writerNonce']='f'*32
                elif mutation=='role':expected['writers']['observer']=expected['writers'].pop('controller')
                else:expected['phase']='UNKNOWN'
                original=manifest.read_text();manifest.write_text(json.dumps(expected))
                self.assertFalse(self.full_export()['operationEvidenceComplete'])
                manifest.write_text(original)

    def synthetic_populated(self,domain):
        real_close=self.io.os.close
        def close(fd):
            if fd==9001:self.io.fd_classes.pop(fd,None)
            else:return real_close(fd)
        with patch.object(self.io.os,'close',close):return domain.populated()

    def test_complete_reserved_writer_set_real_export_without_fork(self):
        controller=self.io.recorder
        expected=self.io.expect_monitors()
        try:
            for pid,role in ((123456,'observer'),(123457,'watcher')):
                self.io.expect_pid(role,pid)
                with patch.object(self.io.native_os,'getpid',lambda:pid):
                    self.io.bind_writer(self.directory,role,expected[role]['writerNonce'])
                self.io.recorder=controller
            value=self.full_export()
            self.assertTrue(value['operationEvidenceComplete'],value)
            self.assertEqual({w['writerRole'] for w in value['interfaceOperations']['writers']},{'controller','observer','watcher'})
        finally:self.io.recorder=controller

    def test_engine_async_malformed_json_links_even_when_caught(self):
        class FixtureEngine:
            def __init__(self,*args):pass
            def close(self):pass
        original=self.fixture
        def provider(op,cls,action,backend):
            if op=='ENGINE_OPERATION' and action=='MANAGER_CALL':
                return SimpleNamespace(status=201),b'malformed PRIVATE_INJECTED JSON'
            return original(op,cls,action,backend)
        self.io.provider=provider
        with patch.object(self.controller,'Engine',FixtureEngine):
            deadline=time.monotonic()+5
            pair=self.controller.operation('POST','/fixture',self.directory,'start',deadline)
            try:state=self.controller.wait_operation(pair,deadline)
            finally:pair[1].join(5)
        self.assertFalse(state['daemonOutcomeKnown'])
        self.assertIsInstance(state['failureReference'],dict)
        value=self.full_export(extra={'start.json':(self.directory/'start.json').read_text()})
        self.assertTrue(value['operationEvidenceComplete'],value)
        self.assertEqual(value['files']['start']['failureReference'],state['failureReference'])
        events=value['interfaceOperations']['writers'][0]['failures']
        self.assertTrue(any(e['operationId']=='ENGINE_OPERATION' and e['reason']=='OP_PARSE_FAILURE' for e in events))

    def test_export_suspension_is_thread_local_not_global(self):
        self.io.provider=lambda *args:'fixture'
        errors=[]
        def run():
            try:self.io.invoke('PROC_COMM','HOST_PROC','READ_TEXT',forbidden)
            except BaseException as error:errors.append(error)
        with self.io.suspended():
            self.io.invoke('PROC_STAT','HOST_PROC','READ_TEXT',forbidden)
            thread=threading.Thread(target=run);thread.start();thread.join(3)
        self.assertFalse(thread.is_alive());self.assertEqual(errors,[])
        self.assertEqual([e['operationId'] for e in self.journal.state['recent']],['PROC_COMM','PROC_COMM'])
        self.assertTrue(self.full_export()['operationEvidenceComplete'])

    def test_export_checks_phase_and_monitor_receipt_against_expected_set(self):
        for extra in ({'phase.json':'{"stage":"START"}'},
                      {'phase.json':'{"stage":"AUDIT"}'},
                      {'phase.json':'{"stage":"CLEANUP"}'},
                      {'monitors.json':'{}'}):
            with self.subTest(files=extra):
                value=self.full_export(extra=extra)
                self.assertFalse(value['operationEvidenceComplete'])
                self.assertIn('WRITER_PHASE_MISMATCH',value['interfaceOperations']['incompleteReasons'])

    def test_malformed_payloads_fail_inside_origin_envelope_real_export(self):
        events=object.__new__(self.domain.Domain);events.fd=9000
        cases=[
            ('stat','PROC_STAT',lambda:self.domain.starttime(123)),
            ('mountinfo','ROOT_MOUNTINFO',lambda:self.domain.validate_root_mount()),
            ('status','PROC_STATUS',lambda:self.controller.process_status(123)),
            ('events','CGROUP_CGROUP_EVENTS',lambda:self.synthetic_populated(events)),
            ('manager','MANAGER_VERSION',lambda:self.domain.manager_version()),
            ('JSON','EVIDENCE_JSON',lambda:self.io.read_json(self.directory/'malformed.json')),
        ]
        for name,operation,call in cases:
            with self.subTest(payload=name):
                self.journal=self.io.configure(self.directory,self.fixture)
                fixture=self.fixture
                def malformed(op,cls,action,backend):
                    if op==operation and action=='READ_TEXT':return 'malformed PRIVATE_INJECTED payload'
                    if op==operation and action=='READ_FD':return b'malformed events value'
                    if op==operation and action=='MANAGER_CALL':return subprocess.CompletedProcess([],0,stdout=b's "unterminated',stderr=b'')
                    return fixture(op,cls,action,backend)
                self.io.provider=malformed
                self.io.fd_classes[9000]=('CGROUP_INTERFACE','OWNED_PARENT')
                (self.directory/'malformed.json').write_text('{not valid JSON PRIVATE_INJECTED')
                with self.assertRaises((ValueError,IndexError,KeyError,RuntimeError)) as caught:call()
                error=caught.exception
                ref=getattr(error,'_p0_failure',None)
                self.assertIsInstance(ref,dict)
                value=self.full_export(error)
                self.assertTrue(value['operationEvidenceComplete'],value)
                writer=value['interfaceOperations']['writers'][0]
                failures=writer['failures']
                decisive=next(e for e in failures if e['callId']==ref['callId'])
                self.assertEqual(decisive['operationId'],operation)
                self.assertEqual(decisive['action'],'PARSE_VALIDATE')
                self.assertEqual(decisive['state'],'FAILED')
                self.assertEqual(writer['pending'],[])

    def test_manager_returncode_validation_is_attributed_real_export(self):
        self.io.provider=lambda *args:subprocess.CompletedProcess([],7,stdout=b'',stderr=b'PRIVATE_INJECTED')
        with self.assertRaises(RuntimeError) as caught:self.domain.manager_version()
        value=self.full_export(caught.exception)
        self.assertTrue(value['operationEvidenceComplete'],value)
        events=value['interfaceOperations']['writers'][0]['failures']
        self.assertTrue(any(e['operationId']=='MANAGER_VERSION' and e['action']=='PARSE_VALIDATE' for e in events))

    def test_unattributed_decisive_failure_stays_incomplete_real_export(self):
        error=RuntimeError('PRIVATE_INJECTED_ERROR')
        self.io.failure_reference(error)
        value=self.full_export(error)
        self.assertFalse(value['operationEvidenceComplete'])
        self.assertIn('WRITER_MARKED_INCOMPLETE',value['interfaceOperations']['writers'][0]['incompleteReasons'])

    def test_missing_decisive_link_and_invalid_json_are_incomplete_real_export(self):
        for extra in ({'failure.json':'{"category":"NATIVE_INTERFACE_FAILURE"}'},
                      {'phase.json':'malformed PRIVATE_INJECTED'},
                      {'interface-writers.json':'malformed PRIVATE_INJECTED'}):
            with self.subTest(files=list(extra)):
                value=self.full_export(extra=extra)
                self.assertFalse(value['operationEvidenceComplete'])
                self.assertTrue(value['operationEvidenceIncompleteReasons'])

    def test_failed_directory_fsync_prevents_backend_and_stays_pending(self):
        calls=[];native=self.io.native_os;fsync=native.fsync
        self.io.provider=lambda *args:calls.append('BACKEND')
        def sync(fd):
            if stat.S_ISDIR(native.fstat(fd).st_mode):raise OSError(errno.EIO,'PRIVATE_INJECTED')
            return fsync(fd)
        with patch.object(native,'fsync',sync):
            with self.assertRaises(OSError):self.io.invoke('PROC_STAT','HOST_PROC','READ_TEXT',forbidden)
        self.assertEqual(calls,[])
        value=self.full_export()
        self.assertFalse(value['operationEvidenceComplete'])
        self.assertTrue(value['interfaceOperations']['writers'][0]['pending'])

    def test_duplicate_writer_role_and_unmatched_completion_rejected(self):
        duplicate=json.loads(next(self.directory.glob('interface-operations-*.json')).read_text())
        duplicate['writerPid']=123456
        (self.directory/'interface-operations-123456.json').write_text(json.dumps(duplicate))
        value=self.full_export()
        self.assertFalse(value['operationEvidenceComplete'])
        self.assertIn('DUPLICATE_WRITER',value['interfaceOperations']['incompleteReasons'])
        self.journal.event('PROC_STAT','HOST_PROC','READ_TEXT','AFTER',call_id=999)
        self.assertTrue(any('UNMATCHED_COMPLETION' in w['incompleteReasons'] for w in self.projected()['writers']))

    def test_strict_proc_stat_valid_and_malformed_after_success(self):
        valid='123 (fixture worker) S '+' '.join(['0']*18+['456'])
        self.io.provider=lambda *args:valid
        self.assertEqual(self.domain.starttime(123),456)
        self.assertEqual(self.rooted.starttime(123),456)
        for bad in ('123 no-parentheses '+'0 '*25,'999 (other) S '+'0 '*19,'123 (fixture) S '+'0 '*18+'-1'):
            with self.subTest(payloadShape=len(bad)):
                self.io.provider=lambda *args:bad
                with self.assertRaises(ValueError) as caught:self.domain.starttime(123)
                value=self.full_export(caught.exception)
                self.assertTrue(value['operationEvidenceComplete'],value)
                reference=caught.exception._p0_failure
                event=next(e for e in value['interfaceOperations']['writers'][0]['failures'] if e['callId']==reference['callId'])
                self.assertEqual(event['reason'],'OP_PARSE_FAILURE')

    def test_journal_fsync_file_replace_then_directory_order(self):
        native=self.io.native_os;original_fsync=native.fsync;original_replace=native.replace
        original_open=native.open;calls=[];directories=set()
        def opened(path,flags,*a,**kw):
            fd=original_open(path,flags,*a,**kw)
            if flags&native.O_DIRECTORY:directories.add(fd)
            else:directories.discard(fd)
            return fd
        def synced(fd):calls.append('dirfsync' if fd in directories else 'filefsync');return original_fsync(fd)
        def replaced(*a):calls.append('replace');return original_replace(*a)
        with patch.object(native,'open',opened),patch.object(native,'fsync',synced),patch.object(native,'replace',replaced):
            self.journal.persist()
        self.assertEqual(calls,['filefsync','replace','dirfsync'])

    def test_root_abi_without_type_events_kill_and_resource_files(self):
        value=self.domain.shared_snapshot()
        self.assertEqual(value['type'],'ROOT_SPECIAL')
        self.assertEqual(value['limits'],{key:'ROOT_EXEMPT' for key in self.domain.LIMITS})
        self.assertEqual(value['inode'],[31,777])
        self.assertTrue(value['namespaceMatched'])
        forbidden_root_reads=[x for x in self.fixture.calls if x[1]=='ROOT_SPECIAL' and x[0].startswith('CGROUP_')]
        self.assertEqual(forbidden_root_reads,[])
        self.assertTrue(self.projected()['operationEvidenceComplete'])
    def test_root_required_controllers_absence_is_not_exemption(self):
        for field,op in [('cgroup.controllers','ROOT_CONTROLLERS'),('cgroup.subtree_control','ROOT_SUBTREE_CONTROL')]:
            with self.subTest(field=field):
                self.io.provider=Fixture((op,'ROOT_SPECIAL','READ_TEXT'),FileNotFoundError(errno.ENOENT,'PRIVATE_INJECTED_ERROR','PRIVATE_INJECTED_PATH'))
                with self.assertRaises(FileNotFoundError):self.domain.shared_snapshot()
                self.assertTrue(any(e['operationId']==op for e in self.journal.state['failures']))
    def test_root_exempt_interfaces_cannot_be_accidentally_read(self):
        for field in self.io.ROOT_EXEMPT:
            with self.subTest(field=field):
                with self.assertRaisesRegex(RuntimeError,'ROOT_INTERFACE_ABI_INVALID'):
                    self.io.Path('/sys/fs/cgroup') .joinpath(field).read_text()
                self.assertNotEqual(self.fixture.calls[-1][0] if self.fixture.calls else '',
                                    self.io.FIELD_OPERATIONS[field])

    def test_no_universal_root_absence(self):
        with self.assertRaises(RuntimeError):self.io.absence('cgroup.controllers')
    def test_wrong_root_mount_is_rejected(self):
        fixture=self.fixture
        def provider(op,cls,action,backend):
            if op=='ROOT_MOUNTINFO':return '30 1 0:31 /delegated /sys/fs/cgroup rw - cgroup2 cgroup rw\n'
            return fixture(op,cls,action,backend)
        self.io.provider=provider
        with self.assertRaisesRegex(RuntimeError,'HOST_UNIFIED_WRITABLE_ROOT_MOUNT_UNPROVED'):
            self.domain.shared_snapshot()
    def test_root_namespace_mismatch_rejected(self):
        fixture=self.fixture;count=0
        def provider(op,cls,action,backend):
            nonlocal count
            if op=='ROOT_NAMESPACE':count+=1;return 'cgroup:[%d]'%count
            return fixture(op,cls,action,backend)
        self.io.provider=provider
        with self.assertRaisesRegex(RuntimeError,'HOST_CGROUP_NAMESPACE_UNPROVED'):
            self.domain.shared_snapshot()
    def test_missing_nonroot_interfaces_never_root_exempt(self):
        for cls in ('OWNED_PARENT','OWNED_SCOPE'):
            for field in ('cgroup.type','cgroup.events','cgroup.kill','memory.max','memory.swap.max','pids.max','cpu.max','cgroup.procs','cgroup.threads'):
                with self.subTest(cls=cls,field=field):
                    self.io.fd_classes[9000]=('CGROUP_INTERFACE',cls)
                    op=self.io.FIELD_OPERATIONS[field]
                    self.io.provider=Fixture((op,cls,'OPEN'),FileNotFoundError(errno.ENOENT,'PRIVATE_INJECTED_ERROR','PRIVATE_INJECTED_PATH'))
                    with self.assertRaises(FileNotFoundError):
                        if field=='cgroup.kill':self.io.os.open(field,os.O_WRONLY,dir_fd=9000)
                        else:self.domain.readat(9000,field)
                    event=self.journal.state['failures'][-1]
                    self.assertEqual((event['operationId'],event['objectClass'],event['errno']),(op,cls,errno.ENOENT))
    def test_faults_each_family_through_closed_export_projection(self):
        # Every interface family is called through its actual verifier adapter.
        families=[
            ('ROOT_MOUNTINFO','HOST_PROC','READ_TEXT',lambda:self.domain.shared_snapshot()),
            ('ROOT_CONTROLLERS','ROOT_SPECIAL','READ_TEXT',lambda:self.domain.shared_snapshot()),
            ('ROOT_SUBTREE_CONTROL','ROOT_SPECIAL','READ_TEXT',lambda:self.domain.shared_snapshot()),
            ('ROOT_NAMESPACE','HOST_PROC','READLINK',lambda:self.domain.shared_snapshot()),
            ('SELF_CGROUP','HOST_PROC','READ_TEXT',lambda:self.domain.membership(123)),
            ('PROC_STAT','HOST_PROC','READ_TEXT',lambda:self.domain.starttime(123)),
            ('KILL_FEATURE_METADATA','CONTROLLER_CGROUP','LSTAT',lambda:self.io.Path('/sys/fs/cgroup/system.slice/controller.service/cgroup.kill').stat(follow_symlinks=False)),
            ('MANAGER_VERSION','MANAGER','MANAGER_CALL',lambda:self.domain.manager_version()),
            ('PACKAGE_VERSION','MANAGER','MANAGER_CALL',lambda:self.domain.command(['dpkg-query','-W','-f=${Version}','systemd'])),
            ('MANAGER_UNIT_STATE','MANAGER','MANAGER_CALL',lambda:self.domain.unit_state('silhouettep0'+('a'*32)+'.slice')),
            ('MANAGER_GET_UNIT','MANAGER','MANAGER_CALL',lambda:self.domain.bus('GetUnit','s','fixture.slice')),
            ('MANAGER_START_TRANSIENT','MANAGER','MANAGER_CALL',lambda:self.domain.bus('StartTransientUnit','s','fixture.slice')),
            ('MANAGER_STOP_UNIT','MANAGER','MANAGER_CALL',lambda:self.domain.bus('StopUnit','s','fixture.slice')),
            ('ROOTED_PATH','ROOTED_CONTAINER','FSTAT',lambda:self.io.os.fstat(9002)),
            ('ROOTED_PATH','ROOTED_CONTAINER','STATVFS',lambda:self.io.os.fstatvfs(9002)),
            ('ROOTED_PATH','ROOTED_CONTAINER','LISTDIR',lambda:self.io.os.listdir(9002)),
            ('ROOTED_PATH','ROOTED_CONTAINER','READLINK',lambda:self.io.os.readlink('',dir_fd=9002)),
            ('CGROUP_CGROUP_TYPE','OWNED_PARENT','OPEN',lambda:self.domain.readat(9000,'cgroup.type')),
            ('ROOTED_PATH','ROOTED_CONTAINER','ROOTED_OPENAT2',lambda:self.synthetic_rooted_open()),
            ('ENGINE_VERSION','HOST_METADATA','MANAGER_CALL',lambda:self.controller.request('GET','/version',10**10)),
            ('DOCKER_GENERATED_SOURCE','HOST_METADATA','STAT',lambda:self.io.invoke('DOCKER_GENERATED_SOURCE','HOST_METADATA','STAT',forbidden)),
        ]
        for op,cls,action,call in families:
            for kind,number in [(FileNotFoundError,errno.ENOENT),(PermissionError,errno.EACCES),(OSError,errno.EIO)]:
                with self.subTest(op=op,error=kind.__name__):
                    self.journal.state['failures']=[];self.journal.state['failureCount']=0
                    self.journal.state['operationEvidenceComplete']=True
                    self.io.fd_classes[9000]=('CGROUP_INTERFACE','OWNED_PARENT')
                    self.io.fd_classes[9002]=('ROOTED_PATH','ROOTED_CONTAINER')
                    self.io.provider=Fixture((op,cls,action),kind(number,'PRIVATE_INJECTED_ERROR','PRIVATE_INJECTED_PATH'))
                    with self.assertRaises((kind,RuntimeError)) as caught:call()
                    full=self.full_export(caught.exception)
                    self.assertTrue(full['operationEvidenceComplete'],full)
                    projected=self.projected()
                    errors=projected['writers'][0]['failures']
                    self.assertTrue(any(e.get('operationId')==op and e.get('objectClass')==cls and e.get('errno')==number for e in errors))
                    self.assertTrue(projected['operationEvidenceComplete'])
                    if number==errno.ENOENT:self.examples.append({'syntheticOperation':op,'expectedErrno':number,'exportedFailure':next(e for e in errors if e.get('operationId')==op and e.get('errno')==number)})
    def synthetic_rooted_open(self):
        root=object.__new__(self.rooted.Root)
        root.fd=9000;root.check=lambda:None
        return root.open('/fixture/container-path',os.O_PATH)
    def test_full_synthetic_preflight_root_special_and_package_failure_export(self):
        # Real candidate preflight logic; all external interfaces are fixtures.
        # Local evidence writes are real and guarded. No source-of-truth host read.
        with patch.object(self.io.os,'geteuid',lambda:0):
            value=self.domain.preflight(self.directory,10**10)
        self.assertEqual(value['shared']['type'],'ROOT_SPECIAL')
        self.assertEqual(value['packageVersion'],'255.4-1ubuntu8.18')
        self.io.provider=Fixture(('PACKAGE_VERSION','MANAGER','MANAGER_CALL'),
            FileNotFoundError(errno.ENOENT,'PRIVATE_INJECTED_ERROR','PRIVATE_INJECTED_PATH'))
        with patch.object(self.io.os,'geteuid',lambda:0):
            with self.assertRaisesRegex(RuntimeError,'MANAGER_CLI_CAPABILITY_PENDING'):
                self.domain.preflight(self.directory,10**10)
        exported=self.projected()
        self.assertTrue(any(e.get('operationId')=='PACKAGE_VERSION' and e.get('errno')==errno.ENOENT
                            for e in exported['writers'][0]['failures']))
        self.assertTrue(exported['operationEvidenceComplete'])

    def test_rooted_capability_errnos_are_preserved_without_fallback(self):
        for number in (errno.ENOSYS,errno.EINVAL,errno.EACCES,errno.ELOOP,errno.EAGAIN):
            with self.subTest(errno=number):
                self.io.provider=Fixture(('ROOTED_PATH','ROOTED_CONTAINER','ROOTED_OPENAT2'),
                    OSError(number,'PRIVATE_INJECTED_ERROR','PRIVATE_INJECTED_PATH'))
                with self.assertRaises(OSError):self.synthetic_rooted_open()
                event=self.projected()['writers'][0]['failures'][-1]
                self.assertEqual(event['errno'],number)
                self.assertEqual(event['operationId'],'ROOTED_PATH')
    def test_own_kill_write_failure_is_structured_without_real_write(self):
        self.io.fd_classes[9003]=('CGROUP_CGROUP_KILL','OWNED_PARENT')
        self.io.provider=Fixture(('CGROUP_CGROUP_KILL','OWNED_PARENT','WRITE_FD'),
                                PermissionError(errno.EACCES,'PRIVATE_INJECTED_ERROR'))
        with self.assertRaises(PermissionError):self.io.os.write(9003,b'1')
        event=self.projected()['writers'][0]['failures'][-1]
        self.assertEqual(event['action'],'WRITE_FD')
        self.assertEqual(event['errno'],errno.EACCES)

    def test_before_state_persisted_before_backend(self):
        observed=[]
        def provider(op,cls,action,backend):
            value=json.loads(next(self.directory.glob('interface-operations-*.json')).read_text())
            observed.append(value['current']['state'])
            return 'fixture'
        self.io.provider=provider
        self.io.invoke('PROC_STAT','HOST_PROC','READ_TEXT',forbidden)
        self.assertEqual(observed,['BEFORE'])
        self.assertEqual(self.journal.state['current']['state'],'AFTER')
    def test_unknown_operation_or_category_never_complete(self):
        self.io.provider=lambda *args:'fixture'
        self.io.invoke('PRIVATE_INJECTED_PATH','HOST_PROC','READ_TEXT',forbidden)
        self.assertFalse(self.projected()['operationEvidenceComplete'])
    def test_pending_before_state_never_complete(self):
        self.journal.event('PROC_STAT','HOST_PROC','READ_TEXT','BEFORE')
        self.assertFalse(self.projected()['operationEvidenceComplete'])
    def test_unknown_exception_never_complete(self):
        self.io.provider=lambda *args:(_ for _ in ()).throw(KeyError('PRIVATE_INJECTED_ERROR'))
        with self.assertRaises(KeyError):self.io.invoke('PROC_STAT','HOST_PROC','READ_TEXT',forbidden)
        self.assertFalse(self.projected()['operationEvidenceComplete'])
    def test_singleton_shared_across_components(self):
        self.assertIs(self.domain.IO,self.controller.IO)
        self.assertIs(self.rooted.IO.recorder,self.journal)
    def test_static_all_container_audit_paths_remain_rooted(self):
        tree=ast.parse((BASE/'docker-p0.INACTIVE.py').read_text())
        audit=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='audit')
        # Generic stat/open/exists of root Entry would bypass its rooted methods.
        for n in ast.walk(audit):
            if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and isinstance(n.func.value,ast.Name) and n.func.value.id=='os' and n.func.attr in ('stat','statvfs','open'):
                for arg in n.args:
                    self.assertFalse(any(isinstance(v,ast.Name) and v.id=='root' for v in ast.walk(arg)))


class CountingResult(unittest.TextTestResult):
    subtests=0
    def addSubTest(self,test,subtest,error):
        self.subtests+=1
        super().addSubTest(test,subtest,error)


def main():
    with contextlib.ExitStack() as guards:
        guards.enter_context(patch.object(subprocess,'run',forbidden))
        guards.enter_context(patch.object(subprocess,'Popen',forbidden))
        guards.enter_context(patch.object(socket,'socket',forbidden))
        guards.enter_context(patch.object(socket,'create_connection',forbidden))
        guards.enter_context(patch.object(os,'open',guarded_open))
        guards.enter_context(patch.object(os,'stat',guarded_stat))
        guards.enter_context(patch.object(os,'readlink',guarded_readlink))
        guards.enter_context(patch.object(os,'pidfd_open',forbidden))
        guards.enter_context(patch.object(io,'open',guarded_io_open))
        guards.enter_context(patch.object(builtins,'open',guarded_builtin_open))
        guards.enter_context(patch.object(os,'listdir',guarded_listdir))
        guards.enter_context(patch.object(ctypes,'CDLL',BlockedLibc))
        suite=unittest.defaultTestLoader.loadTestsFromTestCase(VerifierInterfaces)
        result=unittest.TextTestRunner(verbosity=2,resultclass=CountingResult).run(suite)
    summary={'kind':'SYNTHETIC_VERIFIER_TEST_RESULTS_NOT_CONTAINMENT_OR_PRODUCT',
             'testsRun':result.testsRun,'subtestCases':result.subtests,
             'failures':len(result.failures),'errors':len(result.errors),
             'passed':result.wasSuccessful(),'backendGuardsInstalledBeforeImports':True,
             'realDockerSystemdCgroupNetworkCallsPermitted':False,
             'productMethodsCalled':False,'exportPath':'controller.export_sanitized and real aggregation in local temporary evidence directories',
             'realTemporaryExports':VerifierInterfaces.full_exports,'examples':VerifierInterfaces.examples}
    Path('/tmp/hg-verifier-synthetic-results.json').write_text(json.dumps(summary,indent=2)+'\n')
    return 0 if result.wasSuccessful() else 1


if __name__=='__main__':
    raise SystemExit(main())
