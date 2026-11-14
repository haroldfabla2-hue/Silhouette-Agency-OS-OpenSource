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
  # All setup shares the original host-budget180s, security acquisition included.
  duration=$(python3 - "$EVIDENCE" "$mode" "$ceiling" <<'PY'
import json,pathlib,sys,time
p=pathlib.Path(sys.argv[1]);mode=sys.argv[2];cap=int(sys.argv[3]);clock=json.loads((p/'job-clock.json').read_text());now=time.monotonic()
remaining=clock['deadline_monotonic']-now-60
if mode in {'install','native'}:
 state=json.loads((p/'host-budget.json').read_text());remaining=min(remaining,180-state['elapsed_seconds'])
v=int(min(cap,remaining));assert v>15,'NOT_STARTED_BUDGET';print(v-15)
PY
)
  out="$EVIDENCE/$mode";mkdir "$out"
  start=$(python3 -c 'import time; print(time.monotonic())')
  if python3 "$ops/phase-host.py" --delegated-parent "$scope" --work "$WORK" --harness "$ops" --evidence "$out" --staged-bwrap "$STAGED_BWRAP" --run-id "$GITHUB_RUN_ID" --reviewed-root-helper "$helper/root-self-admit.py" --root-helper-sha256 0b15dc9f61dac241681c41ff0d730fe627087b3ed1cde4c3a64683c4606708bc --dependency-store "$store" --phase "$mode" --phase-seconds "$duration"; then rc=0; else rc=$?; fi
  python3 - "$EVIDENCE" "$mode" "$start" "$rc" <<'PY'
import json,pathlib,sys,time
p=pathlib.Path(sys.argv[1]);mode=sys.argv[2];elapsed=time.monotonic()-float(sys.argv[3]);state=json.loads((p/'host-budget.json').read_text())
if mode in {'install','native'}:
 state['elapsed_seconds']+=elapsed;state['commands'].append({'name':mode,'elapsed_seconds':elapsed,'rc':int(sys.argv[4])});(p/'host-budget.json').write_text(json.dumps(state,indent=2))
PY
  return "$rc"
}
phase install 150
phase native 150
python3 "$ops/native-provenance.py" "$store" "$EVIDENCE/native"
# Admit all500s checks plus unchanged370s oracles, not an implicitly selected subset.
python3 - "$EVIDENCE/job-clock.json" <<'PY'
import json,pathlib,sys,time
assert json.loads(pathlib.Path(sys.argv[1]).read_text())['deadline_monotonic']-time.monotonic()>=1000,'NOT_STARTED_INTEGRAL_BUDGET'
PY
if phase checks 550; then checks=0; else checks=$?; fi
# On actual test failures only, independent six oracles can run. Unsafe scope stops.
python3 - "$EVIDENCE/checks/scope-cleanup.json" <<'PY'
import json,pathlib,sys
assert 'populated 1'not in json.loads(pathlib.Path(sys.argv[1]).read_text())['state'],'UNSAFE_CHECKS_CLEANUP'
PY
mkdir "$EVIDENCE/owner-harness"
set +e
timeout --signal=TERM --kill-after=5s 370s python3 "$ops/oracle-host.py" --delegated-parent "$scope" --work "$WORK" --harness "$helper" --evidence "$EVIDENCE/owner-harness" --staged-bwrap "$STAGED_BWRAP" --run-id "$GITHUB_RUN_ID" --reviewed-root-helper "$helper/root-self-admit.py" --root-helper-sha256 0b15dc9f61dac241681c41ff0d730fe627087b3ed1cde4c3a64683c4606708bc --dependency-store "$store"
oracle=$?;set -e
printf '%s\n' "$checks" > "$EVIDENCE/legacy-command.exit"
printf '%s\n' "$oracle" > "$EVIDENCE/harness-command.exit"
[[ "$checks" = 0 && "$oracle" = 0 ]]
