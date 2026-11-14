"""Manual compiler-only proposal. No services, product evaluation or npm hooks."""
from manager_sqlite_supervisor import system_binary_manifest, build_exact_namespace_command, run_namespace_phase
from pathlib import Path
import traceback
import os,sys,json,hashlib,subprocess,resource,time,signal,shutil,tarfile,io,base64,urllib.request,difflib,re,gzip,stat
BASE='db201993d05124cdb23a84cdfbc695bb3c6680d5'
LOCK='039ce85293514e83584ca047d0d8b53eb7bce71bb3b3fe75fc6f96e928a0299c'
PACKAGE='5d33ed5f3b6212da1ff00c29bf75e653522affc760d5e59b134adc72c0c071fa'
BRANCH='refs/heads/preparation/sqlite-static-typecheck-db201993-4054-20261114'
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1]
ROOT=Path(os.environ['RUNNER_TEMP'])/'sqlite-static-only';ROOT.mkdir(mode=0o700)
EV=ROOT/'evidence';EV.mkdir();REPORT={'status':'STARTED_STATIC_ONLY','base':BASE,'candidateSourcePacket':'0e3a710ab63232eec31d90e994036b3a3480c65605097fe4a6f0938e2bf33366','prior4054StaticPassRun':43601671065,'candidateMeaning':'EXACT_MANAGER_ADMITTED_START_SEAL_0e3_ONLY_NOT_GLOBAL_RUNTIME','commands':[],'failures':[]}
NAMESPACE_CLEANUP_SAFE=True
NATIVE_WORKER_ENTERED=False
NATIVE_CAPTURE_DONE=False
from manager_worker_contract import validate_worker_report,capture_safe_native_files
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

def limits(cpu=240,nofile=256):
 for k,v in [(resource.RLIMIT_CORE,0),(resource.RLIMIT_CPU,cpu),(resource.RLIMIT_AS,24*1024**3),(resource.RLIMIT_NOFILE,nofile),(resource.RLIMIT_NPROC,96),(resource.RLIMIT_FSIZE,1024**3)]:resource.setrlimit(k,(v,v))

def run(label,cmd,cwd,env,wall=300,nofile=256):
 assert time.monotonic()+wall<DEADLINE,'reserve exhausted before '+label
 import selectors
 def child_setup():
  limits(nofile=nofile)
  actual={name:list(resource.getrlimit(kind))for name,kind in [('cpu',resource.RLIMIT_CPU),('as',resource.RLIMIT_AS),('nofile',resource.RLIMIT_NOFILE),('nproc',resource.RLIMIT_NPROC),('fsize',resource.RLIMIT_FSIZE),('core',resource.RLIMIT_CORE)]}
  actual['label']=label;actual['requestedNofile']=nofile
  fd=os.open(str(EV/(label+'-child-resources.json')),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  try:
   data=(json.dumps(actual,indent=2)+'\n').encode();assert os.write(fd,data)==len(data)
  finally:os.close(fd)
 t=time.monotonic();p=subprocess.Popen(cmd,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=child_setup);sel=selectors.DefaultSelector();os.set_blocking(p.stdout.fileno(),False);sel.register(p.stdout,selectors.EVENT_READ);count=0;eof=False;cause=None;signals=[];leader_exit=None
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
 actual=json.loads((EV/(label+'-child-resources.json')).read_text())
 if actual['nofile']!=[nofile,nofile]:cause=cause or {'type':'ResourceMismatch','text':'actual child NOFILE differs from reviewed phase limit'}
 row={'label':label,'childResources':actual,'nofile':nofile,'argv':cmd,'rc':p.returncode,'seconds':time.monotonic()-t,'logBytes':count,'eof':eof,'cause':cause,'signals':signals,'naturalComplete':not cause and not signals and eof}
 REPORT['commands'].append(row);emit('result.json',REPORT)
 return row

def capture_npm_debug_logs():
 # Fresh allowlisted acquisition env contains no auth/config secrets. Do not
 # export arbitrary caches, home, npmrc files, URLs with credentials or tokens.
 folder=ROOT/'empty-npm-cache'/'_logs';proof=[]
 if not folder.exists():
  emit('npm-debug-capture.json',{'directoryExisted':False,'files':[],'complete':True});return
 assert folder.is_dir()and not folder.is_symlink(),'unsafe npm logs directory'
 files=sorted(folder.rglob('*'));assert len(files)<=100,'npm debug inventory overflow'
 total=sum(p.stat().st_size for p in EV.iterdir()if p.is_file())
 for source in files:
  assert not source.is_symlink(),'npm debug symlink refused'
  if source.is_dir():continue
  assert source.is_file(),'npm debug nonregular file refused'
  size=source.stat().st_size
  assert size<=CAP and total+size<=RAW-1024**2,'npm debug evidence cap exceeded; NO partial log acceptance'
  raw=source.read_bytes();assert len(raw)==size,'npm debug changed during capture'
  # Quarantine rather than redact: original bytes are not modified for upload.
  forbidden=rb'(?i)(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:authorization|_authToken|password)\s*[:=]\s*["\x27]?(?!null\b|undefined\b|false\b)[A-Za-z0-9+/=_-]{12,}|https?://[^/\s:@]+:[^/\s@]+@)'
  assert not re.search(forbidden,raw),'possible secret in npm debug log; quarantine no byte export'
  name='npm-debug-'+str(len(proof)).zfill(3)+'.log';target=EV/name;assert not target.exists();target.write_bytes(raw);total+=size
  proof.append({'sourceRelative':str(source.relative_to(folder)),'evidenceFile':name,'bytes':size,'sha256':hashlib.sha256(raw).hexdigest()})
 emit('npm-debug-capture.json',{'directoryExisted':True,'files':proof,'complete':True,'captureBeforeCleanup':True,'bodiesUnmodified':True})

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
 if name.startswith('libsignal/node_modules/'):
  actual={str(p.relative_to(root)):p for p in root.rglob('*')if p.is_file()or p.is_symlink()}
  comparison={'package':name,'missing':sorted(set(expected)-set(actual)),'extra':sorted(set(actual)-set(expected)),
   'mismatched':[rel for rel,raw in expected.items()if rel in actual and(actual[rel].is_symlink()or not actual[rel].is_file()or actual[rel].read_bytes()!=raw)]}
  emit('libsignal-nested-'+hashlib.sha256(name.encode()).hexdigest()[:12]+'-diff.json',comparison)
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
 emit('identity-resources.json',{'node':str(node),'nodeVersion':version,'nodeSha256':sha(node),'npm':str(npm),'npmVersion':npm_version,'runnerImage':{k:os.environ.get(k)for k in ['ImageOS','ImageVersion','RUNNER_ARCH']},'meminfo':mem,'disk':disk._asdict(),'controls':'PER_PROCESS_RLIMITS_AND_GROUP_WALL_NOT_AGGREGATE_CGROUP_OR_DISK','cpuSeconds':240,'ASbytes':24*1024**3,'nofile':256,'nproc':96,'fsize':1024**3,'core':0,'compilerOldSpaceMiB':4096,'networkAcquisition':'PUBLIC_ANONYMOUS_NO_DOMAIN_FIREWALL_CLAIM','inheritedNofileSoftHard':resource.getrlimit(resource.RLIMIT_NOFILE),'acquisitionNofileProposed':4096,'compilerNofileUnchanged':256})
 baseline=ROOT/'baseline';candidate=ROOT/'candidate';before={'baseline':make_copy(baseline),'candidate':make_copy(candidate)}
 # Exact previously frozen integrated packet, not regenerated product bytes.
 integrated_packet=HERE/'integrated-0e3-source.tar.gz'
 assert sha(integrated_packet)=='0e3a710ab63232eec31d90e994036b3a3480c65605097fe4a6f0938e2bf33366'
 with tarfile.open(integrated_packet,'r:gz')as package:
  members=package.getmembers();assert len(members)<=128 and sum(m.size for m in members)<=8*1024**2
  files={}
  for member in members:
   rel=Path(member.name)
   assert not rel.is_absolute()and '..'not in rel.parts and rel.parts[0]=='receiver-integrated-source-review'
   if member.isdir():continue
   assert member.isfile()and member.name not in files,'unsafe or duplicate integrated archive member'
   files[member.name]=package.extractfile(member).read()
 prefix='receiver-integrated-source-review/'
 composition=json.loads(files[prefix+'composition.json']);assert composition['baseline']==BASE
 rows=composition['files'];assert len(rows)==53 and len({row['path']for row in rows})==53
 source_prefix=prefix+'proposed-product/'
 assert {name[len(source_prefix):]for name in files if name.startswith(source_prefix)}=={row['path']for row in rows}
 integrated_proof=[]
 for row in rows:
  rel=Path(row['path']);assert not rel.is_absolute()and '..'not in rel.parts and rel.suffix=='.ts'
  assert rel.parts[0]in {'server','services','tests'}
  raw=files[source_prefix+row['path']];dst=candidate/rel
  assert len(raw)==row['bytes']and hashlib.sha256(raw).hexdigest()==row['integratedSha256']
  assert (sha(dst)if dst.exists()else None)==row['beforeDb201993Sha256'],'integrated baseline preimage mismatch'
  dst.parent.mkdir(parents=True,exist_ok=True);assert not dst.is_symlink();dst.write_bytes(raw)
  assert sha(dst)==row['integratedSha256']
  integrated_proof.append({'path':row['path'],'bytes':len(raw),'sha256':sha(dst)})
 emit('integrated-0e3-overlay-integrity.json',{'packetSha256':sha(integrated_packet),'files':integrated_proof,'exact53FrozenBytes':True,'sourceOnlyNoProductEvaluation':True,'prior4054Run':43601671065})
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
 assert resource.getrlimit(resource.RLIMIT_NOFILE)[1]==resource.RLIM_INFINITY or resource.getrlimit(resource.RLIMIT_NOFILE)[1]>=4096,'inherited hard NOFILE below reviewed acquisition4096; STOP no escalation'
 REPORT['duBeforeAcquisition']=du();install=run('acquisition',[str(node),str(npm),'ci','--ignore-scripts','--no-audit','--no-fund'],acquisition,env,nofile=4096)
 assert sha(acquisition/'package-lock.json')==LOCK and sha(acquisition/'package.json')==PACKAGE
 assert install['naturalComplete']and install['rc']==0,'acquisition failed; STOP no automatic fallback/retry'
 deps=acquisition/'node_modules';lib=deps/'libsignal';libproof={}
 # Capture ACTUAL bounded inventory BEFORE validating, including unknown files
 # and links. Never follow a link or silently omit the nested dependencies.
 inventory=[]
 for current,dirs,names in os.walk(lib,followlinks=False):
  for name in sorted(dirs+names):
   path=Path(current)/name;mode=path.lstat().st_mode;rel=str(path.relative_to(lib))
   row={'path':rel,'kind':'directory'if stat.S_ISDIR(mode)else'symlink'if stat.S_ISLNK(mode)else'file'if stat.S_ISREG(mode)else'other','bytes':path.lstat().st_size}
   if row['kind']=='file':row['sha256']=sha(path)
   elif row['kind']=='symlink':row['target']=os.readlink(path)
   inventory.append(row);assert len(inventory)<=10000,'libsignal inventory entry cap exceeded; incomplete explicit failure'
 emit('libsignal-actual-inventory.json',inventory)
 nested_names=['libsignal/node_modules/@types/node','libsignal/node_modules/long','libsignal/node_modules/protobufjs']
 nested_keys={'node_modules/'+name for name in nested_names}
 actual_lock_nested={name for name in lock['packages']if name.startswith('node_modules/libsignal/')}
 emit('libsignal-lock-partition.json',{'rootManifest':expectedlib,'expectedNestedLockKeys':sorted(nested_keys),'actualNestedLockKeys':sorted(actual_lock_nested),'unknownLockKeys':sorted(actual_lock_nested-nested_keys),'missingLockKeys':sorted(nested_keys-actual_lock_nested)})
 assert actual_lock_nested==nested_keys,'unexpected libsignal nested lock topology'
 # Root package22 byte proof remains strict. Nested package archive boundaries
 # are separately verified against their exact lock SRI, not declared trusted
 # merely because their pathname starts with node_modules.
 expected_files=set(expectedlib);expected_links={}
 root_actual={row['path']:row for row in inventory if not row['path'].startswith('node_modules/')and row['kind']!='directory'}
 root_diff={'missing':sorted(set(expectedlib)-set(root_actual)),'unknownRootEntries':sorted(set(root_actual)-set(expectedlib)),
  'mismatched':[rel for rel,h in expectedlib.items()if rel in root_actual and(root_actual[rel]['kind']!='file'or root_actual[rel].get('sha256')!=h)],'nestedDisposition':'PENDING_EXACT_LOCK_SRI_NOT_YET_ACCEPTED'}
 emit('libsignal-root-diff.json',root_diff)
 assert not any(root_diff[key]for key in ['missing','unknownRootEntries','mismatched']),'libsignal root mismatch; inventory/rootdiff retained'
 for rel,h in expectedlib.items():libproof[rel]=h
 nested_proof=[]
 for name in nested_names:
  proof=verify_package(name,lock,deps,cache);nested_proof.append(proof)
  prefix=name[len('libsignal/'):]
  expected_files.update(prefix+'/'+row['path']for row in proof['files'])
  for command,target in lock['packages']['node_modules/'+name].get('bin',{}).items():
   assert re.fullmatch('[A-Za-z0-9_.-]+',command)and'..'not in Path(target).parts and not Path(target).is_absolute()
   link='node_modules/.bin/'+command;expected_links[link]={'target':'../'+name.split('/')[-1]+'/'+target,'file':prefix+'/'+target}
 actual_files={row['path']for row in inventory if row['kind']=='file'}
 actual_links={row['path']:row.get('target')for row in inventory if row['kind']=='symlink'}
 expected_dirs=set()
 for rel in expected_files|set(expected_links):
  expected_dirs.update(str(parent)for parent in Path(rel).parents if str(parent)!='.')
 actual_dirs={row['path']for row in inventory if row['kind']=='directory'}
 reconciliation={'unknownFiles':sorted(actual_files-expected_files),'missingFiles':sorted(expected_files-actual_files),'unknownLinks':sorted(set(actual_links)-set(expected_links)),'missingLinks':sorted(set(expected_links)-set(actual_links)),'unknownDirectories':sorted(actual_dirs-expected_dirs),'missingDirectories':sorted(expected_dirs-actual_dirs),'otherEntries':[row for row in inventory if row['kind']=='other'],'rootFiles':len(expectedlib),'nestedPackageFiles':len(expected_files)-len(expectedlib),'expectedBinLinks':expected_links,'actualLinks':actual_links}
 emit('libsignal-partition-diff.json',reconciliation)
 assert not any(reconciliation[name]for name in ['unknownFiles','missingFiles','unknownLinks','missingLinks','unknownDirectories','missingDirectories','otherEntries']),'unreconciled libsignal tree entries; inventory/diff retained'
 for rel,expected in expected_links.items():
  assert actual_links[rel]==expected['target']and (lib/rel).resolve()==(lib/expected['file']).resolve()and expected['file']in actual_files,'libsignal bin link mismatch '+rel
 emit('libsignal-nested-SRI-integrity.json',nested_proof)
 emit('libsignal-integrity.json',{'commit':'1c30d7d7e76a3b0aa120b04dc6a26f5a12dccf67','publicArchiveSha256':hashlib.sha256(public).hexdigest(),'files':libproof,'rootBoundary':'exact22sourcefiles','nestedRegistryPackages':nested_names,'nestedAllBytesVerifiedAgainstLockSRI':True,'credentialUsed':False})
 verified=[verify_package(n,lock,deps,cache)for n in ['typescript','@types/node','undici-types','vite']];emit('compiler-declarations-integrity.json',verified)
 assert [x['version']for x in verified]==['5.8.3','22.19.1','6.21.0','6.4.1']
 installed=json.loads((deps/'.package-lock.json').read_text())['packages'];missing=[]
 for name,row in lock['packages'].items():
  if not name:continue
  other=installed.get(name)
  if other is None:assert row.get('optional'),'nonoptional missing '+name;missing.append(name);continue
  assert all(row.get(k)==other.get(k)for k in ['version','resolved','integrity','link']),'metadata mismatch '+name
 assert not(set(installed)-set(lock['packages']));emit('dependency-metadata.json',{'present':len(installed),'optionalMissing':missing,'remainingBytesNotVerified':'ALL_EXCEPT_COMPILER_DECLARATIONS_LIBSIGNAL'})
 # No external network. This manager scenario only binds a loopback listener without traffic. Fail before tsc if unshare fails.
 emit('offline-system-binaries.json',system_binary_manifest())
 offline_entry=HERE/'manager-sqlite-entry.py';namespace_module=HERE/'manager_sqlite_supervisor.py'
 emit('offline-launcher-source.json',{'entrySha256':sha(offline_entry),'supervisorSha256':sha(namespace_module),'scope':'EXTERNAL_EPHEMERAL_GITHUB_VM_SYSTEM_NAMESPACE_ONLY','noHostSecurityConfigChange':True,'noRootRepoCode':True,'ipNetworkNamespaceNotFilesystemSandbox':True})
 def namespace_phase(phase,cwd):
  global NAMESPACE_CLEANUP_SAFE
  receipt=EV/(phase+'-namespace-receipt.json')
  argv=build_exact_namespace_command(phase,cwd,node,HERE/'native-manager-start-seal-worker.cjs',offline_entry,receipt,env)
  before_safe=NAMESPACE_CLEANUP_SAFE;NAMESPACE_CLEANUP_SAFE=False
  row=run_namespace_phase(phase,argv,cwd,env,EV,receipt,DEADLINE,8 if phase=='probe'else 80)
  NAMESPACE_CLEANUP_SAFE=before_safe and row['cleanupSafe']
  REPORT['commands'].append(row);emit('result.json',REPORT)
  assert row['cleanupSafe'],'namespace scope unsafe or isolation receipt incomplete; chainReaped='+str(row.get('chainReaped'))+'; isolationValidated='+str(row.get('isolationValidated'))+'; cause='+str(row.get('cause'))+'; STOP preserve copies'
  return row
 # Exact approved prebuilt+JS closure bytes; NO lifecycle hooks or build.
 from native_prerequisite import prepare_native_prerequisite
 native_manifest=prepare_native_prerequisite(HERE,deps,candidate,emit)
 (candidate/'node_modules').symlink_to(deps,target_is_directory=True)
 from factory_prerequisite import prepare_factory_prerequisite
 native_manifest=prepare_factory_prerequisite(HERE,deps,candidate,cache,native_manifest,emit)
 native_manifest.update(scenario='manager-start-seal',approvedOriginalCloseObservation='SAME admitted manager start/code/physical promises join before SAME database close; no vendor exchange')
 (ROOT/'native-manifest.json').write_text(json.dumps(native_manifest,indent=2)+'\n')
 (ROOT/'native-data').mkdir(mode=0o700)
 probe=namespace_phase('probe',ROOT);assert probe['naturalComplete']and probe['rc']==0
 NATIVE_WORKER_ENTERED=True
 worker=namespace_phase('native-manager-start-seal',candidate)
 capture_safe_native_files(ROOT,EV,NAMESPACE_CLEANUP_SAFE,NATIVE_WORKER_ENTERED,emit);NATIVE_CAPTURE_DONE=True
 assert worker['naturalComplete']and worker['rc']==0,'native worker failed or did not exit naturally'
 worker_report=json.loads((EV/'native-manager-start-seal-namespace-receipt.json.worker.json').read_text())
 validate_worker_report(worker_report,native_manifest)
 capture=json.loads((EV/'native-physical-capture.json').read_text())
 assert not capture['missingMainFile'],'NATIVE_CONTRACT:CAPTURE_MAIN_FILE_MISSING'
 expected_capture=[dict(row,file='native-'+row['file'])for row in worker_report['events'][-1]['files']]
 assert capture['files']==expected_capture,'NATIVE_CONTRACT:CAPTURE_ALL_FILES_VS_FACTORY_FINAL'
 assert check_inputs(candidate)==before['candidate']
 drift=[rel for rel,h in input_hashes['candidate'].items()if not(candidate/rel).is_file()or sha(candidate/rel)!=h];assert not drift,'source drift'
 REPORT['status']='MANAGER_ADMITTED_START_SEAL_SUBSET_COMPLETED_ONLY'
 REPORT['productTypecheckPass']=False;REPORT['nativeManagerStartSealSubsetPass']=False # Native subset is never a new typecheck/fullruntime verdict.
 REPORT['nativeManagerStartSealSubsetPass']=True
 REPORT['lifecycleAcceptance']='INCOMPLETE_UNCHANGED'
 REPORT['externalImportOwner']='UNDICI_IMPORT_AGENT_NOT_PRODUCTION_DRAINED'
 REPORT['managerMeaning']='ACTUAL_ADMITTED_MANAGER_START_ORIGINAL_WAITER_CLOSED_BEFORE_DB_NO_VENDOR_OR_GLOBAL_CLOSURE'
except BaseException as cause:
 # Frame metadata ONLY: no locals, source snippets, payload strings or args.
 trace=[{'file':Path(frame.filename).name,'line':frame.lineno,'function':frame.name}for frame in traceback.extract_tb(cause.__traceback__,limit=32)]
 named=str(cause)
 safe_message=named if len(named)<=256 and re.fullmatch(r'NATIVE_(?:PREREQUISITE|CONTRACT):[A-Za-z0-9_./:-]+',named)else 'See bounded source location; untrusted exception payload not exported'
 REPORT['status']='STATIC_PREREQUISITE_OR_VALIDATION_FAILED';REPORT['nativeManagerStartSealSubsetPass']=False
 REPORT['failures'].append({'type':type(cause).__name__,'text':safe_message,'traceFrames':trace,'traceLimit32NoLocalsNoSource':True})
 emit('native-failure-location.json',{'type':type(cause).__name__,'traceFrames':trace,'namedGuard':safe_message,'noLocalsOrSourceOrExceptionPayload':True})
finally:
 # Preserve safe reaped native files even if JSON validation/classification
 # threw. Capture failure prevents source deletion; unsafe scope stays unread.
 try:
  if NATIVE_WORKER_ENTERED and not NATIVE_CAPTURE_DONE:
   capture_safe_native_files(ROOT,EV,NAMESPACE_CLEANUP_SAFE,NATIVE_WORKER_ENTERED,emit);NATIVE_CAPTURE_DONE=True
 except BaseException as capture_error:
  REPORT['nativeManagerStartSealSubsetPass']=False
  REPORT['failures'].append({'type':type(capture_error).__name__,'text':'NATIVE_CONTRACT:FINAL_CAPTURE_INCOMPLETE','traceFrames':[{'file':Path(f.filename).name,'line':f.lineno,'function':f.name}for f in traceback.extract_tb(capture_error.__traceback__,limit=32)]})
 REPORT['seconds']=time.monotonic()-START;REPORT['duAfter']=du()
 archive=ROOT/'static-evidence.tar.gz';finalizationErrors=[]
 try:
  capture_npm_debug_logs()
  emit('result.json',REPORT)
  with tarfile.open(archive,'w:gz')as t:
   for p in sorted(EV.iterdir()):assert p.is_file()and not p.is_symlink();t.add(p,arcname=p.name)
  assert archive.stat().st_size<=GZIP,'gzip evidence overflow fail closed'
 except BaseException as cause:
  REPORT['status']='STATIC_EVIDENCE_OVERFLOW_OR_FINALIZATION_FAILED';REPORT['productTypecheckPass']=False;REPORT['nativeManagerStartSealSubsetPass']=False
  finalizationErrors.append({'stage':'evidence','type':type(cause).__name__,'text':str(cause)})
 finally:
  for name in ['baseline','candidate','acquisition','empty-npm-cache','empty-home','native-data']:
   p=ROOT/name
   try:
    if p.exists()and NAMESPACE_CLEANUP_SAFE and(not NATIVE_WORKER_ENTERED or NATIVE_CAPTURE_DONE):shutil.rmtree(p)
   except BaseException as cause:finalizationErrors.append({'stage':'cleanup:'+name,'type':type(cause).__name__,'text':str(cause)})
 cleanup={'disposableCopiesRemoved':all(not(ROOT/n).exists()for n in ['baseline','candidate','acquisition','empty-npm-cache','empty-home','native-data']),'errors':finalizationErrors,'noNativeServicesStarted':True,'namespaceCleanupSafe':NAMESPACE_CLEANUP_SAFE,'copiesPreservedIfSetupSurvives':not NAMESPACE_CLEANUP_SAFE,'nativeWorkerEntered':NATIVE_WORKER_ENTERED,'nativePhysicalCaptureComplete':NATIVE_CAPTURE_DONE,'copiesPreservedIfCaptureIncomplete':NATIVE_WORKER_ENTERED and not NATIVE_CAPTURE_DONE}
 if not cleanup['disposableCopiesRemoved']or finalizationErrors:REPORT['productTypecheckPass']=False;REPORT['nativeManagerStartSealSubsetPass']=False
 # Even if complete logs exceed policy, export an EXPLICIT failed evidence
 # manifest with hashes/lengths, never a shortened log masquerading complete.
 if finalizationErrors:
  overflow={'status':'INCOMPLETE_EVIDENCE_FAILED_NO_ACCEPTANCE','files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(EV.iterdir())if p.is_file()],'errors':finalizationErrors}
  (ROOT/'overflow.json').write_text(json.dumps(overflow,indent=2)+'\n')
 (ROOT/'cleanup.json').write_text(json.dumps(cleanup,indent=2)+'\n');(ROOT/'final-result.json').write_text(json.dumps(REPORT,indent=2)+'\n')
 finalraw=sum(p.stat().st_size for p in EV.iterdir()if p.is_file())+(ROOT/'cleanup.json').stat().st_size+(ROOT/'final-result.json').stat().st_size
 if finalraw>RAW and not finalizationErrors:
  REPORT['productTypecheckPass']=False;REPORT['nativeManagerStartSealSubsetPass']=False;REPORT['status']='STATIC_EVIDENCE_OVERFLOW_OR_FINALIZATION_FAILED';(ROOT/'final-result.json').write_text(json.dumps(REPORT,indent=2)+'\n');finalizationErrors.append({'stage':'final-raw-cap','bytes':finalraw});(ROOT/'overflow.json').write_text(json.dumps({'status':'INCOMPLETE_EVIDENCE_FAILED_NO_ACCEPTANCE','errors':finalizationErrors,'files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(EV.iterdir())if p.is_file()]},indent=2)+'\n')
 with tarfile.open(archive,'w:gz')as t:
  if not finalizationErrors:
   for p in sorted(EV.iterdir()):t.add(p,arcname=p.name)
  else:t.add(ROOT/'overflow.json',arcname='EXPLICIT-INCOMPLETE-EVIDENCE.json')
  for n in ['cleanup.json','final-result.json']:t.add(ROOT/n,arcname=n)
 assert archive.stat().st_size<=GZIP
 print(json.dumps(REPORT),flush=True)
raise SystemExit(0 if REPORT.get('nativeManagerStartSealSubsetPass')and REPORT['status']=='MANAGER_ADMITTED_START_SEAL_SUBSET_COMPLETED_ONLY'else 1)
