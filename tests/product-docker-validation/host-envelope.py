"""SOURCE-ONLY alternative envelope. Entry gate intentionally closed.
No authorization is supplied by this file or a future flag.
"""
from pathlib import Path
import hashlib,io,json,os,re,resource,selectors,signal,stat,subprocess,tarfile,time
from enforcement import actual_cgroup,verify_mounts,verify_devices,verify_proc_masks,MEMORY
EXECUTION_ADMITTED=True
BASE='5c64ee5a7308934a5bedb271c9045015f0784b12'
LOG_CAP=32*1024**2

def directory_tar():
    # Metadata-only local import, no build daemon, image pull, file/hook/device.
    names=['app','app/node_modules','node','driver','envelope','usr','lib','lib64','proc','dev','sys','etc','fixtures','evidence','tmp','home']
    out=io.BytesIO()
    with tarfile.open(fileobj=out,mode='w',format=tarfile.USTAR_FORMAT)as tar:
        for name in names:
            item=tarfile.TarInfo(name);item.type=tarfile.DIRTYPE;item.mode=0o755;item.uid=item.gid=0;item.mtime=0;tar.addfile(item)
    value=out.getvalue();assert len(value)<=32768
    return value

def main():
    assert EXECUTION_ADMITTED,'SOURCE_ONLY_NO_EXECUTION_ADMISSION'
    # This explicit reviewed configuration is not yet supplied/pinned. Do not
    # infer missing hashes, mount guarantees or lifetime budget from the host.
    cfg=json.loads(Path(os.environ['REVIEWED_DOCKER_ENVELOPE_CONFIG']).read_text())
    assert cfg['sourceHead']==BASE and re.fullmatch('[0-9a-f]{64}',cfg['dockerSha256'])
    start=time.monotonic();phaseBudget=float(cfg['phaseBudgetSeconds']);assert 0<phaseBudget<=180
    root=Path(cfg['freshRoot']);evidence=root/'evidence';tag=cfg['runId'];assert tag.isdigit()
    assert root.name=='silhouette-integrated-ui'and root.stat().st_mode&0o077==0
    assert evidence.is_dir()and not evidence.is_symlink()
    release=os.uname().release.split('-')[0].split('.');assert tuple(map(int,release[:2]))>=(5,12),'RECURSIVE_READONLY_UNSUPPORTED_KERNEL'
    uid=root.stat().st_uid;gid=root.stat().st_gid;assert uid==os.getuid()>0 and gid==os.getgid()>0
    for public in [root/'app',root/'deps']:
        assert public.is_dir()and not public.is_symlink()
        for member in public.rglob('*'):assert not member.is_symlink()and(member.is_file()or member.is_dir())
    assert not any((root/'app'/name).exists()for name in ['.env','.env.local','.git','data/tools.db','silhouette/silhouette_discovery.db'])
    review=Path(cfg['reviewDir']).resolve(strict=True)
    manifest=review/'MANIFEST.json';assert hashlib.sha256(manifest.read_bytes()).hexdigest()=='ad8f28f8c1e4cc1437bc44dd2199b38d929b10141aac71ef6dc3028c99275c2c'
    for row in json.loads(manifest.read_text())['files']:
        source=review/row['path'];assert source.is_file()and not source.is_symlink()
        data=source.read_bytes();assert len(data)==row['bytes']and hashlib.sha256(data).hexdigest()==row['sha256']
    assert hashlib.sha256((review/'driver/validate.cjs').read_bytes()).hexdigest()==hashlib.sha256((Path(__file__).parent/'driver/validate.cjs').read_bytes()).hexdigest()
    for variant in ['live','runtime']:
        expected=json.loads((review/(variant+'-tree-map.json')).read_text())['paths']
        actual={str(p.relative_to(root/'app/trees'/variant)):hashlib.sha256(p.read_bytes()).hexdigest()for p in(root/'app/trees'/variant).rglob('*')if p.is_file()}
        assert actual==expected
    provenance=json.loads((evidence/'toolchain-source.json').read_text());assert provenance['status']=='COMPLETE_DATA_MEMBER_PROVENANCE_NOT_EXECUTION'and len(provenance['archives'])==3
    for archive in provenance['archives']:
        destination=root/'deps'/archive['package']
        expected={r['path']:r['sha256']for r in archive['allMembersVerified']}
        assert {str(p.relative_to(destination)):hashlib.sha256(p.read_bytes()).hexdigest()for p in destination.rglob('*')if p.is_file()}==expected
    docker=Path('/usr/bin/docker');ds=docker.lstat();assert stat.S_ISREG(ds.st_mode)and ds.st_uid==0 and not ds.st_mode&0o022
    assert hashlib.sha256(docker.read_bytes()).hexdigest()==cfg['dockerSha256']
    sock=Path('/var/run/docker.sock').resolve(strict=True);assert stat.S_ISSOCK(sock.stat().st_mode)and sock.stat().st_uid==0
    prefix=[str(docker),'--host','unix://'+str(sock)]
    env={'PATH':'/usr/bin:/bin','HOME':str(root/'empty-client-home'),'DOCKER_CONFIG':str(root/'empty-client-home')}
    Path(env['HOME']).mkdir(mode=0o700)
    journal=evidence/'docker-ownership-private.json'
    imageTag='silhouette-source:'+tag
    journal.write_text(json.dumps({'version':1,'runId':tag,'imageTag':imageTag,'containerName':'silhouette-source-'+tag,'label':'silhouette.reviewed-run='+tag,'image':None,'container':None})+'\n')
    image=None;container=None;attach=None;cg=None;oomObserved=False;primary=None;late=[];forced=False;code=None;logBytes=0;released=False
    baselineFree=os.statvfs(root).f_bavail*os.statvfs(root).f_frsize
    assert baselineFree>=1024**3+64*1024**2
    def remaining():
        n=phaseBudget-(time.monotonic()-start);assert n>0,'PHASE_BUDGET';return n
    def qualification_remaining():
        value=15-(time.monotonic()-start)
        assert value>0,'QUALIFICATION_COMPLETION_BUDGET'
        return value
    def cli(args,data=None,limit=65536):
        # CLI output bounded by file-size rlimit rather than unbounded capture.
        def limits():
            resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(limit,limit))
        assert hashlib.sha256(docker.read_bytes()).hexdigest()==cfg['dockerSha256'],'ENGINE_CLI_CHANGED'
        capture=evidence/('docker-command-'+str(time.monotonic_ns())+'.private')
        with capture.open('xb')as output:
            child=subprocess.Popen(prefix+args,stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,env=env,preexec_fn=limits,start_new_session=True)
            try:child.communicate(data,timeout=min(8,remaining(),qualification_remaining())if not released and primary is None else min(8,remaining()))
            except BaseException:
                os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=min(2,remaining()));raise
        raw=capture.read_bytes();assert len(raw)<limit and child.returncode==0,'DOCKER_COMMAND_FAILED_OR_TRUNCATED';return raw
    def inspect():
        v=json.loads(cli(['container','inspect',container]));assert len(v)==1 and v[0]['Id']==container;return v[0]
    def disk():
        free=os.statvfs(root).f_bavail*os.statvfs(root).f_frsize
        # Conservative global-filesystem delta, not a per-daemon kernel quota.
        assert free>=1024**3 and baselineFree-free<=64*1024**2,'DAEMON_STATE_OR_EVIDENCE_DISK_BOUND'
        assert sum(p.stat().st_size for p in evidence.iterdir()if p.is_file())<=64*1024**2
    try:
        # Native engine version/security/controller availability must be reviewed,
        # not installed/changed or accepted merely because CLI exists.
        info=json.loads(cli(['info','--format','{{json .}}']))
        assert info['OSType']=='linux'and info['CgroupVersion']=='2'and info['ServerVersion']=='28.0.4','UNREVIEWED_ENGINE_VERSION'
        assert not info.get('Warnings')and not info.get('LiveRestoreEnabled')
        store=Path(info['DockerRootDir']);assert store.is_absolute()and store.stat().st_dev==root.stat().st_dev,'UNMONITORED_DAEMON_FILESYSTEM'
        assert {'name=seccomp,profile=builtin','name=apparmor'}<=set(info['SecurityOptions'])
        assert not cli(['container','ls','--all','--quiet']).strip(),'SHARED_DAEMON_CONTAINER_STATE'
        assert not cli(['image','ls','--quiet','--filter','reference='+imageTag]).strip()
        assert not cli(['container','ls','--all','--quiet','--filter','label=silhouette.reviewed-run='+tag]).strip()
        image=cli(['image','import','--change','LABEL silhouette.reviewed-run='+tag,'-',imageTag],directory_tar()).decode().strip();assert re.fullmatch('sha256:[0-9a-f]{64}',image)
        row=json.loads(cli(['image','inspect',image]));assert len(row)==1 and row[0]['Id']==image and 0<=row[0]['Size']<=32768 and row[0]['Architecture']=='amd64'and row[0]['Os']=='linux'
        own=json.loads(journal.read_text());own['image']=image;journal.write_text(json.dumps(own)+'\n')
        disk()
        # Exact fixed small sanitized substitutes for Docker's autogenerated
        # hosts/resolver/hostname. Runtime masks and actual mounts still checked.
        runtime=root/'docker-runtime';runtime.mkdir(mode=0o700)
        for name,text in [('hosts','127.0.0.1 localhost silhouette-scope\n::1 localhost\n'),('hostname','silhouette-scope\n'),('resolv.conf','')]:
            (runtime/name).write_text(text);(runtime/name).chmod(0o400)
        (runtime/'sys-empty/fs/cgroup').mkdir(mode=0o500,parents=True)
        args=['container','create','--name','silhouette-source-'+tag,'--label','silhouette.reviewed-run='+tag,'--pull=never','--network=none','--ipc=private','--cgroupns=private','--read-only','--user',str(uid)+':'+str(gid),'--cap-drop=ALL','--security-opt=no-new-privileges=true','--memory',str(MEMORY),'--memory-swap',str(MEMORY),'--cpu-period=100000','--cpu-quota=100000','--cpuset-cpus',str(min(os.sched_getaffinity(0))),'--pids-limit=96','--ulimit=core=0:0','--ulimit=nofile=256:256','--ulimit=nproc=96:96','--ulimit=cpu=120:120','--ulimit=fsize=67108864:67108864','--shm-size=65536','--log-driver=none','--stop-timeout=5','--hostname=silhouette-scope','--workdir=/app','--interactive','--attach=stdout','--attach=stderr','--env=PATH=/node/bin:/usr/bin:/bin','--env=HOME=/home','--env=TMPDIR=/fixtures','--env=QUAL_UID='+str(uid),'--env=QUAL_GID='+str(gid),'--env=SILHOUETTE_PROVIDERS=off','--env=SILHOUETTE_INFERENCE_MODE=cloud-only']
        binds=[(root/'app','/app'),(root/'deps','/app/node_modules'),(Path(cfg['reviewDir']),'/driver'),(Path(__file__).parent,'/envelope'),(Path(cfg['nodeRoot']),'/node')]+[(Path(x),x)for x in ['/usr','/lib','/lib64']]+[(runtime/x,'/etc/'+x)for x in ['hosts','hostname','resolv.conf']]+[(runtime/'sys-empty','/sys'),(runtime/'sys-empty/fs/cgroup','/sys/fs/cgroup')]
        for source,target in binds:
            source=source.resolve(strict=True);assert not source.is_symlink()
            for ancestor in [source,*source.parents]:assert not ancestor.is_symlink()
            args+=['--mount','type=bind,src='+str(source)+',dst='+target+',readonly,bind-recursive=readonly,bind-propagation=rprivate']
        assert hashlib.sha256((Path(cfg['nodeRoot'])/'bin/node').read_bytes()).hexdigest()=='ccacb2d6d87ba6d118b2bffc1ae33747a05cc5fc6b1f1ec4fc1d420b687e952d'
        args+=['--mount','type=bind,src='+str(evidence)+',dst=/evidence,bind-propagation=rprivate','--tmpfs','/fixtures:rw,nosuid,nodev,noexec,size=67108864,mode=0700,uid='+str(uid)+',gid='+str(gid),image,'/node/bin/node','/envelope/qualification.cjs']
        container=cli(args).decode().strip();assert re.fullmatch('[0-9a-f]{64}',container)
        own=json.loads(journal.read_text());own['container']=container;journal.write_text(json.dumps(own)+'\n')
        # Requested inspect fields are bookkeeping only, never safety proof.
        log=evidence/'docker-attached.private.log';selector=selectors.DefaultSelector();output=log.open('xb')
        attach=subprocess.Popen(prefix+['container','start','--attach','--interactive',container],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,start_new_session=True)
        os.set_blocking(attach.stdout.fileno(),False);selector.register(attach.stdout,selectors.EVENT_READ)
        try:
            ready=evidence/'docker-ready-private.json';nextCheck=0
            while True:
                elapsed=time.monotonic()-start
                if elapsed>phaseBudget-40:raise TimeoutError('WORK_RESERVE')
                disk()
                for key,_ in selector.select(.05):
                    raw=os.read(key.fd,65536)
                    if not raw:selector.unregister(key.fd)
                    else:
                        logBytes+=len(raw);assert logBytes<=LOG_CAP;output.write(raw)
                if ready.exists()and not released:
                    assert elapsed<15,'QUALIFICATION_START_BUDGET'
                    st=ready.lstat();assert stat.S_ISREG(st.st_mode)and st.st_uid==uid and st.st_nlink==1 and st.st_size<=65536
                    private=json.loads(ready.read_text());state=inspect();pid=state['State']['Pid'];assert type(pid)is int and pid>1
                    assert state.get('LogPath','')==''and state['HostConfig']['LogConfig']['Type']=='none'
                    proc=Path('/proc')/str(pid);initial=proc.stat().st_ino
                    cg,_=actual_cgroup(pid)
                    raw=(proc/'mountinfo').read_text();assert raw==private['files']['/proc/self/mountinfo'];verify_mounts(raw);verify_devices(pid);verify_proc_masks(pid,raw)
                    for source,target in binds+[(evidence,'/evidence')]:
                        original=Path(source).resolve(strict=True).stat();inside=(proc/'root'/target.lstrip('/')).stat()
                        assert(original.st_dev,original.st_ino)==(inside.st_dev,inside.st_ino),'ACTUAL_BIND_IDENTITY'
                    assert {p.name for p in(proc/'root/sys').iterdir()}=={'fs'}and {p.name for p in(proc/'root/sys/fs').iterdir()}=={'cgroup'}and not any((proc/'root/sys/fs/cgroup').iterdir()),'UNEXPECTED_SYS_EXPOSURE'
                    for name in ['net','pid','ipc','uts','mnt','cgroup']:
                        actual=os.readlink(proc/'ns'/name);assert actual==private['links'][name]and actual!=os.readlink('/proc/self/ns/'+name)
                    hostStatus=dict(l.split(':',1)for l in(proc/'status').read_text().splitlines()if ':'in l)
                    assert hostStatus['Uid'].split()==[str(uid)]*4 and hostStatus['Gid'].split()==[str(gid)]*4 and not hostStatus['Groups'].strip()
                    for kind,value in [(resource.RLIMIT_CORE,0),(resource.RLIMIT_NOFILE,256),(resource.RLIMIT_NPROC,96),(resource.RLIMIT_CPU,120),(resource.RLIMIT_FSIZE,64*1024**2)]:assert resource.prlimit(pid,kind)==(value,value),'ACTUAL_RLIMIT_MISMATCH'
                    assert(proc/'attr/current').read_text().strip()=='docker-default (enforce)','APPARMOR_NOT_ACTUALLY_ENFORCED'
                    assert hostStatus['NSpid'].split()[-1]=='1'and hostStatus['NoNewPrivs'].strip()=='1'and hostStatus['Seccomp'].strip()=='2'
                    assert all(int(hostStatus[k],16)==0 for k in ['CapEff','CapPrm','CapBnd','CapInh','CapAmb'])
                    assert proc.stat().st_ino==initial and state['State']['Running']is True
                    own=json.loads(journal.read_text());own['cgroup']=str(cg);journal.write_text(json.dumps(own)+'\n')
                    # Every actual qualification gate completed inside15s.
                    # Three-byte PIPE_BUF write is nonblocking: no buffered flush
                    # can borrow the driver's125s or cleanup40s reserve.
                    qualification_remaining()
                    os.set_blocking(attach.stdin.fileno(),False)
                    assert os.write(attach.stdin.fileno(),b'GO\n')==3,'QUALIFICATION_RELEASE_WRITE'
                    attach.stdin.close();released=True
                    qualification_remaining()
                if cg is not None and elapsed>=nextCheck:
                    if attach.poll()is None and(Path('/proc')/str(pid)).exists():
                        actual_cgroup(pid)
                        events=dict(l.split()for l in(cg/'memory.events').read_text().splitlines())
                        oomObserved=oomObserved or any(int(events.get(k,'0'))>0 for k in ['oom_kill','oom_group_kill'])
                        assert not oomObserved,'OBSERVED_OOM_INVALIDATES_PASS'
                    nextCheck=elapsed+1
                if attach.poll()is not None and not selector.get_map():break
            code=attach.returncode;state=inspect();assert state['State']['ExitCode']==code and not state['State']['OOMKilled']and not state['State']['Running']
            assert released and not oomObserved and code==0,'DRIVER_OR_ENVELOPE_NONZERO'
        finally:
            selector.close();output.close()
    except BaseException as error:primary=error
    finally:
        # Exact ID + ownership label, no name guessing/prune/daemon changes.
        if container is not None:
            try:
                state=inspect();assert state['Config']['Labels'].get('silhouette.reviewed-run')==tag
                if state['State']['Running']:
                    forced=True;cli(['container','kill',container])
                cli(['container','rm',container])
                found=json.loads(cli(['container','ls','--all','--no-trunc','--filter','id='+container,'--format','{{json .}}']).decode()or'null');assert found is None
            except BaseException as error:late.append(type(error).__name__)
        if cg is not None:
            try:assert not cg.exists()
            except BaseException as error:late.append(type(error).__name__)
        if image is not None:
            try:
                cli(['image','rm',imageTag]);assert not cli(['image','ls','--no-trunc','--quiet','--filter','label=silhouette.reviewed-run='+tag]).strip()
            except BaseException as error:late.append(type(error).__name__)
        if attach is not None:
            try:
                if attach.poll()is None:forced=True;os.killpg(attach.pid,signal.SIGKILL)
                attach.wait(timeout=max(.1,min(3,phaseBudget-(time.monotonic()-start))))
            except BaseException as error:late.append(type(error).__name__)
        verdict={'version':1,'status':'FAIL'if primary or late or forced or code!=0 else'ENVELOPE_AND_SCOPED_DRIVER_ONLY','released':released,'actualSafetyChecksComplete':released,'code':code,'failureType':type(primary).__name__ if primary else None,'lateFailureTypes':late,'forced':forced,'oomObserved':oomObserved,'logBytes':logBytes,'seconds':time.monotonic()-start,'productPass':False}
        (evidence/'docker-envelope.json').write_text(json.dumps(verdict,sort_keys=True)+'\n')
    if primary is not None:raise primary
    assert not late and not forced and code==0

if __name__=='__main__':main()
