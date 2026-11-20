"""Pure command-plan and receipt validators. No subprocesses/mutations.
Used only by the unwired core harness. Pure tests are not runtime evidence.
"""
import pathlib,re,hashlib

LIMITS={'memoryBytes':134217728,'swapBytes':0,'tasks':16,'cpuQuotaMicros':25000,'cpuPeriodMicros':100000,'wallSeconds':20,'workBytes':1048576,'workInodes':64}

def unit_name(nonce):
 assert re.fullmatch(r'[0-9a-f]{32}',nonce),'NONCE_FORMAT'
 return 'hg-containment-'+nonce+'.service'

def service_plan(nonce,python,bootstrap,control):
 # All three paths must belong to an externally anchored byte-checked set.
 # They are protected by read-only inner binds, not a host immutable flag.
 # They are NOT permitted to be arbitrary user-supplied commands/arguments.
 for p in [python,bootstrap,control]:assert pathlib.PurePosixPath(p).is_absolute() and '..' not in pathlib.PurePosixPath(p).parts,'ABSOLUTE_STAGED_PATH'
 name=unit_name(nonce)
 props={'Type':'exec','Description':'Hydration core containment '+nonce,'MemoryMax':str(LIMITS['memoryBytes']),'MemorySwapMax':'0','TasksMax':str(LIMITS['tasks']),'CPUQuota':'25%','CPUQuotaPeriodSec':'100ms','RuntimeMaxSec':'20s','TimeoutStopSec':'2s','KillMode':'control-group','SendSIGKILL':'yes','Restart':'no','RemainAfterExit':'yes','MemoryAccounting':'yes','CPUAccounting':'yes','TasksAccounting':'yes','OOMPolicy':'stop','StandardInput':'null','StandardOutput':'null','StandardError':'null','WorkingDirectory':'/'}
 # No --collect: retain failed/active-exited metadata until receipts and
 # owned-unit cleanup are inspected. No --scope: manager creates cgroup and
 # applies resource properties before executing the trusted handshake helper.
 cmd=['/usr/bin/systemd-run','--user','--no-ask-password','--quiet','--expand-environment=no','--unit='+name]
 for k,v in props.items():cmd.append('--property='+k+'='+v)
 cmd += ['/usr/bin/env','-i','PATH=/usr/bin:/bin','LC_ALL=C',python,'-I','-B','-S',bootstrap,'--control',control,'--nonce',nonce]
 return {'unit':name,'properties':props,'command':cmd,'scope':'Plan only, no unit created. Resource requests are not effective limits.'}

def parse_proc_cgroup(text):
 rows=text.strip().splitlines();v2=[l[3:] for l in rows if l.startswith('0::')];assert len(v2)==1,'V2_REQUIRED'
 p=pathlib.PurePosixPath(v2[0]);assert p.is_absolute() and '..' not in p.parts,'CGROUP_PATH'
 return p

def validate_receipt(nonce,unitprops,ready,pid_cgroup,ancestor_rows):
 """All arguments must be live external reads supplied by a future controller.
 Return gate data only after exact owned unit + invocation + MainPID membership.
 Missing/invalid/less restrictive data fails closed. Never writes a gate.
 """
 name=unit_name(nonce);assert unitprops['Id']==name and unitprops['Description']=='Hydration core containment '+nonce,'OWNED_UNIT_ID'
 invocation=unitprops['InvocationID'];assert re.fullmatch(r'[0-9a-f]{32}',invocation),'INVOCATION_ID'
 assert set(ready)=={'pid','nonce','state'},'READY_FIELDS'
 assert type(ready['pid']) is int and type(ready['nonce']) is str,'READY_SCHEMA'
 pid=int(unitprops['MainPID']);assert pid>1 and ready['pid']==pid and ready['nonce']==nonce,'READY_PID_NONCE'
 assert ready['state']=='waiting-for-release','READY_STATE'
 assert unitprops['ActiveState']=='active' and unitprops['SubState']=='running' and unitprops['KillMode']=='control-group','SERVICE_STATE'
 for key,seconds in [('RuntimeMaxUSec',20),('TimeoutStopUSec',2)]:assert unitprops[key] in (str(seconds)+'s',str(seconds*1000000)),'SERVICE_PROPERTY_'+key
 for key,value in {'OOMPolicy':'stop','Restart':'no','RemainAfterExit':'yes','SendSIGKILL':'yes','Type':'exec'}.items():assert unitprops[key]==value,'SERVICE_PROPERTY_'+key
 cg=pathlib.PurePosixPath(unitprops['ControlGroup']);assert parse_proc_cgroup(pid_cgroup)==cg,'REAL_PID_MEMBERSHIP'
 assert cg.name==name and cg.is_absolute() and '..' not in cg.parts,'OWN_CGROUP'
 assert ancestor_rows and pathlib.PurePosixPath(ancestor_rows[0]['path'])==cg,'LEAF_FIRST'
 previous=cg
 seen=set()
 for index,row in enumerate(ancestor_rows):
  assert set(row)=={'path','memory.max','memory.swap.max','pids.max','cpu.max'},'ANCESTOR_SCHEMA'
  assert all(type(x) is str for x in row.values()),'ANCESTOR_TYPES'
  assert row['path'] not in seen,'ANCESTOR_REPEAT';seen.add(row['path'])
  here=pathlib.PurePosixPath(row['path']);assert here==(previous if index==0 else previous.parent),'ANCESTOR_CHAIN';previous=here
  assert here!=pathlib.PurePosixPath('/') or index==len(ancestor_rows)-1,'ROOT_NOT_LAST'
  if here==pathlib.PurePosixPath('/') and index>0:continue # cgroup root has no resource max files
  for key,cap in [('memory.max',LIMITS['memoryBytes']),('memory.swap.max',0),('pids.max',LIMITS['tasks'])]:
   value=row[key].strip()
   if index==0:assert value!='max','LEAF_FINITE_'+key
   if value!='max':
    assert value.isdecimal(),'NUMERIC_'+key
    if index==0:assert int(value)<=cap and (key=='memory.swap.max' or int(value)>0),'BOUND_'+key
  quota,period=row['cpu.max'].split();assert period.isdecimal() and int(period)>0,'CPU_PERIOD'
  if index==0:assert quota!='max' and int(period)==100000,'LEAF_CPU_FINITE_AND_PERIOD'
  if quota!='max':
   assert quota.isdecimal() and int(quota)>0,'CPU_QUOTA'
   if index==0:assert int(quota)*LIMITS['cpuPeriodMicros']<=LIMITS['cpuQuotaMicros']*int(period),'CPU_RATE_BOUND'
 # Must reach cgroup root, not silently omit a more restrictive ancestor.
 assert previous==pathlib.PurePosixPath('/'),'ANCESTORS_INCOMPLETE'
 return {'unit':name,'invocationId':invocation,'pid':pid,'cgroupSha256':hashlib.sha256(str(cg).encode()).hexdigest(),'cpuMeaning':'Rate <=25% CPU, not separate total CPU bound; wall limit independently required.'}

def verify_final_receipt(owned,unitprops,cgroup_events,members,forced_cleanup,witness,pre_bookkeeping=False):
 assert unitprops['Id']==owned['unit'] and unitprops['InvocationID']==owned['invocationId'],'CLEANUP_UNIT_CHANGED'
 assert int(unitprops['MainPID'])==0,'UNIT_MAINPID_LIVE'
 if pre_bookkeeping:assert unitprops['ActiveState']=='active' and unitprops['SubState']=='exited','NOT_ACTIVE_EXITED'
 else:assert unitprops['ActiveState'] in ['inactive','failed'],'UNIT_NOT_QUIESCENT'
 assert type(cgroup_events['populated']) is int and cgroup_events['populated']==0 and not members,'CGROUP_NOT_EMPTY'
 assert type(witness['descendants']) is int and type(witness['exitCode']) is int,'FINAL_SCHEMA'
 assert witness['naturalExit'] is True and witness['pipeEOF'] is True and witness['descendants']==0,'LIFECYCLE_NOT_NATURAL'
 assert forced_cleanup is False,'FORCED_CLEANUP_NEVER_PASS'
 assert witness['exitCode']==0 and unitprops['Result']=='success','NONZERO_OR_MANAGER_FAILURE'
 return {'scope':'Containment-only final receipt, not product behavior','passed':True}

def verify_result_context(result,nonce,invocation):
 assert result['nonce']==nonce and result['invocationId']==invocation,'RESULT_CONTEXT'
 assert type(result['nonce']) is str and type(result['invocationId']) is str,'RESULT_CONTEXT_TYPES'

def evaluate_case_result(case,result,before,after,ready,manager):
 """Actual controller oracle. Pressure alone is NEVER allocation rejection."""
 assert case in ('core','work-bytes','work-inodes','pids','memory','descendant','pipe','timeout'),'CASE'
 delta={}
 for file,keys in [('memory.events',('oom','oom_kill','max')),('pids.events',('max',))]:
  delta[file]={}
  for key in keys:
   a=after[file][key];b=before[file][key]
   assert type(a) is int and type(b) is int and a>=b,'EVENT_SCHEMA'
   delta[file][key]=a-b
 memory=delta['memory.events'];pids=delta['pids.events']
 if result is None:
  assert case=='memory' and ready is True and memory['oom_kill']>0,'MISSING_RESULT_NOT_OOM'
  assert manager['ExecMainCode']=='2' and manager['ExecMainStatus']=='9','OOM_TERMINATION_NOT_CORROBORATED'
  return {'payloadPass':False,'negativeEnforcementObserved':True,'naturalPayload':False}
 assert set(result)=={'case','nonce','invocationId','status','forced','exitCode','stderr','reason','naturalExit','pipeEOF','descendants'},'RESULT_SCHEMA'
 assert result['case']==case and type(result['forced']) is bool and type(result['stderr']) is bool and type(result['naturalExit']) is bool and type(result['pipeEOF']) is bool and type(result['descendants']) is int,'RESULT_TYPES'
 assert result['exitCode'] is None or type(result['exitCode']) is int,'RESULT_EXIT_SCHEMA'
 if case=='memory':
  assert ready is True and pids['max']==0 and result['status']=='FAIL','MEMORY_RESULT'
  enomem=result['reason']=='memory-enomem' and result['exitCode']==0 and result['stderr'] is False and not result['forced'] and result['naturalExit'] and result['pipeEOF'] and result['descendants']==0
  oom=result['reason']=='memory-oom-kill' and result['exitCode']==-9 and memory['oom_kill']>0 and not result['forced']
  assert enomem or oom,'MEMORY_REJECTION_NOT_OBSERVED'
  return {'payloadPass':False,'negativeEnforcementObserved':True,'naturalPayload':enomem}
 assert memory['oom']==memory['oom_kill']==memory['max']==0,'UNEXPECTED_MEMORY_EVENTS'
 assert pids['max']>0 if case=='pids' else pids['max']==0,'UNEXPECTED_PID_EVENTS'
 if case in ('descendant','pipe','timeout'):
  assert ready is True and result['status']=='FAIL' and result['reason']=={'descendant':'descendant-live','pipe':'pipe-eof-deadline','timeout':'wall-deadline'}[case],'LIFECYCLE_NEGATIVE_REASON'
  assert result['stderr'] is False,'NEGATIVE_STDERR'
  if case=='descendant':assert result['descendants']>0 and not result['forced'],'DESCENDANT_EVIDENCE'
  else:assert result['forced'] and not result['pipeEOF'],'TIMEOUT_EVIDENCE'
  return {'payloadPass':False,'expectedFailureObserved':True,'naturalPayload':False}
 assert result['status']=='OK' and result['reason']=='verified' and result['exitCode']==0 and not result['forced'] and not result['stderr'],'POSITIVE_RESULT'
 assert result['naturalExit'] and result['pipeEOF'] and result['descendants']==0,'POSITIVE_LIFECYCLE'
 assert manager['Result']=='success' and manager['ExecMainStatus']=='0','MANAGER_RESULT'
 return {'payloadPass':True,'coreCheckObserved':True,'naturalPayload':True}

if __name__=='__main__':raise SystemExit('PURE_MODULE_ONLY: invoke no service or payload')
