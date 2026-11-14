#!/usr/bin/env python3
"""SOURCE ONLY. New finite phase driver, never a product-PASS producer.
Requires proposed unchanged isolation supervisor plus reviewed overlay in /app.
No project credentials or external network. No orchestration launch authorized.
"""
import json,os,pathlib,subprocess,time,signal,selectors
MODES=['constructors','identity-existing','saturated-replay','schema-and-write-failure','power-check','timer-armed','timer-fired','threshold']
START=time.monotonic();END=START+168;rows=[];fatal=False
OUT=pathlib.Path('/evidence/continuum-validation.json')
# Sequential21s modes fit168s including all mode cleanup. Outer180s supervisor
# remains authority. Time consumed by startup/native storage is real, no extension.
for mode in MODES:
 receipt=pathlib.Path('/evidence/continuum-mode-'+mode+'.json')
 remaining=END-time.monotonic()
 if remaining<3:
  fatal=True;rows.append({'mode':mode,'status':'NOT_STARTED_PHASE_BUDGET','code':None,'timeout':False,'receipt':False});break
 env=dict(os.environ,NODE_ENV='test',SILHOUETTE_FINITE_CONTINUUM='exact-original-boundaries-v1',SILHOUETTE_FINITE_MODE_RECEIPT=str(receipt))
 assert env['SILHOUETTE_PROVIDERS']=='off' and env['SILHOUETTE_INFERENCE_MODE']=='cloud-only'
 p=subprocess.Popen(['/node/bin/node','--import','tsx/esm','/app/tests/lifecycle/continuum-original-integration.mts',mode],env=env,start_new_session=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 sel=selectors.DefaultSelector();os.set_blocking(p.stdout.fileno(),False);sel.register(p.stdout,selectors.EVENT_READ)
 begin=time.monotonic();deadline=min(END,begin+21);timeout=False;failed=None;bytes_seen=0
 try:
  # Complete logs retained only inside protected phase for normal sanitizer.
  with pathlib.Path('/evidence/continuum-mode-'+mode+'.log').open('xb') as log:
   eof=False
   while True:
    if time.monotonic()>deadline:timeout=True;raise TimeoutError('FINITE_MODE_DEADLINE')
    for key,_ in sel.select(.05):
     data=os.read(key.fd,65536)
     if not data:sel.unregister(key.fd);eof=True;continue
     bytes_seen+=len(data)
     if bytes_seen>2*1024**2:raise RuntimeError('FINITE_MODE_OUTPUT_CAP')
     log.write(data)
    if p.poll() is not None and eof:break
 except BaseException as error:failed=type(error).__name__
 finally:
  # A lingering private process group is invalid, not a natural clean exit.
  try:os.killpg(p.pid,0);group_remains=True
  except ProcessLookupError:group_remains=False
  if group_remains:
   fatal=True
   try:os.killpg(p.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:p.wait(timeout=1)
   except subprocess.TimeoutExpired:
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    p.wait(timeout=1)
  else:p.wait(timeout=1)
  sel.close()
 row={'mode':mode,'code':p.returncode,'timeout':timeout,'failure':failed,'forcedOrGroupRemained':group_remains,'receipt':False,'elapsed':time.monotonic()-begin}
 try:
  assert receipt.is_file() and receipt.stat().st_size<=65536
  r=json.loads(receipt.read_text());assert r['version']==1 and r['mode']==mode and type(r['assertionsComplete']) is bool
  assert r['componentVerdict'] in ['ASSERTIONS_COMPLETED_NOT_PRODUCT_PASS','ASSERTIONS_INCOMPLETE']
  assert len(r['cleanup'])==2 and all(status in ['fulfilled','rejected'] for status in r['cleanup'])
  assert r['productState']=='INCOMPLETE' and r['productVerdict'] in ['FAIL_RETAINED_ORIGINAL_EVIDENCE','INCOMPLETE_FRONTIER']
  for k in ['ownerFailures','taskOutcomeFailures','lifetimeFailures']:assert type(r[k]) is int and r[k]>=0
  assert r['categories']['currentReportOnly'] is True
  row.update(receipt=True,assertionsComplete=r['assertionsComplete'],cleanup=r['cleanup'],productVerdict=r['productVerdict'])
 except BaseException:row['receiptInvalidOrMissing']=True;fatal=True
 if failed or timeout or group_remains or p.returncode!=0 or not row.get('assertionsComplete'):fatal=True
 row['status']='FAIL_ASSERTION_TRANSPORT_OR_TIMEOUT' if failed or timeout or group_remains or p.returncode!=0 or not row.get('assertionsComplete') else 'ASSERTIONS_COMPLETED_PRODUCT_'+row['productVerdict']
 rows.append(row)
 OUT.write_text(json.dumps({'phase':'continuum-regressions','status':'FAIL_OR_INCOMPLETE_NOT_PRODUCT_PASS','rows':rows,'allModesAccounted':len(rows)==len(MODES),'fatal':fatal,'elapsed':time.monotonic()-START,'global':'INCOMPLETE'},indent=2)+'\n')
 # No later project import after a timeout/orphan/output-cap/receipt defect.
 if fatal:break
if len(rows)!=len(MODES):fatal=True
OUT.write_text(json.dumps({'phase':'continuum-regressions','status':'FAIL_OR_INCOMPLETE_NOT_PRODUCT_PASS','rows':rows,'allModesAccounted':len(rows)==len(MODES),'fatal':fatal,'elapsed':time.monotonic()-START,'global':'INCOMPLETE'},indent=2)+'\n')
# Even eight natural code0+assertions cannot become clean original product close.
raise SystemExit(1)
