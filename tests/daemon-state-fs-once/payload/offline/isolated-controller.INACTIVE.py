"""INACTIVE finite isolated FS contract controller. Explicit reviewed run() only.
No online download, service start, test import or execution on module import.
"""
from pathlib import Path
import hashlib,importlib.util,json,os,re,secrets,shutil,stat,subprocess,tarfile,time,zipfile
HERE=Path(__file__).resolve().parent
BASE='cd0066be67748f5948515bf3d20e6edc36d7b7c0'
ARCHIVE_SHA='119565c089bfc576ee9a96c5c785dba4eebdcdce9117c63ea3d3a41c4ab52e39'
LOCK='f8cad2766f4c9d32310625e8951a53f17355c94409424aeb917e6ad5c01e9512'
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','HOME':'/tmp'}
def need(x,code):
 if not x:raise RuntimeError(code)
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as s:
  for b in iter(lambda:s.read(1048576),b''):h.update(b)
 return h.hexdigest()
def bounded(p,limit):
 p=Path(p);need(p.is_file() and not p.is_symlink(),'EVIDENCE_TYPE')
 with p.open('rb') as f:b=f.read(limit+1)
 need(len(b)<=limit,'EVIDENCE_BOUND');return b
def durable(p,v):
 raw=(json.dumps(v,sort_keys=True,indent=2)+'\n').encode();tmp=p.with_suffix('.tmp');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:need(os.write(fd,raw)==len(raw),'RECEIPT_SHORT');os.fsync(fd)
 finally:os.close(fd)
 os.replace(tmp,p);fd=os.open(p.parent,os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def command(*argv,timeout=5):
 p=subprocess.run(argv,env=ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 need(len(p.stdout)<=262144 and len(p.stderr)<=65536,'COMMAND_REPLY_BOUND');need(p.returncode==0,'HOST_COMMAND_FAILED');return p.stdout.decode().strip()
def verify(expected_root):
 need(re.fullmatch('[a-f0-9]{64}',expected_root) and sha(HERE/'SHA256.json')==expected_root,'ROOT_MANIFEST_PIN')
 rows=json.loads(bounded(HERE/'SHA256.json',262144));need(len(rows)<=128,'PACKAGE_COUNT')
 for rel,wanted in rows.items():
  p=Path(rel);need(not p.is_absolute() and '..' not in p.parts,'PACKAGE_PATH');target=HERE/p
  need(not any(q.is_symlink() for q in [target,*target.parents] if q!=HERE.parent),'PACKAGE_SYMLINK')
  need(target.is_file() and sha(target)==wanted,'PACKAGE_HASH')
 return rows
def module(rel,name):
 spec=importlib.util.spec_from_file_location(name,HERE/rel);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def _prepare_inside_unit(*args,**kwargs):
 raise RuntimeError('ONLINE_ISOLATION_TOOLCHAIN_SOURCE_PRODUCER_NOT_IMPLEMENTED')
PROPS='Id,InvocationID,NRestarts,LoadState,ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,MainPID,ControlPID,ControlGroup,Type,ExitType,RemainAfterExit,User,Group,RootDirectory,PrivateNetwork,PrivateDevices,NoNewPrivileges,CapabilityBoundingSet,AmbientCapabilities,ProtectSystem,ProtectHome,KillMode,Restart,RuntimeMaxUSec,TimeoutStopUSec,OOMPolicy,OOMScoreAdjust,MemoryMax,MemorySwapMax,TasksMax,CPUQuotaPerSecUSec,CPUQuotaPeriodUSec'
def check_deadline(deadline):
 if deadline is not None:need(time.monotonic()<deadline,'HOST_DEADLINE_EXPIRED')
def state(unit,deadline=None):
 check_deadline(deadline);budget=5 if deadline is None else min(5,deadline-time.monotonic());need(budget>0,'HOST_NO_REMAINING_BUDGET')
 value=command('/usr/bin/systemctl','show',unit,'--property='+PROPS,timeout=budget);check_deadline(deadline)
 return dict(x.split('=',1) for x in value.splitlines())
def publish_permit(work,value,anchor,deadline):
 # Mode/ownership/fsync all complete BEFORE the atomic rename visible to gate.
 check_deadline(deadline);pending=work/'permit.pending';fd=os.open(pending,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o400)
 raw=(json.dumps(value)+'\n').encode()
 try:need(os.write(fd,raw)==len(raw),'PERMIT_SHORT_WRITE');os.fsync(fd);os.fchown(fd,1000,1000)
 finally:os.close(fd)
 anchor.continuity();check_deadline(deadline);os.rename(pending,work/'permit.json');directory=os.open(work,os.O_DIRECTORY)
 try:os.fsync(directory)
 finally:os.close(directory)

def make_root(archive,root,source):
 need(Path(archive).is_file() and not Path(archive).is_symlink() and Path(archive).stat().st_size==181155369 and sha(archive)=='a549abd2f6a03266566ee14df09ba93882ff94458bdc514bc015bb3e31ea13d4','NATIVE_ORIGINAL_ZIP_PIN');rows=json.loads((HERE/'NATIVE-ROOTFS.json').read_text());wanted={r['target'].lstrip('/'):r for r in rows};need(len(wanted)==594,'NATIVE_COUNT');seen=set();root.mkdir(mode=0o755)
 with zipfile.ZipFile(archive) as saved:
  names=saved.namelist();need(len(names)==len(set(names)) and len(names)<=7000,'NATIVE_ZIP_PATH_COUNT')
  for name,row in wanted.items():
   origin='hydration-gates-capsule-review/runtime/'+('opt/hostedtoolcache/node/22.18.0/x64/bin/node' if name=='usr/bin/node' else name);info=saved.getinfo(origin);need(info.file_size==row['bytes'] and not stat.S_ISLNK(info.external_attr>>16),'NATIVE_ZIP_METADATA');target=root/name;target.parent.mkdir(parents=True,exist_ok=True)
   with saved.open(info) as inp,target.open('xb') as out:shutil.copyfileobj(inp,out)
   need(sha(target)==row['sha256'],'NATIVE_ZIP_FILE_PIN');target.chmod(row['mode']);seen.add(name)
 need(seen==set(wanted),'NATIVE_MISSING')
 pins=json.loads((HERE/'TEST-SOURCE-PINS.json').read_text())
 # Runtime has no repository tree/node_modules at all except these originals.
 for rel in ('package.json','services/daemon/serializedStateWriter.js','services/daemon/daemonStateOwner.js','tests/daemon-state-writer/contracts.node.cjs'):
  src=source/rel;need(src.is_file() and not src.is_symlink() and sha(src)==pins[rel],'TEST_SOURCE_PIN');dest=root/'source'/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(src.read_bytes());dest.chmod(0o444)
 for rel in ('admission-pre-node.INACTIVE.py','runtime-marker.cjs'):(root/rel).write_bytes((HERE/rel).read_bytes());(root/rel).chmod(0o444)
 for rel in ('proc','sys','run','dev','tmp','work'):(root/rel).mkdir(mode=0o755,exist_ok=True)
 # Exact no-extra-files closure, no symlinks. Product imports cannot reach daemon.
 expected={r['target'].lstrip('/') for r in rows}|{'source/'+r for r in ('package.json','services/daemon/serializedStateWriter.js','services/daemon/daemonStateOwner.js','tests/daemon-state-writer/contracts.node.cjs')}|{'admission-pre-node.INACTIVE.py','runtime-marker.cjs'}
 need({p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}==expected,'ROOT_EXTRA_FILES')
 need(not any(p.is_symlink() for p in root.rglob('*')),'ROOT_SYMLINK')
 return {'files':len(expected),'nativeManifestSha256':sha(HERE/'NATIVE-ROOTFS.json'),'sourcePins':{r:pins[r] for r in pins if r!='tsconfig.json'}}
def stable_terminal_before_oom(anchor,manager,result,receipt):
 # Empty identity proof establishes stable evidence before independent OOM oracle.
 result['terminal']=anchor.prove_empty(manager);result['cleanupSafe']=True
 durable(receipt,result)
 return result['terminal']
def assemble_offline(archive,preparation_closeout,preparation_closeout_sha,expected_root,producer_root,producer_root_sha):
 verify(expected_root);need(os.geteuid()==0,'ISOLATION_NEEDS_DISPOSABLE_ROOT')
 context=json.loads(bounded(Path(preparation_closeout),1048576))['publicContext']
 contracts=module('receipt-contract.INACTIVE.py','frozen_receipt_contract')
 envelope_path=Path(preparation_closeout);need(sha(envelope_path)==preparation_closeout_sha,'PREPARATION_ENVELOPE_PIN');envelope=json.loads(bounded(envelope_path,1048576));contracts.validate_envelope(envelope,context,producer_root_sha)
 receipt_path=Path(envelope['preparationReceipt']);preparation_sha=envelope['preparationReceiptSha256'];need(sha(receipt_path)==preparation_sha,'PREPARATION_RECEIPT_PIN');prep=json.loads(bounded(receipt_path,32768));contracts.validate_types(prep,sha(HERE/'candidate/candidate.patch'))
 producer_root=Path(producer_root);producer_manifest=producer_root/'SHA256.json';need(sha(producer_manifest)==producer_root_sha,'PRODUCER_ROOT_HANDOFF_PIN')
 for rel,wanted in json.loads(producer_manifest.read_text()).items():
  path=producer_root/rel;need(not Path(rel).is_absolute() and '..' not in Path(rel).parts and path.is_file() and not path.is_symlink() and sha(path)==wanted,'PRODUCER_HANDOFF_BYTES')
 producer_contract=producer_root/'producer-contract.INACTIVE.py';spec=importlib.util.spec_from_file_location('sealed_producer_contract',producer_contract);pc=importlib.util.module_from_spec(spec);spec.loader.exec_module(pc)
 producer_base=envelope_path.parent;closure_path=producer_base/'validation/PREPARATION-CLOSURE.json';need(sha(closure_path)==envelope['preparationClosureSha256'],'HANDOFF_CLOSURE_HASH');closure=json.loads(bounded(closure_path,32768));pc.validate(envelope,closure,producer_root_sha,prep)
 for field,filename in (('ociInventorySha256','OCI-FINAL-LOGICAL-INVENTORY.json'),('modeOverlaySha256','MODE-OVERLAY.json'),('ownerOverlaySha256','OWNER-OVERLAY.json'),('sourceManifestSha256','PUBLIC-SOURCE-MANIFEST.json'),('toolchainPinsSha256','TOOLCHAIN-PINS.json')):need(closure.get(field)==sha(producer_root/filename),'HANDOFF_CLOSURE_EXACT_PIN')
 need(closure.get('effectiveManifestSha256')==envelope.get('rootfs',{}).get('effectiveManifestSha256') and re.fullmatch('[a-f0-9]{64}',closure.get('effectiveManifestSha256','')),'HANDOFF_EFFECTIVE_OCI_BINDING')
 need(closure.get('sourceArchiveSha256')=='dbb88bfb85a1111c7c8cf1c1c9359e55a2f4da1d66e9940ef0d62723632a5c2b','HANDOFF_SOURCE_ARCHIVE')
 final_ledger=envelope.get('networkLedgerFinal',{});need(final_ledger.get('copiedAfterCleanupAttempt') is True and final_ledger.get('file')=='network-ledger.json','HANDOFF_LEDGER_NOT_FINAL');need(sha(producer_base/'selected/network-ledger.json')==final_ledger.get('sha256'),'HANDOFF_FINAL_LEDGER_HASH')
 work_source=producer_base/'work';mounts=[line for line in Path('/proc/self/mountinfo').read_text().splitlines() if line.split()[4]==str(work_source)];need(len(mounts)==1 and 'ro' in mounts[0].split()[5].split(',') and mounts[0].split(' - ')[1].split()[0]=='tmpfs','HANDOFF_SOURCE_NOT_READONLY_TMPFS')
 need(envelope.get('workRemountedReadOnly') is True,'HANDOFF_SOURCE_RO_RECEIPT')
 need(envelope.get('cleanupSafe') is True and envelope.get('ownedNetworkRemoved') is True and envelope.get('ownedUnitRemoved') is True,'HANDOFF_PREPARATION_NOT_TERMINAL_CLEAN')
 observer=module('anchored-cgroup.INACTIVE.py','fs_cgroup');source=work_source/'source'
 for rel,wanted in json.loads((HERE/'TEST-SOURCE-PINS.json').read_text()).items():need(sha(source/rel)==wanted,'HANDOFF_ACTUAL_SOURCE_PINS')
 base=Path('/tmp')/('daemon-state-fs-'+secrets.token_hex(8));base.mkdir(mode=0o700);work=base/'work';tmp=base/'tmp';root=base/'root';work.mkdir();tmp.mkdir();receipt=base/'closeout.json';unit='daemon-state-fs-'+secrets.token_hex(8)+'.service';unitfile=Path('/run/systemd/system')/unit
 assembled_root=make_root(archive,root,source);value={'kind':'OFFLINE_PUBLIC_ROOT_DATA_ONLY','rootfs':assembled_root,'base':str(base),'producerReviewRootSha256':producer_root_sha,'preparationEnvelopeSha256':preparation_closeout_sha,'preparationEnvelope':str(envelope_path),'typesReceipt':str(receipt_path),'typesReceiptSha256':preparation_sha,'offlineReviewRootSha256':expected_root};durable(base/'assembly.json',value);return {'receipt':str(base/'assembly.json'),'sha256':sha(base/'assembly.json')}

def run(offline_assembly,offline_assembly_sha,expected_root,context_path,expected_context):
 verify(expected_root);need(os.geteuid()==0,'ISOLATION_NEEDS_DISPOSABLE_ROOT');assembly_path=Path(offline_assembly);need(sha(assembly_path)==offline_assembly_sha and assembly_path.stat().st_uid==0 and not assembly_path.stat().st_mode&0o077,'OFFLINE_ASSEMBLY_CUSTODY');assembled=json.loads(bounded(assembly_path,32768));need(assembled['offlineReviewRootSha256']==expected_root,'OFFLINE_ASSEMBLY_ROOT_BINDING');base=Path(assembled['base']);need(base==assembly_path.parent and re.fullmatch('/tmp/daemon-state-fs-[a-f0-9]{16}',str(base)) and base.stat().st_uid==0 and not base.stat().st_mode&0o077,'OFFLINE_ASSEMBLY_PATH');root=base/'root';work=base/'work';tmp=base/'tmp';receipt=base/'closeout.json';unit='daemon-state-fs-'+secrets.token_hex(8)+'.service';unitfile=Path('/run/systemd/system')/unit;receipt_path=Path(assembled['typesReceipt']);preparation_sha=assembled['typesReceiptSha256'];preparation_closeout_sha=assembled['preparationEnvelopeSha256'];producer_root_sha=assembled['producerReviewRootSha256'];context=module('context-snapshot.INACTIVE.py','runtime_context').read_for_root(context_path,expected_context);envelope=json.loads(bounded(Path(assembled['preparationEnvelope']),1048576));module('receipt-contract.INACTIVE.py','final_envelope_contract').validate_envelope(envelope,context,producer_root_sha);observer=module('anchored-cgroup.INACTIVE.py','fs_cgroup')
 result={'kind':'FS_HELPER_OWNER_ONLY','state':'UNKNOWN','allShutdownValidated':False,'fullApplicationValidated':False,'daemonImported':False,'batchAttempted':False,'runtimeObserved':None,'productExecution':'UNVERIFIED','forcedCleanup':False,'cleanupUnknown':False,'evidenceUnknown':False,'reviewRootSha256':expected_root,'publicContext':context,'preparationReceiptSha256':preparation_sha};mounted=[];anchor=None;started=False;terminal=False;removed=False
 result['ownedResourceLedger']={'unit':unit,'unitFile':str(unitfile),'unitWriteAttempted':False,'startAttempted':False,'mutations':[]}
 durable(receipt,result)
 def owned_command(*args,timeout=5):
  entry={'argv':list(args),'state':'ATTEMPTED_RESULT_UNKNOWN'};result['ownedResourceLedger']['mutations'].append(entry);durable(receipt,result);value=command(*args,timeout=timeout);entry['state']='COMMAND_ACKNOWLEDGED';durable(receipt,result);return value
 try:
  result['rootfs']=assembled['rootfs'];result['producerReviewRootSha256']=producer_root_sha;result['preparationEnvelopeSha256']=preparation_closeout_sha
  for row in json.loads((HERE/'NATIVE-ROOTFS.json').read_text()):need(sha(root/row['target'].lstrip('/'))==row['sha256'],'OFFLINE_PRESPAWN_NATIVE_PIN')
  for rel,wanted in json.loads((HERE/'TEST-SOURCE-PINS.json').read_text()).items():
   if rel in ('package.json','services/daemon/serializedStateWriter.js','services/daemon/daemonStateOwner.js','tests/daemon-state-writer/contracts.node.cjs'):need(sha(root/'source'/rel)==wanted,'OFFLINE_PRESPAWN_SOURCE_PIN')
  for p,options in ((work,'size=33554432,nr_inodes=4096'),(tmp,'size=16777216,nr_inodes=2048')):
   owned_command('/usr/bin/mount','-t','tmpfs','-o','rw,nosuid,nodev,noexec,'+options+',uid=1000,gid=1000,mode=0700','tmpfs',str(p));mounted.append(p)
  text=(HERE/'fs-batch.service.INACTIVE').read_text()
  for key,value in (('@ROOT@',root),('@WORK@',work),('@TMP@',tmp)):
   need(re.fullmatch('/[A-Za-z0-9_./-]+',str(value)),'SERVICE_PATH');text=text.replace(key,str(value))
  module('context-snapshot.INACTIVE.py','final_offline_context').read_for_root(context_path,expected_context);need('@' not in text and not unitfile.exists(),'SERVICE_TEMPLATE');result['ownedResourceLedger'].update(unitWriteAttempted=True,unitSourceSha256=hashlib.sha256(text.encode()).hexdigest());durable(receipt,result);unitfile.write_text(text);unitfile.chmod(0o600);owned_command('/usr/bin/systemctl','daemon-reload');result['batchAttempted']=True;result['ownedResourceLedger']['startAttempted']=True;durable(receipt,result);started=True;owned_command('/usr/bin/systemctl','start','--no-block',unit)
  until=time.monotonic()+8
  while True:
   need(time.monotonic()<until,'ADMISSION_TIMEOUT_NO_NODE');s=state(unit,until)
   need(s.get('ActiveState') not in ('failed','inactive'),'ADMISSION_UNIT_TERMINATED')
   if (work/'ready.json').exists():break
   time.sleep(.02)
  ready=json.loads(bounded(work/'ready.json',1024));check_deadline(until);need(ready.get('stage')=='BEFORE_NODE' and str(ready.get('pid'))==s.get('MainPID') and re.fullmatch('[a-f0-9]{64}',ready.get('nonce','')),'ADMISSION_READY')
  wanted={'Id':unit,'LoadState':'loaded','ActiveState':'active','SubState':'running','Type':'exec','ExitType':'cgroup','RemainAfterExit':'yes','User':'1000','Group':'1000','RootDirectory':str(root),'PrivateNetwork':'yes','PrivateDevices':'yes','NoNewPrivileges':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','ProtectSystem':'strict','ProtectHome':'yes','KillMode':'control-group','Restart':'no','RuntimeMaxUSec':'45s','TimeoutStopUSec':'2s','OOMPolicy':'kill','OOMScoreAdjust':'0','MemoryMax':'536870912','MemorySwapMax':'0','TasksMax':'64','CPUQuotaPerSecUSec':'1s','CPUQuotaPeriodUSec':'100ms','NRestarts':'0','ControlPID':'0'}
  need(all(s.get(k)==v for k,v in wanted.items()),'ADMISSION_MANAGER_CONTROLS');anchor=observer.Anchor(s.get('ControlGroup'),unit,s.get('InvocationID'),ready['pid']);result['admission']=anchor.record();result['ownedResourceLedger']['acquiredUnitIdentity']={'unit':unit,'invocationId':s.get('InvocationID'),'controlGroup':s.get('ControlGroup'),'admission':result['admission']};durable(receipt,result)
  again=state(unit,until);need(all(again.get(k)==s.get(k) for k in ('InvocationID','MainPID','ControlGroup','NRestarts','SubState')),'ADMISSION_IDENTITY_CHANGED');need(Path('/proc/'+str(ready['pid'])+'/oom_score_adj').read_text().strip()=='0','ADMISSION_OOM_EXEMPT')
  durable(receipt,result);publish_permit(work,{'pid':ready['pid'],'nonce':ready['nonce']},anchor,until);until=time.monotonic()+45
  while True:
   need(time.monotonic()<until,'RUNTIME_WALL_TIMEOUT');s=state(unit,until)
   if (tmp/'contracts.log').exists():need((tmp/'contracts.log').stat().st_size<=1048576,'OUTPUT_OVERFLOW')
   need(s.get('ActiveState')!='failed','RUNTIME_FAILED')
   if s.get('ActiveState')=='active' and s.get('SubState')=='exited':break
   time.sleep(.05)
  result['terminalManager']=s;need(s.get('Result')=='success' and s.get('ExecMainCode')=='1' and s.get('ExecMainStatus')=='0','TERMINAL_NOT_NATURAL_SUCCESS')
  result['terminal']=stable_terminal_before_oom(anchor,s,result,receipt);terminal=True;result['oom']=anchor.prove_no_oom(result['terminal']);durable(receipt,result)
  log=bounded(tmp/'contracts.log',1048576).decode();lines=log.splitlines();names=json.loads((HERE/'TEST-NAMES.json').read_text());need([l for l in lines if re.fullmatch('ok [0-9]+ - .+',l)]==['ok '+str(i+1)+' - '+name for i,name in enumerate(names)],'TAP_EXACT_ELEVEN_NAMES')
  for summary in ('1..11','# tests 11','# pass 11','# fail 0','# cancelled 0','# skipped 0','# todo 0'):need(lines.count(summary)==1,'TAP_SUMMARY')
  need(not any(re.match('not ok\\b',l) for l in lines),'TAP_FAILED');markers=[l.removeprefix('# ') for l in lines if l.removeprefix('# ').startswith('FS_RUNTIME_NODE ')];need(1<=len(markers)<=2,'RUNTIME_MARKER');metadata=[json.loads(l.removeprefix('FS_RUNTIME_NODE ')) for l in markers];need(all(m.get('platform')=='linux' and m.get('arch')=='x64' and m.get('version')=='v22.18.0' for m in metadata),'RUNTIME_METADATA');result['runtimeMetadata']=metadata
  attempted=json.loads(bounded(work/'attempted.json',1024));need(attempted.get('nodeExecAttempted') is True,'EXEC_ATTEMPT_RECEIPT')
  result.update(state='PASS_FS_HELPER_OWNER_11_ONLY',runtimeObserved=True,productExecution='TWO_PINNED_HELPERS_EXERCISED_BY_11_REAL_FS_TESTS',tests=11)
 except BaseException as error:
  result['failureClass']=type(error).__name__;text=str(error);result['failureCode']=text if re.fullmatch('[A-Z][A-Z0-9_]{0,95}',text) else 'UNCLASSIFIED_FAILURE'
 finally:
  if started and not terminal:
   result['forcedCleanup']=True
   try:
    need(anchor is not None,'NO_ACQUIRED_ANCHOR');current=state(unit);need(current.get('Id')==unit and current.get('InvocationID')==result['admission']['invocationId'] and current.get('NRestarts')=='0','CLEANUP_CUSTODY_CHANGED');need(sha(unitfile)==result['ownedResourceLedger']['unitSourceSha256'],'CLEANUP_UNIT_SOURCE_CHANGED');owned_command('/usr/bin/systemctl','stop',unit,timeout=5);s=state(unit);result['cleanupManager']=s
    need(anchor is not None,'NO_ACQUIRED_ANCHOR');result['cleanupTerminal']=anchor.prove_empty(s);terminal=True
   except BaseException:result['cleanupUnknown']=True
  if terminal or not started:
   try:
    selected=base/'selected';selected.mkdir(mode=0o700);exports=[]
    for src,name,limit in ((tmp/'contracts.log','contracts.log',1048576),(work/'ready.json','ready.json',1024),(work/'attempted.json','attempted.json',1024),(receipt_path,'types-receipt.json',32768),(receipt_path.parent/'install.log','types-install.log',1048576),(receipt_path.parent/'types.log','types-types.log',1048576)):
     if not src.exists():continue
     need(src.is_file() and not src.is_symlink(),'EXPORT_TYPE')
     with src.open('rb') as f:raw=f.read(limit+1)
     partial=len(raw)>limit;(selected/name).write_bytes(raw[:limit]);exports.append({'file':name,'bytes':len(raw[:limit]),'partial':partial,'sha256':sha(selected/name)})
     if partial:result['evidenceUnknown']=True
    result['exports']=exports
   except BaseException:result['evidenceUnknown']=True
   try:
    if started:
     current=state(unit);need(current.get('Id')==unit and current.get('InvocationID')==result['admission']['invocationId'] and current.get('NRestarts')=='0','FINAL_CLEANUP_CUSTODY_CHANGED');owned_command('/usr/bin/systemctl','stop',unit,timeout=5)
    if unitfile.exists():
     need(sha(unitfile)==result['ownedResourceLedger']['unitSourceSha256'],'CLEANUP_UNIT_SOURCE_CHANGED');result['ownedResourceLedger']['unitUnlinkAttempted']=True;durable(receipt,result);unitfile.unlink();owned_command('/usr/bin/systemctl','daemon-reload')
    removed=True
    for p in reversed(mounted):owned_command('/usr/bin/umount',str(p))
   except BaseException:result['cleanupUnknown']=True
  for entry in result['ownedResourceLedger']['mutations']:
   if entry['state']!='COMMAND_ACKNOWLEDGED':result['cleanupUnknown']=True
  if anchor:anchor.close()
  if result['forcedCleanup'] or result['cleanupUnknown'] or result['evidenceUnknown']:result['state']='UNKNOWN'
  result['ownedUnitRemoved']=removed;result['rootRetainedUntilDisposableVMTeardown']=True;durable(receipt,result)
  if (base/'selected').is_dir():(base/'selected/closeout.json').write_bytes(receipt.read_bytes())
 return {'receipt':str(receipt),'result':result}

# Added finite preparation envelope. Same observer, explicit distinct resource profile.
def prepare_online(*args,**kwargs):
 raise RuntimeError('ONLINE_ISOLATION_TOOLCHAIN_SOURCE_PRODUCER_NOT_IMPLEMENTED')

if __name__=='__main__':raise SystemExit('INACTIVE: explicit reviewed launcher only')
