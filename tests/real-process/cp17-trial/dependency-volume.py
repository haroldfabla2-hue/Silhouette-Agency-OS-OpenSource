#!/usr/bin/env python3
"""REVIEW ONLY: fixed4GiB proposed budget, not a measured sufficient size.
Only this exact reviewed script may be passed to sudo via stdin.
"""
import json,os,pathlib,stat,subprocess,sys,signal
signal.alarm(45)
mode,run,uid,gid=sys.argv[1:];run=int(run);uid=int(uid);gid=int(gid)
assert mode in {'create','cleanup'} and run>0 and uid>0 and gid>=0 and os.geteuid()==0
assert os.environ.get('SUDO_UID')==str(uid) and os.environ.get('SUDO_GID')==str(gid)
root=pathlib.Path('/var/lib')/('silhouette-cp17-deps-'+str(run));image=root/'deps.ext4';mount=root/'store';state=root/'state.json'
def cmd(args):return subprocess.check_output(args,text=True,timeout=15,stderr=subprocess.STDOUT).strip()
if mode=='create':
 root.mkdir(mode=0o700);os.chown(root,0,0);mount.mkdir(mode=0o755)
 loop=None
 try:
  fd=os.open(image,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  try:os.posix_fallocate(fd,0,4*1024**3)
  finally:os.close(fd)
  loop=cmd(['/usr/sbin/losetup','--find','--show','--nooverlap',str(image)])
  assert loop.startswith('/dev/loop') and loop[len('/dev/loop'):].isdigit()
  state.write_text(json.dumps({'image':str(image),'loop':loop,'bytes':4*1024**3,'mounted':False,'budget':'DESIGN_NOT_MEASURED'}));state.chmod(0o600)
  cmd(['/usr/sbin/mkfs.ext4','-q','-F','-m','0',loop]);cmd(['/usr/bin/mount','-t','ext4','-o','nodev,nosuid',loop,str(mount)])
  os.chown(mount,uid,gid);os.chmod(mount,0o700)
  s=json.loads(state.read_text());s['mounted']=True;state.write_text(json.dumps(s));os.chmod(root,0o711)
  print(json.dumps(s))
 except BaseException:
  # Preserve exact resources on cleanup failure, never broad or lazy-unmount.
  if os.path.ismount(mount):cmd(['/usr/bin/umount',str(mount)])
  if loop:cmd(['/usr/sbin/losetup','--detach',loop])
  if state.exists():state.unlink()
  if image.exists():image.unlink()
  mount.rmdir();root.rmdir();raise
else:
 if not root.exists():print('ABSENT');raise SystemExit(0)
 for p in [root,image,state,mount]:
  st=p.lstat();assert not stat.S_ISLNK(st.st_mode) and st.st_uid in {0,uid}
 s=json.loads(state.read_text());loop=s['loop'];assert s['image']==str(image) and s['bytes']==4*1024**3
 assert loop.startswith('/dev/loop') and loop[len('/dev/loop'):].isdigit()
 # Root state is authoritative, actual loop backing independently checked.
 backing=json.loads(cmd(['/usr/sbin/losetup','--json','--list','--output','NAME,BACK-FILE',loop]))['loopdevices'];assert len(backing)==1 and backing[0]['back-file']==str(image)
 if os.path.ismount(mount):cmd(['/usr/bin/umount',str(mount)])
 assert not os.path.ismount(mount)
 cmd(['/usr/sbin/losetup','--detach',loop]);assert not cmd(['/usr/sbin/losetup','-j',str(image)])
 state.unlink();image.unlink();mount.rmdir();root.rmdir();assert not root.exists();print('CLEANUP_VERIFIED')
