"""Preparation with real lockfile dependencies, no product runtime evaluation.
No lifecycle scripts, user secrets, product or native addon evaluation.
The public Git dependency may use the image shell/transport, never host tools.
Any install/tsc failure blocks the real product batch, not a product-test failure.
"""
from pathlib import Path
import hashlib,io,json,os,shutil,subprocess,tarfile,time,importlib.util,re
ROOT=Path('/work/source')
WORK=Path('/work/result')
HERE=Path('/validation')
BASE='cd0066be67748f5948515bf3d20e6edc36d7b7c0'
LOCK_SHA='f8cad2766f4c9d32310625e8951a53f17355c94409424aeb917e6ad5c01e9512'
def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
    helper=HERE/'bounded-public-command.INACTIVE.py';need(sha(helper)==json.loads((HERE/'CHILD-CODE-PINS.json').read_text())['bounded-public-command.INACTIVE.py'],'TYPECHECK_CAPTURE_HELPER_PIN')
    spec=importlib.util.spec_from_file_location('bounded_public_command',HERE/'bounded-public-command.INACTIVE.py');capture=importlib.util.module_from_spec(spec);spec.loader.exec_module(capture)
    need(not WORK.exists(),'TYPECHECK_ALREADY_EXISTS');WORK.mkdir(mode=0o700)
    result={'kind':'REAL_LOCKFILE_TYPECHECK','stage':'SOURCE','state':'INCOMPLETE','productExecuted':False,'nativeAddonsExecuted':False,'lifecycleScriptsEnabled':False,'fullRepositoryTypesPassed':False,'productExecutionAttempted':False}
    receipt=WORK/'receipt.json'
    def save():
        raw=(json.dumps(result,sort_keys=True,indent=2)+'\n').encode();temporary=receipt.with_suffix('.pending');fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:need(os.write(fd,raw)==len(raw),'TYPECHECK_RECEIPT_SHORT');os.fsync(fd)
        finally:os.close(fd)
        os.replace(temporary,receipt);directory=os.open(WORK,os.O_DIRECTORY)
        try:os.fsync(directory)
        finally:os.close(directory)
    save()
    try:
        source=ROOT;home=Path('/work/home');home.mkdir(mode=0o700)
        need(sha(source/'package-lock.json')==LOCK_SHA,'TYPECHECK_LOCK_PIN')
        rows=json.loads((HERE/'PUBLIC-SOURCE-MANIFEST.json').read_text())
        actual={str(p.relative_to(source)) for p in source.rglob('*') if p.is_file()};need(actual=={r['path'] for r in rows},'TYPECHECK_SOURCE_SET')
        for row in rows:
            p=source/row['path'];need(p.is_file() and not p.is_symlink() and sha(p)==row['sha256'],'TYPECHECK_SOURCE_PIN')
        user_config=home/'user.npmrc';user_config.write_text('')
        global_config=home/'global.npmrc';global_config.write_text('')
        patch=HERE/'candidate.patch'
        result.update(sourceBaseline=BASE,candidatePatchSha256=sha(patch),lockBeforeSha256=sha(source/'package-lock.json'));save()
        identity=json.loads((HERE/'TOOLCHAIN-PINS.json').read_text())
        for relative,wanted in identity.items():need(sha(Path('/')/relative)==wanted,'TYPECHECK_IMAGE_TOOLCHAIN_PIN')
        # No inherited auth/proxy/npm configuration. Only public locked package
        # sources are installed in a disposable preparation directory. The one
        # public lockfile Git SSH transport is mapped to HTTPS at the SAME
        # pinned commit, without editing the lock or using any SSH credential.
        env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':str(home),'LC_ALL':'C','CI':'true','GIT_TERMINAL_PROMPT':'0','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_COUNT':'1','GIT_CONFIG_KEY_0':'url.https://github.com/.insteadOf','GIT_CONFIG_VALUE_0':'ssh://git@github.com/','npm_config_userconfig':str(user_config),'npm_config_globalconfig':str(global_config),'npm_config_cache':str(WORK/'npm-cache'),'npm_config_ignore_scripts':'true','npm_config_audit':'false','npm_config_fund':'false','NODE_OPTIONS':'--max-old-space-size=4096'}
        result.update(stage='INSTALL',preparationNodePath='/usr/local/bin/node',preparationNodeSha256=sha('/usr/local/bin/node'),preparationNpmPath='/usr/local/lib/node_modules/npm/bin/npm-cli.js');save()
        install=capture.run_public_command(['/usr/local/bin/node','/usr/local/lib/node_modules/npm/bin/npm-cli.js','ci','--ignore-scripts','--include=dev','--no-audit','--no-fund'],cwd=source,env=env,log_path=WORK/'install.log',timeout_seconds=360)
        result['installCapture']=install;result['installExitCode']=install['returnCode'];save();need(install['successful'],'TYPECHECK_DEPENDENCY_INSTALL_FAILED')
        need(sha(source/'package-lock.json')==LOCK_SHA,'TYPECHECK_LOCK_MUTATED')
        lock=json.loads((source/'package-lock.json').read_text());actual=json.loads((source/'node_modules/typescript/package.json').read_text());node_types=json.loads((source/'node_modules/@types/node/package.json').read_text())
        need(actual['version']=='5.8.3' and node_types['version']=='22.19.1','TYPECHECK_EXPECTED_DEPENDENCY_VERSIONS')
        need(sha(source/'node_modules/typescript/lib/tsc.js')=='2cffde0b8c6760dfb0b5b0382bbb7e00ba6a8b2d981b9205b256a700a481d983','TYPECHECK_COMPILER_PIN')
        need(actual['version']==lock['packages']['node_modules/typescript']['version'] and node_types['version']==lock['packages']['node_modules/@types/node']['version'],'TYPECHECK_DEPENDENCY_VERSION_MISMATCH')
        result.update(stage='TYPES',compilerVersion=actual['version'],nodeTypesVersion=node_types['version'],packageLockSha256=LOCK_SHA,compilerSha256=sha(source/'node_modules/typescript/lib/tsc.js'));save()
        types=capture.run_public_command(['/usr/local/bin/node',str(source/'node_modules/typescript/bin/tsc'),'--noEmit','--skipLibCheck','--pretty','false'],cwd=source,env=env,log_path=WORK/'types.log',timeout_seconds=120)
        result['typesCapture']=types;save()
        result['lockAfterSha256']=sha(source/'package-lock.json');need(result['lockAfterSha256']==LOCK_SHA,'TYPECHECK_FINAL_LOCK_CHANGED')
        result['typesExitCode']=types['returnCode'];result['fullRepositoryTypesPassed']=types['successful']
        need(types['successful'],'TYPECHECK_REPOSITORY_TYPES_FAILED')
        result.update(state='PREPARED_TYPES_PASSED',stage='OFFLINE_RUNTIME_NOT_STARTED',preparationIsolationContract='ROOTFS_PUBLIC_SOURCE_TOOLCHAIN_V3',preparationClosureSha256=sha(HERE/'PREPARATION-CLOSURE.json'),ociPlatformDigest='sha256:bb6834c0669aa71cbc8d94606561a721adf489f6b93d7b8b825f0cf1b498c2c4',sourceManifestSha256=sha(HERE/'PUBLIC-SOURCE-MANIFEST.json'),toolchainPinsSha256=sha(HERE/'TOOLCHAIN-PINS.json'));save()
        return {'receipt':str(receipt),'receiptSha256':sha(receipt),'source':str(source)}
    except BaseException as error:
        result['state']='FAILED';result['failureClass']=type(error).__name__
        text=str(error);result['failureCode']=text if text.startswith('TYPECHECK_') and text.replace('_','').isalnum() else 'TYPECHECK_UNCLASSIFIED_FAILURE'
        save();raise
if __name__=='__main__':main()
