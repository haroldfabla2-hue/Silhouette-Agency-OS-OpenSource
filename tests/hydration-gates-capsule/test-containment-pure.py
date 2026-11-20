"""Pure schema/receipt/command tests. Synthetic validator inputs only.
No systemd, namespace, mount, process, network, product or resource probe runs.
A passing result is NOT evidence that dynamic containment works.
"""
import unittest,copy,pathlib,importlib.util
D=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('control',D/'containment-control-contract.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
N='a'*32;I='b'*32;NAME=c.unit_name(N);CG='/u/'+NAME

def fixture():
 p={'Id':NAME,'Description':'Hydration core containment '+N,'InvocationID':I,'MainPID':'123','ControlGroup':CG,'ActiveState':'active','SubState':'running','KillMode':'control-group','RuntimeMaxUSec':'20s','TimeoutStopUSec':'2s','OOMPolicy':'stop','Restart':'no','RemainAfterExit':'yes','SendSIGKILL':'yes','Type':'exec'}
 ready={'nonce':N,'pid':123,'state':'waiting-for-release'}
 rows=[{'path':CG,'memory.max':'134217728','memory.swap.max':'0','pids.max':'16','cpu.max':'25000 100000'},{'path':'/u','memory.max':'max','memory.swap.max':'max','pids.max':'max','cpu.max':'max 100000'},{'path':'/','memory.max':'root-not-applicable','memory.swap.max':'root-not-applicable','pids.max':'root-not-applicable','cpu.max':'root-not-applicable'}]
 return [p,ready,'0::'+CG,rows]
def validate(f):return c.validate_receipt(N,*f)

class PureValidators(unittest.TestCase):
 def test_positive_fixture_is_only_schema(self):self.assertEqual(validate(fixture())['invocationId'],I)
 def test_command_is_plan_only(self):
  p=c.service_plan(N,'/usr/bin/python3','/staged/helper.py','/private/control')
  self.assertNotIn('--scope',p['command']);self.assertIn('--property=Type=exec',p['command']);self.assertIn('--property=RuntimeMaxSec=20s',p['command']);self.assertIn('--expand-environment=no',p['command']);self.assertIn('-I',p['command']);self.assertNotIn('--collect',p['command'])
 def test_nonce_rejects_argument_injection(self):
  for n in ('x'*32,'../x','a'*31,'a'*33,'a'*32+';touch /tmp/x'):
   with self.subTest(n=n),self.assertRaises(AssertionError):c.unit_name(n)
 def test_unit_property_mutations(self):
  bad={'Id':'other.service','Description':'other','InvocationID':'z'*32,'MainPID':'124','ControlGroup':'/other','ActiveState':'inactive','SubState':'exited','KillMode':'process','RuntimeMaxUSec':'infinity','TimeoutStopUSec':'1min','OOMPolicy':'continue','Restart':'always','RemainAfterExit':'no','SendSIGKILL':'no','Type':'simple'}
  for key,value in bad.items():
   f=fixture();f[0][key]=value
   with self.subTest(key=key),self.assertRaises((AssertionError,ValueError)):validate(f)
 def test_ready_stale_schema(self):
  for key,value in [('nonce','c'*32),('pid',124),('pid',True),('pid','123'),('state','released')]:
   f=fixture();f[1][key]=value
   with self.subTest(key=key,value=value),self.assertRaises(AssertionError):validate(f)
 def test_real_membership_mismatch(self):
  f=fixture();f[2]='0::/foreign'
  with self.assertRaises(AssertionError):validate(f)
 def test_leaf_limits_cannot_be_relaxed(self):
  for key,value in [('memory.max','max'),('memory.max','134217729'),('memory.swap.max','1'),('pids.max','max'),('pids.max','17'),('cpu.max','26000 100000'),('cpu.max','max 100000')]:
   f=fixture();f[3][0][key]=value
   with self.subTest(key=key,value=value),self.assertRaises(AssertionError):validate(f)
 def test_schema_types_and_unknown_fields(self):
  for key,value in [('memory.max',True),('pids.max',16),('cpu.max',None)]:
   f=fixture();f[3][0][key]=value
   with self.assertRaises(AssertionError):validate(f)
  f=fixture();f[3][0]['extra']='x'
  with self.assertRaises(AssertionError):validate(f)
 def test_ancestors_cannot_skip_repeat_or_continue_after_root(self):
  for change in ('skip','repeat','after-root','no-root'):
   f=fixture()
   if change=='skip':f[3].pop(1)
   if change=='repeat':f[3].append(copy.deepcopy(f[3][-1]))
   if change=='after-root':f[3].append(copy.deepcopy(f[3][1]))
   if change=='no-root':f[3].pop()
   with self.subTest(change=change),self.assertRaises(AssertionError):validate(f)
 def test_stricter_limits_allowed_no_auto_increase(self):
  f=fixture();f[3][0]['memory.max']='67108864';f[3][0]['pids.max']='8';f[3][1]['memory.max']='33554432';validate(f)
 def test_final_receipt_natural_only(self):
  owned=validate(fixture());p={'Id':NAME,'InvocationID':I,'ActiveState':'inactive','MainPID':'0','Result':'success'};w={'naturalExit':True,'pipeEOF':True,'descendants':0,'exitCode':0}
  self.assertTrue(c.verify_final_receipt(owned,p,{'populated':0},[],False,w)['passed'])
  for kw,val in [('naturalExit',False),('pipeEOF',False),('descendants',1),('exitCode',1)]:
   bad={**w,kw:val}
   with self.subTest(kw=kw),self.assertRaises(AssertionError):c.verify_final_receipt(owned,p,{'populated':0},[],False,bad)
  with self.assertRaises(AssertionError):c.verify_final_receipt(owned,p,{'populated':0},[],True,w)
  with self.assertRaises(AssertionError):c.verify_final_receipt(owned,p,{'populated':1},[123],False,w)
  with self.assertRaises(AssertionError):c.verify_final_receipt(owned,{**p,'InvocationID':'c'*32},{'populated':0},[],False,w)


# Additional tests exercise the same evaluator/capture paths used by controller.
# Capture dependencies are replaced with in-memory fakes, never a real child.
from unittest import mock
spec=importlib.util.spec_from_file_location('harness',D/'containment-harness.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)

def event_fixture():return {'memory.events':{'oom':0,'oom_kill':0,'max':0},'pids.events':{'max':0}}
def result_fixture(case='core'):
 return {'case':case,'nonce':N,'invocationId':I,'status':'OK','forced':False,'exitCode':0,'stderr':False,'reason':'verified','naturalExit':True,'pipeEOF':True,'descendants':0}
MANAGER={'Result':'success','ExecMainStatus':'0','ExecMainCode':'1'}

class ActualResultOracle(unittest.TestCase):
 def test_positive_actual_branch(self):self.assertTrue(c.evaluate_case_result('core',result_fixture(),event_fixture(),event_fixture(),True,MANAGER)['payloadPass'])
 def test_all_memory_allocated_pressure_is_not_rejection(self):
  before=event_fixture();after=event_fixture();after['memory.events']['max']=4
  bad={**result_fixture('memory'),'status':'FAIL','reason':'MEMORY_CEILING_NOT_OBSERVED','exitCode':1,'stderr':True}
  with self.assertRaises(AssertionError):c.evaluate_case_result('memory',bad,before,after,True,MANAGER)
  bad['reason']='unverified'
  with self.assertRaises(AssertionError):c.evaluate_case_result('memory',bad,before,after,True,MANAGER)
 def test_actual_memory_enomem_and_oom(self):
  r={**result_fixture('memory'),'status':'FAIL','reason':'memory-enomem'}
  self.assertFalse(c.evaluate_case_result('memory',r,event_fixture(),event_fixture(),True,MANAGER)['payloadPass'])
  after=event_fixture();after['memory.events']['oom_kill']=1;after['memory.events']['oom']=1
  r.update({'reason':'memory-oom-kill','exitCode':-9,'naturalExit':False})
  self.assertTrue(c.evaluate_case_result('memory',r,event_fixture(),after,True,MANAGER)['negativeEnforcementObserved'])
  after['memory.events']['oom_kill']=0
  with self.assertRaises(AssertionError):c.evaluate_case_result('memory',r,event_fixture(),after,True,MANAGER)
 def test_manager_oom_requires_ready_kill_and_event(self):
  after=event_fixture();after['memory.events']['oom_kill']=1
  self.assertTrue(c.evaluate_case_result('memory',None,event_fixture(),after,True,{'ExecMainCode':'2','ExecMainStatus':'9'})['negativeEnforcementObserved'])
  for ready,code in ((False,'2'),(True,'1')):
   with self.assertRaises(AssertionError):c.evaluate_case_result('memory',None,event_fixture(),after,ready,{'ExecMainCode':code,'ExecMainStatus':'9'})
 def test_unexpected_pressure_events_rejected_in_real_positive_branch(self):
  for file,key in [('memory.events','oom'),('memory.events','oom_kill'),('memory.events','max'),('pids.events','max')]:
   after=event_fixture();after[file][key]=1
   with self.subTest(file=file,key=key),self.assertRaises(AssertionError):c.evaluate_case_result('core',result_fixture(),event_fixture(),after,True,MANAGER)
 def test_protocol_mutation_rejected_real_branch(self):
  for key,value in [('case','pids'),('status','FAIL'),('forced',True),('stderr',True),('exitCode',False),('pipeEOF',False),('naturalExit',False),('descendants',True),('reason','anything')]:
   r={**result_fixture(),key:value}
   with self.subTest(key=key),self.assertRaises(AssertionError):c.evaluate_case_result('core',r,event_fixture(),event_fixture(),True,MANAGER)
  r=result_fixture();r['extra']=0
  with self.assertRaises(AssertionError):c.evaluate_case_result('core',r,event_fixture(),event_fixture(),True,MANAGER)
 def test_pid_event_only_expected_pid_case(self):
  after=event_fixture();after['pids.events']['max']=1
  self.assertTrue(c.evaluate_case_result('pids',result_fixture('pids'),event_fixture(),after,True,MANAGER)['payloadPass'])
  with self.assertRaises(AssertionError):c.evaluate_case_result('pids',result_fixture('pids'),event_fixture(),event_fixture(),True,MANAGER)
 def test_lifecycle_negative_stays_fail_payload(self):
  for case,reason in [('descendant','descendant-live'),('pipe','pipe-eof-deadline'),('timeout','wall-deadline')]:
   r={**result_fixture(case),'status':'FAIL','reason':reason,'forced':case!='descendant','pipeEOF':case=='descendant','descendants':1 if case=='descendant' else 0}
   out=c.evaluate_case_result(case,r,event_fixture(),event_fixture(),True,MANAGER);self.assertFalse(out['payloadPass'])
   r['reason']='unverified'
   with self.assertRaises(AssertionError):c.evaluate_case_result(case,r,event_fixture(),event_fixture(),True,MANAGER)

class CaptureSetupPaths(unittest.TestCase):
 def test_popen_failure_is_fatal_without_resources(self):
  with mock.patch.object(h.subprocess,'Popen',side_effect=OSError(24,'fdlimit')),mock.patch.object(h.os,'pidfd_open') as pidfd:
   with self.assertRaises(h.CaptureSetupFatal):h.capture_child(['not-run'],1)
   pidfd.assert_not_called()
 def child(self):
  child=mock.Mock();child.pid=123;child.poll.return_value=None;child.returncode=-9
  return child
 def test_pidfd_error_closes_all_streams_no_unsafe_kill(self):
  child=self.child()
  with mock.patch.object(h.subprocess,'Popen',return_value=child),mock.patch.object(h.os,'pidfd_open',side_effect=OSError(38,'unsupported')),mock.patch.object(h.signal,'pidfd_send_signal') as kill:
   with self.assertRaises(h.CaptureSetupFatal):h.capture_child(['not-run'],1)
   kill.assert_not_called();child.wait.assert_not_called()
  for fd in (child.stdin,child.stdout,child.stderr):fd.close.assert_called()
 def test_selector_register_failure_kills_exact_pidfd_and_closes(self):
  child=self.child();selector=mock.Mock();selector.register.side_effect=OSError(24,'fdlimit')
  with mock.patch.object(h.subprocess,'Popen',return_value=child),mock.patch.object(h.os,'pidfd_open',return_value=44),mock.patch.object(h.selectors,'DefaultSelector',return_value=selector),mock.patch.object(h.signal,'pidfd_send_signal') as kill,mock.patch.object(h.os,'close') as close:
   with self.assertRaises(h.CaptureSetupFatal):h.capture_child(['not-run'],1)
   kill.assert_called_once_with(44,h.signal.SIGKILL);close.assert_called_once_with(44);child.wait.assert_called_once_with(timeout=2);selector.close.assert_called_once()
  for fd in (child.stdin,child.stdout,child.stderr):fd.close.assert_called()
 def test_selector_constructor_failure_also_covered(self):
  child=self.child()
  with mock.patch.object(h.subprocess,'Popen',return_value=child),mock.patch.object(h.os,'pidfd_open',return_value=44),mock.patch.object(h.selectors,'DefaultSelector',side_effect=OSError(24,'fdlimit')),mock.patch.object(h.signal,'pidfd_send_signal') as kill,mock.patch.object(h.os,'close') as close:
   with self.assertRaises(h.CaptureSetupFatal):h.capture_child(['not-run'],1)
   kill.assert_called_once_with(44,h.signal.SIGKILL);close.assert_called_once_with(44)
  for fd in (child.stdin,child.stdout,child.stderr):fd.close.assert_called()

class ContextAndCleanupPaths(unittest.TestCase):
 def test_actual_context_gate(self):
  c.verify_result_context(result_fixture(),N,I)
  for key in ('nonce','invocationId'):
   r={**result_fixture(),key:'c'*32}
   with self.assertRaises(AssertionError):c.verify_result_context(r,N,I)
 def test_cleanup_exception_still_restores_every_handler(self):
  callbacks={h.signal.SIGINT:object(),h.signal.SIGTERM:object()}
  with mock.patch.object(h.signal,'signal') as restore:
   with self.assertRaises(RuntimeError):h.cleanup_with_restored_handlers(mock.Mock(side_effect=RuntimeError('cleanup')),callbacks)
   self.assertEqual(restore.call_count,2)
   for sig,value in callbacks.items():restore.assert_any_call(sig,value)
 def test_prebookkeeping_final_gate_is_used_without_faking_inactive(self):
  p={'Id':NAME,'InvocationID':I,'ActiveState':'active','SubState':'exited','MainPID':'0','Result':'success'}
  w=result_fixture()
  self.assertTrue(c.verify_final_receipt(validate(fixture()),p,{'populated':0},[],False,w,pre_bookkeeping=True)['passed'])
  p['SubState']='running'
  with self.assertRaises(AssertionError):c.verify_final_receipt(validate(fixture()),p,{'populated':0},[],False,w,pre_bookkeeping=True)

class TerminalCollectionRace(unittest.TestCase):
 def test_terminal_reloads_receipt_published_during_state_read(self):
  record=result_fixture();read=mock.Mock(side_effect=[None,record]);state=mock.Mock(return_value={'SubState':'exited','ActiveState':'active'});pause=mock.Mock()
  got,observed=h.observe_until_terminal(read,state,24,clock=lambda:1,pause=pause)
  self.assertIs(got,record);self.assertEqual(read.call_count,2);state.assert_called_once();pause.assert_not_called()
  c.evaluate_case_result('core',got,event_fixture(),event_fixture(),True,MANAGER)
 def test_missing_terminal_receipt_is_not_invented(self):
  read=mock.Mock(return_value=None)
  got,_=h.observe_until_terminal(read,lambda:{'SubState':'failed','ActiveState':'failed'},24,clock=lambda:1,pause=mock.Mock())
  self.assertIsNone(got);self.assertEqual(read.call_count,2)
  with self.assertRaises(AssertionError):c.evaluate_case_result('core',got,event_fixture(),event_fixture(),True,MANAGER)
  with self.assertRaises(AssertionError):c.evaluate_case_result('memory',got,event_fixture(),event_fixture(),True,MANAGER)
 def test_final_read_schema_not_bypassed(self):
  bad={**result_fixture(),'extra':1};read=mock.Mock(side_effect=[None,bad])
  got,_=h.observe_until_terminal(read,lambda:{'SubState':'exited','ActiveState':'active'},24,clock=lambda:1,pause=mock.Mock())
  with self.assertRaises(AssertionError):c.evaluate_case_result('core',got,event_fixture(),event_fixture(),True,MANAGER)

if __name__=='__main__':unittest.main()
