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
assert len(budget['files'])==len(set(budget['files']))==budget['known_count']==125
assert budget['cap']==128 and budget['headroom']==3 and budget['known_count']<=budget['cap']-budget['headroom']
state=json.loads((ops/'oracle-preparation/preparation-capacity.json').read_text())
assert state['status']=='CANDIDATE_TECHNICAL_INPUTS_PINNED','NOT_STARTED_UNREVIEWED_PREPARATION'
assert state['source_graph']['candidate_manifest_sha256']==hashlib.sha256((ops/'integral-inputs.json').read_bytes()).hexdigest()
for name in ['vitest-generation','wal','accepted']:
 for key in ['scopes','active','failures','resources']:
  value=state[name][key];assert type(value)is int and value>0,'NOT_STARTED_UNREVIEWED_CAPACITY:'+name+':'+key
PREPARATION_REVIEW_GATE
# Pure transitive admission preflight, before volume/delegation/package operations.
for exact_phase in install native browser checks; do
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
v=int(min(cap,remaining));assert v>15,'NOT_STARTED_BUDGET';print(v-15)
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
phase install 150
python3 - "$store" <<'PRIVATE_CACHE_MOUNTPOINTS'
import pathlib,sys
root=pathlib.Path(sys.argv[1]);assert root.is_dir()and not root.is_symlink()
for name in ['.vite-temp','.vite','.silhouette-native-redis','.silhouette-browser-assets']:
 path=root/name
 assert not path.exists()and not path.is_symlink(),'never replace existing dependency cache path'
 path.mkdir(mode=0o755)
 assert path.is_dir()and not path.is_symlink()and not list(path.iterdir())
PRIVATE_CACHE_MOUNTPOINTS
phase native 150
python3 "$ops/native-provenance.py" "$store" "$EVIDENCE/native"
if phase browser 90; then browser=0; else browser=$?; fi
# Preserve every browser-preparation evidence byte inside the existing native
# provenance file, then remove only the verified archived metadata directory.
python3 "$ops/pack-browser-evidence.py" "$EVIDENCE/browser" "$EVIDENCE/native/native-provenance.json"
[[ "$browser" = 0 ]]
# Admit1000s checks + unchanged370s oracles +120s cleanup/export together.
python3 - "$EVIDENCE/job-clock.json" <<'PY'
import json,pathlib,sys,time
assert json.loads(pathlib.Path(sys.argv[1]).read_text())['deadline_monotonic']-time.monotonic()>=1505,'NOT_STARTED_INTEGRAL_BUDGET'
PY
if phase checks 1015; then checks=0; else checks=$?; fi
# Independent six oracles run regardless of checks rc, only after verified
# natural-empty/no-forced-events cleanup. Unsafe/unknown scope stops.
python3 - "$EVIDENCE/checks/scope-cleanup.json" <<'PY'
import json,pathlib,sys
state=json.loads(pathlib.Path(sys.argv[1]).read_text());assert state['natural_empty']and not state['events'],'UNSAFE_OR_FORCED_CHECKS_CLEANUP'
PY
mkdir "$EVIDENCE/owner-harness"
set +e
timeout --signal=TERM --kill-after=5s 370s python3 "$ops/oracle-host.py" --delegated-parent "$scope" --work "$WORK" --harness "$helper" --preparation-inputs "$ops/oracle-preparation" --evidence "$EVIDENCE/owner-harness" --staged-bwrap "$STAGED_BWRAP" --run-id "$GITHUB_RUN_ID" --reviewed-root-helper "$helper/root-self-admit.py" --root-helper-sha256 0b15dc9f61dac241681c41ff0d730fe627087b3ed1cde4c3a64683c4606708bc --dependency-store "$store"
oracle=$?;set -e
printf '%s\n' "$checks" > "$EVIDENCE/legacy-command.exit"
printf '%s\n' "$oracle" > "$EVIDENCE/harness-command.exit"
[[ "$checks" = 0 && "$oracle" = 0 ]]
