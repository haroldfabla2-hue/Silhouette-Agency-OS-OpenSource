"""INACTIVE online child gate. Two permissions: controlled probe, then npm.
No npm until host verified actual network-counter evidence and kernel admission.
"""
import ctypes,errno,resource,hashlib,http.client,json,os,socket,ssl,time
from pathlib import Path
# Systemd supplies only stdio; close every possible nonstdio descriptor as a
# second boundary before any socket or permission use. Never inspect host/proc.
fdlimit=resource.getrlimit(resource.RLIMIT_NOFILE)[1]
if fdlimit==resource.RLIM_INFINITY:raise RuntimeError('UNBOUNDED_DESCRIPTOR_LIMIT')
os.closerange(3,fdlimit)
WORK=Path('/work');NONCE=os.urandom(32).hex()
def need(x,c):
 if not x:raise RuntimeError(c)
def save(name,value):
 raw=(json.dumps(value)+'\n').encode();tmp=WORK/(name+'.pending');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
 try:need(os.write(fd,raw)==len(raw),'GATE_SHORT_WRITE');os.fsync(fd)
 finally:os.close(fd)
 os.rename(tmp,WORK/name);d=os.open(WORK,os.O_DIRECTORY)
 try:os.fsync(d)
 finally:os.close(d)
def permit(name,seconds):
 until=time.monotonic()+seconds
 while True:
  need(time.monotonic()<until,'GATE_PERMISSION_TIMEOUT')
  try:fd=os.open(WORK/name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
  except FileNotFoundError:time.sleep(.02);continue
  with os.fdopen(fd,'rb') as f:raw=f.read(8193)
  need(time.monotonic()<until and len(raw)<=8192,'GATE_LATE_OR_LARGE_PERMISSION');v=json.loads(raw);need(v.get('nonce')==NONCE and v.get('pid')==os.getpid(),'GATE_PERMISSION_BINDING');return v,until
libc=ctypes.CDLL(None,use_errno=True);need(libc.prctl(39,0,0,0,0)==1,'GATE_NO_NEW_PRIVILEGES')
class Header(ctypes.Structure):_fields_=[('version',ctypes.c_uint32),('pid',ctypes.c_int)]
class Data(ctypes.Structure):_fields_=[('effective',ctypes.c_uint32),('permitted',ctypes.c_uint32),('inheritable',ctypes.c_uint32)]
head=Header(0x20080522,0);caps=(Data*2)();need(libc.capget(ctypes.byref(head),caps)==0,'GATE_CAPGET');need(all(not row.effective and not row.permitted and not row.inheritable for row in caps),'GATE_CAPABILITIES')
need(os.getgroups()==[] and os.getuid()==os.geteuid()==os.getgid()==os.getegid() and os.getuid()>=60000,'GATE_DEDICATED_IDENTITY')
family_denials=[]
for family,kind,protocol in ((socket.AF_UNIX,socket.SOCK_STREAM,0),(socket.AF_INET6,socket.SOCK_STREAM,0),(socket.AF_PACKET,socket.SOCK_DGRAM,socket.htons(3)),(socket.AF_NETLINK,socket.SOCK_RAW,0)):
 try:testsocket=socket.socket(family,kind,protocol)
 except OSError as error:
  need(error.errno==errno.EAFNOSUPPORT,'GATE_EXPECTED_FAMILY_FILTER_ERRNO');family_denials.append({'family':int(family),'socketType':int(kind),'protocol':protocol,'errno':error.errno})
 else:testsocket.close();raise RuntimeError('GATE_FORBIDDEN_SOCKET_FAMILY')
with socket.socket(socket.AF_INET,socket.SOCK_STREAM,0):pass
for cap in range(41):need(libc.prctl(23,cap,0,0,0)==0,'GATE_BOUNDING_CAPABILITY')
save('ready.json',{'kind':'ONLINE_BEFORE_NPM_AND_PROBE','pid':os.getpid(),'nonce':NONCE,'uid':os.getuid(),'gid':os.getgid(),'supplementaryGroups':os.getgroups(),'noNewPrivileges':True,'allCapabilitiesZero':True,'familyDenials':family_denials,'nonStdioDescriptorsClosedBeforeGate':True})
v,_=permit('probe-permit.json',10);deadline=time.monotonic()+8;peer=v['peerHostIP'];port=v['peerHostPort'];need(peer=='10.203.173.1' and type(port) is int and 1024<=port<=65535,'PROBE_FIXED_PEER')
connected=False
try:
 with socket.create_connection((peer,port),timeout=.7):connected=True
except OSError:pass
need(not connected,'HOST_ENDPOINT_REACHABLE')
def remaining():
 value=deadline-time.monotonic();need(value>0,'GATE_PROBE_DEADLINE');return value
conn=http.client.HTTPSConnection('registry.npmjs.org',443,timeout=remaining(),context=ssl.create_default_context());conn.connect();need(conn.sock is not None,'PROBE_TLS_SOCKET');conn.sock.settimeout(remaining());conn.request('GET','/');conn.sock.settimeout(remaining());response=conn.getresponse();status=response.status
# Status+verifiedTLS is enough, do not wait for an unbounded response body.
remaining();response.close();conn.close();need(time.monotonic()<deadline and status==200,'PUBLIC_TLS_PROBE_FAILED')
save('network-probe.json',{'nonce':NONCE,'pid':os.getpid(),'hostConnectSucceeded':connected,'httpsStatus':status,'httpsHost':'registry.npmjs.org','tlsVerified':True})
v,until=permit('npm-permit.json',10);need(v.get('networkProofSha256') and len(v['networkProofSha256'])==64,'NETWORK_PROOF_BINDING');need(time.monotonic()<until,'LATE_NPM_PERMIT')
save('npm-attempted.json',{'npmExecAttempted':True,'productExecuted':False,'networkProofSha256':v['networkProofSha256']})
need(time.monotonic()<until,'LATE_NPM_EXEC');os.execve('/usr/bin/python3',['/usr/bin/python3','-I','-B','-S','/validation/fulltypes.INACTIVE.py'],{'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/work/home','LC_ALL':'C'})
