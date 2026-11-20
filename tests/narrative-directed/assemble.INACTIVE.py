"""Finite local preparation only: static source emission + scratch Docker archive.
No Docker/daemon/build service, installer, product import or native addon is run.
Call assemble() deliberately; __main__ is inactive. Its output needs independent
review and an external frozen preparation hash before an execution decision.
"""
from pathlib import Path,PurePosixPath
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import tarfile

BASE_PINS={
 'ALLOWLIST.json':'c4e6cde69e92ff45faa7ee450f554f98912363f03a76b463861fa9b6b28b0118',
 'EMITTED.json':'a91bd5bb170c500b003e11fc2f4b5f6d7a8b028921d6024f6fed34ecaa176387',
 'PUBLIC-ARTIFACT-AUDIT.json':'de222d0f9321708f024bc0fd408dd4b4a177412755f56c2f2ba6491e4e2ee5d2'}
BASE_ARTIFACT={'id':14655138390,'runId':44788675538,
 'zipSha256':'a549abd2f6a03266566ee14df09ba93882ff94458bdc514bc015bb3e31ea13d4',
 'checkout':'df7b6f8b16f10cbbe45bdae3c073f72848235192',
 'associatedHead':'9788deab95bcf120ea91e3823279edde5aba0b31',
 'artifactUrl':'https://api.github.com/repos/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource/actions/artifacts/14655138390'}
COMPILER_SHA='795e49e46d497cc16e4b02916b50cbca257b4256d62cddc4cc504103f7961027'
LOCK_SHA='f8cad2766f4c9d32310625e8951a53f17355c94409424aeb917e6ad5c01e9512'
MAX_FILES=6400
MAX_BYTES=419430400


def sha(path):
    value=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1048576),b''):value.update(chunk)
    return value.hexdigest()


def need(ok,code):
    if not ok:raise RuntimeError(code)


def canonical(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


def clean_target(value):
    need(isinstance(value,str) and value.startswith('/'),'TARGET_ABSOLUTE')
    path=PurePosixPath(value)
    need(str(path)==value and '..' not in path.parts,'TARGET_CANONICAL')
    need(value.startswith(('/app/','/usr/','/lib/','/lib64/','/opt/')),'TARGET_PREFIX')
    return value.lstrip('/')


def tar_info(name,size=0,mode=0o644,directory=False):
    row=tarfile.TarInfo(name);row.size=size;row.mode=mode;row.uid=0;row.gid=0
    row.uname='';row.gname='';row.mtime=0
    if directory:row.type=tarfile.DIRTYPE
    return row


def assemble(*,repository,base_artifact,base_zip,compiler,node,source_directory,output):
    R=Path(repository).resolve();B=Path(base_artifact).resolve();S=Path(source_directory).resolve();O=Path(output).resolve()
    need(not O.exists(),'OUTPUT_EXISTS');O.mkdir(mode=0o700)
    need(sha(base_zip)==BASE_ARTIFACT['zipSha256'],'BASE_ZIP_PIN')
    for name,digest in BASE_PINS.items():need(sha(B/name)==digest,'BASE_METADATA_PIN')
    need(sha(compiler)==COMPILER_SHA and sha(R/'package-lock.json')==LOCK_SHA,'PREPARATION_TOOLCHAIN_PIN')
    old=json.loads((B/'EMITTED.json').read_text());audit=json.loads((B/'PUBLIC-ARTIFACT-AUDIT.json').read_text())
    need(old['packageLockSha256']==LOCK_SHA,'BASE_LOCK_PIN')
    emitted=O/'emitted';emitted.mkdir()
    # The only JS package evaluated by preparation is the pinned compiler.
    # Source text is parsed/transpiled, never imported/evaluated.
    subprocess.run([str(node),str(S/'emit-source.INACTIVE.cjs'),str(R),str(emitted),str(compiler)],
        env={'PATH':'/usr/bin:/bin','LC_ALL':'C'},stdin=subprocess.DEVNULL,check=True,timeout=60)
    doc=json.loads((emitted/'DIRECTED-EMITTED.json').read_text())
    need(doc['compilerSha256']==COMPILER_SHA and doc['packageLockSha256']==LOCK_SHA,'EMISSION_PIN')
    package_names={row['name'] for row in audit['npmPackages']}
    missing=[row for row in doc['bareUses'] if row['root'] not in package_names]
    need(all(row['root']=='dockerode' and row['dynamic'] and row['from']=='services/remediationService.ts' for row in missing),'NEW_UNRESOLVED_NPM_ROOT')
    need(len(missing)==2,'DOCKERODE_EXCEPTION_DRIFT')
    rows=json.loads((B/'ALLOWLIST.json').read_text());files={};review=[]
    # Validate every base row, including intentionally unmounted native bindings.
    for row in rows:
        relative=PurePosixPath(row['source'])
        need(not relative.is_absolute() and '..' not in relative.parts,'BASE_SOURCE_PATH')
        original=B/str(relative)
        need(original.is_file() and not original.is_symlink() and sha(original)==row['sha256'] and original.stat().st_size==row['bytes'],'BASE_FILE_PIN')
        if row['disposition']=='review-only':review.append({k:row[k] for k in ('source','sha256','bytes')});continue
        need(row['disposition']=='mountable','BASE_DISPOSITION')
        target=clean_target(row['target']);need(target not in files,'DUPLICATE_BASE_TARGET')
        files[target]={'path':original,'sha256':row['sha256'],'bytes':row['bytes'],'mode':int(row['mode'],8),'origin':'REVIEWED_BASE_CLOSURE'}
    old_source_targets={'app/'+row['source'].removesuffix('.ts')+'.js' if row['source'].endswith('.ts') else 'app/'+row['source'] for row in old['files']}
    for target in old_source_targets:files.pop(target,None)
    for row in doc['files']:
        target=clean_target(row['target']);file=emitted/target.removeprefix('app/')
        need(sha(file)==row['emittedSha256'],'EMITTED_FILE_PIN')
        files[target]={'path':file,'sha256':sha(file),'bytes':file.stat().st_size,'mode':0o644,'origin':'CURRENT_STATIC_EMISSION'}
    # The old hydration controls are not selected for this image. Explicit names,
    # not a broad file-class exclusion; native guard and pins remain unchanged.
    for name in ('hydration-gates-entry.cjs','inside-supervisor.py','fixture-config.json','launch-capsule.py','runtime-env.json'):
        files.pop('app/'+name,None)
    for name in ('entry.INACTIVE.mjs','supervisor.INACTIVE.cjs'):
        file=S/name;files['app/'+name]={'path':file,'sha256':sha(file),'bytes':file.stat().st_size,'mode':0o644,'origin':'DIRECTED_CONTROL'}
    need(sha(files['usr/bin/node']['path'])==old['nodeSha256'],'RUNTIME_NODE_PIN')
    need(len(review)==5,'REVIEW_ONLY_SET')
    need(len(files)<=MAX_FILES and sum(row['bytes'] for row in files.values())<=MAX_BYTES,'FINITE_CONTEXT_BUDGET')
    credential_markers=[r'gh[pousr]_[A-Za-z0-9]{20,}',r'github_pat_[A-Za-z0-9_]{20,}',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY']
    # Existing pinned audit covers its source fixture URL exception. Recheck new
    # source/control text for secret markers without printing the matched value.
    for target,row in files.items():
        need(not any(part in ('.env','.env.local','.npmrc','.git','.ssh') for part in PurePosixPath(target).parts),'PRIVATE_FILE_PATH')
        if row['origin']!='REVIEWED_BASE_CLOSURE' and Path(target).suffix in ('.js','.cjs','.mjs','.json'):
            text=row['path'].read_text()
            need(not any(re.search(pattern,text) for pattern in credential_markers),'CREDENTIAL_MARKER')
    manifest=[{'target':'/'+target,**{k:row[k] for k in ('sha256','bytes','mode','origin')}} for target,row in sorted(files.items())]
    (O/'DIRECTED-ROOTFS.json').write_bytes(canonical(manifest))
    (O/'DIRECTED-EMITTED.json').write_bytes(canonical(doc))
    # Build a deterministic scratch layer locally, not a Dockerfile with RUN.
    layer=O/'layer.tar'
    directories={'app','work','tmp','proc','dev','sys','etc'}
    for target in files:
        for parent in PurePosixPath(target).parents:
            if str(parent)!='.':directories.add(str(parent))
    with tarfile.open(layer,'w',format=tarfile.USTAR_FORMAT) as archive:
        for directory in sorted(directories):archive.addfile(tar_info(directory,mode=0o755,directory=True))
        for target,row in sorted(files.items()):
            with row['path'].open('rb') as stream:archive.addfile(tar_info(target,row['bytes'],row['mode']),stream)
    diff_id='sha256:'+sha(layer)
    config={'created':'1970-01-01T00:00:00Z','architecture':'amd64','os':'linux',
        'config':{'User':'1000:1000','Env':['PATH=/usr/bin:/bin','LC_ALL=C'],
                  'Entrypoint':['/usr/bin/node'],'Cmd':['-e',"require('/app/supervisor.INACTIVE.cjs').runDirected().catch(()=>{process.exitCode=1})"],
                  'WorkingDir':'/work'},'rootfs':{'type':'layers','diff_ids':[diff_id]},
        'history':[{'created':'1970-01-01T00:00:00Z','created_by':'finite local scratch assembly; no RUN'}]}
    config_bytes=canonical(config);config_id=hashlib.sha256(config_bytes).hexdigest()
    config_name=config_id+'.json';(O/config_name).write_bytes(config_bytes)
    save_manifest=[{'Config':config_name,'RepoTags':[],'Layers':['layer.tar']}]
    save_bytes=canonical(save_manifest)
    image=O/'directed-image.docker.tar'
    with tarfile.open(image,'w',format=tarfile.USTAR_FORMAT) as archive:
        archive.addfile(tar_info(config_name,len(config_bytes)),io.BytesIO(config_bytes))
        archive.addfile(tar_info('manifest.json',len(save_bytes)),io.BytesIO(save_bytes))
        with layer.open('rb') as stream:archive.addfile(tar_info('layer.tar',layer.stat().st_size),stream)
    preparation={'kind':'DIRECTED_SCRATCH_IMAGE_PREPARATION_NOT_RUNTIME_EVIDENCE','schemaVersion':1,
        'baseArtifact':BASE_ARTIFACT,'baseMetadata':BASE_PINS,'imageConfigId':'sha256:'+config_id,
        'dockerArchiveSha256':sha(image),'dockerArchiveBytes':image.stat().st_size,
        'rootfsManifestSha256':sha(O/'DIRECTED-ROOTFS.json'),'emissionSha256':sha(O/'DIRECTED-EMITTED.json'),
        'layerDiffId':diff_id,'files':len(manifest),'rootfsBytes':sum(row['bytes'] for row in files.values()),
        'reviewOnlyOmitted':review,'nodeRuntimeSha256':old['nodeSha256'],
        'compilerSha256':COMPILER_SHA,'compilerVersion':doc['compiler'],'packageLockSha256':LOCK_SHA,
        'sourceFiles':doc['files'],'sourceControls':{name:sha(S/name) for name in
            ('entry.INACTIVE.mjs','supervisor.INACTIVE.cjs','emit-source.INACTIVE.cjs','assemble.INACTIVE.py','host-adapter.INACTIVE.py')},
        'instrumentFiles':{str(file.relative_to(R)):sha(file) for file in sorted((R/'scripts/containment').glob('p0-*.INACTIVE.py'))},
        'productEvaluated':False,'nativeBindingsLoaded':False,'dockerOrInfrastructureCalled':False,
        'imageLoadObserved':False,'runtimeLimitsValidated':False,'readiness':'PREPARATION_ONLY_REQUIRES_EXTERNAL_REVIEW'}
    (O/'PREPARATION.json').write_bytes(canonical(preparation))
    layer.unlink() # already embedded byte-for-byte in the final Docker archive
    return preparation


if __name__=='__main__':raise SystemExit('INACTIVE: invoke only for approved local preparation')
