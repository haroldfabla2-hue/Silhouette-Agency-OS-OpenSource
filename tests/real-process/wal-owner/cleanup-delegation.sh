#!/usr/bin/env bash
# PROPOSAL ONLY, always phase, SAME exact trial scope. New privilege not granted.
set -euo pipefail
[[ "${GITHUB_RUN_ID:?}" =~ ^[0-9]+$ ]]
sudo -n /usr/bin/python3 - "$GITHUB_RUN_ID" <<'ROOT'
import json,pathlib,sys,time
run=int(sys.argv[1]);assert run>0
scope=pathlib.Path('/sys/fs/cgroup')/('silhouette-owner-once-'+str(run))
if not scope.exists():print('SCOPE_ABSENT');raise SystemExit(0)
# Never rm-rf a cgroup tree and never target parent/root/another run.
children=list(scope.iterdir());dirs=[p for p in children if p.is_dir()]
assert all(p.name.startswith('owner-trial-') and p.name[len('owner-trial-'):].isdigit() for p in dirs),'unknown child scope; retain and STOP'
if 'populated 1' in (scope/'cgroup.events').read_text():
 (scope/'cgroup.kill').write_text('1')
 print('FORCED_CGROUP_CLEANUP_NOT_NATURAL_PASS')
end=time.monotonic()+5
while 'populated 1' in (scope/'cgroup.events').read_text() and time.monotonic()<end:time.sleep(.05)
assert 'populated 0' in (scope/'cgroup.events').read_text(),'scope retained: residual process'
for child in dirs:child.rmdir()
(scope/'cgroup.subtree_control').write_text('-memory -cpu -pids')
scope.rmdir();print('EXACT_TRIAL_SCOPE_REMOVED')
ROOT
