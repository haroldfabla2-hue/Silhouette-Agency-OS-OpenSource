"""Static readelf-only closure. No ldd, package import or native execution.
Limited resolver: explicit per-file reviewed package RPATH/RUNPATH and exact
vendor edges, otherwise x64 system cache. Unsupported search paths fail closed.
This does NOT claim universal dynamic-loader emulation or successful loading.
"""
import pathlib,hashlib,subprocess,re,os

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def tags(text,tag):return re.findall(r'\('+tag+r'\).*\[(.*?)\]',text)
def safe_app(p,app):
 assert app in p.parents,'ELF_PATH_ESCAPE'
 for q in [p,*p.parents]:
  if q==app:break
  assert not q.is_symlink(),'ELF_PATH_SYMLINK'

def search_dirs(p,app,dynamic,pins):
 paths={tag:tags(dynamic,tag) for tag in ['RPATH','RUNPATH']}
 # RPATH inheritance is not guessed. All reviewed package DSOs resolve
 # their own edges here; a child needing inherited paths fails closed.
 if app not in p.parents:
  assert not any(paths.values()),'UNSUPPORTED_SYSTEM_SEARCH_PATH_'+str(p)
  return [],paths
 rel=str(p.relative_to(app));expected=pins['reviewedRpaths'].get(rel,{'RPATH':[],'RUNPATH':[]})
 assert paths==expected,'UNREVIEWED_ELF_SEARCH_PATH_'+rel
 assert not(paths['RPATH'] and paths['RUNPATH']),'ELF_MIXED_SEARCH_TAGS'
 out=[]
 for entry in paths['RUNPATH'] or paths['RPATH']:
  for raw in entry.split(':'):
   assert raw=='$ORIGIN' or raw.startswith('$ORIGIN/'),'ELF_UNSUPPORTED_PATH_TOKEN'
   tail=raw[len('$ORIGIN'):];assert '$' not in tail,'ELF_UNSUPPORTED_PATH_TOKEN'
   q=pathlib.Path(os.path.normpath(str(p.parent)+tail))
   safe_app(q/'placeholder',app)
   out.append(q)
 return out,paths

def scan(app,initial,runtime,lookup,pins,review_sources,origin):
 queue=sorted(set(initial),key=str);scanned=set();missing=[];review=[];edges=[]
 vendor={x['path']:x for x in pins['vendorElf']}
 required={(x['owner'],x['needed']):x['path'] for x in pins['vendorElf']}
 while queue:
  p=queue.pop(0)
  if p in scanned:continue
  scanned.add(p)
  with p.open('rb') as f:magic=f.read(4)
  if magic!=b'\x7fELF':continue
  dynamic=subprocess.check_output(['readelf','-d',str(p)],text=True)
  program=subprocess.check_output(['readelf','-l',str(p)],text=True)
  header=subprocess.check_output(['readelf','-h',str(p)],text=True)
  needed=sorted(tags(dynamic,'NEEDED'))
  interpreters=re.findall(r'Requesting program interpreter: (.*?)\]',program)
  rel=str(p.relative_to(app)) if app in p.parents else None
  source='app/'+rel if rel else 'runtime/'+str(p).lstrip('/')
  info={'file':source,'sha256':digest(p),'bytes':p.stat().st_size,'needed':needed,'interpreters':interpreters,'origin':origin(p),'machine':next((l.split(':',1)[1].strip() for l in header.splitlines() if l.strip().startswith('Machine:')),None),'class':next((l.split(':',1)[1].strip() for l in header.splitlines() if l.strip().startswith('Class:')),None)}
  if source in review_sources:
   assert digest(p)==pins['files'][rel],'NATIVE_REVIEW_PIN'
   review.append(info);continue
  assert info['machine']=='Advanced Micro Devices X86-64' and info['class']=='ELF64','SELECTED_ELF_ARCH_'+source
  dirs,paths=search_dirs(p,app,dynamic,pins)
  missing_names=[]
  for soname in needed:
   assert '/' not in soname and '$' not in soname,'UNSUPPORTED_NEEDED_PATH'
   candidates=[d/soname for d in dirs];q=None;precedence=None
   expected=required.get((rel,soname))
   if expected:
    q=app/expected
    # A known vendor edge may NEVER fall back to a same-name system DSO.
    assert q in candidates,'VENDOR_RPATH_MISMATCH'
    assert q.is_file(),'VENDOR_MISSING_'+expected
    safe_app(q,app);assert digest(q)==pins['files'][expected],'VENDOR_HASH_DRIFT_'+expected
    assert next((x for x in candidates if x.exists()),None)==q,'VENDOR_SHADOWED'
    precedence='reviewed-relative-vendor'
   else:
    existing=next((x for x in candidates if x.exists()),None)
    if existing:
     safe_app(existing,app);r=str(existing.relative_to(app))
     assert r in vendor,'UNPINNED_VENDOR_DSO_'+r
     assert digest(existing)==pins['files'][r],'VENDOR_HASH_DRIFT_'+r
     q=existing;precedence='reviewed-relative-vendor'
    else:
     options=lookup.get(soname)
     if isinstance(options,(set,list,tuple)):
      detail=source+'_'+soname+'_'+','.join(str(x) for x in sorted(options,key=str))
      assert all(str(x).startswith(('/lib/','/lib64/','/usr/lib/','/usr/lib64/')) for x in options),'SYSTEM_CACHE_ESCAPE_'+detail+'_policy=/lib/,/lib64/,/usr/lib/,/usr/lib64/'
      assert len({x.resolve() for x in options})<=1,'AMBIGUOUS_SYSTEM_CACHE_'+detail
      q=sorted(options,key=str)[0] if options else None
     else:q=options
     precedence='x64-system-cache'
   if q is None:missing_names.append(soname);continue
   # Bind the same system path consulted, not its realpath under a different
   # mount target. Hashes prove bytes; no current host path is runtime proof.
   if app not in q.parents:
    assert str(q).startswith(('/lib/','/lib64/','/usr/lib/','/usr/lib64/')),'SYSTEM_CACHE_ESCAPE_'+source+'_'+soname+'_'+str(q)
    runtime.add(q)
   edges.append({'from':source,'needed':soname,'resolved':('app/'+str(q.relative_to(app))) if app in q.parents else 'runtime/'+str(q).lstrip('/'),'sha256':digest(q),'searchTags':paths,'precedence':precedence})
   if q not in scanned:queue.append(q)
  if missing_names:missing.append({**info,'missingSonames':missing_names})
  for interp in interpreters:
   assert interp=='/lib64/ld-linux-x86-64.so.2','UNSUPPORTED_INTERPRETER'
   q=pathlib.Path(interp)
   if not q.is_file():missing.append({**info,'missingInterpreter':interp});continue
   runtime.add(q)
   edges.append({'from':source,'interpreter':interp,'resolved':'runtime/'+str(q).lstrip('/'),'sha256':digest(q),'precedence':'PT_INTERP-exact'})
   if q not in scanned:queue.append(q)
  queue.sort(key=str)
 return missing,review,edges
