#!/usr/bin/env bash
# REVIEW ONLY. A new exact packet push/run GO is required outside this script.
# Run only after original pinned security acquisition completes successfully.
set -euo pipefail
: "${WORK:?}" "${EVIDENCE:?}" "${STAGED_BWRAP:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_WORKSPACE:?}"
[[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ ]]
uid=$(id -u);gid=$(id -g);[[ "$uid" = 1001 || "$uid" = 1000 ]]
ops="$GITHUB_WORKSPACE/tests/real-process/neo4j-service-trial"
helper="$WORK/tests/real-process/wal-owner"
store="/var/lib/silhouette-cp17-deps-$GITHUB_RUN_ID/store"
scope="/sys/fs/cgroup/silhouette-owner-once-$GITHUB_RUN_ID"
# Publish packet.sha256 must anchor all operational source outside mutable test work.
(cd "$ops" && sha256sum --check infrastructure.sha256)
# Refuse unresolved inputs before privileged provisioning or package fetch.
python3 - "$ops" <<'PREPARATION_REVIEW_GATE'
import hashlib,json,pathlib,sys
ops=pathlib.Path(sys.argv[1]);budget=json.loads((ops/'writer-union.json').read_text())
assert len(budget['files'])==len(set(budget['files']))==budget['known_count']
assert budget['cap']==128 and budget['headroom']>=1 and budget['known_count']<=127
admission=json.loads((ops/'neo4j-admission-inputs.json').read_text())
assert admission['status']=='EXACT_RUNNER_JDK_PIN_INDEPENDENTLY_REVIEWED'and isinstance(admission['jdk'],dict),'NOT_STARTED_MISSING_REVIEWED_JDK_INPUTS'
assert admission['jdk_source_evidence']['evidence_review']=='ACCEPTED_STATIC_ONLY_BY_PARENT_AFTER_INDEPENDENT_REVIEW','NOT_STARTED_JDK_EVIDENCE_REVIEW_PENDING'
assert admission['inventory_sha256']==hashlib.sha256((ops/'neo4j-asset-pin.json').read_bytes()).hexdigest(),'NOT_STARTED_NEO4J_INVENTORY_PIN'
state=json.loads((ops/'joint-preparation-capacity.json').read_text())
assert state['status']=='SOURCE_TECHNICAL_CAPACITY_NOT_EXECUTION_AUTHORITY'
assert state['source_head']=='7854560d1f5e3a4256e2ee62a41840432dee8cb9'
assert state['manifest_sha256']==hashlib.sha256((ops/'integral-inputs.json').read_bytes()).hexdigest()
assert state['capacity']=={'scopes':48,'active':512,'failures':256,'resources':256}
PREPARATION_REVIEW_GATE
# Pure transitive admission preflight, before volume/delegation/package operations.
for exact_phase in install native checks; do
  python3 "$ops/phase_contract.py" --phase "$exact_phase" --legacy "$helper/root-self-admit.py" --checks "$ops/root-self-admit-checks256.py"
done
cleanup() {
  code=$?;trap - EXIT
  set +e
  python3 "$ops/host-control-reviewed.py" file-cleanup trial-cgroup-cleanup 20 bash "$helper/cleanup-delegation.sh"
  cg=$?
  # Never unmount a volume potentially held by surviving trial processes.
  if [[ "$cg" = 0 || "$cg" = 2 ]]; then
    python3 "$ops/host-control-reviewed.py" file-cleanup dependency-volume-cleanup 20 sudo -n /usr/bin/python3 - cleanup "$GITHUB_RUN_ID" "$uid" "$gid" < "$ops/dependency-volume.py"
    vol=$?
  else vol=1; fi
  python3 "$ops/evidence_record.py" trial-cleanup "$cg" "$vol" "$code"
  receipt=$?
  if [[ "$cg" != 0 || "$vol" != 0 || "$receipt" != 0 ]]; then exit 1; fi
  exit "$code"
}
trap cleanup EXIT
# Both privileged scripts are exact reviewed bytes, stdin only, never package code.
python3 "$ops/host-control-reviewed.py" file-setup dependency-volume 15 sudo -n /usr/bin/python3 - create "$GITHUB_RUN_ID" "$uid" "$gid" < "$ops/dependency-volume.py"
python3 "$ops/host-control-reviewed.py" file-setup delegation 15 bash "$helper/delegate-once.sh"
phase() {
  mode=$1;ceiling=$2
  # All setup shares the explicitly reviewed host-budget600s, security acquisition included.
  duration=$(python3 - "$EVIDENCE" "$mode" "$ceiling" <<'PY'
import json,pathlib,sys,time
p=pathlib.Path(sys.argv[1]);mode=sys.argv[2];cap=int(sys.argv[3]);clock=json.loads((p/'job-clock.json').read_text());now=time.monotonic()
remaining=clock['deadline_monotonic']-now-120
if mode in {'install','native','browser'}:
 state=json.loads((p/'host-budget.json').read_text());remaining=min(remaining,600-state['elapsed_seconds'])
v=int(min(cap,remaining));assert v>15,'NOT_STARTED_BUDGET'
if mode=='checks':assert v==600,'NOT_STARTED_JOINT_REQUIRES_FULL600s_HOST_ALLOCATION'
print(v-15)
PY
)
  # Fixed enum selects a fixed pinned helper; host revalidates independently.
  read -r selected_helper selected_sha < <(python3 "$ops/phase_contract.py" --phase "$mode" --legacy "$helper/root-self-admit.py" --checks "$ops/root-self-admit-checks256.py")
  out="$EVIDENCE/$mode";mkdir "$out"
  start=$(python3 -c 'import time; print(time.monotonic())')
  if python3 "$ops/phase-host.py" --delegated-parent "$scope" --work "$WORK" --harness "$ops" --evidence "$out" --staged-bwrap "$STAGED_BWRAP" --run-id "$GITHUB_RUN_ID" --reviewed-root-helper "$selected_helper" --root-helper-sha256 "$selected_sha" --dependency-store "$store" --phase "$mode" --phase-seconds "$duration"; then rc=0; else rc=$?; fi
  python3 - "$EVIDENCE" "$mode" "$start" "$rc" <<'PY'
import json,pathlib,sys,time,os
sys.path.insert(0,str(pathlib.Path(os.environ['GITHUB_WORKSPACE'])/'tests/real-process/neo4j-service-trial'))
from evidence_policy import configure,emit_text
p=pathlib.Path(sys.argv[1]);configure(p);mode=sys.argv[2];elapsed=time.monotonic()-float(sys.argv[3]);state=json.loads((p/'host-budget.json').read_text())
if mode in {'install','native','browser'}:
 state['elapsed_seconds']+=elapsed;state['commands'].append({'name':mode,'elapsed_seconds':elapsed,'rc':int(sys.argv[4])});emit_text(p/'host-budget.json',json.dumps(state,indent=2))
PY
  return "$rc"
}
# Proposed source only. This script is NOT a dispatch grant and current pins
# intentionally remain OPEN until the whole candidate has independent review.
phase install 180
python3 - "$store" <<'NATIVE_MOUNTPOINTS'
import pathlib,sys
root=pathlib.Path(sys.argv[1]);assert root.is_dir()and not root.is_symlink()
for rel in ['.silhouette-native-neo4j','.silhouette-native-redis']:
 path=root/rel;assert not path.exists()and not path.is_symlink();path.mkdir(mode=0o755)
NATIVE_MOUNTPOINTS
phase native 270
python3 - "$EVIDENCE/native/scope-cleanup.json" "$EVIDENCE/native/native-session.json" "$EVIDENCE/native/neo4j-admission.json" <<'ADMISSION_RESULT'
import json,pathlib,sys
scope,session,admission=[json.loads(pathlib.Path(p).read_text())for p in sys.argv[1:]]
assert scope['natural_empty']and not scope['events']and not session.get('unsafe',True)
assert [r['name']for r in session['results']]==['sqlite-prebuild','sharp-libvips','sharp-prebuild','sharp-dll-copy','redis-build','neo4j-admission']
assert all(r['status']=='PASS'for r in session['results'])
assert admission['status']=='ADMITTED_ARCHIVE_ONLY_NOT_BOOTFIT'
ADMISSION_RESULT
phase checks 600
python3 - "$EVIDENCE/checks/scope-cleanup.json" "$EVIDENCE/checks/checks-session.json" "$EVIDENCE/checks/neo4j-boot-evidence.json" "$EVIDENCE/checks/containment-host.json" <<'JOINT_PARTIAL_RESULT'
import json,pathlib,sys
scope,session,envelope,host=[json.loads(pathlib.Path(p).read_text())for p in sys.argv[1:]]
metrics=host['pre_cleanup_metrics'];memory=dict(line.split()for line in metrics['memory.events'].splitlines());pids=dict(line.split()for line in metrics['pids.events'].splitlines())
assert all(int(memory[k])==0 for k in ['oom','oom_kill','max'])and int(pids['max'])==0
assert scope['natural_empty']and not scope['events']and not session.get('unsafe',True)
assert len(session['results'])==1 and session['results'][0]['status']=='PASS'
assert envelope['status']=='INCOMPLETE'and envelope['redisMainNativeClosure']=='UNSUPPORTED_PUBLIC_JOIN_API'
assert envelope['lifecycleAcceptance']=='INCOMPLETE_NOT_ACCEPTED'
assert envelope['functionalStatus']=='SCOPED_REAL_AC_ASSERTIONS_COMPLETE'
print('FUNCTIONAL_PARTIAL_CASES_COMPLETE_LIFECYCLE_PRODUCT_INCOMPLETE_NOT_ACCEPTED')
JOINT_PARTIAL_RESULT
