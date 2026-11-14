#!/usr/bin/env python3
"""Losslessly consolidate dedicated browser phase metadata within existing cap."""
import base64,hashlib,json,pathlib,stat,sys
source=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2]);rows=[];total=0
assert source.name=='browser'and source.parent==target.parent.parent
assert source.is_dir()and not source.is_symlink()and target.is_file()and not target.is_symlink()
prior=json.loads(target.read_text());assert 'browser_preparation_phase'not in prior
for p in sorted(source.iterdir()):
 s=p.lstat();assert stat.S_ISREG(s.st_mode)and not p.is_symlink()
 data=p.read_bytes();total+=len(data);assert len(rows)<32 and total<=4*1024**2
 rows.append({'name':p.name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'base64':base64.b64encode(data).decode('ascii')})
assert rows
prior['browser_preparation_phase']={'encoding':'lossless-base64','files':rows,'bytes':total,'meaning':'Dedicated phase evidence preserved verbatim, not converted to native phase PASS'}
target.write_text(json.dumps(prior,indent=2)+'\n')
check=json.loads(target.read_text())['browser_preparation_phase']
for row in check['files']:
 p=source/row['name'];data=base64.b64decode(row['base64'],validate=True)
 assert data==p.read_bytes()and len(data)==row['bytes']and hashlib.sha256(data).hexdigest()==row['sha256']
# Delete originals only after verified destination round-trip. Nonregular or
# unexpected entries block rather than deleting recursively.
for row in check['files']:(source/row['name']).unlink()
source.rmdir()
print('BROWSER_METADATA_LOSSLESSLY_PACKED',len(rows),total)
