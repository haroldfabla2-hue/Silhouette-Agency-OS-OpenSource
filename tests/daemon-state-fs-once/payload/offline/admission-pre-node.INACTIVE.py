"""INACTIVE child admission. Deadline rechecked after reads and before exec.
READY and attempted receipts use fsync+atomic rename, not visible partial JSON.
"""
import os,json,time,secrets
from pathlib import Path
work=Path('/work');nonce=secrets.token_hex(32)
def save(name,value):
 p=work/name;pending=work/(name+'.pending');raw=(json.dumps(value)+'\n').encode();fd=os.open(pending,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
 try:
  if os.write(fd,raw)!=len(raw):raise RuntimeError('ADMISSION_SHORT_WRITE')
  os.fsync(fd)
 finally:os.close(fd)
 os.rename(pending,p);d=os.open(work,os.O_DIRECTORY)
 try:os.fsync(d)
 finally:os.close(d)
def before_deadline():
 if time.monotonic()>=until:raise RuntimeError('ADMISSION_DEADLINE_NO_NODE')
until=time.monotonic()+10
save('ready.json',{'stage':'BEFORE_NODE','pid':os.getpid(),'nonce':nonce})
while True:
 before_deadline()
 try:fd=os.open(work/'permit.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 except FileNotFoundError:
  before_deadline();time.sleep(.02);continue
 with os.fdopen(fd,'rb') as stream:raw=stream.read(1025)
 before_deadline()
 if len(raw)>1024:raise RuntimeError('PERMIT_OVERSIZE')
 value=json.loads(raw)
 if value!={'pid':os.getpid(),'nonce':nonce}:raise RuntimeError('INVALID_HOST_PERMIT')
 break
before_deadline();save('attempted.json',{'nodeExecAttempted':True,'productExecuted':'UNVERIFIED_UNTIL_TEST_EVIDENCE'})
os.chdir('/source');before_deadline()
os.execve('/usr/bin/node',['/usr/bin/node','--max-old-space-size=192','--require','/runtime-marker.cjs','--test','--test-reporter=tap','--test-concurrency=1','--test-timeout=30000','tests/daemon-state-writer/contracts.node.cjs'],{'PATH':'/usr/bin','LC_ALL':'C','HOME':'/work','TMPDIR':'/tmp'})
