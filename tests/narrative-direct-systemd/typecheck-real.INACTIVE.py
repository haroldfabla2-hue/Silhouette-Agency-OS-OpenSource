"""Preparation with real lockfile dependencies. Never import product modules.
No shell, npm lifecycle scripts, user secrets or native addon evaluation.
Any install/tsc failure blocks the real product batch, not a product-test failure.
"""
from pathlib import Path
import hashlib,io,json,os,shutil,subprocess,tarfile,time
ROOT=Path.cwd().resolve()
WORK=Path('/tmp/continuum-real-typecheck')
LOCK_SHA='f8cad2766f4c9d32310625e8951a53f17355c94409424aeb917e6ad5c01e9512'
def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
    need(not WORK.exists(),'TYPECHECK_ALREADY_EXISTS');WORK.mkdir(mode=0o700)
    result={'kind':'REAL_LOCKFILE_TYPECHECK','stage':'SOURCE','state':'INCOMPLETE','productExecuted':False,'nativeAddonsExecuted':False,'lifecycleScriptsEnabled':False,'fullRepositoryTypesPassed':False}
    receipt=WORK/'receipt.json'
    def save():receipt.write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
    save()
    try:
        need(sha(ROOT/'package-lock.json')==LOCK_SHA,'TYPECHECK_LOCK_PIN')
        need(shutil.disk_usage(WORK).free>=4294967296,'TYPECHECK_DISK_BUDGET')
        source=WORK/'source';source.mkdir();home=WORK/'home';home.mkdir()
        user_config=home/'user.npmrc';user_config.write_text('')
        global_config=home/'global.npmrc';global_config.write_text('')
        raw=subprocess.check_output(['git','archive','--format=tar','HEAD'],cwd=ROOT)
        need(len(raw)<=134217728,'TYPECHECK_SOURCE_BOUND')
        with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as archive:
            total=0;seen=set()
            for row in archive:
                p=Path(row.name);need(not p.is_absolute() and '..' not in p.parts and row.name not in seen,'TYPECHECK_SOURCE_PATH');seen.add(row.name)
                need(row.isdir() or row.isfile(),'TYPECHECK_SOURCE_TYPE');target=source/p
                if row.isdir():target.mkdir(parents=True,exist_ok=True);continue
                total+=row.size;need(total<=134217728,'TYPECHECK_SOURCE_BYTES');target.parent.mkdir(parents=True,exist_ok=True)
                with archive.extractfile(row) as inp,target.open('xb') as out:shutil.copyfileobj(inp,out)
        # No inherited auth/proxy/npm configuration. Only public locked package
        # sources are installed in a disposable preparation directory. The one
        # public lockfile Git SSH transport is mapped to HTTPS at the SAME
        # pinned commit, without editing the lock or using any SSH credential.
        env={'PATH':os.environ['PATH'],'HOME':str(home),'LC_ALL':'C','CI':'true','GIT_TERMINAL_PROMPT':'0','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_COUNT':'1','GIT_CONFIG_KEY_0':'url.https://github.com/.insteadOf','GIT_CONFIG_VALUE_0':'ssh://git@github.com/','npm_config_userconfig':str(user_config),'npm_config_globalconfig':str(global_config),'npm_config_cache':str(WORK/'npm-cache'),'npm_config_ignore_scripts':'true','npm_config_audit':'false','npm_config_fund':'false','NODE_OPTIONS':'--max-old-space-size=4096'}
        result['stage']='INSTALL';save()
        with (WORK/'install.log').open('wb') as log:
            install=subprocess.run([shutil.which('npm'),'ci','--ignore-scripts','--include=dev','--no-audit','--no-fund'],cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=360)
        result['installExitCode']=install.returncode;save();need(install.returncode==0,'TYPECHECK_DEPENDENCY_INSTALL_FAILED')
        need(sha(source/'package-lock.json')==LOCK_SHA,'TYPECHECK_LOCK_MUTATED')
        lock=json.loads((source/'package-lock.json').read_text());actual=json.loads((source/'node_modules/typescript/package.json').read_text());node_types=json.loads((source/'node_modules/@types/node/package.json').read_text())
        need(actual['version']==lock['packages']['node_modules/typescript']['version'] and node_types['version']==lock['packages']['node_modules/@types/node']['version'],'TYPECHECK_DEPENDENCY_VERSION_MISMATCH')
        result.update(stage='TYPES',compilerVersion=actual['version'],nodeTypesVersion=node_types['version'],packageLockSha256=LOCK_SHA,compilerSha256=sha(source/'node_modules/typescript/lib/tsc.js'));save()
        with (WORK/'types.log').open('wb') as log:
            types=subprocess.run([shutil.which('node'),str(source/'node_modules/typescript/bin/tsc'),'--noEmit','--skipLibCheck','--pretty','false'],cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=120)
        result['typesExitCode']=types.returncode;result['fullRepositoryTypesPassed']=types.returncode==0
        need(types.returncode==0,'TYPECHECK_REPOSITORY_TYPES_FAILED')
        result.update(state='PASSED',stage='COMPLETE');save()
    except BaseException as error:
        result['state']='FAILED';result['failureClass']=type(error).__name__
        text=str(error);result['failureCode']=text if text.startswith('TYPECHECK_') and text.replace('_','').isalnum() else 'TYPECHECK_UNCLASSIFIED_FAILURE'
        save();raise
if __name__=='__main__':
    try:main()
    except BaseException:
        print('REAL_TYPECHECK_PREPARATION_FAILED, see bounded public-source receipt and logs')
        raise SystemExit(1)
