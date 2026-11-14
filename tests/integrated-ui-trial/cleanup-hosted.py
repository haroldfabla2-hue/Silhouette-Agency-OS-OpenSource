#!/usr/bin/env python3
"""SOURCE ONLY. Last-resort cleanup only this run's fixed-prefix cgroups."""
from pathlib import Path
import os,re,time,json,stat
run=os.environ.get('GITHUB_RUN_ID','');assert re.fullmatch('[0-9]+',run),'MISSING_RUN_ID_NO_SWEEP'
prefix='silhouette-ui-'+run+'-';rows=[]
for p in Path('/sys/fs/cgroup').iterdir():
 if not p.name.startswith(prefix):continue
 assert p.name[len(prefix):].isdigit()and p.is_dir()
 before=(p/'cgroup.procs').read_text().split();forced=bool(before)
 if before:
  (p/'cgroup.kill').write_text('1');end=time.monotonic()+10
  while(p/'cgroup.procs').read_text().split()and time.monotonic()<end:time.sleep(.05)
 after=(p/'cgroup.procs').read_text().split();rows.append({'name':p.name,'beforePids':before,'afterPids':after,'forced':forced})
 if not after:p.rmdir()
# This run's one public archive-keycopy, never generic /run deletion.
keyscope=Path('/run')/('silhouette-integrated-key-'+run);keycleanup={'path':str(keyscope),'presentBefore':keyscope.exists(),'emergencyCleanupInvalidatesPass':keyscope.exists()}
if keyscope.exists():
 assert keyscope.lstat().st_uid==0 and stat.S_ISDIR(keyscope.lstat().st_mode)and not keyscope.is_symlink()
 assert {x.name for x in keyscope.iterdir()}<={'ubuntu-archive-keyring.gpg'}
 os.chmod(keyscope,0o700);key=keyscope/'ubuntu-archive-keyring.gpg'
 if key.exists():
  assert key.lstat().st_uid==0 and stat.S_ISREG(key.lstat().st_mode)and not key.is_symlink();key.unlink()
 keyscope.rmdir()
keycleanup['absentAfter']=not keyscope.exists()
root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui/evidence';root.mkdir(parents=True,exist_ok=True);(root/'outer-cleanup.json').write_text(json.dumps({'tag':run,'groups':rows,'keyScope':keycleanup,'emergencyCleanupInvalidatesPass':any(r['forced']for r in rows)or keycleanup['emergencyCleanupInvalidatesPass']},indent=2)+'\n')
raise SystemExit(1 if any(r['forced']or r['afterPids']for r in rows)or keycleanup['emergencyCleanupInvalidatesPass']else 0)
