"""SOURCE ONLY preparation integration. Gate closed. Old route left intact."""
from pathlib import Path
import hashlib,json,os,shutil,signal,stat,subprocess,time
EXECUTION_ADMITTED=True
HERE=Path(__file__).resolve().parent
OLD=HERE.parent/'product-source-validation'
OLD_MANIFEST='ad8f28f8c1e4cc1437bc44dd2199b38d929b10141aac71ef6dc3028c99275c2c'

def main():
    assert EXECUTION_ADMITTED,'SOURCE_ONLY_NO_EXECUTION_ADMISSION'
    start=time.monotonic();root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui';assert not root.exists();root.mkdir(mode=0o700);evidence=root/'evidence';evidence.mkdir(mode=0o700)
    stage='PUBLIC_PLATFORM';failure=None;child=None;forced=False
    def remaining(reserve=0):
        value=105-(time.monotonic()-start)-reserve;assert value>0,'PREPARATION_BUDGET';return value
    try:
        assert os.environ['REPOSITORY_PRIVATE']=='false'and os.environ['RUNNER_ENVIRONMENT']=='github-hosted'
        stage='SOURCE_CUSTODY'
        for directory,expected in [(OLD,OLD_MANIFEST),(HERE,os.environ['DOCKER_SOURCE_MANIFEST_SHA256'])]:
            p=directory/'MANIFEST.json';assert hashlib.sha256(p.read_bytes()).hexdigest()==expected
            for row in json.loads(p.read_text())['files']:
                member=directory/row['path'];assert member.is_file()and not member.is_symlink()
                raw=member.read_bytes();assert len(raw)==row['bytes']and hashlib.sha256(raw).hexdigest()==row['sha256']
        assert(HERE/'driver/validate.cjs').read_bytes()==(OLD/'driver/validate.cjs').read_bytes()
        stage='NODE_IDENTITY';node=Path(shutil.which('node')).resolve(strict=True);assert hashlib.sha256(node.read_bytes()).hexdigest()=='ccacb2d6d87ba6d118b2bffc1ae33747a05cc5fc6b1f1ec4fc1d420b687e952d'
        stage='ENGINE_ANTI_DRIFT_PIN'
        docker=Path('/usr/bin/docker');info=docker.lstat();assert stat.S_ISREG(info.st_mode)and info.st_uid==0 and not info.st_mode&0o022
        digest=hashlib.sha256(docker.read_bytes()).hexdigest();assert len(digest)==64
        # This is only per-run anti-drift. Installed engine provenance rests on
        # separately qualified hosted-image trust, never this self-made hash.
        config={'sourceHead':'5c64ee5a7308934a5bedb271c9045015f0784b12','dockerSha256':digest,'freshRoot':str(root),'runId':os.environ['GITHUB_RUN_ID'],'reviewDir':str(OLD),'nodeRoot':str(node.parents[1])}
        configPath=evidence/'docker-reviewed-config-private.json';configPath.write_text(json.dumps(config)+'\n');configPath.chmod(0o600)
        stage='TOOLCHAIN'
        budget=min(75,remaining(20))
        child=subprocess.Popen(['/usr/bin/python3',str(OLD/'prepare-toolchain.py')],env={'PATH':'/usr/bin:/bin','RUNNER_TEMP':os.environ['RUNNER_TEMP'],'TOOLCHAIN_BUDGET_SECONDS':str(budget)},start_new_session=True)
        try:assert child.wait(timeout=budget)==0
        except BaseException:
            if child.poll()is None:forced=True;os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=2)
            raise
        stage='SOURCE_COPY'
        for variant in ['live','runtime']:
            source=OLD/'source-trees'/variant
            for p in source.rglob('*'):assert not p.is_symlink()and(p.is_file()or p.is_dir())
            expected=json.loads((OLD/(variant+'-tree-map.json')).read_text())['paths']
            assert {str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest()for p in source.rglob('*')if p.is_file()}==expected
            shutil.copytree(source,root/'app/trees'/variant)
        (root/'app/node_modules').mkdir()
        (root/'app/RUNTIME-MATERIALIZATION-REVIEWED.json').write_text(json.dumps({'scope':'PUBLIC_SOURCE_ONLY_NOT_PRODUCT_ACCEPTANCE'})+'\n')
        remaining();assert not forced
        phaseBudget=min(180,300-(time.monotonic()-start)-15);assert phaseBudget==180,'QUALIFICATION_DRIVER_CLEANUP_FIT_UNPROVEN'
        config['phaseBudgetSeconds']=phaseBudget;configPath.write_text(json.dumps(config)+'\n')
        stage='QUALIFICATION_THEN_UNCHANGED_DRIVER'
        # host-envelope owns its <=180s phase, including one <=15s safety
        # qualification before the original125s driver. No second qualification.
        child=subprocess.Popen(['/usr/bin/python3',str(HERE/'host-envelope.py')],env={'PATH':'/usr/bin:/bin','REVIEWED_DOCKER_ENVELOPE_CONFIG':str(configPath)},start_new_session=True)
        try:
            allowance=min(phaseBudget,300-(time.monotonic()-start)-15);assert allowance>0
            code=child.wait(timeout=allowance)
        except BaseException:
            if child.poll()is None:forced=True;os.killpg(child.pid,signal.SIGTERM)
            raise
        assert time.monotonic()-start<300
        if code:raise RuntimeError('ENVELOPE_OR_DRIVER_NONZERO')
        stage='COMPLETE_SCOPED_ONLY'
    except BaseException:failure='INCOMPLETE';raise
    finally:
        (evidence/'docker-host.json').write_text(json.dumps({'version':1,'stage':stage,'failure':failure,'forced':forced,'seconds':time.monotonic()-start,'productPass':False},sort_keys=True)+'\n')
if __name__=='__main__':main()
