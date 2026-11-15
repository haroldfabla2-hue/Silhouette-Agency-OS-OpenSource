#!/usr/bin/env bash
# SOURCE PROPOSAL. No product driver: calls the actual locked Vitest CLI/config.
set -euo pipefail
repo=$1
git() { /usr/bin/git -c safe.directory="$repo" "$@"; }
expected=$2
runid=$3
[[ "$runid" =~ ^[0-9]+$ ]]
root=/mnt/silhouette-genuine-vitest
host_network_namespace=$(readlink /proc/self/ns/net)
[[ "$host_network_namespace" =~ ^net:\[[0-9]+\]$ ]]
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
# Manager-owned configuration corroboration, not a substitute for same-PID admission.
# This runs after wait and before classifying/accepting any product evidence.
verify_unit_policy() {
  local unit=$1 phase=$2
  systemctl show "$unit" --property=User,Group,MemoryMax,MemorySwapMax,TasksMax,CPUQuotaPerSecUSec,TemporaryFileSystem,NoNewPrivileges,ProtectSystem,RestrictAddressFamilies,PrivateNetwork |
    /usr/bin/python3 -I -c '
import sys
phase=sys.argv[1]
v=dict(line.rstrip("\n").split("=",1)for line in sys.stdin if "="in line)
identity="silhouette-acquire"if phase=="acquire"else"silhouette-runtime"
assert v["User"]==identity and v["Group"]==identity
assert v["MemoryMax"]==("8589934592"if phase=="acquire"else"6442450944")
assert v["MemorySwapMax"]=="0"and v["TasksMax"]=="256"and v["CPUQuotaPerSecUSec"]=="1s"
assert v["NoNewPrivileges"]=="yes"and v["ProtectSystem"]=="strict"
if phase!="acquire":
 assert v["RestrictAddressFamilies"].split()==["AF_UNIX"]and v["PrivateNetwork"]=="yes"
rows=v["TemporaryFileSystem"].split();assert len(rows)==1
path,opts=rows[0].split(":",1);assert path=="/run"
options=set(opts.split(","));assert {"rw","noswap","nodev","nosuid","noexec"}<=options
assert ("size=1M"in options or"size=1048576"in options)and"nr_inodes=128"in options
' "$phase"
}
cleanup() { bash "$repo/tests/genuine-vitest-session/cleanup.sh" "$expected" "$runid"; }
# Ownership is installed only after refusing any existing root/marker/accounts.
owned=false
# Finite failure evidence, evaluated only after a workload failure and BEFORE owned cleanup.
# No raw journal/property text reaches stdout, disk, or the conversation.
current_unit=
current_exit=
failure_captured=false
unit_started=0
unit_finished=
failure_projection=
project_failure() {
  /usr/bin/python3 -I - "$current_unit" "$unit_started" "$unit_finished" "$1" <<'PYEVIDENCE'
import json,os,re,selectors,subprocess,sys,time
unit,started,finished,original=sys.argv[1:]
allowed={'silhouette-vitest-acquire','silhouette-vitest-baseline-admission','silhouette-vitest-baseline-state','silhouette-vitest-candidate'}
result={'phase':unit.removeprefix('silhouette-vitest-')if unit in allowed else'UNKNOWN','properties':'UNKNOWN','journal':'UNKNOWN','category':'UNKNOWN','path':'UNKNOWN'}
result['originalExit']=int(original)if original.isdigit()and len(original)<=3 else'UNKNOWN'
if unit not in allowed or not re.fullmatch(r'[0-9]+\.[0-9]{6}',started) or not re.fullmatch(r'[0-9]+\.[0-9]{6}',finished):
 print(json.dumps(result));sys.exit(0)
# One shared two-second budget, finite pipes, no stderr/raw exceptions.
deadline=time.monotonic()+2
def bounded(argv,cap):
 process=None
 try:
  process=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={'PATH':'/usr/bin:/usr/sbin:/bin:/sbin','LC_ALL':'C'},start_new_session=True)
  buf=bytearray();sel=selectors.DefaultSelector();sel.register(process.stdout,selectors.EVENT_READ)
  while sel.get_map():
   remaining=deadline-time.monotonic()
   if remaining<=0:return None,'DEADLINE'
   events=sel.select(remaining)
   if not events:return None,'DEADLINE'
   for key,_ in events:
    b=os.read(key.fileobj.fileno(),min(4096,cap+1-len(buf)))
    if not b:sel.unregister(key.fileobj);continue
    buf.extend(b)
    if len(buf)>cap:return None,'TRUNCATED'
  remaining=deadline-time.monotonic()
  if remaining<=0:return None,'DEADLINE'
  if process.wait(timeout=remaining)!=0:return None,'READ_FAILED'
  return bytes(buf),'CAPTURED'
 except BaseException:return None,'READ_FAILED'
 finally:
  if process is not None and process.poll()is None:
   try:os.killpg(process.pid,9)
   except ProcessLookupError:pass
   try:process.wait(timeout=.1)
   except BaseException:pass
fields=['Result','ExecMainCode','ExecMainStatus','ActiveState','SubState','InvocationID']
raw,state=bounded(['/usr/bin/systemctl','show',unit,'--property='+','.join(fields)],4096)
result['properties']=state
if raw is not None:
 try:
  values=dict(line.split('=',1)for line in raw.decode('utf8').splitlines()if'='in line)
  enums={'Result':{'success','exit-code','signal','core-dump','watchdog','timeout','oom-kill','resources','protocol','start-limit-hit'},'ActiveState':{'active','inactive','failed','activating','deactivating'},'SubState':{'exited','failed','dead','running','start','start-pre','start-post','stop','stop-sigterm','stop-sigkill'}}
  for key in fields:
   value=values.get(key,'')
   if key in enums:result[key]=value if value in enums[key]else'UNKNOWN'
   elif key=='InvocationID':result[key]=value if re.fullmatch('[0-9a-f]{32}',value)else'UNKNOWN'
   else:result[key]=int(value)if value.isdigit()and len(value)<=10 else'UNKNOWN'
 except BaseException:result['properties']='PARSE_FAILED'
raw,state=bounded(['/usr/bin/journalctl','--unit='+unit+'.service','--since=@'+started,'--until=@'+finished,'--lines=8','--output=json','--output-fields=MESSAGE','--no-pager','--quiet'],32768)
result['journal']=state
if raw is not None:
 try:
  lines=raw.splitlines();assert len(lines)<=8
  messages=[json.loads(line).get('MESSAGE','')for line in lines]
  messages=[m for m in messages if isinstance(m,str)]
  result['records']=len(lines)
  if len(lines)==8:result['journal']='AT_RECORD_CAP_POSSIBLY_TRUNCATED'
  if not lines:result['journal']='MISSING'
  # Preserve only fixed categorization. Raw paths/commands/errors are never returned.
  for message in messages:
   categories=[('Failed to set up mount namespacing','MOUNT_NAMESPACE_SETUP'),('Failed to set up IPC namespacing','IPC_NAMESPACE_SETUP'),('Failed at step NAMESPACE','NAMESPACE_SETUP'),('Failed at step EXEC','EXEC_ENTRY'),('Failed to set up credentials','CREDENTIAL_SETUP')]
   category=next((label for prefix,label in categories if prefix in message),None)
   if category is None:continue
   if category!='NAMESPACE_SETUP'or result['category']=='UNKNOWN':result['category']=category
   if '/run/systemd/incoming'in message:result['path']='PRIVATE_RUN_INCOMING'
   elif '/run/'in message and result['path']=='UNKNOWN':result['path']='PRIVATE_RUN_OTHER'
   elif '/mnt/silhouette-genuine-vitest'in message and result['path']=='UNKNOWN':result['path']='OWNED_ROOT'
   elif '/home/runner/work/'in message and result['path']=='UNKNOWN':result['path']='CHECKOUT'
   elif '/proc'in message and result['path']=='UNKNOWN':result['path']='PROC'
   elif '/dev'in message and result['path']=='UNKNOWN':result['path']='DEV'
   elif '/sys'in message and result['path']=='UNKNOWN':result['path']='SYS'
   elif result['path']=='UNKNOWN':result['path']='OTHER_REDACTED'
 except BaseException:result['journal']='PARSE_FAILED'
print(json.dumps(result,separators=(',',':')))
PYEVIDENCE
}
close_out() {
  local original=$? cleanup_code=0 coordinator_exit
  coordinator_exit=$original
  if test "$original" != 0 && [[ "$current_exit" =~ ^[0-9]+$ ]] && test "$current_exit" != 0; then original=$current_exit; fi
  trap - EXIT
  set +e
  if test "$original" != 0 && test -n "$current_unit" && ! $failure_captured; then
    if test -z "$unit_finished"; then unit_finished=$(date +%s.%6N); fi
    failure_projection+=$(project_failure "$original")
    if test "$?" != 0 || test -z "$failure_projection"; then failure_projection='{"category":"UNKNOWN","evidence":"CAPTURE_FAILED"}'; fi
  fi
  if $owned; then cleanup; cleanup_code=$?; fi
  # Projection contains only constants, numbers, fixed enums and a validated invocation id.
  if test -n "$failure_projection"; then printf 'FINITE_FAILURE_PROJECTION %s\n' "$failure_projection"; fi
  if test "$coordinator_exit" != "$original"; then printf 'COORDINATOR_FAILURE coordinatorExit=%s originalChildExit=%s\n' "$coordinator_exit" "$original"; fi
  if test "$cleanup_code" != 0; then
    printf 'CLEANUP_FAILED_NO_ACCEPTANCE originalExit=%s cleanupExit=%s\n' "$original" "$cleanup_code"
    if test "$original" = 0; then original=$cleanup_code; fi
  fi
  exit "$original"
}
trap close_out EXIT
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
test "$(git -C "$repo" rev-parse HEAD^)" = 8b8e5d3f14bb9dcab0e46718b6c2c6221c03ae70
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
agid=$(id -g silhouette-acquire)
ruid=$(id -u silhouette-runtime)
rgid=$(id -g silhouette-runtime)
mkdir -m 700 "$root"
# Conservative aggregate: 6140MiB/249488 inodes plus four 1MiB/128-inode private /run mounts.
# Kernel hard aggregate bytes AND inode count, not a du/df polling claim.
mount -t tmpfs -o size=6140M,nr_inodes=249488,noswap,nosuid,nodev,mode=0755 tmpfs "$root"
mkdir "$root/work" "$root/private" "$root/sources" "$root/runtime" "$root/fixtures"
cp "$repo/tests/genuine-vitest-session/acquire.py" "$root/fixtures/acquire.py"
cp "$repo/tests/integrated-ui-trial/"{archive-member-normalizations.json,libsignal-packed-files.json} "$root/fixtures/"
mkdir "$root/fixtures/native-provenance"
cp "$repo/tests/integrated-ui-trial/native-provenance/better-sqlite3-v12.5.0-node-v127-linux-x64.tar.gz" "$root/fixtures/native-provenance/"
cat > "$root/fixtures/policy-admission.py" <<'PYADMISSION'
# This is an admission prefix, not a product/test driver. It has no subprocess,
# network, product imports, writable receipt, or alternate test/config invocation.
# Execute with python3 -I; only an immutable root-owned copy is admissible.
import os,stat,sys
from pathlib import Path

def admit():
 phase,uid,gid,root,repo,hostnet,executable,*argv=sys.argv[1:]
 assert phase in {'acquire','baseline-admission','baseline-state','candidate'}
 uid=int(uid);assert uid>0 and os.getresuid()==(uid,uid,uid)
 gid=int(gid);assert gid>0 and os.getresgid()==(gid,gid,gid)
 assert set(os.getgroups()) <= {gid}
 gate=Path(__file__)
 for path in (gate,gate.parent,gate.parent.parent):
  st=path.stat();assert st.st_uid==0 and st.st_mode&0o022==0
 assert not os.access(gate,os.W_OK) and not os.access(gate.parent,os.W_OK)
 status=dict(line.split(':',1)for line in Path('/proc/self/status').read_text().splitlines()if':'in line)
 assert all(int(status[key].strip(),16)==0 for key in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])
 assert status['NoNewPrivs'].strip()=='1' and status['Seccomp'].strip()=='2'
 if phase!='acquire':
  # Actual network namespace must differ from the trusted coordinator reference.
  assert os.readlink('/proc/self/ns/net')!=hostnet
  assert sorted(p.name for p in Path('/sys/class/net').iterdir())==['lo']
 # Read only mount metadata, never traverse inaccessible /run descendants.
 mounts=[]
 for line in Path('/proc/self/mountinfo').read_text().splitlines():
  left,right=line.split(' - ',1);a=left.split();b=right.split()
  mounts.append((a[4],a[2],a[3],set(a[5].split(',')),b[0],set(b[2].split(','))))
 def exact(path):
  candidates=[m for m in mounts if m[0]==path]
  assert len(candidates)==1
  return candidates[0]
 run=exact('/run');runstat=os.stat('/run');v=os.statvfs('/run')
 assert run[4]=='tmpfs' and run[2]=='/'
 assert {'rw','nodev','nosuid','noexec'}<=run[3]|run[5] and 'noswap'in run[5]
 assert runstat.st_uid==0 and runstat.st_gid==0 and stat.S_IMODE(runstat.st_mode)==0o700
 assert v.f_blocks*v.f_frsize<=1048576 and 0<v.f_files<=128
 assert not os.access('/run',os.X_OK) and not os.access('/run',os.W_OK)
 denied=[repo,root+'/private','/tmp','/var/tmp','/dev/shm']
 if phase!='acquire':denied += [root+'/work/npm-home',root+'/work/npm-cache']
 for path in denied:
  assert all(not os.access(path,mode)for mode in (os.R_OK,os.W_OK,os.X_OK))
 # Distinct superblock identity from the separately budgeted owned-root tmpfs.
 owned=exact(root);assert owned[4]=='tmpfs' and owned[1]!=run[1]
 v=os.statvfs(root)
 assert v.f_blocks*v.f_frsize<=6438256640 and 0<v.f_files<=249488
 proc=exact('/proc');assert proc[4]=='proc'
 assert ('hidepid=invisible'in proc[5] or'hidepid=2'in proc[5]) and'subset=pid'in proc[5]
 # Known final namespace must expose cgroup v2 counters or admission blocks.
 rows=Path('/proc/self/cgroup').read_text().splitlines();assert len(rows)==1 and rows[0].startswith('0::/')
 cgroup=rows[0][3:];expected='silhouette-vitest-'+phase+'.service'
 assert cgroup.endswith('/silhouette-vitest.slice/'+expected)
 cg=Path('/sys/fs/cgroup'+cgroup);parent=cg.parent
 def counters(path,memory,tasks,cpu):
  assert(path/'memory.max').read_text().strip()==str(memory)
  assert(path/'memory.swap.max').read_text().strip()=='0'
  assert(path/'pids.max').read_text().strip()==str(tasks)
  q,p=(path/'cpu.max').read_text().split();assert int(q)==cpu*int(p)
 counters(cg,8589934592 if phase=='acquire' else 6442450944,256,1)
 counters(parent,10737418240,384,2)
 # Final exec inherits this exact PID, namespaces, uid, environment and cgroup.
 # No child-owned PASS receipt is trusted or needed for admission ordering.
 assert os.path.isabs(executable)
 return executable,[executable,*argv]
try:
 executable,argv=admit()
except BaseException:
 # Includes hidden/unreadable/ambiguous mount or cgroup state: UNKNOWN, blocked.
 os._exit(125)
# env -i specifies no locale variables; undo CPython's optional locale coercion.
os.environ.pop('LC_CTYPE',None)
os.execve(executable,argv,dict(os.environ))
PYADMISSION
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
chown "$auid:$agid" "$root/work"
chown "$ruid:$rgid" "$root/runtime"
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
chown -R "$auid:$agid" "$root/work"
# Acquisition is separate UID/cgroup with no GitHub token, no product source execution, no scripts.
# Only this phase has network; private checkout/protected evidence are inaccessible.
current_unit=silhouette-vitest-acquire
current_exit=
failure_captured=false
unit_finished=
unit_started=$(date +%s.%6N)
systemd-run --quiet --no-block --unit silhouette-vitest-acquire --slice=silhouette-vitest.slice --service-type=exec \
  -p User=silhouette-acquire -p Group=silhouette-acquire -p NoNewPrivileges=yes \
  -p ProtectSystem=strict -p ProtectHome=yes -p PrivateDevices=yes \
  -p TemporaryFileSystem=/run:rw,size=1M,nr_inodes=128,noswap,nodev,nosuid,noexec,mode=0700,uid=0,gid=0 \
  -p InaccessiblePaths="$repo $root/private /tmp /var/tmp /dev/shm" \
  -p ProtectProc=invisible -p ProcSubset=pid -p PrivateIPC=yes -p RestrictSUIDSGID=yes -p CapabilityBoundingSet= \
  -p SystemCallArchitectures=native -p RestrictNamespaces=yes -p ProtectKernelTunables=yes -p ProtectControlGroups=yes -p ProtectKernelModules=yes -p LockPersonality=yes -p RestrictRealtime=yes -p ReadWritePaths="$root/work" \
  -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=100% -p TasksMax=256 \
  -p LimitNOFILE=4096 -p LimitFSIZE=67108864 -p RuntimeMaxSec=540 \
  -p TimeoutStopSec=10 -p KillMode=control-group -p RemainAfterExit=yes -p StandardOutput=null -p StandardError=null \
  /usr/bin/env -i PATH="$PATH" HOME="$root/work/npm-home" \
  /usr/bin/python3 -I "$root/fixtures/policy-admission.py" acquire "$auid" "$agid" "$root" "$repo" "$host_network_namespace" /usr/bin/python3 "$root/fixtures/acquire.py" \
  "$root/fixtures" "$root/work"
wait_unit silhouette-vitest-acquire 560
verify_unit_policy silhouette-vitest-acquire acquire
test -f "$root/work/acquisition-evidence/complete.json"
test "$(systemctl show silhouette-vitest-acquire --property=Result --value)" = success
agroup=$(systemctl show silhouette-vitest-acquire --property=ControlGroup --value)
if test -n "$agroup" && test -e "/sys/fs/cgroup$agroup/cgroup.events"; then
  grep -q '^populated 0$' "/sys/fs/cgroup$agroup/cgroup.events"
fi
systemctl stop silhouette-vitest-acquire
current_unit=
current_exit=
# Root freezes exact installed tree after all-member verification. No runtime mutation/install.
chown -R root:root "$root/work/acquisition/node_modules"
chmod -R a-w "$root/work/acquisition/node_modules"
mount --bind "$root/work/acquisition/node_modules" "$root/work/acquisition/node_modules"
mount -o remount,bind,ro "$root/work/acquisition/node_modules"
# Every runtime child/native library shares the UID filter and seccomp address-family restriction.
# Runtime PrivateNetwork creates a distinct network/abstract-UNIX namespace.
# Filesystem UNIX sockets outside denied roots remain a separate residual boundary.
iptables -I OUTPUT 1 -m owner --uid-owner "$ruid" -j REJECT
ip6tables -I OUTPUT 1 -m owner --uid-owner "$ruid" -j REJECT
iptables -C OUTPUT -m owner --uid-owner "$ruid" -j REJECT
ip6tables -C OUTPUT -m owner --uid-owner "$ruid" -j REJECT
for name in baseline-admission baseline-state candidate; do
  test "$((SECONDS-start))" -lt 800
  src="$root/sources/$name"
  data="$root/runtime/$name"
  mkdir "$data" "$data/tmp" "$data/home" "$data/db" "$data/data"
  chown -R "$ruid:$rgid" "$data"
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
  current_unit="silhouette-vitest-$name"
  current_exit=
  failure_captured=false
  unit_finished=
  unit_started=$(date +%s.%6N)
  systemd-run --quiet --no-block --unit "silhouette-vitest-$name" --slice=silhouette-vitest.slice --service-type=exec \
    -p User=silhouette-runtime -p Group=silhouette-runtime -p WorkingDirectory="$src" \
    -p NoNewPrivileges=yes -p ProtectSystem=strict -p ProtectHome=yes -p PrivateDevices=yes \
    -p TemporaryFileSystem=/run:rw,size=1M,nr_inodes=128,noswap,nodev,nosuid,noexec,mode=0700,uid=0,gid=0 \
    -p InaccessiblePaths="$repo $root/private $root/work/npm-cache $root/work/npm-home /tmp /var/tmp /dev/shm" \
    -p ProtectProc=invisible -p ProcSubset=pid -p PrivateIPC=yes -p RestrictSUIDSGID=yes -p CapabilityBoundingSet= \
  -p SystemCallArchitectures=native -p RestrictNamespaces=yes -p ProtectKernelTunables=yes -p ProtectControlGroups=yes -p ProtectKernelModules=yes -p LockPersonality=yes -p RestrictRealtime=yes \
    -p ReadWritePaths="$data $src/db $src/data" -p RestrictAddressFamilies=AF_UNIX -p PrivateNetwork=yes \
    -p MemoryMax=6G -p MemorySwapMax=0 -p CPUQuota=100% -p TasksMax=256 \
    -p LimitNOFILE=4096 -p LimitFSIZE=8388608 -p RuntimeMaxSec=85 \
    -p TimeoutStopSec=5 -p KillMode=control-group -p RemainAfterExit=yes -p StandardOutput=null -p StandardError=null \
    /usr/bin/env -i PATH="$PATH" HOME="$data/home" TMPDIR="$data/tmp" NODE_ENV=test \
    NODE_OPTIONS=--max-old-space-size=2048 SILHOUETTE_INFERENCE_MODE=cloud-only \
    SILHOUETTE_OWNER_SCOPES=128 SILHOUETTE_OWNER_ACTIVE=512 SILHOUETTE_OWNER_FAILURES=64 SILHOUETTE_OWNER_RESOURCES=256 \
    GOMAXPROCS=1 TOKIO_WORKER_THREADS=1 LANCE_CPU_THREADS=1 RAYON_NUM_THREADS=1 \
    /usr/bin/python3 -I "$root/fixtures/policy-admission.py" "$name" "$ruid" "$rgid" "$root" "$repo" "$host_network_namespace" "$node" "$src/node_modules/vitest/vitest.mjs" run "${args[@]}" --maxWorkers=1 --retry=0 --configLoader=runner --no-cache \
    --reporter=json --reporter=blob --outputFile.json="$data/report.json" --outputFile.blob="$data/blob.json"
  launch_code=$?
  if test "$launch_code" != 0; then exit "$launch_code"; fi
  wait_unit "silhouette-vitest-$name" 95
  code=$?
  unit_finished=$(date +%s.%6N)
  current_exit=$code
  set -e
  if test "$code" != 0; then
    failure_projection+=$(project_failure "$code"); failure_projection+=$'\n'; failure_captured=true
  fi
  verify_unit_policy "silhouette-vitest-$name" "$name"
  systemctl show "silhouette-vitest-$name" --property=Result,ExecMainCode,ExecMainStatus,ControlGroup,MemoryMax,MemoryPeak,TasksMax,CPUQuotaPerSecUSec,RestrictAddressFamilies > "$root/private/$name.service"
  # Read actual reporter; distinguish discriminating assertion-red from import/cleanup/native failures.
  python3 "$repo/tests/genuine-vitest-session/classify.py" "$name" "$data/report.json" "$data/blob.json" "$root/private/$name.service" "$code" > "$root/private/$name.summary.json"
  group=$(systemctl show "silhouette-vitest-$name" --property=ControlGroup --value)
  if test -n "$group" && test -e "/sys/fs/cgroup$group/cgroup.events"; then
    grep -q '^populated 0$' "/sys/fs/cgroup$group/cgroup.events"
  fi
  systemctl stop "silhouette-vitest-$name"
  current_unit=
  current_exit=
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
if test -n "$failure_projection"; then printf 'FINITE_FAILURE_PROJECTION %s\n' "$failure_projection"; failure_projection=; fi
printf '%s\n' "$summary"
