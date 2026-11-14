"""Source-only fixed evidence-path policy. No filesystem writes on import.
Every producer configures its own fixed root and phase. No implicit patch of IO.
Unknown paths, oversized writes and changed/symlink files fail before disclosure.
"""
import json,os,pathlib,stat
_POLICY=None
_ROOT=None
_PREFIX=None
class EvidenceLimit(RuntimeError):pass

def configure(root,prefix=''):
    global _POLICY,_ROOT,_PREFIX
    root=pathlib.Path(root)
    assert root.is_absolute() and not root.is_symlink()
    assert prefix in ['','install','native','checks']
    data=json.loads((pathlib.Path(__file__).parent/'writer-union.json').read_text())
    limits=data['proposed_per_writer_max_bytes']
    assert len(limits)==len(data['files'])==len(set(data['files']))
    assert set(limits)==set(data['files']) and len(limits)<=128
    assert data['cap']==128 and data['hardRawBytes']==20*1024**2 and data['hardGzipBytes']==4*1024**2
    assert sum(limits.values())<=data['hardRawBytes']
    assert all(type(n)is int and n>0 for n in limits.values())
    _POLICY=limits;_ROOT=root;_PREFIX=prefix

def cap(path):
    assert _POLICY is not None,'Evidence owner not configured'
    path=pathlib.Path(path)
    try:relative=path.relative_to(_ROOT)
    except ValueError:raise EvidenceLimit('Evidence path outside fixed owner root')from None
    assert relative.parts and '..'not in relative.parts
    key=('/'.join([_PREFIX,relative.as_posix()])if _PREFIX else relative.as_posix())
    if key not in _POLICY:raise EvidenceLimit('Unreviewed evidence path')
    parent=path.parent
    while parent!=_ROOT:
        if parent.is_symlink():raise EvidenceLimit('Evidence symlink parent')
        parent=parent.parent
    if path.is_symlink():raise EvidenceLimit('Evidence symlink file')
    return _POLICY[key]

class BoundedStream:
    def __init__(self,path,mode='wb'):
        assert mode in ['wb','xb','ab'];self.path=pathlib.Path(path);self.maximum=cap(self.path)
        flags=os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW
        if mode=='xb':flags|=os.O_EXCL
        elif mode=='wb':flags|=os.O_TRUNC
        else:flags|=os.O_APPEND
        if mode=='ab' and self.path.exists() and self.path.stat().st_size>self.maximum:raise EvidenceLimit('Existing append exceeds cap')
        self.stream=os.fdopen(os.open(self.path,flags,0o600),'wb')
        self.size=os.fstat(self.stream.fileno()).st_size
        self.failed=False
    def write(self,data):
        if not isinstance(data,(bytes,bytearray)):raise TypeError('Evidence bytes required')
        if self.failed or self.size+len(data)>self.maximum:
            self.failed=True;raise EvidenceLimit('Evidence writer cap exceeded, complete evidence unavailable')
        self.stream.write(data);self.size+=len(data);return len(data)
    def tell(self):return self.size
    def flush(self):self.stream.flush()
    def close(self):self.stream.close()
    def __enter__(self):return self
    def __exit__(self,*args):self.close()

def limited_open(path,mode='wb'):
    return BoundedStream(path,mode)

def emit_bytes(path,data):
    maximum=cap(path)
    if len(data)>maximum:raise EvidenceLimit('Encoded evidence exceeds cap before open')
    with limited_open(path,'wb')as out:out.write(data)
    return len(data)

def emit_text(path,text,encoding='utf-8'):
    return emit_bytes(path,text.encode(encoding))

def append_text(path,text):
    data=text.encode('utf-8');maximum=cap(path)
    size=pathlib.Path(path).stat().st_size if pathlib.Path(path).exists()else 0
    if size+len(data)>maximum:raise EvidenceLimit('Append evidence exceeds cap before open')
    with limited_open(path,'ab')as out:out.write(data)

def copy_bounded(source,target):
    maximum=cap(target);source=pathlib.Path(source)
    fd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb')as stream:
        before=os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size>maximum:raise EvidenceLimit('Copy evidence exceeds cap')
        raw=stream.read(maximum+1);after=os.fstat(stream.fileno())
        if len(raw)!=before.st_size or(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):raise EvidenceLimit('Evidence copy changed')
    emit_bytes(target,raw)
