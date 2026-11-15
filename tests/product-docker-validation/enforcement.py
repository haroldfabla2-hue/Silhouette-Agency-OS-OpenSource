"""Pure exact enforcement readers, not a Docker invocation or runtime proof."""
from pathlib import Path
import os,stat
MEMORY=3*1024**3
LIMITS={'memory.max':str(MEMORY),'memory.swap.max':'0','pids.max':'96','cpu.max':'100000 100000'}
RO_ROOTS={'/usr','/lib','/lib64','/node','/app','/driver','/envelope','/etc/hosts','/etc/hostname','/etc/resolv.conf','/sys','/sys/fs/cgroup'}
RW_ROOTS={'/fixtures','/evidence','/dev','/dev/pts','/dev/shm','/dev/mqueue'}
MASKED_PROC={'/proc/bus','/proc/fs','/proc/irq','/proc/sys','/proc/sysrq-trigger','/proc/acpi','/proc/asound','/proc/interrupts','/proc/kcore','/proc/keys','/proc/latency_stats','/proc/timer_list','/proc/scsi','/proc/sched_debug','/proc/timer_stats'}
DEVICES={'null':(1,3),'zero':(1,5),'full':(1,7),'random':(1,8),'urandom':(1,9),'tty':(5,0)}
def unescape(s):
    # No user-chosen paths: reject rather than silently decode ambiguity.
    assert '\\'not in s and '\n'not in s
    return s

def mounts(raw):
    rows=[]
    for line in raw.splitlines():
        left,right=line.split(' - ',1);a=left.split();b=right.split();assert len(a)>=6 and len(b)>=3
        rows.append({'target':unescape(a[4]),'root':unescape(a[3]),'options':set(a[5].split(',')),'optional':a[6:],'fstype':b[0],'source':b[1],'superOptions':set(b[2].split(','))})
    assert rows
    return rows

def verify_mounts(raw):
    rows=mounts(raw);targets={r['target']for r in rows};assert RO_ROOTS|RW_ROOTS|{'/','/proc','/app/node_modules'}<=targets
    # Reject duplicate overmounts: do not pick whichever line looks safest.
    assert len(targets)==len(rows)
    for r in rows:
        t=r['target'];o=r['options'];assert not any(x.startswith(('shared:','master:','propagate_from:'))for x in r['optional'])
        if t=='/':assert 'ro'in o
        elif any(t==p or t.startswith(p+'/')for p in RO_ROOTS):assert 'ro'in o
        elif t=='/proc':assert r['fstype']=='proc'and {'nosuid','nodev','noexec'}<=o
        elif t in MASKED_PROC:
            assert 'ro'in o or r['fstype']=='tmpfs'and r['root']=='/null'
        elif t in RW_ROOTS:
            if t=='/evidence':assert 'rw'in o
            elif t=='/fixtures':assert r['fstype']=='tmpfs'and {'rw','nosuid','nodev','noexec'}<=o and 'size=65536k'in r['superOptions']
            elif t=='/dev/shm':assert r['fstype']=='tmpfs'and {'nosuid','nodev','noexec'}<=o and 'size=64k'in r['superOptions']
            elif t=='/dev':assert r['fstype']=='tmpfs'and 'nosuid'in o
            elif t=='/dev/pts':assert r['fstype']=='devpts'and {'nosuid','noexec'}<=o
            elif t=='/dev/mqueue':assert r['fstype']=='mqueue'and {'nosuid','nodev','noexec'}<=o
        else:raise AssertionError('UNREVIEWED_MOUNT')
    return True

def actual_cgroup(pid):
    raw=(Path('/proc')/str(pid)/'cgroup').read_text().strip();assert raw.startswith('0::/')and '\n'not in raw
    cg=Path('/sys/fs/cgroup')/raw[4:];assert cg.resolve().is_relative_to(Path('/sys/fs/cgroup'))
    assert str(pid)in(cg/'cgroup.procs').read_text().split()
    for name,value in LIMITS.items():assert(cg/name).read_text().strip()==value
    assert(cg/'cpuset.cpus.effective').read_text().strip().isdigit()
    ancestors=[];p=cg
    while True:
        maximum=(p/'memory.max').read_text().strip()if(p/'memory.max').exists()else'max';current=int((p/'memory.current').read_text())if(p/'memory.current').exists()else 0
        # Before workload begins retain full3GiB allowance +256MiB reserve at
        # ancestors, matching old safety bar, even if this is conservative.
        if p!=cg and maximum!='max':assert int(maximum)-current>=MEMORY+256*1024**2
        ancestors.append(str(p))
        if p==Path('/sys/fs/cgroup'):break
        p=p.parent
    assert int(dict(x.split(':',1)for x in Path('/proc/meminfo').read_text().splitlines())['MemAvailable'].split()[0])*1024>=MEMORY+1024**3
    return cg,ancestors

def verify_devices(pid):
    root=Path('/proc')/str(pid)/'root/dev'
    assert {p.name for p in root.iterdir()}==set(DEVICES)|{'pts','ptmx','shm','mqueue','fd','stdin','stdout','stderr'}
    for name,(major,minor)in DEVICES.items():
        s=(root/name).stat();assert stat.S_ISCHR(s.st_mode)and(os.major(s.st_rdev),os.minor(s.st_rdev))==(major,minor)
    for name,target in [('ptmx','pts/ptmx'),('fd','/proc/self/fd'),('stdin','/proc/self/fd/0'),('stdout','/proc/self/fd/1'),('stderr','/proc/self/fd/2')]:assert os.readlink(root/name)==target
    assert list((root/'pts').iterdir())and all(p.name=='ptmx'for p in(root/'pts').iterdir())
    assert not any((root/'shm').iterdir())and not any((root/'mqueue').iterdir())
    return True

def verify_proc_masks(pid,raw):
    root=Path('/proc')/str(pid)/'root'
    for row in mounts(raw):
        if row['target']in MASKED_PROC and 'ro'not in row['options']:
            info=(root/row['target'].lstrip('/')).stat()
            assert stat.S_ISCHR(info.st_mode)and(os.major(info.st_rdev),os.minor(info.st_rdev))==(1,3),'NON_NULL_WRITABLE_PROC_MASK'
    return True
