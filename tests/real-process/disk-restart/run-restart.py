#!/usr/bin/env python3
"""Two sequential disk-restart phases proposal, NOT RUN. No Redis provision/global shutdown.
Uses reviewed nonblocking budget/reap/POSIX-group/EOF behavior. Child runtime
requires static-pass proof and actual isolated network boundary from run-runtime.sh.
"""
import argparse, hashlib, json, os, pathlib, selectors, shutil, signal, subprocess, tempfile, time

def group_state(pgid):
    try:
        os.killpg(pgid, 0)
        return 'LIVE'
    except ProcessLookupError:
        return 'ESRCH'
    except OSError:
        return 'UNKNOWN'

def stop_and_reap(child, actions):
    for sig, budget in [(signal.SIGTERM, 2.0), (signal.SIGKILL, 2.0)]:
        if group_state(child.pid) != 'ESRCH':
            try:
                os.killpg(child.pid, sig)
                actions.append({'signal': sig.name, 'sent': True, 'at_monotonic': time.monotonic()})
            except ProcessLookupError:
                actions.append({'signal': sig.name, 'sent': False, 'reason': 'ESRCH'})
            except OSError:
                return False
        end = time.monotonic() + budget
        while time.monotonic() < end:
            child.poll()
            if child.returncode is not None and group_state(child.pid) == 'ESRCH':
                return True
            time.sleep(.025)
    return child.poll() is not None and group_state(child.pid) == 'ESRCH'

def verify_trial_network(parent_namespace):
    # Mechanical state of this concrete --unshare-net trial, not CI/provider OFF.
    current = os.readlink('/proc/self/ns/net')
    if current == parent_namespace or not parent_namespace.startswith('net:['):
        raise RuntimeError('BLOCKED: net namespace not separated from launching host')
    links = json.loads(subprocess.run(['ip', '-j', 'link', 'show'], capture_output=True, check=True, timeout=2).stdout)
    if {link['ifname'] for link in links} != {'lo'}:
        raise RuntimeError('BLOCKED: non-loopback network interface')
    for table in ['/proc/net/route', '/proc/net/ipv6_route']:
        lines = pathlib.Path(table).read_text().splitlines()
        for line in lines[1:] if table.endswith('/route') else lines:
            fields = line.split()
            if fields and (fields[0] if table.endswith('/route') else fields[-1]) != 'lo':
                raise RuntimeError('BLOCKED: non-loopback route')
    return {'host_net': parent_namespace, 'trial_net': current, 'interfaces': ['lo'], 'nonloopback_routes': False}

def run_phase(root, evidence, phase, work):
    evidence.mkdir()
    (evidence / 'work-path.txt').write_text(str(work))
    env = {'PATH': os.environ['PATH'], 'HOME': str(work / 'home'), 'NODE_ENV': 'test',
           'SILHOUETTE_PROVIDERS': 'off', 'SILHOUETTE_BOOT_MODE': 'acceptance',
           'SILHOUETTE_DB_PATH': str(work / 'db/fixture.sqlite'),
           'SILHOUETTE_LANCEDB_PATH': str(work / 'db/fixture.lancedb'),
           'FIXTURE_PHASE': phase}
    events = []
    cleanup_actions = []
    assertion_at = None
    exited_at = None
    child = None
    failure = None
    eof = False
    buffer = b''
    selector = selectors.DefaultSelector()
    start = time.monotonic()

    def parse_line(raw):
        nonlocal assertion_at
        line = raw.decode('utf8', errors='strict')
        if not line.startswith('DISK_RESTART_FIXTURE:'):
            return
        event = json.loads(line[len('DISK_RESTART_FIXTURE:'):])
        if event.get('phase') != phase:
            raise RuntimeError('Wrong case marker')
        kind = event.get('event')
        if kind not in {'PREIMPORT_CHECKSUM', 'ASSERTIONS_DONE', 'BODY_DONE'} or any(e['event'] == kind for e in events):
            raise RuntimeError('Unknown/duplicate marker')
        expected_keys = {'phase','event','pid','nodeId','report','initial','receipt'} if kind == 'ASSERTIONS_DONE' else {'phase','event','checksum'} if kind == 'PREIMPORT_CHECKSUM' else {'phase','event'}
        if set(event) != expected_keys:
            raise RuntimeError('Unexpected marker fields')
        if kind == 'ASSERTIONS_DONE':
            assertion_at = time.monotonic()
        events.append(event)

    try:
        child = subprocess.Popen(['node', '--import', str(root / 'node_modules/tsx/dist/loader.mjs'),
            str(root / 'tests/real-process/disk-restart/child.mts')],
            cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        fd = child.stdout.fileno()
        os.set_blocking(fd, False)
        selector.register(fd, selectors.EVENT_READ)
        with (evidence / 'child.log').open('wb') as log:
            while True:
                now = time.monotonic()
                reaped = child.poll() is not None
                if reaped and exited_at is None:
                    exited_at = now
                if now - start > 30 or (assertion_at is not None and now - assertion_at > 5) or (exited_at is not None and now - exited_at > 2):
                    raise RuntimeError('FAIL: assertion/close/pipeEOF deadline')
                for key, _ in selector.select(.05):
                    try:
                        chunk = os.read(key.fd, 65536)
                    except BlockingIOError:
                        continue
                    if chunk == b'':
                        eof = True
                        selector.unregister(key.fd)
                    else:
                        log.write(chunk)
                        log.flush()
                        buffer += chunk
                        if len(buffer) > 1048576:
                            raise RuntimeError('Oversized unterminated log line')
                        while b'\n' in buffer:
                            line, buffer = buffer.split(b'\n', 1)
                            parse_line(line)
                if reaped and eof:
                    if buffer:
                        parse_line(buffer)
                        buffer = b''
                    if group_state(child.pid) != 'ESRCH':
                        raise RuntimeError('Leader reaped but group LIVE/UNKNOWN')
                    break
        expected = ['ASSERTIONS_DONE', 'BODY_DONE'] if phase == 'write' else ['PREIMPORT_CHECKSUM', 'ASSERTIONS_DONE', 'BODY_DONE']
        if child.returncode != 0 or [e['event'] for e in events] != expected:
            raise RuntimeError('Nonzero exit or missing/out-of-order markers')
        done = next(e for e in events if e['event'] == 'ASSERTIONS_DONE')
        if done['pid'] != child.pid or not done['nodeId']:
            raise RuntimeError('Wrong process/node identity')
        report = done['report']
        if report['errors'] or report['outcome'] != 'COMPLETE' or report['source'] != 'DISK' or report['snapshotLoaded'] is not True or report['journalVerified'] != 0 or report['unresolved']:
            raise RuntimeError('Correct disk recovery contract failed')
        if done['initial']['concept']['state'] != 'COMPLETE' or done['initial']['concept']['coreOutcome'] != 'COMPLETE' or done['initial']['goals']['state'] != 'COMPLETE':
            raise RuntimeError('Initial owner success contract failed')
        if done['receipt']['disk'] != 'CONFIRMED':
            raise RuntimeError('No confirmed disk receipt')
        effects = json.loads((work / ('initial-effects-' + phase + '.json')).read_text())
        if effects['state'] != 'COMPLETE' or effects['dreamer']['state'] != 'COMPLETE' or effects['brain']['state'] != 'COMPLETE' or not effects['operationId'] or not effects['nodeId']:
            raise RuntimeError('Initial effect owner did not complete')
        (evidence / 'initial-effects.json').write_text(json.dumps(effects, indent=2))
        if child.poll() is None or group_state(child.pid) != 'ESRCH':
            raise RuntimeError('Group not ESRCH before PASS')
        result = {'status':'PASS','phase':phase,'pid':child.pid,'leader_reaped':True,'group':'ESRCH','pipe_eof':eof,'events':events}
        (evidence / 'result.json').write_text(json.dumps(result, indent=2))
        return result
    except BaseException as error:
        failure = str(error)
        raise
    finally:
        before_cleanup = {'leader_returncode': child.poll() if child else None,
            'leader_reaped': child is not None and child.returncode is not None,
            'group': group_state(child.pid) if child else 'NOT_STARTED', 'pipe_eof': eof}
        # Preserve source bytes before teardown/delete, even when WRITE never exits.
        preserved = []
        capture_errors = []
        for rel in (['data/memory_snapshot.json', 'write-proof.json', 'initial-effects-write.json', 'initial-effects-read.json'] if failure else []):
            source = work / rel
            try:
                if source.exists():
                    data = source.read_bytes()
                    if len(data) > 262144: raise RuntimeError('Evidence source exceeds 256KiB cap')
                    target = evidence / 'preserved-before-cleanup' / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
                    preserved.append({'path': rel, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
            except BaseException as error:
                capture_errors.append({'path': rel, 'error': str(error)})
                failure = failure or 'Evidence capture failure'
        safe = child is None or (child.poll() is not None and group_state(child.pid) == 'ESRCH')
        if child and not safe:
            failure = failure or 'LIVE/UNKNOWN cleanup group'
            safe = stop_and_reap(child, cleanup_actions)
        after_cleanup_files = []
        if safe:
            for rel in (['data/memory_snapshot.json', 'write-proof.json', 'initial-effects-write.json', 'initial-effects-read.json'] if failure else []):
                source = work / rel
                try:
                    if source.exists():
                        data = source.read_bytes()
                        if len(data) > 262144: raise RuntimeError('Evidence source exceeds 256KiB cap')
                        target = evidence / 'preserved-after-cleanup' / rel
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(data)
                        after_cleanup_files.append({'path': rel, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
                except BaseException as error:
                    capture_errors.append({'path': rel, 'stage': 'after_cleanup', 'error': str(error)})
                    failure = failure or 'Evidence capture failure'
        selector.close()
        if child and child.stdout:
            child.stdout.close()
        if failure:
            (evidence / 'failure.json').write_text(json.dumps({'status': 'FAIL', 'error': failure,
                'retained_work': not safe, 'work': str(work), 'events': events,
                'before_cleanup': before_cleanup, 'cleanup_actions': cleanup_actions,
                'after_cleanup': {'leader_returncode': child.poll() if child else None, 'group': group_state(child.pid) if child else 'NOT_STARTED', 'pipe_eof_observed': eof},
                'preserved_before_cleanup': preserved, 'preserved_after_cleanup': after_cleanup_files, 'capture_errors': capture_errors}, indent=2))
        if not safe:
            (evidence / 'RETAINED_WORK.txt').write_text(str(work))
        if capture_errors:
            raise RuntimeError('Evidence capture failed; see failure record')

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True)
parser.add_argument('--evidence', required=True)
parser.add_argument('--static-evidence', required=True)
parser.add_argument('--host-net-namespace', required=True)
args = parser.parse_args()
root = pathlib.Path(args.root).resolve()
static = pathlib.Path(args.static_evidence).resolve()
if (static / 'static-pass.txt').read_text() != 'STATIC_PASS\n':
    raise SystemExit('BLOCKED: static beat not PASS')
for line in (static / 'input-sha256.txt').read_text().splitlines():
    digest, file = line.split(maxsplit=1)
    if hashlib.sha256((root / file).read_bytes()).hexdigest() != digest:
        raise SystemExit('BLOCKED: static input changed')
network = verify_trial_network(args.host_net_namespace)
evidence = pathlib.Path(args.evidence).resolve()
evidence.mkdir(exist_ok=False)
(evidence / 'network-state.json').write_text(json.dumps(network, indent=2))
work = pathlib.Path(tempfile.mkdtemp(prefix='real-disk-restart-'))
(work / 'FIXTURE_ONLY').write_text('DISK_RESTART_ONLY')
def seed_write_fixture():
    # Every migration asset copied intact and hashed before any app import, WRITE only.
    migrations = root / 'db/migrations/sqlite'
    source_files = sorted(migrations.iterdir())
    if not source_files or any(not f.is_file() or f.is_symlink() for f in source_files):
        raise RuntimeError('Unexpected SQL migration asset shape')
    target_migrations = work / 'db/migrations/sqlite'
    target_migrations.mkdir(parents=True)
    asset_hashes = []
    for source in source_files:
        data = source.read_bytes()
        (target_migrations / source.name).write_bytes(data)
        copied = (target_migrations / source.name).read_bytes()
        if data != copied: raise RuntimeError('Copied migration bytes mismatch')
        asset_hashes.append({'path': str(source.relative_to(root)), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
    (evidence / 'migration-assets-before-import.json').write_text(json.dumps(asset_hashes, indent=2))
    (work / 'data').mkdir()
    (work / 'data/memory_snapshot.json').write_text(json.dumps({'working':[],'ultraShort':[],'short':[]}))
try:
    seed_write_fixture()
    write = run_phase(root, evidence / 'write', 'write', work)
    # First process exited naturally/reaped/groupESRCH/EOF before read can start.
    proof = (work / 'write-proof.json').read_bytes()
    (evidence / 'write-proof.json').write_bytes(proof)
    checksum = json.loads(proof)['receipt']['checksum']
    # One stable post-write byte capture; export and SHA use the SAME bytes.
    snapshot_bytes = (work / 'data/memory_snapshot.json').read_bytes()
    if len(snapshot_bytes) > 262144:
        raise RuntimeError('Stable snapshot evidence exceeds 256KiB cap')
    (evidence / 'snapshot-after-write.json').write_bytes(snapshot_bytes)
    if hashlib.sha256(snapshot_bytes).hexdigest() != checksum:
        raise RuntimeError('Snapshot changed after write natural exit, before read')
    if json.loads(proof)['pid'] != write['pid']:
        raise RuntimeError('Write proof PID mismatch')
    read = run_phase(root, evidence / 'read', 'read', work)
    w = next(e for e in write['events'] if e['event']=='ASSERTIONS_DONE')
    r = next(e for e in read['events'] if e['event']=='ASSERTIONS_DONE')
    pre = next(e for e in read['events'] if e['event']=='PREIMPORT_CHECKSUM')
    if pre['checksum'] != checksum:
        raise RuntimeError('Read pre-import checksum mismatch')
    if write['pid']==read['pid'] or w['nodeId']!=r['nodeId'] or w['receipt']!=r['receipt']:
        raise RuntimeError('Cross-process proof mismatch')
    (evidence / 'restart-result.json').write_text(json.dumps({'status':'PASS','phases':['write','read'],'different_pids':True,'same_node_id':w['nodeId'],'write_receipt':w['receipt'],'scope':'direct WORKING disk restart, not normal ingestion or Redis durability'},indent=2))
except BaseException as error:
    # Outer checksum/cross-proof failure can happen outside run_phase.
    # Read existing bytes before safe work removal; never hide capture failure.
    outer_capture = None
    capture_error = None
    try:
        current_snapshot = work / 'data/memory_snapshot.json'
        if current_snapshot.exists():
            data = current_snapshot.read_bytes()
            if len(data) > 262144:
                raise RuntimeError('Outer failure snapshot exceeds 256KiB cap')
            (evidence / 'snapshot-at-outer-failure.json').write_bytes(data)
            outer_capture = {'path': 'snapshot-at-outer-failure.json', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    except BaseException as capture:
        capture_error = str(capture)
    (evidence / 'restart-failure.json').write_text(json.dumps({'status':'FAIL','error':str(error),
        'snapshot_capture':outer_capture,'capture_error':capture_error}))
    raise
finally:
    # Phase supervisor retains work if group unknown. Never delete work still owned.
    if list(evidence.rglob('RETAINED_WORK.txt')):
        (evidence / 'RETAINED_WORK.txt').write_text(str(work))
    else:
        shutil.rmtree(work)

