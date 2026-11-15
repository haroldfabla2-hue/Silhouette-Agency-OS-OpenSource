"""Fixed original output paths; source only, no module-time write."""
import json,pathlib,os
from evidence_policy import configure,cap,limited_open,emit_bytes
class EvidenceIncomplete(RuntimeError):pass
ROOT=pathlib.Path('/tmp/evidence')
FIXED={'envelope':('neo4j-boot-evidence.json',),'console':('neo4j-boot-real.log',)}
class CompositeWriters:
    def __init__(self,secret_guard):
        self.guard=secret_guard;self.count=0;self.closed=False
        ROOT.mkdir(exist_ok=True);configure(ROOT,'checks')
        path=ROOT/FIXED['console'][0]
        assert not path.exists() and not path.is_symlink()
        self.stream=limited_open(path,'xb')
    def console(self,chunk):
        if self.closed:raise EvidenceIncomplete('Writer closed')
        safe=self.guard.checked_chunk(chunk)
        self.count+=len(safe)
        if self.count>cap(ROOT/FIXED['console'][0]):raise EvidenceIncomplete('Complete console exceeds fixed writer cap')
        self.stream.write(safe)
    def finish_console(self):
        if self.closed:return
        tail=self.guard.checked_eof();self.count+=len(tail)
        if self.count>cap(ROOT/FIXED['console'][0]):raise EvidenceIncomplete('Complete console EOF exceeds writer cap')
        self.stream.write(tail);self.stream.close();self.closed=True
    def envelope(self,value):
        encoded=(json.dumps(value,separators=(',',':'))+'\n').encode()
        if len(encoded)>cap(ROOT/FIXED['envelope'][0]):raise EvidenceIncomplete('Complete envelope exceeds fixed writer cap')
        # Independent guard because streamguard overlap belongs to its stream.
        if any(needle in encoded for needle in self.guard.needles):raise EvidenceIncomplete('Known fixture credential in envelope')
        path=ROOT/FIXED['envelope'][0]
        assert not path.is_symlink()
        # This envelope is the sole owner; no selective omission on overflow.
        with limited_open(path,'xb') as out:out.write(encoded)
