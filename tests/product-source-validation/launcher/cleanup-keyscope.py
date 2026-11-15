#!/usr/bin/env python3
"""SOURCE REVIEW. Remove ONLY exact run-owned public archive-key scope as root.
No recursive deletion, permission broadening, secrets, sysctls or outside paths.
"""
from pathlib import Path
import os,re,stat,sys,json
assert os.geteuid()==0,'ROOT_REQUIRED_FOR_PRIVATE_SCOPE_INSPECTION'
run=sys.argv[1];assert re.fullmatch('[0-9]+',run)
p=Path('/run')/('silhouette-integrated-key-'+run);key=p/'ubuntu-archive-keyring.gpg';r={'path':str(p),'presentBefore':False,'absentAfter':False}
try:
 try:s=p.lstat()
 except FileNotFoundError:r['absentAfter']=True
 else:
  r['presentBefore']=True
  assert s.st_uid==s.st_gid==0 and stat.S_ISDIR(s.st_mode)and s.st_mode&0o777 in {0o700,0o555},'UNEXPECTED_KEY_SCOPE_IDENTITY_OR_MODE'
  names={x.name for x in p.iterdir()};assert names<= {key.name},'UNEXPECTED_KEY_SCOPE_CONTENTS'
  if names:
   k=key.lstat();assert k.st_uid==k.st_gid==0 and stat.S_ISREG(k.st_mode)and k.st_mode&0o777==0o444 and k.st_nlink==1,'UNEXPECTED_KEY_IDENTITY_OR_MODE'
  # Root alone can inspect0555/0700. Change to0700 only AFTER full validation.
  os.chmod(p,0o700)
  if names:key.unlink()
  p.rmdir()
  try:p.lstat()
  except FileNotFoundError:r['absentAfter']=True
  else:raise RuntimeError('KEY_SCOPE_STILL_PRESENT')
 print(json.dumps(r))
except BaseException as e:r.update({'error':type(e).__name__+':'+str(e)});print(json.dumps(r));raise
