# Draft reviewed transport only. Never invokes npm, product code, hooks, or native payloads.
import pathlib,json,sys,hashlib,base64,urllib.request,urllib.parse,tarfile,time,shutil
root=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve();infra=root/'candidate/.github/inert-compiler';inputs=json.loads((infra/'artifacts.json').read_text());maps=json.loads((infra/'source-hashes.json').read_text())
for side in ['baseline','candidate']:
 src=root/side;expected=maps[side]
 actual={p.relative_to(src).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in src.rglob('*') if p.is_file() and '.git' not in p.relative_to(src).parts and not (side=='candidate' and (p.relative_to(src).as_posix().startswith('.github/inert-compiler/') or p.relative_to(src).as_posix()=='.github/workflows/inert-compiler.yml'))}
 if actual!=expected:raise RuntimeError('Exact source tree mismatch')
 # source symlinks are not allowed, even if their content hash matches.
 if any(p.is_symlink() for p in src.rglob('*') if '.git' not in p.relative_to(src).parts):raise RuntimeError('Source symlink')
 if any((src/n).exists() for n in ['.env','.env.local']):raise RuntimeError('Environment file')
 snapshot=out/'snapshots'/side
 for rel in expected:
  dest=snapshot/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((src/rel).read_bytes());dest.chmod(0o444)
locks=[json.loads((root/s/'package-lock.json').read_text())['packages'] for s in ['baseline','candidate']]
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise RuntimeError('Redirect refused')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());downloaded=expanded=retained=0;start=time.monotonic();allowed={'.ts','.tsx','.js','.jsx','.json','.mjs','.cjs','.mts','.cts'}
for row in inputs:
 if time.monotonic()-start>240:raise RuntimeError('Retrieval budget')
 rel=row['path'];parts=pathlib.PurePosixPath(rel).parts
 if rel.startswith('/') or '..' in parts or (rel!='compiler' and not rel.startswith('node_modules/')):raise RuntimeError('Plan destination')
 original='node_modules/typescript' if rel=='compiler' else rel
 for lock in locks:
  x=lock[original]
  if x['version']!=row['version']:raise RuntimeError('Lock version mismatch')
  if not row.get('exactPublicCommitArchive') and any(x.get(k)!=row.get(k) for k in ['resolved','integrity']):raise RuntimeError('Lock artifact mismatch')
 u=urllib.parse.urlsplit(row['resolved']);exception=row.get('exactPublicCommitArchive')
 if exception:
  if row['resolved']!='https://codeload.github.com/whiskeysockets/libsignal-node/tar.gz/1c30d7d7e76a3b0aa120b04dc6a26f5a12dccf67':raise RuntimeError('Commit archive mismatch')
  if any('1c30d7d7e76a3b0aa120b04dc6a26f5a12dccf67' not in lock[original]['resolved'] for lock in locks):raise RuntimeError('Git pin mismatch')
 elif u.hostname!='registry.npmjs.org' or not row.get('integrity','').startswith('sha512-'):raise RuntimeError('Registry origin/integrity')
 if u.scheme!='https' or u.username or u.password or u.port not in [None,443]:raise RuntimeError('URL transport')
 dest=out/(hashlib.sha256(rel.encode()).hexdigest()+'.tgz');h=hashlib.sha512();n=0
 with opener.open(row['resolved'],timeout=30) as response,dest.open('wb') as f:
  while True:
   data=response.read(1024*1024)
   if not data:break
   n+=len(data);downloaded+=len(data)
   if n>128*1024**2 or downloaded>1024**3:raise RuntimeError('Compressed cap')
   h.update(data);f.write(data)
 if not exception and base64.b64encode(h.digest()).decode()!=row['integrity'][7:]:raise RuntimeError('SRI mismatch')
 if exception and hashlib.sha256(dest.read_bytes()).hexdigest()!='a9e14823efa911474aaa9e8f6bfb88759f869a3bc25116e969be943b84bef318':raise RuntimeError('Public archive bytes changed')
 # Commit archive digest pins observed public bytes only, not lock-SRI/git-object proof.
 target=out/('compiler' if rel=='compiler' else 'deps/'+rel);count=0;packagebytes=0
 with tarfile.open(dest,'r:gz') as tar:
  for member in tar:
   count+=1;parts=pathlib.PurePosixPath(member.name).parts
   if count>100000 or member.name.startswith('/') or '..' in parts:raise RuntimeError('Archive member/path cap')
   if member.isdir():continue
   if not member.isfile() or len(parts)<2:raise RuntimeError('Nonregular member')
   expanded+=member.size;packagebytes+=member.size
   if member.size>128*1024**2 or packagebytes>512*1024**2 or expanded>4*1024**3:raise RuntimeError('Expanded cap')
   suffix=pathlib.Path(*parts[1:]);output=target/suffix
   if suffix.suffix not in allowed:continue
   data=tar.extractfile(member).read();retained+=len(data)
   if retained>2*1024**3 or len(data)!=member.size:raise RuntimeError('Retained/size cap')
   output.parent.mkdir(parents=True,exist_ok=True)
   if output.exists():
    if output.read_bytes()!=data:raise RuntimeError('Conflicting duplicate')
   else:output.write_bytes(data);output.chmod(0o444)
 if rel=='compiler' and hashlib.sha256((target/'lib/_tsc.js').read_bytes()).hexdigest()!='1f62c69e832fbbbd05a6dac950f152937f594a4d0b88087be5406ace348efcb5':raise RuntimeError('Compiler bytes')
(out/'preparation.json').write_text(json.dumps({'artifacts':len(inputs),'compressedBytes':downloaded,'retainedBytes':retained,'libsignal':'Observed exact public commit archive, NOT SRI/git-object identity'}))


# Candidate's ACCEPTED ownership extension, not an SDK workaround. Baseline stays pristine.
# Source preparation only: never imports JS or executes the product patch script.
qstage='Q00_INIT'
qsafe=out/'safe-diagnostics';qsafe.mkdir(parents=True,exist_ok=True)
try:
 qstage='Q01_MANIFEST'
 manifestPath=root/'candidate/patches/qdrant-1.17.0-owned-dispatcher.json'
 manifestBytes=manifestPath.read_bytes()
 if hashlib.sha256(manifestBytes).hexdigest()!='4efbde6937472da4ef8ab4bf17a0e5b3b1e635f151b380b19de24c1422ab664d':raise RuntimeError('Qdrant accepted manifest identity')
 qstage='Q02_VERSION'
 manifest=json.loads(manifestBytes);package=out/'deps/node_modules/@qdrant/js-client-rest';metadata=json.loads((package/'package.json').read_text())
 if manifest['package']!='@qdrant/js-client-rest' or manifest['version']!='1.17.0' or metadata['name']!=manifest['package'] or metadata['version']!=manifest['version']:raise RuntimeError('Qdrant extension version')
 qstage='Q03_ARTIFACT_IDENTITY'
 if manifest['sourceTarIntegrity']!=next(x['integrity'] for x in inputs if x['path']=='node_modules/@qdrant/js-client-rest'):raise RuntimeError('Qdrant extension artifact identity')
 qstage='Q04_PATH_SET'
 expectedPatchPaths={'dist/esm/api-client.js','dist/esm/qdrant-client.js','dist/cjs/api-client.js','dist/cjs/qdrant-client.js','dist/types/qdrant-client.d.ts','dist/types/types.d.ts','dist/types/api-client.d.ts'}
 if len(manifest['files'])!=7 or {x['path'] for x in manifest['files']}!=expectedPatchPaths:raise RuntimeError('Qdrant extension exact path set')
 qstage='Q05_PREIMAGE_PAYLOAD'
 for row in manifest['files']:
  if hashlib.sha256((package/row['path']).read_bytes()).hexdigest()!=row['beforeSha256'] or hashlib.sha256(row['afterText'].encode()).hexdigest()!=row['afterSha256']:raise RuntimeError('Qdrant extension preimage/payload identity')
 qstage='Q06_BROWSER_UNCHANGED'
 for row in manifest['unchangedBrowserFiles']:
  if row['beforeSha256']!=row['afterSha256'] or hashlib.sha256((package/row['path']).read_bytes()).hexdigest()!=row['beforeSha256']:raise RuntimeError('Qdrant unchanged browser identity')
 qstage='Q07_COPY_AND_WRITE'
 overlay=out/'candidate-qdrant';shutil.copytree(package,overlay)
 for row in manifest['files']:
  target=overlay/row['path'];target.chmod(0o600);target.write_bytes(row['afterText'].encode());target.chmod(0o444)
 # Full-package identity, not only selected declaration hashes. Baseline not mutated.
 qstage='Q08_FULL_PACKAGE_IDENTITY'
 original={p.relative_to(package).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in package.rglob('*') if p.is_file()}
 patched={p.relative_to(overlay).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in overlay.rglob('*') if p.is_file()}
 expectedOverlay=dict(original)
 for row in manifest['files']:expectedOverlay[row['path']]=row['afterSha256']
 if patched!=expectedOverlay:raise RuntimeError('Qdrant candidate full-overlay identity')
 if any(hashlib.sha256((package/row['path']).read_bytes()).hexdigest()!=row['beforeSha256'] for row in manifest['files']):raise RuntimeError('Qdrant baseline changed')
 (out/'qdrant-views.json').write_text(json.dumps({'baseline':'PRISTINE_SHARED_ARTIFACT','candidate':'EXACT_ACCEPTED_7_FILE_OWNERSHIP_EXTENSION','manifestSha256':hashlib.sha256(manifestBytes).hexdigest(),'baselinePackageHashes':original,'candidatePackageHashes':patched},sort_keys=True))

except BaseException as error:
 errorClass='E_FILE_ABSENT' if isinstance(error,FileNotFoundError) else 'E_PERMISSION' if isinstance(error,PermissionError) else 'E_SCHEMA_KEY' if isinstance(error,KeyError) else 'E_SCHEMA_TYPE' if isinstance(error,TypeError) else 'E_PARSE' if isinstance(error,ValueError) else 'E_OS' if isinstance(error,OSError) else 'E_IDENTITY_OR_UNEXPECTED'
 (qsafe/'dependency-views.json').write_text(json.dumps({'classification':'MATERIALIZATION_FAILED','stage':qstage,'errorClass':errorClass,'compilerAdmitted':False},sort_keys=True)+'\n')
 raise
(qsafe/'dependency-views.json').write_text(json.dumps({'classification':'MATERIALIZED_SOURCE_ONLY_NOT_EXECUTED','baseline':'PRISTINE_SHARED_ARTIFACT','candidate':'EXACT_ACCEPTED_7_FILE_QDRANT_EXTENSION','sharedQdrantBytesEquivalent':False,'manifestSha256':'4efbde6937472da4ef8ab4bf17a0e5b3b1e635f151b380b19de24c1422ab664d','preimagesAndPayloadsVerified':True,'browserUnchangedVerified':True,'onlyAccepted7FilesChanged':True},sort_keys=True)+'\n')

# Empty nested mount targets, no source bytes or compiler config changes.
for side in ['baseline','candidate']:(out/'snapshots'/side/'node_modules').mkdir(exist_ok=True)
# Container uid65534 can traverse ONLY these disposable source/dependency/control inputs.
for folder in ['snapshots','deps','compiler','candidate-qdrant']:
 for d in [out/folder]+[p for p in (out/folder).rglob('*') if p.is_dir()]:d.chmod(0o755)
verified={p.relative_to(out).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for folder in ['snapshots','deps','compiler','candidate-qdrant'] for p in (out/folder).rglob('*') if p.is_file()}
(out/'verified-inputs.json').write_text(json.dumps(verified,sort_keys=True))
