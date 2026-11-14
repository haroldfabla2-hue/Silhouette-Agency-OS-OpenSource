#!/usr/bin/env python3
"""SOURCE REVIEW ONLY. No invocation or workflow publication authorized yet."""
from pathlib import Path
import json,os,subprocess,shutil,hashlib,tarfile,io,base64,urllib.request,zipfile,re,stat,signal,time,selectors
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1];ROOT=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui';EV=ROOT/'evidence';BASE='db201993d05124cdb23a84cdfbc695bb3c6680d5';LOCK='039ce85293514e83584ca047d0d8b53eb7bce71bb3b3fe75fc6f96e928a0299c';START=time.monotonic();OUTCAP=16*1024**2
assert not ROOT.exists();ROOT.mkdir(mode=0o700);EV.mkdir(mode=0o700)
def sha(b):return hashlib.sha256(b).hexdigest()
def emit(n,o):
 b=(json.dumps(o,indent=2)+'\n').encode();assert len(b)<=8*1024**2;(EV/n).write_bytes(b)
def command(name,args,cwd,env,wall=180):
 assert time.monotonic()-START+wall<1020,'OVERALL_CLEANUP_RESERVE';p=subprocess.Popen(args,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True);sel=selectors.DefaultSelector();os.set_blocking(p.stdout.fileno(),False);sel.register(p.stdout,selectors.EVENT_READ);count=0;begin=time.monotonic();forced=False;failure=None
 try:
  with (EV/(name+'.log')).open('xb')as log:
   eof=False
   while True:
    if time.monotonic()-begin>wall:raise TimeoutError('COMMAND_WALL')
    for key,_ in sel.select(.1):
     b=os.read(key.fd,65536)
     if not b:eof=True;sel.unregister(key.fd);continue
     count+=len(b)
     if count>OUTCAP:raise RuntimeError('COMPLETE_OUTPUT_CAP')
     log.write(b)
    if p.poll()is not None and eof:break
 except BaseException as e:failure=type(e).__name__+':'+str(e)
 finally:
  try:os.killpg(p.pid,0);live=True
  except ProcessLookupError:live=False
  if live:
   forced=True
   subprocess.run(['sudo','-n','kill','-TERM','--','-'+str(p.pid)],timeout=5,check=False)
   try:p.wait(timeout=10)
   except subprocess.TimeoutExpired:subprocess.run(['sudo','-n','kill','-KILL','--','-'+str(p.pid)],timeout=5,check=False)
  p.wait(timeout=10);emit(name+'-receipt.json',{'code':p.returncode,'failure':failure,'forced':forced,'bytes':count,'elapsed':time.monotonic()-begin})
 assert not failure and not forced and p.returncode==0,'COMMAND_FAILED:'+name

def fetch(url,cap):
 assert url.startswith(('https://registry.npmjs.org/','https://cdn.playwright.dev/','https://codeload.github.com/whiskeysockets/libsignal-node/'))
 with urllib.request.urlopen(url,timeout=30)as r:
  assert r.url.startswith(('https://registry.npmjs.org/','https://cdn.playwright.dev/','https://playwright.download.prss.microsoft.com/','https://storage.googleapis.com/','https://codeload.github.com/whiskeysockets/libsignal-node/'));b=r.read(cap+1)
 assert len(b)<=cap;return b

def members(b):
 out={}
 with tarfile.open(fileobj=io.BytesIO(b))as t:
  for m in t.getmembers():
   if m.isdir():continue
   p=Path(m.name);assert not p.is_absolute()and '..'not in p.parts and m.isfile()
   rel='/'.join(p.parts[1:]);assert rel not in out;out[rel]=t.extractfile(m).read()
 return out

try:
 assert os.environ['PRIVATE']=='false'and os.environ['ENVIRONMENT']=='github-hosted'and os.environ['GITHUB_EVENT_NAME']=='workflow_dispatch'
 assert os.environ['GITHUB_SHA']==os.environ['EXPECTED_HEAD']==subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()
 node=Path(shutil.which('node')).resolve();assert sha(node.read_bytes())=='ccacb2d6d87ba6d118b2bffc1ae33747a05cc5fc6b1f1ec4fc1d420b687e952d';assert subprocess.check_output([str(node),'--version'],text=True).strip()=='v22.18.0'
 assert shutil.disk_usage(ROOT).free>=8*1024**3
 for binary in ['bwrap','sudo','git']:assert shutil.which(binary),'MISSING_PREREQUISITE:'+binary
 app=ROOT/'app';app.mkdir();raw=subprocess.check_output(['git','archive',BASE],cwd=REPO)
 with tarfile.open(fileobj=io.BytesIO(raw))as t:
  for m in t.getmembers():
   p=Path(m.name);assert not p.is_absolute()and '..'not in p.parts
   if m.isdir():continue
   assert m.isfile();d=app/p;d.parent.mkdir(parents=True,exist_ok=True);d.write_bytes(t.extractfile(m).read())
 frozen=(HERE/'integrated-0e3-source.tar.gz').read_bytes();assert sha(frozen)=='0e3a710ab63232eec31d90e994036b3a3480c65605097fe4a6f0938e2bf33366'
 with tarfile.open(fileobj=io.BytesIO(frozen))as t:files={m.name:t.extractfile(m).read()for m in t.getmembers()if m.isfile()}
 prefix='receiver-integrated-source-review/';c=json.loads(files[prefix+'composition.json']);assert len(c['files'])==53 and c['baseline']==BASE
 for r in c['files']:
  p=app/r['path'];b=files[prefix+'proposed-product/'+r['path']];assert(sha(p.read_bytes())if p.exists()else None)==r['beforeDb201993Sha256'];assert sha(b)==r['integratedSha256'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
 bp=(HERE/'body-custody-composition.json').read_bytes();assert sha(bp)=='ccb4bb65ec62060b9cfc2fea6172c428b02d7b4e7da7754b8abc44a09a09f520'
 for r in json.loads(bp)['files']:
  p=app/r['path'];b=(HERE/'body-custody-overlay'/r['path']).read_bytes();assert(sha(p.read_bytes())if p.exists()else None)==r['beforeSha256'];assert sha(b)==r['afterSha256'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
 classification=json.loads((HERE/'state-classification.json').read_text());actual={str(p.relative_to(app)):sha(p.read_bytes())for p in app.rglob('*')if p.is_file()};assert actual=={r['path']:r['sha256']for r in classification['files']}
 excluded=[]
 for r in classification['files']:
  if not r['include']:(app/r['path']).unlink();excluded.append(r)
 # Source staging classification explicitly excludes all historical data; only
 # empty writable directories and code/migrations admitted into fresh runtime.
 for d in ['db','data','uploads','logs']:(app/d).mkdir(exist_ok=True)
 emit('source-materialization.json',{'base':BASE,'filesBeforeStateExclusion':len(actual),'excluded':excluded,'historicalStateInput':False,'source54Applied':True,'rootBComplete':False})
 acquisition=ROOT/'acquisition';acquisition.mkdir()
 for name in ['package.json','package-lock.json']:shutil.copyfile(app/name,acquisition/name)
 assert sha((acquisition/'package-lock.json').read_bytes())==LOCK
 cache=ROOT/'npm-cache';cache.mkdir();home=ROOT/'npm-home';home.mkdir();empty=ROOT/'empty-npmrc';empty.write_text('');globalempty=ROOT/'empty-globalnpmrc';globalempty.write_text('')
 guard=ROOT/'git-guard';guard.mkdir();g=guard/'git';g.write_text('#!/bin/sh\ncase "$*" in --version|version) exec /usr/bin/git "$@" ;; *) printf "GIT_FALLBACK_DENIED\\n" >&2; exit 97 ;; esac\n');g.chmod(0o700)
 env={'PATH':str(guard)+':'+os.environ['PATH'],'HOME':str(home),'NPM_CONFIG_USERCONFIG':str(empty),'NPM_CONFIG_GLOBALCONFIG':str(globalempty),'NPM_CONFIG_CACHE':str(cache),'NPM_CONFIG_IGNORE_SCRIPTS':'true','NPM_CONFIG_AUDIT':'false','NPM_CONFIG_FUND':'false','NPM_CONFIG_FETCH_RETRIES':'0','PUPPETEER_SKIP_DOWNLOAD':'true','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD':'true','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':str(empty),'GIT_CONFIG_COUNT':'2','GIT_CONFIG_KEY_0':'url.https://github.com/whiskeysockets/libsignal-node.git.insteadOf','GIT_CONFIG_VALUE_0':'ssh://git@github.com/whiskeysockets/libsignal-node.git','GIT_CONFIG_KEY_1':'credential.helper','GIT_CONFIG_VALUE_1':'','GIT_TERMINAL_PROMPT':'0','GIT_ASKPASS':'/bin/false','GIT_SSH_COMMAND':'/bin/false'}
 # Verify fullSHA git dependency archive BEFORE npm can inspect its manifest.
 public=fetch('https://codeload.github.com/whiskeysockets/libsignal-node/tar.gz/1c30d7d7e76a3b0aa120b04dc6a26f5a12dccf67',1024**2);assert sha(public)=='a9e14823efa911474aaa9e8f6bfb88759f869a3bc25116e969be943b84bef318';lp=json.loads(members(public)['package.json']);assert not lp.get('scripts')and not lp.get('workspaces')
 npm=Path(shutil.which('npm')).resolve();command('npm-config-preflight',[str(node),str(npm),'config','list','--json'],acquisition,env,10);conf=json.loads((EV/'npm-config-preflight.log').read_text());assert conf['ignore-scripts']is True and conf['audit']is False and conf['fund']is False and conf['fetch-retries']==0 and conf['userconfig']==str(empty)and conf['globalconfig']==str(globalempty)
 command('dependency-acquisition',[str(node),str(npm),'ci','--ignore-scripts','--no-audit','--no-fund'],acquisition,env,300);assert sha((acquisition/'package-lock.json').read_bytes())==LOCK
 deps=acquisition/'node_modules';lock=json.loads((acquisition/'package-lock.json').read_text());proof=[];missing=[]
 # ALL installed registry package members compared to lock-SRI cached archives.
 for rel,row in lock['packages'].items():
  if not rel:continue
  root=acquisition/rel
  if not root.exists():assert row.get('optional');missing.append(rel);continue
  if rel=='node_modules/libsignal':
   b=fetch('https://codeload.github.com/whiskeysockets/libsignal-node/tar.gz/1c30d7d7e76a3b0aa120b04dc6a26f5a12dccf67',1024**2);assert sha(b)=='a9e14823efa911474aaa9e8f6bfb88759f869a3bc25116e969be943b84bef318';expected=members(b);packed=json.loads((HERE/'libsignal-packed-files.json').read_text());expected={k:expected[k]for k in packed};assert {k:sha(v)for k,v in expected.items()}==packed
  else:
   alg,sri=row['integrity'].split('-',1);digest=base64.b64decode(sri);h=digest.hex();cp=cache/'_cacache/content-v2'/alg/h[:2]/h[2:4]/h[4:];assert cp.is_file(),'MISSING_CACHED_SRI:'+rel;b=cp.read_bytes();assert hashlib.new(alg,b).digest()==digest;expected=members(b)
  for name,b in expected.items():
   path=root/name;assert path.is_file()and not path.is_symlink()and path.read_bytes()==b,'DEPENDENCY_MEMBER_MISMATCH:'+rel+'/'+name
  own={str(p.relative_to(root))for p in root.rglob('*')if p.is_file()and 'node_modules'not in p.relative_to(root).parts};assert own=={k for k in expected if 'node_modules'not in Path(k).parts},'EXTRA_PACKAGE_FILES:'+rel
  proof.append({'path':rel,'version':row.get('version'),'files':len(expected),'sourceIntegrity':row.get('integrity','exactlibsignalcommit')})
 emit('dependency-members.json',{'verified':proof,'optionalAbsent':missing,'lifecycleScripts':False})
 # Existing reviewed native tar is a separately explicit added member, not hook.
 archive=HERE/'native-provenance/better-sqlite3-v12.5.0-node-v127-linux-x64.tar.gz';assert sha(archive.read_bytes())=='42451490221883f4edb84fc3453a2fce9b7489ce655192cd5531b5955a8faa4b'
 with tarfile.open(archive)as t:
  ms=t.getmembers();assert len(ms)==1 and ms[0].name=='build/Release/better_sqlite3.node'and ms[0].isfile();b=t.extractfile(ms[0]).read();d=deps/'better-sqlite3'/ms[0].name;d.parent.mkdir(parents=True);d.write_bytes(b)
 # Pinned official Playwright browser ZIP. No playwright install command/hooks.
 browser=ROOT/'browser';browser.mkdir();bp=json.loads((HERE/'chromium-provenance.json').read_text());raw=fetch(bp['url'],128*1024**2);assert sha(raw)==bp['archiveSha256']
 with zipfile.ZipFile(io.BytesIO(raw))as z:
  expected={r['path']:r for r in bp['files']};assert {n for n in z.namelist()if not n.endswith('/')}==set(expected)
  for n,r in expected.items():
   p=Path(n);assert not p.is_absolute()and '..'not in p.parts;b=z.read(n);assert len(b)==r['bytes']and sha(b)==r['sha256'];d=browser/p;d.parent.mkdir(parents=True,exist_ok=True);d.write_bytes(b);mode=(z.getinfo(n).external_attr>>16)&0o777;d.chmod(mode or 0o644)
 (browser/'chrome-headless-shell-linux64/chrome-headless-shell').chmod(0o755)
 # Normal node_modules location preserves Node sibling package resolution.
 # Dependency files RO; only explicit .vite-temp tmpfs scratch is writable.
 (app/'node_modules').mkdir();(deps/'.vite-temp').mkdir()
 (app/'RUNTIME-MATERIALIZATION-REVIEWED.json').write_text(json.dumps({'base':BASE,'source54':True,'historicalState':False,'providerMode':'off','runnableOnlyInsideIsolatedPhase':True})+'\n')
 nodeRoot=node.parents[1]
 for phase in ['ui-build','server-build','runtime']:
  command(phase,['sudo','-n',str(shutil.which('python3')),str(HERE/'supervisor.py'),'--phase',phase,'--app',str(app),'--deps',str(deps),'--browser',str(browser),'--review-dir',str(HERE),'--node-root',str(nodeRoot),'--cgroup-parent','/sys/fs/cgroup','--cgroup-tag',os.environ['GITHUB_RUN_ID'],'--memory-bytes',str(3*1024**3),'--wall-seconds','180','--evidence',str(EV/phase)],REPO,{'PATH':os.environ['PATH']},200)
 emit('result.json',{'status':'INTEGRATED_PHASES_EXITED','providers':'off','localInference':False,'AIProven':False,'authenticatedChatStorageProven':False,'rootBComplete':False,'global':'INCOMPLETE'})
except BaseException as e:
 emit('failure.json',{'type':type(e).__name__,'message':str(e),'global':'INCOMPLETE','forcedOrMissingEvidenceNeverPass':True});raise
