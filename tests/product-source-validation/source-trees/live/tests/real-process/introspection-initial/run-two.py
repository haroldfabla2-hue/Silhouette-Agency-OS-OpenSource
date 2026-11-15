#!/usr/bin/env python3
"""Exact two-case wrapper proposal, NOT RUN. No Redis provision/global shutdown.
Uses reviewed nonblocking budget/reap/POSIX-group/EOF behavior. Child runtime
requires static-pass proof and actual isolated network boundary from run-runtime.sh.
"""
import argparse, hashlib, json, os, pathlib, selectors, shutil, signal, subprocess, tempfile, time
CASES = {'sqlite-empty': 14, 'sqlite-json-corrupt': 16}

def group_state(pgid):
    try:
        os.killpg(pgid, 0)
        return 'LIVE'
    except ProcessLookupError:
        return 'ESRCH'
    except OSError:
        return 'UNKNOWN'

def stop_and_reap(child):
    for sig, budget in [(signal.SIGTERM, 2.0), (signal.SIGKILL, 2.0)]:
        if group_state(child.pid) != 'ESRCH':
            try:
                os.killpg(child.pid, sig)
            except ProcessLookupError:
                pass
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

def run_case(root, evidence, case_name):
    evidence.mkdir()
    work = pathlib.Path(tempfile.mkdtemp(prefix='introspection-initial-'))
    (evidence / 'work-path.txt').write_text(str(work))
    (work / 'FIXTURE_ONLY').write_text('INTROSPECTION_INITIAL_ONLY')
    env = {'PATH': os.environ['PATH'], 'HOME': str(work / 'home'), 'NODE_ENV': 'test',
           'SILHOUETTE_PROVIDERS': 'off', 'SILHOUETTE_BOOT_MODE': 'acceptance',
           'SILHOUETTE_DB_PATH': str(work / 'db/fixture.sqlite'),
           'SILHOUETTE_LANCEDB_PATH': str(work / 'db/fixture.lancedb'),
           'FIXTURE_CANDIDATE_ROOT': str(root), 'FIXTURE_CASE': case_name}
    events = []
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
        if not line.startswith('INITIAL_ONLY_FIXTURE:'):
            return
        event = json.loads(line[len('INITIAL_ONLY_FIXTURE:'):])
        if event.get('caseName') != case_name:
            raise RuntimeError('Wrong case marker')
        kind = event.get('event')
        if kind not in {'ASSERTIONS_DONE', 'BODY_DONE'} or any(e['event'] == kind for e in events):
            raise RuntimeError('Unknown/duplicate marker')
        expected_keys = {'caseName', 'event', 'assertionCount', 'statuses'} if kind == 'ASSERTIONS_DONE' else {'caseName', 'event'}
        if set(event) != expected_keys:
            raise RuntimeError('Unexpected marker fields')
        if kind == 'ASSERTIONS_DONE':
            assertion_at = time.monotonic()
        events.append(event)

    try:
        child = subprocess.Popen(['node', '--import', str(root / 'node_modules/tsx/dist/loader.mjs'),
            str(root / 'tests/real-process/introspection-initial/initial-status-consumer.mts')],
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
        if child.returncode != 0 or [e['event'] for e in events] != ['ASSERTIONS_DONE', 'BODY_DONE']:
            raise RuntimeError('Nonzero exit or missing/out-of-order markers')
        done = events[0]
        if type(done['assertionCount']) is not int or done['assertionCount'] != CASES[case_name]:
            raise RuntimeError('Wrong explicit assertion count')
        status = done['statuses']
        if status['concept']['state'] != 'FAILED' or status['concept']['coreOutcome'] != 'FAILED' or not status['concept'].get('error'):
            raise RuntimeError('Wrong initial concept/core outcome')
        if status['goals']['state'] != ('COMPLETE' if case_name == 'sqlite-empty' else 'FAILED') or 'coreOutcome' in status['goals']:
            raise RuntimeError('Wrong independent SQLite initial status')
        if case_name == 'sqlite-json-corrupt' and not status['goals'].get('error'):
            raise RuntimeError('Missing actual goal-load error')
        if (work / 'data/memory_snapshot.json').read_text() != '{broken':
            raise RuntimeError('Corrupt snapshot changed')
        if child.poll() is None or group_state(child.pid) != 'ESRCH':
            raise RuntimeError('Group not ESRCH before PASS')
        (evidence / 'result.json').write_text(json.dumps({'status': 'PASS', 'case': case_name,
            'leader_reaped': True, 'group': 'ESRCH', 'pipe_eof': eof, 'events': events}, indent=2))
    except BaseException as error:
        failure = str(error)
        raise
    finally:
        safe = child is None or (child.poll() is not None and group_state(child.pid) == 'ESRCH')
        if child and not safe:
            failure = failure or 'LIVE/UNKNOWN cleanup group'
            safe = stop_and_reap(child)
        selector.close()
        if child and child.stdout:
            child.stdout.close()
        if failure:
            (evidence / 'failure.json').write_text(json.dumps({'status': 'FAIL', 'error': failure,
                'retained_work': not safe, 'work': str(work), 'events': events}, indent=2))
        if safe:
            shutil.rmtree(work)
        else:
            (evidence / 'RETAINED_WORK.txt').write_text(str(work))

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
for case in CASES:
    run_case(root, evidence / case, case)
