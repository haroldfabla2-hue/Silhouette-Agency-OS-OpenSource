#!/usr/bin/env python3
import hashlib,json,pathlib,sys
source=pathlib.Path(sys.argv[1]);work=pathlib.Path(sys.argv[2]);manifest=pathlib.Path(sys.argv[3]);expected=sys.argv[4]
assert hashlib.sha256(manifest.read_bytes()).hexdigest()==expected
rows=json.loads(manifest.read_text());work.mkdir()
for row in rows:
 rel=pathlib.PurePosixPath(row['path']);assert not rel.is_absolute()and'..'not in rel.parts
 p=source/rel;assert p.is_file()and not p.is_symlink();b=p.read_bytes();assert hashlib.sha256(b).hexdigest()==row['sha256']
 out=work/rel;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(b);out.chmod(p.stat().st_mode&0o777)
(work/'node_modules').mkdir()
print('INTEGRAL_REVIEWED_SOURCE_COPIED',len(rows))
