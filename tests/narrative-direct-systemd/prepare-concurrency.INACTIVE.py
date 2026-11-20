"""Static preparation only. No product evaluation, provider or native addon."""
from pathlib import Path
import hashlib,importlib.util,io,json,os,shutil,subprocess,tarfile
BASE='50fb2195399a3027f140b5673ae4a5a8df9c85c4'
ROOT=Path.cwd().resolve()
HERE=Path(__file__).resolve().parent
SNAPSHOT=Path('/tmp/continuum-reviewed-baseline-source')
def need(value,code):
    if not value:raise RuntimeError(code)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
    need(not SNAPSHOT.exists(),'BASELINE_SOURCE_ALREADY_EXISTS')
    raw=subprocess.check_output(['git','archive','--format=tar',BASE],cwd=ROOT)
    need(len(raw)<=134217728,'BASELINE_ARCHIVE_BOUND')
    SNAPSHOT.mkdir(mode=0o700)
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as archive:
        total=0;seen=set()
        for row in archive:
            p=Path(row.name)
            need(not p.is_absolute() and '..' not in p.parts and row.name not in seen,'BASELINE_SOURCE_PATH')
            seen.add(row.name);target=SNAPSHOT/p
            need(row.isfile() or row.isdir(),'BASELINE_SOURCE_TYPE')
            if row.isdir():target.mkdir(parents=True,exist_ok=True);continue
            total+=row.size;need(total<=134217728,'BASELINE_EXPANDED_BOUND')
            target.parent.mkdir(parents=True,exist_ok=True)
            with archive.extractfile(row) as source,target.open('xb') as output:shutil.copyfileobj(source,output)
    # Reconstruct the old archive against its exact source baseline, then apply
    # reviewed emissions separately at the pinned rootfs-derivation boundary.
    # The original helper retains all its archive, compiler and emission pins.
    helper=ROOT/'tests/narrative-directed-activation/prepare-reviewed.INACTIVE.py'
    result=subprocess.run(['/usr/bin/python3','-I','-B','-S',str(helper)],cwd=SNAPSHOT,check=False,timeout=240)
    need(result.returncode==0,'BASE_ARCHIVE_RECONSTRUCTION_FAILED')
    compiler=Path('/tmp/narrative-directed-preparation/typescript.js')
    emitted=Path('/tmp/continuum-current-static-emission');need(not emitted.exists(),'EMISSION_ALREADY_EXISTS');emitted.mkdir()
    env={'PATH':os.environ['PATH'],'HOME':'/tmp','LC_ALL':'C'}
    subprocess.run([shutil.which('node'),str(HERE/'emit-concurrency.INACTIVE.cjs'),str(ROOT),str(emitted),str(compiler)],env=env,check=True,timeout=60)
    expected=json.loads((HERE/'concurrency-emitted/CONCURRENCY-EMITTED.json').read_text())
    actual=json.loads((emitted/'CONCURRENCY-EMITTED.json').read_text())
    for key in set(expected)-{'compilerHostNodeSha256'}:need(actual[key]==expected[key],'CONCURRENCY_EMISSION_IDENTITY_MISMATCH')
    for row in expected['files']:
        name=row['target'].removeprefix('/app/')
        need(sha(emitted/name)==row['emittedSha256']==sha(HERE/'concurrency-emitted'/name),'CONCURRENCY_EMITTED_BYTES_MISMATCH')
    # Nonsecret preparation receipt only, no authorization inferred from it.
    (emitted/'VERIFICATION.json').write_text(json.dumps({'kind':'CONCURRENCY_STATIC_EMISSION_ONLY','sourceFiles':len(actual['files']),'productExecuted':False,'compilerSha256':actual['compilerSha256'],'packageLockSha256':actual['packageLockSha256']},sort_keys=True)+'\n')
if __name__=='__main__':
    try:main()
    except Exception as error:
        print('CONCURRENCY_PREPARATION_FAILED '+type(error).__name__)
        raise SystemExit(1)
