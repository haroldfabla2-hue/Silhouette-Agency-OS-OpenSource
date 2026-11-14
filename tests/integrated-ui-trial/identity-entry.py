#!/usr/bin/env python3
"""Bounded trusted pre-bwrap helper. No project imports or host policy writes."""
import os,sys,socket,json,ctypes,hashlib,pathlib,signal
P=pathlib.Path
assert len(sys.argv)==3 and os.getuid()==os.geteuid()==0
fd=int(sys.argv[1]);bwrap=P(sys.argv[2]);channel=socket.socket(fileno=fd);channel.settimeout(8)
# If the root supervisor dies, never leave a blocked privileged helper behind.
libc=ctypes.CDLL(None,use_errno=True)
assert libc.prctl(1,signal.SIGKILL,0,0,0)==0
parent=os.getppid();assert parent>1
os.setgroups([])
assert libc.unshare(0x10000000)==0,'PRIVATE_USERNS_CREATION_FAILED'
def send(o):
 b=json.dumps(o,separators=(',',':')).encode();assert len(b)<=65536;assert channel.send(b)==len(b)
def recv():
 b=channel.recv(65537);assert 0<len(b)<=65536;v=json.loads(b);assert type(v)is dict;return v
send({'stage':'NAMESPACE_READY','pid':os.getpid(),'parent':parent,'userns':os.readlink('/proc/self/ns/user')})
config=recv();assert set(config)=={'stage','uidMap','gidMap','bwrapArgs'}and config['stage']=='MAPS_VERIFIED'
assert P('/proc/self/uid_map').read_text().split()==config['uidMap'].split()
assert P('/proc/self/gid_map').read_text().split()==config['gidMap'].split()
assert P('/proc/self/setgroups').read_text().strip()=='deny'
os.setresgid(0,0,0);os.setresuid(0,0,0)
assert libc.prctl(1,signal.SIGKILL,0,0,0)==0
assert os.getresuid()==(0,0,0)and os.getresgid()==(0,0,0)and os.getgroups()==[]
assert os.getppid()==parent,'SUPERVISOR_DISAPPEARED'
assert hashlib.sha256(bwrap.read_bytes()).hexdigest()=='e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71'
args=config['bwrapArgs'];assert type(args)is list and all(type(x)is str for x in args)and args[0]==str(bwrap)
assert not any(x.startswith('--userns')or x.split('=',1)[0]in {'--unshare-user','--unshare-user-try'}for x in args)
# Preserve bwrap's original post-userns bounding set BEFORE its setup exec.
# Root exec uses (bounding | inheritable); retain existing setup authority in
# inheritable across this one exec, then bwrap's own final capset cuts it to
# precisely its existing requested {SETPCAP,NET_ADMIN} before entry.
class Header(ctypes.Structure):_fields_=[('version',ctypes.c_uint32),('pid',ctypes.c_int)]
class Data(ctypes.Structure):_fields_=[('effective',ctypes.c_uint32),('permitted',ctypes.c_uint32),('inheritable',ctypes.c_uint32)]
h=Header(0x20080522,0);d=(Data*2)();assert libc.capget(ctypes.byref(h),ctypes.byref(d))==0
assert P('/proc/sys/kernel/cap_last_cap').read_text().strip()=='40','UNREVIEWED_CAPABILITY_RANGE'
full=(1<<41)-1;allowed=(1<<8)|(1<<12)
assert d[0].effective|(d[1].effective<<32)==full and d[0].permitted|(d[1].permitted<<32)==full
assert libc.prctl(47,4,0,0,0)==0 # PR_CAP_AMBIENT_CLEAR_ALL
for part in d:part.inheritable=part.permitted
assert libc.capset(ctypes.byref(h),ctypes.byref(d))==0
for cap in range(41):
 if cap not in {8,12}:assert libc.prctl(24,cap,0,0,0)==0
status=dict(l.split(':',1)for l in P('/proc/self/status').read_text().splitlines()if ':'in l)
assert int(status['CapBnd'].strip(),16)==allowed and int(status['CapAmb'].strip(),16)==0
assert all(int(status[k].strip(),16)==full for k in ['CapEff','CapPrm','CapInh'])
capabilityTransfer={k:status[k].strip()for k in ['CapEff','CapPrm','CapInh','CapBnd','CapAmb']}
send({'stage':'IDENTITY_READY','capabilityTransfer':capabilityTransfer,'pid':os.getpid(),'parent':os.getppid(),'uid':list(os.getresuid()),'gid':list(os.getresgid()),'groups':os.getgroups(),'uidMap':P('/proc/self/uid_map').read_text(),'gidMap':P('/proc/self/gid_map').read_text(),'setgroups':P('/proc/self/setgroups').read_text().strip(),'userns':os.readlink('/proc/self/ns/user'),'binarySha256':'e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71'})
assert recv()=={'stage':'EXEC_VERIFIED_BWRAP'}
assert os.getppid()==parent
channel.close();os.execve(str(bwrap),args,{'PATH':'/usr/bin:/bin'})
