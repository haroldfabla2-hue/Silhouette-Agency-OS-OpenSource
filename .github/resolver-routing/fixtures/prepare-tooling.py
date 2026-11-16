# Source/materialization only; no npm, install hooks, resolver imports, native load or execution.
import pathlib,sys,json,hashlib,base64,urllib.request,tarfile,io
root=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve()
(out/'empty-node').mkdir(parents=True,exist_ok=False)
rows=json.loads((root/'fixtures/tooling-artifacts.json').read_text());lock=json.loads(pathlib.Path(sys.argv[4]).read_text())['packages']
assert len(rows)==16
stage=sys.argv[3];assert stage in ['NODE','TSX','VITE_OPTIONAL']
nodePaths={'node_modules/tsx','node_modules/tsx/node_modules/esbuild','node_modules/get-tsconfig','node_modules/resolve-pkg-maps'}
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise RuntimeError('R_REDIRECT_DENIED')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
compressed=expanded=0;receipt=[]
for row in rows:
 if stage=='NODE' or stage=='TSX' and row['path'] not in nodePaths:continue;
 key=row['path'];entry=lock[key]
 assert all(row[k]==entry[k] for k in ['version','resolved','integrity'])
 assert row['resolved'].startswith('https://registry.npmjs.org/') and row['integrity'].startswith('sha512-')
 with opener.open(row['resolved'],timeout=25) as response:
  raw=response.read(32*1024*1024+1)
 assert len(raw)<=32*1024*1024
 compressed+=len(raw);assert compressed<=64*1024*1024
 assert 'sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode()==row['integrity']
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as tar:
  for member in tar:
   parts=pathlib.PurePosixPath(member.name).parts
   assert not member.name.startswith('/') and '..' not in parts and len(parts)>=1
   if member.isdir():continue
   assert member.isfile() and len(parts)>=2
   suffix=pathlib.Path(*parts[1:]);expanded+=member.size;assert expanded<=256*1024*1024 and member.size<=16*1024*1024
   native=row['retainedNativeMember'] is not None and str(suffix)==row['retainedNativeMember']
   if suffix.suffix not in ['.js','.mjs','.cjs','.json'] and not native:continue
   data=tar.extractfile(member).read();assert len(data)==member.size
   for view in (['node','vite'] if key in nodePaths else ['vite']):
    dest=out/view/key/suffix;dest.parent.mkdir(parents=True,exist_ok=True);assert not dest.exists();dest.write_bytes(data);dest.chmod(0o444)
   receipt.append({'package':key,'file':str(suffix),'sha256':hashlib.sha256(data).hexdigest(),'native':native})
for view in ['node','vite','empty-node']:
 (out/view).mkdir(parents=True,exist_ok=True);(out/view).chmod(0o755)
 for p in (out/view).rglob('*'):
  assert not p.is_symlink()
  if p.is_dir():p.chmod(0o755)
 assert sum(p.stat().st_size for p in (out/view).rglob('*') if p.is_file())<=128*1024*1024
(out/'tooling-receipt.json').write_text(json.dumps({'schema':1,'toolingOnly':True,'executed':False,'compressedBytes':compressed,'expandedBytes':expanded,'files':receipt},indent=2)+'\n')
