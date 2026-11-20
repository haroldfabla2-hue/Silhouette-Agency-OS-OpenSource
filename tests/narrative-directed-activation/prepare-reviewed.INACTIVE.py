"""One exact reconstruction, no product evaluation. Run by reviewed workflow only."""
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import urllib.request
import zipfile

BASE=Path(__file__).resolve().parent
WORK=Path('/tmp/narrative-directed-preparation')
ZIP_SHA='a549abd2f6a03266566ee14df09ba93882ff94458bdc514bc015bb3e31ea13d4'
PREP_SHA='e6d0f352e92e08a5121c58e2538ebdf6a81b365d64b4803f82f0aeda0d465e6a'


def need(value,code):
    if not value:raise RuntimeError(code)


def sha(path):
    value=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for raw in iter(lambda:stream.read(1048576),b''):value.update(raw)
    return value.hexdigest()


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args):return None


def prepare():
    need(not WORK.exists(),'PREPARATION_ALREADY_EXISTS')
    need(shutil.disk_usage('/tmp').free>=2147483648,'PREPARATION_DISK_BUDGET')
    WORK.mkdir(mode=0o700)
    # Token used only on api.github.com. Never forwarded to signed blob URL,
    # never passed to compiler, root process, image, receipt or uploaded artifact.
    token=os.environ.pop('GH_TOKEN')
    api='https://api.github.com/repos/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource/actions/artifacts/14655138390/zip'
    request=urllib.request.Request(api,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'})
    opener=urllib.request.build_opener(NoRedirect)
    try:
        response=opener.open(request,timeout=30)
    except urllib.error.HTTPError as error:
        need(error.code in (301,302,303,307,308),'ORIGINAL_ARTIFACT_DOWNLOAD_UNAVAILABLE')
        url=error.headers.get('Location','')
        need(url.startswith('https://'),'ARTIFACT_REDIRECT_INVALID')
        response=urllib.request.urlopen(urllib.request.Request(url,headers={'Accept':'application/octet-stream'}),timeout=30)
    del token,request
    original=WORK/'original.zip';total=0
    with response,original.open('xb') as output:
        while True:
            raw=response.read(1048576)
            if not raw:break
            total+=len(raw);need(total<=181155369,'ORIGINAL_ZIP_BOUND');output.write(raw)
    need(total==181155369 and sha(original)==ZIP_SHA,'ORIGINAL_ZIP_PIN')
    extracted=WORK/'original';extracted.mkdir()
    # Artifact extraction is exact byte transport, not authority to execute its
    # launcher. Modes come from manifest assembly, not ZIP extraction defaults.
    with zipfile.ZipFile(original) as archive:
        total=0;seen=set()
        need(len(archive.infolist())<=7000,'ORIGINAL_ZIP_FILE_BOUND')
        for row in archive.infolist():
            path=Path(row.filename)
            need(not path.is_absolute() and '..' not in path.parts and row.filename not in seen,'ZIP_PATH')
            seen.add(row.filename)
            need(not stat.S_ISLNK(row.external_attr>>16),'ZIP_SYMLINK')
            total+=row.file_size;need(total<=550000000,'ORIGINAL_EXPANDED_BOUND')
            target=extracted/path
            if row.is_dir():target.mkdir(parents=True,exist_ok=True);continue
            target.parent.mkdir(parents=True,exist_ok=True)
            with archive.open(row) as source,target.open('xb') as output:shutil.copyfileobj(source,output)
    compiler=WORK/'typescript.js'
    with gzip.open(BASE/'typescript-5.8.2.js.gz','rb') as source,compiler.open('xb') as output:shutil.copyfileobj(source,output)
    need(sha(compiler)=='795e49e46d497cc16e4b02916b50cbca257b4256d62cddc4cc504103f7961027','COMPILER_PIN')
    source=BASE.parent/'narrative-directed'
    output=WORK/'assembled'
    assembler=load('assemble_directed',source/'assemble.INACTIVE.py')
    emitted=assembler.assemble(repository=Path.cwd(),base_artifact=extracted/'hydration-gates-capsule-review',
        base_zip=original,compiler=compiler,node=shutil.which('node'),source_directory=source,output=output)
    reviewed=BASE/'REVIEWED-PREPARATION.json'
    need(sha(reviewed)==PREP_SHA,'EXTERNAL_PREPARATION_PIN')
    expected=json.loads(reviewed.read_text())
    for key in ('imageConfigId','dockerArchiveSha256','dockerArchiveBytes','rootfsManifestSha256',
                'layerDiffId','files','rootfsBytes','nodeRuntimeSha256','compilerSha256','compilerVersion',
                'packageLockSha256','sourceFiles','sourceControls','instrumentFiles','reviewOnlyOmitted'):
        need(emitted[key]==expected[key],'RECONSTRUCTION_IDENTITY_MISMATCH')
    # Host compiler binary provenance may differ. Compare all emitted source
    # identities, preserve both metadata files, then use the externally reviewed
    # preparation record, never an automatically regenerated grant/anchor.
    original_emission=output/'DIRECTED-EMITTED.json'
    doc=json.loads(original_emission.read_text())
    expected_emission=json.loads((BASE/'REVIEWED-EMITTED.json').read_text())
    for key in set(doc)-{'compilerHostNodeSha256'}:need(doc[key]==expected_emission[key],'EMISSION_IDENTITY_MISMATCH')
    need(sha(BASE/'REVIEWED-EMITTED.json')==expected['emissionSha256'],'REVIEWED_EMISSION_PIN')
    shutil.copyfile(original_emission,output/'ACTUAL-PREPARATION-HOST-EMITTED.json')
    shutil.copyfile(BASE/'REVIEWED-EMITTED.json',original_emission)
    shutil.copyfile(output/'PREPARATION.json',output/'ACTUAL-RECONSTRUCTION-PREPARATION.json')
    shutil.copyfile(reviewed,output/'PREPARATION.json')
    verification=load('verify_directed',source/'verify-assembly.INACTIVE.py').verify(output)
    (output/'STATIC-VERIFICATION.json').write_text(json.dumps(verification,sort_keys=True)+'\n')


if __name__=='__main__':
    try:prepare()
    except Exception as error:
        # Do not print signed URL, transport request object, token or raw error.
        print('DIRECTED_PREPARATION_FAILED '+type(error).__name__,file=sys.stderr)
        raise SystemExit(1)
