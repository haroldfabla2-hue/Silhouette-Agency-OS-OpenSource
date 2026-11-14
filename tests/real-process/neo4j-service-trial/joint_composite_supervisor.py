"""SOURCE CANDIDATE. Real oneboot dependency/product A-C composite.
No cmdline/environ observers, secret file, retry, extra serviceboot, process-exit
lifecycle oracle or selective evidence success. Admin was reaped before exec.
"""
import base64,hashlib,json,os,pathlib,re,resource,selectors,signal,socket,subprocess,time
from bounded_evidence import CompositeWriters
from secret_export_guard import FixtureExportGuard
H=pathlib.Path('/tmp/harness');W=pathlib.Path('/tmp/work');R=pathlib.Path('/tmp/neo4j-runtime')
NODE='/opt/hostedtoolcache/node/22.18.0/x64/bin/node'

def proc(pid):
    p=pathlib.Path('/proc')/str(pid)
    try:
        raw=(p/'stat').read_text();f=raw[raw.rindex(')')+2:].split()
        return {'pid':pid,'start_ticks':int(f[19]),'pgid':int(f[2]),'ppid':int(f[1]),'state':f[0]}
    except FileNotFoundError:return None

def group(pid):
    rows=[]
    for p in pathlib.Path('/proc').iterdir():
        if p.name.isdigit():
            row=proc(int(p.name))
            if row and row['pgid']==pid:rows.append(row)
    return rows

def digest(p):
    with p.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()

def listening(port):
    for family in ['tcp','tcp6']:
        for row in (pathlib.Path('/proc/net')/family).read_text().splitlines()[1:]:
            f=row.split()
            if f[3]=='0A' and int(f[1].split(':')[1],16)==port:return True
    return False

def main():
    fd=int(os.environ['JOINT_CONTROL_FD'])
    with os.fdopen(fd,'rb')as stream:raw=stream.read(8193)
    assert len(raw)<=8192;control=json.loads(raw)
    with os.fdopen(control['secret_fd'],'rb')as stream:payload=stream.read(1025)
    assert len(payload)<=1024;values=json.loads(payload)
    assert set(values)=={'neo4j','api','login'}
    secrets_private=[bytearray(value,'ascii')for value in values.values()]
    guard=FixtureExportGuard(secrets_private);writers=CompositeWriters(guard)
    result={'schema':'REAL_SERVICE_PRODUCT_AC_COMPOSITE_V1','source_head':'7854560d1f5e3a4256e2ee62a41840432dee8cb9',
            'status':'INCOMPLETE','admin':control['admin'],'admin_exclusive_window':control['exclusive_window'],
            'worker_results':[],'failure_causes':[],'signals':[],'cleanup':[],'failure_types':[],
            'redisMainNativeClosure':'UNSUPPORTED_PUBLIC_JOIN_API','lifecycleAcceptance':'INCOMPLETE_NOT_ACCEPTED',
            'functionalStatus':'NOT_COMPLETE','coverage':'SCOPED_REAL_AC_NOT_UI_POSITIVE_GENERATION_FULL_PILLARS_OR_GLOBAL_PRODUCT_ACCEPTANCE',
            'runtime_libraries':[],'library_observation_errors':0,'actual_java_role_samples':[],'budgets_seconds':{'fixture':550,'admin':35,'startup':90,'cases':355,'stop':30,'evidence':40}}
    deadline=control['deadline'];server=control['original_server_pid'];server_identity=proc(server);assert server_identity and server_identity['pgid']==server
    sel=selectors.DefaultSelector();server_rc=None;redis=None;worker=None;seen_libraries={};console_bytes=0
    eof=set();labels={};next_sample=0;original_ids={server:server_identity}
    stage='PRECHECK';neo4j_shutdown_tail=bytearray();vendor_markers={b'Neo4j Server shutdown initiated by request':False,b'Stopped.':False}
    def track(fd,label):
        os.set_blocking(fd,False);labels[fd]=label;sel.register(fd,selectors.EVENT_READ)
    track(control['console_fd'],'neo4j')
    def observe_libraries():
        # Actual loaded physical ELF files, not guessed readelf search results.
        # Permission/rapid-exit gaps remain explicit failed provenance evidence.
        for leader in [server]+([redis.pid]if redis else [])+([worker.pid]if worker else []):
            for row in group(leader):
                pid=row['pid'];base=pathlib.Path('/proc')/str(pid)
                try:
                    # Actual executable and numeric roles, no commandline.
                    exe=(base/'exe').resolve(strict=True)
                    if exe.name=='java':
                        assert str(exe)=='/usr/lib/jvm/temurin-21-jdk-amd64/bin/java'
                        limits=(base/'limits').read_text();nofile=next(x for x in limits.splitlines()if x.startswith('Max open files')).split()[3:5]
                        status=(base/'status').read_text();assert nofile==['40000','40000']
                        assert next(x.split()[1:]for x in status.splitlines()if x.startswith('Uid:'))==['1000']*4
                        for name in ['CapEff:','CapPrm:','CapAmb:']:assert int(next(x.split()[1]for x in status.splitlines()if x.startswith(name)),16)==0
                        proof={**row,'pinned_executable':True,'nofile':[40000,40000],'uid':1000,'caps_zero':True}
                        if len(result['actual_java_role_samples'])<4:result['actual_java_role_samples'].append(proof)
                    for line in (base/'maps').read_text().splitlines():
                        f=line.split(None,5)
                        if len(f)!=6 or not f[5].startswith('/') or f[5].endswith(' (deleted)'):continue
                        path=pathlib.Path(f[5])
                        if not(path.suffix=='.node' or '.so' in path.name):continue
                        real=path.resolve(strict=True)
                        key=str(real)
                        if key in seen_libraries:
                            seen_libraries[key]['mapping_observation_count']+=1
                            continue
                        assert any(real.is_relative_to(root)for root in [W/'node_modules',pathlib.Path('/usr'),pathlib.Path('/opt'),R/'java-tmp'])
                        seen_libraries[key]={'pid':pid,'start_ticks':row['start_ticks'],'path':str(real),'bytes':real.stat().st_size,'sha256':digest(real),'source':'ACTUAL_PROC_MAPS_PHYSICAL_FILE_HASH_NOT_SUPPLYCHAIN_ATTESTATION','mapping_observation_count':1}
                        assert len(seen_libraries)<=256
                except FileNotFoundError:pass
                except (OSError,AssertionError):result['library_observation_errors']+=1
    def drain(until,worker_buffer=None):
        nonlocal server_rc,next_sample,console_bytes
        assert time.monotonic()<min(deadline,until)
        for key,_ in sel.select(min(.025,max(0,until-time.monotonic()))):
            try:b=os.read(key.fd,65536)
            except BlockingIOError:continue
            if not b:
                eof.add(labels[key.fd]);sel.unregister(key.fd);continue
            console_bytes+=len(b);writers.console(b)
            if labels[key.fd]=='neo4j':
                # In-memory constant-marker scan. Raw output is separately
                # guarded and bounded; markers contain no credential bytes.
                neo4j_shutdown_tail.extend(b)
                for marker in vendor_markers:vendor_markers[marker]|=marker in neo4j_shutdown_tail
                del neo4j_shutdown_tail[:-256]
            if labels[key.fd].startswith('worker:') and worker_buffer is not None:
                worker_buffer.extend(b)
                assert len(worker_buffer)<=2*1024**2
        if server_rc is None:
            got,status=os.waitpid(server,os.WNOHANG)
            if got:server_rc=os.waitstatus_to_exitcode(status)
        if time.monotonic()>=next_sample:
            next_sample=time.monotonic()+.25;observe_libraries()
    def wait_natural(child,label,until,buffer=None):
        while time.monotonic()<until:
            drain(until,buffer)
            rc=server_rc if child is None else child.poll()
            pid=server if child is None else child.pid
            if rc is not None and label in eof and not group(pid):return rc
        raise TimeoutError('Original process/EOF/group did not settle within fixed allocation')
    def controlled_server_stop(until):
        current=proc(server)
        if current:
            assert current['start_ticks']==server_identity['start_ticks'] and current['pgid']==server
            os.kill(server,signal.SIGINT)
            result['signals'].append({'kind':'CONTROLLED_ORIGINAL_SERVER_SIGINT','pid':server,'start_ticks':current['start_ticks']})
        rc=wait_natural(None,'neo4j',until);assert rc==0
    def emergency(child,label):
        # Explicit invalidation before forced cleanup. Not a lifecycle success.
        pid=server if child is None else child.pid
        rows=group(pid)
        if rows:
            result['status']='FAIL';result['signals'].append({'kind':'FORCED_FAILED_SCOPE_KILL','scope':label})
            try:os.killpg(pid,signal.SIGKILL)
            except ProcessLookupError:pass
        if child:
            try:child.wait(timeout=2)
            except subprocess.TimeoutExpired:result['failure_types'].append('CleanupTimeout')
        elif server_rc is None:
            try:os.waitpid(server,0)
            except ChildProcessError:pass
    try:
        assert resource.getrlimit(resource.RLIMIT_NOFILE)==(256,256)
        assert not listening(6499) and not listening(3405)
        # Single original Neo4j launch, created before observer hardlimit lower.
        os.write(control['gate_fd'],b'G');os.close(control['gate_fd'])
        stage='STARTUP';startup_end=min(deadline-425,time.monotonic()+90)
        redis_home=W/'node_modules/.silhouette-native-redis';asset=json.loads((redis_home/'asset.json').read_text())
        assert digest(redis_home/'redis-server')==asset['binary_sha256'] and os.statvfs(redis_home).f_flag&os.ST_RDONLY
        redis_argv=[str(redis_home/'redis-server'),'--bind','127.0.0.1','--port','6499','--protected-mode','yes','--save','','--appendonly','no','--maxclients','64','--maxmemory','64mb','--maxmemory-policy','noeviction','--daemonize','no','--loglevel','notice']
        redis=subprocess.Popen(redis_argv,cwd='/tmp/product-runtime',env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
        original_ids[redis.pid]=proc(redis.pid);track(redis.stdout.fileno(),'redis')
        while not(listening(7474)and listening(7787)and listening(6499)):
            assert server_rc is None and redis.poll()is None;drain(startup_end)
        result['readiness']='LISTEN_ONLY_NOT_AUTH_OR_BACKEND_PROOF_SDK_CASES_FOLLOW'
        case_end=min(deadline-70,time.monotonic()+355)
        for mode,limit in [('cold-redis',65),('cold-graph',70),('router',140),('cold-graph-unsafe',65)]:
            assert worker is None or worker.poll()is not None
            worker_dir=pathlib.Path('/tmp/product-runtime')/mode;worker_dir.mkdir()
            r,w=os.pipe();os.write(w,payload);os.close(w)
            env={'PATH':str(pathlib.Path(NODE).parent)+':/usr/bin:/bin','HOME':'/tmp/home','TMPDIR':str(worker_dir),'LANG':'C.UTF-8','NODE_ENV':'test','NODE_OPTIONS':'--max-old-space-size=2048',
                 'SILHOUETTE_BOOT_MODE':'normal','SILHOUETTE_PROVIDERS':'on','SILHOUETTE_INFERENCE_MODE':'cloud-only','SILHOUETTE_HOST':'127.0.0.1','PORT':'3405',
                 'SILHOUETTE_DB_PATH':str(worker_dir/'product.sqlite'),'SILHOUETTE_LANCEDB_PATH':str(worker_dir/'lance'),
                 'REDIS_HOST':'127.0.0.1','REDIS_PORT':'6499','NEO4J_URI':'bolt://127.0.0.1:7787','NEO4J_USER':'neo4j','JOINT_FIXTURE_SECRET_FD':str(r),
                 'GOMAXPROCS':'2','TOKIO_WORKER_THREADS':'2','LANCE_CPU_THREADS':'2','RAYON_NUM_THREADS':'2'}
            stage='WORKER_'+mode.upper().replace('-','_');label='worker:'+mode;buffer=bytearray()
            worker=subprocess.Popen([NODE,'--import',str(W/'node_modules/tsx/dist/loader.mjs'),str(H/'product_service_child.mts'),mode],cwd=W,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True,pass_fds=(r,));os.close(r)
            original_ids[worker.pid]=proc(worker.pid);track(worker.stdout.fileno(),label)
            rc=wait_natural(worker,label,min(case_end,time.monotonic()+limit),buffer)
            parsed=[json.loads(line.split(b':',1)[1])for line in buffer.splitlines()if line.startswith(b'JOINT_PRODUCT_CHILD_RESULT:')]
            assert len(parsed)==1 and rc==0
            result['worker_results'].append(parsed[0]);assert parsed[0]['functionalStatus']=='SCOPED_REAL_AC_ASSERTIONS_PASS'
            assert parsed[0]['status']=='INCOMPLETE' and parsed[0]['redisMainNativeClosure']=='UNSUPPORTED_PUBLIC_JOIN_API'
            assert not listening(3405)
            worker.stdout.close()
        stage='NEO4J_CONTROLLED_STOP';stop_end=min(deadline-40,time.monotonic()+30)
        controlled_server_stop(min(stop_end-10,time.monotonic()+20))
        assert all(vendor_markers.values()),'VENDOR_SHUTDOWN_MARKERS_MISSING'
        result['vendor_shutdown_markers']={'shutdown_request':True,'stopped':True}
        # Redis SIGTERM is documented normal persistence-disabled shutdown, not
        # a forced kill. Natural rc0/EOF/empty original group is still required.
        stage='REDIS_CONTROLLED_STOP';before=proc(redis.pid);assert before and before['start_ticks']==original_ids[redis.pid]['start_ticks']
        os.kill(redis.pid,signal.SIGTERM);result['signals'].append({'kind':'CONTROLLED_ORIGINAL_REDIS_SIGTERM','pid':redis.pid,'start_ticks':before['start_ticks']})
        assert wait_natural(redis,'redis',min(stop_end,time.monotonic()+10))==0
        assert not any(listening(port)for port in [3405,6499,7474,7787])
        assert not result['library_observation_errors'] and result['actual_java_role_samples']
        result['functionalStatus']='SCOPED_REAL_AC_ASSERTIONS_COMPLETE';result['status']='INCOMPLETE'
    except BaseException as error:
        result['status']='FAIL';result['failure_types'].append(type(error).__name__)
        result['failure_causes'].append({'stage':stage,'errorType':type(error).__name__,'cause':'FIXED_STAGE_CHECK_FAILED_OR_ORIGINAL_OPERATION_REJECTED'})
    finally:
        for child,label in [(worker,'product'),(redis,'redis'),(None,'neo4j')]:
            if child is not None or label=='neo4j':
                try:emergency(child,label)
                except BaseException as error:result['failure_types'].append(type(error).__name__)
        # Exact original lossless diagnostics after process shutdown, never DB,
        # authstore, session files, environment, command lines or private pipes.
        stage='POSTSTOP_RUNTIME_EVIDENCE';result['runtime_files']=[];result['runtime_files_complete']=False
        try:
            paths=[R/'conf'/name for name in ['neo4j.conf','server-logs.xml','user-logs.xml']]
            for path in sorted((R/'logs').iterdir()):
                assert path.is_file() and not path.is_symlink()
                assert re.fullmatch(r'[A-Za-z0-9_-]+\.log(?:\.[0-9]+)?',path.name)
                paths.append(path)
            assert len(paths)<=19
            total=0
            for path in paths:
                assert path.is_file() and not path.is_symlink()
                with path.open('rb')as stream:
                    before=os.fstat(stream.fileno());assert before.st_size<=131072
                    raw=stream.read(131073);after=os.fstat(stream.fileno())
                assert len(raw)==before.st_size and before.st_mtime_ns==after.st_mtime_ns
                assert not any(needle in raw for needle in guard.needles)
                total+=len(raw);assert total<=512*1024
                result['runtime_files'].append({'path':str(path.relative_to(R)),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'base64':base64.b64encode(raw).decode('ascii')})
            result['runtime_files_complete']=True
        except BaseException as error:
            result['status']='FAIL';result['failure_types'].append(type(error).__name__);result['failure_causes'].append({'stage':stage,'errorType':type(error).__name__,'cause':'RUNTIME_FILE_COMPLETE_CAPTURE_FAILED'})
        result['runtime_libraries']=list(seen_libraries.values());result['console_observed_bytes']=console_bytes
        result['cleanup']=[{'pid':pid,'start_ticks':row['start_ticks']if row else None,'remaining_group_count':len(group(pid))}for pid,row in original_ids.items()]
        if any(row['remaining_group_count']for row in result['cleanup']):result['status']='FAIL'
        try:writers.finish_console();writers.envelope(result)
        finally:
            guard.clear()
            for private in secrets_private:private[:]=b'\0'*len(private)
            values.clear();sel.close()
    # Command success is functional completion only; every outer acceptor must
    # read status INCOMPLETE and retain the unsupported SDK causal gate.
    if result['functionalStatus']!='SCOPED_REAL_AC_ASSERTIONS_COMPLETE' or result['status']=='FAIL':raise SystemExit(1)

if __name__=='__main__':main()
