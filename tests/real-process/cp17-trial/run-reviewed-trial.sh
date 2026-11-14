#!/usr/bin/env bash
# REVIEW ONLY. A new exact packet push/run GO is required outside this script.
# Run only after original pinned security acquisition completes successfully.
set -euo pipefail
: "${WORK:?}" "${EVIDENCE:?}" "${STAGED_BWRAP:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_WORKSPACE:?}"
[[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ ]]
uid=$(id -u);gid=$(id -g);[[ "$uid" = 1001 || "$uid" = 1000 ]]
ops="$GITHUB_WORKSPACE/tests/real-process/cp17-trial"
helper="$WORK/tests/real-process/wal-owner"
store="/var/lib/silhouette-cp17-deps-$GITHUB_RUN_ID/store"
scope="/sys/fs/cgroup/silhouette-owner-once-$GITHUB_RUN_ID"
# Publish packet.sha256 must anchor all operational source outside mutable test work.
(cd "$ops" && sha256sum --check infrastructure.sha256)
# Refuse unresolved inputs before privileged provisioning or package fetch.
python3 - "$ops" <<'PREPARATION_REVIEW_GATE'
import hashlib,json,pathlib,sys
ops=pathlib.Path(sys.argv[1]);budget=json.loads((ops/'export-budget.json').read_text())
assert len(budget['files'])==len(set(budget['files']))==budget['known_count']
assert budget['cap']==128 and budget['headroom']>=1 and budget['known_count']<=127
admission=json.loads((ops/'neo4j-admission-inputs.json').read_text())
assert admission['status']=='EXACT_RUNNER_JDK_PIN_INDEPENDENTLY_REVIEWED'and isinstance(admission['jdk'],dict),'NOT_STARTED_MISSING_REVIEWED_JDK_INPUTS'
assert admission['jdk_source_evidence']['evidence_review']=='ACCEPTED_STATIC_ONLY_BY_PARENT_AFTER_INDEPENDENT_REVIEW','NOT_STARTED_JDK_EVIDENCE_REVIEW_PENDING'
assert admission['inventory_sha256']==hashlib.sha256((ops/'neo4j-asset-pin.json').read_bytes()).hexdigest(),'NOT_STARTED_NEO4J_INVENTORY_PIN'
state=json.loads((ops/'oracle-preparation/preparation-capacity.json').read_text())
assert state['status']=='CANDIDATE_TECHNICAL_INPUTS_PINNED','NOT_STARTED_UNREVIEWED_PREPARATION'
assert state['source_graph']['candidate_manifest_sha256']==hashlib.sha256((ops/'integral-inputs.json').read_bytes()).hexdigest()
for name in ['vitest-generation','wal','accepted']:
 for key in ['scopes','active','failures','resources']:
  value=state[name][key];assert type(value)is int and value>0,'NOT_STARTED_UNREVIEWED_CAPACITY:'+name+':'+key
PREPARATION_REVIEW_GATE
# Pure transitive admission preflight, before volume/delegation/package operations.
for exact_phase in native checks; do
  python3 "$ops/phase_contract.py" --phase "$exact_phase" --legacy "$helper/root-self-admit.py" --checks "$ops/root-self-admit-checks256.py"
done
cleanup() {
  code=$?;trap - EXIT
  set +e
  bash "$helper/cleanup-delegation.sh" > "$EVIDENCE/trial-cgroup-cleanup.log" 2>&1
  cg=$?
  # Never unmount a volume potentially held by surviving trial processes.
  if [[ "$cg" = 0 ]]; then
    sudo -n /usr/bin/python3 - cleanup "$GITHUB_RUN_ID" "$uid" "$gid" < "$ops/dependency-volume.py" > "$EVIDENCE/dependency-volume-cleanup.log" 2>&1
    vol=$?
  else vol=1; fi
  printf '{"cgroup_rc":%s,"volume_rc":%s,"trial_rc":%s}\n' "$cg" "$vol" "$code" > "$EVIDENCE/trial-cleanup.json"
  if [[ "$cg" != 0 || "$vol" != 0 ]]; then exit 1; fi
  exit "$code"
}
trap cleanup EXIT
# Both privileged scripts are exact reviewed bytes, stdin only, never package code.
volume_start=$(python3 -c 'import time; print(time.monotonic())')
sudo -n /usr/bin/python3 - create "$GITHUB_RUN_ID" "$uid" "$gid" < "$ops/dependency-volume.py" > "$EVIDENCE/dependency-volume.json"
bash "$helper/delegate-once.sh" > "$EVIDENCE/delegation.log" 2>&1
python3 - "$EVIDENCE/host-budget.json" "$volume_start" <<'PYSETUP'
import json,pathlib,sys,time
p=pathlib.Path(sys.argv[1]);s=json.loads(p.read_text());e=time.monotonic()-float(sys.argv[2]);s['elapsed_seconds']+=e;s['commands'].append({'name':'dependency-volume-and-delegation','elapsed_seconds':e});p.write_text(json.dumps(s,indent=2))
PYSETUP
phase() {
  mode=$1;ceiling=$2
  # All setup shares the explicitly reviewed host-budget240s, security acquisition included.
  duration=$(python3 - "$EVIDENCE" "$mode" "$ceiling" <<'PY'
import json,pathlib,sys,time
p=pathlib.Path(sys.argv[1]);mode=sys.argv[2];cap=int(sys.argv[3]);clock=json.loads((p/'job-clock.json').read_text());now=time.monotonic()
remaining=clock['deadline_monotonic']-now-120
if mode in {'install','native','browser'}:
 state=json.loads((p/'host-budget.json').read_text());remaining=min(remaining,240-state['elapsed_seconds'])
v=int(min(cap,remaining));assert v>15,'NOT_STARTED_BUDGET'
if mode=='checks':assert v==220,'NOT_STARTED_BOOT_REQUIRES_FULL220s_HOST_ALLOCATION'
print(v-15)
PY
)
  # Fixed enum selects a fixed pinned helper; host revalidates independently.
  read -r selected_helper selected_sha < <(python3 "$ops/phase_contract.py" --phase "$mode" --legacy "$helper/root-self-admit.py" --checks "$ops/root-self-admit-checks256.py")
  out="$EVIDENCE/$mode";mkdir "$out"
  start=$(python3 -c 'import time; print(time.monotonic())')
  if python3 "$ops/phase-host.py" --delegated-parent "$scope" --work "$WORK" --harness "$ops" --evidence "$out" --staged-bwrap "$STAGED_BWRAP" --run-id "$GITHUB_RUN_ID" --reviewed-root-helper "$selected_helper" --root-helper-sha256 "$selected_sha" --dependency-store "$store" --phase "$mode" --phase-seconds "$duration"; then rc=0; else rc=$?; fi
  python3 - "$EVIDENCE" "$mode" "$start" "$rc" <<'PY'
import json,pathlib,sys,time
p=pathlib.Path(sys.argv[1]);mode=sys.argv[2];elapsed=time.monotonic()-float(sys.argv[3]);state=json.loads((p/'host-budget.json').read_text())
if mode in {'install','native','browser'}:
 state['elapsed_seconds']+=elapsed;state['commands'].append({'name':mode,'elapsed_seconds':elapsed,'rc':int(sys.argv[4])});(p/'host-budget.json').write_text(json.dumps(state,indent=2))
PY
  return "$rc"
}
# Required archive readmission only, then one dedicated real Neo4j checks command.
python3 - "$store" <<'NEO4J_MOUNTPOINT'
import pathlib,sys
root=pathlib.Path(sys.argv[1]);assert root.is_dir()and not root.is_symlink()
path=root/'.silhouette-native-neo4j';assert not path.exists()and not path.is_symlink()
path.mkdir(mode=0o755)
NEO4J_MOUNTPOINT
phase native 75
python3 - "$EVIDENCE/native/scope-cleanup.json" "$EVIDENCE/native/native-session.json" "$EVIDENCE/native/neo4j-admission.json" <<'ADMISSION_RESULT'
import json,pathlib,sys
scope,session,admission=[json.loads(pathlib.Path(p).read_text())for p in sys.argv[1:]]
assert scope['natural_empty']and not scope['events'],'UNSAFE_OR_FORCED_NATIVE_CLEANUP'
assert not session.get('unsafe',True),'UNSAFE_INNER_NATIVE'
assert len(session['results'])==1 and session['results'][0]['name']=='neo4j-admission'and session['results'][0]['status']=='PASS','ARCHIVE_ADMISSION_FAILED'
assert admission['status']=='ADMITTED_ARCHIVE_ONLY_NOT_BOOTFIT'
print('NEO4J_STATIC_ARCHIVE_ADMISSION_ONLY_NOT_SERVICE_OR_STAGEB_PASS')
ADMISSION_RESULT
# Exactly one real dependency boot after required ephemeral asset readmission.
phase checks 220
python3 - "$EVIDENCE/checks/scope-cleanup.json" "$EVIDENCE/checks/checks-session.json" "$EVIDENCE/checks/neo4j-boot-evidence.json" "$EVIDENCE/checks/containment-host.json" <<'BOOT_RESULT'
import json,pathlib,sys
scope,session,envelope,host=[json.loads(pathlib.Path(p).read_text())for p in sys.argv[1:]]
metrics=host['pre_cleanup_metrics'];memory=dict(line.split()for line in metrics['memory.events'].splitlines());pids=dict(line.split()for line in metrics['pids.events'].splitlines())
assert all(int(memory[k])==0 for k in ['oom','oom_kill','max'])and int(pids['max'])==0,'BOOT_RESOURCE_LIMIT_EVENT'
assert host['status']=='FINAL_PASS'
assert scope['natural_empty']and not scope['events'],'UNSAFE_OR_FORCED_BOOT_CLEANUP'
assert not session.get('unsafe',True),'UNSAFE_INNER_BOOT'
assert len(session['results'])==1 and session['results'][0]['name']=='neo4j-boot-real'and session['results'][0]['status']=='PASS'
assert envelope['runtime_files_complete']and envelope['result']['status']=='ONE_BOOT_QUERY_READBACK_CONTROLLED_SHUTDOWN_PASS_NOT_PRODUCT'
print('NEO4J_ONE_REAL_BOOT_ONLY_NOT_SERVICE_CONTROLLER_UI_OR_FEATURE')
BOOT_RESULT
