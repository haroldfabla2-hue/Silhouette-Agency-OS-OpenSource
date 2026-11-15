"""SOURCE PROPOSAL ONLY. Isolated public-source compiler/helper session."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,time,signal,resource
HERE=Path(__file__).resolve().parent
EXECUTION_ADMITTED=True
if not EXECUTION_ADMITTED:raise RuntimeError('PROPOSAL_ONLY_NO_EXECUTION_ADMISSION')
start=time.monotonic();root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui'
# One fresh owned evidence root exists before the first checked prerequisite.
assert not root.exists();root.mkdir(mode=0o700);evidence=root/'evidence';evidence.mkdir(mode=0o700)
stage='PLATFORM';failure=None;child=None

def budget(reserve=0):
    remaining=105-(time.monotonic()-start)-reserve
    if remaining<=0:raise TimeoutError('PREPARATION_BUDGET')
    return remaining

def security_stage():
    global child
    # Reuse the exact signed Ubuntu staging workflow. Private logs only.
    # Parent wrapper and helper time bounds are shorter, never longer.
    log=evidence/'security-preparation.log';first=None;forced=False;cleanup=[]
    def security_limits():
        resource.setrlimit(resource.RLIMIT_CORE,(0,0))
        resource.setrlimit(resource.RLIMIT_FSIZE,(2*1024**2,2*1024**2))
    with log.open('xb')as output:
        try:
            child=subprocess.Popen(['/usr/bin/python3',str(HERE/'prepare-security.py'),str(evidence),os.environ['GITHUB_RUN_ID']],stdout=output,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=security_limits,env={'PATH':'/usr/bin:/bin','RUNNER_TEMP':os.environ['RUNNER_TEMP']})
            code=child.wait(timeout=min(30,budget(65)))
            if code!=0:raise RuntimeError('CHILD_NONZERO')
        except BaseException as error:first=error
        finally:
            if child is not None:
                try:
                    os.killpg(child.pid,0);forced=True
                    os.killpg(child.pid,signal.SIGTERM)
                except ProcessLookupError:pass
                except BaseException as error:cleanup.append(error)
                try:child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    forced=True
                    try:os.killpg(child.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    except BaseException as error:cleanup.append(error)
                    try:child.wait(timeout=3)
                    except BaseException as error:cleanup.append(error)
                except BaseException as error:cleanup.append(error)
        if first is not None:raise first
        if forced or cleanup:raise RuntimeError('SECURITY_GROUP_CLEANUP_INCOMPLETE')
    assert log.stat().st_size<=2*1024**2
    result=json.loads((evidence/'security-preparation.json').read_text())
    assert result['status']=='AUTHENTICATED_STAGED_NOT_RUNTIME_PASS'and result['rootKeyScopeAbsent']is True and result['forced']is False and result['cleanupErrors']==[]
    helpers=json.loads((evidence/'security-helpers-state.json').read_text())
    assert helpers['status']=='SAFE'and helpers['active']==[]and helpers['sticky_unsafe']is False
    binary=Path(result['binary']);expected=Path(os.environ['RUNNER_TEMP'])/('integrated-bwrap-stage-'+os.environ['GITHUB_RUN_ID'])/'bin/bwrap'
    assert binary==expected and binary.is_file()and not binary.is_symlink()
    assert hashlib.sha256(binary.read_bytes()).hexdigest()=='e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71'
    return binary

try:
    assert os.environ['REPOSITORY_PRIVATE']=='false'and os.environ['RUNNER_ENVIRONMENT']=='github-hosted'
    stage='NODE_IDENTITY';node=Path(shutil.which('node')).resolve(strict=True)
    assert hashlib.sha256(node.read_bytes()).hexdigest()=='ccacb2d6d87ba6d118b2bffc1ae33747a05cc5fc6b1f1ec4fc1d420b687e952d'
    stage='SOURCE_IDENTITY';manifest=json.loads((HERE/'MANIFEST.json').read_text())
    for row in manifest['files']:
        p=HERE/row['path'];assert p.is_file()and not p.is_symlink()
        assert p.stat().st_size==row['bytes']and hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256']
    stage='ISOLATION_STAGING';bwrap=security_stage()
    stage='TOOLCHAIN'
    remaining=min(75,budget(15));assert remaining>0
    subprocess.run(['/usr/bin/python3',str(HERE/'prepare-toolchain.py')],env={'PATH':'/usr/bin:/bin','RUNNER_TEMP':os.environ['RUNNER_TEMP'],'TOOLCHAIN_BUDGET_SECONDS':str(remaining)},check=True,timeout=remaining)
    stage='SOURCE_COPY'
    for variant in ['live','runtime']:
        source=HERE/'source-trees'/variant
        for p in source.rglob('*'):assert not p.is_symlink()and(p.is_file()or p.is_dir())
        expected=json.loads((HERE/(variant+'-tree-map.json')).read_text())['paths']
        actual={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest()for p in source.rglob('*')if p.is_file()}
        assert actual==expected and len(actual)==(1692 if variant=='live'else 1705)
        shutil.copytree(source,root/'app'/'trees'/variant)
    (root/'app'/'node_modules').mkdir()
    (root/'app'/'RUNTIME-MATERIALIZATION-REVIEWED.json').write_text(json.dumps({'meaning':'FRESH_PUBLIC_SOURCE_ONLY_COMPILER_HELPER_FIXTURES_NOT_PRODUCT_ACCEPTANCE','maps':{v:hashlib.sha256((HERE/(v+'-tree-map.json')).read_bytes()).hexdigest()for v in ['live','runtime']}})+'\n')
    budget();stage='SUPERVISOR'
    args=['sudo','-n','/usr/bin/python3',str(HERE/'launcher/supervisor.py'),'--phase','product-validation','--app',str(root/'app'),'--deps',str(root/'deps'),'--browser',str(root/'browser'),'--review-dir',str(HERE),'--node-root',str(node.parents[1]),'--bwrap',str(bwrap),'--cgroup-parent','/sys/fs/cgroup','--cgroup-tag',os.environ['GITHUB_RUN_ID'],'--memory-bytes',str(3*1024**3),'--wall-seconds','180','--evidence',str(evidence/'product-validation')]
    outcome=subprocess.run(args,env={'PATH':'/usr/bin:/bin'},timeout=180,check=False)
    assert time.monotonic()-start<300,'TOTAL_JOB_WORK_AND_CLEANUP_BUDGET'
    if outcome.returncode:raise RuntimeError('CHILD_NONZERO')
    stage='COMPLETE'
except BaseException as error:
    failure='BUDGET'if isinstance(error,(TimeoutError,subprocess.TimeoutExpired))else'CHILD_NONZERO'if type(error)is RuntimeError and str(error)=='CHILD_NONZERO'else'INCOMPLETE'
    raise
finally:
    # Fixed evidence only. No raw exception names/messages or machine paths.
    (evidence/'host-validation.json').write_text(json.dumps({'version':1,'stage':stage,'failure':failure,'productPass':False},sort_keys=True)+'\n')
