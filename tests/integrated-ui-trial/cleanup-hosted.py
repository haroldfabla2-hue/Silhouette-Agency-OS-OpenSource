#!/usr/bin/env python3
"""SOURCE ONLY. Independent bounded cleanup, exact tagged resources only.
Always retain per-resource failures; no cleanup error is a success or a reason
for skipping another independently identified resource. Final FAIL is sticky.
"""
from pathlib import Path
import os,re,time,json,stat,subprocess
run=os.environ.get('GITHUB_RUN_ID','');assert re.fullmatch('[0-9]+',run),'MISSING_RUN_ID_NO_SWEEP'
root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui/evidence';root.mkdir(parents=True,exist_ok=True)
prefix='silhouette-ui-'+run+'-';rows=[];errors=[];keycleanup={'status':'UNVERIFIED','emergencyCleanupInvalidatesPass':True}
def problem(resource,e):
 row={'resource':resource,'type':type(e).__name__,'message':str(e)};errors.append(row);return row
try:
 # Keep both stdout and stderr + rc from the SAME root-only validator/remover.
 # If it fails or times out, cgroups below still get their independent cleanup.
 try:
  k=subprocess.run(['/usr/bin/python3',str(Path(__file__).resolve().parent/'cleanup-keyscope.py'),run],timeout=5,text=True,capture_output=True)
  keycleanup={'status':'HELPER_RESULT','code':k.returncode,'stdout':k.stdout,'stderr':k.stderr,'emergencyCleanupInvalidatesPass':True}
  if k.returncode:raise RuntimeError('KEY_SCOPE_HELPER_NONZERO:'+str(k.returncode))
  result=json.loads(k.stdout);assert result['absentAfter']is True and type(result['presentBefore'])is bool
  keycleanup.update(result);keycleanup['emergencyCleanupInvalidatesPass']=result['presentBefore']
 except subprocess.TimeoutExpired as e:
  keycleanup.update({'status':'HELPER_TIMEOUT','stdout':(e.stdout or b'').decode(errors='replace')if isinstance(e.stdout,bytes)else(e.stdout or ''),'stderr':(e.stderr or b'').decode(errors='replace')if isinstance(e.stderr,bytes)else(e.stderr or '')});problem('keyScope',e)
 except BaseException as e:problem('keyScope',e)
 try:groups=list(Path('/sys/fs/cgroup').iterdir())
 except BaseException as e:groups=[];problem('cgroupEnumeration',e)
 for p in groups:
  if not p.name.startswith(prefix):continue
  row={'name':p.name,'beforePids':None,'afterPids':None,'forced':False,'removed':False};rows.append(row)
  try:
   assert p.name[len(prefix):].isdigit()and p.is_dir()and not p.is_symlink(),'UNEXPECTED_TAGGED_CGROUP_IDENTITY'
   before=(p/'cgroup.procs').read_text().split();row['beforePids']=before;row['forced']=bool(before)
   if before:
    (p/'cgroup.kill').write_text('1');end=time.monotonic()+10
    while(p/'cgroup.procs').read_text().split()and time.monotonic()<end:time.sleep(.05)
   after=(p/'cgroup.procs').read_text().split();row['afterPids']=after
   if not after:p.rmdir();row['removed']=True
  except BaseException as e:row['error']=problem(p.name,e)
finally:
 emergency=keycleanup['emergencyCleanupInvalidatesPass']or any(r['forced']for r in rows)
 failed=bool(errors)or emergency or any(r['afterPids']or not r['removed']for r in rows)
 receipt={'tag':run,'groups':rows,'keyScope':keycleanup,'errors':errors,'emergencyCleanupInvalidatesPass':emergency,'cleanupFailureInvalidatesPass':bool(errors),'status':'FAIL'if failed else'CLEAN_NO_EMERGENCY'}
 (root/'outer-cleanup.json').write_text(json.dumps(receipt,indent=2)+'\n')
raise SystemExit(1 if failed else 0)
