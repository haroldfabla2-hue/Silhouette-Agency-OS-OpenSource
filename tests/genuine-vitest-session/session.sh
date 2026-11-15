#!/usr/bin/env bash
# SOURCE PROPOSAL. No product driver: calls the actual locked Vitest CLI/config.
set -euo pipefail
repo=$1
git() { /usr/bin/git -c safe.directory="$repo" "$@"; }
expected=$2
runid=$3
[[ "$runid" =~ ^[0-9]+$ ]]
root=/mnt/silhouette-genuine-vitest
# RemainAfterExit retains evidence, so --wait would deadlock successful units.
# Poll only service state until its main process exits; kernel RuntimeMax remains the kill bound.
wait_unit() {
  local unit=$1 limit=$2 until=$((SECONDS+$2)) state status
  while test "$SECONDS" -le "$until"; do
    state=$(systemctl show "$unit" --property=SubState --value)
    case "$state" in
      exited|failed)
        status=$(systemctl show "$unit" --property=ExecMainStatus --value)
        [[ "$status" =~ ^[0-9]+$ ]] || return 125
        return "$status" ;;
    esac
    sleep 1
  done
  return 124
}
cleanup() { bash "$repo/tests/genuine-vitest-session/cleanup.sh" "$expected" "$runid"; }
# Ownership is installed only after refusing any existing root/marker/accounts.
owned=false
cleanup_if_owned() { if $owned; then cleanup; fi; }
trap cleanup_if_owned EXIT
trap 'exit 143' TERM INT
# Root receives no runner/GitHub environment. Only a pinned Node tool path is allowed.
[[ "$PATH" != *"/home/"* ]]
start=$SECONDS
# Parent slice accounts ALL units and retained tmpfs/cache charges between phases.
# This avoids pretending that an exited acquisition unit's page cache disappeared.
systemctl set-property --runtime silhouette-vitest.slice MemoryMax=10G MemorySwapMax=0 CPUQuota=200% TasksMax=384
test "$(systemctl show silhouette-vitest.slice --property=MemoryMax --value)" = 10737418240
test "$(systemctl show silhouette-vitest.slice --property=MemorySwapMax --value)" = 0
test "$(systemctl show silhouette-vitest.slice --property=TasksMax --value)" = 384
test "$(systemctl show silhouette-vitest.slice --property=CPUQuotaPerSecUSec --value)" = 2s
slice_group=$(systemctl show silhouette-vitest.slice --property=ControlGroup --value)
python3 - "/sys/fs/cgroup$slice_group" <<'PYLIMIT'
from pathlib import Path
import sys
p=Path(sys.argv[1]);assert (p/'memory.max').read_text().strip()=='10737418240'
assert (p/'memory.swap.max').read_text().strip()=='0'
assert (p/'pids.max').read_text().strip()=='384'
quota,period=(p/'cpu.max').read_text().split();assert int(quota)==2*int(period)
PYLIMIT
[[ "$expected" =~ ^[0-9a-f]{40}$ ]]
test "$(git -C "$repo" rev-parse HEAD)" = "$expected"
test "$(git -C "$repo" rev-parse HEAD^)" = 1d2610d8c9e2f3075e43142e8f4da81afe86dc68
# Fail before allocating, never resize a previous attempt or use an existing account/root.
test ! -e "$root"
! id silhouette-acquire >/dev/null 2>&1
! id silhouette-runtime >/dev/null 2>&1
test "$(df --output=avail -B1 "$repo" | tail -1)" -ge 10737418240
test -d /sys/fs/cgroup/system.slice
test "$(stat -fc %T /sys/fs/cgroup)" = cgroup2fs
command -v systemd-run
command -v iptables
command -v ip6tables
systemd --version | grep -q '+SECCOMP'
test -r /proc/sys/kernel/seccomp/actions_avail
grep -qw errno /proc/sys/kernel/seccomp/actions_avail
node=$(readlink -f "$(command -v node)")
test "$(sha256sum "$node" | cut -d' ' -f1)" = ccacb2d6d87ba6d118b2bffc1ae33747a05cc5fc6b1f1ec4fc1d420b687e952d
test "$("$node" --version)" = v22.18.0
test ! -e /run/silhouette-genuine-vitest-owner
( set -o noclobber; printf '%s:%s\n' "$expected" "$runid" > /run/silhouette-genuine-vitest-owner )
owned=true
useradd --system --user-group --no-create-home --shell /usr/sbin/nologin silhouette-acquire
useradd --system --user-group --no-create-home --shell /usr/sbin/nologin silhouette-runtime
auid=$(id -u silhouette-acquire)
ruid=$(id -u silhouette-runtime)
mkdir -m 700 "$root"
# Kernel hard aggregate bytes AND inode count, not a du/df polling claim.
mount -t tmpfs -o size=6G,nr_inodes=250000,noswap,nosuid,nodev,mode=0755 tmpfs "$root"
mkdir "$root/work" "$root/private" "$root/sources" "$root/runtime" "$root/fixtures"
cp "$repo/tests/genuine-vitest-session/acquire.py" "$root/fixtures/acquire.py"
cp "$repo/tests/integrated-ui-trial/"{archive-member-normalizations.json,libsignal-packed-files.json} "$root/fixtures/"
mkdir "$root/fixtures/native-provenance"
cp "$repo/tests/integrated-ui-trial/native-provenance/better-sqlite3-v12.5.0-node-v127-linux-x64.tar.gz" "$root/fixtures/native-provenance/"
chmod -R a-w "$root/fixtures"
chmod 700 "$root/private"
# systemd documents that proc isolation can degrade on unsupported kernels: prove features first.
mkdir "$root/private/proc-probe"
mount -t proc -o hidepid=invisible,subset=pid proc "$root/private/proc-probe"
procopts=$(findmnt -n -o OPTIONS --target "$root/private/proc-probe")
grep -Eq '(^|,)hidepid=(invisible|2)(,|$)' <<< "$procopts"
grep -Eq '(^|,)subset=pid(,|$)' <<< "$procopts"
umount "$root/private/proc-probe"
rmdir "$root/private/proc-probe"
chown "$auid:$auid" "$root/work"
chown "$ruid:$ruid" "$root/runtime"
# Exact public CODE ONLY per-session inventories. No .git/.env/default state or historical fixture data.
python3 - "$repo" "$root" <<'PY'
from pathlib import Path
import sys,json,subprocess,hashlib
repo=Path(sys.argv[1]);root=Path(sys.argv[2]);spec=json.loads((repo/'tests/genuine-vitest-session/SOURCE-SESSIONS.json').read_text())
for name,session in spec['sessions'].items():
 dest=root/'sources'/name;dest.mkdir()
 overrides={r['path']:r for r in session['overrides']}
 for candidateRow in spec['files']:
  row=overrides.get(candidateRow['path'],candidateRow)
  commit=session['p0TestCommit']if row['path']=='tests/automated/memory-transitions-p0.test.ts'else session['productCommit']
  p=Path(row['path']);assert not p.is_absolute()and '..'not in p.parts
  mode=subprocess.check_output(['/usr/bin/git','-c','safe.directory='+str(repo),'ls-tree',commit,'--',row['path']],cwd=repo,text=True).split()[0]
  assert mode in ('100644','100755'),'NON_REGULAR_SOURCE'
  b=subprocess.check_output(['/usr/bin/git','-c','safe.directory='+str(repo),'show',commit+':'+row['path']],cwd=repo)
  assert len(b)==row['bytes']and hashlib.sha256(b).hexdigest()==row['sha256']
  f=dest/p;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b)
 # Empty bind targets only. Actual source tree remains read-only at runtime.
 (dest/'node_modules').mkdir();(dest/'db').mkdir();(dest/'data').mkdir()
assert hashlib.sha256((root/'sources/candidate/package-lock.json').read_bytes()).hexdigest()=='039ce85293514e83584ca047d0d8b53eb7bce71bb3b3fe75fc6f96e928a0299c'
PY
cp -a "$root/sources/candidate" "$root/work/candidate"
chown -R "$auid:$auid" "$root/work"
# Acquisition is separate UID/cgroup with no GitHub token, no product source execution, no scripts.
# Only this phase has network; private checkout/protected evidence are inaccessible.
systemd-run --quiet --no-block --unit silhouette-vitest-acquire --slice=silhouette-vitest.slice --service-type=exec \
  -p User=silhouette-acquire -p Group=silhouette-acquire -p NoNewPrivileges=yes \
  -p ProtectSystem=strict -p ProtectHome=yes -p PrivateDevices=yes \
  -p InaccessiblePaths="$repo $root/private /run /tmp /var/tmp /dev/shm" \
  -p ProtectProc=invisible -p ProcSubset=pid -p PrivateIPC=yes -p RestrictSUIDSGID=yes -p CapabilityBoundingSet= \
  -p SystemCallArchitectures=native -p RestrictNamespaces=yes -p ProtectKernelTunables=yes -p ProtectControlGroups=yes -p ProtectKernelModules=yes -p LockPersonality=yes -p RestrictRealtime=yes -p ReadWritePaths="$root/work" \
  -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=100% -p TasksMax=256 \
  -p LimitNOFILE=4096 -p LimitFSIZE=67108864 -p RuntimeMaxSec=540 \
  -p TimeoutStopSec=10 -p KillMode=control-group -p RemainAfterExit=yes -p StandardOutput=null -p StandardError=null \
  /usr/bin/env -i PATH="$PATH" HOME="$root/work/npm-home" \
  /usr/bin/python3 "$root/fixtures/acquire.py" \
  "$root/fixtures" "$root/work"
wait_unit silhouette-vitest-acquire 560
test -f "$root/work/acquisition-evidence/complete.json"
test "$(systemctl show silhouette-vitest-acquire --property=Result --value)" = success
agroup=$(systemctl show silhouette-vitest-acquire --property=ControlGroup --value)
if test -n "$agroup" && test -e "/sys/fs/cgroup$agroup/cgroup.events"; then
  grep -q '^populated 0$' "/sys/fs/cgroup$agroup/cgroup.events"
fi
systemctl stop silhouette-vitest-acquire
# Root freezes exact installed tree after all-member verification. No runtime mutation/install.
chown -R root:root "$root/work/acquisition/node_modules"
chmod -R a-w "$root/work/acquisition/node_modules"
mount --bind "$root/work/acquisition/node_modules" "$root/work/acquisition/node_modules"
mount -o remount,bind,ro "$root/work/acquisition/node_modules"
# Every runtime child/native library shares the UID filter and seccomp address-family restriction.
iptables -I OUTPUT 1 -m owner --uid-owner "$ruid" -j REJECT
ip6tables -I OUTPUT 1 -m owner --uid-owner "$ruid" -j REJECT
iptables -C OUTPUT -m owner --uid-owner "$ruid" -j REJECT
ip6tables -C OUTPUT -m owner --uid-owner "$ruid" -j REJECT
for name in baseline-admission baseline-state candidate; do
  test "$((SECONDS-start))" -lt 800
  src="$root/sources/$name"
  data="$root/runtime/$name"
  mkdir "$data" "$data/tmp" "$data/home" "$data/db" "$data/data"
  chown -R "$ruid:$ruid" "$data"
  mount --bind "$root/work/acquisition/node_modules" "$src/node_modules"
  mount -o remount,bind,ro "$src/node_modules"
  mount --bind "$src" "$src"
  mount -o remount,bind,ro "$src"
  mount --bind "$data/db" "$src/db"
  mount --bind "$data/data" "$src/data"
  args=(tests/automated/memory-transitions-p0.test.ts)
  case "$name" in
    baseline-admission) args+=(-t 'captures typed payload|owns Float32Array|rejects mutation of an admitted') ;;
    baseline-state) args+=(-t 'keeps PENDING when destination|keeps VERIFIED when COMMITTED') ;;
    candidate) args+=(-t 'captures typed payload|owns Float32Array|rejects mutation of an admitted|keeps PENDING when destination|keeps VERIFIED when COMMITTED') ;;
  esac
  # No command wrapper imports or rewrites product services. Genuine Vitest owns setup, assertions and teardown.
  set +e
  systemd-run --quiet --no-block --unit "silhouette-vitest-$name" --slice=silhouette-vitest.slice --service-type=exec \
    -p User=silhouette-runtime -p Group=silhouette-runtime -p WorkingDirectory="$src" \
    -p NoNewPrivileges=yes -p ProtectSystem=strict -p ProtectHome=yes -p PrivateDevices=yes \
    -p InaccessiblePaths="$repo $root/private $root/work/npm-cache $root/work/npm-home /run /tmp /var/tmp /dev/shm" \
    -p ProtectProc=invisible -p ProcSubset=pid -p PrivateIPC=yes -p RestrictSUIDSGID=yes -p CapabilityBoundingSet= \
  -p SystemCallArchitectures=native -p RestrictNamespaces=yes -p ProtectKernelTunables=yes -p ProtectControlGroups=yes -p ProtectKernelModules=yes -p LockPersonality=yes -p RestrictRealtime=yes \
    -p ReadWritePaths="$data $src/db $src/data" -p RestrictAddressFamilies=AF_UNIX \
    -p MemoryMax=6G -p MemorySwapMax=0 -p CPUQuota=100% -p TasksMax=256 \
    -p LimitNOFILE=4096 -p LimitFSIZE=8388608 -p RuntimeMaxSec=85 \
    -p TimeoutStopSec=5 -p KillMode=control-group -p RemainAfterExit=yes -p StandardOutput=null -p StandardError=null \
    /usr/bin/env -i PATH="$PATH" HOME="$data/home" TMPDIR="$data/tmp" NODE_ENV=test \
    NODE_OPTIONS=--max-old-space-size=2048 SILHOUETTE_INFERENCE_MODE=cloud-only \
    SILHOUETTE_OWNER_SCOPES=128 SILHOUETTE_OWNER_ACTIVE=512 SILHOUETTE_OWNER_FAILURES=64 SILHOUETTE_OWNER_RESOURCES=256 \
    GOMAXPROCS=1 TOKIO_WORKER_THREADS=1 LANCE_CPU_THREADS=1 RAYON_NUM_THREADS=1 \
    "$node" "$src/node_modules/vitest/vitest.mjs" run "${args[@]}" --maxWorkers=1 --retry=0 --configLoader=runner --no-cache \
    --reporter=json --reporter=blob --outputFile.json="$data/report.json" --outputFile.blob="$data/blob.json"
  launch_code=$?
  if test "$launch_code" != 0; then exit "$launch_code"; fi
  wait_unit "silhouette-vitest-$name" 95
  code=$?
  set -e
  systemctl show "silhouette-vitest-$name" --property=Result,ExecMainCode,ExecMainStatus,ControlGroup,MemoryMax,MemoryPeak,TasksMax,CPUQuotaPerSecUSec,RestrictAddressFamilies > "$root/private/$name.service"
  # Read actual reporter; distinguish discriminating assertion-red from import/cleanup/native failures.
  python3 "$repo/tests/genuine-vitest-session/classify.py" "$name" "$data/report.json" "$data/blob.json" "$root/private/$name.service" "$code" > "$root/private/$name.summary.json"
  group=$(systemctl show "silhouette-vitest-$name" --property=ControlGroup --value)
  if test -n "$group" && test -e "/sys/fs/cgroup$group/cgroup.events"; then
    grep -q '^populated 0$' "/sys/fs/cgroup$group/cgroup.events"
  fi
  systemctl stop "silhouette-vitest-$name"
done
# Summaries are finite prevalidated numbers/enums; clean every resource before publishing them.
summary=$(python3 - "$root/private" <<'PYCODE'
from pathlib import Path
import sys,json
p=Path(sys.argv[1]);rows=[json.loads((p/(n+'.summary.json')).read_text())for n in ['baseline-admission','baseline-state','candidate']]
print(json.dumps({'scope':'FIVE_CURRENT_REAL_MEMORY_REGRESSIONS_ONLY','sessions':rows,'fullProductAccepted':False}))
PYCODE
)
cleanup
owned=false
printf '%s\n' "$summary"
