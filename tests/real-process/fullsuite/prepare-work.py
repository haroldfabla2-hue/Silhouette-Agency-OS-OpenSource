#!/usr/bin/env python3
"""Copy reviewed code/assets only; never inspect omitted runtime payload bytes."""
import hashlib,json,pathlib,shutil,stat,subprocess,sys
source=pathlib.Path.cwd();work=pathlib.Path(sys.argv[1]);ev=pathlib.Path(sys.argv[2]);work.mkdir();ev.mkdir(exist_ok=True)
files=subprocess.check_output(['git','ls-files','-z']).decode().split('\0');copied=[];omitted=[]
for rel in filter(None,files):
 p=pathlib.PurePosixPath(rel)
 if p.is_absolute() or '..' in p.parts:raise RuntimeError('Unsafe tracked path')
 # Runtime data never supplied to tests. Includes tracked agent state/config data.
 reason=None
 if rel in {'.github/workflows/initial-owner-static-branch.yml','tests/real-process/fullsuite/reviewed-inputs.sha256'}:reason='operational workflow or external reviewed manifest excluded from test work'
 if p.parts[0] in {'data','.silhouette'}:reason='runtime directory'
 if p.suffix.lower() in {'.jsonl','.log'}:reason='runtime evidence or dataset'
 if rel.startswith('silhouette/data/'):reason='runtime training directory'
 if p.suffix.lower() in {'.db','.sqlite','.sqlite3','.pem','.key','.p12','.pfx'}:reason='runtime database or secret container'
 if p.name.startswith('.env') and p.name!='.env.example':reason='environment secret file'
 if reason:omitted.append({'path':rel,'reason':reason});continue
 src=source/rel;m=src.lstat()
 if not stat.S_ISREG(m.st_mode):raise RuntimeError('Nonregular tracked source: '+rel)
 dst=work/rel;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
 copied.append({'path':rel,'bytes':m.st_size,'sha256':hashlib.sha256(dst.read_bytes()).hexdigest()})
(ev/'work-inputs.json').write_text(json.dumps({'copied':copied,'omitted':omitted,'scope':'source-only clean disposable work, not historical host environment equivalence'},indent=2))
