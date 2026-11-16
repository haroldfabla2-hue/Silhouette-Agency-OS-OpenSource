# Draft reviewed transport only. Never invokes npm, product code, hooks, or native payloads.
import pathlib,json,sys,hashlib,base64,urllib.request,urllib.parse,tarfile,time
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


# Empty nested mount targets, no source bytes or compiler config changes.
for side in ['baseline','candidate']:(out/'snapshots'/side/'node_modules').mkdir(exist_ok=True)
# Container uid65534 can traverse ONLY these disposable source/dependency/control inputs.
for folder in ['snapshots','deps','compiler']:
 for d in [out/folder]+[p for p in (out/folder).rglob('*') if p.is_dir()]:d.chmod(0o755)
verified={p.relative_to(out).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for folder in ['snapshots','deps','compiler'] for p in (out/folder).rglob('*') if p.is_file()}
(out/'verified-inputs.json').write_text(json.dumps(verified,sort_keys=True))
