#!/usr/bin/env python3
"""Pinned browser asset preparation. Source-only proposal, no self-install/fallback."""
import hashlib,json,os,pathlib,re,stat,subprocess,sys,time,urllib.request,zipfile
root=pathlib.Path('/tmp/work/node_modules/.silhouette-browser-assets')
pin=json.loads(pathlib.Path('/tmp/harness/browser-asset-pin.json').read_text())
revision=root/('chromium_headless_shell-'+pin['revision'])
verify=sys.argv[1:]==['--verify-only'];assert not sys.argv[1:]or verify
result={'status':'INCOMPLETE','pin_sha256':hashlib.sha256(pathlib.Path('/tmp/harness/browser-asset-pin.json').read_bytes()).hexdigest(),'mode':'verify-read-only'if verify else'prepare','image':{k:os.environ.get(k)for k in ['ImageOS','ImageVersion']},'os_release_sha256':hashlib.sha256(pathlib.Path('/etc/os-release').read_bytes()).hexdigest(),'libraries':[]}
def digest(path):
 with path.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def regular(path):
 s=path.lstat();assert stat.S_ISREG(s.st_mode)and not path.is_symlink();return s
# Dynamic metadata only: never run the downloaded executable or ldd.
def elf(path):
 with path.open('rb')as f:magic=f.read(4)
 if magic!=b'\x7fELF':return None
 out=subprocess.check_output(['/usr/bin/readelf','-dW',str(path)],text=True,timeout=3)
 needs=re.findall(r'\(NEEDED\).*?\[(.*?)\]',out)
 run=re.findall(r'\(RUNPATH\).*?\[(.*?)\]',out);rpath=re.findall(r'\(RPATH\).*?\[(.*?)\]',out)
 assert not rpath,'Legacy RPATH unsupported: block, never approximate loader semantics'
 ph=subprocess.check_output(['/usr/bin/readelf','-lW',str(path)],text=True,timeout=3)
 interp=re.findall(r'Requesting program interpreter: ([^\]]+)',ph)
 return needs,run,interp
try:
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
 cache=subprocess.check_output(['/sbin/ldconfig','-p'],text=True,timeout=3);result['loader_cache_sha256']=hashlib.sha256(cache.encode()).hexdigest();lookup={}
 for name,abi,path in re.findall(r'^\s*(\S+)\s+\(([^)]+)\)\s+=>\s+(\S+)',cache,re.M):
  if 'x86-64'in abi:lookup.setdefault(name,[]).append(path)
 queue=[p for p in revision.rglob('*')if p.is_file()and elf(p)is not None];done=set()
 while queue:
  p=queue.pop().resolve(strict=True)
  if p in done:continue
  done.add(p);assert len(done)<=512;meta=elf(p);assert meta is not None
  needed,run,interp=meta;dirs=[]
  for item in ':'.join(run).split(':')if run else[]:
   item=item.replace('${ORIGIN}',str(p.parent)).replace('$ORIGIN',str(p.parent));assert '$'not in item
   d=pathlib.Path(item);assert d.is_absolute();d=d.resolve(strict=True)
   assert d.is_relative_to(root)or d.is_relative_to('/usr/lib')or d.is_relative_to('/lib');dirs.append(d)
  edges=[]
  for name in needed:
   assert '/'not in name
   candidates=[d/name for d in dirs if(d/name).is_file()]
   if not candidates:candidates=[pathlib.Path(x)for x in lookup.get(name,[])]
   targets={x.resolve(strict=True)for x in candidates}
   assert len(targets)==1,'missing/ambiguous recursive library: '+name
   q=targets.pop();assert q.is_relative_to(root)or q.is_relative_to('/usr/lib')or q.is_relative_to('/lib')
   edges.append({'name':name,'path':str(q)});queue.append(q)
  for value in interp:
   q=pathlib.Path(value).resolve(strict=True);assert q.is_file()and(q.is_relative_to('/usr/lib')or q.is_relative_to('/lib'));queue.append(q)
  result['libraries'].append({'path':str(p),'sha256':digest(p),'needed':edges,'interpreter':interp})
 executable=revision/'chrome-headless-shell-linux64/chrome-headless-shell';assert executable.is_file()and os.access(executable,os.X_OK)
 result.update({'status':'PASS_METADATA_ONLY_NOT_BROWSER_LAUNCH','member_count':len(seen),'member_inventory':list(seen.values()),'expanded_bytes':pin['unpacked_bytes'],'executable':str(executable),'read_only':verify,'no_ldd_no_apt_no_binary_execution':True})
finally:
 ev=pathlib.Path('/tmp/evidence')
 if verify:
  target=ev/'test-preparation-inputs.json';prior=json.loads(target.read_text());prior['browser_asset']=result;target.write_text(json.dumps(prior,indent=2))
 else:(ev/'browser-preparation.json').write_text(json.dumps(result,indent=2))
print(json.dumps({'status':result['status'],'members':len(pin['files']),'recursive_elfs':len(result['libraries'])}))
