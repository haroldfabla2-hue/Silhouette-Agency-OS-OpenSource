"""PROPOSAL ONLY. Three exact registry data archives, never npm install/scripts.
Requires a separately reviewed scoped job before invoking. Not run here.
"""
from pathlib import Path
import base64,hashlib,io,json,os,tarfile,time,urllib.request
ROOT=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui'
SPECS=[('typescript','https://registry.npmjs.org/typescript/-/typescript-5.8.3.tgz','sha512-p1diW6TqL9L07nNxvRMM7hMMw4c5XOo/1ibL4aAIGmSAt9slTE1Xgw5KWuof2uTOvCg9BY7ZRi+GaF+7sfgPeQ=='),
('@types/node','https://registry.npmjs.org/@types/node/-/node-22.19.1.tgz','sha512-LCCV0HdSZZZb34qifBsyWlUmok6W7ouER+oQIGBScS8EsZsQbrtFTUrDX4hOl+CS6p7cnNC4td+qrSVGSCTUfQ=='),
('undici-types','https://registry.npmjs.org/undici-types/-/undici-types-6.21.0.tgz','sha512-iwDZqg0QAGrg9Rav5H4n0M64c3mkR59cJ6wQp+7C4nI0gsmExaedaYLNO44eT4AtBBwjbTiGPMlt2Md0T9H9JQ==')]
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise RuntimeError('NO_TOOLCHAIN_REDIRECT_ADMITTED')
start=time.monotonic();total=0;decoded=0;receipts=[]
budget=float(os.environ['TOOLCHAIN_BUDGET_SECONDS']);assert 0<budget<=75
def checktime():
    if time.monotonic()-start>=budget:raise TimeoutError('TOOLCHAIN_BUDGET')
assert ROOT.is_dir()and not ROOT.is_symlink()and ROOT.stat().st_uid==os.geteuid()and ROOT.stat().st_mode&0o077==0
assert {p.name for p in ROOT.iterdir()}=={'evidence'}
for name in ['app','deps','browser','product-fixtures']:(ROOT/name).mkdir(mode=0o700)
for name,url,integrity in SPECS:
    checktime()
    with urllib.request.build_opener(NoRedirect()).open(url,timeout=min(15,max(.1,budget-(time.monotonic()-start))))as response:
        assert response.url==url and response.status==200
        data=response.read(16*1024**2+1)
    total+=len(data);assert len(data)<=16*1024**2 and total<=24*1024**2
    assert hashlib.sha512(data).digest()==base64.b64decode(integrity.split('-',1)[1])
    destination=ROOT/'deps'/name;destination.mkdir(parents=True)
    seen=set();prefix=None;rows=[]
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz')as archive:
        members=archive.getmembers();assert len(members)<=1024
        for member in members:
            checktime()
            p=Path(member.name)
            assert not p.is_absolute()and '..'not in p.parts and len(p.parts)>0
            if prefix is None:prefix=p.parts[0]
            assert p.parts[0]==prefix
            if member.isdir():continue
            assert member.isfile()and len(p.parts)>1
            relative=Path(*p.parts[1:]);assert str(relative)not in seen;seen.add(str(relative))
            assert 0<=member.size<=16*1024**2
            decoded+=member.size;assert decoded<=64*1024**2
            raw=archive.extractfile(member).read(member.size+1);assert len(raw)==member.size
            target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True)
            fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            first=None
            try:
                offset=0
                while offset<len(raw):
                    count=os.write(fd,raw[offset:]);assert count>0
                    offset+=count
            except BaseException as error:first=error;raise
            finally:
                try:os.close(fd)
                except BaseException:
                    if first is not None:first.cleanupFailed=True
                    else:raise
            rows.append({'path':str(relative),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
    actual={str(p.relative_to(destination)):hashlib.sha256(p.read_bytes()).hexdigest()for p in destination.rglob('*')if p.is_file()}
    assert actual=={r['path']:r['sha256']for r in rows}
    receipts.append({'package':name,'url':url,'integrity':integrity,'archiveBytes':len(data),'archiveSha256':hashlib.sha256(data).hexdigest(),'allMembersVerified':rows})
checktime()
(ROOT/'evidence'/'toolchain-source.json').write_text(json.dumps({'status':'COMPLETE_DATA_MEMBER_PROVENANCE_NOT_EXECUTION','seconds':time.monotonic()-start,'archives':receipts},indent=2)+'\n')
