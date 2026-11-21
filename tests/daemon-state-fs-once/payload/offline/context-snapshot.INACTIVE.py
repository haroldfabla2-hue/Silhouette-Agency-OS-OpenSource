"""One authenticated read-only context snapshot, no root/product token transfer.
No CLI. collect() runs unprivileged immediately before batch, then the workflow
transfers the fixed file to root ownership and passes its hash plus event values.
Root validates custody and a maximum 30s age, no repeat anonymous API reads.
"""
import hashlib,json,os,re,stat,time,urllib.request,urllib.error
from pathlib import Path
REPOSITORY='haroldfabla2-hue/Silhouette-Agency-OS-OpenSource'
BRANCH='fix/shutdown-contracts-narrow-20261117'
MAX_AGE_NS=30000000000


def need(ok,code):
    if not ok:raise RuntimeError(code)


def normalize(run,job,listed,expected,started):
    need(expected['runnerEnvironment']=='github-hosted' and expected['runAttempt']==1,'STANDARD_HOSTED_JOB_REQUIRED')
    need(type(expected['runId']) is int and expected['runId']>0 and
         re.fullmatch('[a-f0-9]{40}',expected['eventHead']) is not None,'HOSTED_EXPECTED_SCHEMA')
    need(run['id']==expected['runId'] and run['head_sha']==expected['eventHead'] and run['run_attempt']==1 and
         run['status']=='in_progress' and run['event']=='push' and run['head_branch']==BRANCH and
         run['repository']['full_name']==REPOSITORY,'HOSTED_RUN_BINDING')
    keys=('id','run_id','run_attempt','status','name','labels','runner_group_name','runner_name','runner_id')
    a={k:job[k] for k in keys};b={k:listed[k] for k in keys}
    need(a==b,'HOSTED_JOB_LIST_MISMATCH')
    need(job['run_id']==run['id'] and job['run_attempt']==1 and job['status']=='in_progress' and
         job['name']=='daemon-state-fs' and job['labels']==['ubuntu-24.04'] and
         job['runner_group_name']=='GitHub Actions' and job['runner_name']==expected['runnerName'] and
         type(job['runner_id']) is int and job['runner_id']>0 and type(job['id']) is int and job['id']>0,
         'STANDARD_HOSTED_VM_BINDING')
    # Explicit scalar projection, never raw response, headers, token or environment.
    return {'schemaVersion':1,'runId':run['id'],'runAttempt':1,'jobId':job['id'],
        'runnerName':job['runner_name'],'runnerEnvironment':'github-hosted','eventHead':run['head_sha'],
        'repository':REPOSITORY,'branch':BRANCH,'event':'push','runStatus':'in_progress',
        'jobStatus':'in_progress','jobName':'daemon-state-fs','labels':['ubuntu-24.04'],
        'runnerGroup':'GitHub Actions','runnerId':job['runner_id'],
        'readStartedMonotonicNs':started,'readFinishedMonotonicNs':time.monotonic_ns(),
        'validationMode':'AUTHENTICATED_STEP_SNAPSHOT_NOT_ROOT_API_REFRESH'}


def validate(value,expected,now):
    keys={'schemaVersion','runId','runAttempt','jobId','runnerName','runnerEnvironment','eventHead',
          'repository','branch','event','runStatus','jobStatus','jobName','labels','runnerGroup','runnerId',
          'readStartedMonotonicNs','readFinishedMonotonicNs','validationMode'}
    need(isinstance(value,dict) and set(value)==keys,'CONTEXT_SNAPSHOT_SCHEMA')
    need(value['schemaVersion']==1 and value['validationMode']=='AUTHENTICATED_STEP_SNAPSHOT_NOT_ROOT_API_REFRESH','CONTEXT_SNAPSHOT_MODE')
    for key in ('runId','runAttempt','jobId','runnerName','runnerEnvironment','eventHead'):
        need(value[key]==expected[key],'CONTEXT_SNAPSHOT_EVENT_BINDING')
    need(value['repository']==REPOSITORY and value['branch']==BRANCH and value['event']=='push' and
         value['runStatus']==value['jobStatus']=='in_progress' and value['runAttempt']==1 and
         value['runnerEnvironment']=='github-hosted' and value['jobName']=='daemon-state-fs' and
         value['labels']==['ubuntu-24.04'] and value['runnerGroup']=='GitHub Actions' and
         type(value['runnerId']) is int and value['runnerId']>0,'CONTEXT_SNAPSHOT_HOSTED_BINDING')
    start=value['readStartedMonotonicNs'];finish=value['readFinishedMonotonicNs']
    need(type(start) is int and type(finish) is int and 0<start<=finish<=now and now-start<=MAX_AGE_NS,
         'CONTEXT_SNAPSHOT_STALE_OR_FUTURE')
    return value


def read_for_root(path,expected):
    need(re.fullmatch('[a-f0-9]{64}',expected['snapshotSha256']) is not None,'CONTEXT_EXPECTED_HASH_SCHEMA')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        before=os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid==0 and stat.S_IMODE(before.st_mode)==0o600 and
             before.st_nlink==1 and 0<before.st_size<=32768,'CONTEXT_SNAPSHOT_CUSTODY')
        raw=os.read(fd,32769);after=os.fstat(fd)
        need(len(raw)==before.st_size and (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==
             (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'CONTEXT_SNAPSHOT_CHANGED')
    finally:os.close(fd)
    need(hashlib.sha256(raw).hexdigest()==expected['snapshotSha256'],'CONTEXT_SNAPSHOT_HASH_MISMATCH')
    return validate(json.loads(raw),expected,time.monotonic_ns())


def collect(path,expected):
    # No retry, no anonymous fallback, no redirects carrying auth elsewhere.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args):return None
    token=os.environ.pop('GH_TOKEN');started=time.monotonic_ns();opener=urllib.request.build_opener(NoRedirect)
    def get(route):
        req=urllib.request.Request('https://api.github.com/repos/'+REPOSITORY+route,
            headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'})
        try:
            with opener.open(req,timeout=5) as response:
                raw=response.read(262145);need(len(raw)<=262144,'HOSTED_API_REPLY_BOUND')
        except urllib.error.HTTPError as error:
            raise RuntimeError('HOSTED_API_HTTP_'+str(error.code)) from None
        return json.loads(raw)
    try:
        run_id=expected['runId'];rows=get('/actions/runs/'+str(run_id)+'/jobs?per_page=100')
        need(rows['total_count']<=100,'HOSTED_JOB_LIST_BOUND')
        matches=[j for j in rows['jobs'] if j['name']=='daemon-state-fs' and j['status']=='in_progress' and
                 j['runner_name']==expected['runnerName']]
        need(len(matches)==1,'HOSTED_JOB_LIST_IDENTITY')
        listed=matches[0];run=get('/actions/runs/'+str(run_id));job=get('/actions/jobs/'+str(listed['id']))
        value=normalize(run,job,listed,expected,started)
    finally:del token
    raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode();need(len(raw)<=32768,'CONTEXT_SNAPSHOT_BOUND')
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:need(os.write(fd,raw)==len(raw),'CONTEXT_SNAPSHOT_SHORT_WRITE');os.fsync(fd)
    finally:os.close(fd)
    return {'snapshotSha256':hashlib.sha256(raw).hexdigest(),'jobId':value['jobId']}


if __name__=='__main__':raise SystemExit('INACTIVE: review-only context handoff')
