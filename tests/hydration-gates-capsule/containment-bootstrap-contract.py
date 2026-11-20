"""INACTIVE namespace-only setup functions, no entrypoint/payload invocation.
Needs immutable externally anchored config and a future verified outer gate.
Never call from a host namespace. No product/native-addon imports.
"""
import os,pathlib,ctypes,errno,stat
WORK_BYTES=1048576
WORK_INODES=64

def mounts():
 rows=[]
 for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines():
  r=line.split();end=r.index('-');rows.append({'id':int(r[0]),'device':r[2],'root':r[3],'target':r[4],'flags':set(r[5].split(',')),'optional':r[6:end],'type':r[end+1]})
 return rows

def check_boundary(anchor):
 assert set(anchor)=={'outerUserNS','outerMountNS','outerDevices','hostUID','hostGID'},'ANCHOR_FIELDS'
 assert type(anchor['hostUID']) is int and anchor['hostUID']>0 and type(anchor['hostGID']) is int and anchor['hostGID']>0,'HOST_IDS'
 assert os.getuid()==os.getgid()==0,'INNER_ROOT'
 for kind,key in [('user','outerUserNS'),('mnt','outerMountNS')]:assert os.readlink('/proc/self/ns/'+kind)!=anchor[key],'HOST_NAMESPACE'
 for kind,host in [('uid',anchor['hostUID']),('gid',anchor['hostGID'])]:assert pathlib.Path('/proc/self/'+kind+'_map').read_text().split()==['0',str(host),'1'],'SINGLE_INNER_MAP'
 assert isinstance(anchor['outerDevices'],list) and anchor['outerDevices'] and all(isinstance(x,str) for x in anchor['outerDevices']),'OUTER_DEVICE_ANCHOR'
 rows=mounts();assert rows and not any(o.startswith(('shared:','master:','propagate_from:')) for r in rows for o in r['optional']),'PROPAGATION_NOT_PRIVATE'
 root=[r for r in rows if r['target']=='/'];assert len(root)==1 and 'ro' in root[0]['flags'],'ROOT_MUST_ALREADY_BE_RO'
 work=[r for r in rows if r['target']=='/work'];assert len(work)==1,'WORK_MOUNT_SINGLE'
 w=work[0];assert w['type']=='tmpfs' and w['root']=='/' and w['device'] not in anchor['outerDevices'],'WORK_NOT_NEW_PRIVATE_TMPFS'
 assert stat.S_ISDIR(os.lstat('/work').st_mode) and not os.path.islink('/work') and not list(pathlib.Path('/work').iterdir()),'WORK_NOT_EMPTY_DIRECTORY'
 # Including /dev/shm, /tmp and proc: no other writable mount is accepted.
 # Minimal witness uses inherited descriptors and does not need writable /dev.
 assert all(r['target']=='/work' or 'ro' in r['flags'] for r in rows),'OTHER_WRITABLE_SURFACE'
 return w['id'],w['device']

def bound_work(anchor):
 identity=check_boundary(anchor);libc=ctypes.CDLL(None,use_errno=True)
 libc.mount.argtypes=[ctypes.c_char_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_ulong,ctypes.c_void_p];libc.mount.restype=ctypes.c_int
 # Fixed exact target/options, no user path/options/string interpolation.
 flags=32|2|4|8 # MS_REMOUNT|MS_NOSUID|MS_NODEV|MS_NOEXEC
 options=b'size=1048576,nr_inodes=64,mode=0700'
 if libc.mount(None,b'/work',None,flags,ctypes.c_char_p(options))!=0:raise OSError(ctypes.get_errno(),'PRIVATE_WORK_REMOUNT_FAILED')
 assert check_boundary(anchor)==identity,'WORK_INSTANCE_CHANGED'
 os.chmod('/work',0o700)
 w=next(r for r in mounts() if r['target']=='/work');assert {'rw','nosuid','nodev','noexec'}<=w['flags'],'WORK_FLAGS'
 v=os.statvfs('/work');assert 0<v.f_blocks*v.f_frsize<=WORK_BYTES and 0<v.f_files<=WORK_INODES,'WORK_CAPS'
 assert stat.S_IMODE(os.stat('/work').st_mode)==0o700,'WORK_MODE'
 return {'workBytes':v.f_blocks*v.f_frsize,'workInodes':v.f_files}

def drop_all():
 libc=ctypes.CDLL(None,use_errno=True)
 # Lock NOROOT + NO_SETUID_FIXUP before losing SETPCAP, preventing exec root
 # from regaining capabilities; lock bits are read back before any payload.
 assert libc.prctl(28,15,0,0,0)==0,'SECUREBITS_SET'
 assert libc.prctl(27,0,0,0,0)==15,'SECUREBITS_READBACK'
 assert libc.prctl(47,4,0,0,0)==0,'AMBIENT_CLEAR'
 for cap in range(64):
  if libc.prctl(24,cap,0,0,0)!=0 and ctypes.get_errno()!=errno.EINVAL:raise OSError('BSET_DROP')
 class Header(ctypes.Structure):_fields_=[('version',ctypes.c_uint32),('pid',ctypes.c_int)]
 class Data(ctypes.Structure):_fields_=[('effective',ctypes.c_uint32),('permitted',ctypes.c_uint32),('inheritable',ctypes.c_uint32)]
 assert libc.capset(ctypes.byref(Header(0x20080522,0)),(Data*2)())==0,'CAPSET_ZERO'
 assert libc.prctl(38,1,0,0,0)==0,'NNP_SET'
 values={k:v.strip() for k,v in (l.split(':',1) for l in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in l)}
 assert all(int(values[k],16)==0 for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']) and values['NoNewPrivs']=='1','DROP_READBACK'
 # A future controller must close every namespace/mount/control/socket FD
 # before exec. This function does not exec or certify FD closure.
 return {'capsZero':True,'noNewPrivs':True,'securebits':15}

if __name__=='__main__':raise SystemExit('INACTIVE_SOURCE_ONLY: mount/drop functions not invoked; no payload entrypoint')
