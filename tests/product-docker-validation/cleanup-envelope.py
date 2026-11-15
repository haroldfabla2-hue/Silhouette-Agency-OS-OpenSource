"""SOURCE ONLY independent15-second exact-run cleanup, no image/container creation.
Run only after separate review/admission. Never daemon-wide prune.
"""
from pathlib import Path
import json,os,re,resource,subprocess,time
EXECUTION_ADMITTED=True

def main():
    assert EXECUTION_ADMITTED,'SOURCE_ONLY_NO_EXECUTION_ADMISSION'
    start=time.monotonic();tag=os.environ['GITHUB_RUN_ID'];assert re.fullmatch('[0-9]+',tag)
    root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui/evidence';rows=[];errors=[];emergency=False
    # Fixed explicit local socket; no inherited Docker context/credentials.
    cmd=['/usr/bin/docker','--host','unix://'+str(Path('/var/run/docker.sock').resolve(strict=True))]
    def call(args):
        n=15-(time.monotonic()-start);assert n>0
        path=root/('docker-cleanup-'+str(time.monotonic_ns())+'.private')
        def limits():resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
        with path.open('xb')as out:
            p=subprocess.Popen(cmd+args,stdout=out,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,env={'PATH':'/usr/bin:/bin'},start_new_session=True,preexec_fn=limits)
            try:p.wait(timeout=min(5,n))
            except BaseException:
                import signal
                os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=1);raise
        raw=path.read_bytes();assert p.returncode==0 and len(raw)<65536
        return raw
    try:
        # Includes objects whose create/import response was ambiguous or lost.
        ids=call(['container','ls','--all','--no-trunc','--quiet','--filter','label=silhouette.reviewed-run='+tag]).decode().split();assert len(ids)<=1
        for identity in ids:
            try:
                assert re.fullmatch('[0-9a-f]{64}',identity)
                v=json.loads(call(['container','inspect',identity]))[0]
                assert v['Id']==identity and v['Name']=='/silhouette-source-'+tag and v['Config']['Labels'].get('silhouette.reviewed-run')==tag
                if v['State']['Running']:emergency=True;call(['container','kill',identity])
                call(['container','rm',identity]);rows.append({'kind':'container','removed':True})
            except BaseException as e:errors.append(type(e).__name__)
    except BaseException as e:errors.append(type(e).__name__)
    try:
        ids=call(['image','ls','--no-trunc','--quiet','--filter','label=silhouette.reviewed-run='+tag]).decode().split();assert len(set(ids))<=1
        for identity in set(ids):
            try:
                assert re.fullmatch('sha256:[0-9a-f]{64}',identity)
                v=json.loads(call(['image','inspect',identity]))[0]
                assert v['Id']==identity and v['Config']['Labels'].get('silhouette.reviewed-run')==tag and v['RepoTags']==['silhouette-source:'+tag]
                call(['image','rm','silhouette-source:'+tag]);rows.append({'kind':'image','removed':True})
            except BaseException as e:errors.append(type(e).__name__)
    except BaseException as e:errors.append(type(e).__name__)
    absent=False
    try:
        absent=not call(['container','ls','--all','--no-trunc','--quiet','--filter','label=silhouette.reviewed-run='+tag]).strip()and not call(['image','ls','--no-trunc','--quiet','--filter','label=silhouette.reviewed-run='+tag]).strip()
    except BaseException as e:errors.append(type(e).__name__)
    try:
        journal=json.loads((root/'docker-ownership-private.json').read_text())
        assert journal['runId']==tag
        if 'cgroup'in journal:
            path=Path(journal['cgroup']);assert path.is_relative_to(Path('/sys/fs/cgroup'))and path!=Path('/sys/fs/cgroup')
            assert not path.exists()
    except BaseException as e:errors.append(type(e).__name__)
    # Host wrapper also checks exact cgroup absence. A cleanup enumeration
    # failure/forced kill stays failure, even if later resources are absent.
    out={'version':1,'status':'CLEAN'if absent and not emergency and not errors else'FAIL','absent':absent,'forced':emergency,'errors':len(errors),'resources':rows,'productPass':False}
    (root/'docker-outer-cleanup.json').write_text(json.dumps(out,sort_keys=True)+'\n')
    assert out['status']=='CLEAN'
if __name__=='__main__':main()
