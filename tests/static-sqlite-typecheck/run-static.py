"""Manual compiler-only proposal. No services, product evaluation or npm hooks."""
from pathlib import Path
import os,sys,json,hashlib,subprocess,resource,time,signal,shutil,tarfile,io,base64,urllib.request,difflib,re,gzip
BASE='db201993d05124cdb23a84cdfbc695bb3c6680d5'
LOCK='039ce85293514e83584ca047d0d8b53eb7bce71bb3b3fe75fc6f96e928a0299c'
PACKAGE='5d33ed5f3b6212da1ff00c29bf75e653522affc760d5e59b134adc72c0c071fa'
BRANCH='refs/heads/preparation/sqlite-static-typecheck-db201993-4054-20261114'
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1]
ROOT=Path(os.environ['RUNNER_TEMP'])/'sqlite-static-only';ROOT.mkdir(mode=0o700)
EV=ROOT/'evidence';EV.mkdir();REPORT={'status':'STARTED_STATIC_ONLY','base':BASE,'candidateSourcePacket':'4054bb42867d09d15740c3b8e47c1c8e9deec8714489ec47ed23c4e10fb98dab','commands':[],'failures':[]}
CAP=8*1024**2;RAW=32*1024**2;GZIP=8*1024**2;START=time.monotonic();DEADLINE=START+1000
# Conservative job anchor prevents setup latency from consuming cleanup reserve.
pid=os.getpid();worker_start=None
for _ in range(64):
 proc=Path('/proc')/str(pid);fields=(proc/'stat').read_text().rsplit(')',1)[1].split()
 if (proc/'comm').read_text().strip()=='Runner.Worker':worker_start=int(fields[19])/os.sysconf('SC_CLK_TCK');break
 pid=int(fields[1])
 if pid<=1:break
if worker_start is not None:DEADLINE=min(DEADLINE,worker_start+1080)

def interrupted(signum,frame):raise RuntimeError('Supervisor interrupted:'+signal.Signals(signum).name)
signal.signal(signal.SIGTERM,interrupted)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def emit(name,value):
 raw=(json.dumps(value,indent=2)+'\n').encode();assert len(raw)<=CAP
 p=EV/name;assert not p.is_symlink();p.write_bytes(raw)
 assert sum(p.stat().st_size for p in EV.iterdir()if p.is_file())<=RAW

def limits(cpu=240):
 for k,v in [(resource.RLIMIT_CORE,0),(resource.RLIMIT_CPU,cpu),(resource.RLIMIT_AS,24*1024**3),(resource.RLIMIT_NOFILE,256),(resource.RLIMIT_NPROC,96),(resource.RLIMIT_FSIZE,1024**3)]:resource.setrlimit(k,(v,v))

def run(label,cmd,cwd,env,wall=300):
 assert time.monotonic()+wall<DEADLINE,'reserve exhausted before '+label
 import selectors
 t=time.monotonic();p=subprocess.Popen(cmd,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=limits);sel=selectors.DefaultSelector();os.set_blocking(p.stdout.fileno(),False);sel.register(p.stdout,selectors.EVENT_READ);count=0;eof=False;cause=None;signals=[];leader_exit=None
 try:
  with (EV/(label+'.log')).open('xb')as log:
   while True:
    now=time.monotonic();rc=p.poll()
    if rc is not None and leader_exit is None:leader_exit=now
    if now-t>wall:raise TimeoutError('command wall')
    if leader_exit is not None and now-leader_exit>3 and not eof:raise RuntimeError('descendant pipe still open')
    for key,_ in sel.select(.05):
     data=os.read(key.fd,65536)
     if not data:eof=True;sel.unregister(key.fd);continue
     count+=len(data)
     if count>CAP:raise RuntimeError('complete log exceeds8MiB; no truncation acceptance')
     log.write(data)
    if rc is not None and eof:break
 except BaseException as e:
  cause={'type':type(e).__name__,'text':str(e)}
 finally:
  # A leader rc is not a complete process-group receipt. Query group even if
  # all output reached EOF; unexpected survivors are failed, not clean tsc.
  try:os.killpg(p.pid,0);group_live=True
  except ProcessLookupError:group_live=False
  if cause or group_live:
   if group_live:
    cause=cause or {'type':'Survivor','text':'command group still live after leader/EOF'}
    try:os.killpg(p.pid,signal.SIGKILL);signals.append('SIGKILL')
    except ProcessLookupError:pass
  p.wait(timeout=5);sel.close();p.stdout.close()
 row={'label':label,'argv':cmd,'rc':p.returncode,'seconds':time.monotonic()-t,'logBytes':count,'eof':eof,'cause':cause,'signals':signals,'naturalComplete':not cause and not signals and eof}
 REPORT['commands'].append(row);emit('result.json',REPORT)
 return row

def download(url,maximum=32*1024**2):
 req=urllib.request.Request(url,headers={'User-Agent':'StaticLockIntegrity/1.0'})
 with urllib.request.urlopen(req,timeout=20)as r:
  assert r.url.startswith('https://registry.npmjs.org/')or r.url.startswith('https://codeload.github.com/whiskeysockets/libsignal-node/')
  data=r.read(maximum+1)
 assert len(data)<=maximum
 return data

def archive_files(raw):
 out={}
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz')as t:
  for m in t.getmembers():
   if m.isdir():continue
   parts=Path(m.name).parts;assert len(parts)>1 and '..'not in parts and not Path(m.name).is_absolute()and m.isfile()
   rel='/'.join(parts[1:]);assert rel not in out;out[rel]=t.extractfile(m).read()
 return out

def verify_package(name,lock,deps,cache):
 row=lock['packages']['node_modules/'+name];alg,sri=row['integrity'].split('-',1);digest=base64.b64decode(sri);h=digest.hex();cp=cache/'_cacache/content-v2'/alg/h[:2]/h[2:4]/h[4:]
 data=cp.read_bytes()if cp.is_file()else download(row['resolved']);assert hashlib.new(alg,data).digest()==digest,'SRI mismatch '+name
 expected=archive_files(data);root=deps/name;proof=[]
 for rel,raw in expected.items():
  p=root/rel;assert p.is_file()and not p.is_symlink()and p.read_bytes()==raw,'byte mismatch '+str(p);proof.append({'path':rel,'sha256':hashlib.sha256(raw).hexdigest()})
 assert {str(p.relative_to(root))for p in root.rglob('*')if p.is_file()}==set(expected),'extra unverified files '+name
 return {'name':name,'version':row['version'],'SRI':row['integrity'],'tarballSha256':hashlib.sha256(data).hexdigest(),'files':proof}

def check_inputs(root):
 assert sha(root/'package-lock.json')==LOCK and sha(root/'package.json')==PACKAGE
 return {n:sha(root/n)for n in ['package.json','package-lock.json','tsconfig.json']}

def make_copy(target):
 target.mkdir();raw=subprocess.check_output(['git','archive','--format=tar',BASE],cwd=REPO)
 with tarfile.open(fileobj=io.BytesIO(raw))as t:
  for m in t.getmembers():
   rel=Path(m.name);assert not rel.is_absolute()and '..'not in rel.parts and not m.issym()and not m.islnk()
   assert rel.parts[0]not in {'.git','.env','.env.local','node_modules'}
  t.extractall(target,filter='data')
 return check_inputs(target)

def du():return subprocess.check_output(['du','-sk',str(ROOT)],text=True).strip()
try:
 assert worker_start is not None,'No conservative workflow worker anchor'
 assert os.environ['GITHUB_EVENT_NAME']=='workflow_dispatch'and os.environ['REPOSITORY_PRIVATE']=='false'and os.environ['RUNNER_ENVIRONMENT']=='github-hosted'
 assert os.environ['GITHUB_REF']==BRANCH and re.fullmatch('[0-9a-f]{40}',os.environ['EXPECTED_HEAD'])and os.environ['GITHUB_SHA']==os.environ['EXPECTED_HEAD']
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()==os.environ['EXPECTED_HEAD']
 node=Path(shutil.which('node')).resolve();version=subprocess.check_output([str(node),'--version'],text=True).strip();assert version=='v22.18.0'
 npm=Path(shutil.which('npm')).resolve();npm_version=subprocess.check_output([str(node),str(npm),'--version'],text=True).strip()
 mem=dict((line.split(':',1)[0],line.split(':',1)[1].strip())for line in Path('/proc/meminfo').read_text().splitlines());assert int(mem['MemAvailable'].split()[0])*1024>=6*1024**3;disk=shutil.disk_usage(ROOT);assert disk.free>=8*1024**3
 emit('identity-resources.json',{'node':str(node),'nodeVersion':version,'nodeSha256':sha(node),'npm':str(npm),'npmVersion':npm_version,'runnerImage':{k:os.environ.get(k)for k in ['ImageOS','ImageVersion','RUNNER_ARCH']},'meminfo':mem,'disk':disk._asdict(),'controls':'PER_PROCESS_RLIMITS_AND_GROUP_WALL_NOT_AGGREGATE_CGROUP_OR_DISK','cpuSeconds':240,'ASbytes':24*1024**3,'nofile':256,'nproc':96,'fsize':1024**3,'core':0,'compilerOldSpaceMiB':4096,'networkAcquisition':'PUBLIC_ANONYMOUS_NO_DOMAIN_FIREWALL_CLAIM'})
 baseline=ROOT/'baseline';candidate=ROOT/'candidate';before={'baseline':make_copy(baseline),'candidate':make_copy(candidate)}
 delta=json.loads((HERE/'candidate-delta.json').read_text());assert delta['base']==BASE
 for row in delta['files']:
  rel=Path(row['path']);assert not rel.is_absolute()and'..'not in rel.parts;src=HERE/'candidate-overlay'/rel;dst=candidate/rel
  assert sha(src)==row['after_sha256'];assert (sha(dst)if dst.exists()else None)==row['before_sha256'];dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
 mirror=candidate/'tests/real-process/neo4j-service-trial/proposed-product-overlay/services/userProfileService.ts';assert mirror.read_bytes()==(candidate/'services/userProfileService.ts').read_bytes();shutil.copyfile(mirror,candidate/'services/userProfileService.ts')
 # Capture complete input tree hashes before any acquisition or compiler.
 input_hashes={label:{str(p.relative_to(root)):sha(p)for p in sorted(root.rglob('*'))if p.is_file()}for label,root in [('baseline',baseline),('candidate',candidate)]};emit('source-config-lock-hashes.json',input_hashes)
 acquisition=ROOT/'acquisition';acquisition.mkdir();shutil.copyfile(baseline/'package.json',acquisition/'package.json');shutil.copyfile(baseline/'package-lock.json',acquisition/'package-lock.json')
 cache=ROOT/'empty-npm-cache';cache.mkdir();home=ROOT/'empty-home';home.mkdir();empty=ROOT/'empty-config';empty.write_text('');empty_global=ROOT/'empty-global-config';empty_global.write_text('')
 lock=json.loads((baseline/'package-lock.json').read_text());librow=lock['packages']['node_modules/libsignal'];assert librow['resolved']=='git+ssh://git@github.com/whiskeysockets/libsignal-node.git#1c30d7d7e76a3b0aa120b04dc6a26f5a12dccf67'
 public=download('https://codeload.github.com/whiskeysockets/libsignal-node/tar.gz/1c30d7d7e76a3b0aa120b04dc6a26f5a12dccf67',1024**2);assert len(public)==46103 and hashlib.sha256(public).hexdigest()=='a9e14823efa911474aaa9e8f6bfb88759f869a3bc25116e969be943b84bef318';publicfiles=archive_files(public);libpackage=json.loads(publicfiles['package.json']);assert not libpackage.get('scripts')and not libpackage.get('workspaces')and libpackage['version']=='2.0.1'
 expectedlib=json.loads((HERE/'libsignal-packed-files.json').read_text());assert len(expectedlib)==22
 for rel,h in expectedlib.items():assert hashlib.sha256(publicfiles[rel]).hexdigest()==h
 env={'PATH':os.environ['PATH'],'HOME':str(home),'NODE_OPTIONS':'','NPM_CONFIG_USERCONFIG':str(empty),'NPM_CONFIG_GLOBALCONFIG':str(empty_global),'NPM_CONFIG_CACHE':str(cache),'NPM_CONFIG_FETCH_RETRIES':'0','NPM_CONFIG_IGNORE_SCRIPTS':'true','NPM_CONFIG_AUDIT':'false','NPM_CONFIG_FUND':'false','PUPPETEER_SKIP_DOWNLOAD':'true','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD':'true','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':str(empty),'GIT_CONFIG_COUNT':'2','GIT_CONFIG_KEY_0':'url.https://github.com/whiskeysockets/libsignal-node.git.insteadOf','GIT_CONFIG_VALUE_0':'ssh://git@github.com/whiskeysockets/libsignal-node.git','GIT_CONFIG_KEY_1':'credential.helper','GIT_CONFIG_VALUE_1':'','GIT_TERMINAL_PROMPT':'0','GIT_ASKPASS':'/bin/false','SSH_ASKPASS':'/bin/false','GIT_SSH_COMMAND':'/bin/false'}
 # Source-ground normalization against this setup-node npm, no package eval.
 npmroot=npm.parents[1];npa=npmroot/'node_modules/npm-package-arg/lib/npa.js';pacote=npmroot/'node_modules/pacote/lib/git.js'
 assert npa.is_file()and pacote.is_file();npatext=npa.read_text();pactext=pacote.read_text()
 assert "res.fetchSpec = res.fetchSpec.slice(4)"in npatext and 'h.tarball({ noCommittish: false })'in pactext
 emit('npm-git-transport-source.json',{'npmPackageRoot':str(npmroot),'npmVersion':npm_version,'npaSha256':sha(npa),'pacoteGitSha256':sha(pacote),'normalization':'npa strips git+ from fetchSpec; hosted exactSHA can fetch public codeload directly','scopedInsteadOf':'only exact libsignal ssh repository to HTTPS','sshDenied':True,'builtInPacoteHttpToGitFallback':'EXISTS; guarded below with no git network retry'})
 # The reviewed fullSHA hosted tarball path needs no git network. Deny git
 # network/fallback attempts instead of silently retrying clone after failure.
 # Still retain exact-repo insteadOf config and deny SSH in inherited env.
 guard=ROOT/'git-guard';guard.mkdir();git=guard/'git';git.write_text('#!/bin/sh\ncase \"$*\" in --version|version) exec /usr/bin/git \"$@\" ;; *) printf \"STATIC_ACQUISITION_GIT_FALLBACK_DENIED\\n\" >&2; exit 97 ;; esac\n');git.chmod(0o700);env['PATH']=str(guard)+os.pathsep+env['PATH']
 # npm refuses the same file loaded as both user and global configuration.
 # Git still consumes the original empty-config; its producer is unchanged.
 assert empty.resolve()!=empty_global.resolve()and empty.stat().st_ino!=empty_global.stat().st_ino
 assert all(p.is_file()and not p.is_symlink()and p.read_bytes()==b''for p in [empty,empty_global])
 assert env['NPM_CONFIG_USERCONFIG']==str(empty)and env['NPM_CONFIG_GLOBALCONFIG']==str(empty_global)and env['GIT_CONFIG_GLOBAL']==str(empty)
 config=run('npm-config-preflight',[str(node),str(npm),'config','list','--json'],acquisition,env,wall=10)
 assert config['naturalComplete']and config['rc']==0,'npm config resolution failed; STOP before acquisition'
 resolved=json.loads((EV/'npm-config-preflight.log').read_text())
 assert resolved['userconfig']==str(empty)and resolved['globalconfig']==str(empty_global)and resolved['cache']==str(cache)
 assert resolved['ignore-scripts']is True and resolved['audit']is False and resolved['fund']is False and resolved['fetch-retries']==0
 emit('npm-config-preflight.json',{'userconfig':str(empty),'globalconfig':str(empty_global),'gitGlobalConfig':env['GIT_CONFIG_GLOBAL'],'distinctEmptyFiles':True,'npmVersion':npm_version,'nonAcquisitiveCommand':config['argv'],'resolvedIsolationFlagsVerified':True})
 REPORT['duBeforeAcquisition']=du();install=run('acquisition',[str(node),str(npm),'ci','--ignore-scripts','--no-audit','--no-fund'],acquisition,env)
 assert sha(acquisition/'package-lock.json')==LOCK and sha(acquisition/'package.json')==PACKAGE
 assert install['naturalComplete']and install['rc']==0,'acquisition failed; STOP no automatic fallback/retry'
 deps=acquisition/'node_modules';lib=deps/'libsignal';libproof={}
 for rel,h in expectedlib.items():p=lib/rel;assert p.is_file()and not p.is_symlink()and sha(p)==h;libproof[rel]=h
 assert {str(p.relative_to(lib))for p in lib.rglob('*')if p.is_file()}==set(expectedlib),'extra libsignal file'
 emit('libsignal-integrity.json',{'commit':'1c30d7d7e76a3b0aa120b04dc6a26f5a12dccf67','publicArchiveSha256':hashlib.sha256(public).hexdigest(),'files':libproof,'credentialUsed':False})
 verified=[verify_package(n,lock,deps,cache)for n in ['typescript','@types/node','undici-types','vite']];emit('compiler-declarations-integrity.json',verified)
 assert [x['version']for x in verified]==['5.8.3','22.19.1','6.21.0','6.4.1']
 installed=json.loads((deps/'.package-lock.json').read_text())['packages'];missing=[]
 for name,row in lock['packages'].items():
  if not name:continue
  other=installed.get(name)
  if other is None:assert row.get('optional'),'nonoptional missing '+name;missing.append(name);continue
  assert all(row.get(k)==other.get(k)for k in ['version','resolved','integrity','link']),'metadata mismatch '+name
 assert not(set(installed)-set(lock['packages']));emit('dependency-metadata.json',{'present':len(installed),'optionalMissing':missing,'remainingBytesNotVerified':'ALL_EXCEPT_COMPILER_DECLARATIONS_LIBSIGNAL'})
 # No legitimate network in compiler phase. Fail before tsc if unshare fails.
 probe=run('offline-probe',['unshare','-rn','true'],ROOT,env,wall=10);assert probe['naturalComplete']and probe['rc']==0,'offline namespace unavailable; no escalation'
 for label,root in [('baseline',baseline),('candidate',candidate)]:
  (root/'node_modules').symlink_to(deps,target_is_directory=True)
  row=run(label,['unshare','-rn',str(node),'--max-old-space-size=4096',str(deps/'typescript/bin/tsc'),'--project','tsconfig.json','--noEmit','--skipLibCheck','--incremental','false','--pretty','false'],root,env)
  assert check_inputs(root)==before[label];assert not list(root.rglob('*.tsbuildinfo'))
  drift=[rel for rel,h in input_hashes[label].items()if not(root/rel).is_file()or sha(root/rel)!=h];assert not drift,'source drift'
 runs={r['label']:r for r in REPORT['commands']};assert runs['baseline']['naturalComplete']and runs['candidate']['naturalComplete'],'inconclusive compiler termination'
 # Natural compiler rc1 can carry noEmit diagnostics. Preserve full diff
 # BEFORE classifying diagnostic exit status; only both0 means clean.
 a=(EV/'baseline.log').read_text(errors='replace').splitlines(True);b=(EV/'candidate.log').read_text(errors='replace').splitlines(True);diff=''.join(difflib.unified_diff(a,b,fromfile='baseline',tofile='candidate'));assert len(diff.encode())<=CAP;(EV/'diagnostics.diff').write_text(diff)
 assert runs['baseline']['rc']in[0,1,2]and runs['candidate']['rc']in[0,1,2],'compiler crash/non-diagnostic exit'
 REPORT['status']='STATIC_COMPILERS_COMPLETED_DIAGNOSTICS_REQUIRE_REVIEW';REPORT['productTypecheckPass']=runs['baseline']['rc']==0 and runs['candidate']['rc']==0;REPORT['otherDependencyDiagnosticAttribution']='NOT_ACCEPTED_BEFORE_TARGETED_BYTE_VERIFICATION';REPORT['lifecycleAcceptance']='INCOMPLETE_UNCHANGED'
except BaseException as cause:
 REPORT['status']='STATIC_PREREQUISITE_OR_VALIDATION_FAILED';REPORT['failures'].append({'type':type(cause).__name__,'text':str(cause)})
finally:
 REPORT['seconds']=time.monotonic()-START;REPORT['duAfter']=du()
 archive=ROOT/'static-evidence.tar.gz';finalizationErrors=[]
 try:
  emit('result.json',REPORT)
  with tarfile.open(archive,'w:gz')as t:
   for p in sorted(EV.iterdir()):assert p.is_file()and not p.is_symlink();t.add(p,arcname=p.name)
  assert archive.stat().st_size<=GZIP,'gzip evidence overflow fail closed'
 except BaseException as cause:
  REPORT['status']='STATIC_EVIDENCE_OVERFLOW_OR_FINALIZATION_FAILED';REPORT['productTypecheckPass']=False
  finalizationErrors.append({'stage':'evidence','type':type(cause).__name__,'text':str(cause)})
 finally:
  for name in ['baseline','candidate','acquisition','empty-npm-cache','empty-home']:
   p=ROOT/name
   try:
    if p.exists():shutil.rmtree(p)
   except BaseException as cause:finalizationErrors.append({'stage':'cleanup:'+name,'type':type(cause).__name__,'text':str(cause)})
 cleanup={'disposableCopiesRemoved':all(not(ROOT/n).exists()for n in ['baseline','candidate','acquisition','empty-npm-cache','empty-home']),'errors':finalizationErrors,'noNativeServicesStarted':True}
 if not cleanup['disposableCopiesRemoved']or finalizationErrors:REPORT['productTypecheckPass']=False
 # Even if complete logs exceed policy, export an EXPLICIT failed evidence
 # manifest with hashes/lengths, never a shortened log masquerading complete.
 if finalizationErrors:
  overflow={'status':'INCOMPLETE_EVIDENCE_FAILED_NO_ACCEPTANCE','files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(EV.iterdir())if p.is_file()],'errors':finalizationErrors}
  (ROOT/'overflow.json').write_text(json.dumps(overflow,indent=2)+'\n')
 (ROOT/'cleanup.json').write_text(json.dumps(cleanup,indent=2)+'\n');(ROOT/'final-result.json').write_text(json.dumps(REPORT,indent=2)+'\n')
 finalraw=sum(p.stat().st_size for p in EV.iterdir()if p.is_file())+(ROOT/'cleanup.json').stat().st_size+(ROOT/'final-result.json').stat().st_size
 if finalraw>RAW and not finalizationErrors:
  REPORT['productTypecheckPass']=False;REPORT['status']='STATIC_EVIDENCE_OVERFLOW_OR_FINALIZATION_FAILED';(ROOT/'final-result.json').write_text(json.dumps(REPORT,indent=2)+'\n');finalizationErrors.append({'stage':'final-raw-cap','bytes':finalraw});(ROOT/'overflow.json').write_text(json.dumps({'status':'INCOMPLETE_EVIDENCE_FAILED_NO_ACCEPTANCE','errors':finalizationErrors,'files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(EV.iterdir())if p.is_file()]},indent=2)+'\n')
 with tarfile.open(archive,'w:gz')as t:
  if not finalizationErrors:
   for p in sorted(EV.iterdir()):t.add(p,arcname=p.name)
  else:t.add(ROOT/'overflow.json',arcname='EXPLICIT-INCOMPLETE-EVIDENCE.json')
  for n in ['cleanup.json','final-result.json']:t.add(ROOT/n,arcname=n)
 assert archive.stat().st_size<=GZIP
 print(json.dumps(REPORT),flush=True)
raise SystemExit(0 if REPORT.get('productTypecheckPass')else 1)
