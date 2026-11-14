"""Reviewonly isolated nativephase asset builder, not executed duringpreparation."""
import hashlib,json,os,pathlib,subprocess,sys,tarfile,time,urllib.request
root=pathlib.Path('/tmp/redis-build');root.mkdir();ev=pathlib.Path('/tmp/evidence');url='https://download.redis.io/releases/redis-7.4.7.tar.gz';expected='c97e57b0df330a9e091cacff012bebe763c275398cf36ff44cdba876814b595b'
# Overall nativephase commanddeadline ownedby supervisor, no retries/alternateversions.
archive=root/'source.tar.gz'
with urllib.request.urlopen(url,timeout=10)as response,archive.open('xb')as stream:
 n=0
 while True:
  block=response.read(65536)
  if not block:break
  n+=len(block)
  if n>16*1024**2:raise RuntimeError('PINNED_REDIS_ARCHIVE_SIZE_LIMIT')
  stream.write(block)
assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected
with tarfile.open(archive)as source:
 entries=source.getmembers();assert len(entries)<=4096
 assert sum(x.size for x in entries)<=64*1024**2
 for entry in entries:
  p=pathlib.PurePosixPath(entry.name)
  assert p.parts and p.parts[0]=='redis-7.4.7'and not p.is_absolute()and'..'not in p.parts
  assert entry.isfile()or entry.isdir(),'NO_ARCHIVE_LINK_DEVICE'
 source.extractall(root,filter='data')
build=root/'redis-7.4.7';cmd=['make','-j1','MALLOC=libc','BUILD_TLS=no','redis-server'];start=time.monotonic();subprocess.run(cmd,cwd=build,check=True,timeout=90)
source=build/'src/redis-server';data=source.read_bytes();assert len(data)<=12*1024**2 and data.startswith(b'\x7fELF')
# Review actual binary retention size rather than quietlystripping nativeevidence.
destination=pathlib.Path('/tmp/work/node_modules/.silhouette-native-redis');assert destination.is_dir()and not destination.is_symlink()
output=destination/'redis-server';output.write_bytes(data);output.chmod(0o555)
version=subprocess.check_output([str(output),'--version'],text=True,timeout=2).strip();assert 'v=7.4.7'in version
record=json.dumps({'url':url,'archive_sha256':expected,'build_argv':cmd,'seconds':time.monotonic()-start,'version':version,'binary_sha256':hashlib.sha256(data).hexdigest(),'binary_bytes':len(data),'status':'BUILT_REAL_REDIS_NOT_FIXTURE_DOUBLE','scope':'ISOLATED_NATIVE_ASSET_ONLY_NOT_PRODUCTION_ATTESTATION'},indent=2)
(ev/'redis-asset.json').write_text(record);(destination/'asset.json').write_text(record)
print('REAL_REDIS_NATIVE_ASSET_PINNED',flush=True)
