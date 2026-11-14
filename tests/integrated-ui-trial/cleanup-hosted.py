#!/usr/bin/env python3
"""SOURCE ONLY. Last-resort cleanup only this run's fixed-prefix cgroups."""
from pathlib import Path
import os,re,time,json
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
root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui/evidence';root.mkdir(parents=True,exist_ok=True);(root/'outer-cleanup.json').write_text(json.dumps({'tag':run,'groups':rows,'emergencyCleanupInvalidatesPass':any(r['forced']for r in rows)},indent=2)+'\n')
raise SystemExit(1 if any(r['forced']or r['afterPids']for r in rows)else 0)
