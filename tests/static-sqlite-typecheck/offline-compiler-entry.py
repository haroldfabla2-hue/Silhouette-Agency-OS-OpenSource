"""Reviewed post-setpriv entry. Never intended to run as root. Source only."""
from pathlib import Path
import os,sys,json,re,resource,hashlib,stat,socket,fcntl,struct

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def emit(path,value):
 raw=(json.dumps(value,indent=2)+'\n').encode();assert len(raw)<65536
 pending=path+'.pending';fd=os.open(pending,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:assert os.write(fd,raw)==len(raw)
 finally:os.close(fd)
 os.link(pending,path);os.unlink(pending) # atomic complete receipt, no overwrite
def main():
 # Fixed positional parameters from reviewed controller, not request values.
 assert len(sys.argv)==9
 _,phase,uid,gid,parent_net,root_dir,node_path,compiler_path,output=sys.argv
 uid=int(uid);gid=int(gid)
 progress={'phase':phase,'pid':os.getpid(),'stages':[],'isolationValidated':False}
 def stage(name,observed):
  progress['stages'].append({'stage':name,'observed':observed})
  emit(output+'.guard-'+str(len(progress['stages'])).zfill(2)+'.json',progress)
 stage('requested-identity',{'requestedUid':uid,'requestedGid':gid,'actualUid':list(os.getresuid()),'actualGid':list(os.getresgid()),'groups':os.getgroups(),'pgid':os.getpgrp(),'sid':os.getsid(0)})
 assert uid>0
 assert phase in ['probe','baseline','candidate']
 assert os.environ['PATH']=='/usr/bin:/bin'
 assert os.getresuid()==(uid,uid,uid)and os.getresgid()==(gid,gid,gid)and not os.getgroups()
 status=dict(line.split(':',1)for line in Path('/proc/self/status').read_text().splitlines()if ':'in line)
 stage('capabilities',{key:status[key].strip()for key in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs']})
 for key in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']:assert int(status[key].strip(),16)==0,key
 assert status['NoNewPrivs'].strip()=='1'
 net=os.readlink('/proc/self/ns/net')
 stage('network-namespace',{'parent':parent_net,'actual':net})
 assert net!=parent_net
 # Query CURRENT namespace via if_nameindex and /proc/self/net, not an
 # inherited sysfs mount tagged with its mounter's namespace. No remount.
 interfaces=socket.if_nameindex()
 dev_text=Path('/proc/self/net/dev').read_text()
 proc_interfaces=sorted(line.split(':',1)[0].strip()for line in dev_text.splitlines()[2:]if ':'in line)
 sysfs_observed=sorted(path.name for path in Path('/sys/class/net').iterdir())
 stage('current-interfaces',{'ifNameIndex':interfaces,'procSelfNetDev':dev_text,'procInterfaceNames':proc_interfaces,'sysfsInheritedMountNamesDiagnosticOnly':sysfs_observed})
 assert sorted(name for _,name in interfaces)==['lo']and proc_interfaces==['lo']
 # ioctl(SIOCGIFFLAGS) through a short-lived unprivileged socket refers to
 # THIS network namespace. Socket closes BEFORE inherited-FD guard and exec.
 with socket.socket(socket.AF_INET,socket.SOCK_DGRAM)as control:
  response=fcntl.ioctl(control.fileno(),0x8913,struct.pack('256s',b'lo'))
  lo_flags=struct.unpack_from('H',response,16)[0]
 stage('loopback-flags',{'flags':lo_flags,'IFF_UP':bool(lo_flags&1),'source':'current-netns SIOCGIFFLAGS ioctl'})
 assert lo_flags&1==0
 ipv4=Path('/proc/self/net/route').read_text().splitlines()
 ipv6=Path('/proc/self/net/ipv6_route').read_text().splitlines()
 stage('routes',{'ipv4':ipv4,'ipv6':ipv6})
 assert len(ipv4)==1
 for line in ipv6:
  fields=line.split();assert fields[-1]=='lo'and int(fields[7],16)&1==0,'active IPv6 route'
 # /proc enumeration may expose its temporary directory FD as a broken link.
 # No surviving extra FD, host socket, netns FD or inherited file is accepted.
 inherited=[]
 for name in os.listdir('/proc/self/fd'):
  if int(name)>2:
   try:target=os.readlink('/proc/self/fd/'+name)
   except FileNotFoundError:continue
   inherited.append({'fd':name,'target':target})
 stage('inherited-descriptors',inherited)
 assert not inherited
 caps=[('cpu',resource.RLIMIT_CPU,240),('as',resource.RLIMIT_AS,24*1024**3),('nofile',resource.RLIMIT_NOFILE,256),('nproc',resource.RLIMIT_NPROC,96),('fsize',resource.RLIMIT_FSIZE,1024**3),('core',resource.RLIMIT_CORE,0)]
 for _,key,value in caps:resource.setrlimit(key,(value,value))
 actual={name:list(resource.getrlimit(key))for name,key,_ in caps}
 stage('kernel-limits',actual)
 assert all(actual[name]==[value,value]for name,_,value in caps)
 node=Path(node_path);compiler=Path(compiler_path);root=Path(root_dir)
 assert node.is_file()and not node.is_symlink()and compiler.is_file()and not compiler.is_symlink()
 # Controller source verifies these exact bytes immediately before sudo.
 expected_node=os.environ['STATIC_EXPECTED_NODE_SHA256'];expected_compiler=os.environ['STATIC_EXPECTED_COMPILER_SHA256']
 assert re.fullmatch('[0-9a-f]{64}',expected_node)and re.fullmatch('[0-9a-f]{64}',expected_compiler)
 stage('compiler-provenance',{'nodeActual':digest(node),'nodeExpected':expected_node,'compilerActual':digest(compiler),'compilerExpected':expected_compiler})
 assert digest(node)==expected_node and digest(compiler)==expected_compiler
 assert root.is_dir()and not root.is_symlink()
 ancestors=[];pid=os.getpid()
 for _ in range(32):
  proc=Path('/proc')/str(pid);fields=(proc/'stat').read_text().rsplit(')',1)[1].split()
  uid_line=next(line for line in(proc/'status').read_text().splitlines()if line.startswith('Uid:'))
  row={'pid':pid,'ppid':int(fields[1]),'pgid':int(fields[2]),'sid':int(fields[3]),'startTicks':int(fields[19]),'uid':[int(v)for v in uid_line.split()[1:]],'comm':(proc/'comm').read_text().strip()}
  ancestors.append(row);pid=row['ppid']
  if pid<=1:break
 timeout_ancestors=[row for row in ancestors[1:]if row['comm']=='timeout'and row['uid']==[0,0,0,0]]
 stage('ancestor-identities',{'ancestors':ancestors,'rootTimeoutCandidates':timeout_ancestors,'supervisorNamespaceParentExpected':parent_net})
 assert len(timeout_ancestors)==1,'root system watchdog ancestor unavailable'
 assert timeout_ancestors[0]['pgid']==os.getpgrp(),'namespace entry escaped root watchdog group'
 proof={'phase':phase,'pid':os.getpid(),'ppid':os.getppid(),'pgid':os.getpgrp(),'sid':os.getsid(0),'uid':list(os.getresuid()),'gid':list(os.getresgid()),'groups':os.getgroups(),'caps':{key:status[key].strip()for key in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs']},'parentNetNamespace':parent_net,'netNamespace':net,'interfaces':interfaces,'loopbackFlags':lo_flags,'loDown':True,'ipv4Routes':ipv4,'ipv6Routes':ipv6,'extraInheritedDescriptors':inherited,'kernelLimits':actual,'nodeSha256':digest(node),'compilerSha256':digest(compiler),'cwd':str(root),'phaseReceiptNotCompilerCompletion':True,'ancestorIdentities':ancestors,'rootTimeoutAncestor':timeout_ancestors[0],'rootTimeoutGroupMatchesEntry':True}
 proof['isolationValidated']=True
 stage('validated-before-exec',{'isolationValidated':True,'cwd':str(root)})
 emit(output,proof)
 if phase=='probe':return
 os.chdir(root)
 argv=[str(node),'--max-old-space-size=4096',str(compiler),'--project','tsconfig.json','--noEmit','--skipLibCheck','--incremental','false','--pretty','false']
 # Exec same PID and namespace, not a child outside the verified boundary.
 os.execve(str(node),argv,dict(os.environ))
if __name__=='__main__':main()
