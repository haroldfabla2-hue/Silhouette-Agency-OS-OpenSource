"""NEW PRIVILEGE PROPOSAL, NOT AUTHORIZED/RUN.
Only exact reviewed source may be supplied to root via quoted stdin. Never run
an arbitrary mutable repo path as root. No config/source/input evaluation.
Arguments uid gid runid supervisorpid execargvJSON. Root moves ITSELF, then drops
privilege irrevocably before exec. This avoids numeric-target PID reuse/LCA gap.
"""
import json,os,pathlib,stat,sys
uid,gid,run,supervisor=map(int,sys.argv[1:5]);argv=json.loads(sys.argv[5])
assert os.geteuid()==0 and uid>0 and gid>=0 and run>0 and supervisor>0
assert os.environ.get('SUDO_UID')==str(uid) and os.environ.get('SUDO_GID')==str(gid)
# Exact bounded path only, no caller-chosen root/controller/other-run destination.
parent=pathlib.Path('/sys/fs/cgroup')/('silhouette-owner-once-'+str(run))
scope=parent/('owner-trial-'+str(supervisor))
for directory in [parent,scope]:
 st=directory.lstat();assert stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode) and st.st_uid==uid
assert (scope/'memory.max').read_text().strip()==str(8*1024**3)
assert (scope/'memory.swap.max').read_text().strip()=='0'
assert (scope/'pids.max').read_text().strip()=='96'
assert (scope/'cpu.max').read_text().strip()=='200000 100000'
# Move current root helper itself, not a separately addressed target PID.
(scope/'cgroup.procs').write_text(str(os.getpid()))
assert str(scope.relative_to('/sys/fs/cgroup')) in pathlib.Path('/proc/self/cgroup').read_text()
# Argument vector is not interpreted while privileged. Clear groups before uid.
assert isinstance(argv,list) and argv and len(argv)<256 and all(isinstance(x,str) and '\x00' not in x and len(x)<8192 for x in argv)
os.setgroups([]);os.setresgid(gid,gid,gid);os.setresuid(uid,uid,uid)
assert os.geteuid()==uid and os.getuid()==uid and os.getegid()==gid
# No user-controlled executable is invoked until all root ids are irrevocably gone.
os.execve(argv[0],argv,{'PATH':'/usr/bin:/bin','SILHOUETTE_INFERENCE_MODE':'cloud-only','SILHOUETTE_SNAPSHOT_DIAGNOSTIC':'metadata-only'})
