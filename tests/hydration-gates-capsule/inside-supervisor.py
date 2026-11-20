"""Proposed trusted namespace control v3. NOT executed. Runtime hash gate belongs outside.
Single non-blocking deadline covers root exit AND pipe EOF; acceptance only after
ordered receipt verification with field checks, journal schema/seq/count validation,
stderr-empty, natural exit and namespace orphan scan. PID model: bwrap default
pid-1 reaper, this supervisor is payload pid 2; orphans = any pid not in {1, self}."""
import os,sys,pathlib,json,socket,time,subprocess,resource,selectors,signal,ctypes,errno
W=pathlib.Path('/work');children=[];force=False
EXPECTED_SEQUENCE=['startup-settlement','qa-hydration-gate','expansion-reuse-hydration-gate','expansion-birth-hydration-gate','hydration-gates-capsule']
def drop():
 libc=ctypes.CDLL(None,use_errno=True)
 # Only trusted namespace setup ever has NET_ADMIN; no product evaluates here.
 subprocess.run(['/usr/sbin/ip','link','set','lo','up'],check=True,env={'PATH':'/usr/bin'})
 for name in ['db','data','logs']:(W/name).mkdir(mode=0o700)
 for p in [W,*W.iterdir()]:os.chmod(p,0o700)
 # Single-UID-map model: unprivileged bwrap maps exactly one uid (0 inside
 # the namespace); a setuid(65534) has NO mapping and would fail. The
 # irreversible drop is the capability bounding-set purge + no_new_privs
 # below, executed BEFORE any product code runs.
 for cap in range(64):
  if libc.prctl(24,cap,0,0,0)!=0 and ctypes.get_errno()!=errno.EINVAL:raise OSError('CAP_BSET_DROP')
 assert libc.prctl(8,0,0,0,0)==0
 class Header(ctypes.Structure):_fields_=[('version',ctypes.c_uint32),('pid',ctypes.c_int)]
 class Data(ctypes.Structure):_fields_=[('effective',ctypes.c_uint32),('permitted',ctypes.c_uint32),('inheritable',ctypes.c_uint32)]
 assert libc.capset(ctypes.byref(Header(0x20080522,0)),(Data*2)())==0
 assert libc.prctl(47,4,0,0,0)==0 # PR_CAP_AMBIENT_CLEAR_ALL
 assert libc.prctl(38,1,0,0,0)==0 # no-new-privs
 status=pathlib.Path('/proc/self/status').read_text()
 for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']:
  assert int(next(l.split()[1] for l in status.splitlines() if l.startswith(k+':')),16)==0,k
 assert 'NoNewPrivs:\t1' in status and os.getuid()==os.getgid()==0
 s=socket.socket();s.settimeout(.2)
 try:s.connect(('192.0.2.1',9));raise AssertionError('EXTERNAL_EGRESS')
 except OSError as e:assert e.errno==errno.ENETUNREACH
 finally:s.close()
 assert [l.split(':')[0].strip() for l in pathlib.Path('/proc/net/dev').read_text().splitlines()[2:]]==['lo']
def limits(asbytes):
 def f():
  libc=ctypes.CDLL(None);assert libc.prctl(1,signal.SIGKILL)==0
  if os.getppid()==1:os.kill(os.getpid(),signal.SIGKILL)
  for k,v in [(resource.RLIMIT_AS,asbytes),(resource.RLIMIT_CPU,10),(resource.RLIMIT_FSIZE,1048576),(resource.RLIMIT_NOFILE,256),(resource.RLIMIT_NPROC,32),(resource.RLIMIT_CORE,0)]:resource.setrlimit(k,(v,v))
 return f
def spawn(argv,env,asbytes):
 c=subprocess.Popen(argv,env=env,cwd='/work',stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,preexec_fn=limits(asbytes));children.append(c);return c
def namespace_orphans():
 # bwrap default model: a minimal pid-1 reaper exists (it exits by itself when
 # the namespace empties) and this supervisor is payload pid 2. ANY surviving
 # pid outside {1, self} after root exit is an unowned descendant: FAIL.
 others=[]
 for entry in pathlib.Path('/proc').iterdir():
  if entry.name.isdigit() and int(entry.name) not in (1,os.getpid()):others.append(int(entry.name))
 return others
def main():
 drop();env=json.loads(pathlib.Path('/app/runtime-env.json').read_text());os.environ.clear();os.environ.update(env)
 (W/'silhouette.config.json').write_text(pathlib.Path('/app/fixture-config.json').read_text())
 node=spawn(['/usr/bin/node','--jitless','--no-expose-wasm','--max-old-space-size=512','/app/hydration-gates-entry.cjs'],env,4*1024**3)
 deadline=time.monotonic()+120
 sel=selectors.DefaultSelector();out=bytearray();err=bytearray();total=0
 for pipe,channel in [(node.stdout,'stdout'),(node.stderr,'stderr')]:sel.register(pipe,selectors.EVENT_READ,channel)
 try:
  # One loop, one deadline: run until the root exits AND both pipes reach EOF.
  # A descendant holding a pipe open past root exit exhausts the SAME deadline.
  while node.poll() is None or sel.get_map():
   if time.monotonic()>deadline:raise TimeoutError('OUTER_WALL')
   for key,_ in sel.select(.02):
    chunk=os.read(key.fileobj.fileno(),4096)
    if not chunk:sel.unregister(key.fileobj);continue
    total+=len(chunk)
    if total>65536:raise RuntimeError('OUTPUT_LIMIT')
    if key.data=='stdout':out.extend(chunk)
    else:err.extend(chunk)
  node.wait(timeout=.1)
  # Acceptance checks ONLY after root exit + full EOF, in this order.
  assert not err,'NODE_STDERR_NOT_EMPTY'
  assert node.returncode==0,'NODE_EXIT_'+str(node.returncode)
  orphans=namespace_orphans()
  assert not orphans,'NAMESPACE_ORPHANS_'+str(orphans)
  receipts=[];journal_entries=[]
  for line in out.decode('utf8').splitlines():
   if line.startswith('HGRECEIPT '):receipts.append(json.loads(line[len('HGRECEIPT '):]))
   elif line.startswith('HGJOURNAL '):
    e=json.loads(line[len('HGJOURNAL '):])
    # Journal schema: exact keys/types; no unknown fields, no duplicates.
    assert set(e.keys())=={'seq','phase','stream','line'} or (set(e.keys())=={'seq','phase','stream','line','consumed'}),'JOURNAL_SCHEMA_'+str(sorted(e.keys()))
    assert isinstance(e['seq'],int) and isinstance(e['phase'],str) and isinstance(e['stream'],str) and isinstance(e['line'],str),'JOURNAL_TYPES'
    journal_entries.append(e)
   else:raise RuntimeError('STDOUT_OUTSIDE_PROTOCOL_'+line[:120])
  # Journal integrity: contiguous sequence 0..N-1, count matches the final receipt.
  assert [e['seq'] for e in journal_entries]==list(range(len(journal_entries))),'JOURNAL_SEQ_GAP'
  # Exact ordered sequence, each exactly once, final last; no contradictory receipts.
  assert len(receipts)==len(EXPECTED_SEQUENCE),'RECEIPT_COUNT_'+str(len(receipts))
  assert [r.get('check') for r in receipts]==EXPECTED_SEQUENCE,'RECEIPT_ORDER_'+str([r.get('check') for r in receipts])
  for r in receipts:assert r.get('ok') is True,'RECEIPT_FAIL_'+str(r.get('check'))+'_'+str(r.get('error'))[:120]
  assert receipts[0].get('branch')=='existing','SETTLEMENT_BRANCH'
  assert receipts[3].get('persistedLeaderNotReverted') is True,'BIRTH_PIN_MISSING'
  final=receipts[-1]
  assert final.get('researchDevGates')=='not-covered-require-real-llm','FINAL_SCOPE'
  assert final.get('journalEntries')==len(journal_entries),'JOURNAL_COUNT_MISMATCH_'+str(final.get('journalEntries'))+'_vs_'+str(len(journal_entries))
  stops=final.get('stops') or {}
  n=stops.get('narrative') or {}
  assert isinstance(stops.get('narrative'),dict) and n.get('error') is None and n.get('boundExhausted') is False and n.get('remainingItems')==0 and n.get('pendingPreserved')==0 and not n.get('deferredUnacknowledged') and n.get('refusedLate')==0 and n.get('admissionFailures')==0 and not n.get('subscriptionFailed'),'NARRATIVE_STOP_RECEIPT'
  assert isinstance(stops.get('powerManager'),dict) and stops['powerManager'].get('intervalWasArmed') is True,'POWER_STOP_RECEIPT'
  assert isinstance(stops.get('neuroLink'),dict) and stops['neuroLink'].get('intervalWasArmed') is True and stops['neuroLink'].get('nodesRegistered')==0,'NEUROLINK_STOP_RECEIPT'
  assert isinstance(stops.get('arbiter'),dict) and stops['arbiter'].get('pendingAdmissions')==0 and stops['arbiter'].get('activeAdmissions')==0 and stops['arbiter'].get('activeQueueRuns')==0,'ARBITER_STOP_RECEIPT'
  assert 'continuousMemory' in stops and 'nervousSystem' in stops,'STOP_RECEIPTS_INCOMPLETE'
  sys.stdout.write(out.decode('utf8'));sys.stdout.flush()
  print(json.dumps({'accepted':True,'scope':'actual-hydration-gates-3cases-settled-startup-only','receipts':len(receipts),'journalLines':len(journal_entries),'researchDevGates':'not-covered','naturalExit':True,'namespaceOrphans':0}),flush=True)
 finally:sel.close()
if __name__=='__main__':
 try:main()
 finally:
  for c in children:
   if c.poll() is None:
    force=True
    try:os.killpg(c.pid,signal.SIGTERM);c.wait(timeout=1)
    except (ProcessLookupError,subprocess.TimeoutExpired):
     try:os.killpg(c.pid,signal.SIGKILL);c.wait(timeout=2)
     except ProcessLookupError:pass
  if force:raise RuntimeError('FORCED_CLEANUP_NO_PASS')
