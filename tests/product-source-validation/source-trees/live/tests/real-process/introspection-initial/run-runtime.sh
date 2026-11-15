#!/usr/bin/env bash
# Proposed OPTIONAL runtime beat after static PASS and wrapper review/explicit GO.
# Uses existing CI sandbox dependency only; never installs/provisions anything.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
static=$(realpath "${1:?existing static evidence directory}")
out=$(realpath -m "${2:?new runtime evidence directory}")
test "$(cat "$static/static-pass.txt")" = STATIC_PASS
command -v bwrap
command -v ip
hostnet=$(readlink /proc/self/ns/net)
# No secrets/REDIS_URL passed. Network namespace mechanics must actually work;
# unsupported bwrap/AppArmor/capability => runtime BLOCKED/FAIL, not static failure.
# Evidence directory is writable; source/deps/static proof are read-only.
mkdir "$out"
bwrap --unshare-user --uid 0 --gid 0 --unshare-net --cap-add CAP_NET_ADMIN \
  --ro-bind / / --proc /proc --dev-bind /dev /dev --tmpfs /tmp \
  --ro-bind "$root" /tmp/project --ro-bind "$static" /tmp/static-proof \
  --bind "$out" /tmp/evidence \
  /bin/bash -c 'set -euo pipefail; ip link set lo up; exec env -i PATH="$PATH" HOME=/tmp python3 /tmp/project/tests/real-process/introspection-initial/run-two.py --root /tmp/project --evidence /tmp/evidence/cases --static-evidence /tmp/static-proof --host-net-namespace "$1"' bash "$hostnet"
