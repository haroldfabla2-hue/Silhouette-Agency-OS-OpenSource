#!/usr/bin/env bash
# Idempotent cleanup of this job's explicit root only. Never prints private logs.
set -euo pipefail
expected=${1:-}
runid=${2:-}
[[ "$expected" =~ ^[0-9a-f]{40}$ ]] && [[ "$runid" =~ ^[0-9]+$ ]]
root=/mnt/silhouette-genuine-vitest
marker=/run/silhouette-genuine-vitest-owner
if ! test -e "$marker"; then
  test ! -e "$root" || { echo CLEANUP_OWNERSHIP_UNVERIFIED; exit 1; }
  echo NO_OWNED_RESOURCES
  exit 0
fi
test "$(stat -c %u "$marker")" = 0
test "$(cat "$marker")" = "$expected:$runid"
failed=0
for unit in silhouette-vitest-transport silhouette-vitest-acquire silhouette-vitest-baseline-admission silhouette-vitest-baseline-state silhouette-vitest-candidate; do
  if systemctl show "$unit" --property=LoadState --value | grep -qv '^not-found$'; then
    systemctl stop "$unit" || failed=1
    main=$(systemctl show "$unit" --property=MainPID --value)
    test "${main:-0}" = 0 || failed=1
    group=$(systemctl show "$unit" --property=ControlGroup --value)
    if test -n "$group" && test -e "/sys/fs/cgroup$group/cgroup.events"; then
      grep -q '^populated 0$' "/sys/fs/cgroup$group/cgroup.events" || failed=1
    fi
  fi
done
if id silhouette-runtime >/dev/null 2>&1; then
  uid=$(id -u silhouette-runtime)
  if pgrep -u "$uid" >/dev/null; then failed=1; fi
  # Removal is safe only once all processes are gone.
  if test "$failed" = 0; then
    if iptables -C OUTPUT -m owner --uid-owner "$uid" -j REJECT 2>/dev/null; then iptables -D OUTPUT -m owner --uid-owner "$uid" -j REJECT || failed=1; fi
    if ip6tables -C OUTPUT -m owner --uid-owner "$uid" -j REJECT 2>/dev/null; then ip6tables -D OUTPUT -m owner --uid-owner "$uid" -j REJECT || failed=1; fi
  fi
fi
# A forced kill, timeout or cleanup failure invalidates acceptance even if assertions passed.
if test "$failed" != 0; then echo CLEANUP_FAILED_NO_ACCEPTANCE; exit 1; fi
if mountpoint -q "$root"; then
  # Reverse-depth unmount only under this owned root. No lazy unmount or masking busy mounts.
  while IFS= read -r target; do umount "$target" || failed=1; done < <(findmnt -R -n -o TARGET "$root" | sort -r)
fi
if test "$failed" != 0; then echo UNMOUNT_FAILED_NO_ACCEPTANCE; exit 1; fi
if test -d "$root"; then rmdir "$root"; fi
for user in silhouette-acquire silhouette-runtime; do
  if id "$user" >/dev/null 2>&1; then
    uid=$(id -u "$user")
    ! pgrep -u "$uid" >/dev/null || { echo RESIDUAL_UID_NO_ACCEPTANCE; exit 1; }
    userdel "$user"
    if getent group "$user"; then groupdel "$user"; fi
  fi
done
rm "$marker"
echo CLEANUP_CONFIRMED_NO_PRODUCT_ACCEPTANCE
