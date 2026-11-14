#!/usr/bin/env python3
"""SOURCE ONLY. Eight original subprocesses and one conditional supplemental batch, no raw mode-log export, alwaysFAIL."""
import json,os,pathlib,subprocess,time,signal,selectors,importlib.util
spec=importlib.util.spec_from_file_location('redis_schema','/driver/redis-receipt-schema.py');schema=importlib.util.module_from_spec(spec);spec.loader.exec_module(schema)
START=time.monotonic();END=START+160;rows=[];fatal=False
OUT=pathlib.Path('/evidence/redis-validation.json')
def exact_object(pairs):
 out={}
 for k,v in pairs:assert k not in out;out[k]=v
 return out
def load(p):return json.loads(p.read_text(),object_pairs_hook=exact_object,parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
for mode in schema.MODES:
 receipt=pathlib.Path('/evidence/redis-mode-'+mode+'.json');begin=time.monotonic()
 row={'mode':mode,'code':None,'timeout':False,'failure':None,'forcedOrGroupRemained':False,'receipt':False,'assertionsComplete':False,'elapsed':0}
 # Admit only a FULL17s execution +2s group cleanup slot, not stolen from later
 # modes or supervisor180s. Original8 retain152s allowance. Ninth slot
 # is conditional on real remaining>=19s; worst-case9*19 DOES NOT fit160.
 # If not available, PHASE_BUDGET/fatal/FAIL, never partial acceptance.
 if END-begin<19:row['failure']='PHASE_BUDGET';fatal=True;rows.append(row);break
 env=dict(os.environ,NODE_ENV='test',SILHOUETTE_FINITE_REDIS='real-terminal-expiry-v1',SILHOUETTE_FINITE_REDIS_RECEIPT=str(receipt))
 assert env['SILHOUETTE_PROVIDERS']=='off'and env['SILHOUETTE_INFERENCE_MODE']=='cloud-only'
 command=['/usr/bin/python3','/driver/redis-supplement-batch.py']if mode=='supplement-batch'else ['/node/bin/node','--import','tsx/esm','/driver/redis-terminal-regression.mts',mode]
 p=subprocess.Popen(command,cwd='/app',env=env,start_new_session=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 sel=selectors.DefaultSelector();os.set_blocking(p.stdout.fileno(),False);sel.register(p.stdout,selectors.EVENT_READ);bytes_seen=0;eof=False
 try:
  # Complete original logs remain PRIVATE and excluded from exporter. No raw
  # exceptions/keys/storage from any scenario can enter public frame.
  with pathlib.Path('/evidence/redis-mode-'+mode+'.log').open('xb')as log:
   while True:
    if time.monotonic()-begin>17:row['timeout']=True;raise TimeoutError()
    for key,_ in sel.select(.025):
     b=os.read(key.fd,65536)
     if not b:sel.unregister(key.fd);eof=True;continue
     bytes_seen+=len(b)
     if bytes_seen>2*1024**2:raise RuntimeError()
     log.write(b)
    if p.poll()is not None and eof:break
 except BaseException:row['failure']='DRIVER_FAILURE';fatal=True
 finally:
  try:os.killpg(p.pid,0);row['forcedOrGroupRemained']=True
  except ProcessLookupError:pass
  if row['forcedOrGroupRemained']:
   fatal=True
   try:os.killpg(p.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:p.wait(timeout=1)
   except subprocess.TimeoutExpired:
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    p.wait(timeout=1)
  else:p.wait(timeout=1)
  sel.close();row['code']=p.returncode;row['elapsed']=time.monotonic()-begin
 try:
  assert receipt.is_file()and not receipt.is_symlink()and receipt.stat().st_size<=16384
  r=load(receipt);schema.mode_receipt(r,mode)
  row['receipt']=True;row['assertionsComplete']=r['assertionsComplete']
  assert p.returncode==(0 if r['assertionsComplete']else 1)
 except BaseException:row['failure']='RECEIPT_INVALID';fatal=True
 rows.append(row)
 OUT.write_text(json.dumps({'version':1,'phase':'redis-regressions','status':'FAIL_OR_INCOMPLETE_NOT_PRODUCT_PASS','rows':rows,'allModesAccounted':len(rows)==9,'fatal':fatal,'elapsed':time.monotonic()-START,'global':'INCOMPLETE'},indent=2)+'\n')
 # An ordinary assertionFAIL (including OPENsurvivor) continues independent
 # scenarios. Any transport/timeout/orphan/schema failure prevents new imports.
 if fatal:break
OUT.write_text(json.dumps({'version':1,'phase':'redis-regressions','status':'FAIL_OR_INCOMPLETE_NOT_PRODUCT_PASS','rows':rows,'allModesAccounted':len(rows)==9,'fatal':fatal,'elapsed':time.monotonic()-START,'global':'INCOMPLETE'},indent=2)+'\n')
raise SystemExit(1)
