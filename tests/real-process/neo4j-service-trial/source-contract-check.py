"""Offline syntax/data check only. Does not import entry/product or grant dispatch."""
import ast,json,pathlib,hashlib
root=pathlib.Path(__file__).parent
source=root/'joint_service_entry.py'
tree=ast.parse(source.read_text())
values=[n.value.value for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='ENTRY_SOURCE_STATE_REQUIRED'for t in n.targets)and isinstance(n.value,ast.Constant)]
assert values==['EXACT_JOINT_SOURCE_REVIEW_CLOSED']
inputs=json.loads((root/'joint-entry-inputs.json').read_text())
assert inputs['operational_state']==values[0],'entry/input source-review contract mismatch'
assert inputs['redis_main_native_gate']=='UNSUPPORTED_PUBLIC_JOIN_API_RETAIN_GLOBAL_INCOMPLETE'
assert inputs['experiment_scope']=='FUNCTIONAL_PARTIAL_REDIS_LIFECYCLE_INCOMPLETE'
for name,sha in inputs['entry_sources'].items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==sha
assert any(isinstance(n,ast.Assert)and isinstance(n.test,ast.Compare)and any(isinstance(x,ast.Name)and x.id=='ENTRY_SOURCE_STATE_REQUIRED'for x in n.test.comparators)for n in ast.walk(tree))
print('ENTRY_INPUT_STATIC_CONTRACT_CONSISTENT_NOT_DISPATCH_AUTHORITY')
