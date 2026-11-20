"""Verify an externally anchored ZIP fully before extracting regular files.
No package, native addon, launcher or product is evaluated. Consistency and
transport integrity do not authorize execution or replace source review.
"""
import hashlib,json,pathlib,stat,zipfile,os,argparse,runpy
ROOT='hydration-gates-capsule-review/'
EXPECTED='tests/hydration-gates-capsule/EXPECTED-DIGESTS.json'
META={'ALLOWLIST.json','EMITTED.json','PREPARATION-CONTRACT.json','PACKAGE-VERSIONS.txt','PUBLIC-ARTIFACT-AUDIT.json'}

def sha_bytes(b):return hashlib.sha256(b).hexdigest()
def stream_hash(stream):
 h=hashlib.sha256()
 while True:
  b=stream.read(1024*1024)
  if not b:break
  h.update(b)
 return h.hexdigest()
def canonical(name):
 p=pathlib.PurePosixPath(name)
 assert name and not p.is_absolute() and str(p)==name and '..' not in p.parts and '\\' not in name and all(ord(c)>=32 and ord(c)!=127 for c in name),'ZIP_PATH'
 return name

def verify(z,expected_zip_sha,archive):
 with archive.open('rb') as f:assert stream_hash(f)==expected_zip_sha,'ZIP_EXTERNAL_DIGEST'
 entries=z.infolist();names=[canonical(i.filename) for i in entries]
 assert len(names)==len(set(names)),'ZIP_DUPLICATE'
 assert len(names)<=6410 and sum(i.file_size for i in entries)<=528*1024**2,'ZIP_TRANSPORT_BUDGET'
 by_name=dict(zip(names,entries))
 for i in entries:
  assert not i.flag_bits&1 and stat.S_ISREG(i.external_attr>>16),'ZIP_NOT_REGULAR'
  assert stat.S_IMODE(i.external_attr>>16) in {0o644,0o755},'ZIP_MODE_UNSUPPORTED'
 def data(name):
  info=by_name[name];assert info.file_size<=16*1024**2,'ZIP_METADATA_BUDGET'
  return z.read(info)
 manifest=json.loads(data(ROOT+'ALLOWLIST.json'))
 assert isinstance(manifest,list) and len(manifest)<=6400,'ZIP_MANIFEST_BUDGET'
 sources=[canonical(r['source']) for r in manifest]
 assert len(sources)==len(set(sources)),'MANIFEST_DUPLICATE'
 targets=[];totals={'mountable':0,'review-only':0};modes={};hashes={};sizes={}
 for r in manifest:
  source=r['source'];assert source.startswith(('app/','runtime/')),'MANIFEST_PREFIX'
  d=r['disposition'];assert d in totals,'MANIFEST_DISPOSITION'
  assert isinstance(r['bytes'],int) and not isinstance(r['bytes'],bool) and r['bytes']>=0,'MANIFEST_SIZE'
  totals[d]+=r['bytes'];name=ROOT+source
  modes[name]=int(r['mode'],8);assert modes[name] in {0o644,0o755},'MANIFEST_MODE'
  hashes[name]=r['sha256'];sizes[name]=r['bytes']
  if d=='review-only':assert r['target'] is None,'REVIEW_TARGET'
  else:
   target=r['target'];assert isinstance(target,str) and target.startswith(('/app/','/usr/','/lib/','/lib64/')) and str(pathlib.PurePosixPath(target))==target and '..' not in pathlib.PurePosixPath(target).parts,'TARGET_PATH'
   targets.append(target)
 assert len(targets)==len(set(targets)),'TARGET_DUPLICATE'
 # Reuse the reviewed budget contract/helper. Transport envelope caps above
 # are independent pre-parse safety ceilings, not a substitute budget.
 local=pathlib.Path(__file__).resolve().parent
 limits=json.loads((local/'PREPARATION-CONTRACT.json').read_text())['preparationBudget']['limits']
 dispositions={d:{'files':sum(r['disposition']==d for r in manifest),'bytes':totals[d]} for d in totals}
 runpy.run_path(str(local/'preparation-budget.py'))['validate']({'files':len(manifest),'bytes':sum(totals.values()),'byDisposition':dispositions,'dispositions':dispositions},limits)
 closed={ROOT+s for s in sources}|{ROOT+s for s in META}|{EXPECTED}
 assert set(names)==closed,'ZIP_CLOSED_SET_MISSING_OR_EXTRA'
 audit=json.loads(data(ROOT+'PUBLIC-ARTIFACT-AUDIT.json'))
 audit_rows=audit['files'];audit_names=[canonical(r['path']) for r in audit_rows]
 assert len(audit_names)==len(set(audit_names)) and set(audit_names)==set(sources)|(META-{'PUBLIC-ARTIFACT-AUDIT.json'}),'AUDIT_CLOSED_SET'
 for row in audit_rows:
  name=ROOT+row['path']
  if name in hashes:assert (hashes[name],sizes[name])==(row['sha256'],row['bytes']),'AUDIT_MANIFEST_DRIFT'
  hashes[name]=row['sha256'];sizes[name]=row['bytes']
 expected=json.loads(data(EXPECTED))
 links={'allowlistSha256':'ALLOWLIST.json','emittedSha256':'EMITTED.json','entrySha256':'app/hydration-gates-entry.cjs','supervisorSha256':'app/inside-supervisor.py','fixtureSha256':'app/fixture-config.json','nativeSelectionSha256':'app/native-selection.json','nativeGuardSha256':'app/native-selection-guard.cjs','launcherSha256':'app/launch-capsule.py'}
 assert set(expected)==set(links),'CONSISTENCY_SCHEMA'
 for key,name in links.items():assert sha_bytes(z.read(ROOT+name))==expected[key],'CONSISTENCY_DIGEST'
 for name,i in by_name.items():
  mode=modes.get(name,0o644);assert stat.S_IMODE(i.external_attr>>16)==mode,'ZIP_MANIFEST_MODE_DRIFT'
  if name in hashes:
   assert i.file_size==sizes[name],'ZIP_SIZE_DRIFT'
   with z.open(i) as f:assert stream_hash(f)==hashes[name],'ZIP_HASH_DRIFT'
 return {'files':len(names),'manifestFiles':len(manifest),'manifestBytes':sum(totals.values()),'sourceCommit':audit['sourceCommit'],'zipSha256':expected_zip_sha}

def extract(archive,destination,expected_zip_sha,verify_only=False):
 archive=pathlib.Path(archive);destination=pathlib.Path(destination)
 assert archive.is_file() and not archive.is_symlink(),'ZIP_ARCHIVE_SYMLINK'
 assert destination.is_absolute() and str(destination)==os.path.normpath(str(destination)) and '..' not in destination.parts,'DESTINATION_PATH'
 assert not destination.exists() and not destination.is_symlink(),'DESTINATION_EXISTS'
 for p in destination.parents:assert not p.is_symlink(),'DESTINATION_PARENT_SYMLINK'
 with zipfile.ZipFile(archive) as z:
  result=verify(z,expected_zip_sha,archive)
  if verify_only:return result
  destination.mkdir(parents=False)
  for i in sorted(z.infolist(),key=lambda i:i.filename):
   p=destination/i.filename;p.parent.mkdir(parents=True,exist_ok=True)
   # Destination is new and exclusively ours. Never follow/overwrite a link.
   fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   with os.fdopen(fd,'wb') as out,z.open(i) as src:
    while True:
     b=src.read(1024*1024)
     if not b:break
     out.write(b)
    out.flush();os.fchmod(out.fileno(),stat.S_IMODE(i.external_attr>>16))
  return result
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--archive',required=True);parser.add_argument('--destination',required=True);parser.add_argument('--zip-sha256',required=True);parser.add_argument('--verify-only',action='store_true');a=parser.parse_args()
 print(json.dumps(extract(a.archive,a.destination,a.zip_sha256,a.verify_only),sort_keys=True))
