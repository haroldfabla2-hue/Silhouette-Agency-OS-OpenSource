"""Inactive verifier interface contracts and source-side diagnostic journal.
No host action occurs at import. Tests can replace the explicit operation provider
before any candidate function is called. The provider is never used in production.
"""
import contextlib
import errno
import json
import os as native_os
from pathlib import Path as NativePath
import stat
import threading
import functools
import uuid

CLASSES = frozenset({'ROOT_SPECIAL','OWNED_PARENT','OWNED_SCOPE','HOST_PROC',
                     'ROOTED_CONTAINER','MANAGER','HOST_METADATA','LOCAL_SOURCE','EVIDENCE_LEDGER','CONTROLLER_CGROUP'})
FIELDS = frozenset({'cgroup.controllers','cgroup.subtree_control','cgroup.type',
                    'cgroup.events','cgroup.kill','cgroup.procs','cgroup.threads',
                    'memory.max','memory.swap.max','pids.max','pids.current','cpu.max'})
ROOT_EXEMPT = frozenset({'cgroup.type','cgroup.events','cgroup.kill',
                         'memory.max','memory.swap.max','pids.max','cpu.max'})
ACTIONS = frozenset({'READ_TEXT','READ_BYTES','STAT','LSTAT','OPEN','READ_FD','FSTAT',
                     'LISTDIR','READLINK','STATVFS','ACCESS','PIDFD','SYSCONF',
                     'UNAME','MANAGER_CALL','ROOTED_OPENAT2','ABI_ABSENCE','EXISTS','WRITE_FD','PARSE_VALIDATE'})
SPECIAL = frozenset({'ROOT_MOUNTINFO','ROOT_NAMESPACE','ROOT_INODE','ROOT_CONTROLLERS',
                     'ROOT_SUBTREE_CONTROL','ROOT_ABI_EXEMPT','SELF_CGROUP',
                     'KILL_FEATURE_METADATA','MANAGER_VERSION','PACKAGE_VERSION',
                     'MANAGER_UNIT_STATE','MANAGER_GET_UNIT','MANAGER_START_TRANSIENT',
                     'MANAGER_STOP_UNIT','MANAGER_OTHER_REJECTED','PROC_METADATA',
                     'ROOTED_PATH','CGROUP_INTERFACE','HOST_FILE','LOCAL_FILE',
                     'EVIDENCE_FILE','SYSCONF','PIDFD','UNAME','UNKNOWN_OPERATION',
                     'ENGINE_VERSION','ENGINE_INFO','ENGINE_INSPECT','ENGINE_REQUEST',
                     'ENGINE_OPERATION','ENGINE_ACQUIRE','VERIFIER_CONTRACT','EVIDENCE_JSON','MONITOR_DEADLINE'})
FAILURE_ENUMS = frozenset({'OP_ENOENT','OP_EACCES','OP_OSERROR','OP_VALUE_ERROR',
                           'OP_CONTRACT_FAILURE','OP_UNCLASSIFIED_FAILURE','OP_TIMEOUT','OP_PARSE_FAILURE'})
CONTRACT_MATRIX = {
 'ROOT_SPECIAL': {'required': ['cgroup.controllers','cgroup.subtree_control'],
                  'abiExempt': sorted(ROOT_EXEMPT), 'type': 'ROOT_SPECIAL_NOT_DOMAIN'},
 'OWNED_PARENT': {'required': sorted(FIELDS-{'cgroup.controllers','cgroup.subtree_control','pids.current'}), 'absentAllowed': []},
 'OWNED_SCOPE': {'required': sorted(FIELDS - {'cgroup.controllers','cgroup.subtree_control','pids.current','cgroup.events','cgroup.kill'}), 'absentAllowed': []},
 'CONTROLLER_CGROUP': {'required':['cgroup.kill'],'absentAllowed':[]},
 'HOST_PROC': {'required': ['mountinfo','cgroup','stat','status','comm','cmdline','ns','fd','fdinfo','net','attr'], 'absentAllowed': []},
 'MANAGER': {'required': ['Version','PackageVersion','UnitState','GetUnit','StartTransientUnit','StopUnit'], 'absentAllowed': []},
 'HOST_METADATA': {'required':['readable declared host source metadata'],'absentAllowed':[]},
 'ROOTED_CONTAINER': {'resolver': 'OPENAT2_IN_ROOT_NO_MAGICLINKS',
                      'absenceAtCallsiteOnly': ['SOCKET_ENOENT','OPTIONAL_MASK_ENOENT'],
                      'fallback': False}}

FIELD_OPERATIONS={field:'CGROUP_'+field.upper().replace('.','_') for field in FIELDS}
SPECIAL=SPECIAL|frozenset(FIELD_OPERATIONS.values())|frozenset({'PROC_STAT','PROC_STATUS','PROC_CMDLINE','PROC_COMM','PROC_FD','PROC_NET','PROC_SECURITY','PROC_ROOT_ANCHOR','DOCKER_GENERATED_SOURCE'})

provider = None
recorder = None
fd_classes = {}
_local = threading.local()


def classify(path, dir_fd=None):
    if isinstance(path, int):
        return fd_classes.get(path, ('HOST_FILE','HOST_METADATA'))
    value = native_os.fspath(path)
    if dir_fd is not None:
        parent = fd_classes.get(dir_fd, ('HOST_FILE','HOST_METADATA'))[1]
        return (FIELD_OPERATIONS[value] if value in FIELDS else 'ROOTED_PATH' if parent=='ROOTED_CONTAINER' else 'HOST_FILE',parent)
    if value == '/sys/fs/cgroup': return 'ROOT_INODE','ROOT_SPECIAL'
    if value.startswith('/sys/fs/cgroup/'):
        tail=value[len('/sys/fs/cgroup/'):]
        if '/' not in tail and tail in FIELDS:
            return ({'cgroup.controllers':'ROOT_CONTROLLERS','cgroup.subtree_control':'ROOT_SUBTREE_CONTROL'}.get(tail,'ROOT_ABI_EXEMPT'),'ROOT_SPECIAL')
        owned=tail.split('/')[0].startswith('silhouettep0')
        cls=('OWNED_SCOPE' if '.scope' in value else 'OWNED_PARENT') if owned else 'CONTROLLER_CGROUP'
        return ('KILL_FEATURE_METADATA' if cls=='CONTROLLER_CGROUP' and tail.endswith('/cgroup.kill') else FIELD_OPERATIONS.get(tail.split('/')[-1],'CGROUP_INTERFACE'),cls)
    if value == '/proc/self/mountinfo': return 'ROOT_MOUNTINFO','HOST_PROC'
    if value.startswith('/proc/'):
        if '/ns/' in value:return 'ROOT_NAMESPACE','HOST_PROC'
        if value.endswith('/cgroup'):return 'SELF_CGROUP','HOST_PROC'
        name=value.split('/')[-1]
        op={'stat':'PROC_STAT','status':'PROC_STATUS','cmdline':'PROC_CMDLINE','comm':'PROC_COMM','root':'PROC_ROOT_ANCHOR'}.get(name)
        if op is None:op='PROC_FD' if '/fd' in value else 'PROC_NET' if '/net/' in value else 'PROC_SECURITY' if '/attr/' in value else 'PROC_METADATA'
        return op,'HOST_PROC'
    if value.endswith('.INACTIVE.py') or value.endswith('.INACTIVE.json'):
        return 'LOCAL_FILE','LOCAL_SOURCE'
    if value.startswith('/tmp/silhouette-p0-') or value.startswith('/tmp/p0-'):
        return 'EVIDENCE_FILE','EVIDENCE_LEDGER'
    return 'HOST_FILE','HOST_METADATA'


def durable_json(directory, name, value):
    destination=NativePath(directory)/name
    tmp=destination.with_suffix('.tmp')
    raw=(json.dumps(value,sort_keys=True)+'\n').encode()
    fd=native_os.open(tmp,native_os.O_WRONLY|native_os.O_CREAT|native_os.O_TRUNC|native_os.O_NOFOLLOW,0o600)
    try:
        if native_os.write(fd,raw)!=len(raw):raise RuntimeError('DIAGNOSTIC_SHORT_WRITE')
        native_os.fsync(fd)
    finally:native_os.close(fd)
    native_os.replace(tmp,destination)
    directory_fd=native_os.open(directory,native_os.O_RDONLY|native_os.O_DIRECTORY|native_os.O_NOFOLLOW)
    try:native_os.fsync(directory_fd)
    finally:native_os.close(directory_fd)


class Journal:
    def __init__(self,directory,role='controller',nonce=None):
        self.directory=NativePath(directory)
        self.state={'schemaVersion':2,'kind':'VERIFIER_OPERATION_DIAGNOSTICS',
                    'writerPid':native_os.getpid(),'writerRole':role,'writerNonce':nonce or uuid.uuid4().hex,
                    'sequence':0,'operationEvidenceComplete':True,'incompleteReasons':[],
                    'failureCount':0,'failures':[],'current':None,'recent':[], 'pending':{}}
        self.lock=threading.RLock()
        self.persist()

    def persist(self):
        durable_json(self.directory,'interface-operations-%d.json'%native_os.getpid(),self.state)

    def event(self,op,cls,action,status,error=None,subject=None,call_id=None):
        with self.lock:
            self.state['sequence']+=1
            if status=='BEFORE':call_id=self.state['sequence']
            if call_id is None or (status!='BEFORE' and str(call_id) not in self.state['pending']):
                self.incomplete('UNMATCHED_COMPLETION')
            if not (op in SPECIAL and cls in CLASSES and action in ACTIONS):self.incomplete('UNKNOWN_OPERATION_CATEGORY')
            expected=('ROOT_EXEMPT' if action=='ABI_ABSENCE' else 'ROOT_REQUIRED' if cls=='ROOT_SPECIAL' else
                      'NONROOT_REQUIRED' if cls in ('OWNED_PARENT','OWNED_SCOPE','CONTROLLER_CGROUP') else
                      'PROC_INTERFACE' if cls=='HOST_PROC' else 'ROOTED_LOOKUP' if cls=='ROOTED_CONTAINER' else
                      'MANAGER_CONTRACT' if cls=='MANAGER' else 'DECLARED_METADATA')
            event={'expectedContract':expected,'operationId':op if op in SPECIAL else 'UNKNOWN_OPERATION',
                   'objectClass':cls if cls in CLASSES else 'HOST_METADATA',
                   'action':action if action in ACTIONS else 'READ_TEXT', 'callId':call_id,
                   'threadId':threading.get_ident(),'state':status,'sequence':self.state['sequence']}
            for key,value in (subject or {}).items():
                if key in ('subjectPid','descriptor','device','inode') and isinstance(value,int):event[key]=value
                if key=='existsResult' and isinstance(value,bool):event[key]=value
            if status=='BEFORE':
                if len(self.state['pending'])>=128:self.incomplete('PENDING_BOUND_EXCEEDED')
                self.state['pending'][str(call_id)]=event
            else:self.state['pending'].pop(str(call_id),None)
            if error is not None:
                event['exceptionClass']=type(error).__name__ if type(error).__name__ in ('FileNotFoundError','PermissionError','OSError','RuntimeError','ValueError','TimeoutError','TimeoutExpired','ProcessLookupError','IndexError','KeyError','TypeError','JSONDecodeError','UnicodeDecodeError') else 'OtherException'
                if isinstance(error,OSError):event['errno']=error.errno if isinstance(error.errno,int) else None
                event['reason']=('OP_TIMEOUT' if isinstance(error,TimeoutError) or type(error).__name__=='TimeoutExpired' else 'OP_ENOENT' if isinstance(error,FileNotFoundError) else
                                 'OP_EACCES' if isinstance(error,PermissionError) else 'OP_OSERROR' if isinstance(error,OSError) else
                                 'OP_PARSE_FAILURE' if action=='PARSE_VALIDATE' and isinstance(error,(ValueError,IndexError,KeyError,TypeError)) else
                                 'OP_VALUE_ERROR' if isinstance(error,ValueError) else 'OP_CONTRACT_FAILURE' if isinstance(error,RuntimeError) else 'OP_UNCLASSIFIED_FAILURE')
                reference=getattr(error,'_p0_failure',None)
                if reference is None:
                    reference={'writerPid':self.state['writerPid'],'callId':call_id}
                    try:error._p0_failure=reference
                    except Exception:self.incomplete('FAILURE_LINK_UNAVAILABLE')
                event['decisiveFailure']=reference
                self.state['decisiveFailure']=reference
                self.state['failureCount']+=1
                if len(self.state['failures'])<32:self.state['failures'].append(event)
                else:self.incomplete('FAILURE_BOUND_EXCEEDED')
                if event['reason']=='OP_UNCLASSIFIED_FAILURE':self.incomplete('UNCLASSIFIED_FAILURE')
            self.state['current']=event
            self.state['recent']=(self.state['recent']+[event])[-32:]
            self.persist()
            return call_id

    def incomplete(self,reason):
        self.state['operationEvidenceComplete']=False
        if reason not in self.state['incompleteReasons']:self.state['incompleteReasons'].append(reason)


def configure(directory,test_provider=None):
    global recorder,provider
    recorder=Journal(directory)
    provider=test_provider
    recorder.expected={'phase':'PREMONITOR','writers':{'controller':{'writerNonce':recorder.state['writerNonce'],'writerPid':native_os.getpid()}}}
    durable_json(directory,'interface-writers.json',recorder.expected)
    return recorder


def expect_monitors():
    # Controller persists reservations BEFORE either fork. Children do not update
    # the manifest, so concurrent writers cannot overwrite each other's identity.
    for role in ('observer','watcher'):
        recorder.expected['writers'][role]={'writerNonce':uuid.uuid4().hex}
    recorder.expected['phase']='MONITORS_EXPECTED'
    durable_json(recorder.directory,'interface-writers.json',recorder.expected)
    return dict(recorder.expected['writers'])


def expect_pid(role,pid):
    recorder.expected['writers'][role]['writerPid']=pid
    durable_json(recorder.directory,'interface-writers.json',recorder.expected)


def bind_writer(directory,role,nonce):
    global recorder
    recorder=Journal(directory,role,nonce)


@contextlib.contextmanager
def suspended():
    previous=getattr(_local,'suspended',False)
    _local.suspended=True
    try:yield
    finally:_local.suspended=previous


def active_recorder():
    return None if getattr(_local,'suspended',False) else recorder


@contextlib.contextmanager
def envelope(op,cls):
    journal=active_recorder()
    call_id=journal.event(op,cls,'PARSE_VALIDATE','BEFORE') if journal else None
    try:yield
    except BaseException as error:
        if journal:journal.event(op,cls,'PARSE_VALIDATE','FAILED',error,call_id=call_id)
        raise
    else:
        if journal:journal.event(op,cls,'PARSE_VALIDATE','AFTER',call_id=call_id)


def contract(op,cls):
    def decorate(function):
        @functools.wraps(function)
        def wrapped(*args,**kwargs):
            with envelope(op,cls):return function(*args,**kwargs)
        return wrapped
    return decorate


def read_json(path):
    with envelope('EVIDENCE_JSON','EVIDENCE_LEDGER'):
        value=json.loads(Path(path).read_text())
        if not isinstance(value,dict):raise ValueError('JSON_OBJECT_REQUIRED')
        return value


def invoke(op,cls,action,call,subject=None):
    journal=active_recorder()
    call_id=journal.event(op,cls,action,'BEFORE',subject=subject) if journal else None
    try:
        if cls=='ROOT_SPECIAL' and action!='ABI_ABSENCE' and (op=='ROOT_ABI_EXEMPT' or op in {FIELD_OPERATIONS[v] for v in ROOT_EXEMPT}):
            raise RuntimeError('ROOT_INTERFACE_ABI_INVALID')
        result=provider(op,cls,action,call) if provider is not None else call()
    except BaseException as error:
        if journal:journal.event(op,cls,action,'FAILED',error,subject=subject,call_id=call_id)
        raise
    after=dict(subject or {})
    if hasattr(result,'st_dev') and hasattr(result,'st_ino'):after.update(device=result.st_dev,inode=result.st_ino)
    if action=='EXISTS' and isinstance(result,bool):after['existsResult']=result
    if journal:journal.event(op,cls,action,'AFTER',subject=after,call_id=call_id)
    return result


def proc_starttime(raw,pid):
    # Called inside each PROC_STAT envelope, including decode/shape checks.
    import re
    close=raw.rfind(')')
    if not raw.startswith(str(pid)+' (') or close<len(str(pid))+2:
        raise ValueError('PROC_STAT_SHAPE')
    fields=raw[close+2:].split()
    if len(fields)<20 or not re.fullmatch('[A-Za-z]',fields[0]) or not fields[19].isdigit():
        raise ValueError('PROC_STAT_SHAPE')
    return int(fields[19])


def reported_failure(op,cls,code):
    try:
        with envelope(op,cls):raise RuntimeError(code)
    except RuntimeError as error:return failure_reference(error)


def failure_reference(error):
    reference=getattr(error,'_p0_failure',None)
    if reference is None and recorder:
        recorder.incomplete('UNATTRIBUTED_DECISIVE_FAILURE')
        call=recorder.event('VERIFIER_CONTRACT','HOST_METADATA','PARSE_VALIDATE','BEFORE')
        recorder.event('VERIFIER_CONTRACT','HOST_METADATA','PARSE_VALIDATE','FAILED',error,call_id=call)
        reference=getattr(error,'_p0_failure',None)
    return reference


def absence(field):
    if field not in ROOT_EXEMPT:raise RuntimeError('ROOT_ABI_EXEMPT_FIELD_REJECTED')
    return invoke('ROOT_ABI_EXEMPT','ROOT_SPECIAL','ABI_ABSENCE',lambda:'ROOT_EXEMPT')


def safe_journal(value):
    """Closed diagnostic projection. Missing schema fields never imply success."""
    import re
    reasons=[]
    def bad(reason):
        if reason not in reasons:reasons.append(reason)
    if not isinstance(value,dict):return {'operationEvidenceComplete':False,'incompleteReasons':['INVALID_DIAGNOSTIC_SCHEMA']}
    out={'schemaVersion':2,'kind':'VERIFIER_OPERATION_DIAGNOSTICS'}
    if value.get('schemaVersion')!=2 or value.get('kind')!='VERIFIER_OPERATION_DIAGNOSTICS':bad('INVALID_DIAGNOSTIC_SCHEMA')
    allowed_reasons={'UNMATCHED_COMPLETION','UNKNOWN_OPERATION_CATEGORY','PENDING_BOUND_EXCEEDED',
                     'FAILURE_LINK_UNAVAILABLE','FAILURE_BOUND_EXCEEDED','UNCLASSIFIED_FAILURE',
                     'UNATTRIBUTED_DECISIVE_FAILURE'}
    source_reasons=value.get('incompleteReasons')
    if not isinstance(source_reasons,list):bad('INVALID_DIAGNOSTIC_SCHEMA')
    else:
        for reason in source_reasons:
            if isinstance(reason,str) and reason in allowed_reasons:bad(reason)
            else:bad('UNKNOWN_INCOMPLETE_REASON')
    for k in ('writerPid','sequence','failureCount'):
        if type(value.get(k)) is int:out[k]=value[k]
        else:bad('INVALID_DIAGNOSTIC_SCHEMA')
    role=value.get('writerRole');nonce=value.get('writerNonce')
    if role not in ('controller','observer','watcher'):bad('INVALID_WRITER_IDENTITY')
    else:out['writerRole']=role
    if not isinstance(nonce,str) or not re.fullmatch('[a-f0-9]{32}',nonce):bad('INVALID_WRITER_IDENTITY')
    else:out['writerNonce']=nonce
    def reference(v):
        if isinstance(v,dict) and all(type(v.get(k)) is int and v[k]>0 for k in ('writerPid','callId')):
            return {k:v[k] for k in ('writerPid','callId')}
        bad('INVALID_FAILURE_LINK');return None
    def event(v):
        if not isinstance(v,dict):bad('INVALID_EVENT');return {}
        result={}
        for key,choices in [('operationId',SPECIAL),('objectClass',CLASSES),('action',ACTIONS),('state',{'BEFORE','AFTER','FAILED'}),('reason',FAILURE_ENUMS),('expectedContract',{'ROOT_EXEMPT','ROOT_REQUIRED','NONROOT_REQUIRED','PROC_INTERFACE','ROOTED_LOOKUP','MANAGER_CONTRACT','DECLARED_METADATA'}),('exceptionClass',{'FileNotFoundError','PermissionError','OSError','RuntimeError','ValueError','TimeoutError','TimeoutExpired','ProcessLookupError','OtherException','IndexError','KeyError','TypeError','JSONDecodeError','UnicodeDecodeError'})]:
            if key in v:
                if v[key] in choices:result[key]=v[key]
                else:bad('UNKNOWN_OPERATION_CATEGORY')
            elif key in ('operationId','objectClass','action','state','expectedContract'):bad('INVALID_EVENT')
        for k in ('sequence','callId','threadId','errno','subjectPid','descriptor','device','inode'):
            if type(v.get(k)) is int:result[k]=v[k]
        if type(result.get('callId')) is not int or result.get('callId',0)<=0:bad('INVALID_CALL_ID')
        if result.get('state')=='FAILED' and not all(k in result for k in ('reason','exceptionClass')):bad('INVALID_FAILURE_EVENT')
        if result.get('state')=='FAILED' and 'decisiveFailure' not in v:bad('INVALID_FAILURE_LINK')
        if isinstance(v.get('existsResult'),bool):result['existsResult']=v['existsResult']
        if 'decisiveFailure' in v:result['decisiveFailure']=reference(v['decisiveFailure'])
        if result.get('operationId')=='UNKNOWN_OPERATION' or result.get('reason')=='OP_UNCLASSIFIED_FAILURE':bad('UNCLASSIFIED_FAILURE')
        return result
    for key in ('recent','failures'):
        entries=value.get(key)
        if not isinstance(entries,list):bad('INVALID_DIAGNOSTIC_SCHEMA');entries=[]
        if len(entries)>32:bad('DIAGNOSTIC_BOUND_EXCEEDED')
        out[key]=[event(v) for v in entries[:32]]
        if key=='failures' and any(v.get('state')!='FAILED' for v in out[key]):bad('INVALID_FAILURE_EVENT')
    pending=value.get('pending')
    if not isinstance(pending,dict):bad('PENDING_SET_MISSING');pending={}
    if pending:bad('PENDING_OPERATIONS')
    out['pending']=[event(v) for v in list(pending.values())[:128]]
    if len(pending)>128:bad('DIAGNOSTIC_BOUND_EXCEEDED')
    if value.get('current') is not None:
        out['current']=event(value['current'])
        if out['current'].get('state')=='BEFORE':bad('PENDING_OPERATIONS')
    if 'decisiveFailure' in value:out['decisiveFailure']=reference(value['decisiveFailure'])
    if value.get('failureCount')!=len(out['failures']):bad('FAILURE_BOUND_EXCEEDED')
    if value.get('operationEvidenceComplete') is not True:bad('WRITER_MARKED_INCOMPLETE')
    out['incompleteReasons']=reasons
    out['operationEvidenceComplete']=not reasons
    return out


def project_operation_files(names,load):
    import re
    reasons=[]
    def bad(reason):
        if reason not in reasons:reasons.append(reason)
    selected=[name for name in names if re.fullmatch(r'interface-operations-[0-9]+\.json',name)]
    result={'writers':[],'source':'VERIFIER_ONLY_NOT_CONTAINMENT'}
    try:
        expected=load('interface-writers.json')
        writers=expected['writers'];phase=expected['phase']
        roles={'controller'} if phase=='PREMONITOR' else {'controller','observer','watcher'} if phase=='MONITORS_EXPECTED' else set()
        if not roles or set(writers)!=roles:raise ValueError()
    except Exception:writers={};phase='UNKNOWN';bad('EXPECTED_WRITERS_UNAVAILABLE')
    if 'phase.json' in names:
        try:
            stage=load('phase.json')['stage']
            if stage not in ('EXECUTOR_PREFLIGHT','ACQUISITION','PARENT_CREATE','CREATE','START','AUDIT','CLEANUP'):bad('WRITER_PHASE_UNKNOWN')
            if stage in ('START','AUDIT','CLEANUP') and phase!='MONITORS_EXPECTED':bad('WRITER_PHASE_MISMATCH')
        except Exception:bad('WRITER_PHASE_UNKNOWN')
    if 'monitors.json' in names:
        if phase!='MONITORS_EXPECTED':bad('WRITER_PHASE_MISMATCH')
        try:
            monitors=load('monitors.json')
            for role,key in (('controller','controllerPid'),('observer','observerPid'),('watcher','watcherPid')):
                if monitors.get(key)!=writers.get(role,{}).get('writerPid'):bad('MONITOR_IDENTITY_MISMATCH')
        except Exception:bad('MONITOR_IDENTITY_MISMATCH')
    result['writerPhase']=phase
    if not selected or len(selected)>8:bad('WRITER_COUNT_INVALID')
    seen=set();references=set();links=[]
    for name in sorted(selected)[:8]:
        try:value=safe_journal(load(name))
        except Exception:value={'operationEvidenceComplete':False,'incompleteReasons':['INVALID_DIAGNOSTIC_SCHEMA']}
        role=value.get('writerRole');pid=value.get('writerPid')
        if role in seen:bad('DUPLICATE_WRITER')
        seen.add(role)
        identity=writers.get(role,{})
        if name!='interface-operations-%s.json'%pid or identity.get('writerNonce')!=value.get('writerNonce') or identity.get('writerPid')!=pid:bad('WRITER_IDENTITY_MISMATCH')
        for event in value.get('failures',[]):
            references.add((pid,event.get('callId')))
            if 'decisiveFailure' in event:links.append(event['decisiveFailure'])
        result['writers'].append(value)
        if not value.get('operationEvidenceComplete'):bad('WRITER_INCOMPLETE')
    if seen!=set(writers):bad('EXPECTED_WRITER_MISSING_OR_UNEXPECTED')
    for link in links:
        if not link or (link['writerPid'],link['callId']) not in references:bad('DECISIVE_FAILURE_UNRESOLVED')
    result['failureReferences']=[{'writerPid':pid,'callId':call} for pid,call in sorted(references)]
    result['incompleteReasons']=reasons
    result['operationEvidenceComplete']=not reasons
    return result


def metadata(path,dir_fd=None):
    import re
    if isinstance(path,int):return {'descriptor':path}
    value=native_os.fspath(path)
    result={}
    match=re.match('/proc/([0-9]+|self)(?:/|$)',value)
    if match:result['subjectPid']=native_os.getpid() if match[1]=='self' else int(match[1])
    if dir_fd is not None:result['descriptor']=dir_fd
    return result


class Path(type(NativePath())):
    def read_text(self,*a,**kw):
        op,cls=classify(self)
        return invoke(op,cls,'READ_TEXT',lambda:NativePath(self).read_text(*a,**kw),metadata(self))
    def read_bytes(self):
        op,cls=classify(self)
        return invoke(op,cls,'READ_BYTES',lambda:NativePath(self).read_bytes(),metadata(self))
    def stat(self,*,follow_symlinks=True):
        op,cls=classify(self)
        return invoke(op,cls,'STAT' if follow_symlinks else 'LSTAT',lambda:NativePath(self).stat(follow_symlinks=follow_symlinks),metadata(self))
    def exists(self):
        op,cls=classify(self)
        return invoke(op,cls,'EXISTS',lambda:NativePath(self).exists(),metadata(self))
    def iterdir(self):
        op,cls=classify(self)
        names=invoke(op,cls,'LISTDIR',lambda:list(NativePath(self).iterdir()),metadata(self))
        return iter(Path(v) for v in names)
    def glob(self,pattern):
        op,cls=classify(self)
        values=invoke(op,cls,'LISTDIR',lambda:list(NativePath(self).glob(pattern)),metadata(self))
        return iter(Path(v) for v in values)
    def open(self,*a,**kw):
        # Writes are controlled local evidence, not interface observations.
        mode=a[0] if a else kw.get('mode','r')
        if any(c in mode for c in 'wax+'):return NativePath(self).open(*a,**kw)
        op,cls=classify(self)
        return invoke(op,cls,'OPEN',lambda:NativePath(self).open(*a,**kw),metadata(self))


class OS:
    def __getattr__(self,name):return getattr(native_os,name)
    def open(self,path,flags,*a,**kw):
        if flags & (native_os.O_CREAT|native_os.O_TRUNC):return native_os.open(path,flags,*a,**kw)
        op,cls=classify(path,kw.get('dir_fd'))
        fd=invoke(op,cls,'OPEN',lambda:native_os.open(path,flags,*a,**kw),metadata(path,kw.get('dir_fd')))
        fd_classes[fd]=(op,cls)
        return fd
    def close(self,fd):
        fd_classes.pop(fd,None)
        return native_os.close(fd)
    def _path(self,name,action,path,*a,**kw):
        op,cls=classify(path,kw.get('dir_fd'))
        return invoke(op,cls,action,lambda:getattr(native_os,name)(path,*a,**kw),metadata(path,kw.get('dir_fd')))
    def write(self,fd,data):
        if fd not in fd_classes:return native_os.write(fd,data)
        return self._path('write','WRITE_FD',fd,data)
    def read(self,fd,*a):return self._path('read','READ_FD',fd,*a)
    def fstat(self,fd):return self._path('fstat','FSTAT',fd)
    def fstatvfs(self,fd):return self._path('fstatvfs','STATVFS',fd)
    def stat(self,path,*a,**kw):return self._path('stat','STAT',path,*a,**kw)
    def statvfs(self,path):return self._path('statvfs','STATVFS',path)
    def listdir(self,path):return self._path('listdir','LISTDIR',path)
    def readlink(self,path,*a,**kw):return self._path('readlink','READLINK',path,*a,**kw)
    def access(self,path,*a,**kw):return self._path('access','ACCESS',path,*a,**kw)
    def pidfd_open(self,*a):return invoke('PIDFD','HOST_PROC','PIDFD',lambda:native_os.pidfd_open(*a),{'subjectPid':a[0]})
    def sysconf(self,*a):return invoke('SYSCONF','HOST_METADATA','SYSCONF',lambda:native_os.sysconf(*a))
    def uname(self):return invoke('UNAME','HOST_METADATA','UNAME',native_os.uname)

os=OS()


if __name__=='__main__':
    raise SystemExit('INACTIVE: interface support module, no standalone action')
