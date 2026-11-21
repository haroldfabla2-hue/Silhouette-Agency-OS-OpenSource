"""INACTIVE externally pinned bootstrap. Standard library only until all pins hold.
Explicit future CLI stages: seal, collect-context, seal-context, root-stage.
"""
from pathlib import Path
import hashlib,importlib.util,json,os,re,shutil,stat,sys
HERE=Path(__file__).resolve().parent
SEALED=Path('/tmp/daemon-fs-sealed')
def need(x,c):
 if not x:raise RuntimeError(c)
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def verify(directory,root):
 need(re.fullmatch('[a-f0-9]{64}',root) and sha(directory/'SHA256.json')==root,'BOOTSTRAP_ROOT_PIN');rows=json.loads((directory/'SHA256.json').read_text())
 for name,digest in rows.items():
  rel=Path(name);need(not rel.is_absolute() and '..' not in rel.parts,'BOOTSTRAP_PATH');p=directory/rel;need(p.is_file() and not any(q.is_symlink() for q in (p,*p.parents)) and sha(p)==digest,'BOOTSTRAP_PAYLOAD_PIN')
 pins=json.loads((directory/'COMPONENT-PINS.json').read_text())
 for name,key in (('producer','producerRootSha256'),('offline','offlineRootSha256')):
  need(sha(directory/name/'SHA256.json')==pins[key],'BOOTSTRAP_COMPONENT_ROOT')
  for rel,digest in json.loads((directory/name/'SHA256.json').read_text()).items():need(sha(directory/name/rel)==digest,'BOOTSTRAP_COMPONENT_FILE')
 manifest=json.loads((directory/'producer/node-linux-amd64-manifest.json').read_text());need(sha(directory/'producer/node-linux-amd64-manifest.json')=='bb6834c0669aa71cbc8d94606561a721adf489f6b93d7b8b825f0cf1b498c2c4','BOOTSTRAP_OCI_MANIFEST')
 need(sha(directory/'source.tar.gz')=='dbb88bfb85a1111c7c8cf1c1c9359e55a2f4da1d66e9940ef0d62723632a5c2b','BOOTSTRAP_SOURCE');return rows,manifest

def event():
 value={'runId':int(os.environ['GITHUB_RUN_ID']),'runAttempt':int(os.environ['GITHUB_RUN_ATTEMPT']),'eventHead':os.environ['GITHUB_SHA'],'runnerName':os.environ['RUNNER_NAME'],'runnerEnvironment':os.environ['RUNNER_ENVIRONMENT']}
 need(os.environ['GITHUB_REPOSITORY']=='haroldfabla2-hue/Silhouette-Agency-OS-OpenSource' and os.environ['GITHUB_EVENT_NAME']=='push' and os.environ['GITHUB_REF']=='refs/heads/fix/shutdown-contracts-narrow-20261117','BOOTSTRAP_EVENT_SCOPE');need(value['runAttempt']==1 and value['runnerEnvironment']=='github-hosted' and re.fullmatch('[a-f0-9]{40}',value['eventHead']),'BOOTSTRAP_EVENT_VALUES');return value

def seal(root,inputs,event_path):
 rows,manifest=verify(HERE,root);need(os.geteuid()==0 and not SEALED.exists() and not Path('/run/daemon-fs-finite-once.json').exists(),'BOOTSTRAP_NO_SECOND_VM_ATTEMPT');expected=json.loads(Path(event_path).read_text());need(expected['runAttempt']==1 and expected['runnerEnvironment']=='github-hosted','BOOTSTRAP_FIRST_HOSTED')
 SEALED.mkdir(mode=0o700)
 for rel in ['SHA256.json',*rows]:
  dest=SEALED/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(HERE/rel,dest);dest.chmod(0o600)
 inp=Path(inputs);out=SEALED/'inputs';(out/'layers').mkdir(mode=0o700,parents=True)
 for row in manifest['layers']:
  digest=row['digest'].split(':')[1];src=inp/'layers'/(digest+'.tar.gz');need(src.is_file() and not src.is_symlink() and src.stat().st_size==row['size'] and sha(src)==digest,'BOOTSTRAP_OCI_LAYER_PIN');dest=out/'layers'/src.name;shutil.copyfile(src,dest);dest.chmod(0o400);need(sha(dest)==digest,'BOOTSTRAP_OCI_COPY_PIN')
 src=inp/'native-original.zip';need(src.is_file() and not src.is_symlink() and src.stat().st_size==181155369 and sha(src)=='a549abd2f6a03266566ee14df09ba93882ff94458bdc514bc015bb3e31ea13d4','BOOTSTRAP_NATIVE_PIN');shutil.copyfile(src,out/src.name);(out/src.name).chmod(0o400)
 (SEALED/'event.json').write_text(json.dumps(expected));(SEALED/'event.json').chmod(0o600);verify(SEALED,root)
 # Collector imports only already verified code; this directory is read-only
 # to runner, with only public source/toolchain/code, never account tokens.
 for d in [SEALED,*[p for p in SEALED.rglob('*') if p.is_dir()]]:d.chmod(0o755)
 for p in SEALED.rglob('*'):
  if p.is_file():p.chmod(0o644 if p.relative_to(SEALED).as_posix() in rows or p.name=='SHA256.json' else 0o600)

def collect_context(root,phase):
 need(phase in ('prepare','offline') and os.geteuid()!=0,'CONTEXT_UNPRIVILEGED_PHASE');verify(SEALED,root);expected=event();path=Path('/tmp/daemon-fs-'+phase+'-context.json');spec=importlib.util.spec_from_file_location('verified_context',SEALED/'offline/context-snapshot.INACTIVE.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);expected.update(m.collect(path,expected));expected_path=Path('/tmp/daemon-fs-'+phase+'-context.expected.json');need(not expected_path.exists(),'CONTEXT_EXPECTED_EXISTS');expected_path.write_text(json.dumps(expected));expected_path.chmod(0o600)

def seal_context(root,phase):
 need(os.geteuid()==0 and phase in ('prepare','offline'),'SEAL_CONTEXT_PHASE');verify(SEALED,root)
 for suffix in ('.json','.expected.json'):
  source=Path('/tmp/daemon-fs-'+phase+'-context'+suffix);need(source.is_file() and not source.is_symlink() and source.stat().st_nlink==1 and source.stat().st_size<=32768,'SEAL_CONTEXT_SOURCE');dest=SEALED/(phase+'-context'+suffix);need(not dest.exists(),'SEAL_CONTEXT_ONCE');shutil.copyfile(source,dest);dest.chmod(0o600)

def root_stage(root,stage):
 need(os.geteuid()==0,'ROOT_STAGE_UID');verify(SEALED,root);spec=importlib.util.spec_from_file_location('verified_launcher',SEALED/'launch.INACTIVE.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.root_stage(stage,root)
def main():
 need(len(sys.argv)>=3,'BOOTSTRAP_ARGUMENTS');action,root=sys.argv[1:3]
 if action=='acquire':
  verify(HERE,root);spec=importlib.util.spec_from_file_location('verified_transport',HERE/'acquire-public.INACTIVE.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.acquire(sys.argv[3])
 elif action=='event':verify(HERE,root);Path(sys.argv[3]).write_text(json.dumps(event()))
 elif action=='seal':seal(root,sys.argv[3],sys.argv[4])
 elif action=='collect-context':collect_context(root,sys.argv[3])
 elif action=='seal-context':seal_context(root,sys.argv[3])
 elif action=='root-stage':root_stage(root,sys.argv[3])
 else:raise RuntimeError('BOOTSTRAP_ACTION')

if __name__=='__main__':
 try:main()
 except BaseException as error:raise SystemExit('BOOTSTRAP_FAILED_'+type(error).__name__) from None
