"""REVIEW ONLY. Nonroot exact-byte install, NO hooks/build/native import."""
from pathlib import Path
import json,hashlib,base64,tarfile,io,stat
PREBUILT_SHA='42451490221883f4edb84fc3453a2fce9b7489ce655192cd5531b5955a8faa4b'
ADDON_SHA='10fede42d3f9c81930258a9e6690c36a7be6ad09cd8438245c719b2e1a9d6f56'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def prepare_native_prerequisite(here,deps,candidate,emit):
 here=Path(here);deps=Path(deps);candidate=Path(candidate)
 lock=json.loads((candidate/'package-lock.json').read_text());proof=[]
 for name in ['better-sqlite3','bindings','file-uri-to-path']:
  row=lock['packages']['node_modules/'+name];archive=here/'native-provenance'/(name+'-'+row['version']+'.tgz');raw=archive.read_bytes();assert len(raw)<=4*1024**2
  alg,sri=row['integrity'].split('-',1);assert hashlib.new(alg,raw).digest()==base64.b64decode(sri)
  expected={}
  with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz')as package:
   for m in package.getmembers():
    rel=Path(m.name);assert rel.parts[0]=='package'and not rel.is_absolute()and '..'not in rel.parts
    if m.isdir():continue
    assert m.isfile()and m.size<=4*1024**2
    name_in_package=str(Path(*rel.parts[1:]));assert name_in_package not in expected
    expected[name_in_package]=package.extractfile(m).read()
  assert sum(map(len,expected.values()))<=16*1024**2
  root=deps/name;actual={str(p.relative_to(root)):p for p in root.rglob('*')if p.is_file()or p.is_symlink()}
  assert set(actual)==set(expected),'unexpected native JS closure bytes before approved binary install'
  for rel,content in expected.items():assert not actual[rel].is_symlink()and actual[rel].read_bytes()==content
  proof.append({'package':name,'version':row['version'],'registryURL':row['resolved'],'SRI':row['integrity'],'archiveSha256':sha(raw),'verifiedFiles':len(expected)})
 prebuilt=(here/'native-provenance/better-sqlite3-v12.5.0-node-v127-linux-x64.tar.gz').read_bytes();assert len(prebuilt)==1075875 and sha(prebuilt)==PREBUILT_SHA
 with tarfile.open(fileobj=io.BytesIO(prebuilt),mode='r:gz')as package:
  members=package.getmembers();assert len(members)==1
  m=members[0];assert m.name=='build/Release/better_sqlite3.node'and m.isfile()and m.size==2091392
  binary=package.extractfile(m).read()
 assert sha(binary)==ADDON_SHA and binary[:6]==b'\x7fELF\x02\x01'and int.from_bytes(binary[18:20],'little')==62
 target=deps/'better-sqlite3/build/Release/better_sqlite3.node';assert not target.exists()
 target.parent.mkdir(parents=True,exist_ok=True)
 for p in [target.parent,target.parent.parent]:assert p.is_dir()and not p.is_symlink()
 with target.open('xb')as destination:destination.write(binary)
 target.chmod(0o600);assert sha(target.read_bytes())==ADDON_SHA
 manifest={'typescriptEvaluationClosure':[{'path':'services/auth/accountStore.ts','sha256':'47cd70337a131c2784ba5281e59516406685bf18e343a9c552ae4226991823a5'}],'nativeAddonSha256':ADDON_SHA,'nativeArchiveSha256':PREBUILT_SHA,'expectedNode':'v22.18.0','expectedABI':'127','scenario':'account-wal','nativeImportExecuted':False,'approvedOriginalCloseObservation':'SAME actual AccountStore.db open false after SAME store.close sync return'}
 emit('native-prerequisite.json',{'packages':proof,'prebuilt':manifest,'installHooksExecuted':False,'buildFallback':False,'loadNotYetVerified':True})
 return manifest
