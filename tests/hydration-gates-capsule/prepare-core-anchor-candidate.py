"""Preparation only: selected host/source hashes, no unit/payload evaluation.
Candidate metadata is NOT an execution anchor. Freeze it only after separate
source/runtime review. Never import or invoke the containment harness here.
"""
import pathlib,hashlib,json,os,stat,subprocess
D=pathlib.Path(__file__).resolve().parent
HOST=('/usr/bin/bwrap','/usr/bin/systemd-run','/usr/bin/systemctl','/usr/bin/env','/usr/bin/python3')
SOURCES=('containment-harness.py','containment-control-contract.py','containment-bootstrap-contract.py')
CONTROLS=('extract-review-artifact.py','preparation-budget.py','PREPARATION-CONTRACT.json','execute-reviewed-core.py')
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def main():
 host={}
 for name in HOST:
  s=os.stat(name);assert stat.S_ISREG(s.st_mode) and not s.st_mode&(stat.S_ISUID|stat.S_ISGID),'HOST_PRIVILEGE'
  host[name]={'sha256':sha(name),'mode':format(stat.S_IMODE(s.st_mode),'o'),'owner':s.st_uid}
 commit=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],text=True,env={'PATH':'/usr/bin:/bin'},timeout=3).strip()
 result={'schema':1,'scope':'Hash candidate only. No witness/service/namespace. Not an execution anchor. Must be reviewed independently before a separate pinned execution cut.','sourceCheckout':commit,'sources':{n:sha(D/n) for n in SOURCES},'controls':{n:sha(D/n) for n in CONTROLS},'hostBinaries':host,'selection':'Existing CI-installed system binaries, exact bytes of this one preparation runner. Future runner mismatch must stop, never repin automatically.'}
 p=pathlib.Path('/tmp/hg-core-anchor-candidate.json');fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644)
 with os.fdopen(fd,'w') as f:json.dump(result,f,sort_keys=True,indent=2);f.write('\n')
 print('CORE_ANCHOR_CANDIDATE_WRITTEN_NO_EXECUTION')
if __name__=='__main__':main()
