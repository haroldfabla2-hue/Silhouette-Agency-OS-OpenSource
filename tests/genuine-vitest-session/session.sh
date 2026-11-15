#!/usr/bin/env bash
# Existing genuine product route, direct children under one kernel aggregate boundary.
set -euo pipefail
repo=$1;expected=$2;runid=$3
root=/mnt/silhouette-genuine-vitest
[[ "$expected" =~ ^[0-9a-f]{40}$ && "$runid" =~ ^[0-9]+$ ]]
git() { /usr/bin/git -c safe.directory="$repo" "$@"; }
owned=false
phase=PREPARATION
cleanup() { bash "$repo/tests/genuine-vitest-session/cleanup.sh" "$expected" "$runid"; }
close_out() {
 original=$?;trap - EXIT;set +e
 case "$phase" in PREPARATION|transport|acquire|baseline-admission|baseline-state|candidate) ;; *) phase=UNKNOWN;;esac
 printf 'DIRECT_ROUTE_CLOSEOUT {"phase":"%s","coordinatorExit":%s}\n' "$phase" "$original"

 if $owned; then cleanup; c=$?;if test "$c" != 0; then echo CLEANUP_FAILED_NO_ACCEPTANCE;if test "$original" = 0; then original=$c;fi;fi;fi
 exit "$original"
}
trap close_out EXIT
trap 'exit 143' TERM INT
start=$SECONDS
hostnet=$(readlink /proc/self/ns/net);hostpid=$(readlink /proc/self/ns/pid)
# Coordinator and parent both enforce the same existing 10GiB aggregate upper bound.
# No per-phase service/manager dependency job, polling/default-state acceptance or journal capture.
python3 -I - <<'PY'
from pathlib import Path
p=Path('/sys/fs/cgroup'+Path('/proc/self/cgroup').read_text().strip()[3:])
assert p.name=='silhouette-vitest-coordinator.service'
for q in(p,p.parent):
 assert(q/'memory.max').read_text().strip()=='10737418240'
 assert(q/'memory.swap.max').read_text().strip()=='0'
 assert(q/'pids.max').read_text().strip()=='384'
 a,b=map(int,(q/'cpu.max').read_text().split());assert a==2*b
PY
[[ "$expected" =~ ^[0-9a-f]{40}$ ]]
test "$(git -C "$repo" rev-parse HEAD)" = "$expected"
test "$(git -C "$repo" rev-parse HEAD^)" = ccad929bc12e92c70aaeebafd14c618c797b1a60
# Fail before allocating, never resize a previous attempt or use an existing account/root.
test ! -e "$root"
! id silhouette-acquire >/dev/null 2>&1
! id silhouette-runtime >/dev/null 2>&1
test "$(df --output=avail -B1 "$repo" | tail -1)" -ge 10737418240
test -d /sys/fs/cgroup/system.slice
test "$(stat -fc %T /sys/fs/cgroup)" = cgroup2fs
command -v bwrap
command -v iptables
command -v ip6tables
test "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = 1
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
agid=$(id -g silhouette-acquire)
ruid=$(id -u silhouette-runtime)
rgid=$(id -g silhouette-runtime)
mkdir -m 700 "$root"
# Aggregate workload6140MiB/249488inodes; separate2MiB/128inode ownedsetup, no writable private/run mounts.
# Kernel hard aggregate bytes AND inode count, not a du/df polling claim.
mount -t tmpfs -o size=6140M,nr_inodes=249488,noswap,nosuid,nodev,mode=0755 tmpfs "$root"
mkdir "$root/work" "$root/private" "$root/sources" "$root/runtime" "$root/fixtures" "$root/transport"
mkdir "$root/fixtures/empty"
cp "$repo/tests/genuine-vitest-session/direct.py" "$root/fixtures/direct.py"
python3 -I "$root/fixtures/direct.py" policy "$root/fixtures/filter.bpf"
python3 -I "$root/fixtures/direct.py" policy "$root/fixtures/transport-filter.bpf" transport
cp "$repo/tests/genuine-vitest-session/acquire.py" "$root/fixtures/acquire.py"
cp "$repo/tests/integrated-ui-trial/"{archive-member-normalizations.json,libsignal-packed-files.json} "$root/fixtures/"
mkdir "$root/fixtures/native-provenance"
cp "$repo/tests/integrated-ui-trial/native-provenance/better-sqlite3-v12.5.0-node-v127-linux-x64.tar.gz" "$root/fixtures/native-provenance/"
# Complete Node-bundled npm provenance, not registry npm's different packaging.
python3 - "$repo" "$root" "$node" <<'PYTOOLCHAIN'
from pathlib import Path
import sys,hashlib,json,shutil,stat
repo,root,node=map(Path,sys.argv[1:]);fixture=root/'fixtures'
raw=(repo/'tests/genuine-vitest-session/node-bundled-npm-members.json').read_bytes()
assert hashlib.sha256(raw).hexdigest()=='b0f244f332ccad6e5f6805d866b9b5d7f2e7a3a51e0d1b3703b185c2546f9348'
rows=json.loads(raw);assert len(rows)==2245
source=node.parent.parent/'lib/node_modules/npm';dest=fixture/'toolchain/npm'
expected={r['path']for r in rows};actual=set()
for f in source.rglob('*'):
 st=f.lstat();assert not stat.S_ISLNK(st.st_mode)
 if stat.S_ISREG(st.st_mode):actual.add(str(f.relative_to(source)))
 else:assert stat.S_ISDIR(st.st_mode)
assert actual==expected
for row in rows:
 rel=Path(row['path']);assert not rel.is_absolute()and'..'not in rel.parts
 f=source/rel;b=f.read_bytes();assert len(b)==row['bytes']and hashlib.sha256(b).hexdigest()==row['sha256']
 target=dest/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b);target.chmod(row['mode']&0o555)
b=node.read_bytes();assert hashlib.sha256(b).hexdigest()=='ccacb2d6d87ba6d118b2bffc1ae33747a05cc5fc6b1f1ec4fc1d420b687e952d'
(fixture/'toolchain/bin').mkdir();(fixture/'toolchain/bin/node').write_bytes(b);(fixture/'toolchain/bin/node').chmod(0o555)
(fixture/'toolchain/bin/npm').symlink_to('../npm/bin/npm-cli.js')
for name,want in {
 'public-transport.cjs':'3b63546a498234cd7b9d27f956bfbce733d4a6b6f17c7a2214c6930ff0d8db8f',
 'public-transport-inventory.json':'6fee6ef7df0f89e18dfd6de8620f42f1fc2e8916f5b905e04c99326b32042e51',
}.items():
 b=(repo/'tests/genuine-vitest-session'/name).read_bytes();assert hashlib.sha256(b).hexdigest()==want
 (fixture/name).write_bytes(b)
PYTOOLCHAIN
chmod -R a-w "$root/fixtures"
chmod 700 "$root/private"
mkdir -m 755 "$root/diagnostic"
install -o root -g "$agid" -m 0620 /dev/null "$root/diagnostic/acquire.json"
chown "$auid:$agid" "$root/work" "$root/transport"
chown "$ruid:$rgid" "$root/runtime"
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
# Trusted exact byte helper only, no installer/package/product code on host network.
phase=transport
python3 -I "$root/fixtures/direct.py" run transport "$auid" "$agid" 180 "$hostnet" "$hostpid" "$root/fixtures/toolchain/bin/node" "$root/fixtures/public-transport.cjs"
python3 - "$root" <<'PYHANDOFF'
from pathlib import Path
import sys,json,hashlib,stat,os
root=Path(sys.argv[1]);t=root/'transport';proof=json.loads((t/'complete.json').read_text())
assert proof['status']=='PUBLIC_BYTES_CACHED_NOT_INSTALL_OR_PRODUCT_PASS'and proof['requests']==1174 and proof['downloadedBytes']==443214404 and proof['cacheBytes']<=536870912
f=t/'libsignal-source.tar.gz';st=f.lstat();assert stat.S_ISREG(st.st_mode)and st.st_nlink==1
b=f.read_bytes();assert len(b)==46103 and hashlib.sha256(b).hexdigest()=='a9e14823efa911474aaa9e8f6bfb88759f869a3bc25116e969be943b84bef318'
# Byte file becomes immutable fixture only after helper has naturally exited.
f.rename(root/'fixtures/libsignal-source.tar.gz');f=root/'fixtures/libsignal-source.tar.gz';os.chown(f,0,0);f.chmod(0o444)
(t/'cache').rename(root/'work/npm-cache')
PYHANDOFF
cp -a "$root/sources/candidate" "$root/work/candidate"
chown -R "$auid:$agid" "$root/work"
mkdir "$root/work/tmp"
chown "$auid:$agid" "$root/work/tmp"
phase=acquire
python3 -I "$root/fixtures/direct.py" run acquire "$auid" "$agid" 360 "$hostnet" "$hostpid" /usr/bin/python3 "$root/fixtures/acquire.py" "$root/fixtures" "$root/work"
test -f "$root/work/acquisition-evidence/complete.json"
chown -R root:root "$root/work/acquisition/node_modules"
chmod -R a-w "$root/work/acquisition/node_modules"
# Independent UID firewall retained as defense in depth, not a substitute for seccomp AF_UNIX.
iptables -I OUTPUT 1 -m owner --uid-owner "$ruid" -j REJECT
ip6tables -I OUTPUT 1 -m owner --uid-owner "$ruid" -j REJECT
iptables -C OUTPUT -m owner --uid-owner "$ruid" -j REJECT
ip6tables -C OUTPUT -m owner --uid-owner "$ruid" -j REJECT
for name in baseline-admission baseline-state candidate; do
 test "$((SECONDS-start))" -lt 800
 src="$root/sources/$name";data="$root/runtime/$name"
 mkdir "$data" "$data/tmp" "$data/home" "$data/db" "$data/data"
 chown -R "$ruid:$rgid" "$data"
 args=(tests/automated/memory-transitions-p0.test.ts)
 case "$name" in
  baseline-admission) args+=(-t 'captures typed payload|owns Float32Array|rejects mutation of an admitted') ;;
  baseline-state) args+=(-t 'keeps PENDING when destination|keeps VERIFIED when COMMITTED') ;;
  candidate) args+=(-t 'captures typed payload|owns Float32Array|rejects mutation of an admitted|keeps PENDING when destination|keeps VERIFIED when COMMITTED') ;;
 esac
 phase=$name
 set +e
 python3 -I "$root/fixtures/direct.py" run "$name" "$ruid" "$rgid" 85 "$hostnet" "$hostpid" "$root/fixtures/toolchain/bin/node" "$src/node_modules/vitest/vitest.mjs" run "${args[@]}" --maxWorkers=1 --retry=0 --configLoader=runner --no-cache --reporter=json --reporter=blob --outputFile.json="$data/report.json" --outputFile.blob="$data/blob.json"
 code=$?
 set -e
 # Reporter/blob/assertions unchanged. Root-owned actual childreceipt replaces managerdefaults.
 python3 -I "$repo/tests/genuine-vitest-session/classify.py" "$name" "$data/report.json" "$data/blob.json" "$root/private/$name.child.json" "$code" > "$root/private/$name.summary.json"
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
