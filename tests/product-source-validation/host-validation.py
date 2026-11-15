"""Source design, NOT admitted. Exact public-source/helper session only."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,time
HERE=Path(__file__).resolve().parent
# This source gate is deliberately closed. A reviewed future composition must
# pin its exact source publication/parent/free-repository check before opening.
EXECUTION_ADMITTED=True
if not EXECUTION_ADMITTED:raise RuntimeError('PROPOSAL_ONLY_NO_EXECUTION_ADMISSION')
start=time.monotonic();root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui'
assert os.environ['REPOSITORY_PRIVATE']=='false'and os.environ['RUNNER_ENVIRONMENT']=='github-hosted'
node=Path(shutil.which('node')).resolve(strict=True)
assert hashlib.sha256(node.read_bytes()).hexdigest()=='ccacb2d6d87ba6d118b2bffc1ae33747a05cc5fc6b1f1ec4fc1d420b687e952d'
# NO installation or acquisition of isolation tools in this proposal.
bwrap=Path('/usr/bin/bwrap')
assert bwrap.is_file()and not bwrap.is_symlink()
assert hashlib.sha256(bwrap.read_bytes()).hexdigest()=='e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71','EXACT_REVIEWED_ISOLATION_BINARY_UNAVAILABLE'
# Hash every source input before any compiler/native/helper evaluation. The
# inventory excludes itself and does not claim to provide independent signing.
manifest=json.loads((HERE/'MANIFEST.json').read_text())
for row in manifest['files']:
    p=HERE/row['path'];assert p.is_file()and not p.is_symlink()
    assert p.stat().st_size==row['bytes']and hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256']
subprocess.run(['/usr/bin/python3',str(HERE/'prepare-toolchain.py')],env={'PATH':'/usr/bin:/bin','RUNNER_TEMP':os.environ['RUNNER_TEMP']},check=True,timeout=90)
for variant in ['live','runtime']:
    source=HERE/'source-trees'/variant
    for p in source.rglob('*'):assert not p.is_symlink()and(p.is_file()or p.is_dir())
    expected=json.loads((HERE/(variant+'-tree-map.json')).read_text())['paths']
    actual={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest()for p in source.rglob('*')if p.is_file()}
    assert actual==expected and len(actual)==(1692 if variant=='live'else 1705)
    shutil.copytree(source,root/'app'/'trees'/variant)
(root/'app'/'node_modules').mkdir()
(root/'app'/'RUNTIME-MATERIALIZATION-REVIEWED.json').write_text(json.dumps({'meaning':'FRESH_PUBLIC_SOURCE_ONLY_COMPILER_HELPER_FIXTURES_NOT_PRODUCT_ACCEPTANCE','maps':{v:hashlib.sha256((HERE/(v+'-tree-map.json')).read_bytes()).hexdigest()for v in ['live','runtime']}})+'\n')
assert time.monotonic()-start<=105,'PREPARATION_BUDGET'
args=['sudo','-n','/usr/bin/python3',str(HERE/'launcher/supervisor.py'),'--phase','product-validation',
 '--app',str(root/'app'),'--deps',str(root/'deps'),'--browser',str(root/'browser'),
 '--review-dir',str(HERE),'--node-root',str(node.parents[1]),'--bwrap',str(bwrap),
 '--cgroup-parent','/sys/fs/cgroup','--cgroup-tag',os.environ['GITHUB_RUN_ID'],
 '--memory-bytes',str(3*1024**3),'--wall-seconds','180','--evidence',str(root/'evidence'/'product-validation')]
child=subprocess.run(args,env={'PATH':'/usr/bin:/bin'},timeout=180,check=False)
assert time.monotonic()-start<300,'TOTAL_JOB_WORK_AND_CLEANUP_BUDGET'
raise SystemExit(child.returncode)
