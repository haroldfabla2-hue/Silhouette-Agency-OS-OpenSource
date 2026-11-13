#!/usr/bin/env bash
# Preparation only. No source/fixture changes from within the isolated suite.
set -euo pipefail
work=$(realpath "${1:?}")
evidence=$(realpath "${2:?}")
reviewed=$(realpath "${3:?}")
hostnet=$(readlink /proc/self/ns/net)
# No home, repository checkout, .git credentials, runtime databases or host /tmp exposed.
env -i PATH="$PATH" bwrap --die-with-parent --unshare-pid --unshare-user --uid 0 --gid 0 --unshare-net --cap-add CAP_NET_ADMIN \
 --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
 --ro-bind /etc /etc --ro-bind /opt /opt --proc /proc --dev /dev --tmpfs /tmp \
 --bind "$work" /tmp/work --bind "$evidence" /tmp/evidence --ro-bind "$reviewed" /tmp/reviewed --chdir /tmp/work \
 /bin/bash -c 'set -euo pipefail; ip link set lo up; exec env -i PATH="$PATH" HOME=/tmp python3 /tmp/work/tests/real-process/fullsuite/run-session.py "$1"' bash "$hostnet"
