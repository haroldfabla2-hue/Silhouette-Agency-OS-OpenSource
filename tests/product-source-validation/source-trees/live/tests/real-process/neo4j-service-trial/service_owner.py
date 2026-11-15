"""LOCAL SOURCE ONLY. Exact parent-owned fork handle, no spawn/privilege/mount.
Must be imported by the new private service fixture, never historical checks.
"""
import json,os,pathlib,select,signal,time
class OriginalService:
 def __init__(self):
  self.pid=int(os.environ['ONEBOOT_ORIGINAL_PID']);self.returncode=None
  self.gate=int(os.environ['ONEBOOT_GATE_FD']);self.proof=int(os.environ['ONEBOOT_PROOF_FD'])
  self.stdout=os.fdopen(int(os.environ['ONEBOOT_CONSOLE_FD']),'rb',buffering=0)
  self.sent=False
  until=min(time.monotonic()+2,float(os.environ['ONEBOOT_GATE_DEADLINE']))
  while True:
   fields=(pathlib.Path('/proc')/str(self.pid)/'stat').read_text().rsplit(')',1)[1].split()
   assert int(fields[1])==os.getpid(),'brokerparent'
   if int(fields[2])==self.pid:break
   assert time.monotonic()<until,'brokersetsiddeadline';time.sleep(.005)
 def start_once(self):
  assert not self.sent and time.monotonic()<float(os.environ['ONEBOOT_GATE_DEADLINE']),'servicegateexpired';self.sent=True;os.write(self.gate,b'G');os.close(self.gate)
  assert select.select([self.proof],[],[],min(10,max(0,float(os.environ['NEO4J_BOOT_PHASE_DEADLINE'])-time.monotonic()-15)))[0],'missingservicepreexecproof'
  proof=os.read(self.proof,4097);os.close(self.proof);assert len(proof)<=4096
  value=json.loads(proof);assert value['nofile']==[40000,40000]and value['uid']==1000 and value['caps_zero']is True
  assert value['pid']==self.pid and value['ppid']==os.getpid()and value['pgid']==self.pid
  assert value['netns']==os.readlink('/proc/self/ns/net')and value['cgroup']==pathlib.Path('/proc/self/cgroup').read_text()
  return value
 def poll(self):
  if self.returncode is None:
   found,status=os.waitpid(self.pid,os.WNOHANG)
   if found:self.returncode=os.waitstatus_to_exitcode(status)
  return self.returncode
 def wait(self,timeout):
  deadline=time.monotonic()+timeout
  while self.poll()is None:
   if time.monotonic()>=deadline:raise TimeoutError('originalservicewait')
   time.sleep(.01)
  return self.returncode
 def abort_not_started(self):
  # Closing before G causes broker to exit, not start Neo4j.
  if not self.sent:os.close(self.gate);self.sent=True
