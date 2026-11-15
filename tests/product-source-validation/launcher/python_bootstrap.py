"""Fixed Python -c bootstrap source, data only when this module is imported."""
BOOTSTRAP = r'''
# Preserve the original script argv and script-directory import behavior.
import sys,os,json
stage='PYTHON_STARTED';receipt=None;primary=None
def emit(operation,failure=None):
    record={'version':1,'operation':operation,'failure':failure,'productPass':False}
    raw=(json.dumps(record,sort_keys=True)+'\n').encode('ascii')
    if len(raw)>512:raise ValueError('FIXED_BOOTSTRAP_RECORD_BOUND')
    done=0
    while done<len(raw):
        count=os.write(receipt,raw[done:])
        if count<=0:raise OSError('FIXED_BOOTSTRAP_WRITE')
        done+=count
def fallback(operation):
    fd=None
    try:
        fd=os.open('/evidence/python-bootstrap-receipt-failure.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        raw=json.dumps({'version':1,'operation':operation,'receiptWriteFailed':True,'productPass':False}).encode('ascii')
        if os.write(fd,raw)!=len(raw):raise OSError('FIXED_FALLBACK_WRITE')
    except BaseException:pass
    finally:
        try:
            if fd is not None:os.close(fd)
        except BaseException:pass
try:
    receipt=os.open('/evidence/python-bootstrap.jsonl',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    emit(stage)
    script='/driver/launcher/namespace-entry.py'
    stage='SOURCE_READ';emit(stage)
    with open(script,'rb')as stream:source=stream.read(65537)
    if len(source)>65536:raise ValueError('FIXED_SOURCE_BOUND')
    stage='SOURCE_COMPILE';emit(stage)
    code=compile(source,script,'exec',dont_inherit=True)
    sys.argv=[script,*sys.argv[1:]];sys.path[0]='/driver/launcher'
    stage='SOURCE_EXEC';emit(stage)
    os.close(receipt);receipt=None
    exec(code,{'__name__':'__main__','__file__':script,'__package__':None,'__cached__':None})
except BaseException as error:
    if isinstance(error,SystemExit)and error.code in (None,0):raise
    primary=error
    category='SYNTAX'if isinstance(error,SyntaxError)else'IMPORT'if isinstance(error,ImportError)else'PERMISSION'if isinstance(error,PermissionError)else'NOT_FOUND'if isinstance(error,FileNotFoundError)else'CHILD_NONZERO'if isinstance(error,SystemExit)else'OTHER'
    try:
        if receipt is None:receipt=os.open('/evidence/python-bootstrap.jsonl',os.O_WRONLY|os.O_APPEND|os.O_NOFOLLOW)
        emit(stage,category)
    except BaseException:fallback(stage)
    raise
finally:
    if receipt is not None:
        try:os.close(receipt)
        except BaseException:
            fallback(stage)
            if primary is None:raise
'''
