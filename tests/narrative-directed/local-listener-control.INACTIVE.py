"""Real temporary AF_UNIX sockets, real proc/fd reads and real exporter.
No daemon, product, namespace changes, mock provider or infrastructure calls.
"""
import ast,copy,pathlib,socket,os,subprocess,sys,tempfile,json,re
D=pathlib.Path(__file__).parent
namespace={'Path':pathlib.Path,'os':os,'json':json,'re':re}
tree=ast.parse((D/'host-adapter.INACTIVE.py').read_text())
functions=[copy.deepcopy(v) for v in tree.body if isinstance(v,ast.FunctionDef) and v.name in ('need','proc_stat','durable','bind_local_listener')]
assert len(functions)==4
exec(compile(ast.Module(body=functions,type_ignores=[]),str(D/'host-adapter.INACTIVE.py'),'exec'),namespace)
with tempfile.TemporaryDirectory(prefix='finite-public-listener-') as tmp:
    root=pathlib.Path(tmp);samples=[];results=[]
    evidence=root/'observations.json'
    def run(path,pid,wanted=None):
        try:namespace['bind_local_listener'](path,pid,evidence,samples)
        except RuntimeError as error:
            assert wanted==str(error),(wanted,str(error))
        else:assert wanted is None,wanted
        actual=json.loads(evidence.read_text())['socketObservations']
        assert actual==samples and actual[-1]['validationResult']==('REJECTED' if wanted else 'ACCEPTED')
        results.append({'expected':wanted or 'ACCEPTED',**actual[-1]})
    path=root/'socket'
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as listener:
        listener.bind(str(path));listener.listen(4)
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
            client.connect(str(path))
            run(path,os.getpid())
            # Pending server connection has inode zero and state02 on Linux.
            pending=samples[-1]['socketRows']
            assert any(v['kernelInode']==0 and v['socketState']==2 for v in pending)
            with listener.accept()[0] as accepted:
                run(path,os.getpid());assert samples[-1]['matchingRowCount']>=2 and samples[-1]['listenerCount']==1
                alias=root/'alias';alias.symlink_to(root,target_is_directory=True)
                run(alias/'socket',os.getpid())
                with subprocess.Popen([sys.executable,'-I','-S','-c','import sys;sys.stdin.buffer.read(1)'],stdin=subprocess.PIPE) as child:
                    try:run(path,child.pid,'LOCAL_SERVICE_SOCKET_BINDING')
                    finally:child.stdin.close();child.wait(timeout=3)
        path.unlink()
        # Two real listeners bound to one textual pathname, due to unlink/rebind.
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as second:
            second.bind(str(path));second.listen(1)
            run(path,os.getpid(),'LOCAL_SOCKET_KERNEL_IDENTITY');assert samples[-1]['listenerCount']==2
    path.unlink()
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as not_listening:
        not_listening.bind(str(path))
        run(path,os.getpid(),'LOCAL_SOCKET_KERNEL_IDENTITY');assert samples[-1]['listenerCount']==0
    run(root/'actually-absent-path',os.getpid(),'LOCAL_SOCKET_KERNEL_IDENTITY')
    assert samples[-1]['matchingRowCount']==0
    receipt=root/'receipt.json';receipt.write_text(json.dumps({'kind':'DIRECTED_REAL_NARRATIVE','result':'UNKNOWN','socketObservations':samples}))
    diag=root/'diag.json';diag.write_text(json.dumps({'kind':'DIRECTED_HOST_DIAGNOSTICS','events':[]}))
    source=(D/'export-selected.INACTIVE.py').read_text().replace('/tmp/narrative-directed-evidence',str(root/'export'))
    source=source.replace('/tmp/narrative-directed-result.json.host-diagnostics.json',str(diag)).replace('/tmp/narrative-directed-result.json',str(receipt))
    exporter=root/'export.py';exporter.write_text(source);subprocess.run([sys.executable,'-I','-B','-S',str(exporter)],check=True)
    exported=json.loads((root/'export/receipt.json').read_text())['socketObservations'];assert exported==samples
    print(json.dumps({'kind':'REAL_LOCAL_LISTENER_SELECTION_AND_EXPORT_CONTROL','cases':len(samples),'pendingInodeZeroExcluded':True,
      'listenerPlusAcceptedAllowed':True,'symlinkAliasAllowed':True,'wrongMainPidFdRejected':True,'zeroAndMultipleListenersRejected':True,
      'decisiveObservationsPersistedAndExported':True,'hostDaemonProductInfrastructureExecuted':False,'historicalCauseProved':False},sort_keys=True))
