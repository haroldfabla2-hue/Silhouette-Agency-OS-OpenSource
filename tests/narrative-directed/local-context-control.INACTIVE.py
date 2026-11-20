"""Finite data validation and real temporary custody rejection controls.
No network, mock host, product or infrastructure. Normalized API-shaped input
is test data, not a claim of observed host success or API authorization.
"""
import importlib.util,pathlib,tempfile,time,json,hashlib,copy,os
D=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('ctx',D/'context-snapshot.INACTIVE.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
now=time.monotonic_ns();expected={'runId':123,'runAttempt':1,'jobId':456,'runnerName':'local-data-control',
 'runnerEnvironment':'github-hosted','eventHead':'a'*40}
run={'id':123,'head_sha':'a'*40,'run_attempt':1,'status':'in_progress','event':'push','head_branch':m.BRANCH,
 'repository':{'full_name':m.REPOSITORY},'extraPrivateField':'DO_NOT_TRANSFER'}
job={'id':456,'run_id':123,'run_attempt':1,'status':'in_progress','name':'directed-narrative','labels':['ubuntu-24.04'],
 'runner_group_name':'GitHub Actions','runner_name':'local-data-control','runner_id':789,'authorization':'NEVER_TRANSFER'}
value=m.normalize(run,job,copy.deepcopy(job),expected,now)
assert m.validate(value,expected,time.monotonic_ns())==value
raw=json.dumps(value).encode();assert b'DO_NOT_TRANSFER' not in raw and b'NEVER_TRANSFER' not in raw and b'authorization' not in raw
cases=0

def rejects(call,code):
 global cases
 try:call()
 except Exception as error:assert type(error).__name__==code or str(error)==code,(code,type(error).__name__,str(error))
 else:raise AssertionError('INVALID_INPUT_ACCEPTED')
 cases+=1

for key,item in [('eventHead','b'*40),('jobId',457),('runnerName','wrong'),('runId',124)]:
 changed={**value,key:item};rejects(lambda:m.validate(changed,expected,time.monotonic_ns()),'CONTEXT_SNAPSHOT_EVENT_BINDING')
changed={**value,'readStartedMonotonicNs':time.monotonic_ns()-m.MAX_AGE_NS-1};rejects(lambda:m.validate(changed,expected,time.monotonic_ns()),'CONTEXT_SNAPSHOT_STALE_OR_FUTURE')
changed={**value,'readFinishedMonotonicNs':time.monotonic_ns()+1000000000};rejects(lambda:m.validate(changed,expected,time.monotonic_ns()),'CONTEXT_SNAPSHOT_STALE_OR_FUTURE')
rejects(lambda:m.validate({**value,'authorization':'NO'},expected,time.monotonic_ns()),'CONTEXT_SNAPSHOT_SCHEMA')
rejects(lambda:m.validate(None,expected,time.monotonic_ns()),'CONTEXT_SNAPSHOT_SCHEMA')
rejects(lambda:m.normalize(run,job,{**job,'runner_id':0},expected,now),'HOSTED_JOB_LIST_MISMATCH')
with tempfile.TemporaryDirectory(prefix='public-context-custody-') as tmp:
 root=pathlib.Path(tmp);p=root/'snapshot';p.write_bytes(raw);p.chmod(0o644)
 ex={**expected,'snapshotSha256':hashlib.sha256(raw).hexdigest()}
 rejects(lambda:m.read_for_root(root/'absent',ex),'FileNotFoundError')
 rejects(lambda:m.read_for_root(p,ex),'CONTEXT_SNAPSHOT_CUSTODY')
 alias=root/'alias';alias.symlink_to(p)
 rejects(lambda:m.read_for_root(alias,ex),'OSError')
 # Success read_for_root is deliberately NOT claimed on an unprivileged owner.
 # Actual root-owned custody can only be validated by root on its later job.
print(json.dumps({'kind':'LOCAL_CONTEXT_DATA_AND_CUSTODY_REJECTION_NOT_API_OR_HOST_TEST',
 'rejections':cases,'normalizedProjectionExcludesExtraCredentials':True,'dataBindingAndAgeChecks':True,
 'realAbsentFileSymlinkAndUnsafeModeRejected':True,'rootOwnedSuccessfulReadUnverified':True,
 'networkOrProductOrHostMutation':False},sort_keys=True))
