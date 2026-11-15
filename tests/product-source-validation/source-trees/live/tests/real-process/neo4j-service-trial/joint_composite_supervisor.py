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
            'runtime_libraries':[],'library_observation_errors':0,'library_observation_missing_count':0,'library_observation_error_samples':[],'library_observation_error_samples_omitted':0,'actual_java_role_samples':[],'budgets_seconds':{'fixture':550,'admin':35,'startup':90,'cases':355,'stop':30,'evidence':40}}
    deadline=control['deadline'];server=control['original_server_pid'];server_identity=proc(server);assert server_identity and server_identity['pgid']==server
    sel=selectors.DefaultSelector();server_rc=None;redis=None;worker=None;seen_libraries={};console_bytes=0
    eof=set();labels={};next_sample=0;original_ids={server:server_identity}
    stage='PRECHECK';neo4j_shutdown_tail=bytearray();vendor_markers={b'Neo4j Server shutdown initiated by request':False,b'Stopped.':False}
    def track(fd,label):
        os.set_blocking(fd,False);labels[fd]=label;sel.register(fd,selectors.EVENT_READ)
    track(control['console_fd'],'neo4j')
    # Exact readonly mounts in phase-namespace, resolved physically here.
    # No dynamic root from a mapped filename; external symlink escape rejected.
    library_roots=[]
    def admit_library_roots():
        for label,path in [('PRODUCT_NATIVE',W/'node_modules'),('SYSTEM_USR',pathlib.Path('/usr')),('SYSTEM_OPT',pathlib.Path('/opt')),('SYSTEM_LIB',pathlib.Path('/lib')),('SYSTEM_LIB64',pathlib.Path('/lib64')),('PRIVATE_JAVA_TMP',R/'java-tmp')]:
            real=path.resolve(strict=True)
            if label.startswith('SYSTEM_'):
                assert real==path or(label in {'SYSTEM_LIB','SYSTEM_LIB64'}and real in {pathlib.Path('/usr/lib'),pathlib.Path('/usr/lib64'),pathlib.Path('/lib/x86_64-linux-gnu')})
                assert os.statvfs(path).f_flag&os.ST_RDONLY
            library_roots.append((label,real))
    def observe_libraries():
        # Actual loaded physical ELF files, not guessed readelf search results.
        # Permission/rapid-exit gaps remain explicit failed provenance evidence.
        for leader in [server]+([redis.pid]if redis else [])+([worker.pid]if worker else []):
            for row in group(leader):
                pid=row['pid'];base=pathlib.Path('/proc')/str(pid);observation_stage='EXECUTABLE';role='ORIGINAL_NEO4J_GROUP'if leader==server else'ORIGINAL_REDIS_GROUP'if redis and leader==redis.pid else'ORIGINAL_PRODUCT_GROUP'
                try:
                    # Actual executable and numeric roles, no commandline.
                    exe=(base/'exe').resolve(strict=True)
                    observation_stage='JAVA_ROLE_LIMITS'
                    if exe.name=='java':
                        assert str(exe)=='/usr/lib/jvm/temurin-21-jdk-amd64/bin/java'
                        limits=(base/'limits').read_text();nofile=next(x for x in limits.splitlines()if x.startswith('Max open files')).split()[3:5]
                        status=(base/'status').read_text();assert nofile==['40000','40000']
                        assert next(x.split()[1:]for x in status.splitlines()if x.startswith('Uid:'))==['1000']*4
                        for name in ['CapEff:','CapPrm:','CapAmb:']:assert int(next(x.split()[1]for x in status.splitlines()if x.startswith(name)),16)==0
                        proof={**row,'pinned_executable':True,'nofile':[40000,40000],'uid':1000,'caps_zero':True}
                        if len(result['actual_java_role_samples'])<4:result['actual_java_role_samples'].append(proof)
                    observation_stage='MAPS_READ'
                    for line in (base/'maps').read_text().splitlines():
                        f=line.split(None,5)
                        if len(f)!=6 or not f[5].startswith('/') or f[5].endswith(' (deleted)'):continue
                        path=pathlib.Path(f[5])
                        if not(path.suffix=='.node' or '.so' in path.name):continue
                        observation_stage='LIBRARY_RESOLVE';real=path.resolve(strict=True)
                        key=str(real)
                        if key in seen_libraries:
                            seen_libraries[key]['mapping_observation_count']+=1
                            continue
                        observation_stage='LIBRARY_ALLOWLIST'
                        root_classes=[label for label,root in library_roots if real.is_relative_to(root)]
                        assert root_classes
                        observation_stage='LIBRARY_STAT_AND_DIGEST'
                        seen_libraries[key]={'pid':pid,'start_ticks':row['start_ticks'],'path':str(real),'bytes':real.stat().st_size,'sha256':digest(real),'source':'ACTUAL_PROC_MAPS_PHYSICAL_FILE_HASH_NOT_SUPPLYCHAIN_ATTESTATION','physical_root_classes':root_classes,'mapping_observation_count':1}
                        observation_stage='LIBRARY_COUNT_BOUND'
                        assert len(seen_libraries)<=256
                except (OSError,AssertionError)as error:
                    missing=isinstance(error,FileNotFoundError)
                    if missing:result['library_observation_missing_count']+=1
                    else:result['library_observation_errors']+=1
                    detail={'stage':observation_stage,'error_type':type(error).__name__ if type(error).__name__ in {'FileNotFoundError','PermissionError','OSError','AssertionError','ProcessLookupError'}else'OTHER_OSERROR','errno':getattr(error,'errno',None),'role':role,'pid':pid,'start_ticks':row['start_ticks'],'missing_in_prior_semantics':missing,'path_class':'OUTSIDE_ADMITTED_PHYSICAL_ROOTS'if observation_stage=='LIBRARY_ALLOWLIST'else'NOT_RECORDED','cause_attribution':'OBSERVED_TYPE_STAGE_ONLY_NO_PATH_OR_TRANSIENT_INFERENCE'}
                    if len(result['library_observation_error_samples'])<64:result['library_observation_error_samples'].append(detail)
                    else:result['library_observation_error_samples_omitted']+=1
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
        admit_library_roots()
        result['runtime_library_root_admission']={'status':'READONLY_MOUNTS_PHYSICAL_ROOTS_ADMITTED_NOT_SUPPLYCHAIN_ATTESTATION','classes':[label for label,_ in library_roots]}
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
            assert len(parsed)==1,'Missing or ambiguous original child result'
            actual=parsed[0];assert actual.get('schema')=='REAL_PRODUCT_SERVICE_AC_CHILD_V1'and actual.get('mode')==mode
            result['worker_results'].append(actual)
            result.setdefault('original_worker_returncodes',[]).append({'mode':mode,'returncode':rc})
            assert rc==0,'Original child returned nonzero; actual result retained'
            assert actual['functionalStatus']=='SCOPED_REAL_AC_ASSERTIONS_PASS'
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
        evidence_end=min(deadline,time.monotonic()+40)
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
        # One vendor-supported diagnostic ONLY after actual failed startup,
        # original process containment and original runtime capture. Not a boot
        # or a substitute configuration, and never changes original verdict.
        if any(row['stage']=='STARTUP'for row in result['failure_causes']):
            diagnostic={'operation':'VENDOR_NEO4J_ADMIN_SERVER_VALIDATE_CONFIG_ONE_ATTEMPT','status':'NOT_STARTED','original_verdict_preserved':True,'snapshot_taken_before_diagnostic':result['runtime_files_complete'],'may_write_log_appender_files_after_snapshot':True,'role':'OBSERVER256_NO_CAPS_NO_NEW_PRIVILEGE','limit_seconds':10,'output_cap_bytes':65536,'stdout_policy':'KNOWN_FIXTURE_SECRET_GUARDED_IN_MEMORY_TYPED_CATEGORIES_ONLY_NO_FREE_TEXT_OR_HASH','errors':[],'signals':[],'observed_bytes':0,'output_complete':False}
            result['postfailure_config_diagnostic']=diagnostic
            diagnostic_child=None;diagnostic_selector=None;diagnostic_guard=FixtureExportGuard(secrets_private);diagnostic_bytes=bytearray();diagnostic_eof=False;diagnostic_end=min(evidence_end-5,time.monotonic()+10)
            def diagnostic_error(stage,error):
                diagnostic['errors'].append({'stage':stage,'error_type':type(error).__name__ if type(error).__name__ in {'AssertionError','RuntimeError','TimeoutError','OSError','FileNotFoundError','PermissionError','ValueError','BrokenPipeError','FixtureSecretExportDetected'}else'OTHER_EXCEPTION','errno':getattr(error,'errno',None)})
            try:
                assert result['runtime_files_complete'] and not any(row['remaining_group_count']for row in result['cleanup']),'diagnostic requires original capture and empty original groups'
                expected_conf={'conf/neo4j.conf':H/'neo4j-auth.conf','conf/server-logs.xml':H/'neo4j-boot-logs.xml','conf/user-logs.xml':H/'neo4j-boot-user-logs.xml'}
                captured={row['path']:row for row in result['runtime_files']}
                for name,admitted in expected_conf.items():assert captured[name]['sha256']==digest(admitted)==digest(R/name)
                diagnostic['exact_input_snapshot_verified']=True
                assert diagnostic_end>time.monotonic(),'no diagnostic subwindow remaining'
                assert resource.getrlimit(resource.RLIMIT_NOFILE)==(256,256)
                jdk=pathlib.Path(json.loads((H/'neo4j-admission-inputs.json').read_text())['jdk']['home']);asset=W/'node_modules/.silhouette-native-neo4j/neo4j-community-5.26.32'
                diagnostic_env={'PATH':'/usr/bin:/bin','JAVA_HOME':str(jdk),'JAVACMD':str(jdk/'bin/java'),'NEO4J_HOME':str(asset),'NEO4J_CONF':str(R/'conf'),'HOME':str(R/'home'),'TMPDIR':str(R/'java-tmp'),'LANG':'C.UTF-8','NEO4J_CONFIG_FILE_CHARSET':'utf8'}
                diagnostic_child=subprocess.Popen([str(asset/'bin/neo4j-admin'),'server','validate-config'],cwd=R,env=diagnostic_env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
                diagnostic_selector=selectors.DefaultSelector();os.set_blocking(diagnostic_child.stdout.fileno(),False);diagnostic_selector.register(diagnostic_child.stdout,selectors.EVENT_READ)
                while True:
                    assert time.monotonic()<diagnostic_end,'diagnostic local evidence subwindow exceeded'
                    for key,_ in diagnostic_selector.select(.025):
                        try:chunk=os.read(key.fd,8192)
                        except BlockingIOError:continue
                        if not chunk:diagnostic_eof=True;diagnostic_selector.unregister(key.fd);continue
                        diagnostic['observed_bytes']+=len(chunk)
                        assert diagnostic['observed_bytes']<=65536,'diagnostic output bound before retain'
                        diagnostic_bytes.extend(diagnostic_guard.checked_chunk(chunk))
                    if diagnostic_child.poll()is not None and diagnostic_eof and not group(diagnostic_child.pid):break
                diagnostic_bytes.extend(diagnostic_guard.checked_eof())
                diagnostic['status']='VALIDATOR_RC0'if diagnostic_child.returncode==0 else'VALIDATOR_REPORTED_NONZERO'
                diagnostic['output_complete']=True
            except BaseException as error:
                diagnostic['status']='DIAGNOSTIC_INCOMPLETE';diagnostic_error('VALIDATOR_CAPTURE',error)
            finally:
                if diagnostic_child:
                    if group(diagnostic_child.pid):
                        diagnostic['signals'].append('SIGKILL_DIAGNOSTIC_SCOPE_ONLY')
                        try:os.killpg(diagnostic_child.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                        except OSError as error:diagnostic_error('VALIDATOR_KILL',error)
                    try:diagnostic_child.wait(timeout=max(.01,min(2,evidence_end-time.monotonic())))
                    except BaseException as error:diagnostic_error('VALIDATOR_REAP',error)
                    until=min(evidence_end,time.monotonic()+2)
                    while group(diagnostic_child.pid)and time.monotonic()<until:time.sleep(.025)
                    diagnostic['returncode']=diagnostic_child.poll();diagnostic['group_empty']=not group(diagnostic_child.pid);diagnostic['eof']=diagnostic_eof
                    if diagnostic_child.stdout:
                        try:diagnostic_child.stdout.close()
                        except OSError as error:diagnostic_error('VALIDATOR_PIPE_CLOSE',error)
                    if not diagnostic['group_empty']or diagnostic['signals']:diagnostic['status']='DIAGNOSTIC_INCOMPLETE';diagnostic['output_complete']=False
                if diagnostic_selector:
                    try:diagnostic_selector.close()
                    except OSError as error:diagnostic_error('VALIDATOR_SELECTOR_CLOSE',error)
                if diagnostic['errors']:diagnostic['status']='DIAGNOSTIC_INCOMPLETE';diagnostic['output_complete']=False
                if diagnostic['output_complete']:
                    # Parse the vendor validation summary without echoing free
                    # error text, config values, arbitrary file paths or argv.
                    diagnostic['output_bytes']=len(diagnostic_bytes);diagnostic['typed_issues']=[];diagnostic['unclassified_nonempty_lines']=0;diagnostic['issue_samples_omitted']=0
                    known_terms={'error','errors','warning','warnings','invalid','failed','failure','unable','cannot','could','not','create','file','directory','permission','denied','access','appender','logger','logging','configuration','config','plugin','factory','method','found','locate','parse','parsing','element','attribute','class','manager','open','read','write','path','user','server','validation','validate','contains','no','such','is','for','to','in','of','with','has','the','a','an','on','at','exception','rollingfile','patternlayout','sizebasedtriggeringpolicy','defaultrolloverstrategy'}
                    for line in diagnostic_bytes.decode('utf-8','replace').splitlines():
                        if not line.strip():continue
                        lower=line.lower();categories=[]
                        for category,needles in [('PERMISSION_DENIED',('permission denied','accessdeniedexception','access denied')),('FILE_OR_DIRECTORY_MISSING',('no such file','filenotfoundexception','nosuchfileexception')),('FILE_CREATE_FAILED',('unable to create','could not create','cannot create')),('APPENDER_UNRESOLVED',('unable to locate appender','appenderref','null object returned for rollingfile')),('PLUGIN_OR_FACTORY_FAILED',('factory method','unable to invoke','error processing element','classnotfoundexception','noclassdeffounderror')),('XML_PARSE_FAILED',('saxparseexception','parse error','parsing error','invalid xml')),('UNKNOWN_SETTING',('unrecognized setting','unknown setting')),('VALIDATOR_ERRORS',('configuration contains errors','validation failed')),('VALIDATOR_WARNINGS',('configuration contains warnings',)),('VALIDATOR_SUCCESS',('configuration file validation successful','configuration is valid','no issues found'))]:
                            if any(needle in lower for needle in needles):categories.append(category)
                        identifiers=[]
                        for label,value in [('USER_LOG_XML',str(R/'conf/user-logs.xml')),('SERVER_LOG_XML',str(R/'conf/server-logs.xml')),('USER_LOG',str(R/'logs/user.log')),('RUNTIME_LOG',str(R/'logs/runtime.log')),('MAIN_CONFIG',str(R/'conf/neo4j.conf'))]:
                            if value in line:identifiers.append(label)
                        types=[name for name in ['AccessDeniedException','FileNotFoundException','NoSuchFileException','IOException','SAXParseException','IllegalStateException','IllegalArgumentException','ClassNotFoundException','NoClassDefFoundError','InvocationTargetException']if name in line]
                        # Finite vocabulary only; unknown tokens disappear, never
                        # a regex replacement that could leave an embedded secret.
                        terms=sorted(set(re.findall(r'[a-z]+',lower))&known_terms)
                        if categories or types or 'error'in terms or 'errors'in terms:
                            issue={'line_ordinal':len(diagnostic['typed_issues'])+diagnostic['issue_samples_omitted']+diagnostic['unclassified_nonempty_lines']+1,'categories':categories or ['UNCLASSIFIED_VENDOR_DIAGNOSTIC'],'exception_types':types,'fixed_file_roles':identifiers,'fixed_vocabulary_terms':terms}
                            if len(diagnostic['typed_issues'])<32:diagnostic['typed_issues'].append(issue)
                            else:diagnostic['issue_samples_omitted']+=1
                        else:diagnostic['unclassified_nonempty_lines']+=1
                    diagnostic['raw_output_exported']=False;diagnostic['raw_free_text_omitted']=True
                    diagnostic['typed_detail_complete']=not diagnostic['issue_samples_omitted']and all('UNCLASSIFIED_VENDOR_DIAGNOSTIC'not in row['categories']for row in diagnostic['typed_issues'])
                    diagnostic['no_claim_about_unclassified_lines']=True
                else:diagnostic['output_unavailable']=True
                diagnostic_bytes[:]=b'\0'*len(diagnostic_bytes);diagnostic_guard.clear()
        try:writers.finish_console();writers.envelope(result)
        finally:
            guard.clear()
            for private in secrets_private:private[:]=b'\0'*len(private)
            values.clear();sel.close()
    # Command success is functional completion only; every outer acceptor must
    # read status INCOMPLETE and retain the unsupported SDK causal gate.
    if result['functionalStatus']!='SCOPED_REAL_AC_ASSERTIONS_COMPLETE' or result['status']=='FAIL':raise SystemExit(1)

if __name__=='__main__':main()
