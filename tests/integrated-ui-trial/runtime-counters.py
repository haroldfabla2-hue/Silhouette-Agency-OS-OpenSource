#!/usr/bin/env python3
"""Namespace-local exact wrapper-descendant counters, no cmdline/env/fd/memory.
Stat command names are discarded. Never export data about non-descendants.
"""
import os,sys,pathlib,time,json,signal
root=int(sys.argv[1]);me=os.getpid();out=pathlib.Path('/evidence/runtime-process-counters.json');stop=False;start=time.monotonic();samples=[];lastCheckpoint=None;failed=False

def stat(pid):
 raw=(pathlib.Path('/proc')/str(pid)/'stat').read_text();v=raw[raw.rindex(')')+2:].split()
 return {'pid':pid,'state':v[0],'ppid':int(v[1]),'userTicks':int(v[11]),'systemTicks':int(v[12]),'threads':int(v[17]),'startTicks':int(v[19]),'rssPages':int(v[21])}
rootStart=stat(root)['startTicks']
def sample(reason):
 global failed
 errors=[];rows={}
 try:
  assert stat(root)['startTicks']==rootStart,'WRAPPER_PID_REUSED'
  candidates=[int(p.name)for p in pathlib.Path('/proc').iterdir()if p.name.isdigit()]
  assert len(candidates)<=96,'NAMESPACE_PROCESS_CAP'
  for pid in candidates:
   try:rows[pid]=stat(pid)
   except FileNotFoundError:pass
  admitted={root}
  for _ in range(96):
   old=len(admitted)
   for pid,row in rows.items():
    if row['ppid']in admitted:admitted.add(pid)
   if len(admitted)==old:break
  admitted.discard(root);admitted.discard(me);selected=[];tasks=0
  for pid in sorted(admitted):
   row=rows[pid]
   try:
    # Pin same process identity immediately before task reads.
    if stat(pid)['startTicks']!=row['startTicks']:errors.append('DESCENDANT_IDENTITY_CHANGED');continue
    values=[]
    for tid in sorted((pathlib.Path('/proc')/str(pid)/'task').iterdir(),key=lambda p:int(p.name)):
     tasks+=1
     if tasks>96:raise AssertionError('TASK_COUNTER_CAP')
     try:
      raw=(tid/'stat').read_text();v=raw[raw.rindex(')')+2:].split();values.append({'tid':int(tid.name),'state':v[0],'userTicks':int(v[11]),'systemTicks':int(v[12])})
     except FileNotFoundError:pass
    row['tasks']=values;selected.append(row)
   except FileNotFoundError:pass
  result={'reason':reason,'elapsed':round(time.monotonic()-start,3),'descendants':selected,'errors':errors}
 except BaseException as e:result={'reason':reason,'elapsed':round(time.monotonic()-start,3),'errorType':type(e).__name__,'unverified':True}
 if result.get('unverified')or result.get('errors'):failed=True
 samples.append(result);assert len(samples)<=22,'COUNTER_SAMPLE_CAP'
 out.write_text(json.dumps({'status':'COUNTERS_ONLY_NOT_UI_OR_DRAIN_PROOF','rootNamespacePid':root,'rootStartTicks':rootStart,'samplerExcluded':True,'clockTicksPerSecond':os.sysconf('SC_CLK_TCK'),'samples':samples},indent=2)+'\n')

def finish(*_):
 global stop
 stop=True
signal.signal(signal.SIGTERM,finish)
nextAt=0
try:
 while not stop and time.monotonic()-start<175:
  elapsed=time.monotonic()-start
  if elapsed>=nextAt:sample('FIXED_10_SECOND_SAMPLE');nextAt+=10
  p=pathlib.Path('/evidence/browser-checkpoints.json')
  try:
   raw=p.read_bytes();assert len(raw)<=65536
   current=json.loads(raw)['checkpoints'][-1]['stage']
   if current!=lastCheckpoint and current in {'ORIGINAL_BROWSER_FAILURE','ACTUAL_SCREENSHOT_ATTEMPT_BEGIN','BEFORE_BROWSER_CLOSE'}:
    lastCheckpoint=current
    if len(samples)<21:sample(current)
  except (FileNotFoundError,KeyError,IndexError,json.JSONDecodeError):pass
  time.sleep(.25)
finally:
 if len(samples)<22:sample('SAMPLER_STOP')

raise SystemExit(1 if failed else 0)
