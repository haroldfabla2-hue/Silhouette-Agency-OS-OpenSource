"""SOURCE ONLY, not invoked by any workflow/launcher. No product imports.
Future trusted control must provide a reviewed read-only parent observation
and its own sentinel, after drop. This observes containment, not product behavior.
The future invocation, finite negative harness and aggregate cgroup/tmpfs design
still need separate technical review. This file is not an executable harness.
"""
import os,pathlib,json,socket,errno,resource,stat

def main():
 # Fail before any network/file-write probe unless in the intended PID and
 # namespace boundary. Config must be produced by a future trusted parent,
 # not by the payload or a job that also regenerates its execution anchor.
 assert os.getpid()>1 and os.getuid()==os.getgid()==0,'WITNESS_IDENTITY'
 parent=json.loads(pathlib.Path('/app/containment-parent.json').read_text())
 assert set(parent)=={'namespaces','uidMap','gidMap','workMaxBytes','workMaxInodes'},'WITNESS_CONFIG'
 names=['user','pid','net','mnt','ipc','uts'];assert set(parent['namespaces'])==set(names),'NAMESPACE_CONFIG'
 namespaces={k:os.readlink('/proc/self/ns/'+k) for k in names}
 assert all(namespaces[k]!=parent['namespaces'][k] for k in names),'NAMESPACE_NOT_DISTINCT'
 status={k:v.strip() for k,v in (l.split(':',1) for l in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in l)}
 caps={k:status[k] for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']}
 assert all(int(v,16)==0 for v in caps.values()) and status['NoNewPrivs']=='1','DROP_NOT_OBSERVED'
 uidmap=pathlib.Path('/proc/self/uid_map').read_text().split();gidmap=pathlib.Path('/proc/self/gid_map').read_text().split()
 assert uidmap==parent['uidMap'] and gidmap==parent['gidMap'] and len(uidmap)==len(gidmap)==3,'UID_MAPPING'
 assert uidmap[0]==gidmap[0]=='0' and uidmap[2]==gidmap[2]=='1','UID_MAPPING_NOT_SINGLE'
 assert pathlib.Path('/proc/1/status').exists() and os.getpid() in [int(p.name) for p in pathlib.Path('/proc').iterdir() if p.name.isdigit()],'PRIVATE_PROC'
 interfaces=[l.split(':')[0].strip() for l in pathlib.Path('/proc/net/dev').read_text().splitlines()[2:]]
 assert interfaces==['lo'],'NON_LOOPBACK_INTERFACE'
 rootrow=next(l.split() for l in pathlib.Path('/proc/self/mountinfo').read_text().splitlines() if l.split()[4]=='/')
 assert 'ro' in rootrow[5].split(','),'ROOT_NOT_READ_ONLY'
 workrow=next(l.split() for l in pathlib.Path('/proc/self/mountinfo').read_text().splitlines() if l.split()[4]=='/work')
 assert workrow[workrow.index('-')+1]=='tmpfs','WORK_NOT_TMPFS'
 v=os.statvfs('/work');workbytes=v.f_blocks*v.f_frsize
 assert type(parent['workMaxBytes']) is int and 0<workbytes<=parent['workMaxBytes'],'WORK_AGGREGATE_BYTES_UNBOUNDED'
 assert type(parent['workMaxInodes']) is int and 0<v.f_files<=parent['workMaxInodes'],'WORK_AGGREGATE_INODES_UNBOUNDED'
 sentinel=pathlib.Path('/app/containment-readonly-sentinel')
 assert sentinel.read_bytes()==b'containment witness read-only sentinel\n','SENTINEL_IDENTITY'
 try:
  fd=os.open(sentinel,os.O_WRONLY|os.O_NOFOLLOW)
 except OSError as e:assert e.errno in (errno.EROFS,errno.EACCES,errno.EPERM),'RO_PROBE_OTHER_ERROR'
 else:os.close(fd);raise AssertionError('READ_ONLY_WRITE_ALLOWED')
 assert not pathlib.Path('/containment-not-mounted-sentinel').exists(),'OUTSIDE_ALLOWLIST_VISIBLE'
 probes=[]
 for family,address in [(socket.AF_INET,('192.0.2.1',9)),(socket.AF_INET6,('2001:db8::1',9))]:
  try:s=socket.socket(family,socket.SOCK_STREAM)
  except OSError as e:assert family==socket.AF_INET6 and e.errno==errno.EAFNOSUPPORT;probes.append('IPv6-unavailable');continue
  try:
   s.settimeout(.2)
   try:s.connect(address)
   except OSError as e:assert e.errno==errno.ENETUNREACH,'EGRESS_NOT_PROVEN_UNREACHABLE';probes.append('unreachable')
   else:raise AssertionError('EGRESS_CONNECTED')
  finally:s.close()
 # Private ephemeral file, not an application database or a product fixture.
 p=pathlib.Path('/work/containment-witness-owned-file');fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b'witness-only\n')
 assert p.read_bytes()==b'witness-only\n';p.unlink()
 print('HG_CONTAINMENT_WITNESS '+json.dumps({'scope':'Containment observation only, no product/native addon. Root namespace/proc/RO/drop/network/work observed, NOT full tree quotas or lifecycle negative harness.','namespaces':namespaces,'uidMap':uidmap,'gidMap':gidmap,'caps':caps,'noNewPrivs':1,'network':probes,'workBytes':workbytes,'workInodes':v.f_files,'selfLimits':{n:list(resource.getrlimit(getattr(resource,n))) for n in ['RLIMIT_AS','RLIMIT_CPU','RLIMIT_FSIZE','RLIMIT_NPROC','RLIMIT_NOFILE']},'productStillBlocked':['Aggregate tree CPU/RAM/PID limits not established by this witness.','Lingering descendants/pipes/timeouts and own-PGID cleanup negative harness not run.','Expected inner UID/GID map, private proc exclusion/mount validation and immutable external anchor remain incomplete.']},sort_keys=True),flush=True)
if __name__=='__main__':main()
