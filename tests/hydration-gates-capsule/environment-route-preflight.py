"""Finite read-only complement. No unit/scope creation or namespace payload.
Only known bwrap profile files, runtime socket metadata, and selected systemd
properties are inspected. Files on disk do not prove loaded policy or admission.
"""
import os,pathlib,json,hashlib,shutil,subprocess,stat,re

def digest(value):return hashlib.sha256(value.encode()).hexdigest()
def inspect(path):
 try:
  s=path.stat();return {'present':True,'uid':s.st_uid,'mode':format(stat.S_IMODE(s.st_mode),'o'),'socket':stat.S_ISSOCK(s.st_mode),'readable':os.access(path,os.R_OK)}
 except OSError as e:return {'present':False,'unavailableErrno':e.errno}
def read(path):
 try:
  with path.open() as f:s=f.read(65537)
  return {'tooLarge':True} if len(s)>65536 else s
 except OSError as e:return {'unavailableErrno':e.errno}
def command(exe,args,env):
 try:
  p=subprocess.run([exe,*args],env=env,capture_output=True,text=True,timeout=3)
  # Never echo stderr, addresses, paths, or arbitrary property text into CI.
  return {'exitCode':p.returncode,'stdout':p.stdout[:65536],'stderrPresent':bool(p.stderr),'outputTruncated':len(p.stdout)>65536}
 except subprocess.TimeoutExpired:return {'timeout':True}
 except OSError as e:return {'unavailableErrno':e.errno}
def properties(exe,args,keys,env):
 raw=command(exe,[*args,'--no-pager','--no-ask-password','--all','--property='+','.join(keys)],env)
 text=raw.pop('stdout','');out={}
 for line in text.splitlines():
  if '=' not in line:continue
  k,v=line.split('=',1)
  if k not in keys:continue
  if k=='ControlGroup':
   out[k]={'nonempty':bool(v),'sha256':digest(v)}
   if v.startswith('/') and '..' not in pathlib.PurePosixPath(v).parts:
    root=pathlib.Path('/sys/fs/cgroup')/v.lstrip('/')
    out['assignedCgroup']={'metadata':inspect(root),'files':{}}
    for name in ['cgroup.controllers','cgroup.subtree_control','memory.max','memory.swap.max','pids.max','cpu.max']:
     value=read(root/name)
     valid=isinstance(value,str) and bool(re.fullmatch(r'[a-z0-9 ._-]*',value.strip()))
     out['assignedCgroup']['files'][name]={'value':value.strip() if valid else value if isinstance(value,dict) else {'unexpectedValueSha256':digest(value)},'writable':os.access(root/name,os.W_OK)}
  elif re.fullmatch(r'[A-Za-z0-9 ._@/-]*',v) and len(v)<256:
   # Remaining explicit keys are enums, controller names, numeric limits or version.
   out[k]=v
  else:out[k]={'unexpectedValueSha256':digest(v)}
 return {**raw,'selectedProperties':out}
def main():
 uid=os.getuid();runtime=pathlib.Path('/run/user')/str(uid)
 profile=[]
 for path in [pathlib.Path('/etc/apparmor.d')/n for n in ['bwrap','usr.bin.bwrap','usr.bin.bubblewrap']]:
  data=read(path);row={'knownProfileName':path.name,'metadata':inspect(path)}
  if isinstance(data,str):
   # Lexical hints only, not a policy parser, include expansion, or loaded status.
   visible='\n'.join(l.split('#',1)[0] for l in data.splitlines())
   row.update({'fileSha256':digest(data),'bytes':len(data.encode()),'lexicalUsernsRule':bool(re.search(r'\buserns\s*,',visible)),'lexicalUnconfinedFlag':bool(re.search(r'flags\s*=\s*\([^)]*\bunconfined\b',visible)),'lexicalBwrapAttachment':bool(re.search(r'/(?:usr/)?bin/bwrap\b',visible))})
  else:row['read']=data
  profile.append(row)
 env={'PATH':'/usr/bin:/bin','LC_ALL':'C','SYSTEMD_COLORS':'0','SYSTEMD_PAGER':'cat','SYSTEMD_PAGERSECURE':'1'}
 exe=shutil.which('systemctl');systemd={'available':bool(exe)}
 private=inspect(runtime/'systemd/private');bus=inspect(runtime/'bus')
 if exe:
  version=command(exe,['--version'],env);text=version.pop('stdout','');first=text.splitlines()[0] if text else ''
  version['version']=first if re.fullmatch(r'systemd [0-9]+(?: \([A-Za-z0-9 .~+_:()-]+\))?',first) else {'sha256':digest(first)}
  systemd['version']=version
  common=['LoadState','ActiveState','SubState','ControlGroup','Delegate','DelegateControllers','MemoryMax','MemorySwapMax','TasksMax','CPUQuotaPerSecUSec','CPUAccounting','MemoryAccounting','TasksAccounting']
  systemd['systemUserUnit']=properties(exe,['--system','show',f'user@{uid}.service'],common,env)
  # No session-bus discovery or activation: skip unless the already-existing
  # systemd private socket is present. Use only the known runtime path.
  if private.get('socket') and private.get('uid')==uid:
   userenv={**env,'XDG_RUNTIME_DIR':str(runtime),'DBUS_SESSION_BUS_ADDRESS':'unix:path='+str(runtime/'systemd/private')}
   systemd['userManager']=properties(exe,['--user','show'],['Version','ControlGroup','DefaultControllers','DefaultMemoryAccounting','DefaultTasksAccounting','DefaultCPUAccounting'],userenv)
  else:systemd['userManager']={'skipped':'No already-existing owned systemd private socket; no activation attempted.'}
 result={'scope':'Selected read-only route metadata only; no manager start, unit/scope creation, policy change, namespace/witness/product or effective quota claim.','runtime':{'pathSha256':digest(str(runtime)),'directory':inspect(runtime),'privateSocket':private,'sessionBusSocket':bus},'knownBwrapProfiles':profile,'systemd':systemd,'decisionRule':'No demonstrable existing user-manager/controller route means stop this runner route for product; do not install profiles, disable AppArmor, use privileged scope or increase host permissions. Even a candidate route needs later reviewed design plus effective bounds and containment validation before product.','notProven':['On-disk AppArmor hints are not loaded profile status or bwrap admission.','Requested systemd properties and read/access are not effective dedicated tree resource limits.','The source-only witness remains incomplete and uninvoked.']}
 print('HG_ENVIRONMENT_ROUTE_PREFLIGHT '+json.dumps(result,sort_keys=True),flush=True)
if __name__=='__main__':main()
