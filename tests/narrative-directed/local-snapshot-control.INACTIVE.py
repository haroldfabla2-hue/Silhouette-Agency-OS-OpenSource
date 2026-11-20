"""Finite real validation/receipt/export control, no host or product execution.
Extract exact method ASTs to avoid importing host modules. No mocked calls or
synthetic OS/host success. Reject real invalid data and an actual missing file;
run the complete real exporter in its own process against these receipts.
"""
import ast,copy,json,pathlib,subprocess,sys,tempfile,types,os,re,hashlib
D=pathlib.Path(__file__).parent

def extract(filename,names):
    tree=ast.parse((D/filename).read_text());nodes=[]
    for node in ast.walk(tree):
        if isinstance(node,(ast.FunctionDef,ast.ClassDef)) and node.name in names:
            node=copy.deepcopy(node)
            if isinstance(node,ast.FunctionDef):node.decorator_list=[]
            nodes.append(node)
    assert len(nodes)==len(names)
    return ast.Module(body=nodes,type_ignores=[])

with tempfile.TemporaryDirectory(prefix='directed-real-receipt-control-') as temporary:
    root=pathlib.Path(temporary);namespace={'Path':pathlib.Path,'os':os,'json':json,'re':re}
    exec(compile(extract('vm-parent-derived.INACTIVE.py',{'put'}),str(D/'vm-parent-derived.INACTIVE.py'),'exec'),namespace)
    exec(compile(extract('host-adapter.INACTIVE.py',{'need'}),str(D/'host-adapter.INACTIVE.py'),'exec'),namespace)
    exec(compile(extract('vm-parent-derived.INACTIVE.py',{'record_shared_sample'}),str(D/'vm-parent-derived.INACTIVE.py'),'exec'),namespace)
    initial={'controllers':['cpu','memory','pids'],'enabled':['cpu'],'inode':[1,2],'limits':{}}
    obj=types.SimpleNamespace(pre={'shared':copy.deepcopy(initial)},ledger=root)
    method=types.MethodType(namespace['record_shared_sample'],obj)
    current=copy.deepcopy(initial)  # Actual available data lacks enabled pids/memory.
    try:method('AFTER_PARENT_CREATE',current)
    except RuntimeError as error:assert str(error)=='VM_REQUIRED_CONTROLLERS_NOT_ENABLED'
    else:raise AssertionError('REAL_INVALID_DATA_ACCEPTED')
    first=json.loads((root/'vm-controller-snapshots.json').read_text())
    assert first['initial']==initial and first['samples'][-1]['enabled']==['cpu']
    assert first['samples'][-1]['validationResult']=='REJECTED'
    try:(root/'actually-absent-snapshot').read_text()
    except FileNotFoundError as read_error:
        try:method('ACTIVE_PARENT',None,read_error=read_error)
        except FileNotFoundError:pass
        else:raise AssertionError('ACTUAL_FILE_ERROR_SWALLOWED')
    actual=json.loads((root/'vm-controller-snapshots.json').read_text())
    assert obj.pre['shared']==initial and actual['initial']==initial
    assert len(actual['samples'])==2 and actual['samples'][0]==first['samples'][0]
    assert actual['samples'][1]['sampleState']=='READ_ERROR' and actual['samples'][1]['errno']==2
    assert actual['samples'][1]['validationResult']=='REJECTED'
    receipt=root/'result.json';receipt.write_text(json.dumps({'kind':'DIRECTED_REAL_NARRATIVE','result':'UNKNOWN',
        'initialControllers':initial['controllers'],'initialEnabled':initial['enabled'],
        'controllerSnapshots':actual['samples']}))
    diagnostics=root/'host.json';diagnostics.write_text(json.dumps({'kind':'DIRECTED_HOST_DIAGNOSTICS','events':[]}))
    # Execute unchanged exporter logic, substituting only fixed I/O destinations
    # for temporary files. No collector, validation or projection is replaced.
    source=(D/'export-selected.INACTIVE.py').read_text().replace('/tmp/narrative-directed-evidence',str(root/'export'))
    source=source.replace('/tmp/narrative-directed-result.json.host-diagnostics.json',str(diagnostics))
    source=source.replace('/tmp/narrative-directed-result.json',str(receipt))
    exporter=root/'exporter.py';exporter.write_text(source)
    subprocess.run([sys.executable,'-I','-B','-S',str(exporter)],check=True)
    projected=json.loads((root/'export/receipt.json').read_text())
    assert projected['controllerSnapshots']==actual['samples']
    assert projected['initialControllers']==initial['controllers'] and projected['initialEnabled']==initial['enabled']
    print(json.dumps({'kind':'LOCAL_DATA_REJECTION_AND_REAL_EXPORT_CONTROL_NOT_HOST_TEST',
        'realInvalidSnapshotRejectedAndPreserved':True,'realMissingFileErrorPreservedAndExported':True,
        'initialUnchanged':True,'exportedSamples':len(projected['controllerSnapshots']),
        'productOrHostExecuted':False,'sourceSha256':hashlib.sha256((D/'vm-parent-derived.INACTIVE.py').read_bytes()).hexdigest()},sort_keys=True))
