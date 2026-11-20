"""CI adapter for externally reviewed pinned core-only containment anchor.
No anchor generation or fallback. Reads exact GitHub artifact metadata, fetches
one immutable archive, verifies transport with the separately pinned extractor,
then invokes ONLY the reviewed core harness with an environment without tokens.
Not called by preparation. No product/Node/addon or host-security modification.
"""
import pathlib,json,hashlib,os,stat,re,urllib.request,urllib.error,urllib.parse,subprocess,sys,zipfile
D=pathlib.Path(__file__).resolve().parent
API='https://api.github.com/repos/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource'
HOST=('/usr/bin/bwrap','/usr/bin/systemd-run','/usr/bin/systemctl','/usr/bin/env','/usr/bin/python3')
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def digest(value):assert type(value) is str and re.fullmatch(r'[0-9a-f]{64}',value),'SHA256_SCHEMA';return value

def validate(a):
 assert set(a)=={'schema','repository','artifact','candidateRecord','sourceCheckout','sources','controls','hostBinaries'},'REVIEWED_ANCHOR_SCHEMA'
 assert type(a['schema']) is int and a['schema']==1 and a['repository']=='haroldfabla2-hue/Silhouette-Agency-OS-OpenSource','REPOSITORY_ANCHOR'
 for key in ('sources','controls','hostBinaries'):
  assert type(a[key]) is dict
  for value in a[key].values():digest(value)
 assert set(a['sources'])=={'containment-harness.py','containment-control-contract.py','containment-bootstrap-contract.py'},'SOURCE_SET'
 assert set(a['controls'])=={'extract-review-artifact.py','preparation-budget.py','PREPARATION-CONTRACT.json','execute-reviewed-core.py'},'CONTROL_SET'
 assert set(a['hostBinaries'])==set(HOST),'HOST_SET'
 for name,value in {**a['sources'],**a['controls']}.items():assert sha(D/name)==value,'REVIEWED_SOURCE_CHANGED'
 for name,value in a['hostBinaries'].items():
  s=os.stat(name);assert sha(name)==value and not s.st_mode&(stat.S_ISUID|stat.S_ISGID),'HOST_BINARY_CHANGED'
 artifact=a['artifact'];assert set(artifact)=={'id','runId','headSha','sourceMerge','sha256','allowlistSha256','zipBytes'},'ARTIFACT_SCHEMA'
 for key in ('id','runId','zipBytes'):assert type(artifact[key]) is int and artifact[key]>0,'ARTIFACT_INTEGER'
 assert artifact['zipBytes']<=200*1024**2,'ZIP_BYTES_LIMIT'
 for key in ('sha256','allowlistSha256'):digest(artifact[key])
 for value in (artifact['headSha'],artifact['sourceMerge'],a['sourceCheckout']):assert re.fullmatch(r'[0-9a-f]{40}',value),'COMMIT_SCHEMA'
 record=a['candidateRecord'];assert set(record)=={'runId','artifactId','sha256'},'CANDIDATE_RECORD_SCHEMA'
 assert type(record['runId']) is int and record['runId']>0 and type(record['artifactId']) is int and record['artifactId']>0,'CANDIDATE_RECORD_ID'
 digest(record['sha256'])
 return a

def api_json(path,token):
 req=urllib.request.Request(API+path,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'})
 with urllib.request.urlopen(req,timeout=15) as r:return json.load(r)

def download_artifact(identifier,sha256,limit,token,dest,expected_run):
 metadata=api_json('/actions/artifacts/'+str(identifier),token)
 assert metadata['id']==identifier and metadata['expired'] is False and metadata['workflow_run']['id']==expected_run,'ARTIFACT_IDENTITY'
 assert metadata['digest']=='sha256:'+sha256,'API_ARTIFACT_DIGEST'
 req=urllib.request.Request(API+'/actions/artifacts/'+str(identifier)+'/zip',headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Cache-Control':'no-cache'})
 try:urllib.request.build_opener(NoRedirect).open(req,timeout=15);raise AssertionError('EXPECTED_REDIRECT')
 except urllib.error.HTTPError as e:
  assert e.code==302,'ARTIFACT_DOWNLOAD_RESPONSE';url=e.headers['Location']
 # Never forward repository token to the provider storage redirect.
 parsed=urllib.parse.urlparse(url);assert parsed.scheme=='https' and not parsed.username and not parsed.password,'DOWNLOAD_HTTPS'
 total=0;h=hashlib.sha256();fd=os.open(dest,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as out,urllib.request.urlopen(url,timeout=20) as response:
  while True:
   block=response.read(1024*1024)
   if not block:break
   total+=len(block);assert total<=limit,'ARCHIVE_DOWNLOAD_BUDGET';h.update(block);out.write(block)
 assert h.hexdigest()==sha256,'ARCHIVE_DOWNLOAD_DIGEST'
 return metadata,total

def main():
 assert not sys.flags.optimize,'REQUIRED_ASSERTIONS'
 a=validate(json.loads((D/'CORE-EXECUTION-ANCHOR.json').read_text()))
 token=os.environ.pop('GH_TOKEN');assert token,'TRANSFER_TOKEN_REQUIRED'
 root=pathlib.Path('/tmp/hg-reviewed-core-input');root.mkdir(mode=0o700,exist_ok=False)
 archive=root/'artifact.zip';art=a['artifact']
 try:
  metadata,size=download_artifact(art['id'],art['sha256'],art['zipBytes'],token,archive,art['runId'])
  assert size==art['zipBytes'] and metadata['workflow_run']['head_sha']==art['headSha'],'RUN_HEAD_IDENTITY'
  record=a['candidateRecord'];candidatezip=root/'candidate.zip'
  download_artifact(record['artifactId'],record['sha256'],65536,token,candidatezip,record['runId'])
  with zipfile.ZipFile(candidatezip) as z:
   entries=z.infolist();assert len(entries)==1 and entries[0].filename=='hg-core-anchor-candidate.json' and entries[0].file_size<=32768 and not entries[0].flag_bits&1,'CANDIDATE_ZIP_CLOSED_SET'
   candidate=json.loads(z.read(entries[0]))
  assert candidate['schema']==1 and candidate['sourceCheckout']==a['sourceCheckout'] and candidate['sources']==a['sources'] and candidate['controls']==a['controls'],'INDEPENDENT_CANDIDATE_SOURCE'
  assert {k:v['sha256'] for k,v in candidate['hostBinaries'].items()}==a['hostBinaries'],'INDEPENDENT_CANDIDATE_HOST'
 finally:token=None
 env={'PATH':'/usr/bin:/bin','LC_ALL':'C'}
 # Execute pinned extractor ONLY, no package/native/product loading.
 subprocess.run(['/usr/bin/python3','-I','-B','-S',str(D/'extract-review-artifact.py'),'--archive',str(archive),'--destination',str(root/'extracted'),'--zip-sha256',art['sha256']],env=env,check=True,timeout=60)
 artifact=root/'extracted/hydration-gates-capsule-review'
 assert sha(artifact/'ALLOWLIST.json')==art['allowlistSha256'],'ALLOWLIST_IDENTITY'
 audit=json.loads((artifact/'PUBLIC-ARTIFACT-AUDIT.json').read_text());assert audit['sourceCommit']==art['sourceMerge'],'ARTIFACT_SOURCE_MERGE'
 anchor={'schema':1,'commit':art['sourceMerge'],'runId':art['runId'],'artifactId':art['id'],'archive':str(archive),'archiveSha256':art['sha256'],'artifactRoot':str(artifact),'allowlistSha256':art['allowlistSha256'],'sources':a['sources'],'hostBinaries':a['hostBinaries']}
 # This only adapts externally frozen values to local paths. No new digest or
 # expected identity is generated from the downloaded source or runner here.
 path=root/'local-anchor.json';fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o400)
 with os.fdopen(fd,'w') as f:json.dump(anchor,f,sort_keys=True)
 subprocess.run(['/usr/bin/python3','-I','-B','-S',str(D/'containment-harness.py'),'controller',str(path)],env=env,check=True,timeout=300)
if __name__=='__main__':
 try:main()
 except BaseException as e:
  # urllib errors may include signed redirects. Print class only, no URL,
  # request headers, environment or arbitrary exception string in public log.
  print('CORE_ADAPTER_FAILED '+type(e).__name__,flush=True);raise SystemExit(1)
