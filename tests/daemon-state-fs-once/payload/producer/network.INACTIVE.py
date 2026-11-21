"""INACTIVE standard netns/veth/nft lifecycle for finite public preparation.
No effects on import. No proxy, Docker or packet-filter code in Python.
"""
import hashlib,ipaddress,json,os,re,secrets,socket,stat,subprocess,time
from pathlib import Path
JSON_READ_OPERATIONS=frozenset(('CLEANUP_LINKS', 'CLEANUP_NAMESPACE_TABLES', 'CLEANUP_NFT_TABLES', 'CLEANUP_OWNED_NFT', 'CLEANUP_VERIFY_LINKS', 'CLEANUP_VERIFY_TABLES', 'OWNERSHIP_HOST_LINKS', 'OWNERSHIP_PEER_LINKS', 'OWNERSHIP_TABLE', 'PREFLIGHT_LINKS', 'PREFLIGHT_NAMESPACES', 'PREFLIGHT_NFT_TABLES', 'SETUP_CREATED_LINK_ID', 'SETUP_FINAL_LINK_ID', 'SETUP_HOST_ADDRESSES', 'SETUP_ROUTE_TABLES', 'SNAPSHOT_HOST_LINK', 'SNAPSHOT_HOST_NFT', 'SNAPSHOT_HOST_ROUTES', 'SNAPSHOT_NAMESPACE_NFT', 'SNAPSHOT_NAMESPACE_ROUTES', 'SNAPSHOT_PEER_LINK'))
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}
def need(x,c):
 if not x:raise RuntimeError(c)
def command(*args,timeout=5,input=None,deadline=None):
 if deadline is not None:
  timeout=min(timeout,deadline-time.monotonic());need(timeout>0,'NET_DEADLINE')
 p=subprocess.run(args,input=input,env=ENV,stdin=subprocess.DEVNULL if input is None else None,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 need(len(p.stdout)<=262144 and len(p.stderr)<=65536,'NET_REPLY_BOUND');need(p.returncode==0,'NET_COMMAND_FAILED')
 if deadline is not None:need(time.monotonic()<deadline,'NET_DEADLINE')
 return p.stdout.decode()
def public_ip(value,host_addresses):
 address=ipaddress.ip_address(value);special=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.88.99.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4','168.63.129.16/32'];need(address.version==4 and not any(address in ipaddress.ip_network(n) for n in special),'NET_SPECIAL_OR_PLATFORM_IP');need(address.version==4 and address.is_global and not address.is_multicast and not address.is_reserved,'NET_NONPUBLIC_IP');need(value not in host_addresses,'NET_HOST_IP_FORBIDDEN');return str(address)
def discover(hostnames):
 need(set(hostnames)=={'registry.npmjs.org','github.com','codeload.github.com','objects.githubusercontent.com','release-assets.githubusercontent.com'},'NET_HOSTNAME_SET')
 interfaces=json.loads(command('/usr/sbin/ip','-j','address','show'));host={a['local'] for item in interfaces for a in item.get('addr_info',[])};endpoints={}
 for name in sorted(hostnames):
  answers=sorted({row[4][0] for row in socket.getaddrinfo(name,443,family=socket.AF_INET,type=socket.SOCK_STREAM)});need(1<=len(answers)<=16,'NET_DNS_RESULT_BOUND');endpoints[name]=[public_ip(a,host) for a in answers]
 need(sum(map(len,endpoints.values()))<=48,'NET_FINITE_IP_BOUND');return {'endpoints':endpoints,'hostAddresses':sorted(host),'discoveredAtMonotonicNs':time.monotonic_ns(),'addressFamilies':['AF_INET'],'transportPorts':[443],'runtimeDNS':False}
class OwnedNetwork:
 def __init__(self,policy,ledger_path):
  self.policy=policy;self.tag=secrets.token_hex(4);self.namespace='dfsp'+self.tag;self.hostif='dfh'+self.tag;self.peerif='dfp'+self.tag;self.table='dfsp_'+self.tag;self.hostip='10.203.173.1';self.peerip='10.203.173.2';self.prefix='10.203.173.0/30';self.created=False;self.hosttable=False;self.forwardBefore=None;self.listener=None;self.probePort=None;self.ledger_path=Path(ledger_path);self.ledger={'schemaVersion':1,'tag':self.tag,'policy':policy,'namespace':self.namespace,'hostInterface':self.hostif,'peerInterface':self.peerif,'hostTable':self.table,'mutations':[],'preflightAbsent':False,'identities':{},'cleanupState':'NOT_STARTED'};self.persist()
 @classmethod
 def recover(cls,ledger_path):
  path=Path(ledger_path);st=path.lstat();need(st.st_uid==0 and st.st_nlink==1 and not st.st_mode&0o077 and not path.is_symlink() and st.st_size<=262144,'NET_RECOVERY_LEDGER_CUSTODY');value=json.loads(path.read_text());tag=value.get('tag');need(re.fullmatch('[a-f0-9]{8}',tag or ''),'NET_RECOVERY_TAG')
  need(value.get('namespace')=='dfsp'+tag and value.get('hostInterface')=='dfh'+tag and value.get('peerInterface')=='dfp'+tag and value.get('hostTable')=='dfsp_'+tag,'NET_RECOVERY_IDENTIFIERS')
  obj=cls.__new__(cls);obj.policy=value['policy'];obj.tag=tag;obj.namespace=value['namespace'];obj.hostif=value['hostInterface'];obj.peerif=value['peerInterface'];obj.table=value['hostTable'];obj.hostip='10.203.173.1';obj.peerip='10.203.173.2';obj.prefix='10.203.173.0/30';obj.listener=None;obj.probePort=None;obj.created=False;obj.hosttable=False;obj.ledger_path=path;obj.ledger=value
  pending=path.with_suffix('.pending')
  if pending.exists():
   ps=pending.lstat();need(ps.st_uid==0 and not ps.st_mode&0o077 and ps.st_nlink==1 and not pending.is_symlink(),'NET_INTERRUPTED_PENDING_CUSTODY');saved=path.with_name(path.name+'.interrupted-'+secrets.token_hex(4));os.rename(pending,saved);obj.ledger['interruptedPendingEvidence']=str(saved)
  return obj
 def persist(self):
  raw=(json.dumps(self.ledger,sort_keys=True,indent=2)+'\n').encode();tmp=self.ledger_path.with_suffix('.pending');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  try:need(os.write(fd,raw)==len(raw),'NET_LEDGER_SHORT');os.fsync(fd)
  finally:os.close(fd)
  os.replace(tmp,self.ledger_path);d=os.open(self.ledger_path.parent,os.O_DIRECTORY)
  try:os.fsync(d)
  finally:os.close(d)
 def mutate(self,*args,input=None,resource=None):
  entry={'argv':list(args),'inputSha256':hashlib.sha256(input).hexdigest() if input else None,'state':'ATTEMPTED_RESULT_UNKNOWN'};self.ledger['mutations'].append(entry)
  if resource is not None:
   ownership=self.ledger.setdefault('creation',{});need(resource not in ownership,'NET_CREATION_ALREADY_ATTEMPTED');ownership[resource]={'attempted':True,'acknowledged':False,'mutationIndex':len(self.ledger['mutations'])-1}
  self.persist()
  try:
   value=command(*args,input=input);entry['state']='COMMAND_ACKNOWLEDGED'
   if resource is not None:self.ledger['creation'][resource]['acknowledged']=True
   self.persist();return value
  except BaseException:
   self.persist();raise
 def read_json(self,operation,*args,**kwargs):
  # Diagnostic only. Never normalizes empty bytes or changes parser semantics.
  need(operation in JSON_READ_OPERATIONS,'NET_JSON_OPERATION_CLOSED');entries=self.ledger.setdefault('jsonReads',[]);need(len(entries)<64,'NET_JSON_DIAGNOSTIC_BOUND');entry={'operation':operation,'state':'READ_ATTEMPTED_RESULT_UNKNOWN'};entries.append(entry);self.persist()
  try:
   text=command(*args,**kwargs);raw=text.encode('utf-8');entry.update(state='COMMAND_ZERO_STDOUT_OBSERVED',stdoutBytes=len(raw),stdoutSha256=hashlib.sha256(raw).hexdigest(),stdoutEmpty=len(raw)==0,stdoutWhitespaceOnly=bool(raw) and not raw.strip());self.persist()
   try:value=json.loads(text)
   except json.JSONDecodeError as error:
    entry.update(state='JSON_INVALID',errorOffset=error.pos,errorLine=error.lineno,errorColumn=error.colno);self.persist();raise
   kind=type(value).__name__;entry.update(state='JSON_PARSED',topLevelKind=kind if kind in ('list','dict','str','int','float','bool','NoneType') else 'OTHER');self.persist()
   if kwargs.get('deadline') is not None:need(time.monotonic()<kwargs['deadline'],'NET_DEADLINE')
   return value
  except BaseException as error:
   if entry['state'] not in ('JSON_INVALID','JSON_PARSED'):
    cls=type(error).__name__;entry.update(state='READ_FAILED',failureClass=cls if cls in ('RuntimeError','FileNotFoundError','PermissionError','TimeoutExpired','OSError','UnicodeDecodeError') else 'OTHER_EXCEPTION');self.persist()
   raise
 def namespace_preflight(self):
  # Empty CLI bytes alone prove nothing. Anchor directory state around CLI.
  flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
  runfd=None
  def identity(st):return (st.st_dev,st.st_ino,st.st_mode,st.st_uid,st.st_gid,st.st_mtime_ns,st.st_ctime_ns)
  def snapshot():
   runst=os.fstat(runfd);need(runst.st_uid==0 and not runst.st_mode&0o022,'NET_NETNS_PARENT_CUSTODY');pathst=os.stat('/run',follow_symlinks=False);need(identity(runst)==identity(pathst),'NET_NETNS_PARENT_CHANGED');need(Path('/var/run').resolve(strict=True)==Path('/run'),'NET_NETNS_DIRECTORY_ALIAS')
   try:fd=os.open('netns',flags,dir_fd=runfd)
   except FileNotFoundError:
    try:os.stat('netns',dir_fd=runfd,follow_symlinks=False)
    except FileNotFoundError:return {'state':'ENOENT','parentIdentity':identity(runst),'entries':{}}
    raise RuntimeError('NET_NETNS_DIRECTORY_RACE')
   try:
    before=os.fstat(fd);need(before.st_uid==0 and not before.st_mode&0o022,'NET_NETNS_DIRECTORY_CUSTODY');names=os.listdir(fd);need(len(names)<=4096,'NET_NETNS_DIRECTORY_BOUND');entries={}
    for name in names:
     need(name not in ('.','..') and '/' not in name and '\x00' not in name,'NET_NETNS_ENTRY_NAME');entry=os.stat(name,dir_fd=fd,follow_symlinks=False);need(not stat.S_ISLNK(entry.st_mode),'NET_NETNS_ENTRY_SYMLINK');entries[name]=identity(entry)
    after=os.fstat(fd);path=os.stat('netns',dir_fd=runfd,follow_symlinks=False);need(identity(before)==identity(after)==identity(path),'NET_NETNS_DIRECTORY_RACE');return {'state':'DIRECTORY','parentIdentity':identity(runst),'directoryIdentity':identity(before),'entries':entries}
   finally:os.close(fd)
  entry={'operation':'PREFLIGHT_NAMESPACES','state':'DIRECTORY_CHECK_ATTEMPTED'}
  try:
   runfd=os.open('/run',flags);reads=self.ledger.setdefault('jsonReads',[]);need(len(reads)<64,'NET_JSON_DIAGNOSTIC_BOUND');reads.append(entry);self.persist()
   before=snapshot();text=command('/usr/sbin/ip','-j','netns','list');raw=text.encode('utf-8');after=snapshot();need(before==after,'NET_NETNS_DIRECTORY_RACE');entry.update(stdoutBytes=len(raw),stdoutSha256=hashlib.sha256(raw).hexdigest(),stdoutEmpty=not raw,stdoutWhitespaceOnly=bool(raw) and not raw.strip(),directoryState=before['state'],directoryEntryCount=len(before['entries']),parentIdentity=before['parentIdentity'],directoryIdentity=before.get('directoryIdentity'),directoryEntries=before['entries']);self.persist()
   if text=='':
    need(before['state']=='ENOENT','NET_NETNS_EMPTY_WITH_DIRECTORY');entry['state']='EMPTY_ACCEPTED_TWO_OBSERVED_ENOENT';self.persist();return set()
   try:value=json.loads(text)
   except json.JSONDecodeError as error:entry.update(state='JSON_INVALID',errorOffset=error.pos,errorLine=error.lineno,errorColumn=error.colno);self.persist();raise
   need(isinstance(value,list) and all(isinstance(row,dict) and isinstance(row.get('name'),str) for row in value),'NET_NETNS_JSON_SCHEMA');names=[row['name'] for row in value];need(len(names)==len(set(names)) and set(names)==set(before['entries']),'NET_NETNS_CLI_DIRECTORY_MISMATCH');need(before['state']=='DIRECTORY','NET_NETNS_JSON_WITH_ABSENT_DIRECTORY');entry['state']='JSON_DIRECTORY_NAMES_MATCH';self.persist();return set(names)
  except BaseException as error:
   cls=type(error).__name__;entry.update(state='NAMESPACE_PREFLIGHT_FAILED',failureClass=cls if cls in ('RuntimeError','JSONDecodeError','FileNotFoundError','PermissionError','TimeoutExpired','OSError') else 'OTHER_EXCEPTION');self.persist();raise
  finally:
   if runfd is not None:os.close(runfd)
 def creation_acknowledged(self,resource):
  record=self.ledger.get('creation',{}).get(resource,{})
  need(record.get('attempted') is True and record.get('acknowledged') is True,'NET_CREATION_NOT_ACKNOWLEDGED')
  index=record.get('mutationIndex');rows=self.ledger['mutations'];need(type(index) is int and 0<=index<len(rows) and rows[index]['state']=='COMMAND_ACKNOWLEDGED','NET_CREATION_MUTATION_NOT_ACKNOWLEDGED')
 def namespace_identity(self):
  st=os.stat('/run/netns/'+self.namespace,follow_symlinks=False);need(not stat.S_ISLNK(st.st_mode),'NET_NAMESPACE_SYMLINK');return {'namespaceInode':st.st_ino,'namespaceDevice':st.st_dev}
 def require_namespace_identity(self):
  self.creation_acknowledged('namespace');actual=self.namespace_identity();need(all(self.ledger['identities'].get(k)==v for k,v in actual.items()),'NET_NAMESPACE_REPLACED');return actual
 def table_identity(self,resource,family,inside=False):
  self.creation_acknowledged(resource)
  args=('/usr/sbin/ip','netns','exec',self.namespace) if inside else ()
  if inside:self.require_namespace_identity()
  value=self.read_json('OWNERSHIP_TABLE',*args,'/usr/sbin/nft','-a','-j','list','table',family,self.table);rows=[x['table'] for x in value['nftables'] if x.get('table',{}).get('name')==self.table and x['table'].get('family')==family];need(len(rows)==1 and type(rows[0].get('handle')) is int,'NET_TABLE_HANDLE_SCHEMA');return rows[0]['handle']
 def veth_identity(self,hostlinks=None,namespace_present=True,deadline=None):
  hostlinks=self.read_json('OWNERSHIP_HOST_LINKS','/usr/sbin/ip','-j','-d','link','show',deadline=deadline) if hostlinks is None else hostlinks
  hosts=[x for x in hostlinks if x.get('ifname')==self.hostif];peers=[(x,'HOST') for x in hostlinks if x.get('ifname')==self.peerif]
  if namespace_present:
   self.require_namespace_identity();links=self.read_json('OWNERSHIP_PEER_LINKS','/usr/sbin/ip','-n',self.namespace,'-j','-d','link','show',deadline=deadline);need(all(x.get('ifname') in ('lo',self.peerif) for x in links),'NET_FOREIGN_NAMESPACE_LINK');peers += [(x,'NAMESPACE') for x in links if x.get('ifname')==self.peerif]
  if not hosts and not peers:return None
  need(len(hosts)==len(peers)==1,'NET_VETH_PAIR_INCOMPLETE');host=hosts[0];peer,location=peers[0]
  need(all(x.get('linkinfo',{}).get('info_kind')=='veth' and type(x.get('ifindex')) is int and type(x.get('link_index')) is int for x in (host,peer)),'NET_VETH_PAIR_SCHEMA');need(host['link_index']==peer['ifindex'] and peer['link_index']==host['ifindex'],'NET_VETH_PAIR_NOT_RECIPROCAL')
  return {'hostIfindex':host['ifindex'],'peerIfindex':peer['ifindex'],'peerLocation':location}
 def setup(self):
  need(os.geteuid()==0,'NET_ROOT_REQUIRED');need(Path('/proc/sys/net/ipv4/ip_forward').read_text().strip()=='1','NET_HOST_FORWARDING_DISABLED_NO_GLOBAL_SYSCTL_CHANGE')
  # Never mutate a global sysctl to make this fixture work. Existing route
  # collision is a blocker requiring another externally reviewed owned prefix.
  routes=self.read_json('SETUP_ROUTE_TABLES','/usr/sbin/ip','-j','route','show','table','all');prefix=ipaddress.ip_network(self.prefix)
  for route in routes:
   dst=route.get('dst','default')
   if dst=='default':continue
   try:network=ipaddress.ip_network(dst,strict=False)
   except ValueError:continue
   need(network.version!=4 or not network.overlaps(prefix),'NET_OWN_PREFIX_COLLISION')
  current=self.read_json('SETUP_HOST_ADDRESSES','/usr/sbin/ip','-j','address','show');host={a['local'] for item in current for a in item.get('addr_info',[])};need(host==set(self.policy['hostAddresses']),'NET_HOST_ADDRESSES_CHANGED')
  allowed=sorted({public_ip(a,host) for values in self.policy['endpoints'].values() for a in values});need(1<=len(allowed)<=48,'NET_POLICY_IP_COUNT');ips=', '.join(allowed)
  try:
   names=self.namespace_preflight();links=self.read_json('PREFLIGHT_LINKS','/usr/sbin/ip','-j','link','show');tables=self.read_json('PREFLIGHT_NFT_TABLES','/usr/sbin/nft','-j','list','tables')
   need(self.namespace_preflight()==names,'NET_NETNS_PREFLIGHT_CHANGED_BEFORE_RESERVATION');need(self.namespace not in names and not any(x.get('ifname') in (self.hostif,self.peerif) for x in links) and not any(x.get('table',{}).get('name')==self.table for x in tables['nftables']),'NET_OWNED_IDENTIFIER_COLLISION');self.ledger['preflightAbsent']=True;self.persist()
   self.mutate('/usr/sbin/ip','netns','add',self.namespace,resource='namespace');self.created=True;self.ledger['identities'].update(self.namespace_identity());self.persist()
   self.require_namespace_identity();self.mutate('/usr/sbin/ip','link','add',self.hostif,'type','veth','peer','name',self.peerif,resource='veth');pair=self.veth_identity();need(pair is not None and pair['peerLocation']=='HOST','NET_CREATED_VETH_PAIR');self.ledger['identities']['vethPair']=pair;self.persist();self.mutate('/usr/sbin/ip','link','set',self.peerif,'netns',self.namespace);moved=self.veth_identity();need(moved is not None and moved==dict(pair,peerLocation='NAMESPACE'),'NET_MOVED_VETH_PAIR');self.ledger['identities']['vethPair']=moved;self.persist()
   self.mutate('/usr/sbin/ip','address','add',self.hostip+'/30','dev',self.hostif);self.mutate('/usr/sbin/ip','link','set',self.hostif,'up')
   for args in [('address','add',self.peerip+'/30','dev',self.peerif),('link','set',self.peerif,'up'),('link','set','lo','up'),('route','add','default','via',self.hostip)]:self.mutate('/usr/sbin/ip','-n',self.namespace,*args)
   self.ledger['listener']={'state':'BIND_ATTEMPTED_RESULT_UNKNOWN','address':self.hostip,'port':0,'lifetime':'PROCESS_FD_ONLY'};self.persist();self.listener=socket.socket();self.listener.settimeout(.5);self.listener.bind((self.hostip,0));self.listener.listen(4);self.probePort=self.listener.getsockname()[1];self.ledger['listener'].update(state='BOUND',port=self.probePort);self.persist()
   # Controlled host endpoint actually listens. Local baseline connects and is
   # accepted before any child denial observation. No private service probes.
   baseline=socket.create_connection((self.hostip,self.probePort),timeout=1);accepted,_=self.listener.accept();baseline.close();accepted.close()
   rules=f'''create table inet {self.table}
table inet {self.table} {{
 set public4 {{ type ipv4_addr; elements = {{ {ips} }} }}
 counter denied_probe {{ }}
 counter public_https {{ }}
 counter denied_other {{ }}
 chain output {{ type filter hook output priority -100; policy drop;
 ip daddr {self.hostip} tcp dport {self.probePort} counter name denied_probe drop
 ip daddr @public4 tcp dport 443 counter name public_https accept
 counter name denied_other drop
 }}
 chain input {{ type filter hook input priority -100; policy drop;
 ct state established,related accept
 }}
 chain forward {{ type filter hook forward priority -100; policy drop; }}
}}'''
   self.require_namespace_identity();self.mutate('/usr/sbin/ip','netns','exec',self.namespace,'/usr/sbin/nft','-f','-',input=rules.encode(),resource='namespaceTable');self.ledger['identities']['namespaceTableHandle']=self.table_identity('namespaceTable','inet',inside=True);self.persist()
   hostrules=f'''create table ip {self.table}
table ip {self.table} {{
 set public4 {{ type ipv4_addr; elements = {{ {ips} }} }}
 chain forward {{ type filter hook forward priority -100; policy accept;
 iifname "{self.hostif}" ip saddr {self.peerip} ip daddr @public4 tcp dport 443 accept
 iifname "{self.hostif}" drop
 oifname "{self.hostif}" ip daddr {self.peerip} ct state established,related accept
 oifname "{self.hostif}" drop
 }}
 chain postrouting {{ type nat hook postrouting priority srcnat; policy accept;
 iifname "{self.hostif}" ip saddr {self.peerip} ip daddr @public4 tcp dport 443 masquerade
 }}
}}'''
   self.mutate('/usr/sbin/nft','-f','-',input=hostrules.encode(),resource='hostTable');self.hosttable=True;self.ledger['identities']['hostTableHandle']=self.table_identity('hostTable','ip');self.persist();self.rules=rules;self.hostrules=hostrules
   need(self.veth_identity()==self.ledger['identities']['vethPair'],'NET_FINAL_VETH_PAIR_CHANGED')
   snapshot=self.snapshot();need(snapshot['deniedProbePackets']==0,'NET_COUNTER_NOT_FRESH');return snapshot
  except BaseException:
   if self.ledger['preflightAbsent']:self.cleanup()
   raise
 def snapshot(self,deadline=None):
  self.require_namespace_identity();need(self.veth_identity(deadline=deadline)==self.ledger['identities'].get('vethPair'),'NET_SNAPSHOT_VETH_PAIR_CHANGED');self.creation_acknowledged('namespaceTable');self.creation_acknowledged('hostTable')
  value=self.read_json('SNAPSHOT_NAMESPACE_NFT','/usr/sbin/ip','netns','exec',self.namespace,'/usr/sbin/nft','-a','-j','list','table','inet',self.table,deadline=deadline);counters={}
  for row in value['nftables']:
   c=row.get('counter')
   if c:counters[c['name']]=c
  table_rows=[x['table'] for x in value['nftables'] if x.get('table',{}).get('name')==self.table and x['table'].get('family')=='inet'];need(len(table_rows)==1 and table_rows[0].get('handle')==self.ledger['identities'].get('namespaceTableHandle'),'NET_NAMESPACE_TABLE_REPLACED')
  need(set(counters)=={'denied_probe','public_https','denied_other'},'NET_COUNTER_SET')
  hostvalue=self.read_json('SNAPSHOT_HOST_NFT','/usr/sbin/nft','-a','-j','list','table','ip',self.table,deadline=deadline);host_table=next(x['table'] for x in hostvalue['nftables'] if x.get('table',{}).get('name')==self.table);handle=host_table.get('handle');need(type(handle) is int,'NET_HOST_TABLE_HANDLE');expected_handle=self.ledger['identities'].get('hostTableHandle');need(type(expected_handle) is int and handle==expected_handle,'NET_HOST_TABLE_REPLACED');routes=self.read_json('SNAPSHOT_NAMESPACE_ROUTES','/usr/sbin/ip','-n',self.namespace,'-j','route','show','table','all',deadline=deadline);hostroutes=self.read_json('SNAPSHOT_HOST_ROUTES','/usr/sbin/ip','-j','route','show','dev',self.hostif,deadline=deadline);hostlinks=self.read_json('SNAPSHOT_HOST_LINK','/usr/sbin/ip','-j','-d','link','show','dev',self.hostif,deadline=deadline);peerlinks=self.read_json('SNAPSHOT_PEER_LINK','/usr/sbin/ip','-n',self.namespace,'-j','-d','link','show','dev',self.peerif,deadline=deadline);namespace_inode=Path('/run/netns',self.namespace).stat().st_ino;need(namespace_inode==self.ledger['identities']['namespaceInode'],'NET_NAMESPACE_REPLACED');need(Path('/proc/sys/net/ipv4/ip_forward').read_text().strip()=='1','NET_FORWARDING_CHANGED')
  return {'hostNamespaceInode':Path('/proc/self/ns/net').stat().st_ino,'hostRoutes':hostroutes,'hostRuleset':hostvalue,'namespaceRoutes':routes,'hostLink':hostlinks,'peerLink':peerlinks,'namespaceInode':namespace_inode,'forwardingBefore':'1','forwardingObserved':'1','namespace':self.namespace,'table':self.table,'hostInterface':self.hostif,'peerInterface':self.peerif,'peerHostIP':self.hostip,'peerHostPort':self.probePort,'namespaceIP':self.peerip,'deniedProbePackets':counters['denied_probe']['packets'],'publicHttpsPackets':counters['public_https']['packets'],'ruleset':value,'policy':self.policy}
 def confirm_probe(self,before,child_receipt,deadline):
  after=self.snapshot(deadline)
  def stable(value):
   if isinstance(value,dict):return {k:stable(v) for k,v in value.items() if k not in ('packets','bytes','handle')}
   if isinstance(value,list):return [stable(v) for v in value]
   return value
  need(all(stable(before[k])==stable(after[k]) for k in ('ruleset','hostRuleset','namespaceRoutes','hostLink','peerLink','hostRoutes','hostNamespaceInode','namespaceInode','forwardingObserved')),'NET_RULESET_OR_TOPOLOGY_CHANGED_DURING_PROBE');need(child_receipt.get('hostConnectSucceeded') is False and child_receipt.get('httpsStatus')==200,'NET_PROBE_RESULT');need(after['deniedProbePackets']>before['deniedProbePackets'] and after['publicHttpsPackets']>before['publicHttpsPackets'],'NET_ENFORCEMENT_COUNTER_DELTA');need(self.listener is not None,'NET_LISTENER_LOST')
  remaining=deadline-time.monotonic();need(remaining>0,'NET_PROBE_DEADLINE');self.listener.settimeout(min(.5,remaining))
  try:unexpected,_=self.listener.accept()
  except socket.timeout:pass
  else:unexpected.close();raise RuntimeError('NET_DENIED_ENDPOINT_REACHED')
  need(time.monotonic()<deadline,'NET_PROBE_DEADLINE')
  return {'kind':'NETNS_NFT_ACTUAL_CONTROLLED_DENIAL_AND_PUBLIC_TLS_SUCCESS','before':before,'after':after,'controlledHostBaselineConnected':True,'hostListenerReceivedChild':False,'childProbe':child_receipt,'notTextualReadbackOnly':True}
 def cleanup(self):
  # Validate the entire dependency set before deleting anything. A name,
  # reservation, attempted command or a later observed identity is not ownership.
  self.ledger['cleanupState']='RECONCILING';self.persist()
  if self.listener:self.listener.close();self.listener=None
  if not self.ledger['preflightAbsent']:
   need(not self.ledger['mutations'],'NET_MUTATION_WITHOUT_RESERVATION');self.ledger['cleanupState']='NO_EFFECT_ATTEMPTED';self.persist();return
  try:
   identities=self.ledger['identities'];namespace_present=self.namespace in self.namespace_preflight()
   if namespace_present:self.require_namespace_identity()
   tables=self.read_json('CLEANUP_NFT_TABLES','/usr/sbin/nft','-j','list','tables');host_present=any(x.get('table',{}).get('family')=='ip' and x['table'].get('name')==self.table for x in tables['nftables'])
   if host_present:
    self.creation_acknowledged('hostTable');need(type(identities.get('hostTableHandle')) is int and self.table_identity('hostTable','ip')==identities['hostTableHandle'],'NET_CLEANUP_TABLE_IDENTITY_NOT_ACQUIRED_OR_CHANGED')
   namespace_table_present=False
   if namespace_present:
    tables=self.read_json('CLEANUP_NAMESPACE_TABLES','/usr/sbin/ip','netns','exec',self.namespace,'/usr/sbin/nft','-j','list','tables');namespace_tables=[x['table'] for x in tables['nftables'] if 'table' in x];need(all(x.get('family')=='inet' and x.get('name')==self.table for x in namespace_tables),'NET_CLEANUP_FOREIGN_NAMESPACE_TABLE');namespace_table_present=bool(namespace_tables)
    if namespace_table_present:
     self.creation_acknowledged('namespaceTable');need(type(identities.get('namespaceTableHandle')) is int and self.table_identity('namespaceTable','inet',inside=True)==identities['namespaceTableHandle'],'NET_CLEANUP_NAMESPACE_TABLE_IDENTITY_NOT_ACQUIRED_OR_CHANGED')
   pair=self.veth_identity(namespace_present=namespace_present)
   if pair is not None:
    self.creation_acknowledged('veth');need(pair==identities.get('vethPair'),'NET_CLEANUP_VETH_IDENTITIES_NOT_ACQUIRED_OR_CHANGED')
   self.ledger['cleanupGuarantees']={'namespace':'ACQUIRED_DEVICE_INODE_MATCH' if namespace_present else 'ABSENT','hostTable':'ACK_AND_ACQUIRED_HANDLE_MATCH' if host_present else 'ABSENT','namespaceTable':'ACK_AND_ACQUIRED_HANDLE_MATCH' if namespace_table_present else 'ABSENT','veth':'ACK_AND_ACQUIRED_RECIPROCAL_ENDPOINTS_MATCH' if pair is not None else 'ABSENT'};self.persist()
   if host_present:self.mutate('/usr/sbin/nft','delete','table','ip','handle',str(identities['hostTableHandle']))
   if pair is not None:
    need(self.veth_identity(namespace_present=namespace_present)==pair,'NET_CLEANUP_VETH_CHANGED_BEFORE_DELETE');self.mutate('/usr/sbin/ip','link','delete',self.hostif)
   if namespace_table_present:
    self.require_namespace_identity();need(self.table_identity('namespaceTable','inet',inside=True)==identities['namespaceTableHandle'],'NET_CLEANUP_NAMESPACE_TABLE_CHANGED_BEFORE_DELETE');self.mutate('/usr/sbin/ip','netns','exec',self.namespace,'/usr/sbin/nft','delete','table','inet','handle',str(identities['namespaceTableHandle']))
   if namespace_present:
    self.require_namespace_identity();need(self.veth_identity() is None,'NET_CLEANUP_VETH_RETAINED_BEFORE_NAMESPACE_DELETE');tables=self.read_json('CLEANUP_NAMESPACE_TABLES','/usr/sbin/ip','netns','exec',self.namespace,'/usr/sbin/nft','-j','list','tables');need(not any('table' in x for x in tables['nftables']),'NET_CLEANUP_FOREIGN_NAMESPACE_TABLE');links=self.read_json('OWNERSHIP_PEER_LINKS','/usr/sbin/ip','-n',self.namespace,'-j','-d','link','show');need(len(links)==1 and links[0].get('ifname')=='lo' and links[0].get('ifindex')==1,'NET_CLEANUP_FOREIGN_NAMESPACE_LINK');self.mutate('/usr/sbin/ip','netns','delete',self.namespace)
   need(self.namespace not in self.namespace_preflight(),'NET_NAMESPACE_RETAINED');need(not any(x.get('ifname') in (self.hostif,self.peerif) for x in self.read_json('CLEANUP_VERIFY_LINKS','/usr/sbin/ip','-j','link','show')),'NET_VETH_RETAINED');tables=self.read_json('CLEANUP_VERIFY_TABLES','/usr/sbin/nft','-j','list','tables');need(not any(x.get('table',{}).get('family')=='ip' and x['table'].get('name')==self.table for x in tables['nftables']),'NET_HOST_TABLE_RETAINED')
  except BaseException as error:
   self.ledger['cleanupState']='UNKNOWN';self.ledger['cleanupFailures']=[{'resource':'ownership_set_or_removal','error':type(error).__name__}];self.persist();raise RuntimeError('NET_CLEANUP_UNKNOWN') from error
  self.ledger['cleanupState']='REMOVAL_VERIFIED';self.ledger['cleanupFailures']=[];self.persist()
if __name__=='__main__':raise SystemExit('INACTIVE: no namespace/filter/probe execution authorized')
