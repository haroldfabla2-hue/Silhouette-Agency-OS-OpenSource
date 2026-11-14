#!/usr/bin/env python3
"""SOURCE REVIEW ONLY. Reuse exact current signed Ubuntu staging contract.
Root action ONLY creates/removes this run's private immutable keycopy. No install,
no apt, no AppArmor/sysctl/profile/cgroup-root changes, no maintainer scripts.
"""
from pathlib import Path
import os,sys,json,subprocess,time,stat,hashlib,re,shutil,signal
here=Path(__file__).resolve().parent;e=Path(sys.argv[1]).resolve();run=sys.argv[2];assert run.isdigit();rtemp=Path(os.environ['RUNNER_TEMP']).resolve();scope=rtemp/('integrated-bwrap-stage-'+run);assert not scope.exists();scope.mkdir(mode=0o700);secure=Path('/run')/('silhouette-integrated-key-'+run);assert not secure.exists();start=time.monotonic();receipt={'rootKeyScope':str(secure),'aptInvoked':False,'OSInstall':False,'policyChanges':False,'status':'PREPARATION_PENDING'};created=False;child=None;forced=False
def interrupted(n,f):raise RuntimeError('SECURITY_WRAPPER_INTERRUPTED:'+str(n))
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
try:
 k=Path('/usr/share/keyrings/ubuntu-archive-keyring.gpg');fd=os.open(k,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  a=os.fstat(f.fileno());b=f.read(16385);z=os.fstat(f.fileno());assert stat.S_ISREG(a.st_mode)and a.st_uid==0 and a.st_size==len(b)==3607 and(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(z.st_dev,z.st_ino,z.st_size,z.st_mtime_ns,z.st_ctime_ns)
 assert hashlib.sha256(b).hexdigest()=='80a36b0a6de2f69f49d2df75ef473ccde121e9e190b9ea01d20a4f63778d5c31'
 snapshot=scope/'key.gpg';snapshot.write_bytes(b);snapshot.chmod(0o600)
 subprocess.run(['sudo','-n','mkdir','-m','0700',str(secure)],check=True,timeout=3);created=True
 subprocess.run(['sudo','-n','install','-o','root','-g','root','-m','0444',str(snapshot),str(secure/'ubuntu-archive-keyring.gpg')],check=True,timeout=3)
 subprocess.run(['sudo','-n','chmod','0555',str(secure)],check=True,timeout=3)
 clock={'deadline_monotonic':start+180,'observed_utc_epoch':time.time(),'observed_monotonic':time.monotonic()};(e/'job-clock.json').write_text(json.dumps(clock));(e/'host-budget.json').write_text(json.dumps({'elapsed_seconds':0,'retained_bytes':0}));env={'PATH':'/usr/bin:/bin','HOME':str(scope),'EVIDENCE':str(e),'GITHUB_ENV':str(scope/'staged-output')}
 child=subprocess.Popen(['/usr/bin/python3',str(here/'security-setup/acquire.py'),str(scope),str(secure/'ubuntu-archive-keyring.gpg')],env=env)
 assert child.wait(timeout=140)==0,'SIGNED_STAGING_CHILD_FAILED'
 result=json.loads((e/'security-chain/result.json').read_text());binary=scope/'bin/bwrap';assert result['status']=='VERIFIED_STAGED_NOT_RUNTIME_PASS'and result['apt_invoked']is False and result['binary']['path']==str(binary)and result['binary']['sha256']=='e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71'and hashlib.sha256(binary.read_bytes()).hexdigest()==result['binary']['sha256']
 receipt.update({'status':'AUTHENTICATED_STAGED_NOT_RUNTIME_PASS','binary':str(binary),'binarySha256':result['binary']['sha256'],'freshness':result['freshness']})
except BaseException as ex:receipt.update({'status':'PREPARATION_FAIL','type':type(ex).__name__,'message':str(ex)});raise
finally:
 if child is not None and child.poll()is None:
  forced=True;child.terminate()
  try:child.wait(timeout=5)
  except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
 receipt['forced']=forced
 cleanupErrors=[]
 if created:
  try:
   subprocess.run(['sudo','-n','chmod','0700',str(secure)],check=True,timeout=3)
   if (secure/'ubuntu-archive-keyring.gpg').exists():subprocess.run(['sudo','-n','rm','--',str(secure/'ubuntu-archive-keyring.gpg')],check=True,timeout=3)
   subprocess.run(['sudo','-n','rmdir','--',str(secure)],check=True,timeout=3)
  except BaseException as ex:cleanupErrors.append(type(ex).__name__+':'+str(ex))
 receipt['cleanupErrors']=cleanupErrors
 if cleanupErrors or forced:receipt['status']='PREPARATION_FAIL'
 receipt['rootKeyScopeAbsent']=not secure.exists();receipt['seconds']=time.monotonic()-start;(e/'security-preparation.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
