"""Bounded diagnostics from public source preparation only, no environment."""
from pathlib import Path
import json
work=Path('/tmp/continuum-real-typecheck');out=Path('/tmp/continuum-real-typecheck-selected');out.mkdir(mode=0o700,exist_ok=False)
summary={'kind':'BOUNDED_REAL_TYPECHECK_EVIDENCE','logs':{}}
receipt=work/'receipt.json'
if receipt.is_file() and receipt.stat().st_size<=16384:
    (out/'receipt.json').write_bytes(receipt.read_bytes())
else:summary['receiptUnavailable']=True
for name in ('install.log','types.log'):
    p=work/name
    if not p.is_file():continue
    with p.open('rb') as stream:raw=stream.read(1048576)
    (out/name).write_bytes(raw)
    summary['logs'][name]={'bytesCopied':len(raw),'totalBytes':p.stat().st_size,'partial':p.stat().st_size>len(raw)}
(out/'selection.json').write_text(json.dumps(summary,sort_keys=True)+'\n')
