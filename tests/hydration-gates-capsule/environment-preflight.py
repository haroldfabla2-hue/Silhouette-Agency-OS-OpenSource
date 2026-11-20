"""Read-only CI host survey. Not a namespace, witness or product launch.
Reports only selected public system metadata, never environment contents,
credentials, home paths, machine IDs, network addresses or unrelated processes.
No cgroup/sysctl writes, userns creation, privilege escalation or network calls.
"""
import pathlib,os,json,resource,shutil,stat,subprocess,hashlib

def read(path,limit=65536):
 p=pathlib.Path(path)
 try:
  with p.open() as f:text=f.read(limit+1)
  assert len(text)<=limit,'PREFLIGHT_READ_LIMIT'
  return text.strip()
 except OSError as e:return {'unavailableErrno':e.errno}
def stats(path):
 p=pathlib.Path(path)
 try:
  s=p.stat();return {'mode':format(stat.S_IMODE(s.st_mode),'o'),'uid':s.st_uid,'gid':s.st_gid,'setuid':bool(s.st_mode&stat.S_ISUID),'regular':stat.S_ISREG(s.st_mode),'readable':os.access(p,os.R_OK),'writable':os.access(p,os.W_OK)}
 except OSError as e:return {'unavailableErrno':e.errno}
def lsm():
 value=read('/proc/self/attr/current')
 return {'profileSha256':hashlib.sha256(value.encode()).hexdigest(),'mode':'enforce' if value.endswith('(enforce)') else 'complain' if value.endswith('(complain)') else 'unconfined' if value=='unconfined' else 'other'} if isinstance(value,str) else value
def main():
 status=read('/proc/self/status');assert isinstance(status,str)
 selected={k:v.strip() for k,v in (l.split(':',1) for l in status.splitlines() if ':' in l) if k in {'Uid','Gid','CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs','Seccomp','Seccomp_filters'}}
 tools={}
 for name in ['bwrap','ip','python3','node']:
  path=shutil.which(name)
  if not path:tools[name]={'available':False};continue
  p=pathlib.Path(path);entry={'available':True,'invocationPathSha256':hashlib.sha256(str(p).encode()).hexdigest(),'resolvedPathSha256':hashlib.sha256(str(p.resolve()).encode()).hexdigest(),**stats(p)}
  if name=='bwrap':
   version=subprocess.run([str(p),'--version'],env={'PATH':'/usr/bin:/bin'},capture_output=True,text=True,timeout=3)
   entry.update({'versionExitCode':version.returncode,'version':version.stdout.strip()[:128]})
  tools[name]=entry
 cgroups=read('/proc/self/cgroup');cg={'membershipAvailable':isinstance(cgroups,str),'scope':'Existing runner cgroup metadata only. No subtree created, moved into or enforcement demonstrated.'}
 if isinstance(cgroups,str):
  v2=[l[3:] for l in cgroups.splitlines() if l.startswith('0::')]
  if len(v2)==1:
   rel=pathlib.PurePosixPath(v2[0]);assert rel.is_absolute() and '..' not in rel.parts,'CGROUP_PATH'
   root=pathlib.Path('/sys/fs/cgroup');start=root/str(rel).lstrip('/')
   # Report effective ancestor ceilings too, not merely unlimited leaf values.
   chain=[]
   for parent in [start,*start.parents]:
    if parent!=root and root not in parent.parents:break
    row={'ancestorIndex':len(chain),'pathSha256':hashlib.sha256(str(parent).encode()).hexdigest(),'directory':stats(parent),'files':{}}
    for key in ['cgroup.controllers','cgroup.subtree_control','cgroup.type','cgroup.procs','memory.max','memory.high','memory.swap.max','pids.max','cpu.max']:
     if key=='cgroup.procs':row['files'][key]={'writable':os.access(parent/key,os.W_OK)};continue
     row['files'][key]={'value':read(parent/key),'writable':os.access(parent/key,os.W_OK)}
    chain.append(row)
    if parent==root:break
   cg['v2Ancestors']=chain
 sysctls={p:read('/proc/sys/'+p) for p in ['kernel/unprivileged_userns_clone','user/max_user_namespaces','kernel/apparmor_restrict_unprivileged_userns','vm/overcommit_memory']}
 disk=os.statvfs('.');memtext=read('/proc/meminfo');mem={k:v.strip() for k,v in (l.split(':',1) for l in memtext.splitlines() if ':' in l) if k in {'MemTotal','MemAvailable','SwapTotal','SwapFree'}} if isinstance(memtext,str) else memtext
 result={'scope':'Read-only host preflight, no witness/namespace/product/native addon. Only bwrap --version is invoked, no Node/Python payload. Environment isolation and aggregate quotas NOT proven.',
  'platform':{'kernelRelease':os.uname().release,'machine':os.uname().machine,'uid':os.getuid(),'gid':os.getgid(),'cpuCount':os.cpu_count(),'affinityCount':len(os.sched_getaffinity(0))},'selfStatus':selected,'uidMap':read('/proc/self/uid_map'),'gidMap':read('/proc/self/gid_map'),'sysctls':sysctls,'lsm':lsm(),'tools':tools,
  'limits':{'argMax':os.sysconf('SC_ARG_MAX'),'pageBytes':os.sysconf('SC_PAGE_SIZE'),'stack':list(resource.getrlimit(resource.RLIMIT_STACK)),'as':list(resource.getrlimit(resource.RLIMIT_AS)),'cpu':list(resource.getrlimit(resource.RLIMIT_CPU)),'nproc':list(resource.getrlimit(resource.RLIMIT_NPROC)),'fsize':list(resource.getrlimit(resource.RLIMIT_FSIZE)),'nofile':list(resource.getrlimit(resource.RLIMIT_NOFILE))},'memory':mem,'workspaceFilesystem':{'availableBytes':disk.f_bavail*disk.f_frsize,'availableInodes':disk.f_favail},'cgroups':cg,
  'blockersBeforeProduct':['Aggregate tree memory/CPU/PID bound not yet demonstrated, existing per-process rlimits do not establish it.','Aggregate writable /work tmpfs bytes/inodes bound not configured or demonstrated; FSIZE is per file.','Root in single UID map may bypass NPROC intent; no effective aggregate PID test yet.','Containment witness has not run; namespace/drop/RO/network/deadline/cleanup remain unobserved.','No seccomp policy exists in current launcher; do not claim otherwise.']}
 print('HG_ENVIRONMENT_PREFLIGHT '+json.dumps(result,sort_keys=True),flush=True)
if __name__=='__main__':main()
