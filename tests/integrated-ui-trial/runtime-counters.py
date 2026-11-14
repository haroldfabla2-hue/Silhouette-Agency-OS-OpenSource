#!/usr/bin/env python3
"""Namespace-local exact wrapper-descendant counters, no cmdline/env/FD paths or memory contents. Fixed pipe inodes only.
Stat command names are discarded. Never export data about non-descendants.
"""
import os,sys,pathlib,time,json,signal,re
root=int(sys.argv[1]);me=os.getpid();out=pathlib.Path('/evidence/runtime-process-counters.json');stop=False;start=time.monotonic();samples=[];seenCheckpoints=set();failed=False

def stat(pid):
 raw=(pathlib.Path('/proc')/str(pid)/'stat').read_text();v=raw[raw.rindex(')')+2:].split()
 return {'pid':pid,'state':v[0],'ppid':int(v[1]),'userTicks':int(v[11]),'systemTicks':int(v[12]),'threads':int(v[17]),'startTicks':int(v[19]),'rssPages':int(v[21])}
rootStart=stat(root)['startTicks']
# Fixed known files only. No exe path/target bytes, cmdline or environ exported.
fixedExecutablePaths=[('NODE_EXECUTABLE','/node/bin/node'),('CHROMIUM_EXECUTABLE','/browser-assets/chrome-headless-shell-linux64/chrome-headless-shell'),('TSX_ESBUILD_EXECUTABLE','/app/node_modules/tsx/node_modules/@esbuild/linux-x64/bin/esbuild'),('TOPLEVEL_ESBUILD_EXECUTABLE','/app/node_modules/@esbuild/linux-x64/bin/esbuild')]
fixedExecutableIdentities=[]
for label,path in fixedExecutablePaths:
 try:
  st=os.stat(path);fixedExecutableIdentities.append((label,(st.st_dev,st.st_ino)))
 except FileNotFoundError:pass

def selected_pipes(pid):
 try:
  st=os.stat('/proc/'+str(pid)+'/exe');exeBefore=(st.st_dev,st.st_ino);identity=next((label for label,pair in fixedExecutableIdentities if pair==(st.st_dev,st.st_ino)),'OTHER_OR_UNAVAILABLE')
 except FileNotFoundError:return {'executableIdentity':'OTHER_OR_UNAVAILABLE','pipeEndpointsStatus':'PROCESS_GONE','pipeEndpoints':None}
 except PermissionError:return {'executableIdentity':'OTHER_OR_UNAVAILABLE','pipeEndpointsStatus':'UNAVAILABLE','pipeEndpoints':None}
 if identity not in {'NODE_EXECUTABLE','TSX_ESBUILD_EXECUTABLE','TOPLEVEL_ESBUILD_EXECUTABLE'}:return {'executableIdentity':identity,'pipeEndpointsStatus':'NOT_SELECTED_EXECUTABLE','pipeEndpoints':None}
 try:
  fds=list((pathlib.Path('/proc')/str(pid)/'fd').iterdir())
  if len(fds)>512:return {'executableIdentity':identity,'pipeEndpointsStatus':'CAP_OVERFLOW','pipeEndpoints':None}
  values=[]
  for fd in sorted(fds,key=lambda x:int(x.name)):
   try:
    target=os.readlink(fd);match=re.fullmatch(r'pipe:\[([0-9]{1,20})\]',target)
    if match:values.append({'fd':int(fd.name),'pipeInode':match.group(1)})
   except FileNotFoundError:continue
  if len(values)>64:return {'executableIdentity':identity,'pipeEndpointsStatus':'CAP_OVERFLOW','pipeEndpoints':None}
  after=os.stat('/proc/'+str(pid)+'/exe')
  if (after.st_dev,after.st_ino)!=exeBefore:return {'executableIdentity':'OTHER_OR_UNAVAILABLE','pipeEndpointsStatus':'EXECUTABLE_CHANGED_UNVERIFIED','pipeEndpoints':None}
  return {'executableIdentity':identity,'pipeEndpointsStatus':'COLLECTED_FIXED_PIPE_INODES_ONLY','pipeEndpoints':values}
 except FileNotFoundError:return {'executableIdentity':identity,'pipeEndpointsStatus':'PROCESS_GONE','pipeEndpoints':None}
 except PermissionError:return {'executableIdentity':identity,'pipeEndpointsStatus':'UNAVAILABLE','pipeEndpoints':None}

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
    row['tasks']=values;row.update(selected_pipes(pid))
    if stat(pid)['startTicks']!=row['startTicks']:errors.append('DESCENDANT_IDENTITY_CHANGED');continue
    if row['pipeEndpointsStatus']in{'CAP_OVERFLOW','UNAVAILABLE','EXECUTABLE_CHANGED_UNVERIFIED'}:errors.append('DESCENDANT_PIPE_IDENTITY_UNVERIFIED')
    selected.append(row)
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
   checkpoints=json.loads(raw)['checkpoints'];assert type(checkpoints)is list and len(checkpoints)<=64
   for checkpoint in checkpoints:
    current=checkpoint['stage']
    if current not in seenCheckpoints and current in {'ORIGINAL_BROWSER_FAILURE','ACTUAL_SCREENSHOT_ATTEMPT_BEGIN','BEFORE_BROWSER_CLOSE'}:
     seenCheckpoints.add(current)
     if len(samples)<21:sample(current)
  except (FileNotFoundError,KeyError,IndexError,json.JSONDecodeError):pass
  time.sleep(.25)
finally:
 if len(samples)<22:sample('SAMPLER_STOP')

raise SystemExit(1 if failed else 0)
