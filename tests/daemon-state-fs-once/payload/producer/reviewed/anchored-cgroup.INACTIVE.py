"""INACTIVE host observer. No rootfs/process keeper, no CLI execution.
Acquired cgroup2 identity, live-empty or anchored destruction proofs only.
"""
import os,re,json,stat
from pathlib import Path

def need(value,code):
    if not value:raise RuntimeError(code)
FLAGS=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC

def identity(fd):
    s=os.fstat(fd)
    return {'dev':s.st_dev,'ino':s.st_ino}

def read_at(fd,name,limit=4096):
    need('/' not in name and name not in ('.','..'),'CG_COMPONENT')
    file=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
    try:
        need(stat.S_ISREG(os.fstat(file).st_mode),'CG_CONTROL_FILE')
        raw=os.read(file,limit+1);need(len(raw)<=limit,'CG_CONTROL_BOUND')
        return raw.decode().strip()
    finally:os.close(file)

def counters(text):
    out={}
    for line in text.splitlines():
        k,v=line.split();need(k not in out and v.isdecimal(),'CG_COUNTER_SCHEMA');out[k]=int(v)
    return out

def mount_id(fd):
    raw=Path('/proc/self/fdinfo/'+str(fd)).read_text()
    found=re.findall(r'^mnt_id:\s*(\d+)$',raw,re.M);need(len(found)==1,'CG_FD_MOUNT_ID');return found[0]

def mount_entry(mid):
    rows=[r for r in Path('/proc/self/mountinfo').read_text().splitlines() if r.split()[0]==mid]
    need(len(rows)==1,'CG_MOUNT_ENTRY');row=rows[0];left,right=row.split(' - ',1)
    fields=left.split();need(right.split()[0]=='cgroup2' and fields[3]=='/' and fields[4]=='/sys/fs/cgroup','CG_UNIFIED_MOUNT')
    need('memory_localevents' not in fields[5].split(',') and 'memory_localevents' not in right.split()[2].split(','),'CG_MEMORY_LOCAL_EVENTS')
    return row

class Anchor:
    def __init__(self,control_group,unit,invocation,pid,expected_controls=None):
        self.fds=[];self.closed=False
        try:
            need(re.fullmatch('daemon-state-fs-[a-f0-9]{16}\\.service',unit),'CG_UNIT_NAME')
            need(control_group=='/system.slice/'+unit,'CG_EXACT_MANAGER_PATH')
            need(re.fullmatch('[a-f0-9]{32}',invocation) is not None,'CG_INVOCATION')
            need(type(pid) is int and pid>1,'CG_WRAPPER_PID')
            self.unit=unit;self.invocation=invocation;self.control_group=control_group;self.pid=pid
            self.mount_namespace=Path('/proc/self/ns/mnt').stat().st_ino
            self.root=self.keep(os.open('/sys/fs/cgroup',FLAGS));self.mid=mount_id(self.root);self.mount=mount_entry(self.mid)
            self.parent=self.keep(os.open('system.slice',FLAGS,dir_fd=self.root));self.cg=self.keep(os.open(unit,FLAGS,dir_fd=self.parent))
            need(mount_id(self.parent)==self.mid and mount_id(self.cg)==self.mid,'CG_CROSS_MOUNT')
            self.root_id=identity(self.root);self.parent_id=identity(self.parent);self.cg_id=identity(self.cg)
            # Ancestor baseline first, before child-zero and host permission.
            self.parent_before=counters(read_at(self.parent,'memory.events'))
            need(all(k in self.parent_before for k in ('oom','oom_kill','oom_group_kill')),'CG_PARENT_COUNTER_FIELDS')
            need(all(0<=v<2**62 for v in self.parent_before.values()),'CG_PARENT_COUNTER_RANGE')
            self.pidfd=self.keep(os.pidfd_open(pid,0))
            membership=Path('/proc/'+str(pid)+'/cgroup').read_text().splitlines()
            need(membership==['0::'+control_group],'CG_WRAPPER_MEMBERSHIP')
            need(str(pid) in read_at(self.cg,'cgroup.procs').splitlines(),'CG_WRAPPER_NOT_LISTED')
            need(read_at(self.cg,'cgroup.type')=='domain','CG_DOMAIN')
            controls={k:read_at(self.cg,k) for k in ('memory.max','memory.swap.max','memory.oom.group','pids.max','cpu.max')}
            need(controls==(expected_controls or {'memory.max':'536870912','memory.swap.max':'0','memory.oom.group':'1','pids.max':'64','cpu.max':'100000 100000'}),'CG_KERNEL_CONTROLS')
            events=counters(read_at(self.cg,'cgroup.events'));need(events.get('populated')==1,'CG_NOT_ACQUIRED_LIVE')
            self.initial_memory=counters(read_at(self.cg,'memory.events'))
            need(all(k in self.initial_memory and self.initial_memory[k]==0 for k in ('oom','oom_kill','oom_group_kill')),'CG_INITIAL_OOM_UNVERIFIED')
            self.controls=controls;self.continuity()
        except BaseException:
            self.close();raise
    def keep(self,fd):self.fds.append(fd);return fd
    def record(self):
        return {'kind':'ACQUIRED_CGROUP2_BEFORE_NODE','unit':self.unit,'invocationId':self.invocation,'wrapperPid':self.pid,'controlGroup':self.control_group,'mountId':self.mid,'rootIdentity':self.root_id,'parentIdentity':self.parent_id,'cgroupIdentity':self.cg_id,'kernelControls':self.controls,'initialMemoryEvents':self.initial_memory,'parentMemoryEventsBeforeChildZero':self.parent_before,'parentScope':'system.slice_NOT_ROOT','hierarchicalMemoryEvents':True,'parentAndCgroupHandlesRetained':True}
    def continuity(self):
        need(not self.closed,'CG_ANCHOR_CLOSED')
        need(Path('/proc/self/ns/mnt').stat().st_ino==self.mount_namespace,'CG_MOUNT_NAMESPACE_CHANGED')
        need(mount_entry(self.mid)==self.mount,'CG_MOUNT_CHANGED')
        need(identity(self.root)==self.root_id and identity(self.parent)==self.parent_id and identity(self.cg)==self.cg_id,'CG_HELD_IDENTITY_CHANGED')
        # Current absolute hierarchy and relative parent must still be the held ones.
        root=os.open('/sys/fs/cgroup',FLAGS)
        try:
            need(identity(root)==self.root_id and mount_id(root)==self.mid,'CG_ROOT_REPLACED')
            parent=os.open('system.slice',FLAGS,dir_fd=root)
            try:need(identity(parent)==self.parent_id and mount_id(parent)==self.mid,'CG_PARENT_REPLACED')
            finally:os.close(parent)
        finally:os.close(root)
    def lookup(self):
        self.continuity()
        try:fd=os.open(self.unit,FLAGS,dir_fd=self.parent)
        except FileNotFoundError:return None
        try:
            need(identity(fd)==self.cg_id and mount_id(fd)==self.mid,'CG_REPLACED')
            return True
        finally:os.close(fd)
    def prove_empty(self,manager):
        need(manager.get('Id')==self.unit and manager.get('InvocationID')==self.invocation and manager.get('NRestarts')=='0','CG_TERMINAL_UNIT_IDENTITY')
        need(manager.get('ControlGroup') in ('',self.control_group),'CG_MANAGER_PATH_CHANGED')
        need(manager.get('MainPID')=='0' and manager.get('ControlPID')=='0' and manager.get('ActiveState') in ('active','inactive','failed'),'CG_MANAGER_NOT_TERMINAL')
        present=self.lookup()
        if present is None:
            # Original FD is held, cgroup2 cannot rename, root/parent/mount continuity
            # established. ENOENT only here proves destruction of acquired identity.
            need(self.lookup() is None,'CG_REAPPEARED')
            return {'kind':'ACQUIRED_IDENTITY_DESTROYED_CGROUP2','controlGroup':self.control_group,'identity':self.cg_id,'invocationId':self.invocation,'parentContinuity':True,'mountContinuity':True,'relativeLookup':'ENOENT_TWICE','noLiveWriters':True,'memoryEvents':{'state':'UNAVAILABLE_AFTER_DESTRUCTION','assumedZero':False}}
        before=counters(read_at(self.cg,'cgroup.events'));need(before.get('populated')==0,'CG_POPULATED')
        stack=[os.dup(self.cg)];count=0
        try:
            while stack:
                fd=stack.pop()
                try:
                    count+=1;need(count<=128,'CG_SUBTREE_BOUND')
                    need(not read_at(fd,'cgroup.procs'),'CG_WRITERS_PRESENT')
                    for name in os.listdir(fd):
                        st=os.stat(name,dir_fd=fd,follow_symlinks=False);need(not stat.S_ISLNK(st.st_mode),'CG_SUBTREE_SYMLINK')
                        if stat.S_ISDIR(st.st_mode):
                            child=os.open(name,FLAGS,dir_fd=fd)
                            if mount_id(child)!=self.mid:os.close(child);raise RuntimeError('CG_SUBTREE_MOUNT')
                            stack.append(child)
                finally:os.close(fd)
        finally:
            for fd in stack:os.close(fd)
        after=counters(read_at(self.cg,'cgroup.events'));need(after.get('populated')==0,'CG_REPOPULATED')
        memory=counters(read_at(self.cg,'memory.events'))
        need(all(k in memory for k in ('oom','oom_kill','oom_group_kill')),'CG_FINAL_OOM_MISSING')
        need(self.lookup() is True,'CG_DISAPPEARED_DURING_LIVE_PROOF')
        return {'kind':'SAME_IDENTITY_EXTANT_EMPTY_SUBTREE','controlGroup':self.control_group,'identity':self.cg_id,'populatedBefore':0,'populatedAfter':0,'recursiveProcsEmpty':True,'directoriesChecked':count,'noLiveWriters':True,'memoryEvents':{'state':'OBSERVED','values':memory,'assumedZero':False}}
    def prove_no_oom(self,empty_proof):
        need(empty_proof.get('noLiveWriters') is True,'CG_OOM_BEFORE_EMPTY_PROOF')
        self.continuity()
        after=counters(read_at(self.parent,'memory.events'))
        self.continuity()
        keys=('oom','oom_kill','oom_group_kill')
        need(all(k in after and 0<=self.parent_before[k]<=after[k]<2**62 for k in keys),'CG_PARENT_COUNTER_RESET_OR_MISSING')
        delta={k:after[k]-self.parent_before[k] for k in keys}
        need(all(v==0 for v in delta.values()),'OOM_EVIDENCE_CONTAMINATED')
        child=empty_proof['memoryEvents']
        if child['state']=='OBSERVED':
            need(all(k in child['values'] and child['values'][k]==0 for k in keys),'CG_CHILD_OOM_EVENT')
        else:need(child['state']=='UNAVAILABLE_AFTER_DESTRUCTION' and child['assumedZero'] is False,'CG_CHILD_COUNTER_STATE')
        return {'kind':'ANCHORED_NONROOT_ANCESTOR_ZERO_OOM_DELTA','before':self.parent_before,'after':after,'delta':delta,'childTerminalCounters':child,'assumedZero':False,'scope':'PARENT_NO_EVENTS_IMPLIES_ACQUIRED_CHILD_NO_EVENTS','foreignEvents':'CONSERVATIVE_UNKNOWN_NOT_ATTRIBUTED'}
    def close(self):
        for fd in reversed(self.fds):
            try:os.close(fd)
            except OSError:pass
        self.fds=[];self.closed=True
