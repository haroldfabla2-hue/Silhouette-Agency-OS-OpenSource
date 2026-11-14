#!/usr/bin/env python3
"""Three actual isolated roots within ONE shared original 17s process-group slot.
Outer Redis driver owns exact group cancellation/2s cleanup. No nested new session.
"""
import pathlib,subprocess,os,json,selectors,time
from redis_supplement_schema import MODES,child_receipt,batch_receipt
START=time.monotonic();children=[];codes=[]
def exact(pairs):
 d={}
 for k,v in pairs:assert k not in d;d[k]=v
 return d
for mode in MODES:
 receipt=pathlib.Path('/evidence/redis-supplement-'+mode+'.json')
 env=dict(os.environ,SILHOUETTE_FINITE_REDIS_RECEIPT=str(receipt))
 p=subprocess.Popen(['/node/bin/node','--import','tsx/esm','/driver/redis-generation-supplement.mts',mode],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 sel=selectors.DefaultSelector();os.set_blocking(p.stdout.fileno(),False);sel.register(p.stdout,selectors.EVENT_READ);seen=0;eof=False
 with pathlib.Path('/evidence/redis-supplement-'+mode+'.log').open('xb')as log:
  while True:
   # Outer group deadline remains authoritative, never reset for each child.
   assert time.monotonic()-START<17
   for key,_ in sel.select(.025):
    b=os.read(key.fd,65536)
    if not b:sel.unregister(key.fd);eof=True;continue
    seen+=len(b);assert seen<=2*1024**2;log.write(b)
   if p.poll()is not None and eof:break
 sel.close();p.wait();assert receipt.is_file()and not receipt.is_symlink()and receipt.stat().st_size<=4096
 child=json.loads(receipt.read_text(),object_pairs_hook=exact,parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
 child_receipt(child,mode);assert p.returncode==(0 if child['assertionsComplete']else 1)
 children.append(child);codes.append(p.returncode)
 # Genuine assertion FAIL continues independent roots, infrastructure failure
 # escapes to outer group driver and is fatal, never a usable batch receipt.
v={'version':1,'mode':'supplement-batch','assertionsComplete':all(x['assertionsComplete']for x in children),'children':children,'codes':codes,'global':'INCOMPLETE','rawPrivateLogExported':False};batch_receipt(v)
pathlib.Path('/evidence/redis-mode-supplement-batch.json').write_text(json.dumps(v,indent=2)+'\n')
raise SystemExit(0 if v['assertionsComplete']else 1)
