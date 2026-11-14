"""SOURCE CANDIDATE. Offline admin then one real console, never a second boot.
No generic command-line observer is imported or started in this program.
Only the exact private admin helper may read admin argv, in memory.
Not runnable until the separate integrated source/mount/owner review is closed.
"""
import ast,hashlib,json,os,pathlib,re,resource,secrets,signal,time
from neo4j_admin_private import initialize_once
H=pathlib.Path('/tmp/harness');R=pathlib.Path('/tmp/neo4j-runtime')
A=pathlib.Path('/tmp/work/node_modules/.silhouette-native-neo4j/neo4j-community-5.26.32')
ENTRY_SOURCE_STATE_REQUIRED='EXACT_JOINT_SOURCE_REVIEW_CLOSED'
entry_stage='ENTRY_IMPORT_COMPLETE'

def digest(p):
    with p.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def assert_exclusive_admin_window(inputs):
    # Exact outer observer source admits ONLY metadata, never cmdline/environ.
    # Same check owns entry and eventual supervisor ordering; no old service-real
    # command-line observer may run concurrently with the positional adminsecret.
    for name,sha in inputs['outer_metadata_only_sources'].items():
        p=H/name;assert digest(p)==sha
        tree=ast.parse(p.read_text())
        for node in ast.walk(tree):
            if isinstance(node,ast.Constant)and isinstance(node.value,str):
                assert not any(word in node.value for word in ['cmdline','environ'])
    host_pid_namespace=os.environ['JOINT_HOST_PID_NAMESPACE']
    assert re.fullmatch(r'pid:\[[0-9]+\]',host_pid_namespace)
    # Constant substring screening is a narrow check, not a proof against
    # computed paths, string concatenation, imported aliases or external code.
    # Exact pinned sources and transitive callers still require manual review.
    assert os.readlink('/proc/self/ns/pid')!=host_pid_namespace
    allowed=set();pid=os.getpid()
    while pid:
        assert pid not in allowed;allowed.add(pid)
        raw=(pathlib.Path('/proc')/str(pid)/'stat').read_text();f=raw[raw.rindex(')')+2:].split();pid=int(f[1])
    current={int(p.name)for p in pathlib.Path('/proc').iterdir()if p.name.isdigit()}
    assert current<=allowed,'Admin exclusive window contains another process/observer'
    return {'exclusive_ancestor_census':True,'visible_process_count':len(current),'metadata_only_source_pins':True,'generic_cmdline_observer_started':False}

def main():
    global entry_stage
    entry_stage='ENTRY_ROLE_LIMITS'
    assert os.getuid()==os.geteuid()==os.getgid()==os.getegid()==1000
    assert resource.getrlimit(resource.RLIMIT_NOFILE)==(40000,40000)
    assert resource.getrlimit(resource.RLIMIT_FSIZE)==(64*1024**2,64*1024**2)
    entry_stage='ENTRY_INPUT_CONTRACT'
    inputs=json.loads((H/'joint-entry-inputs.json').read_text())
    assert inputs['source_head']=='7854560d1f5e3a4256e2ee62a41840432dee8cb9'
    assert digest(pathlib.Path('/tmp/work/services/redisClient.ts'))=='dc072d97db8dc4b09d2cc9bbcdc227add162f13bc72ebfad2a6d1ba71602893f'
    # Known owner gates are checked before creating credentials/spawning anything.
    assert inputs['experiment_scope']=='FUNCTIONAL_PARTIAL_REDIS_LIFECYCLE_INCOMPLETE'
    assert inputs['redis_main_native_gate']=='UNSUPPORTED_PUBLIC_JOIN_API_RETAIN_GLOBAL_INCOMPLETE'
    # Source gate is a necessary technical precondition, never user/parent
    # execution authority. A separate exact authenticated GO is still required.
    entry_stage='ENTRY_SOURCE_REVIEW_GATE'
    assert inputs['operational_state']==ENTRY_SOURCE_STATE_REQUIRED,'NOT_STARTED_JOINT_REVIEW_OPEN'
    entry_stage='ENTRY_SOURCE_PINS'
    for name,sha in inputs['entry_sources'].items():assert digest(H/name)==sha
    entry_stage='ENTRY_NATIVE_ADMISSION'
    admitted=json.loads((H/'neo4j-admission-inputs.json').read_text());jdk=pathlib.Path(admitted['jdk']['home'])
    for name,sha in admitted['jdk']['files'].items():assert digest(jdk/name)==sha
    for src,dst in [('neo4j-auth.conf','neo4j.conf'),('neo4j-boot-logs.xml','server-logs.xml'),('neo4j-boot-user-logs.xml','user-logs.xml')]:assert digest(H/src)==digest(R/'conf'/dst)
    for p in [jdk,A]:assert os.statvfs(p).f_flag&os.ST_RDONLY
    deadline=min(time.monotonic()+550,float(os.environ['JOINT_PHASE_DEADLINE'])-15)
    # Existing isolated namespace, no new probe or external request.
    interfaces=[line.split(':',1)[0].strip()for line in pathlib.Path('/proc/net/dev').read_text().splitlines()[2:]if line.strip()]
    assert interfaces==['lo']
    routes4=[line.split()for line in pathlib.Path('/proc/net/route').read_text().splitlines()[1:]if line.strip()]
    routes6=[line.split()for line in pathlib.Path('/proc/net/ipv6_route').read_text().splitlines()if line.strip()]
    assert all(len(row)==11 and row[0]=='lo'and row[2]=='00000000'for row in routes4)
    assert all(len(row)==10 and row[-1]=='lo'and row[4]=='0'*32 for row in routes6)
    entry_stage='ENTRY_EXCLUSIVE_ADMIN_WINDOW'
    before=assert_exclusive_admin_window(inputs)
    before['network_scope']={'interfaces':['lo'],'ipv4_route_count':len(routes4),'ipv6_route_count':len(routes6),'external_route_absent_observed':True}
    entry_stage='ENTRY_SECRET_ADMIN'
    values={key:bytearray(secrets.token_urlsafe(36),'ascii')for key in ['neo4j','api','login']}
    admin=initialize_once(values['neo4j'],min(deadline,time.monotonic()+35))
    assert_exclusive_admin_window(inputs)
    # No rawoutput/argv/envstore/credentialhash is serialized in this receipt.
    payload=json.dumps({key:bytes(value).decode('ascii')for key,value in values.items()},separators=(',',':')).encode()
    assert len(payload)<1024
    # This Python bytes payload cannot be securely zeroed; execve replaces its
    # process image after transfer. Not a claim of forensic memory erasure.
    # Preserve service role at the exact fork, then irreversibly lower observer.
    entry_stage='ENTRY_ORIGINAL_FORK_TRANSFER'
    gate_r,gate_w=os.pipe();out_r,out_w=os.pipe();secret_r,secret_w=os.pipe()
    os.write(secret_w,payload);os.close(secret_w)
    child=os.fork()
    if child==0:
        try:
            os.close(gate_w);os.close(out_r);os.close(secret_r);os.setsid()
            os.dup2(out_w,1);os.dup2(out_w,2);os.close(out_w)
            assert os.read(gate_r,1)==b'G';os.close(gate_r)
            assert resource.getrlimit(resource.RLIMIT_NOFILE)==(40000,40000)
            env={'PATH':'/usr/bin:/bin','JAVA_HOME':str(jdk),'JAVACMD':str(jdk/'bin/java'),'NEO4J_HOME':str(A),'NEO4J_CONF':str(R/'conf'),'HOME':str(R/'home'),'TMPDIR':str(R/'java-tmp'),'LANG':'C.UTF-8','NEO4J_CONFIG_FILE_CHARSET':'utf8'}
            os.chdir(R);os.execve(str(A/'bin/neo4j'),[str(A/'bin/neo4j'),'console'],env)
        except BaseException:os._exit(1) # preexec failure only, never lifecycle proof
    os.close(gate_r);os.close(out_w)
    resource.setrlimit(resource.RLIMIT_NOFILE,(256,256))
    for fd in [gate_w,out_r,secret_r]:os.set_inheritable(fd,True)
    # Admin is naturally reaped/groupempty before supervisor program exists.
    # It never receives admin argv and has no generic cmdline-reading code.
    receipt={'admin':admin,'exclusive_window':before,'original_server_pid':child,'secret_fd':secret_r,'gate_fd':gate_w,'console_fd':out_r,'deadline':deadline}
    control_r,control_w=os.pipe();os.write(control_w,json.dumps(receipt,separators=(',',':')).encode());os.close(control_w);os.set_inheritable(control_r,True)
    env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','JOINT_CONTROL_FD':str(control_r)}
    for value in values.values():value[:]=b'\0'*len(value)
    entry_stage='ENTRY_SUPERVISOR_EXEC'
    os.execve('/usr/bin/python3',['/usr/bin/python3',str(H/'joint_composite_supervisor.py')],env)

def entry_failure_receipt(exc):
    # No exception message, hash, source line, argv, secret or env values.
    # Only failed pre-composite owner writes this path; supervisor owns its
    # later cause receipt after successful exec. Failure cannot imply cleanup.
    from evidence_policy import configure,emit_text
    configure(pathlib.Path('/tmp/evidence'),'checks')
    allowed={'AssertionError','RuntimeError','TimeoutError','OSError','FileNotFoundError','PermissionError','ValueError','BrokenPipeError','KeyError','TypeError','SystemExit','KeyboardInterrupt'}
    value={'schema':'NEO4J_BOOT_EMERGENCY_V1','status':'INCOMPLETE','original_failure':{'stage':entry_stage,'error_type':type(exc).__name__ if type(exc).__name__ in allowed else 'OTHER_EXCEPTION'},'last_stage':entry_stage,'envelope_state':'NOT_WRITTEN','raw_complete':False,'cleanup':{'state':'UNVERIFIED_OUTER_SCOPE_RECEIPT_REQUIRED'}}
    emit_text(pathlib.Path('/tmp/evidence/neo4j-boot-emergency.json'),json.dumps(value,separators=(',',':'))+'\n')

if __name__=='__main__':
    try:main()
    except BaseException as exc:
        try:entry_failure_receipt(exc)
        except BaseException:
            # Fixed nonsecret diagnostic survives receipt failure when pipe works.
            try:os.write(2,b'JOINT_ENTRY_CAUSE_RECEIPT_UNAVAILABLE\n')
            except BaseException:pass
        raise

