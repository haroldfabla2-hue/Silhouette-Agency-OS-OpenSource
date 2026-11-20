"""INACTIVE direct real Narrative writer/reader, systemd owns containment.
No Docker, runtime inventory, custom watcher, cgroup ABI parser or shell gate.
Explicit invocation only after separate source/event review. Public fixture only.
"""
from pathlib import Path
import hashlib,json,os,re,secrets,subprocess,tarfile,time
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}
ARCHIVE_SHA='119565c089bfc576ee9a96c5c785dba4eebdcdce9117c63ea3d3a41c4ab52e39'
CONFIG_ID='sha256:9b7d1917ba3e5d20c83a01e3345bb78430b5e6c99030098a944b64f1b9005382'
MANIFEST_SHA='debf0c3eb2dab9fb902e6c65e5dbcc1cb27276f21e33053ae187de2d84790041'
ENTRY_SHA='1910f6e4cd873fe4ef1d2fabfac03331642c16fdc7c03e38fc8af0be52ccfb9f'
GUARD_SHA='50d21436e62b0ae62619b1396013298f4e1134ae2c293a207382978501e3f694'
DERIVED_MANIFEST_SHA='f576336c1f7e2796f4d7263ee7adf80e47edee446e123ac7d994844605a62b5c'
DIAGNOSTIC_FILES={'entry.DIAGNOSTIC.INACTIVE.mjs': '713e459ccddca9fa10ee8317bd876f43331c063fa106b5434bee25d7ae64715c', 'phase-observer.INACTIVE.mjs': '47e16a675cf67c6d1e03cf411924d79f8750401a31d7bb08f5374efba9d45cbc', 'diagnostic-source-table.json': '09bbd181e0bcdc8ce719b6e3813b7ef72d481bb99308e0dbe86fa9084ec96315', 'diagnostic-projection.INACTIVE.py': '2860cfde59d892e444c13a08ea274bf559dd17cb0700179199d64cc2d8c17864', 'diagnostic-targets.json': '85e13cb79d467b184ef16ec760a698cb30dcb29ca860b5424c90103095a1a9ff'}
CONTEXT_SHA='9f2ca63ac485694eb25815be0206e4ba99ad6184a4116217b4807cbc9d2165ea'


def need(ok,code):
    if not ok:raise RuntimeError(code)


def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1048576),b''):h.update(chunk)
    return h.hexdigest()


def durable(path,value):
    path=Path(path);raw=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
    temporary=path.with_suffix('.tmp')
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:need(os.write(fd,raw)==len(raw),'RECEIPT_SHORT_WRITE');os.fsync(fd)
    finally:os.close(fd)
    os.replace(temporary,path)
    directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(directory)
    finally:os.close(directory)


def command(*args,timeout=5):
    result=subprocess.run(args,env=ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                          timeout=timeout,check=False)
    need(len(result.stdout)<=262144 and len(result.stderr)<=65536,'HOST_REPLY_BOUND')
    need(result.returncode==0,'HOST_COMMAND_FAILED')
    return result.stdout.decode().strip()


def extract_reviewed(archive,manifest,guard,derived_manifest,destination):
    """Read pinned archive directly. No reassembly/download/product evaluation."""
    need(digest(archive)==ARCHIVE_SHA and digest(manifest)==MANIFEST_SHA,'PUBLIC_PAYLOAD_PIN')
    rows=json.loads(Path(manifest).read_text());expected={r['target'].lstrip('/'):r for r in rows}
    need(len(expected)==5982,'PUBLIC_PAYLOAD_COUNT')
    root=Path(destination);root.mkdir(mode=0o755)
    with tarfile.open(archive,'r:') as saved:
        table=json.load(saved.extractfile('manifest.json'));need(len(table)==1 and table[0]['Layers']==['layer.tar'],'ARCHIVE_LAYOUT')
        config=saved.extractfile(table[0]['Config']).read();need('sha256:'+hashlib.sha256(config).hexdigest()==CONFIG_ID,'IMAGE_CONFIG_PIN')
        seen=set()
        with saved.extractfile('layer.tar') as stream,tarfile.open(fileobj=stream,mode='r|') as layer:
            for row in layer:
                p=Path(row.name);need(not p.is_absolute() and '..' not in p.parts and row.name not in seen,'PAYLOAD_PATH')
                seen.add(row.name);target=root/p
                need(row.isdir() or row.isfile(),'PAYLOAD_TYPE')
                if row.isdir():target.mkdir(mode=0o755,parents=True,exist_ok=True);continue
                wanted=expected[row.name];need(row.size==wanted['bytes'] and row.mode==wanted['mode'],'PAYLOAD_METADATA')
                target.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
                h=hashlib.sha256()
                with layer.extractfile(row) as source,target.open('xb') as output:
                    for chunk in iter(lambda:source.read(1048576),b''):h.update(chunk);output.write(chunk)
                need(h.hexdigest()==wanted['sha256'],'PAYLOAD_FILE_HASH');target.chmod(row.mode)
    need(set(expected)<=seen and digest(root/'app/entry.INACTIVE.mjs')==ENTRY_SHA,'PAYLOAD_ENTRY_PIN')
    need(digest(guard)==GUARD_SHA and digest(derived_manifest)==DERIVED_MANIFEST_SHA,'INSTRUMENTATION_DELTA_PIN')
    # Derive instrumentation and the separately pinned public ingestion addition after all original pins pass.
    (root/'app/native-selection-guard.cjs').write_bytes(Path(guard).read_bytes())
    derived=json.loads(Path(derived_manifest).read_text())
    source=Path(__file__).parent
    destinations={'entry.DIAGNOSTIC.INACTIVE.mjs':'app/entry.INACTIVE.mjs',
        'phase-observer.INACTIVE.mjs':'app/phase-observer.INACTIVE.mjs','diagnostic-source-table.json':'app/diagnostic-source-table.json','diagnostic-targets.json':'app/diagnostic-targets.json'}
    for name,wanted in DIAGNOSTIC_FILES.items():need(digest(source/name)==wanted,'DIAGNOSTIC_SOURCE_PIN')
    for name,target in destinations.items():(root/target).write_bytes((source/name).read_bytes())
    addition=source/'ingestionService.EMITTED.js'
    need(digest(addition)=='b96560a8e9869b3a1f9c46de0f9a307255042dffa4a7dc82057186bebe7180e6','PUBLIC_TARGET_ADDITION_PIN')
    (root/'app/services/ingestionService.js').write_bytes(addition.read_bytes())
    before_by_path={r['target']:r for r in rows};after_by_path={r['target']:r for r in derived}
    need(len(derived)==len(rows)+4 and len(after_by_path)==len(derived),'DERIVED_FILE_COUNT')
    changed={'/app/native-selection-guard.cjs','/app/entry.INACTIVE.mjs','/app/phase-observer.INACTIVE.mjs','/app/diagnostic-source-table.json','/app/diagnostic-targets.json','/app/services/ingestionService.js'}
    need(set(after_by_path)==set(before_by_path)|{'/app/phase-observer.INACTIVE.mjs','/app/diagnostic-source-table.json','/app/diagnostic-targets.json','/app/services/ingestionService.js'},'DERIVED_PATH_SET')
    for path,row in after_by_path.items():
        if path not in changed:need(row==before_by_path[path],'UNEXPECTED_PRODUCT_DELTA')
        file=root/path.lstrip('/')
        need(digest(file)==row['sha256'] and file.stat().st_size==row['bytes'],'DERIVED_FILE_PIN');file.chmod(row['mode'])
    for directory,_,_ in os.walk(root):Path(directory).chmod(0o755)
    # Mountpoint only, no host sources or unreviewed product modules.
    for name in ('run','sys','proc','dev','work','tmp'): (root/name).mkdir(exist_ok=True)
    return root


def service_text(root,work,tmp,log,mode):
    need(mode in ('write','read'),'PHASE_MODE')
    for path in (root,work,tmp,log):need(re.fullmatch('/[A-Za-z0-9_./-]+',str(path)) is not None,'OWN_PATH_SYNTAX')
    childenv={'PATH':'/usr/bin:/bin','LC_ALL':'C','HOME':'/work','TMPDIR':'/tmp','NODE_ENV':'test',
              'SILHOUETTE_PROVIDERS':'off','SILHOUETTE_BOOT_MODE':'normal',
              'SILHOUETTE_DB_PATH':'/work/db/silhouette.sqlite','SILHOUETTE_MIGRATIONS_DIR':'/app/db/migrations/sqlite'}

    # Python -I -S ignores inherited Python user/site configuration and execve
    # replaces the entire environment before Node can process NODE_OPTIONS/etc.
    bootstrap='import os;os.execve("/usr/bin/node",'+repr(['/usr/bin/node','--max-old-space-size=192','/app/phase-observer.INACTIVE.mjs',mode])+','+repr(childenv)+')'
    # systemd token escaping: backslash/double quote and literal percent specifier.
    escaped=bootstrap.replace('\\','\\\\').replace('"','\\"').replace('%','%%')
    return '\n'.join([
        '[Unit]','Description=Directed real Narrative public fixture '+mode,
        '[Service]','Type=exec','ExitType=cgroup','RemainAfterExit=yes',
        'User=1000','Group=1000','SupplementaryGroups=',
        'RootDirectory='+str(root),'WorkingDirectory=/work',
        'MountAPIVFS=no','InaccessiblePaths=/proc /sys /run','ProtectSystem=strict','ProtectHome=yes',
        'BindPaths='+str(work)+':/work '+str(tmp)+':/tmp','ReadWritePaths=/work /tmp',
        'PrivateNetwork=yes','PrivateDevices=yes','NoNewPrivileges=yes',
        'CapabilityBoundingSet=','AmbientCapabilities=','ProtectControlGroups=yes',
        'ProtectKernelTunables=yes','ProtectKernelModules=yes','RestrictSUIDSGID=yes',
        'MemoryAccounting=yes','CPUAccounting=yes','TasksAccounting=yes',
        'MemoryMax=536870912','MemorySwapMax=0','OOMPolicy=stop','MemoryOOMGroup=yes','TasksMax=64','CPUQuota=100%','CPUQuotaPeriodSec=100ms',
        'RuntimeMaxSec=45s','TimeoutStartSec=5s','TimeoutStopSec=2s','KillMode=control-group','Restart=no',
        'StandardInput=null','StandardOutput=append:'+str(log),
        'StandardError=append:'+str(log),'ExecStart=/usr/bin/python3 -I -B -S -c "'+escaped+'"',''])


PROPERTIES=('Id','LoadState','ActiveState','SubState','Result','ExecMainCode','ExecMainStatus','MainPID','ControlPID',
 'Type','ExitType','RemainAfterExit','User','Group','RootDirectory','PrivateNetwork','PrivateDevices','NoNewPrivileges',
 'MemoryMax','MemorySwapMax','TasksMax','CPUQuotaPerSecUSec','CPUQuotaPeriodUSec','KillMode','Restart')

def unit_state(unit):
    raw=command('/usr/bin/systemctl','show',unit,'--property='+','.join(PROPERTIES))
    rows=[v.split('=',1) for v in raw.splitlines()];need(all(len(v)==2 for v in rows),'UNIT_REPLY')
    return dict(rows)


def collect_diagnostic(tmp,mode,result,after_stop):
    import importlib.util,stat
    sample={'mode':mode,'afterStopConfirmed':after_stop,'state':'MISSING'}
    try:
        source=Path(__file__).parent
        for name in ('diagnostic-source-table.json','diagnostic-projection.INACTIVE.py','diagnostic-targets.json'):
            need(digest(source/name)==DIAGNOSTIC_FILES[name],'DIAGNOSTIC_SOURCE_PIN')
        spec=importlib.util.spec_from_file_location('diagnostic_projection',source/'diagnostic-projection.INACTIVE.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        fd=os.open(tmp/(mode+'-diagnostic.json'),os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
        try:
            before=os.fstat(fd);need(stat.S_ISREG(before.st_mode) and before.st_size<=16384,'DIAGNOSTIC_FILE_BOUND')
            raw=os.read(fd,16385);after=os.fstat(fd)
            need(len(raw)==before.st_size and (before.st_ino,before.st_size,before.st_mtime_ns)==
                 (after.st_ino,after.st_size,after.st_mtime_ns),'DIAGNOSTIC_FILE_CHANGED')
        finally:os.close(fd)
        value=module.project(json.loads(raw),json.loads((source/'diagnostic-source-table.json').read_text()),json.loads((source/'diagnostic-targets.json').read_text())['targets'])
        need(value['mode']==mode,'DIAGNOSTIC_PHASE_BINDING')
        sample.update(state='VALIDATED',diagnostic=value)
    except FileNotFoundError:pass
    except BaseException:sample['state']='REJECTED'
    if len(result['diagnosticSamples'])<4:result['diagnosticSamples'].append(sample)
    return sample


def select_raw_memory(snapshot):
    need(isinstance(snapshot,dict) and isinstance(snapshot.get('working'),list),'RAW_MEMORY_SNAPSHOT_SHAPE')
    selected=[n for n in snapshot['working'] if isinstance(n,dict) and isinstance(n.get('tags'),list) and
              {'NARRATIVE','RAW_SYSTEM_EVENT','source:SYSTEM'}<=set(n['tags'])]
    need(len(selected)==2,'RAW_MEMORY_EXACT_COUNT')
    ordered=[]
    for source,content,importance in [('CONSCIOUS','Public fixture accepted thought one','0.90'),('AGENCY','Public fixture accepted thought two','0.80')]:
        matches=[n for n in selected if n.get('originalContent')==content]
        need(len(matches)==1,'RAW_MEMORY_ORIGINAL_UNIQUE')
        n=matches[0]
        need(n.get('content')==content and n.get('tier')=='WORKING' and n.get('tags')==
             ['NARRATIVE',source,'importance:'+importance,'source:SYSTEM','RAW_SYSTEM_EVENT'],'RAW_MEMORY_FIELDS')
        need(isinstance(n.get('id'),str) and len(n['id'])>0,'RAW_MEMORY_ID')
        ordered.append(n)
    need(ordered[0]['id']!=ordered[1]['id'],'RAW_MEMORY_DISTINCT_IDS')
    return ordered

def real_phase(unit,root,work,tmp,log,mode,receipt,result):
    file=Path('/run/systemd/system')/(unit+'.service')
    need(not file.exists(),'OWN_UNIT_EXISTS')
    file.write_text(service_text(root,work,tmp,log,mode));file.chmod(0o600)
    result['ownedUnits'].append(file.name);durable(receipt,result)
    command('/usr/bin/systemctl','daemon-reload')
    # Starts the real product directly, not an earlier shell/tool probe.
    command('/usr/bin/systemctl','start','--no-block',file.name)
    until=time.monotonic()+50
    while time.monotonic()<until:
        state=unit_state(file.name)
        if state.get('ActiveState')=='failed':
            collect_diagnostic(tmp,mode,result,False)
            result['lastUnitState']=state;result['unitStates'].append(state);durable(receipt,result)
            raise RuntimeError('REAL_PHASE_UNIT_FAILED')
        if state.get('ActiveState')=='active' and state.get('SubState')=='exited':break
        time.sleep(.2)
    else:raise RuntimeError('REAL_PHASE_NOT_NATURALLY_EXITED')
    diagnostic=collect_diagnostic(tmp,mode,result,True)
    need(diagnostic['state']=='VALIDATED' and diagnostic['diagnostic']['outcome']=='RETURNED','DIAGNOSTIC_SUCCESS_MISSING_OR_INVALID')
    result['lastUnitState']={k:state.get(k) for k in PROPERTIES}
    result['unitStates'].append(result['lastUnitState']);durable(receipt,result)
    wanted={'Id':file.name,'LoadState':'loaded','ActiveState':'active','SubState':'exited','Result':'success',
        'ExecMainCode':'1','ExecMainStatus':'0','MainPID':'0','ControlPID':'0','Type':'exec','ExitType':'cgroup',
        'RemainAfterExit':'yes','User':'1000','Group':'1000','RootDirectory':str(root),'PrivateNetwork':'yes',
        'PrivateDevices':'yes','NoNewPrivileges':'yes','MemoryMax':'536870912','MemorySwapMax':'0','TasksMax':'64',
        'CPUQuotaPerSecUSec':'1s','CPUQuotaPeriodUSec':'100ms','KillMode':'control-group','Restart':'no'}
    need(all(state.get(k)==v for k,v in wanted.items()),'REAL_PHASE_TERMINAL_PROPERTIES')
    # No per-file runtime log cap: total /tmp tmpfs bounds writes at 16MiB.
    # Read/export only bounded content. Oversize is UNKNOWN, not product failure.
    result['logCollection'][mode]={'totalBytes':log.stat().st_size,'collectionLimitBytes':65536,'runtimePerFileCap':False}
    with log.open('rb') as stream:raw=stream.read(65537)
    (receipt.parent/(mode+'-log-prefix.txt')).write_bytes(raw[:65536])
    need(len(raw)<=65536,'REAL_PHASE_LOG_COLLECTION_BOUND')
    lines=raw.decode().splitlines();checkpoints=[v[16:] for v in lines if v.startswith('NARRATIVE_PHASE ')]
    need(len(checkpoints)==1 and json.loads(checkpoints[0])=={'mode':mode,'originalWorkEqual':True,'preserved':2,'lateRefused':True},'REAL_PHASE_FUNCTIONAL_ORACLE')
    raw_checks=[v[len('RAW_MEMORY_PHASE '):] for v in lines if v.startswith('RAW_MEMORY_PHASE ')]
    need(len(raw_checks)==1 and json.loads(raw_checks[0])=={'mode':mode,'rawSystemEvents':2,'originalContentAndProvenance':True,'completeNodeIdentity':True},'RAW_MEMORY_FUNCTIONAL_ORACLE')
    # With ExitType=cgroup this active/exited state requires no process in the
    # unit, not only main PID exit. No stop/kill precedes this assertion.
    phase={'mode':mode,'naturalMainExit':True,'managerReportedWholeCgroupExited':True,'exitCode':0,
           'logBytes':log.stat().st_size,'pipeEOFObserved':False,'terminalModel':'SYSTEMD_EXITTYPE_CGROUP_REMAIN_AFTER_EXIT'}
    result['phases'].append(phase);durable(receipt,result)
    command('/usr/bin/systemctl','stop',file.name)
    file.unlink();command('/usr/bin/systemctl','daemon-reload')
    result['ownedUnits'].remove(file.name);durable(receipt,result)


def run(*,archive,manifest,guard,derived_manifest,context_module,expected_context,receipt):
    """Review only. Context authorization and exact event remain separate."""
    result={'kind':'DIRECT_REAL_NARRATIVE_SYSTEMD','stage':'CONTEXT','result':'UNKNOWN','productAttempted':False,'forcedCleanup':False,
            'phases':[],'diagnosticSamples':[],'logCollection':{},'unitStates':[],'ownedUnits':[],'allSilhouetteValidated':False,
            'pipeEOFObserved':False,'scope':'Narrative-raw-system-events-only-not-full-app-or-crash-durability'}
    receipt=Path(receipt);base=Path('/tmp')/('narrative-direct-'+secrets.token_hex(8));mounted=[]
    try:
        need(os.geteuid()==0,'ROOT_MANAGER_REQUIRED')
        # Reuse reviewed authenticated snapshot reader, no new API inventory.
        import importlib.util
        need(digest(context_module)==CONTEXT_SHA,'REVIEWED_CONTEXT_SOURCE_PIN')
        spec=importlib.util.spec_from_file_location('directed_context',context_module);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        context=module.read_for_root('/tmp/narrative-directed-hosted-job.json',expected_context)
        need(command('/usr/bin/git','rev-parse','HEAD')==context['eventHead'],'CONTEXT_HEAD_CHANGED')
        result['contextValidated']=True;result['runId']=context['runId'];result['jobId']=context['jobId']
        result['stage']='HOST_MANAGER';durable(receipt,result)
        need(Path('/proc/1/comm').read_text().strip()=='systemd','HOST_MANAGER_REQUIRED')
        result['stage']='PAYLOAD';durable(receipt,result)
        base.mkdir(mode=0o700);work=base/'work';tmp=base/'tmp';work.mkdir();tmp.mkdir()
        root=extract_reviewed(archive,manifest,guard,derived_manifest,base/'root')
        result['instrumentationProvenance']={'originalArchiveSha256':ARCHIVE_SHA,'originalManifestSha256':MANIFEST_SHA,
            'derivedManifestSha256':DERIVED_MANIFEST_SHA,
                'publicTargetAdditionSha256':'b96560a8e9869b3a1f9c46de0f9a307255042dffa4a7dc82057186bebe7180e6','derivedGuardSha256':GUARD_SHA,
            'executableIdentity':'ABSOLUTE_PINNED_FILE_NOT_PROC_OBSERVATION','originalProductEntrySha256':ENTRY_SHA,'diagnosticEntrySha256':DIAGNOSTIC_FILES['entry.DIAGNOSTIC.INACTIVE.mjs']}
        result['stage']='TEMPORARY_WORK';durable(receipt,result)
        for target,options in ((work,'size=33554432,nr_inodes=4096'),(tmp,'size=16777216,nr_inodes=2048')):
            command('/usr/bin/mount','-t','tmpfs','-o','rw,nosuid,nodev,noexec,'+options+',uid=1000,gid=1000,mode=0700','tmpfs',str(target));mounted.append(target)
        (work/'db').mkdir();os.chown(work/'db',1000,1000)
        config={'system':{'env':'test','port':33005},'modules':{'graph':False,'vectorDB':False,'redis':False,'browser':False},
            'autonomy':{'enabled':False,'allowEvolution':False,'enableNarrative':False,'enableIntrospection':False},
            'scheduler':{'enabled':False},'llm':{'providers':{},'fallbackChain':[]},'brain':{'enabled':False}}
        (work/'silhouette.config.json').write_text(json.dumps(config));os.chown(work/'silhouette.config.json',1000,1000)
        original=None;raw_original=None
        for mode in ('write','read'):
            unit='narrative-direct-'+secrets.token_hex(8)+'-'+mode
            result['stage']='WRITE' if mode=='write' else 'READ'
            result['productAttempted']=True;durable(receipt,result)
            real_phase(unit,root,work,tmp,tmp/(mode+'.log'),mode,receipt,result)
            # Observe the stable product snapshot only after natural unit exit.
            snapshot=(work/'data/memory_snapshot.json').read_bytes()
            need(len(snapshot)<=1048576,'RAW_MEMORY_SNAPSHOT_BOUND')
            selected=select_raw_memory(json.loads(snapshot))
            expected_raw=json.loads((work/'raw-system-event-oracle.json').read_text())
            need(selected==expected_raw,'RAW_MEMORY_STABLE_SNAPSHOT_MISMATCH')
            raw_identity=(json.dumps(selected,sort_keys=True,separators=(',',':'))+'\n').encode()
            if mode=='write':raw_original=raw_identity
            else:need(raw_identity==raw_original,'RAW_MEMORY_RESTART_IDENTITY_MISMATCH')
            journal=(work/'data/wal/pending-narrations.json').read_bytes()
            need(not (work/'data/wal/.pending-narrations.owner').exists(),'PENDING_LOCK_REMAINS')
            need(len(journal)<=65536,'PUBLIC_JOURNAL_BOUND')
            (base/(mode+'-public-journal.json')).write_bytes(journal)
            if mode=='write':
                original=journal;need(len(json.loads(journal)['items'])==2,'WRITER_ITEMS_COUNT')
            else:need(json.loads(journal)==json.loads(original),'ORIGINAL_IDS_OR_FIELDS_CHANGED')
        result['stage']='TERMINAL_EVIDENCE'
        result.update(result='PASS_DIRECTED_RAW_SYSTEM_MEMORY_ONLY',sameOriginalIdsAndFields=True,
            rawSystemEventCount=2,rawSystemMemoryVerified=True,rawMemoryWriterSha256=hashlib.sha256(raw_original).hexdigest(),
            rawMemoryRecoveredSha256=hashlib.sha256(raw_identity).hexdigest(),
            journalSha256=hashlib.sha256(original).hexdigest(),recoveredSha256=hashlib.sha256(journal).hexdigest(),
            naturalTreeExitModel='SYSTEMD_EXITTYPE_CGROUP_NOT_DOCKER_PID1_CENSUS',providersOff=True)
    except BaseException as error:
        result['failureClass']=type(error).__name__
        result['failureCode']=str(error) if re.fullmatch('[A-Z][A-Z0-9_]{0,95}',str(error)) else 'UNCLASSIFIED_DIRECT_FAILURE'
    finally:
        # Stop first on failure; only then capture stable final public evidence.
        stopped=True
        for unit in list(result['ownedUnits']):
            result['forcedCleanup']=True
            try:
                state=unit_state(unit);result['cleanupBeforeStopState']=state;durable(receipt,result)
            except BaseException:result['cleanupBeforeStopStateUnavailable']=True
            try:
                command('/usr/bin/systemctl','stop',unit,timeout=5)
                state=unit_state(unit);result['cleanupAfterStopState']=state
                need(state.get('ActiveState') in ('inactive','failed') and state.get('MainPID')=='0' and
                     state.get('ControlPID')=='0','CLEANUP_STOP_UNCONFIRMED')
                path=Path('/run/systemd/system')/unit
                if path.exists():path.unlink()
            except BaseException:result['cleanupUnknown']=True;stopped=False
        if result['ownedUnits']:
            try:command('/usr/bin/systemctl','daemon-reload')
            except BaseException:result['cleanupUnknown']=True
        journal_path=base/'work/data/wal/pending-narrations.json'
        try:
            if journal_path.is_file():
                with journal_path.open('rb') as stream:raw=stream.read(65537)
                (base/'terminal-public-journal-prefix.json').write_bytes(raw[:65536])
                result['terminalJournalCopy']={'afterStopConfirmed':stopped,'partial':not stopped or len(raw)>65536,
                    'bytesCopied':min(len(raw),65536),'copyIsNaturalExitEvidence':False}
            for mode in ('write','read'):
                path=base/'tmp'/(mode+'.log')
                if path.is_file():
                    collect_diagnostic(base/'tmp',mode,result,stopped)
                    with path.open('rb') as stream:raw=stream.read(65537)
                    (receipt.parent/(mode+'-log-prefix.txt')).write_bytes(raw[:65536])
                    result['logCollection'][mode]={'totalBytes':path.stat().st_size,'copiedBytes':min(len(raw),65536),
                        'partial':not stopped or len(raw)>65536,'runtimePerFileCap':False,'afterStopConfirmed':stopped}
        except BaseException:result['publicEvidenceCopyUnavailable']=True
        # Never detach a live/unknown service's evidence mounts.
        if stopped:
            for path in reversed(mounted):
                try:command('/usr/bin/umount',str(path))
                except BaseException:result['cleanupUnknown']=True
        if result.get('cleanupUnknown'):
            result['result']='UNKNOWN';result['cleanupFailureCode']='CLEANUP_UNVERIFIED'
        result['temporaryRootRetainedUntilVMTeardown']=base.exists()
        durable(receipt,result)
    return result


if __name__=='__main__':raise SystemExit('INACTIVE: no publication/execution authority')
