#!/usr/bin/env bash
# PROPOSAL ONLY. New root cgroup delegation is NOT authorized by old apt/sysctl.
# Exact privileged script body requires main's owner-evidence decision BEFORE run.
# Deliberately refuses missing root controllers; never enables root controllers.
set -euo pipefail
uid=$(id -u); gid=$(id -g)
[[ "$uid" =~ ^[1-9][0-9]*$ && "$gid" =~ ^[0-9]+$ ]]
[[ "${GITHUB_RUN_ID:?}" =~ ^[0-9]+$ ]]
sudo -n /usr/bin/python3 - "$uid" "$gid" "$GITHUB_RUN_ID" <<'ROOT'
import os,pathlib,sys
uid,gid,run=map(int,sys.argv[1:]);assert uid>0 and gid>=0 and run>0
root=pathlib.Path('/sys/fs/cgroup')
assert (root/'cgroup.controllers').is_file(),'cgroup v2 required'
assert {'memory','cpu','pids'}<=set((root/'cgroup.subtree_control').read_text().split()),'root controls not preenabled; STOP/no root modification'
scope=root/('silhouette-owner-once-'+str(run))
assert not scope.exists(),'no reusing an existing scope'
scope.mkdir(mode=0o700)
try:
 # Delegation changes ONLY this newly-created empty subtree. No process moved
 # by root helper; nonroot hostlauncher creates/attaches gated child later.
 assert not (scope/'cgroup.procs').read_text().strip()
 (scope/'cgroup.subtree_control').write_text('+memory +cpu +pids')
 for item in [scope,scope/'cgroup.procs',scope/'cgroup.threads',scope/'cgroup.subtree_control']:
  os.chown(item,uid,gid)
 print(scope)
except BaseException:
 if not (scope/'cgroup.procs').read_text().strip():
  (scope/'cgroup.subtree_control').write_text('-memory -cpu -pids')
  scope.rmdir()
 raise
ROOT
