#!/usr/bin/env python3
"""SOURCE REVIEW ONLY. Exact streaming archive admission, NEVER execute Neo4j/JDK.
Missing reviewed runner JDK pin blocks BEFORE network. No fallback/retry.
"""
import gzip,hashlib,json,os,pathlib,resource,signal,stat,sys,tarfile,time,urllib.request
HARNESS=pathlib.Path('/tmp/harness');ROOT=pathlib.Path('/tmp/work/node_modules/.silhouette-native-neo4j');EV=pathlib.Path('/tmp/evidence/neo4j-admission.json')
P=json.loads((HARNESS/'neo4j-admission-inputs.json').read_text());rawpin=(HARNESS/'neo4j-asset-pin.json').read_bytes()
report={'status':'INCOMPLETE','scope':'ARCHIVE_ADMISSION_ONLY_NO_SERVER_JAVA_OR_BOOTFIT','signals':[],'pin_sha256':hashlib.sha256(rawpin).hexdigest()};created=[];staging=ROOT/'staging';final=ROOT/'neo4j-community-5.26.32';response=None
start=time.monotonic()
def timed_out(*unused):raise TimeoutError('admission absolute deadline')
def digest(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  while True:
   b=f.read(65536)
   if not b:break
   h.update(b)
 return h.hexdigest()
def regular(path):
 s=path.lstat();assert stat.S_ISREG(s.st_mode)and not path.is_symlink();return s
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise RuntimeError('NO_REDIRECTS_ADMITTED')
class BoundedHTTP:
 def __init__(self,f):self.f=f;self.n=0;self.h=hashlib.sha256()
 def read(self,n=-1):
  if time.monotonic()>download_deadline:raise TimeoutError('download45s')
  b=self.f.read(min(n if n>=0 else 65536,65536));self.n+=len(b)
  assert self.n<=P['archive_cap'],'compressedcap';self.h.update(b);return b
class BoundedExpanded:
 def __init__(self,f):self.f=f;self.n=0
 def read(self,n=-1):
  b=self.f.read(min(n if n>=0 else 65536,65536));self.n+=len(b);assert self.n<=P['expanded_cap'],'expandedcap';return b
try:
 signal.signal(signal.SIGALRM,timed_out);signal.alarm(P['total_seconds'])
 assert float(os.environ['NEO4J_ADMISSION_PHASE_DEADLINE'])-time.monotonic()>=P['total_seconds']+5,'insufficientoriginalphasebudget' 
 assert report['pin_sha256']==P['inventory_sha256'],'inventorypin'
 assert resource.getrlimit(resource.RLIMIT_NOFILE)==(256,256),'FD256required'
 assert resource.getrlimit(resource.RLIMIT_FSIZE)==(64*1024**2,64*1024**2),'nativeFSIZE64required'
 assert ROOT.is_dir()and not ROOT.is_symlink()and not list(ROOT.iterdir()),'assetmountmustbeempty'
 fs=os.statvfs(ROOT);free=fs.f_bavail*fs.f_frsize
 report['store_before']={'free_bytes':free,'free_inodes':fs.f_favail,'filesystem_bytes':fs.f_blocks*fs.f_frsize}
 assert fs.f_blocks*fs.f_frsize<=4*1024**3 and not(fs.f_flag&os.ST_RDONLY),'fixedstore4GiBwritablerequired'
 assert free>=P['min_free_bytes']and fs.f_favail>=P['min_free_inodes'],'storefreegate'
 assert P['jdk_source_evidence']['evidence_review']=='ACCEPTED_STATIC_ONLY_BY_PARENT_AFTER_INDEPENDENT_REVIEW','JDK_EVIDENCE_REVIEW_PENDING_NO_NETWORK'
 jdk=P['jdk'];assert isinstance(jdk,dict),'MISSING_REVIEWED_JDK_PIN_NO_NETWORK'
 assert set(jdk)=={'home','release_sha256','files'}and set(jdk['files'])==set(P['jdk_files_required']),'exactJDKschema'
 home=pathlib.Path(jdk['home']);assert home.is_absolute()and home.resolve(strict=True)==home and(str(home).startswith('/usr/lib/jvm/')or str(home).startswith('/opt/hostedtoolcache/Java_')),'unreviewedJDKpath'
 release=home/'release';assert regular(release).st_size<16384 and digest(release)==jdk['release_sha256'],'JDKreleasepin'
 release_data=release.read_text();assert any(l.startswith('JAVA_VERSION="21.')for l in release_data.splitlines()),'JDK21required'
 observed={}
 for name in P['jdk_files_required']:
  f=home/name;assert f.resolve(strict=True).is_relative_to(home);assert 0<regular(f).st_size<=P['jdk_file_cap'],'JDKfilecap'
  assert os.statvfs(f).f_flag&os.ST_RDONLY,'JDKmustremainreadonly'
  observed[name]=digest(f);assert observed[name]==jdk['files'][name],'JDKfilepin'
 assert os.statvfs(release).f_flag&os.ST_RDONLY
 report['jdk']={'home':str(home),'release_sha256':jdk['release_sha256'],'files':observed,'execution':'NONE_STATIC_READS_ONLY'}
 rows=json.loads(rawpin);assert len(rows)==P['member_count'];assert sum(r['bytes']for r in rows)==164862896
 staging.mkdir(mode=0o700);created.append(staging)
 request=urllib.request.Request(P['url'],headers={'User-Agent':'Silhouette-Pinned-Archive-Admission/1.0','Accept-Encoding':'identity'})
 download_deadline=time.monotonic()+P['download_seconds'];response=urllib.request.build_opener(NoRedirect).open(request,timeout=10)
 assert response.status==200 and response.url==P['url']and int(response.headers['Content-Length'])==P['archive_bytes'],'exactHTTP'
 source=BoundedHTTP(response);expanded=BoundedExpanded(gzip.GzipFile(fileobj=source));seen=[]
 with tarfile.open(fileobj=expanded,mode='r|')as archive:
  for entry in archive:
   index=len(seen);assert index<len(rows),'excessmember';row=rows[index]
   rel=pathlib.PurePosixPath(entry.name);assert not rel.is_absolute()and'..'not in rel.parts and rel.parts[0]==final.name,'path'
   assert entry.name==row['path']and entry.size==row['bytes']and oct(entry.mode)==row['mode']and entry.type.decode('ascii')==row['type']and entry.linkname==row['link'],'inventorymetadata'
   assert entry.isfile()or entry.isdir();assert not entry.pax_headers and 0<=entry.size<=P['member_cap'],'unsupportedarchive'
   local=staging.joinpath(*rel.parts[1:])
   if entry.isdir():
    if local!=staging:local.mkdir(mode=0o700);created.append(local)
   else:
    assert local.parent.is_dir()and not local.exists()and not local.is_symlink()
    h=hashlib.sha256();size=0;f=archive.extractfile(entry)
    with local.open('xb')as output:
     created.append(local)
     while True:
      b=f.read(65536)
      if not b:break
      size+=len(b);assert size<=entry.size;output.write(b);h.update(b)
    assert size==entry.size and h.hexdigest()==row['sha256'],'filehash'
   seen.append(entry.name)
 assert len(seen)==len(rows),'missingmember'
 while expanded.read(65536):pass
 assert not source.read(1),'trailingcompressed'
 assert source.n==P['archive_bytes']and source.h.hexdigest()==P['archive_sha256'],'globalarchivehash'
 response.close();response=None
 # Read back every file before publication, then set vendor readonly modes.
 for row in rows:
  local=staging.joinpath(*pathlib.PurePosixPath(row['path']).parts[1:])
  if row['type']=='0':assert regular(local).st_size==row['bytes']and digest(local)==row['sha256'];local.chmod(int(row['mode'],8)&0o555)
 for row in reversed(rows):
  if row['type']=='5':staging.joinpath(*pathlib.PurePosixPath(row['path']).parts[1:]).chmod(0o555)
 report.update({'status':'ADMITTED_ARCHIVE_ONLY_NOT_BOOTFIT','archive_bytes':source.n,'archive_sha256':source.h.hexdigest(),'members':len(seen),'member_bytes':sum(r['bytes']for r in rows),'expanded_stream_bytes':expanded.n,'store_after_free_bytes':os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize})
 staging.rename(final);created=[]
except BaseException as original:
 report.update(status='FAIL',error_type=type(original).__name__,error=str(original)[:512]);cleanup=[]
 # Restore own directory permissions before unlinking after a late hash/chmod error.
 for path in created:
  if path.is_dir():
   try:path.chmod(0o700)
   except Exception as error:cleanup.append({'path':str(path.relative_to(ROOT)),'error_type':type(error).__name__})
 # Only own known newly-created paths; never recurse into an existing asset.
 for path in reversed(created):
  try:
   if path.is_dir():path.chmod(0o700);path.rmdir()
   else:path.unlink()
  except Exception as error:cleanup.append({'path':str(path.relative_to(ROOT)),'error_type':type(error).__name__})
 report['partial_staging_cleanup_errors']=cleanup
 raise
finally:
 if response:response.close()
 signal.alarm(0);report['seconds']=time.monotonic()-start;EV.write_text(json.dumps(report,indent=2)+'\n');print('NEO4J_ARCHIVE_ADMISSION',report['status'],flush=True)
