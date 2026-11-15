"""LOCAL SOURCE ONLY, NO OPERATIONAL WORKFLOW. Dedicated nonroot prefork gate.
Requires existing private namespace/cgroup. Never imports/execs package as root.
No hardlimit raise: refuses inherited hard<40000, then lowers at role boundary.
"""
import hashlib,json,os,pathlib,resource,select,signal,stat,time
H=pathlib.Path('/tmp/harness');A=pathlib.Path('/tmp/work/node_modules/.silhouette-native-neo4j/neo4j-community-5.26.32');R=pathlib.Path('/tmp/neo4j-runtime');LIMITS=pathlib.Path('/tmp/limits')
def digest(p):
 with p.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def unprivileged():
 assert os.getuid()==os.geteuid()==1000 and os.getgid()==os.getegid()==1000
 text=pathlib.Path('/proc/self/status').read_text()
 for field in ['CapEff:','CapPrm:','CapAmb:']:assert int(next(line.split()[1]for line in text.splitlines()if line.startswith(field)),16)==0
 return True
def main():
 unprivileged()
 for name,value in [('memory.max',str(8*1024**3)),('memory.swap.max','0'),('pids.max','256'),('cpu.max','200000 100000')]:assert(LIMITS/name).read_text().strip()==value
 assert resource.getrlimit(resource.RLIMIT_FSIZE)==(64*1024**2,64*1024**2)
 # Fixed source values are not execution approval. Parent accepted finite
 # VM risk proportionality, not a perfect aggregate FD quota.
 policy=json.loads((H/'service-policy.json').read_text())
 assert policy['status']=='FIXED_LOCAL_SOURCE_SERVICE_ROLE_POLICY_NO_EXECUTION_AUTHORITY'
 assert policy['service_nofile']==40000 and policy['client_nofile']==256
 # Read-only host-global capacity gate. Handles != slots; this conservative
 # reserve is headroom evidence only, not a kernel-enforced pertest handlequota.
 def kernel_number(name):
  with(pathlib.Path('/proc/sys/fs')/name).open('rb')as stream:b=stream.read(257)
  assert len(b)<=256;return [int(x)for x in b.split()]
 file_max=kernel_number('file-max');nr_open=kernel_number('nr_open');file_nr=kernel_number('file-nr')
 assert len(file_max)==len(nr_open)==1 and len(file_nr)==3,'NOT_STARTED_KERNEL_FS_PARSE'
 assert file_nr[0]>=file_nr[1]>=0 and file_max[0]==file_nr[2]and nr_open[0]>=40000,'NOT_STARTED_KERNEL_FS_LIMIT'
 free=file_max[0]-(file_nr[0]-file_nr[1]);assert free>=10305536,'NOT_STARTED_GLOBAL_HANDLE_HEADROOM'
 kernel_memory=(LIMITS/'memory.stat').read_text();km=dict(line.split()for line in kernel_memory.splitlines());assert {'kernel','slab','sock'}<=set(km),'NOT_STARTED_KERNEL_MEMORY_COUNTERS_UNVERIFIED'
 soft,hard=resource.getrlimit(resource.RLIMIT_NOFILE);assert hard==resource.RLIM_INFINITY or hard>=40000,'NOT_STARTED_HOST_INHERITED_HARD_TOO_SMALL'
 resource.setrlimit(resource.RLIMIT_NOFILE,(40000,40000));assert resource.getrlimit(resource.RLIMIT_NOFILE)==(40000,40000)
 # Both roles inherit one shared memory/cpu/pids/scratch boundary, not8GiB each.
 gate_r,gate_w=os.pipe();out_r,out_w=os.pipe();proof_r,proof_w=os.pipe()
 gate_deadline=time.monotonic()+30
 child=os.fork()
 if child==0:
  try:
   os.close(gate_w);os.close(out_r);os.close(proof_r);os.setsid()
   os.dup2(out_w,1);os.dup2(out_w,2);os.close(out_w)
   assert select.select([gate_r],[],[],max(0,gate_deadline-time.monotonic()))[0],'servicegate30s';command=os.read(gate_r,2);os.close(gate_r);assert command==b'G','servicegateaborted'
   unprivileged();assert resource.getrlimit(resource.RLIMIT_NOFILE)==(40000,40000)
   # Fixed allowlist data only, no caller-chosen argv or executable.
   inputs=json.loads((H/'neo4j-admission-inputs.json').read_text());jdk=pathlib.Path(inputs['jdk']['home'])
   for name,h in inputs['jdk']['files'].items():assert digest(jdk/name)==h
   for source,target in [('neo4j-boot.conf','neo4j.conf'),('neo4j-boot-logs.xml','server-logs.xml'),('neo4j-boot-user-logs.xml','user-logs.xml')]:assert digest(H/source)==digest(R/'conf'/target)
   assert os.statvfs(A).f_flag&os.ST_RDONLY and os.statvfs(jdk).f_flag&os.ST_RDONLY
   proof={'pid':os.getpid(),'ppid':os.getppid(),'pgid':os.getpgrp(),'nofile':list(resource.getrlimit(resource.RLIMIT_NOFILE)),'uid':os.getuid(),'caps_zero':True,'cgroup':pathlib.Path('/proc/self/cgroup').read_text(),'netns':os.readlink('/proc/self/ns/net'),'global_fs_readonly':{'file_max':file_max[0],'nr_open':nr_open[0],'file_nr':file_nr,'free_handles_observed':free,'required_headroom':10305536},'inherited_hard_before_lower':hard,'kernel_release':os.uname().release,'memory_stat_fields_present':sorted({'kernel','slab','sock'}&set(km)),'memory_accounting_scope':'SIGNIFICANT_KERNEL_MEMORY_NOT_COMPLETE_HOST_FD_QUOTA','gate_seconds_remaining_at_go':gate_deadline-time.monotonic()}
   os.write(proof_w,json.dumps(proof,separators=(',',':')).encode());os.close(proof_w)
   null=os.open('/dev/null',os.O_RDONLY);os.dup2(null,0);os.close(null);os.chdir(R)
   env={'PATH':'/usr/bin:/bin','JAVA_HOME':str(jdk),'JAVACMD':str(jdk/'bin/java'),'NEO4J_HOME':str(A),'NEO4J_CONF':str(R/'conf'),'HOME':str(R/'home'),'TMPDIR':str(R/'java-tmp'),'LANG':'C.UTF-8','NEO4J_CONFIG_FILE_CHARSET':'utf8'}
   os.execve(str(A/'bin/neo4j'),[str(A/'bin/neo4j'),'console'],env)
  except BaseException:
   # stdout/stderr retained by original parent; never retry/another launcher.
   import traceback;traceback.print_exc();os._exit(1)
 os.close(gate_r);os.close(out_w);os.close(proof_w)
 try:
  resource.setrlimit(resource.RLIMIT_NOFILE,(256,256));assert resource.getrlimit(resource.RLIMIT_NOFILE)==(256,256);unprivileged()
  for fd in [gate_w,out_r,proof_r]:os.set_inheritable(fd,True)
  env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','NEO4J_BOOT_PHASE_DEADLINE':os.environ['NEO4J_BOOT_PHASE_DEADLINE'],'ONEBOOT_ORIGINAL_PID':str(child),'ONEBOOT_GATE_FD':str(gate_w),'ONEBOOT_CONSOLE_FD':str(out_r),'ONEBOOT_PROOF_FD':str(proof_r),'ONEBOOT_GATE_DEADLINE':str(gate_deadline)}
  # Exact source adapter still requires review; no argv supplied by service.
  os.execve('/usr/bin/python3',['/usr/bin/python3','/tmp/harness/neo4j-service-real.py'],env)
 finally:
  # Only reached if exec fails. Gate EOF prevents boot; reap original broker.
  os.close(gate_w)
  deadline=time.monotonic()+2
  while time.monotonic()<deadline:
   found,_=os.waitpid(child,os.WNOHANG)
   if found:break
   time.sleep(.01)
  else:os.kill(child,signal.SIGKILL);os.waitpid(child,0)

try:main()
except BaseException as error:
 # Existing output path, no extra writer count. Never overwrites a richer fixture summary.
 import traceback
 summary={'schema':'NEO4J_BOOT_EMERGENCY_V1','status':'NOT_STARTED','original_failure':{'stage':'PREFLIGHT','error_type':type(error).__name__,'error_sha256':hashlib.sha256(str(error).encode()).hexdigest()},'last_stage':'PREFLIGHT','envelope_state':'NOT_WRITTEN','raw_complete':False,'cleanup':{'leader_rc':None,'signal_count':0,'eof':False,'group_empty':False,'ports_closed':False,'remaining_identity_count':None,'errors':[]},'runtime_evidence_incomplete':True}
 text=json.dumps(summary,separators=(',',':'));assert len(text.encode())<=4096
 try:
  target=pathlib.Path('/tmp/evidence/neo4j-boot-emergency.json')
  if not target.exists():target.write_text(text+'\n')
 except Exception:print('NEO4J_BOOT_EMERGENCY:'+text,flush=True)
 traceback.print_exc();raise SystemExit(1)
