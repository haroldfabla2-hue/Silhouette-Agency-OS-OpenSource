"""Exact cache/lock/install byte closure, no download/install/import of product."""
from pathlib import Path
import hashlib,base64,json,tarfile,io,stat
MANIFEST_SHA='1f7842f88c315676e2a06bbc2971b3ec9c5f77ae9ece91db07bd976e692678bf'
def require(ok,code):
 if not ok:raise AssertionError('NATIVE_PREREQUISITE:BODY_HELPER_'+code)
def prepare_body_helper_prerequisite(here,deps,candidate,cache,emit):
 here=Path(here);deps=Path(deps);candidate=Path(candidate);cache=Path(cache)
 raw=(here/'body-helper-dependencies.json').read_bytes();require(hashlib.sha256(raw).hexdigest()==MANIFEST_SHA,'MANIFEST_SHA');fixed=json.loads(raw)
 lockraw=(candidate/'package-lock.json').read_bytes();require(hashlib.sha256(lockraw).hexdigest()==fixed['lockSha256'],'LOCK_SHA');lock=json.loads(lockraw)['packages'];proof=[]
 require(len(fixed['packages'])==1 and sum(len(p['files'])for p in fixed['packages'])==176,'PACKAGE_FILE_COUNTS')
 for package in fixed['packages']:
  key=package['path'];rel=Path(key);require(not rel.is_absolute()and'..'not in rel.parts and rel.parts[0]=='node_modules','PACKAGE_PATH')
  emit('body-helper-prerequisite-progress.json',{'package':key,'stage':'before-cache-lock-install-verify'})
  row=lock[key];require(row['version']==package['version']and row['resolved']==package['url']and row['integrity']==package['SRI'],'LOCK_ROW')
  alg,sri=row['integrity'].split('-',1);digest=base64.b64decode(sri);h=digest.hex();cached=cache/'_cacache/content-v2'/alg/h[:2]/h[2:4]/h[4:]
  require(cached.is_file()and not cached.is_symlink(),'CACHE_ARCHIVE_REQUIRED_NO_NETWORK_FALLBACK')
  data=cached.read_bytes();require(len(data)==package['archiveBytes']and len(data)<=4*1024**2 and hashlib.new(alg,data).digest()==digest and hashlib.sha256(data).hexdigest()==package['archiveSha256'],'ARCHIVE_SRI_BYTES')
  expected={x['path']:x for x in package['files']};seen=set();total=0
  with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz')as t:
   members=t.getmembers();require(len(members)<=1024,'ARCHIVE_MEMBER_CAP')
   for member in members:
    p=Path(member.name);require(not p.is_absolute()and'..'not in p.parts and p.parts[0]=='package','MEMBER_PATH')
    if member.isdir():continue
    require(member.isfile(),'REGULAR_MEMBER');name=str(Path(*p.parts[1:]));require(name in expected and name not in seen,'MEMBER_EXACT_SET');seen.add(name)
    item=expected[name];total+=member.size;require(total<=16*1024**2 and member.size==item['bytes'],'MEMBER_SIZE')
    content=t.extractfile(member).read(member.size+1);require(len(content)==member.size and hashlib.sha256(content).hexdigest()==item['sha256'],'MEMBER_HASH')
  require(seen==set(expected),'MEMBER_MISSING');root=candidate/key
  # candidate node_modules is the one expected controller-owned symlink to deps.
  require((candidate/'node_modules').is_symlink()and(candidate/'node_modules').resolve()==deps.resolve(),'DEPENDENCY_ROOT_LINK')
  require(root.is_dir()and not root.is_symlink(),'PACKAGE_ROOT_SHAPE')
  for parent in root.relative_to(candidate/'node_modules').parents:
   if str(parent)!='.':require(not(candidate/'node_modules'/parent).is_symlink(),'PACKAGE_ANCESTOR_SYMLINK')
  actual={str(p.relative_to(root)):p for p in root.rglob('*')if(p.is_file()or p.is_symlink())and'node_modules'not in p.relative_to(root).parts}
  require(set(actual)==set(expected),'INSTALLED_EXACT_FILES')
  for name,p in actual.items():
   item=expected[name];require(p.is_file()and not p.is_symlink()and p.stat().st_size==item['bytes']and hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256'],'INSTALLED_BYTES')
  proof.append({'path':key,'version':row['version'],'files':len(expected),'SRI':row['integrity'],'archiveSha256':package['archiveSha256']})
 for item in fixed['typescriptEvaluationClosure']:
  p=candidate/item['path'];require(p.is_file()and not p.is_symlink()and hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256'],'TS_POSTIMAGE')
 require(len(fixed['typescriptEvaluationClosure'])==1 and len(fixed['moduleEvaluationAllowlist'])==96,'EVALUATION_COUNTS')
 require(fixed['scope']=='A_HELPER_REAL_HTTP_UDS_ONLY'and fixed['noNativeAddonAcquisition']is True,'SCOPE')
 manifest=dict(fixed);manifest['harness']=str(Path(here).resolve())
 emit('body-helper-dependency-integrity.json',{'lockSha256':fixed['lockSha256'],'packages':proof,'verifiedFiles':176,'totalModuleAllowlist':96,'typescriptFiles':1,'newDownload':False,'hooks':False,'build':False,'nativeAddon':False,'evaluationNotYetStarted':True})
 return manifest
