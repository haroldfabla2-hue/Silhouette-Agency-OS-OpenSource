"""REVIEW ONLY. Nonroot exact-byte install, NO hooks/build/native import."""
from pathlib import Path
import json,hashlib,base64,tarfile,io,stat
PREBUILT_SHA='42451490221883f4edb84fc3453a2fce9b7489ce655192cd5531b5955a8faa4b'
MEMBERS_SHA='93cb8919b411b5279334ee9b1cd6d6a4a8d64074af421d1ee7662655bf733019'
ADDON_SHA='10fede42d3f9c81930258a9e6690c36a7be6ad09cd8438245c719b2e1a9d6f56'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def prepare_native_prerequisite(here,deps,candidate,emit):
 here=Path(here);deps=Path(deps);candidate=Path(candidate)
 lock=json.loads((candidate/'package-lock.json').read_text());proof=[]
 def require(condition,code):
  if not condition:raise AssertionError('NATIVE_PREREQUISITE:'+code)
 def progress(stage,**facts):
  emit('native-prerequisite-progress.json',{'stage':stage,**facts,'nativeImportExecuted':False})
 manifest_path=here/'native-provenance/exact-registry-members.json'
 progress('before-exact-members-manifest',expectedSha256=MEMBERS_SHA)
 manifest_raw=manifest_path.read_bytes();require(sha(manifest_raw)==MEMBERS_SHA,'MEMBERS_MANIFEST_SHA')
 fixed=json.loads(manifest_raw);require(fixed['schema']==1 and len(fixed['packages'])==3,'MEMBERS_MANIFEST_SCHEMA')
 require([x['package']for x in fixed['packages']]==['better-sqlite3','bindings','file-uri-to-path'],'PACKAGE_ORDER')
 for pinned in fixed['packages']:
  name=pinned['package'];row=lock['packages']['node_modules/'+name]
  progress('before-registry-archive',package=name,version=row['version'],expectedArchiveBytes=pinned['archiveBytes'],expectedArchiveSha256=pinned['archiveSha256'])
  require(row['version']==pinned['version']and row['integrity']==pinned['SRI'],'LOCK_ROW:'+name)
  archive=here/'native-provenance'/(name+'-'+row['version']+'.tgz');raw=archive.read_bytes()
  require(len(raw)==pinned['archiveBytes']and len(raw)<=4*1024**2 and sha(raw)==pinned['archiveSha256'],'ARCHIVE_BYTES:'+name)
  alg,sri=row['integrity'].split('-',1);require(hashlib.new(alg,raw).digest()==base64.b64decode(sri),'ARCHIVE_SRI:'+name)
  expected={};seen=set();total=0
  with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz')as package:
   members=package.getmembers();require(len(members)==len(pinned['members']),'MEMBER_COUNT:'+name)
   for m,approved in zip(members,pinned['members']):
    progress('before-registry-member',package=name,member=m.name,actualBytes=m.size,expectedMember=approved)
    rel=Path(m.name);require(bool(rel.parts)and rel.parts[0]=='package'and not rel.is_absolute()and '..'not in rel.parts,'MEMBER_PATH:'+name)
    require(m.name not in seen,'DUPLICATE_MEMBER:'+name);seen.add(m.name)
    require(m.name==approved['name']and m.size==approved['bytes'],'EXACT_MEMBER_NAME_SIZE:'+name)
    require((m.isdir()and approved['kind']=='directory')or(m.isfile()and approved['kind']=='file'),'EXACT_MEMBER_TYPE:'+name)
    total+=m.size;require(total<=16*1024**2,'TOTAL_UNPACKED_CAP:'+name)
    if m.isdir():continue
    content=package.extractfile(m).read(approved['bytes']+1)
    require(len(content)==approved['bytes']and sha(content)==approved['sha256'],'MEMBER_BYTES:'+name)
    name_in_package=str(Path(*rel.parts[1:]));require(name_in_package not in expected,'DUPLICATE_RELATIVE_MEMBER:'+name)
    expected[name_in_package]=content
  require(total==pinned['totalBytes'],'EXACT_TOTAL:'+name)
  root=deps/name;actual={str(p.relative_to(root)):p for p in root.rglob('*')if p.is_file()or p.is_symlink()}
  progress('before-installed-closure-comparison',package=name,missing=sorted(set(expected)-set(actual)),extra=sorted(set(actual)-set(expected)),expectedFiles=len(expected))
  require(set(actual)==set(expected),'INSTALLED_FILE_SET:'+name)
  for rel,content in expected.items():
   progress('before-installed-file-comparison',package=name,member=rel,actualIsSymlink=actual[rel].is_symlink(),expectedBytes=len(content))
   require(not actual[rel].is_symlink()and actual[rel].read_bytes()==content,'INSTALLED_BYTES:'+name+':'+rel)
  proof.append({'package':name,'version':row['version'],'registryURL':row['resolved'],'SRI':row['integrity'],'archiveSha256':sha(raw),'verifiedFiles':len(expected),'totalUnpackedBytes':total})
  emit('native-prerequisite-'+name+'-verified.json',proof[-1])
 progress('before-pinned-prebuilt',expectedArchiveBytes=1075875,expectedArchiveSha256=PREBUILT_SHA)
 prebuilt=(here/'native-provenance/better-sqlite3-v12.5.0-node-v127-linux-x64.tar.gz').read_bytes();require(len(prebuilt)==1075875 and sha(prebuilt)==PREBUILT_SHA,'PREBUILT_ARCHIVE_BYTES')
 with tarfile.open(fileobj=io.BytesIO(prebuilt),mode='r:gz')as package:
  members=package.getmembers();progress('before-prebuilt-members',members=[{'name':m.name,'bytes':m.size,'regular':m.isfile()}for m in members]);require(len(members)==1,'PREBUILT_MEMBER_COUNT')
  m=members[0];require(m.name=='build/Release/better_sqlite3.node'and m.isfile()and m.size==2091392,'PREBUILT_MEMBER_SHAPE')
  binary=package.extractfile(m).read()
 progress('before-addon-static-bytes',actualBytes=len(binary),actualSha256=sha(binary))
 require(sha(binary)==ADDON_SHA and binary[:6]==b'\x7fELF\x02\x01'and int.from_bytes(binary[18:20],'little')==62,'ADDON_BYTES_ELF')
 target=deps/'better-sqlite3/build/Release/better_sqlite3.node'
 progress('before-native-target-creation',targetExists=target.exists(),targetIsSymlink=target.is_symlink())
 require(not target.exists()and not target.is_symlink(),'TARGET_ALREADY_EXISTS')
 target.parent.mkdir(parents=True,exist_ok=True)
 for p in [target.parent,target.parent.parent]:
  progress('before-native-target-parent',component=p.name,isDirectory=p.is_dir(),isSymlink=p.is_symlink())
  require(p.is_dir()and not p.is_symlink(),'TARGET_PARENT_SHAPE')
 with target.open('xb')as destination:destination.write(binary)
 target.chmod(0o600)
 progress('before-native-target-postimage',actualBytes=target.stat().st_size,actualSha256=sha(target.read_bytes()),mode=oct(target.stat().st_mode&0o777))
 require(sha(target.read_bytes())==ADDON_SHA,'TARGET_POSTIMAGE')
 manifest={'typescriptEvaluationClosure':[{'path':'services/auth/accountStore.ts','sha256':'47cd70337a131c2784ba5281e59516406685bf18e343a9c552ae4226991823a5'}],'nativeAddonSha256':ADDON_SHA,'nativeArchiveSha256':PREBUILT_SHA,'expectedNode':'v22.18.0','expectedABI':'127','scenario':'account-wal','nativeImportExecuted':False,'approvedOriginalCloseObservation':'SAME actual AccountStore.db open false after SAME store.close sync return'}
 emit('native-prerequisite.json',{'packages':proof,'prebuilt':manifest,'installHooksExecuted':False,'buildFallback':False,'loadNotYetVerified':True})
 return manifest
