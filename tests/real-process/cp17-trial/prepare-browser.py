#!/usr/bin/env python3
"""Pinned browser asset preparation. Source-only proposal, no self-install/fallback."""
import hashlib,json,os,pathlib,re,selectors,stat,struct,subprocess,sys,time,urllib.request,zipfile
root=pathlib.Path('/tmp/work/node_modules/.silhouette-browser-assets')
# /usr is the existing reviewed RO mount; /sbin is deliberately not mounted.
ldconfig=pathlib.Path('/usr/sbin/ldconfig.real')
readelf=pathlib.Path('/usr/bin/readelf')
metadata_elapsed=0.0
metadata_bytes=0
pin=json.loads(pathlib.Path('/tmp/harness/browser-asset-pin.json').read_text())
revision=root/('chromium_headless_shell-'+pin['revision'])
verify=sys.argv[1:]==['--verify-only'];assert not sys.argv[1:]or verify
result={'status':'INCOMPLETE','pin_sha256':hashlib.sha256(pathlib.Path('/tmp/harness/browser-asset-pin.json').read_bytes()).hexdigest(),'mode':'verify-read-only'if verify else'prepare','image':{k:os.environ.get(k)for k in ['ImageOS','ImageVersion']},'os_release_sha256':hashlib.sha256(pathlib.Path('/etc/os-release').read_bytes()).hexdigest(),'libraries':[],'metadata_preflight':{'status':'INCOMPLETE','commands':[],'tools':[],'libraries':[]}}
def digest(path):
 with path.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def regular(path):
 s=path.lstat();assert stat.S_ISREG(s.st_mode)and not path.is_symlink();return s
def command(argv):
 global metadata_bytes,metadata_elapsed
 remaining=20-metadata_elapsed
 assert remaining>0,'metadata aggregate20s command-time budget'
 assert argv[0]in[str(ldconfig),str(readelf)]
 item={'argv':argv,'status':'INCOMPLETE','signals':[]};result['metadata_preflight']['commands'].append(item)
 child=None;sel=selectors.DefaultSelector();parts={};started=time.monotonic()
 try:
  # These fixed ELF tools have no shell wrapper/child task. Preserve any error
  # while owning stdout/stderr and bounded kill/reap before returning.
  child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  for stream in [child.stdout,child.stderr]:
   os.set_blocking(stream.fileno(),False);sel.register(stream,selectors.EVENT_READ);parts[stream.fileno()]=bytearray()
  outfd,errfd=child.stdout.fileno(),child.stderr.fileno()
  while sel.get_map():
   assert time.monotonic()-started<min(3,remaining),'metadata per-command/aggregate deadline'
   for key,_ in sel.select(.02):
    data=os.read(key.fd,65536)
    if not data:sel.unregister(key.fd);continue
    metadata_bytes+=len(data);assert metadata_bytes<=2*1024**2,'metadata aggregate2MiB output cap'
    parts[key.fd].extend(data)
  rc=child.wait(timeout=max(.01,min(3,remaining)-(time.monotonic()-started)))
  stdout,stderr=bytes(parts[outfd]),bytes(parts[errfd])
  item.update({'rc':rc,'stdout_bytes':len(stdout),'stderr_bytes':len(stderr),'stdout_sha256':hashlib.sha256(stdout).hexdigest(),'stderr':stderr[:4096].decode(errors='replace')})
  assert rc==0,'metadata command failed'
  item['status']='PASS';return stdout.decode('utf-8',errors='strict')
 except BaseException as error:
  item.update({'status':'FAIL','error':type(error).__name__+':'+str(error)});raise
 finally:
  if child:
   if child.poll()is None:child.kill();item['signals'].append('SIGKILL_METADATA_TOOL_FAILURE')
   child.wait(timeout=1)
   child.stdout.close();child.stderr.close()
  sel.close();elapsed=time.monotonic()-started;metadata_elapsed+=elapsed;item['seconds']=elapsed
def static_elf64(path):
 # Bootstrap ldconfig.real without trusting a shell wrapper's transitive paths.
 # Only a native x86-64 static ELF with no loader/DT_NEEDED is admitted.
 with path.open('rb')as f:
  header=f.read(64);assert header[:6]==b'\x7fELF\x02\x01'
  values=struct.unpack('<16sHHIQQQIHHHHHH',header);assert values[2]==62
  phoff,phsize,phnum=values[5],values[9],values[10];assert phsize==56 and 0<phnum<=128
  f.seek(phoff);ph=f.read(phsize*phnum);assert len(ph)==phsize*phnum
  for offset in range(0,len(ph),phsize):
   kind,flags,where,virtual,physical,size,mem,align=struct.unpack_from('<IIQQQQQQ',ph,offset)
   assert kind!=3,'ldconfig.real interpreter not supported: no alternate route'
   if kind==2:
    assert size<=64*1024 and size%16==0;f.seek(where);dynamic=f.read(size)
    assert len(dynamic)==size
    assert all(struct.unpack_from('<qQ',dynamic,n)[0]!=1 for n in range(0,len(dynamic),16)),'ldconfig.real dynamic dependency not reviewed'
# Dynamic metadata only: never run the downloaded executable or ldd.
def elf(path):
 with path.open('rb')as f:magic=f.read(4)
 if magic!=b'\x7fELF':return None
 out=command([str(readelf),'-dW',str(path)])
 needs=re.findall(r'\(NEEDED\).*?\[(.*?)\]',out)
 run=re.findall(r'\(RUNPATH\).*?\[(.*?)\]',out);rpath=re.findall(r'\(RPATH\).*?\[(.*?)\]',out)
 assert not rpath,'Legacy RPATH unsupported: block, never approximate loader semantics'
 ph=command([str(readelf),'-lW',str(path)])
 interp=re.findall(r'Requesting program interpreter: ([^\]]+)',ph)
 return needs,run,interp
# Lexical names follow the existing RO mounts. Compare only canonical targets
# to canonical roots, including merged-/usr aliases and lib64 loader paths.
def canonical_roots(names):
 roots=set()
 for name in names:
  path=pathlib.Path(name)
  if not path.exists():continue
  target=path.resolve(strict=True);assert target.is_dir()
  assert bool(os.statvfs(target).f_flag&os.ST_RDONLY),'system metadata root must be RO'
  roots.add(target)
 assert roots,'no reviewed canonical roots';return roots
def checked_path(path,roots,asset=False):
 assert path.is_absolute()and '..'not in path.parts,'noncanonical input path'
 target=path.resolve(strict=True)
 allowed=set(roots)
 if asset:allowed.add(root.resolve(strict=True))
 assert any(target.is_relative_to(base)for base in allowed),'target outside reviewed canonical roots: '+str(target)
 return target
def resolve_graph(roots,lookup,records):
 queue=list(roots);done=set()
 while queue:
  p=checked_path(queue.pop(),tool_roots|library_roots,asset=True)
  if p in done:continue
  done.add(p);assert len(done)<=512;meta=elf(p);assert meta is not None
  needed,run,interp=meta;dirs=[]
  for item in ':'.join(run).split(':')if run else[]:
   item=item.replace('${ORIGIN}',str(p.parent)).replace('$ORIGIN',str(p.parent));assert '$'not in item
   d=checked_path(pathlib.Path(item),library_roots,asset=True);assert d.is_dir();dirs.append(d)
  edges=[]
  for name in needed:
   assert '/'not in name
   candidates=[d/name for d in dirs if(d/name).is_file()]
   if not candidates:candidates=[pathlib.Path(x)for x in lookup.get(name,[])]
   targets={checked_path(x,library_roots,asset=True)for x in candidates}
   assert len(targets)==1,'missing/ambiguous recursive library: '+name
   q=targets.pop();assert q.is_file()
   edges.append({'name':name,'path':str(q)});queue.append(q)
  for value in interp:
   q=checked_path(pathlib.Path(value),library_roots);assert q.is_file();queue.append(q)
  records.append({'path':str(p),'sha256':digest(p),'needed':edges,'interpreter':interp})
try:
 library_roots=canonical_roots(['/usr/lib','/usr/lib64','/lib','/lib64'])
 tool_roots=canonical_roots(['/usr','/bin','/lib','/lib64','/opt'])
 result['metadata_preflight']['canonical_library_roots']=sorted(map(str,library_roots))
 result['metadata_preflight']['canonical_tool_roots']=sorted(map(str,tool_roots))
 # Preserve wrapper/target evidence without executing or inventing an alias.
 for name in ['/usr/sbin/ldconfig','/usr/sbin/ldconfig.real','/usr/bin/readelf',sys.executable]:
  path=pathlib.Path(name);resolved=checked_path(path,tool_roots)
  assert resolved.is_file()and os.access(resolved,os.X_OK)
  with resolved.open('rb')as stream:prefix=stream.read(4096)
  result['metadata_preflight']['tools'].append({'requested':name,'resolved':str(resolved),'sha256':digest(resolved),'bytes':resolved.stat().st_size,'first4096_utf8':prefix.decode(errors='replace')if prefix.startswith(b'#!')else None,'read_only':bool(os.statvfs(resolved).f_flag&os.ST_RDONLY)})
  assert bool(os.statvfs(resolved).f_flag&os.ST_RDONLY),'metadata tools must be read-only'
 assert ldconfig.is_file()and os.access(ldconfig,os.X_OK),'exact reviewed /usr/sbin/ldconfig.real unavailable; block without fallback'
 for tool in [readelf,pathlib.Path(sys.executable)]:
  with tool.open('rb')as stream:assert stream.read(6)==b'\x7fELF\x02\x01','metadata tool is not reviewed native ELF64'
 static_elf64(ldconfig)
 cache=command([str(ldconfig),'-p']);result['loader_cache_sha256']=hashlib.sha256(cache.encode()).hexdigest();lookup={}
 for name,abi,path in re.findall(r'^\s*(\S+)\s+\(([^)]+)\)\s+=>\s+(\S+)',cache,re.M):
  if 'x86-64'in abi:lookup.setdefault(name,[]).append(path)
 # Real, bounded metadata operations before download validate the entire
 # toolchain under the innermost actual mounts, not host executable metadata.
 resolve_graph([ldconfig,readelf,pathlib.Path(sys.executable)],lookup,result['metadata_preflight']['libraries'])
 result['metadata_preflight']['status']='PASS_TOOL_OPERATIONS_AND_RECURSIVE_GRAPH'

 package=json.loads(pathlib.Path('/tmp/work/node_modules/playwright-core/package.json').read_text())
 browsers=json.loads(pathlib.Path('/tmp/work/node_modules/playwright-core/browsers.json').read_text())
 target=next(x for x in browsers['browsers']if x['name']=='chromium-headless-shell')
 assert package['version']==pin['playwright_version']and target['revision']==pin['revision']and target['browserVersion']==pin['browser_version'],'asset differs from actual locked Playwright'
 assert root.is_dir()and not root.is_symlink()
 assert os.statvfs(root).f_blocks*os.statvfs(root).f_frsize<=4*1024**3
 if not verify:
  assert not list(root.iterdir()),'never overwrite existing asset'
  archive=root/'download.zip';request=urllib.request.Request(pin['url'],headers={'User-Agent':'Silhouette-reviewed-validation/1'})
  with urllib.request.urlopen(request,timeout=10)as response,archive.open('xb')as f:
   assert response.status==200 and response.url==pin['final_url'],'unreviewed redirect'
   result['download']={'requested':pin['url'],'final':response.url};size=0
   while b:=response.read(1024*1024):
    size+=len(b);assert size<=pin['archive_bytes'];f.write(b)
  assert size==pin['archive_bytes']and digest(archive)==pin['archive_sha256']
  revision.mkdir(mode=0o755)
  with zipfile.ZipFile(archive)as z:
   info=z.infolist();assert len(info)==len({i.filename for i in info}),'duplicate ZIP path'
   rows={r['path']:r for r in pin['files']};actual={i.filename:i for i in info if not i.is_dir()}
   assert set(actual)==set(rows),'extra/missing archive members'
   for i in info:
    p=pathlib.PurePosixPath(i.filename)
    assert not p.is_absolute()and '..'not in p.parts and str(p)==i.filename.rstrip('/')and '\\'not in i.filename
    m=i.external_attr>>16;assert stat.S_IFMT(m)in(0,stat.S_IFREG,stat.S_IFDIR)and not m&0o6000
    if i.is_dir():assert any(x.startswith(i.filename)for x in rows);continue
    expected=rows[i.filename];assert i.file_size==expected['bytes']and i.file_size<=256*1024**2
    dest=revision/p;dest.parent.mkdir(parents=True,exist_ok=True)
    with z.open(i)as source,dest.open('xb')as target:
     count=0;h=hashlib.sha256()
     while b:=source.read(1024*1024):
      count+=len(b);assert count<=expected['bytes'];h.update(b);target.write(b)
    assert count==expected['bytes']and h.hexdigest()==expected['sha256'];dest.chmod(expected['mode'])
  archive.unlink()
 else:assert bool(os.statvfs(root).f_flag&os.ST_RDONLY),'asset must be RO during runtime validation'
 assert set(p.name for p in root.iterdir())=={revision.name},'extra asset root entry'
 expected={r['path']:r for r in pin['files']};seen={}
 for p in revision.rglob('*'):
  assert not p.is_symlink()
  if p.is_dir():continue
  rel=p.relative_to(revision).as_posix();assert rel in expected
  s=regular(p);r=expected[rel];assert s.st_size==r['bytes']and s.st_mode&0o777==r['mode']and digest(p)==r['sha256'];seen[rel]=r
 assert set(seen)==set(expected)and sum(x['bytes']for x in seen.values())==pin['unpacked_bytes']
 # Read the loader cache and resolve every downloaded ELF and its recursive
 # DT_NEEDED graph inside this exact image. Missing/unsupported paths block.
 resolve_graph([p for p in revision.rglob('*')if p.is_file()and elf(p)is not None],lookup,result['libraries'])
 executable=revision/'chrome-headless-shell-linux64/chrome-headless-shell';assert executable.is_file()and os.access(executable,os.X_OK)
 result.update({'status':'PASS_METADATA_ONLY_NOT_BROWSER_LAUNCH','member_count':len(seen),'member_inventory':list(seen.values()),'expanded_bytes':pin['unpacked_bytes'],'executable':str(executable),'read_only':verify,'no_ldd_no_apt_no_binary_execution':True})
finally:
 ev=pathlib.Path('/tmp/evidence')
 if verify:
  target=ev/'test-preparation-inputs.json';prior=json.loads(target.read_text());prior['browser_asset']=result;target.write_text(json.dumps(prior,indent=2))
 else:(ev/'browser-preparation.json').write_text(json.dumps(result,indent=2))
print(json.dumps({'status':result['status'],'members':len(pin['files']),'recursive_elfs':len(result['libraries'])}))
