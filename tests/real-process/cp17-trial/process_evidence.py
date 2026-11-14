"""Review-only supervisor helper. Read metadata only, no env/cmdline/IO payloads.
Never imported/executed during source preparation. No signals or host changes.
"""
import pathlib,time
NAMES=['pids.current','pids.peak','pids.events','pids.events.local','pids.max']
def counters(cgroup):
 out={}
 for name in NAMES:
  try:out[name]=(cgroup/name).read_text()[:1024]
  except OSError as error:out[name]={'unavailable':error.errno}
 return out

def identities(pids):
 rows=[]
 for pid in list(pids)[:96]:
  p=pathlib.Path('/proc')/str(pid)
  try:
   before=(p/'stat').read_text();tail=before[before.rfind(')')+2:].split()
   status=(p/'status').read_text();group=(p/'cgroup').read_text()
   after=(p/'stat').read_text();check=after[after.rfind(')')+2:].split()
   row={'pid':int(pid),'start_ticks':tail[19],'stable_identity':check[19]==tail[19],'state':tail[0],'ppid':tail[1],'pgrp':tail[2],'session':tail[3],'comm':before[before.find('(')+1:before.rfind(')')][:128],'status':[x for x in status.splitlines()if x.split(':',1)[0]in ['Name','State','PPid','NSpid','Threads']],'cgroup':group[:2048]}
   # Linux procstat field52 (tail starts field3). Only authoritative at
   # observedzombie state; missing/rapidreaped remains unknown, not fabricated0.
   if tail[0]=='Z' and len(tail)>49:row['observed_zombie_wait_status']=int(tail[49])
   rows.append(row)
  except (OSError,ValueError,IndexError)as error:rows.append({'pid':str(pid),'identity_unverified':type(error).__name__})
 return {'at_monotonic':time.monotonic(),'rows':rows,'limit':96,'not_complete_exit_history':True}

def snapshot(cgroup,pids):
 return {'counters':counters(cgroup),'identity':identities(pids),'scope':'SAME_PHASE_CGROUP_AND_VISIBLE_INNER_PID_NAMESPACE'}
def counter_delta(before,after):
 out={}
 for key in ['pids.events','pids.events.local']:
  try:
   a=dict(x.split()for x in before[key].splitlines());b=dict(x.split()for x in after[key].splitlines())
   out[key]={k:int(b[k])-int(v)for k,v in a.items()if k in b}
  except (KeyError,AttributeError,ValueError):out[key]={'unavailable':True}
 return out
