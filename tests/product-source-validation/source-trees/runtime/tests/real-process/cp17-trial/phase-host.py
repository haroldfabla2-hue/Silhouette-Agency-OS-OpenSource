"""Review-only launcher. Never run without separately approved exact packet.
NEW scoped sudo self-admission requires separate approval. No systemd/provision or global controller enablement.
Host inputs must be already copied/verified disposable source+harness; no git/home.
"""
import argparse,hashlib,json,os,pathlib,selectors,shutil,signal,stat,subprocess,time
from scope_finalize import finish_scope
from phase_contract import contract, validate_helper
p=argparse.ArgumentParser();p.add_argument('--delegated-parent',required=True);p.add_argument('--work',required=True);p.add_argument('--harness',required=True);p.add_argument('--evidence',required=True);p.add_argument('--staged-bwrap',required=True);p.add_argument('--run-id',required=True);p.add_argument('--reviewed-root-helper',required=True);p.add_argument('--root-helper-sha256',required=True);p.add_argument('--phase',choices=['install','native','browser','checks'],required=True);p.add_argument('--phase-seconds',type=int,required=True);p.add_argument('--dependency-store',required=True);a=p.parse_args()
assert 0<a.phase_seconds<=1000
phase_contract=contract(a.phase)
# Fail before creating any scope, independently of shell selection.
helper=validate_helper(a.phase,a.reviewed_root_helper,a.root_helper_sha256)
store=pathlib.Path(a.dependency_store).resolve(strict=True);assert store==pathlib.Path('/var/lib')/('silhouette-cp17-deps-'+a.run_id)/'store';assert os.path.ismount(store)
parent=pathlib.Path(a.delegated_parent).resolve(strict=True);work=pathlib.Path(a.work).resolve(strict=True);harness=pathlib.Path(a.harness).resolve(strict=True);evidence=pathlib.Path(a.evidence).resolve(strict=True);bwrap=pathlib.Path(a.staged_bwrap).resolve(strict=True)
assert a.run_id.isdigit() and int(a.run_id)>0
assert parent==pathlib.Path('/sys/fs/cgroup')/('silhouette-owner-once-'+a.run_id)
assert parent.stat().st_uid==os.getuid() and os.geteuid()!=0, 'predelegated owned subtree, no host root'
assert {'memory','cpu','pids'}<=set((parent/'cgroup.subtree_control').read_text().split()), 'controllers must be ALREADY delegated/enabled'
assert not (parent/'cgroup.procs').read_text().strip(), 'do not repurpose a live parent'
assert not list(evidence.iterdir()), 'never overwrite evidence'
assert not (work/'.git').exists() and not (work/'.env').exists()
# Work preparation must supply a full reviewed ledger, independently verified
# binding and staged-bwrap acquisition proof before this launcher is approved.
assert bwrap.is_file() and os.access(bwrap,os.X_OK)
cg=parent/('owner-trial-'+str(os.getpid()));cg.mkdir(mode=0o700)
child=None;status=None;start=time.monotonic();events=[];final_scope=None;removed=False;remove_error=None;metrics={};control=evidence/'containment-host.json'
def write(name,value): (cg/name).write_text(value)
def kill_scope(reason):
 events.append({'reason':reason,'at':time.monotonic()-start})
 (cg/'cgroup.kill').write_text('1') # all descendants, not Pythonprocessgroup only
try:
 # Resolve only workflow-selected Node22.18.0, never broaden inner PATH.
 node_cut={'requested':'node','expected':'/opt/hostedtoolcache/node/22.18.0/x64/bin/node'}
 node_cut['runner_image']={key:os.environ.get(key)for key in ['ImageOS','ImageVersion','ImageRelease','RUNNER_OS','RUNNER_ARCH']}
 try:
  selected=shutil.which('node');node_cut['hostLookup']=selected
  assert selected is not None,'workflow Node not found on host PATH'
  node=pathlib.Path(selected).resolve(strict=True);node_cut['realpath']=str(node)
  assert node==pathlib.Path(node_cut['expected']),'workflow Node resolved outside exact approved toolcache entry'
  ns=node.stat();node_cut.update({'size':ns.st_size,'mode':oct(ns.st_mode),'uid':ns.st_uid,'gid':ns.st_gid})
  assert stat.S_ISREG(ns.st_mode) and 0<ns.st_size<=256*1024**2 and os.access(node,os.X_OK)
  assert ns.st_mode & 0o022==0,'Node must not be group/other writable'
  with node.open('rb') as stream:node_sha=hashlib.file_digest(stream,'sha256').hexdigest()
  node_cut['sha256']=node_sha;node_cut['status']='HOST_PATH_AND_DIGEST_CAPTURED_NOT_INNER_VERIFIED'
 except Exception as error:
  node_cut.update({'status':'FAIL','errorType':type(error).__name__,'errno':getattr(error,'errno',None),'filename':getattr(error,'filename',None),'error':str(error)[:1024]});raise
 finally:(evidence/'node-host.json').write_text(json.dumps(node_cut,indent=2))
 for name,value in [('memory.max',str(8*1024**3)),('memory.swap.max','0'),('pids.max',str(phase_contract['pids'])),('cpu.max','200000 100000'),('memory.oom.group','1')]:write(name,value)
 # Cgroup hierarchy/mount provenance before childlaunch. Metadata only.
 provenance={'mountinfo':[line for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines()if ' - cgroup2 'in line],'hierarchy':[]}
 for scope in [cg,parent,pathlib.Path('/sys/fs/cgroup')]:
  entry={'path':str(scope),'counters':{}}
  for name in ['pids.max','pids.current','pids.peak','pids.events','pids.events.local']:
   try:entry['counters'][name]=(scope/name).read_text()[:1024]
   except OSError as error:entry['counters'][name]={'unavailable':error.errno}
  provenance['hierarchy'].append(entry)
 (evidence/'pids-hierarchy-before.json').write_text(json.dumps(provenance,indent=2))
 assert (cg/'cgroup.kill').exists() and os.access(cg/'cgroup.kill',os.W_OK)
 # Preparation resolver snapshot: dereference only this one host file, never bind /run.
 resolver=evidence/'resolver.snapshot';resolver_record={'stage':'host','mode':a.phase,'network_ns':os.readlink('/proc/self/ns/net')}
 if a.phase in {'install','native','browser'}:
  source=pathlib.Path('/etc/resolv.conf');resolver_record.update({'source_is_symlink':source.is_symlink(),'source_realpath':str(source.resolve(strict=True))})
  with source.open('rb')as f:
   st=os.fstat(f.fileno());assert stat.S_ISREG(st.st_mode)and st.st_size<=65536
   raw=f.read(65537);assert 0<len(raw)<=65536 and b'\x00'not in raw
  resolver.write_bytes(raw);resolver.chmod(0o444);resolver_record.update({'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
 (evidence/'resolver-host.json').write_text(json.dumps(resolver_record,indent=2))
 # Future gate only. No fallback if pinned verified bwrap lacks size/nesting.
 helptext=subprocess.check_output([str(bwrap),'--help'],text=True,timeout=2)
 for option in ['--size','--unshare-user','--uid','--gid','--unshare-pid','--die-with-parent','--cap-drop']:assert option in helptext
 assert hashlib.sha256(helper).hexdigest()==phase_contract['helper_sha256']
 control=evidence/'containment-host.json';control.write_text(json.dumps({'scope':str(cg),'limits':{n:(cg/n).read_text().strip() for n in ['memory.max','memory.swap.max','pids.max','cpu.max']},'bwrap_sha256':hashlib.sha256(bwrap.read_bytes()).hexdigest(),'wallSeconds':a.phase_seconds+15,'storageBytes':512*1024**2,'status':'PREPARED_NOT_STARTED'},indent=2))
 # Root helper self-admits before executing bwrap, then drops all root IDs.
 # No numeric target-PID attach race and no broad LCA permission delegation.
 cmd=[str(bwrap),'--die-with-parent','--unshare-pid','--unshare-user','--uid','0','--gid','0','--cap-add','CAP_SETFCAP']
 if a.phase=='checks':cmd+=['--unshare-net','--cap-add','CAP_NET_ADMIN']
 for source in ['/usr','/bin','/lib','/lib64','/etc','/opt']:cmd+=['--ro-bind',source,source]
 if a.phase in {'install','native','browser'}:
  target=pathlib.Path(resolver_record['source_realpath'])
  assert target==pathlib.Path('/etc/resolv.conf')or(target.is_relative_to('/run')and len(target.parts)<=8),'resolver target outside reviewed layout'
  if target!=pathlib.Path('/etc/resolv.conf'):
   # Only empty private mountpoint directories, never a bind of host /run.
   for directory in reversed(target.parent.parents):
    if str(directory)!='/':cmd+=['--dir',str(directory)]
   cmd+=['--dir',str(target.parent)]
  cmd+=['--ro-bind',str(resolver),str(target)]
 cmd+=['--proc','/proc','--dev','/dev','--size',str(512*1024**2),'--tmpfs','/tmp','--ro-bind',str(work),'/tmp/work','--bind',str(store),'/tmp/deps-store','--ro-bind',str(harness),'/tmp/harness','--ro-bind',str(bwrap.parent),'/tmp/security-bin','--ro-bind',str(cg),'/tmp/limits','--bind',str(evidence),'/tmp/export','--remount-ro','/','--chdir','/tmp/work','/usr/bin/python3','/tmp/harness/phase-namespace.py',bwrap.name,a.phase,str(a.phase_seconds)]
 child_process=subprocess.Popen(['sudo','-n','/usr/bin/python3','-',str(os.getuid()),str(os.getgid()),a.run_id,str(os.getpid()),json.dumps(cmd)],stdin=subprocess.PIPE)
 child=child_process.pid
 child_process.stdin.write(helper);child_process.stdin.close()
 pid=child
 # Phase-specific reviewed deadline, independent original oracle limits unchanged.
 while True:
  found,status=os.waitpid(pid,os.WNOHANG)
  if found:break
  if time.monotonic()-start>=a.phase_seconds+15:
   kill_scope('HARD_PHASE_WALL');_,status=os.waitpid(pid,0);break
  time.sleep(.05)
 # Wait status is only preliminary. Final verdict is AFTER scope cleanup.
 (evidence/'pids-host-before-finalize.json').write_text(json.dumps({name:(cg/name).read_text()if(cg/name).exists()else {'unavailable':True}for name in ['pids.max','pids.current','pids.peak','pids.events','pids.events.local']},indent=2))
 metrics={n:(cg/n).read_text() for n in ['memory.events','memory.peak','cpu.stat','pids.events','cgroup.events']}
finally:
 final_scope=finish_scope(cg,evidence,events,kill_scope,start+a.phase_seconds+15)
 if final_scope.get('natural_empty') or final_scope.get('state') is not None and 'populated 1' not in final_scope['state']:
  # Optional metadata only after scope empty; no package reads or symlink traversal.
  # A diagnostic failure must not prevent cgroup removal or erase cleanup failure.
  try:
   import heapq
   cutoff=min(start+a.phase_seconds+15,time.monotonic()+2);entries=0;count=0;total=0;largest=[];truncated=False;errors=[];pending=[store]
   while pending:
    if entries>=100000 or time.monotonic()>=cutoff:truncated=True;break
    directory=pending.pop()
    try:
     with os.scandir(directory)as scan:
      for entry in scan:
       if entries>=100000 or time.monotonic()>=cutoff:truncated=True;break
       entries+=1
       try:
        if entry.is_symlink():continue
        if entry.is_dir(follow_symlinks=False):pending.append(pathlib.Path(entry.path));continue
        st=entry.stat(follow_symlinks=False)
        if not stat.S_ISREG(st.st_mode):continue
        rel=str(pathlib.Path(entry.path).relative_to(store));count+=1;total+=st.st_size
        item=(st.st_size,rel)
        if len(largest)<128:heapq.heappush(largest,item)
        elif item>largest[0]:heapq.heapreplace(largest,item)
       except OSError as error:
        if len(errors)<16:errors.append({'path':str(pathlib.Path(entry.path).relative_to(store)),'errno':error.errno})
    except OSError as error:
     if len(errors)<16:errors.append({'path':str(directory.relative_to(store)),'errno':error.errno})
    if truncated:break
   volume=os.statvfs(store)
   (evidence/'dependency-store-metadata.json').write_text(json.dumps({'after_scope_empty':True,'phase':a.phase,'scan_entries':entries,'scan_files':count,'scan_total_bytes':total,'truncated':truncated,'max_scan_entries':100000,'scan_seconds_budget':2,'largest':[{'bytes':n,'path':p}for n,p in sorted(largest,reverse=True)],'errors':errors,'filesystem_bytes':volume.f_blocks*volume.f_frsize,'filesystem_available_bytes':volume.f_bavail*volume.f_frsize,'claim':'partial metadata only, exact SIGXFSZ source not proven by equal-sized file'},indent=2))
  except Exception as error:
   print('DEPENDENCY_METADATA_UNAVAILABLE',type(error).__name__,getattr(error,'errno',None),flush=True)
  finally:
   try:cg.rmdir();removed=True
   except OSError as error:remove_error={'errno':error.errno,'error':type(error).__name__}

 if not removed:
  # rmdir cannot remove a populated cgroup. Diagnostic failure is not a
  # reason to skip this safe exact-scope cleanup attempt.
  try:cg.rmdir();removed=True;remove_error=None
  except OSError as error:remove_error={'errno':error.errno,'error':type(error).__name__}

 # No earlier events[] snapshot can become a premature PASS.
 final_pass=status is not None and os.waitstatus_to_exitcode(status)==0 and final_scope['natural_empty'] and not events and removed and remove_error is None
 control.write_text(json.dumps({'status':'FINAL_PASS'if final_pass else'FINAL_FAIL','waitStatus':status,'events':list(events),'elapsedSeconds':time.monotonic()-start,'pre_cleanup_metrics':metrics,'scope_cleanup':final_scope,'removed':removed,'remove_error':remove_error},indent=2))
print('PHASE_FINAL_VERDICT',json.dumps({'phase':a.phase,'waitstatus':status,'leader_rc':os.waitstatus_to_exitcode(status)if status is not None else None,'natural_empty':final_scope.get('natural_empty')if final_scope else None,'forced_event_count':len(events),'cgroup_removed':removed,'remove_error':remove_error,'diagnostic_issues':final_scope.get('diagnostic_issues')if final_scope else None}),flush=True)
assert status is not None and os.waitstatus_to_exitcode(status)==0 and final_scope['natural_empty'] and not events and removed and remove_error is None,'final natural scope verdict failed; preserve evidence'
