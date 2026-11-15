#!/usr/bin/env bash
# Proposal only. Fresh public GitHub Ubuntu24.04 VM, exact distro data, no dpkg hooks.
set -euo pipefail
mode=$1; head=$2; run=$3
[[ "$head" =~ ^[0-9a-f]{40}$ && "$run" =~ ^[0-9]+$ ]]
base=/run/silhouette-bwrap-setup
profile=/etc/apparmor.d/bwrap-userns-restrict
marker=/run/silhouette-bwrap-setup-owner
if test "$mode" = cleanup; then
 if test ! -e "$marker"; then test ! -e "$base";exit 0;fi
 test "$(stat -c %u "$marker")" = 0
 test "$(cat "$marker")" = "$head:$run"
 if test -e "$base/profile-intent"; then
  test "$(sha256sum "$profile" | cut -d' ' -f1)" = 11d39094f044f0cda0febb3ad517b830301da6b2ce929664af09ee9e4dd264f9
  /usr/sbin/apparmor_parser -K -R "$profile"
  ! grep -Eq '^(bwrap|unpriv_bwrap)( |//)' /sys/kernel/security/apparmor/profiles
  rm "$profile"
 fi
 if test -e "$base/binary-intent"; then
  test "$(sha256sum /usr/bin/bwrap | cut -d' ' -f1)" = e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71
  rm /usr/bin/bwrap
 fi
 test "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = 1
 if mountpoint -q "$base";then umount "$base";fi
 if test -d "$base";then rmdir "$base";fi
 rm "$marker"
 exit 0
fi
test "$mode" = setup
# These guards precede any host mutation; absence/mismatch stops, no fallback.
test "${SILHOUETTE_FRESH_PUBLIC_GITHUB_VM:-}" = yes
test "$(. /etc/os-release; echo "$ID:$VERSION_ID")" = ubuntu:24.04
test "$(dpkg --print-architecture)" = amd64
test "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = 1
test -x /usr/sbin/getcap
test -x /usr/sbin/apparmor_parser
test -r /sys/kernel/security/apparmor/profiles
python3 -I - <<'PYHOSTPOLICY'
from pathlib import Path
import stat
# Existing distro parser and its basic policy inputs are host prerequisites,
# not supplied custody artifacts. Do not mistake host version/hash for authority.
for name in('/usr/sbin/apparmor_parser','/etc/apparmor.d/abi/4.0','/etc/apparmor.d/tunables/global'):
 p=Path(name);s=p.stat()
 assert stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_mode&0o022==0
 assert p.is_file()
PYHOSTPOLICY
! grep -Eq '^(bwrap|unpriv_bwrap)( |//)' /sys/kernel/security/apparmor/profiles
for p in "$marker" "$base" "$profile" /etc/apparmor.d/local/bwrap-userns-restrict /etc/apparmor.d/local/unpriv_bwrap; do test ! -e "$p" && test ! -L "$p"; done
test ! -L /usr/bin/bwrap
if test -e /usr/bin/bwrap; then
 test ! -L /usr/bin/bwrap
 test "$(stat -c %u:%a /usr/bin/bwrap)" = 0:755
 test "$(sha256sum /usr/bin/bwrap | cut -d' ' -f1)" = e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71
fi
# Exact existing distro runtime dependencies, no upgrade/install transaction.
dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libc6)" ge 2.38
dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libcap2)" ge 1:2.10
dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libselinux1)" ge 3.1~
(umask 077;set -o noclobber;printf '%s:%s\n' "$head" "$run" > "$marker")
mkdir -m 700 "$base"
mount -t tmpfs -o size=2M,nr_inodes=128,noswap,nosuid,nodev,mode=0700 tmpfs "$base"

cd "$base"
# Only observed official exactversion URLs. No redirects, retries, floating packages or hooks.
python3 -I - <<'PYDOWNLOAD'
from pathlib import Path
import urllib.request,hashlib
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**k):return None
opener=urllib.request.build_opener(NoRedirect)
for name,size,want,url in [
 ('bubblewrap_0.9.0-1ubuntu0.3_amd64.deb',50436,'2461f1beee9cb04c8942739fe1a2b37e7b7c2a3d518f0779dc75f9245baa3094','https://archive.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_0.9.0-1ubuntu0.3_amd64.deb'),
 ('apparmor-profiles_4.0.1really4.0.1-0ubuntu0.24.04.9_all.deb',39592,'90b02aa006eea7702cd4e851343e469e41365dda42145a3cb035de1d6c773b8c','https://archive.ubuntu.com/ubuntu/pool/main/a/apparmor/apparmor-profiles_4.0.1really4.0.1-0ubuntu0.24.04.9_all.deb')]:
 with opener.open(url,timeout=15)as r:
  assert r.status==200 and r.geturl()==url
  b=r.read(size+1);assert len(b)==size and hashlib.sha256(b).hexdigest()==want
 with Path(name).open('xb')as f:f.write(b)
PYDOWNLOAD
python3 -I - <<'PY'
from pathlib import Path
import subprocess,tarfile,hashlib,stat,os
base=Path('/run/silhouette-bwrap-setup')
for deb,member,dest,want,limit,mode,intent in [
 ('bubblewrap_0.9.0-1ubuntu0.3_amd64.deb','./usr/bin/bwrap',Path('/usr/bin/bwrap'),'e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71',200000,0o755,'binary-intent'),
 ('apparmor-profiles_4.0.1really4.0.1-0ubuntu0.24.04.9_all.deb','./usr/share/apparmor/extra-profiles/bwrap-userns-restrict',Path('/etc/apparmor.d/bwrap-userns-restrict'),'11d39094f044f0cda0febb3ad517b830301da6b2ce929664af09ee9e4dd264f9',16384,0o644,'profile-intent')]:
 p=subprocess.Popen(['/usr/bin/dpkg-deb','--fsys-tarfile',str(base/deb)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 found=[]
 with tarfile.open(fileobj=p.stdout,mode='r|')as t:
  for row in t:
   if row.name==member:
    assert row.isfile()and row.size<=limit
    b=t.extractfile(row).read(limit+1);assert len(b)==row.size and hashlib.sha256(b).hexdigest()==want;found.append(b)
 assert p.wait(timeout=2)==0 and len(found)==1
 if dest.exists():assert intent=='binary-intent'and dest.read_bytes()==found[0];continue
 # Root-only intent before O_EXCL creation; cleanup handles exact-owned bytes only.
 (base/intent).write_text('OWNED_CREATION_INTENT\n')
 fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:assert os.write(fd,found[0])==len(found[0])
 finally:os.close(fd)
PY
test -z "$(/usr/sbin/getcap /usr/bin/bwrap)"
/usr/sbin/apparmor_parser -K -a "$profile"
grep -Fx 'bwrap (enforce)' /sys/kernel/security/apparmor/profiles
grep -Fx 'unpriv_bwrap (enforce)' /sys/kernel/security/apparmor/profiles
test "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = 1
printf 'DISTRO_BWRAP_PROFILE_READY_NOT_PRODUCT_ACCEPTANCE\n'
