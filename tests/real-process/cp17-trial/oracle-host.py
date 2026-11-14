"""Review-only launcher. Never run without separately approved exact packet.
NEW scoped sudo self-admission requires separate approval. No systemd/provision or global controller enablement.
Host inputs must be already copied/verified disposable source+harness; no git/home.
"""
import argparse,hashlib,json,os,pathlib,selectors,shutil,signal,stat,subprocess,time
from scope_finalize import finish_scope
p=argparse.ArgumentParser();p.add_argument('--delegated-parent',required=True);p.add_argument('--work',required=True);p.add_argument('--harness',required=True);p.add_argument('--evidence',required=True);p.add_argument('--staged-bwrap',required=True);p.add_argument('--run-id',required=True);p.add_argument('--reviewed-root-helper',required=True);p.add_argument('--root-helper-sha256',required=True);p.add_argument('--dependency-store',required=True);p.add_argument('--preparation-inputs',required=True);a=p.parse_args()
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
preparation=pathlib.Path(a.preparation_inputs).resolve(strict=True)
assert preparation.name=='oracle-preparation'and preparation.parent.name=='cp17-trial'
assert (preparation.parent/'infrastructure.sha256').is_file()
prepared_names=['runner-integrated.py','namespace-init.py','wal-prepared-entry.mts','accepted-prepared-entry.mts','preparation-capacity.json']
for name in prepared_names:
 path=preparation/name
 assert path.is_file()and not path.is_symlink()

cg=parent/('owner-trial-'+str(os.getpid()));cg.mkdir(mode=0o700)
child=None;status=None;start=time.monotonic();events=[];final_scope=None;removed=False;remove_error=None;metrics={};control=evidence/'containment-host.json'
def write(name,value): (cg/name).write_text(value)
def kill_scope(reason):
 events.append({'reason':reason,'at':time.monotonic()-start})
 (cg/'cgroup.kill').write_text('1') # all descendants, not Pythonprocessgroup only
try:
 # Resolve only workflow-selected Node22.18.0, never broaden inner PATH.
 node_cut={'requested':'node','expected':'/opt/hostedtoolcache/node/22.18.0/x64/bin/node'}
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
 for name,value in [('memory.max',str(8*1024**3)),('memory.swap.max','0'),('pids.max','96'),('cpu.max','200000 100000'),('memory.oom.group','1')]:write(name,value)
 assert (cg/'cgroup.kill').exists() and os.access(cg/'cgroup.kill',os.W_OK)
 # Future gate only. No fallback if pinned verified bwrap lacks size/nesting.
 helptext=subprocess.check_output([str(bwrap),'--help'],text=True,timeout=2)
 for option in ['--size','--unshare-user','--uid','--gid','--unshare-pid','--die-with-parent','--cap-drop']:assert option in helptext
 helper=pathlib.Path(a.reviewed_root_helper).read_bytes()
 assert len(helper)<=16384 and hashlib.sha256(helper).hexdigest()==a.root_helper_sha256
 control=evidence/'containment-host.json';control.write_text(json.dumps({'scope':str(cg),'limits':{n:(cg/n).read_text().strip() for n in ['memory.max','memory.swap.max','pids.max','cpu.max']},'bwrap_sha256':hashlib.sha256(bwrap.read_bytes()).hexdigest(),'wallSeconds':360,'storageBytes':512*1024**2,'status':'PREPARED_NOT_STARTED'},indent=2))
 # Root helper self-admits before executing bwrap, then drops all root IDs.
 # No numeric target-PID attach race and no broad LCA permission delegation.
 cmd=[str(bwrap),'--die-with-parent','--unshare-pid','--unshare-user','--uid','0','--gid','0','--unshare-net','--cap-add','CAP_NET_ADMIN','--cap-add','CAP_SETFCAP']
 for source in ['/usr','/bin','/lib','/lib64','/etc','/opt']:cmd+=['--ro-bind',source,source]
 cmd+=['--proc','/proc','--dev','/dev','--size',str(512*1024**2),'--tmpfs','/tmp','--ro-bind',str(work),'/tmp/work','--ro-bind',str(store),'/tmp/work/node_modules','--ro-bind',str(harness),'/tmp/harness','--ro-bind',str(bwrap.parent),'/tmp/security-bin','--ro-bind',str(cg),'/tmp/limits','--bind',str(evidence),'/tmp/export','--remount-ro','/','--chdir','/tmp/work','/usr/bin/python3','/tmp/harness/namespace-init.py',bwrap.name,str(node),node_sha]
 # Fixed read-only operational overrides, all hash-anchored by workflow ledger.
 # Existing original namespace-init and real fixture paths remain unchanged.
 anchor=cmd.index('--remount-ro')
 overrides=['--ro-bind',str(preparation),'/tmp/preparation']
 for name in ['runner-integrated.py','namespace-init.py']:overrides+=['--ro-bind',str(preparation/name),'/tmp/harness/'+name]
 cmd[anchor:anchor]=overrides
 child_process=subprocess.Popen(['sudo','-n','/usr/bin/python3','-',str(os.getuid()),str(os.getgid()),a.run_id,str(os.getpid()),json.dumps(cmd)],stdin=subprocess.PIPE)
 child=child_process.pid
 child_process.stdin.write(helper);child_process.stdin.close()
 pid=child
 # Namespace init supervises inner test for340s then exports. Host hard ceiling360s.
 while True:
  found,status=os.waitpid(pid,os.WNOHANG)
  if found:break
  if time.monotonic()-start>=360:
   kill_scope('HARD_WALL_360S');_,status=os.waitpid(pid,0);break
  time.sleep(.05)
 # Wait status is only preliminary. Final verdict is AFTER scope cleanup.
 metrics={n:(cg/n).read_text() for n in ['memory.events','memory.peak','cpu.stat','pids.events','cgroup.events']}
finally:
 final_scope=finish_scope(cg,evidence,events,kill_scope,start+360)
 if final_scope.get('natural_empty') or final_scope.get('state') is not None and 'populated 1' not in final_scope['state']:
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
assert status is not None and os.waitstatus_to_exitcode(status)==0 and final_scope['natural_empty'] and not events and removed and remove_error is None,'final natural scope verdict failed; preserve evidence'
