"""REVIEW ONLY. Exact assigned-scope diagnostics, numeric process and counter data only.
Diagnostic failure cannot bypass the existing cgroup.kill cleanup authority.
"""
from evidence_policy import configure,cap,limited_open,emit_text,emit_bytes,append_text,copy_bounded
import json,pathlib,time

def finish_scope(cg,evidence,events,kill_scope,absolute_deadline):
 issues=[]
 def issue(stage,error):
  if len(issues)<16:issues.append({'stage':stage,'errorType':type(error).__name__,'errno':getattr(error,'errno',None)})
 def read_state(stage):
  try:
   raw=(cg/'cgroup.events').read_text();values=dict(line.split()for line in raw.splitlines())
   assert values.get('populated')in{'0','1'}and values.get('frozen')in{'0','1'}
   return raw,values
  except Exception as error:issue(stage,error);return None,{}
 def snapshot(label):
  state,values=read_state(label);rows=[];total=None
  try:
   pids=(cg/'cgroup.procs').read_text().split();total=len(pids)
   for raw in pids[:96]:
    try:
     pid=int(raw);p=pathlib.Path('/proc')/str(pid)
     before=(p/'stat').read_text();tail=before[before.rfind(')')+2:].split();start=tail[19]
     status=(p/'status').read_text();group=(p/'cgroup').read_text()
     after=(p/'stat').read_text();tail_after=after[after.rfind(')')+2:].split()
     rows.append({'pid':pid,'start_ticks':start,'stable_identity':tail_after[19]==start,'state':tail[0],'ppid':tail[1],'pgrp':tail[2],'session':tail[3],'comm':before[before.find('(')+1:before.rfind(')')][:128],'status':[line for line in status.splitlines()if line.split(':',1)[0]in['Name','State','PPid','NSpid','Uid','Gid','Threads']],'cgroup':group[:2048]})
    except Exception as error:rows.append({'observed_pid':raw,'unverified':type(error).__name__})
  except Exception as error:issue(label+':procs',error)
  return {'label':label,'monotonic':time.monotonic(),'events':state,'processes':rows,'pid_count_observed':total,'pid_rows_limit':96}
 def wait_empty(until):
  while True:
   raw,state=read_state('wait')
   if state.get('populated')!='1' or time.monotonic()>=until:return
   time.sleep(min(.025,max(0,until-time.monotonic())))
 samples=[snapshot('child_wait_finished_before_any_signal')]
 wait_empty(min(absolute_deadline,time.monotonic()+.5))
 samples.append(snapshot('after_bounded_natural_settle'))
 raw,state=read_state('cleanup_decision')
 if state.get('populated')!='0' or state.get('frozen')!='0':
  samples.append(snapshot('before_forced_cleanup'))
  try:kill_scope('FINAL_SCOPE_CLEANUP_NOT_PASS')
  except Exception as error:issue('existing_kill_scope',error)
 wait_empty(min(absolute_deadline,time.monotonic()+5))
 samples.append(snapshot('final'));raw,state=read_state('final_verdict')
 result={'events':list(events),'state':raw,'natural_empty':not events and not issues and state.get('populated')=='0'and state.get('frozen')=='0','observations':samples,'diagnostic_issues':issues,'natural_settle_seconds_max':.5,'postkill_seconds_max':5,'absolute_deadline':absolute_deadline,'claim':'Observed current teardown only. No historical survivor identity or cause inferred. Diagnostic errors cannot skip existing scope cleanup.'}
 try:emit_text(evidence/'scope-cleanup.json',json.dumps(result,indent=2))
 except Exception as error:
  issue('evidence_write',error);result['natural_empty']=False
 return result
