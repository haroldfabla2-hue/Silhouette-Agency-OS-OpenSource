"""INACTIVE one-shot launcher. Future exact workflow must explicitly call phase()."""
from pathlib import Path
import hashlib,importlib.util,json,os,subprocess,tarfile,shutil,stat
HERE=Path(__file__).resolve().parent
DEST=Path('/tmp/adapter-reviewed-payload')
PAYLOAD=DEST/'adapter-acquisition-systemd-runner-v3'
RECEIPT=Path('/tmp/adapter-acquisition-result.json')
def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def document():return json.loads((HERE/'ACTIVATION.json').read_text())
def guard(repository,event_head):
    repository=Path(repository).resolve();need(Path.cwd().resolve()==repository,'ACTIVATION_CWD')
    d=document();git=lambda *a:subprocess.check_output(['/usr/bin/git','-C',str(repository),*a],text=True).strip()
    need(git('rev-parse','HEAD')==event_head,'ACTIVATION_HEAD')
    need(git('show','-s','--format=%P','HEAD')==d['base'],'ACTIVATION_PARENT')
    need(git('rev-parse','HEAD^'+ '^{tree}')==d['baseTree'],'ACTIVATION_BASE_TREE')
    need(set(git('diff','--name-only','HEAD^','HEAD').splitlines())==set(d['changedPaths']),'ACTIVATION_CHANGED_PATHS')
    need(git('diff','--name-only','HEAD')=='','ACTIVATION_DIRTY_TRACKED')
    for relative,wanted in d['frozen'].items():
        p=repository/relative;need(p.is_file() and not p.is_symlink() and sha(p)==wanted,'ACTIVATION_FROZEN_BYTES')
    need(sha(HERE/'payload.tar.gz')==d['payloadSha256'],'ACTIVATION_PAYLOAD_HASH')
    return d

def extract(d):
    need(not DEST.exists(),'PAYLOAD_ALREADY_EXTRACTED');DEST.mkdir(mode=0o755)
    with tarfile.open(HERE/'payload.tar.gz','r:gz') as archive:
        total=0;seen=set()
        for row in archive:
            relative=Path(row.name);need(not relative.is_absolute() and '..' not in relative.parts and relative.parts[0]=='adapter-acquisition-systemd-runner-v3' and row.name not in seen,'PAYLOAD_PATH');seen.add(row.name)
            need(row.isdir() or row.isfile(),'PAYLOAD_ENTRY_TYPE');target=DEST/relative
            if row.isdir():target.mkdir(mode=0o755,parents=True,exist_ok=True);continue
            total+=row.size;need(total<=33554432 and len(seen)<=256,'PAYLOAD_EXPANDED_BOUND');target.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
            with archive.extractfile(row) as source,target.open('xb') as out:shutil.copyfileobj(source,out)
            target.chmod(0o644)
    verify_payload(d)
def verify_payload(d):
    need(sha(PAYLOAD/'SHA256.json')==d['payloadManifestSha256'],'PAYLOAD_MANIFEST_PIN')
    rows=json.loads((PAYLOAD/'SHA256.json').read_text())
    for relative,wanted in rows.items():
        p=PAYLOAD/relative;need(p.is_file() and not p.is_symlink() and sha(p)==wanted,'PAYLOAD_FILE_PIN')
    files={p.relative_to(PAYLOAD).as_posix() for p in PAYLOAD.rglob('*') if p.is_file()};need(files==set(rows)|{'SHA256.json'},'PAYLOAD_EXTRA_FILES')

def phase(name,repository,event_head):
    repository=Path(repository).resolve();d=guard(repository,event_head)
    if name=='prepare':extract(d)
    elif name!='export':verify_payload(d)
    if name=='prepare':
        return load(PAYLOAD/'prepare-adapter.INACTIVE.py','adapter_prepare').prepare(repository,d['payloadManifestSha256'])
    if name=='context':
        expected={'runId':int(os.environ['CURRENT_RUN_ID']),'runAttempt':int(os.environ['CURRENT_RUN_ATTEMPT']),'runnerName':os.environ['CURRENT_RUNNER_NAME'],'runnerEnvironment':os.environ['CURRENT_RUNNER_ENVIRONMENT'],'eventHead':event_head}
        context=load(repository/'tests/narrative-directed/context-snapshot.INACTIVE.py','adapter_context').collect('/tmp/narrative-directed-hosted-job.json',expected)
        with Path(os.environ['GITHUB_OUTPUT']).open('a') as out:out.write('snapshotSha256='+context['snapshotSha256']+'\njobId='+str(context['jobId'])+'\n')
        return {'contextCollected':True}
    if name=='run':
        need(os.geteuid()==0,'ROOT_REQUIRED');expected={'runId':int(os.environ['EXPECTED_RUN_ID']),'runAttempt':int(os.environ['EXPECTED_RUN_ATTEMPT']),'jobId':int(os.environ['EXPECTED_JOB_ID']),'snapshotSha256':os.environ['EXPECTED_SNAPSHOT_SHA256'],'runnerName':os.environ['EXPECTED_RUNNER_NAME'],'runnerEnvironment':os.environ['EXPECTED_RUNNER_ENVIRONMENT'],'eventHead':event_head}
        types=Path('/tmp/adapter-real-typecheck/receipt.json');need(types.is_file() and not types.is_symlink() and types.stat().st_size<=16384,'TYPES_BOUND')
        result=load(PAYLOAD/'adapter-services.INACTIVE.py','adapter_runner').run(repository=repository,archive='/tmp/narrative-directed-preparation/assembled/directed-image.docker.tar',manifest='/tmp/narrative-directed-preparation/assembled/DIRECTED-ROOTFS.json',context_module=repository/'tests/narrative-directed/context-snapshot.INACTIVE.py',expected_context=expected,receipt=RECEIPT,review_manifest_sha=d['payloadManifestSha256'],types_receipt=types,types_receipt_sha=sha(types))
        need(result.get('result')=='PASS_ADAPTER_BOUNDARY_EIGHT_CASES_ONLY','ADAPTER_BATCH_NOT_PASSED');return result
    if name=='export':
        out=Path('/tmp/adapter-final-selected');need(not out.exists(),'EXPORT_ALREADY_EXISTS');out.mkdir(mode=0o700)
        copied=[]
        sources=[(RECEIPT,16384)];sources += [(p,16384) for p in Path('/tmp/adapter-selected').glob('*.json')];sources += [(Path('/tmp/adapter-selected/adapter-batch.log'),1048576)]
        sources += [(Path('/tmp/adapter-real-typecheck')/file,1048576 if file.endswith('.log') else 16384) for file in ['receipt.json','install.log','types.log']]
        for source,limit in sources:
            if not source.is_file() or source.is_symlink():continue
            need(len(copied)<20,'EXPORT_COUNT')
            with source.open('rb') as stream:raw=stream.read(limit+1)
            name=('types-' if source.parent.name=='adapter-real-typecheck' else '')+source.name;(out/name).write_bytes(raw[:limit]);copied.append({'file':name,'sha256':sha(out/name),'bytes':min(len(raw),limit),'partial':len(raw)>limit})
        (out/'selection.json').write_text(json.dumps({'kind':'PUBLIC_BOUNDARY_SELECTED_EVIDENCE','files':copied,'copyIsNaturalExitEvidence':False,'allShutdownValidated':False},indent=2)+'\n');return {'selected':len(copied)}
    raise RuntimeError('UNKNOWN_PHASE')
if __name__=='__main__':raise SystemExit('INACTIVE: no standalone execution authority')
