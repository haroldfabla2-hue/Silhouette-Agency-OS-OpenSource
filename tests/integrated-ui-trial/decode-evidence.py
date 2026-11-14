#!/usr/bin/env python3
"""Local project test log decoder. Reject incomplete/mismatched frames."""
from pathlib import Path
import sys,re,json,base64,hashlib,io,tarfile
text=Path(sys.argv[1]).read_text();beg=re.findall(r'SILHOUETTE_PUBLIC_TEST_FRAME_BEGIN (\{[^\n]+\})',text);assert len(beg)==1,'ONE_COMPLETE_FRAME_REQUIRED';j=json.loads(beg[0]);chunks=re.findall(r'SILHOUETTE_PUBLIC_TEST_CHUNK (\d+) ([A-Za-z0-9+/=]+)',text);assert [int(i)for i,_ in chunks]==list(range(j['chunks'])),'MISSING_DUPLICATE_OR_TRUNCATED_CHUNK';raw=base64.b64decode(''.join(v for _,v in chunks),validate=True);assert len(raw)==j['bytes']<=8*1024**2 and hashlib.sha256(raw).hexdigest()==j['sha256'];assert text.count('SILHOUETTE_PUBLIC_TEST_FRAME_END '+j['sha256'])==1,'END_FRAME_REQUIRED';out=Path(sys.argv[2]);assert not out.exists();out.mkdir(mode=0o700)
with tarfile.open(fileobj=io.BytesIO(raw))as t:
 members=t.getmembers();assert sum(m.size for m in members)<=64*1024**2
 for m in members:
  p=Path(m.name);assert m.isfile()and not p.is_absolute()and '..'not in p.parts
 t.extractall(out,filter='data')
receipt=json.loads((out/'capture.json').read_text())
for r in receipt['files']:
 b=(out/r['path']).read_bytes();assert len(b)==r['bytes']and hashlib.sha256(b).hexdigest()==r['sha256']
print(json.dumps({'files':len(receipt['files']),'quarantined':receipt['quarantine'],'fullFrameVerified':True,'productPass':False}))
