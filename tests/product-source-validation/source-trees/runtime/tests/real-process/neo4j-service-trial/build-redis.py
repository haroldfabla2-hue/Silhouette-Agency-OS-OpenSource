"""Reviewonly isolated nativephase asset builder, not executed duringpreparation."""
import hashlib,json,os,pathlib,subprocess,sys,tarfile,time,urllib.request
from evidence_policy import configure,cap,limited_open,emit_text,emit_bytes,append_text,copy_bounded
configure(pathlib.Path('/tmp/evidence'),'native')
root=pathlib.Path('/tmp/redis-build');root.mkdir();ev=pathlib.Path('/tmp/evidence');url='https://download.redis.io/releases/redis-7.4.7.tar.gz';expected='c97e57b0df330a9e091cacff012bebe763c275398cf36ff44cdba876814b595b'
# Overall nativephase commanddeadline ownedby supervisor, no retries/alternateversions.
archive=root/'source.tar.gz'
request=urllib.request.Request(url,headers={'User-Agent':'Silhouette-Isolated-Validation/1.0'})
with urllib.request.urlopen(request,timeout=10)as response,archive.open('xb')as stream:
 n=0
 while True:
  block=response.read(65536)
  if not block:break
  n+=len(block)
  if n>16*1024**2:raise RuntimeError('PINNED_REDIS_ARCHIVE_SIZE_LIMIT')
  stream.write(block)
assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected
with tarfile.open(archive)as source:
 entries=source.getmembers();assert len(entries)==1697
 assert sum(x.size for x in entries if x.isfile())==16133002
 assert sum(x.isfile()for x in entries)==1610 and sum(x.isdir()for x in entries)==87
 for entry in entries:
  p=pathlib.PurePosixPath(entry.name)
  assert p.parts and p.parts[0]=='redis-7.4.7'and not p.is_absolute()and'..'not in p.parts
  assert entry.isfile()or entry.isdir(),'NO_ARCHIVE_LINK_DEVICE'
 emit_text(ev/'redis-archive-inventory.json',json.dumps({'archive_sha256':expected,'entries':len(entries),'files':sum(x.isfile()for x in entries),'directories':sum(x.isdir()for x in entries),'expanded_bytes':sum(x.size for x in entries if x.isfile()),'path_types_validated':True},separators=(',',':')))
 source.extractall(root,filter='data')
toolchain={}
for name in ['cc','make','ar','ranlib','ld','readelf']:
 p=pathlib.Path('/usr/bin')/name;actual=p.resolve(strict=True)
 assert actual.is_file()
 with actual.open('rb')as stream:sha=hashlib.file_digest(stream,'sha256').hexdigest()
 toolchain[name]={'path':str(actual),'sha256':sha,'bytes':actual.stat().st_size}
build_env={'PATH':'/usr/bin:/bin','HOME':'/tmp/home','TMPDIR':'/tmp','LANG':'C','LC_ALL':'C','CC':'cc','AR':'ar','RANLIB':'ranlib','CFLAGS':'','LDFLAGS':''}
build=root/'redis-7.4.7';cmd=['make','-j1','MALLOC=libc','BUILD_TLS=no','USE_SYSTEMD=no','redis-server'];start=time.monotonic();subprocess.run(cmd,cwd=build,env=build_env,check=True,timeout=90)
source=build/'src/redis-server';data=source.read_bytes();assert len(data)<=12*1024**2 and data.startswith(b'\x7fELF')
# Review actual binary retention size rather than quietlystripping nativeevidence.
destination=pathlib.Path('/tmp/work/node_modules/.silhouette-native-redis');assert destination.is_dir()and not destination.is_symlink()
output=destination/'redis-server';output.write_bytes(data);output.chmod(0o555)
version=subprocess.check_output([str(output),'--version'],env=build_env,text=True,timeout=2).strip();assert 'v=7.4.7'in version
record=json.dumps({'url':url,'archive_sha256':expected,'build_argv':cmd,'build_env':build_env,'toolchain_identities':toolchain,'seconds':time.monotonic()-start,'version':version,'binary_sha256':hashlib.sha256(data).hexdigest(),'binary_bytes':len(data),'status':'BUILT_REAL_REDIS_NOT_FIXTURE_DOUBLE','scope':'ISOLATED_NATIVE_ASSET_ONLY_NOT_PRODUCTION_ATTESTATION'},indent=2)
emit_text(ev/'redis-asset.json',record);(destination/'asset.json').write_text(record)
from elf_provenance import inspect_native_files
emit_text(ev/'redis-elf-provenance.json',json.dumps(inspect_native_files(['.silhouette-native-redis/redis-server']),separators=(',',':')))
print('REAL_REDIS_NATIVE_ASSET_PINNED',flush=True)
