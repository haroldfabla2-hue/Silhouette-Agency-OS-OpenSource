#!/usr/bin/env python3
"""Cold provider owner baseline proposal, NOT RUN. No Redis provision/global shutdown.
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
                actions.append({'signal':sig.name,'sent':True,'at_monotonic':time.monotonic()})
            except ProcessLookupError:
                actions.append({'signal':sig.name,'sent':False,'reason':'ESRCH'})
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

def run_probe(root, evidence, work):
    evidence.mkdir()
    (evidence / 'work-path.txt').write_text(str(work))
    env = {'PATH': os.environ['PATH'], 'HOME': str(work / 'home'), 'NODE_ENV': 'test',
           'SILHOUETTE_PROVIDERS': 'off', 'SILHOUETTE_BOOT_MODE': 'acceptance',
           'SILHOUETTE_DB_PATH': str(work / 'db/fixture.sqlite'),
           'SILHOUETTE_LANCEDB_PATH': str(work / 'db/fixture.lancedb'),
           'FIXTURE_PURPOSE': 'provider-owner-baseline'}
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
        if not line.startswith('PROVIDER_HEALTH_FIXTURE:'):
            return
        event = json.loads(line[len('PROVIDER_HEALTH_FIXTURE:'):])
        kind = event.get('event')
        if kind not in {'CALLS_RETURNED','BEFORE_EXIT'} or any(e['event']==kind for e in events) or set(event)!={'event','pid'}:
            raise RuntimeError('Unknown/duplicate/malformed event marker')
        if kind=='CALLS_RETURNED': assertion_at=time.monotonic()
        events.append(event)

    try:
        child = subprocess.Popen(['node', '--import', str(root / 'node_modules/tsx/dist/loader.mjs'),
            str(root / 'tests/real-process/provider-health/child.mts')],
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
        if child.returncode!=0 or [e['event'] for e in events]!=['CALLS_RETURNED','BEFORE_EXIT'] or any(e['pid']!=child.pid for e in events):
            raise RuntimeError('Nonzero exit or missing/out-of-order actual state markers')
        initial=json.loads((work/'provider-CALLS_RETURNED.json').read_text())
        final=json.loads((work/'provider-BEFORE_EXIT.json').read_text())
        for proof in [initial,final]:
            if proof['pid']!=child.pid or len(proof['returns'])!=8 or any(row!={'index':i,'type':'undefined','thenable':False} for i,row in enumerate(proof['returns'])):
                raise RuntimeError('Baseline return contract changed')
            if proof['health']['gemini:model-a']['consecutiveFailures']!=8 or proof['health']['gemini:model-a']['status']!='SUSPENDED':
                raise RuntimeError('Health state contract mismatch')
        if any(e['state']!='COMPLETE' for e in final['effects']) or final['snapshots']:
            raise RuntimeError('Real retained unresolved effect/snapshot state at observed beforeExit')
        result={'status':'PASS_BASELINE_OBSERVATION_ONLY','pid':child.pid,'leader_reaped':True,'group':'ESRCH','pipe_eof':eof,'events':events,
            'scope':'cold provider import plus eight synchronous reportFailure calls, no Vitest/RPC causality, no persistence ownership claim'}
        (evidence/'result.json').write_text(json.dumps(result,indent=2))
        return result
    except BaseException as error:
        failure = str(error)
        raise
    finally:
        before={'leader_returncode':child.poll() if child else None,'leader_reaped':child is not None and child.returncode is not None,
            'group':group_state(child.pid) if child else 'NOT_STARTED','pipe_eof_observed':eof}
        capture_errors=[]
        def capture(stage):
            records=[]
            for rel in ['provider-CALLS_RETURNED.json','provider-BEFORE_EXIT.json','data/memory_snapshot.json']:
                source=work/rel
                try:
                    if not source.exists():
                        records.append({'path':rel,'exists':False})
                        continue
                    data=source.read_bytes()
                    if len(data)>262144: raise RuntimeError('Evidence source above256KiB')
                    target=evidence/stage/rel
                    target.parent.mkdir(parents=True,exist_ok=True)
                    target.write_bytes(data)
                    records.append({'path':rel,'exists':True,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
                except BaseException as error:
                    capture_errors.append({'stage':stage,'path':rel,'error':str(error)})
            return records
        pre=capture('before-cleanup')
        safe=child is None or (child.poll() is not None and group_state(child.pid)=='ESRCH')
        if child and not safe:
            failure=failure or 'LIVE/UNKNOWN cleanup group'
            safe=stop_and_reap(child,cleanup_actions)
        post=capture('after-cleanup') if safe else None
        after={'leader_returncode':child.poll() if child else None,'leader_reaped':child is not None and child.returncode is not None,
            'group':group_state(child.pid) if child else 'NOT_STARTED','pipe_eof_observed':eof}
        selector.close()
        if child and child.stdout:child.stdout.close()
        (evidence/'capture.json').write_text(json.dumps({'before':before,'after':after,'signals':cleanup_actions,
            'before_files':pre,'after_files':post,'capture_errors':capture_errors},indent=2))
        if capture_errors:failure=failure or 'Incomplete evidence capture'
        if failure:
            (evidence/'failure.json').write_text(json.dumps({'status':'FAIL','error':failure,'retained_work':not safe,'work':str(work),'events':events},indent=2))
        if not safe:(evidence/'RETAINED_WORK.txt').write_text(str(work))
        if capture_errors:raise RuntimeError('Incomplete evidence capture, no PASS')

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
work=pathlib.Path(tempfile.mkdtemp(prefix='provider-owner-'))
(work/'FIXTURE_ONLY').write_text('PROVIDER_HEALTH_ONLY')
try:
    source = root / 'db/migrations/sqlite'
    target = work / 'db/migrations/sqlite'
    target.mkdir(parents=True)
    assets = []
    for file in sorted(source.iterdir()):
        if not file.is_file() or file.is_symlink(): raise RuntimeError('Unexpected migration asset')
        data = file.read_bytes()
        (target/file.name).write_bytes(data)
        if (target/file.name).read_bytes()!=data: raise RuntimeError('Migration copy mismatch')
        assets.append({'path': str(file.relative_to(root)), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes':len(data)})
    if len(assets)!=8: raise RuntimeError('Migration asset inventory changed')
    (evidence/'migration-assets-before-import.json').write_text(json.dumps(assets,indent=2))
    (work/'data').mkdir()
    (work/'data/memory_snapshot.json').write_text(json.dumps({'working':[],'ultraShort':[],'short':[]}))
    run_probe(root,evidence/'provider',work)
except BaseException as error:
    outer=[]
    for rel in ['provider-CALLS_RETURNED.json','provider-BEFORE_EXIT.json','data/memory_snapshot.json']:
        source=work/rel
        try:
            if not source.exists():
                outer.append({'path':rel,'exists':False})
                continue
            data=source.read_bytes()
            if len(data)>262144:raise RuntimeError('Outer evidence source above256KiB')
            target=evidence/'outer-failure'/rel
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(data)
            outer.append({'path':rel,'exists':True,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        except BaseException as capture:
            outer.append({'path':rel,'capture_error':str(capture)})
    (evidence/'effect-failure.json').write_text(json.dumps({'status':'FAIL','error':str(error),'files':outer},indent=2))
    raise
finally:
    if list(evidence.rglob('RETAINED_WORK.txt')):
        (evidence/'RETAINED_WORK.txt').write_text(str(work))
    else:
        shutil.rmtree(work)
