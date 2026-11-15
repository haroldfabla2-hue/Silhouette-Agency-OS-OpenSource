"""Source candidate only. Fixed offline vendor admin before the sole server boot.
No CLI entrypoint and no invocation on import. Returns sanitized evidence only.
Caller owns secret lifetime, private namespace/cgroup and final scratch removal.
Never attach raw output, argv, environment, auth files or their hashes to evidence.
"""
import os
import pathlib
import resource
import selectors
import signal
import subprocess
import time

ASSET = pathlib.Path('/tmp/work/node_modules/.silhouette-native-neo4j/neo4j-community-5.26.32')
RUNTIME = pathlib.Path('/tmp/neo4j-runtime')
JAVA = pathlib.Path('/usr/lib/jvm/temurin-21-jdk-amd64/bin/java')

class AdminInitializationIncomplete(RuntimeError):
    def __init__(self, evidence):
        # Do not retain the child Popen/argv/error object in the public error.
        super().__init__('Offline admin initialization incomplete; service boot forbidden')
        self.evidence = evidence

def _identity(pid):
    p = pathlib.Path('/proc') / str(pid)
    raw = (p/'stat').read_text(); fields = raw[raw.rindex(')')+2:].split()
    return {'pid':pid,'ppid':int(fields[1]),'pgid':int(fields[2]),'start_ticks':int(fields[19]),'state':fields[0]}

def _listener_set():
    # All TCP LISTEN endpoints in this network namespace, not only vendor
    # connector ports. Socket inode preserves identity if a port is replaced.
    # UNIX listeners represented by SO_ACCEPTCON; path names never returned.
    found=set()
    for family in ['tcp','tcp6']:
        for row in (pathlib.Path('/proc/net')/family).read_text().splitlines()[1:]:
            f=row.split()
            if f[3]=='0A':found.add((family,f[1],f[9]))
    for row in pathlib.Path('/proc/net/unix').read_text().splitlines()[1:]:
        f=row.split()
        if int(f[3],16)&0x10000:found.add(('unix-listen',f[4],f[6]))
    return frozenset(found)

def initialize_once(secret, absolute_deadline):
    """secret is a bytearray, never a user/vault credential. One exact attempt.
    Pinned asset/JDK/config hashes must already be admitted by the entry owner.
    Admin observation occurs in this function, before generic process observers
    may read/export any command lines. It receives the same role40000 limit.
    """
    ev = {'operation':'OFFLINE_DBMS_SET_INITIAL_PASSWORD_ONE_ATTEMPT',
          'status':'INCOMPLETE','secret_exported':False,'output_policy':'BYTE_COUNTS_AND_IN_MEMORY_MATCH_FLAGS_ONLY',
          'identity_samples':[],'output_bytes':0,'output_eof':False,'returncode':None,
          'forced_signals':[],'group_empty':False,'ports_unopened':None,
          'listener_coverage':'NETNS_ALL_TCP4_TCP6_LISTEN_AND_UNIX_SO_ACCEPTCON',
          'listener_samples':0,'new_listener_count':0,
          'listener_evidence':'SAMPLED_ABSENCE_ONLY_MAY_MISS_OPEN_CLOSE_BETWEEN_SAMPLES',
          'shared_boundary':'SAME_RUNTIME_CGROUP_AND_NETNS','budget_seconds':35}
    original = None; child = None; sel = selectors.DefaultSelector(); carry = bytearray(); failure = False
    total_end = min(absolute_deadline, time.monotonic()+35)
    end = total_end-6 # reserve TERM2/KILL2/privateEOF2 within35s
    assert isinstance(secret,bytearray) and 32 <= len(secret) <= 128
    assert all(c in b'0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-' for c in secret)
    assert os.getuid()==os.geteuid()==os.getgid()==os.getegid()==1000
    assert resource.getrlimit(resource.RLIMIT_NOFILE)==(40000,40000)
    self_status = pathlib.Path('/proc/self/status').read_text()
    for k in ['CapEff:','CapPrm:','CapAmb:']:
        assert int(next(x.split()[1]for x in self_status.splitlines()if x.startswith(k)),16)==0
    for d in ['conf','data','home','run','logs','transactions','java-tmp']:
        p=RUNTIME/d
        assert p.is_dir() and not p.is_symlink()
    # Refuse an old authstore or database. No credential update/retry/reset.
    assert not (RUNTIME/'data/dbms/auth.ini').exists()
    assert not (RUNTIME/'data/dbms/auth').exists()
    assert not (RUNTIME/'data/databases').exists()
    env={'PATH':'/usr/bin:/bin','JAVA_HOME':str(JAVA.parent.parent),'JAVACMD':str(JAVA),
         'NEO4J_HOME':str(ASSET),'NEO4J_CONF':str(RUNTIME/'conf'),'HOME':str(RUNTIME/'home'),
         'TMPDIR':str(RUNTIME/'java-tmp'),'LANG':'C.UTF-8','NEO4J_CONFIG_FILE_CHARSET':'utf8'}
    before_listeners=_listener_set();seen_new_listeners=set()
    ev['baseline_listener_count']=len(before_listeners)
    try:
        # Positional password is vendor syntax, not an invented stdin flag.
        # No shell, tool-level argv logging, preexec privilege or arbitrary args.
        child=subprocess.Popen([str(ASSET/'bin/neo4j-admin'),'dbms','set-initial-password',
                                '--require-password-change=false',bytes(secret).decode('ascii')],
                               cwd=RUNTIME,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT,start_new_session=True,close_fds=True)
        # Popen retains args only in this private helper. Remove our copy early;
        # this is not a claim that Python/JVM memory is securely zeroed.
        child.args=None
        os.set_blocking(child.stdout.fileno(),False);sel.register(child.stdout,selectors.EVENT_READ)
        original=_identity(child.pid);ev['original_identity']=original
        next_sample=0.0; saw_admin=False; saw_community=False; output_secret=False; success_marker=False
        while True:
            now=time.monotonic()
            if now>=end:failure=True;ev['failure_stage']='ADMIN_DEADLINE';break
            if now>=next_sample:
                next_sample=now+.02; rows=[]
                current_listeners=_listener_set();ev['listener_samples']+=1
                seen_new_listeners.update(current_listeners-before_listeners)
                if seen_new_listeners:
                    failure=True;ev['failure_stage']='UNEXPECTED_NEW_LISTENER'
                for p in pathlib.Path('/proc').iterdir():
                    if not p.name.isdigit():continue
                    try:
                        row=_identity(int(p.name))
                        if row['pgid']!=child.pid:continue
                        rows.append(row)
                        if row['state']=='Z':continue
                        # Tokens exist only in memory. Never return or hash them.
                        tokens=(p/'cmdline').read_bytes().split(b'\x00')
                        is_admin=b'org.neo4j.server.startup.Neo4jAdminBoot' in tokens
                        is_community=b'org.neo4j.server.CommunityEntryPoint' in tokens
                        saw_community |= is_community
                        if is_admin:
                            assert (p/'exe').resolve()==JAVA
                            status=(p/'status').read_text()
                            assert next(x.split()[1:]for x in status.splitlines()if x.startswith('Uid:'))==['1000']*4
                            for k in ['CapEff:','CapPrm:','CapAmb:']:
                                assert int(next(x.split()[1]for x in status.splitlines()if x.startswith(k)),16)==0
                            assert (p/'cgroup').read_text()==pathlib.Path('/proc/self/cgroup').read_text()
                            assert os.readlink(p/'ns/net')==os.readlink('/proc/self/ns/net')
                            lim=next(x for x in (p/'limits').read_text().splitlines()if x.startswith('Max open files'))
                            assert lim.split()[3:5]==['40000','40000']
                            saw_admin=True
                            proof={**row,'pinned_java':True,'admin_main_class_exact':True,'uid':1000,'caps_zero':True,'same_cgroup_netns':True,'nofile':[40000,40000]}
                            if len(ev['identity_samples'])<4:ev['identity_samples'].append(proof)
                        tokens.clear()
                    except FileNotFoundError:
                        continue
                assert len(rows)<=256
            for key,_ in sel.select(.01):
                b=os.read(key.fd,8192)
                if not b:
                    ev['output_eof']=True;sel.unregister(key.fd);continue
                ev['output_bytes']+=len(b)
                carry.extend(b)
                output_secret |= bytes(secret) in carry
                success_marker |= b"Changed password for user 'neo4j'" in carry
                # Keep overlap only to detect a split secret/constant marker.
                del carry[:-256]
                if ev['output_bytes']>65536:failure=True;ev['failure_stage']='ADMIN_OUTPUT_CAP'
            rc=child.poll()
            if failure or (rc is not None and ev['output_eof']):break
        if failure and child.poll()is None:
            # Cleanup only, any signal invalidates acceptance. No service boot.
            if _identity(child.pid)['start_ticks']==original['start_ticks']:
                os.kill(child.pid,signal.SIGTERM);ev['forced_signals'].append('TERM_ORIGINAL_ADMIN')
            try:child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid,signal.SIGKILL);ev['forced_signals'].append('KILL_ADMIN_GROUP');child.wait(timeout=2)
        ev['returncode']=child.poll()
        ev['admin_identity_observed']=saw_admin;ev['unexpected_server_main_observed']=saw_community
        ev['credential_seen_in_private_output']=output_secret;ev['vendor_success_marker_seen']=success_marker
        # Reap first, then require all descendants naturally absent. No other
        # native child process may be silently tolerated after this admin step.
        remaining=[]
        for p in pathlib.Path('/proc').iterdir():
            if not p.name.isdigit():continue
            try:
                row=_identity(int(p.name))
                if row['pgid']==child.pid:remaining.append(row)
            except FileNotFoundError:pass
        ev['group_empty']=not remaining;ev['remaining_identity_count']=len(remaining)
        # No auth step may create a listener, even on an unrelated port or
        # after the last Java identity sample. Compare exact baseline identities.
        after_listeners=_listener_set();seen_new_listeners.update(after_listeners-before_listeners)
        ev['after_listener_count']=len(after_listeners);ev['new_listener_count']=len(seen_new_listeners)
        ev['ports_unopened']=not seen_new_listeners
        auth=RUNTIME/'data/dbms/auth.ini'
        ev['fresh_auth_store_present']=auth.is_file() and not auth.is_symlink()
        if failure or ev['returncode']!=0 or not ev['output_eof'] or not saw_admin or saw_community or output_secret or not success_marker or remaining or not ev['fresh_auth_store_present'] or not ev['ports_unopened']:
            raise AdminInitializationIncomplete(ev)
        ev['status']='ADMIN_LOCAL_PROCESS_PASS_PENDING_REAL_SDK_AUTH_CHECKS'
        return ev
    except AdminInitializationIncomplete:
        raise
    except BaseException:
        # Intentionally not serializing child exception/argv/secret or traceback.
        ev['failure_stage']=ev.get('failure_stage','ADMIN_ASSERTION_OR_OBSERVER_FAILURE')
        raise AdminInitializationIncomplete(ev) from None
    finally:
        # A fast-exited admin leader can leave children in its original group.
        # This is a failed cleanup, not a boot permit; finish that scope too.
        if child and original:
            try:
                residual=[]
                for pp in pathlib.Path('/proc').iterdir():
                    if not pp.name.isdigit():continue
                    try:
                        row=_identity(int(pp.name))
                        if row['pgid']==child.pid and row['state']!='Z':residual.append(row)
                    except FileNotFoundError:pass
                if residual and child.poll() is not None:
                    os.killpg(child.pid,signal.SIGTERM);ev['forced_signals'].append('TERM_ORPHAN_ADMIN_GROUP')
                    time.sleep(.05)
                    try:os.killpg(child.pid,signal.SIGKILL);ev['forced_signals'].append('KILL_ORPHAN_ADMIN_GROUP')
                    except ProcessLookupError:pass
                    ev['cleanup_incomplete']=True
            except BaseException:ev['cleanup_incomplete']=True
        # Bounded cleanup after ANY assertion/observer/output failure, not just
        # the ordinary deadline branch. A remaining child is never called PASS.
        if child and child.poll() is None:
            try:
                if original and _identity(child.pid)['start_ticks']==original['start_ticks']:
                    os.killpg(child.pid,signal.SIGTERM);ev['forced_signals'].append('TERM_ADMIN_GROUP_FINALLY')
                try: child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    if original and _identity(child.pid)['start_ticks']==original['start_ticks']:
                        os.killpg(child.pid,signal.SIGKILL);ev['forced_signals'].append('KILL_ADMIN_GROUP_FINALLY')
                    child.wait(timeout=2)
            except BaseException:
                ev['cleanup_incomplete']=True
        if child and child.stdout:
            # Finish draining privately, bounded, without retaining or hashing
            # credential-bearing output. Supervisor still owns outer deadline.
            until=min(total_end,time.monotonic()+2)
            try:
                while not ev['output_eof'] and time.monotonic()<until:
                    for key,_ in sel.select(.01):
                        b=os.read(key.fd,8192)
                        if not b:
                            ev['output_eof']=True;sel.unregister(key.fd)
                        else:ev['output_bytes']+=len(b)
            except BaseException:ev['cleanup_incomplete']=True
            child.stdout.close()
        carry[:]=b'\x00'*len(carry);carry.clear();sel.close()
        if ev.get('cleanup_incomplete') or ev['forced_signals']:
            ev['status']='FAIL_ADMIN_CLEANUP_OR_FORCED_SIGNAL'
            raise AdminInitializationIncomplete(ev) from None
