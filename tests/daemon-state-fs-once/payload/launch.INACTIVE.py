"""INACTIVE complete once-only stage launcher. Explicit CLI only in future job.
External bootstrap hashes this file before import; every stage rechecks all pins.
No retry after UNKNOWN. Job exit is NOT proof of VM teardown.
"""
from pathlib import Path
import hashlib,importlib.util,json,os,re,shutil,stat,sys,time
HERE=Path(__file__).resolve().parent
STATE=Path('/run/daemon-fs-finite-once.json')
ROOT=Path('/tmp/daemon-fs-sealed')
def need(x,c):
 if not x:raise RuntimeError(c)
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def durable(path,v):
 raw=(json.dumps(v,sort_keys=True,indent=2)+'\n').encode();tmp=path.with_suffix('.pending');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:need(os.write(fd,raw)==len(raw),'LAUNCH_STATE_SHORT');os.fsync(fd)
 finally:os.close(fd)
 os.replace(tmp,path);d=os.open(path.parent,os.O_DIRECTORY)
 try:os.fsync(d)
 finally:os.close(d)
def verify(reviewroot):
 need(sha(HERE/'SHA256.json')==reviewroot,'LAUNCH_REVIEW_ROOT')
 rows=json.loads((HERE/'SHA256.json').read_text())
 for name,digest in rows.items():
  rel=Path(name);need(not rel.is_absolute() and '..' not in rel.parts,'LAUNCH_PATH');p=HERE/rel;need(p.is_file() and not p.is_symlink() and sha(p)==digest,'LAUNCH_PIN')
 return rows
def load(relative):
 spec=importlib.util.spec_from_file_location(relative.replace('/','_').replace('.','_'),HERE/relative);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def same_job(st,current):
 for k in ('runId','runAttempt','runnerName','runnerEnvironment','eventHead'):need(st['event'][k]==current[k],'LAUNCH_SAME_JOB_BINDING')
 if 'jobId' in st:need(st['jobId']==current['jobId'],'LAUNCH_SAME_JOB_ID')
def root_stage(stage,reviewroot,argument=None):
 rows=verify(reviewroot);need(os.geteuid()==0 and HERE==ROOT,'LAUNCH_ROOT_SEALED_LOCATION');need(HERE.stat().st_uid==0 and not HERE.stat().st_mode&0o022,'LAUNCH_ROOT_CUSTODY')
 for name in rows:
  st=(HERE/name).lstat();need(st.st_uid==0 and st.st_nlink==1 and not st.st_mode&0o022,'LAUNCH_CODE_CUSTODY')
 pins=json.loads((HERE/'COMPONENT-PINS.json').read_text());producer_root=pins['producerRootSha256'];offline_root=pins['offlineRootSha256']
 if stage=='assemble':
  need(not STATE.exists(),'NO_SECOND_ATTEMPT_SAME_VM');event=json.loads((HERE/'event.json').read_text());need(event['runAttempt']==1 and event['runnerEnvironment']=='github-hosted','LAUNCH_HOSTED_FIRST_ATTEMPT')
  state={'state':'ASSEMBLY_ATTEMPTED','event':event,'reviewRootSha256':reviewroot,'secondAttemptForbidden':True,'vmTeardownProved':False,'retainedResourcesPossible':True};durable(STATE,state)
 else:
  need(STATE.is_file() and STATE.stat().st_uid==0 and stat.S_IMODE(STATE.stat().st_mode)==0o600,'LAUNCH_STATE_CUSTODY');state=json.loads(STATE.read_text());need(state['reviewRootSha256']==reviewroot,'LAUNCH_STATE_ROOT');need(stage=='export' or state['state']!='UNKNOWN_TEARDOWN_REQUIRED','NO_SECOND_ATTEMPT_AFTER_UNKNOWN')
 try:
  if stage=='assemble':
   result=load('producer/producer.INACTIVE.py').assemble(HERE/'inputs/layers',HERE/'source.tar.gz',producer_root);state.update(state='ASSEMBLED',assembly=result)
  elif stage=='prepare':
   need(state['state']=='ASSEMBLED','LAUNCH_ORDER_PREPARE');expected=json.loads((HERE/'prepare-context.expected.json').read_text());same_job(state,expected);state['jobId']=expected['jobId'];state['state']='PREPARATION_ATTEMPTED';durable(STATE,state)
   value=load('producer/producer.INACTIVE.py').prepare(state['assembly']['assemblyReceipt'],state['assembly']['assemblyReceiptSha256'],producer_root,HERE/'prepare-context.json',expected);state['preparation']=value;need(value['result']['state']=='PREPARED_FULLTYPES_ONLY','PREPARATION_UNKNOWN_OR_FAILED');state['state']='PREPARED'
  elif stage=='offline-assemble':
   need(state['state']=='PREPARED','LAUNCH_ORDER_OFFLINE_ASSEMBLY');state['state']='OFFLINE_ASSEMBLY_ATTEMPTED';durable(STATE,state);prep=state['preparation'];envelope=Path(prep['receipt']);result=load('offline/isolated-controller.INACTIVE.py').assemble_offline(HERE/'inputs/native-original.zip',envelope,sha(envelope),offline_root,HERE/'producer',producer_root);state.update(state='OFFLINE_ASSEMBLED',offlineAssembly=result)
  elif stage=='offline':
   need(state['state']=='OFFLINE_ASSEMBLED','LAUNCH_ORDER_OFFLINE');expected=json.loads((HERE/'offline-context.expected.json').read_text());same_job(state,expected);state['state']='OFFLINE_ATTEMPTED';durable(STATE,state)
   value=load('offline/isolated-controller.INACTIVE.py').run(state['offlineAssembly']['receipt'],state['offlineAssembly']['sha256'],offline_root,HERE/'offline-context.json',expected);state['offline']=value;need(value['result']['state']=='PASS_FS_HELPER_OWNER_11_ONLY','OFFLINE_UNKNOWN_OR_FAILED');state['state']='PASS_FULLTYPES_AND_FS11_ONLY';state['retainedResourcesPossible']=True
  elif stage=='export':
   return export_selected(state)
  else:raise RuntimeError('LAUNCH_STAGE')
  durable(STATE,state);return state
 except BaseException as error:
  state.update(state='UNKNOWN_TEARDOWN_REQUIRED',failureClass=type(error).__name__,retainedResourcesPossible=True,vmTeardownProved=False);durable(STATE,state);raise

def export_selected(state):
 # May run after UNKNOWN, but never mutates/stops resources or retries stages.
 target=Path('/tmp/daemon-fs-final-selected');need(not target.exists(),'EXPORT_ALREADY_EXISTS');target.mkdir(mode=0o755);count=0;total=0;entries=[]
 names={'types-receipt.json':32768,'types-install.log':1048576,'types-types.log':1048576,'preparation.log':1048576,'network-proof.json':262144,'network-ledger.json':262144,'network-ledger-before-cleanup.json':262144,'preparation-closure.json':32768,'closeout.json':262144,'contracts.log':1048576,'ready.json':1024,'attempted.json':1024}
 for phase,key in (('prepare','preparation'),('offline','offline')):
  value=state.get(key)
  if value:receipt=Path(value['receipt'])
  elif key=='preparation' and state.get('assembly'):receipt=Path(state['assembly']['assemblyReceipt']).parent/'closeout.json'
  elif key=='offline' and state.get('offlineAssembly'):receipt=Path(state['offlineAssembly']['receipt']).parent/'closeout.json'
  else:continue
  directory=receipt.parent/'selected'
  if not directory.is_dir():continue
  dest=target/phase;dest.mkdir(mode=0o755)
  for source in directory.iterdir():
   if source.name not in names:continue
   need(source.is_file() and not source.is_symlink(),'EXPORT_SOURCE_TYPE');limit=names[source.name]
   with source.open('rb') as f:raw=f.read(limit+1)
   partial=len(raw)>limit;(dest/source.name).write_bytes(raw[:limit]);count+=1;total+=len(raw[:limit]);need(count<=32 and total<=12582912,'EXPORT_TOTAL_BOUND');entries.append({'phase':phase,'file':source.name,'bytes':len(raw[:limit]),'partial':partial,'sha256':sha(dest/source.name)})
 # Scalar projection only, never whole launch/context/token/instructions artifact.
 status={'state':('PASS_FULLTYPES_AND_FS11_ONLY' if state['state']=='PASS_FULLTYPES_AND_FS11_ONLY' else 'UNKNOWN_TEARDOWN_REQUIRED'),'lastDurableLauncherStage':state['state'],'scope':'FULL_REPOSITORY_TYPES_AND_ELEVEN_FS_HELPER_OWNER_CONTRACTS_ONLY','fullApplicationValidated':False,'allShutdownValidated':False,'daemonIntegrationValidated':False,'vmTeardownProved':False,'retainedResourcesPossible':True,'noSecondAttemptSameVM':True,'selected':entries,'partial':any(x['partial'] for x in entries)}
 if status['partial']:status['state']='UNKNOWN_TEARDOWN_REQUIRED'
 (target/'summary.json').write_text(json.dumps(status,sort_keys=True,indent=2)+'\n');return status
if __name__=='__main__':
 need(len(sys.argv)==3,'LAUNCH_ARGUMENTS');root_stage(sys.argv[1],sys.argv[2])
