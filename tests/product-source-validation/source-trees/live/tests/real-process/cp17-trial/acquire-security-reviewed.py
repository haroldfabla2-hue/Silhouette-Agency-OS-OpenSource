#!/usr/bin/env python3
"""NEW security-only download/extraction contract. Preparation, NOT EXECUTED."""
import shutil,datetime,email.utils,hashlib,io,json,lzma,os,pathlib,re,selectors,signal,stat,subprocess,sys,tarfile,time,urllib.request
E=pathlib.Path(os.environ['EVIDENCE']);scope=pathlib.Path(sys.argv[1]);key=pathlib.Path(sys.argv[2]);expected_key='80a36b0a6de2f69f49d2df75ef473ccde121e9e190b9ea01d20a4f63778d5c31'
clock=json.loads((E/'job-clock.json').read_text());host=json.loads((E/'host-budget.json').read_text())
end=min(time.monotonic()+max(0,240-host['elapsed_seconds']),clock['deadline_monotonic']-120)
assert end>time.monotonic(),'No host setup budget'
proof=E/'security-chain';proof.mkdir();(scope/'home').mkdir(mode=0o700);total_download=0
KEYS={'790BC7277767219C42C86F933B4FE6ACC0B21F32','843938DF228D22F7B3742BC0D94AA3F0EFE21092','F6ECB3762474EDA9D21B7022871920D1991BC93C'}
producer_total=0
active={};cleaning=False;sticky_unsafe=False;interrupted=[]
helpers_state=E/'security-helpers-state.json'
record={'contract':'one noble-security/main/amd64 candidate only','apt_invoked':False,'downloaded':[],'commands':[]}
def group(pid):
 try:os.killpg(pid,0);return 'LIVE'
 except ProcessLookupError:return 'ESRCH'
 except OSError:return 'UNKNOWN'
def publish_helpers(reason):
 value={'status':'SAFE' if not active and not sticky_unsafe else 'UNSAFE','active':list(active),'sticky_unsafe':sticky_unsafe,'signals':interrupted,'reason':reason,'owner_pid':os.getpid(),'monotonic':time.monotonic(),'helpers':record['commands']}
 tmp=helpers_state.with_suffix('.tmp');tmp.write_text(json.dumps(value,indent=2));os.replace(tmp,helpers_state)
def stopped(signum,frame):
 global sticky_unsafe
 sticky_unsafe=True;interrupted.append(signal.Signals(signum).name);publish_helpers('interrupted; never admit or delete owned resources')
 if not cleaning:raise RuntimeError('Setup interrupted by signal '+str(signum))
signal.signal(signal.SIGTERM,stopped);signal.signal(signal.SIGINT,stopped)
publish_helpers('initialized no helper')
def checktime():
 if time.monotonic()>=end:raise RuntimeError('Aggregate host setup deadline')
def bounded_file(p,cap):
 m=p.lstat();assert stat.S_ISREG(m.st_mode),'Not regular'
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);assert (a.st_dev,a.st_ino)==(m.st_dev,m.st_ino)
  with os.fdopen(fd,'rb',closefd=False) as f:b=f.read(cap+1)
  z=os.fstat(fd);assert len(b)<=cap and len(b)==a.st_size and (a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(z.st_dev,z.st_ino,z.st_size,z.st_mtime_ns,z.st_ctime_ns)
  return b
 finally:os.close(fd)
def call(cmd,cap=262144,allowed_rc=(0,),diagnostic=False):
 global producer_total,cleaning,sticky_unsafe
 checktime();p=None;sel=selectors.DefaultSelector();data={};began=time.monotonic();error=None;signals=[];eof=set();pre=None;safe=False;spawn_pending=True;reaped=False
 # Persist UNSAFE before spawn. SIGKILL in any spawn/register gap remains fail-closed.
 sticky_before=sticky_unsafe;sticky_unsafe=True;publish_helpers('spawn pending')
 try:
  old=signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGTERM,signal.SIGINT})
  try:
   p=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,env={'PATH':os.environ['PATH'],'HOME':str(scope/'home')})
   active[p.pid]=p;spawn_pending=False
   for f in [p.stdout,p.stderr]:os.set_blocking(f.fileno(),False);sel.register(f.fileno(),selectors.EVENT_READ);data[f.fileno()]=bytearray()
   sticky_unsafe=sticky_before;publish_helpers('helper registered')
  finally:signal.pthread_sigmask(signal.SIG_SETMASK,old)
  while sel.get_map():
   checktime()
   if time.monotonic()-began>min(15,end-began):raise RuntimeError('Bounded command deadline')
   for k,_ in sel.select(.025):
    try:b=os.read(k.fd,min(65536,cap-sum(map(len,data.values()))+1,min(512*1024,3*1024*1024-host['retained_bytes'])-producer_total-sum(map(len,data.values()))+1))
    except BlockingIOError:continue
    if not b:eof.add(k.fd);sel.unregister(k.fd);continue
    if producer_total+sum(map(len,data.values()))+len(b)>min(512*1024,3*1024*1024-host['retained_bytes']) or sum(map(len,data.values()))+len(b)>cap:raise RuntimeError('Bounded command output cap')
    data[k.fd].extend(b)
  rc=p.wait(timeout=min(2,max(.01,end-time.monotonic())));reaped=True
  if diagnostic:
   record.setdefault('ip_command_captures',[]).append({'argv':cmd,'returncode':rc,'stdout':bytes(data[p.stdout.fileno()]).decode(),'stderr':bytes(data[p.stderr.fileno()]).decode()})
   (proof/'ip-command-captures.json').write_text(json.dumps(record['ip_command_captures'],indent=2))
  assert rc in allowed_rc,'Command nonzero '+str(cmd)
  assert group(p.pid)=='ESRCH','Helper residual process group'
 except BaseException as exc:error=str(exc)
 finally:
  cleaning=True
  if p:
   pre={'returncode':p.poll(),'reaped':reaped,'group':group(p.pid),'pipe_eof':len(eof)==2}
   # Included inside explicit reviewed240s preparation envelope, not an extra phase budget.
   until=min(time.monotonic()+1.5,end)
   if group(p.pid)!='ESRCH':
    try:os.killpg(p.pid,signal.SIGTERM);signals.append('SIGTERM')
    except ProcessLookupError:pass
    except OSError as exc:error=error or str(exc)
   kill_at=min(time.monotonic()+.5,until)
   while time.monotonic()<until:
    p.poll()
    if time.monotonic()>=kill_at and group(p.pid)!='ESRCH' and 'SIGKILL' not in signals:
     try:os.killpg(p.pid,signal.SIGKILL);signals.append('SIGKILL')
     except ProcessLookupError:pass
     except OSError as exc:error=error or str(exc)
    for k,_ in sel.select(.01):
     try:b=os.read(k.fd,1)
     except BlockingIOError:continue
     if not b:eof.add(k.fd);sel.unregister(k.fd)
     else:error=error or 'Helper output after failure; discarded not successful evidence'
    if p.poll() is not None:
     try:p.wait(timeout=0);reaped=True
     except subprocess.TimeoutExpired:pass
    if reaped and group(p.pid)=='ESRCH' and len(eof)==2:break
   safe=reaped and group(p.pid)=='ESRCH' and len(eof)==2
   post={'returncode':p.poll(),'reaped':reaped,'group':group(p.pid),'pipe_eof':len(eof)==2}
   if safe:active.pop(p.pid,None)
   else:sticky_unsafe=True
   row={'argv':cmd,'pid':p.pid,'pre_cleanup':pre,'post_cleanup':post,'signals':signals,'safe':safe,'error':error,'elapsed_seconds':time.monotonic()-began,'stdout_bytes':len(data.get(p.stdout.fileno(),b'')),'stderr_bytes':len(data.get(p.stderr.fileno(),b''))}
   record['commands'].append(row)
  else:
   sticky_unsafe=True;record['commands'].append({'argv':cmd,'spawn_pending':spawn_pending,'error':error,'safe':False})
  producer_total+=sum(map(len,data.values()));sel.close();publish_helpers('helper closeout');(proof/'progress.json').write_text(json.dumps(record,indent=2));cleaning=False
 if error or signals or not safe or interrupted:raise RuntimeError(error or 'Helper required signals or is unsafe/interrupted')
 out=bytes(data[p.stdout.fileno()]);err=bytes(data[p.stderr.fileno()]);p.stdout.close();p.stderr.close();return out,err
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise RuntimeError('Redirect forbidden')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
def fetch(url,cap,dest,size=None,digest=None):
 global total_download
 checktime();assert url.startswith('https://security.ubuntu.com/ubuntu/'),url
 with opener.open(url,timeout=min(15,max(.1,end-time.monotonic()))) as response:
  assert response.status==200 and response.geturl()==url and response.headers.get('Content-Encoding','identity')=='identity'
  declared=response.headers.get('Content-Length')
  if declared:assert int(declared)<=cap and (size is None or int(declared)==size)
  data=bytearray()
  while True:
   checktime();b=response.read(min(65536,cap-len(data)+1))
   if not b:break
   if len(data)+len(b)>cap:raise RuntimeError('N+1 network cap; no oversize file write')
   data.extend(b)
  assert size is None or len(data)==size
  h=hashlib.sha256(data).hexdigest();assert digest is None or h==digest
  assert total_download+len(data)<=3*1024*1024,'Aggregate download3MiB hard cap before write'
  total_download+=len(data);dest.write_bytes(data);record['downloaded'].append({'url':url,'bytes':len(data),'sha256':h,'path':dest.name});(proof/'progress.json').write_text(json.dumps(record,indent=2));return bytes(data)
def fields(stanza):
 result={};last=None
 for line in stanza.splitlines():
  if line.startswith((' ','\t')):
   assert last;result[last]+='\n'+line;continue
  if not line:continue
  assert ':' in line
  k,v=line.split(':',1);assert k not in result;result[k]=v.strip();last=k
 return result
try:
 # Key owned by root in a non-writable root-owned parent; no ambient key trust.
 m=key.lstat();parent=key.parent.lstat();assert m.st_uid==parent.st_uid==0 and stat.S_ISREG(m.st_mode) and m.st_mode&0o222==0 and parent.st_mode&0o022==0
 kb=bounded_file(key,16384);(proof/'ubuntu-archive-keyring.gpg').write_bytes(kb);assert len(kb)==3607 and hashlib.sha256(kb).hexdigest()==expected_key
 out,_=call(['gpg','--batch','--no-autostart','--no-options','--homedir',str(scope/'home'),'--no-default-keyring','--keyring',str(key),'--with-colons','--fingerprint','--list-keys'])
 (proof/'key-fingerprints.txt').write_bytes(out)
 assert {l.split(':')[9] for l in out.decode().splitlines() if l.startswith('fpr:')}==KEYS
 release=fetch('https://security.ubuntu.com/ubuntu/dists/noble-security/InRelease',262144,proof/'InRelease')
 signed,_=call(['gpgv','--homedir',str(scope/'home'),'--keyring',str(key),'--status-fd','1',str(proof/'InRelease')])
 (proof/'gpgv-status.txt').write_bytes(signed)
 valid=[l.split() for l in signed.decode().splitlines() if l.startswith('[GNUPG:] VALIDSIG ')]
 assert valid and all(x[2] in KEYS or x[-1] in KEYS for x in valid);assert not any(x in signed.decode() for x in [' BADSIG ',' ERRSIG ',' REVKEYSIG ',' EXPKEYSIG '])
 # Parse only clearsigned payload; dash-unescape before field parsing.
 text=release.decode();assert text.startswith('-----BEGIN PGP SIGNED MESSAGE-----\n')
 payload=text.split('\n\n',1)[1].split('\n-----BEGIN PGP SIGNATURE-----',1)[0];payload='\n'.join(l[2:] if l.startswith('- ') else l for l in payload.splitlines());rf=fields(payload)
 assert (rf['Origin'],rf['Label'],rf['Suite'],rf['Codename'])==('Ubuntu','Ubuntu','noble-security','noble')
 now=datetime.datetime.now(datetime.timezone.utc);assert abs((time.time()-clock['observed_utc_epoch'])-(time.monotonic()-clock['observed_monotonic']))<=5,'Wall/monotonic clock step'
 assert now>=datetime.datetime(2026,11,12,tzinfo=datetime.timezone.utc),'Clock earlier than reviewed contract'
 date=email.utils.parsedate_to_datetime(rf['Date']);assert date.tzinfo is not None
 age=(now-date).total_seconds();assert -300<=age<=48*3600,'Security release Date future/stale or clock mismatch'
 if 'Valid-Until' in rf:assert now<=email.utils.parsedate_to_datetime(rf['Valid-Until']),'Release expired'
 record['freshness']={'observed_utc':now.isoformat(),'Date':rf['Date'],'age_seconds':age,'Valid-Until':rf.get('Valid-Until'),'max_age_seconds':172800,'future_tolerance_seconds':300,'base_updates_not_in_scope':True}
 entries={}
 for line in rf['SHA256'].splitlines():
  if not line.strip():continue
  h,n,path=line.split();assert re.fullmatch('[a-f0-9]{64}',h);entries[path]=(h,int(n))
 h,n=entries['main/binary-amd64/Packages.xz'];assert n<=1572864,'Official index exceeds1.5MiB fixed export budget'
 xz=fetch('https://security.ubuntu.com/ubuntu/dists/noble-security/main/binary-amd64/Packages.xz',1572864,proof/'Packages.xz',n,h)
 dec=lzma.LZMADecompressor(memlimit=64*1024*1024);index=dec.decompress(xz,max_length=16*1024*1024+1);assert dec.eof and not dec.unused_data and len(index)<=16*1024*1024,'Index decompression cap/trailing'
 uh,un=entries['main/binary-amd64/Packages'];assert len(index)==un and hashlib.sha256(index).hexdigest()==uh
 candidates=[fields(s) for s in index.decode().split('\n\n') if s.startswith('Package: bubblewrap\n')];assert len(candidates)==1
 pkg=candidates[0];assert pkg['Package']=='bubblewrap' and pkg['Architecture']=='amd64'
 assert pkg['Depends']=='libc6 (>= 2.38), libcap2 (>= 1:2.10), libselinux1 (>= 3.1~)' and 'Pre-Depends' not in pkg,'Dependency contract changed'
 assert pkg['Version']=='0.9.0-1ubuntu0.3','Reviewed version changed; no automatic candidate advance'
 filename=pkg['Filename'];assert filename=='pool/main/b/bubblewrap/bubblewrap_0.9.0-1ubuntu0.3_amd64.deb'
 assert int(pkg['Size'])<=1048576 and re.fullmatch('[0-9a-f]{64}',pkg['SHA256'])
 (proof/'selected-stanza.json').write_text(json.dumps(pkg,indent=2))
 deb=fetch('https://security.ubuntu.com/ubuntu/'+filename,1048576,scope/'bubblewrap.deb',int(pkg['Size']),pkg['SHA256'])
 # Pin researched payload too: archive signatures must ALSO verify above.
 assert pkg['SHA256']=='2461f1beee9cb04c8942739fe1a2b37e7b7c2a3d518f0779dc75f9245baa3094' and len(deb)==50436
 (proof/'bubblewrap.deb').write_bytes(deb)
 # All dependency semantics fixed, alternatives/arch qualifiers/PreDepends rejected.
 deps=[]
 for name,minimum in [('libc6','2.38'),('libcap2','1:2.10'),('libselinux1','3.1~')]:
  out,_=call(['dpkg-query','-W','-f=${binary:Package}\t${Architecture}\t${Version}\t${db:Status-Status}\n',name+':amd64']);items=out.decode().strip().split('\t');assert len(items)==4 and items[1]=='amd64' and items[3]=='installed'
  call(['dpkg','--compare-versions',items[2],'ge',minimum]);deps.append({'name':name,'architecture':items[1],'version':items[2],'status':items[3],'minimum':minimum})
 record['dependencies']=deps
 # Parse bounded decompressed control+data TAR BEFORE writing extracted payload.
 manifest_bytes=bounded_file(pathlib.Path(__file__).parent/'security-package-members.json',16384);(proof/'package-member-manifest.json').write_bytes(manifest_bytes);manifest=json.loads(manifest_bytes);expected={kind:{row['name']:row for row in manifest if row['archive']==kind} for kind in ['control','data']};contents={}
 for kind,flag in [('control','--ctrl-tarfile'),('data','--fsys-tarfile')]:
  raw,_=call(['dpkg-deb',flag,str(scope/'bubblewrap.deb')],262144);assert len(raw)<=1048576
  seen=set();total=0
  with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as tar:
   for member in tar:
    checktime();assert member.name in expected[kind] and member.name not in seen;seen.add(member.name);want=expected[kind][member.name]
    assert not pathlib.PurePosixPath(member.name).is_absolute() and '..' not in pathlib.PurePosixPath(member.name).parts and member.uid==member.gid==0
    assert member.mode==want['mode'] and member.size==want['bytes'] and member.mode&0o6000==0
    assert (member.isdir() and want['type']=='directory') or (member.isfile() and want['type']=='regular'),'No links/devices'
    total+=member.size;assert total<=1048576
    if member.isfile():
     f=tar.extractfile(member);data=f.read(member.size+1);assert len(data)==member.size and hashlib.sha256(data).hexdigest()==want['sha256'];contents[(kind,member.name)]=data
  assert seen==set(expected[kind])
 control=fields(contents[('control','./control')].decode());assert all(control[k]==pkg[k] for k in ['Package','Version','Architecture','Depends']) and 'Pre-Depends' not in control
 # Extract ONLY authenticated executable bytes, not sysctl/profile/postinst or other files.
 dest=scope/'bin';dest.mkdir();binary=dest/'bwrap';binary.write_bytes(contents[('data','./usr/bin/bwrap')]);binary.chmod(0o755)
 assert binary.stat().st_size==72160 and hashlib.sha256(bounded_file(binary,1048576)).hexdigest()==expected['data']['./usr/bin/bwrap']['sha256']
 # No ldd/LD_LIBRARY_PATH. Actual existing loader validates absolute library set.
 loader=pathlib.Path('/lib64/ld-linux-x86-64.so.2');assert loader.resolve()==pathlib.Path('/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2')
 listing,_=call([str(loader),'--list',str(binary)]);(proof/'loader.txt').write_bytes(listing)
 names=set()
 for line in listing.decode().splitlines():
  line=line.strip()
  if line.startswith('linux-vdso.so.1 '):continue
  if ' => ' in line:
   soname,resolved=line.split(' => ',1);path=resolved.split(' (',1)[0];assert path.startswith('/lib/x86_64-linux-gnu/') or path.startswith('/usr/lib/x86_64-linux-gnu/');names.add(soname)
   assert pathlib.Path(path).resolve().parent==pathlib.Path('/usr/lib/x86_64-linux-gnu')
  else:assert line.startswith('/lib64/ld-linux-x86-64.so.2 ')
 assert names=={'libcap.so.2','libselinux.so.1','libc.so.6','libpcre2-8.so.0'},'Unexpected loader dependency closure'
 # Verify configured transitive existing package as well; never install it.
 out,_=call(['dpkg-query','-W','-f=${binary:Package}\t${Architecture}\t${Version}\t${db:Status-Status}\n','libpcre2-8-0:amd64']);parts=out.decode().strip().split('\t');assert len(parts)==4 and parts[1]=='amd64' and parts[3]=='installed'
 record['transitive_dependency']={'name':'libpcre2-8-0','fields':parts}
 paths={loader.resolve()}
 for line in listing.decode().splitlines():
  if ' => ' in line:paths.add(pathlib.Path(line.split(' => ',1)[1].split(' (',1)[0]).resolve())
 owned=[]
 for path in sorted(paths):
  assert path.parent==pathlib.Path('/usr/lib/x86_64-linux-gnu')
  for parent in [path,path.parent,path.parent.parent,path.parent.parent.parent]:
   st=parent.lstat();assert st.st_uid==0 and st.st_mode&0o022==0,'Untrusted existing loader/library path'
  out,_=call(['dpkg-query','-S',str(path)]);owner=out.decode().strip();assert owner.startswith(('libc6:amd64: ','libcap2:amd64: ','libselinux1:amd64: ','libpcre2-8-0:amd64: ')) and '\n' not in owner
  owned.append({'path':str(path),'owner':owner})
 record['loader_owners']=owned
 call([str(binary),'--version'])
 # Capture exact metadata before interpretation. No owner inferred from canonical-path failure.
 ipproof={'paths':{},'queries':[],'status':'CAPTURE_PENDING'}
 def ipquery(cmd,allowed=(0,)):
  out,err=call(cmd,32768,allowed_rc=allowed,diagnostic=True)
  ipproof['queries'].append({'argv':cmd,'stdout':out.decode(),'stderr':err.decode(),'returncode':record['commands'][-1]['post_cleanup']['returncode']})
  (proof/'ip-identity.json').write_text(json.dumps(ipproof,indent=2));return out,err,ipproof['queries'][-1]['returncode']
 # Numeric fields and all stdout/stderr/rc are retained before assertions below.
 out,_,_=ipquery(['dpkg-query','-W','-f=${binary:Package}\t${Architecture}\t${Version}\t${Status}\n','iproute2:amd64'])
 package_fields=out.decode().strip().split('\t')
 listing,_,_=ipquery(['dpkg-query','-L','iproute2:amd64'])
 known=['/bin/ip','/sbin/ip','/usr/bin/ip','/usr/sbin/ip'];owners={};diversions={}
 for name in known:
  owner,_,rc=ipquery(['dpkg-query','-S',name],(0,1));owners[name]={'rc':rc,'text':owner.decode()}
 # One exact check per allowed pathname, not global undisclosed metadata.
 for name in known:
  diverted,_,_=ipquery(['dpkg-divert','--list',name]);diversions[name]=diverted.decode()
 alt,alterr,altrc=ipquery(['update-alternatives','--query','ip'],(0,2))
 # Snapshot every parent/alias, including absent paths. No package path is invented.
 for name in ['/bin','/sbin','/usr','/usr/bin','/usr/sbin']+known:
  path=pathlib.Path(name)
  try:
   ls=path.lstat();row={'exists':True,'lstat_mode':ls.st_mode,'uid':ls.st_uid,'gid':ls.st_gid,'dev':ls.st_dev,'ino':ls.st_ino,'symlink':stat.S_ISLNK(ls.st_mode),'link':os.readlink(path) if stat.S_ISLNK(ls.st_mode) else None,'resolved':str(path.resolve(strict=True))}
   if name in known:
    dest=path.resolve(strict=True);st=dest.stat();row.update({'target_dev':st.st_dev,'target_ino':st.st_ino,'target_mode':st.st_mode,'target_uid':st.st_uid,'target_bytes':st.st_size,'target_sha256':hashlib.sha256(bounded_file(dest,1048576)).hexdigest()})
   ipproof['paths'][name]=row
  except FileNotFoundError:ipproof['paths'][name]={'exists':False}
  (proof/'ip-identity.json').write_text(json.dumps(ipproof,indent=2))
 assert len(package_fields)==4 and package_fields[0]=='iproute2' and package_fields[1]=='amd64' and package_fields[3]=='install ok installed','Wrong package identity/state'
 # No alternatives membership and no diversion of any admitted spelling.
 assert altrc==2 and not alt and alterr.decode().strip()=='update-alternatives: error: no alternatives for ip','Alternatives present or unverifiable'
 assert all(not x.strip() for x in diversions.values()),'Diverted ip spelling'
 registered=set(listing.decode().splitlines()) & set(known)
 assert registered and registered <= {'/bin/ip','/sbin/ip','/usr/bin/ip','/usr/sbin/ip'},'No exact registered ip path'
 for name in registered:
  assert owners[name]['rc']==0 and owners[name]['text'].strip()=='iproute2: '+name,'Exact registered path owner mismatch'
 # Explicit parent aliases only; root-owned, no writable directories or unexpected redirects.
 for name in ['/bin','/sbin','/usr','/usr/bin','/usr/sbin']:
  row=ipproof['paths'][name];assert row['exists'] and row['uid']==0
  if row['symlink']:
   assert name in ['/bin','/sbin'] and row['resolved']=='/usr'+name,'Unexpected parent alias'
  else:assert stat.S_ISDIR(row['lstat_mode']) and row['lstat_mode']&0o022==0
 identities=set();existing=[]
 for name in known:
  row=ipproof['paths'][name]
  if not row['exists']:
   assert name not in registered;continue
  existing.append(name)
  assert row['resolved']=='/usr/bin/ip','Unexpected ip target'
  assert row['uid']==0 and row['target_uid']==0 and stat.S_ISREG(row['target_mode']) and row['target_mode']&0o022==0
  if row['symlink']:assert name in ['/sbin/ip','/usr/sbin/ip'] and row['link'] in ['../bin/ip','/bin/ip','/usr/bin/ip'],'Unexpected ip symlink'
  identities.add((row['target_dev'],row['target_ino'],row['target_bytes'],row['target_sha256']))
  if name not in registered:assert owners[name]['rc']==1 and not owners[name]['text'],'Unregistered alias has competing owner'
 # Ensure the exact PATH used by launcher resolves this admitted target, not a shadow binary.
 found=shutil.which('ip',path=os.environ['PATH']);assert found and pathlib.Path(found).resolve(strict=True)==pathlib.Path('/usr/bin/ip'),'PATH ip differs from verified target'
 for name,row in ipproof['paths'].items():
  path=pathlib.Path(name)
  if not row['exists']:assert not path.exists() and not path.is_symlink();continue
  now=path.lstat();assert (now.st_dev,now.st_ino,now.st_mode,now.st_uid,now.st_gid)==(row['dev'],row['ino'],row['lstat_mode'],row['uid'],row['gid']) and str(path.resolve(strict=True))==row['resolved'],'Alias changed during verification'
  if name in known:
   now=path.stat();assert (now.st_dev,now.st_ino,now.st_mode,now.st_uid,now.st_size)==(row['target_dev'],row['target_ino'],row['target_mode'],row['target_uid'],row['target_bytes']) and hashlib.sha256(bounded_file(path.resolve(strict=True),1048576)).hexdigest()==row['target_sha256'],'Executable changed'
 assert len(identities)==1 and existing and all(ipproof['paths'][n]['exists'] for n in registered),'No unique physical registered executable'
 ipproof.update({'status':'VERIFIED_EXACT_PACKAGE_AND_PHYSICAL_ALIAS','registered':sorted(registered),'selected':'/usr/bin/ip','package_fields':package_fields});(proof/'ip-identity.json').write_text(json.dumps(ipproof,indent=2));record['iproute2']=ipproof
 # OS/version/userns capability is tested by the real launcher, never inferred from version.
 assert not active and not sticky_unsafe and not interrupted,'Unsafe helper state blocks admission'
 publish_helpers('all helpers safe before completion')
 record['binary']={'path':str(binary),'bytes':binary.stat().st_size,'sha256':hashlib.sha256(binary.read_bytes()).hexdigest()};record['status']='VERIFIED_STAGED_NOT_RUNTIME_PASS';(proof/'result.json').write_text(json.dumps(record,indent=2))
 with open(os.environ['GITHUB_ENV'],'a') as f:f.write('STAGED_BWRAP='+str(binary)+'\n')
except BaseException as exc:
 record['status']='FAIL_SETUP_STOP';record['error']={'name':type(exc).__name__,'message':str(exc)};(proof/'result.json').write_text(json.dumps(record,indent=2));raise
