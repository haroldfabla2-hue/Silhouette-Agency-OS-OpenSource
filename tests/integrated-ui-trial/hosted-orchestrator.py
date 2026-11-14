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
 assert time.monotonic()-START+wall+35<1020,'OVERALL_WALL_RECOVERY_OVERHEAD_RESERVE';p=subprocess.Popen(args,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True);sel=selectors.DefaultSelector();os.set_blocking(p.stdout.fileno(),False);sel.register(p.stdout,selectors.EVENT_READ);count=0;begin=time.monotonic();forced=False;failure=None
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

NORMALIZATION_MANIFEST_SHA='e7ffbf50f9f4f27d17acdf55f27918609302313d0b0adc28df6366eda15ba5b2'
normalizationRaw=(HERE/'archive-member-normalizations.json').read_bytes();assert sha(normalizationRaw)==NORMALIZATION_MANIFEST_SHA
normalizations=json.loads(normalizationRaw);assert normalizations['lockSha256']==LOCK
archiveDiagnostics={'status':'VERIFYING_NOT_PRODUCT_PASS','normalizations':[],'failure':None}
def members(b,*,mode,package=None,integrity=None):
 # No last-wins rule: only finite reviewed identical aliases from exact SRI.
 out={};seen={};duplicates=[];archiveSha=sha(b);contract=normalizations['packages'].get(package)
 try:
  assert mode in {'raw-libsignal-source','installed-registry'},'EXPLICIT_ARCHIVE_MODE_REQUIRED'
  if mode=='raw-libsignal-source':
   assert package is None and integrity is None and archiveSha=='a9e14823efa911474aaa9e8f6bfb88759f869a3bc25116e969be943b84bef318','RAW_SOURCE_ARCHIVE_IDENTITY_MISMATCH'
  else:
   assert type(package)is str and package.startswith('node_modules/')and type(integrity)is str,'INSTALLED_REGISTRY_CONTEXT_REQUIRED'
   algorithm,expected=integrity.split('-',1);assert hashlib.new(algorithm,b).digest()==base64.b64decode(expected),'REGISTRY_SRI_MISMATCH'
  if contract is not None:assert contract['integrity']==integrity and contract['archiveSha256']==archiveSha,'NORMALIZATION_ARCHIVE_IDENTITY_MISMATCH'
  with tarfile.open(fileobj=io.BytesIO(b))as t:
   for index,m in enumerate(t.getmembers()):
    if m.isdir():continue
    p=Path(m.name);assert not p.is_absolute()and '..'not in p.parts and m.isfile(),'UNSAFE_OR_NONREGULAR_ARCHIVE_MEMBER'
    rel='/'.join(p.parts[1:]);assert rel,'EMPTY_ARCHIVE_MEMBER'
    data=t.extractfile(m).read()
    member={'name':m.name,'type':m.type.decode('ascii'),'size':m.size,'mode':m.mode,'uid':m.uid,'gid':m.gid,'uname':m.uname,'gname':m.gname,'mtime':m.mtime,'pax':m.pax_headers,'sha256':sha(data)}
    current={'index':index,'member':member}
    if rel in seen:
     assert mode=='installed-registry','RAW_SOURCE_DUPLICATE_FORBIDDEN'
     alias={'canonical':rel,'first':seen[rel],'repeat':current}
     assert contract is not None and alias in contract['duplicates'],'UNREVIEWED_ARCHIVE_ALIAS'
     assert data==out[rel]and all(member[k]==seen[rel]['member'][k]for k in member if k!='name'),'UNEQUAL_ARCHIVE_ALIAS'
     duplicates.append(alias)
    else:seen[rel]=current;out[rel]=data
  assert duplicates==(contract['duplicates']if contract is not None else[]),'MISSING_OR_REORDERED_REVIEWED_ALIASES'
  renames=[]
  for source in (list(out)if mode=='installed-registry'else[]):
   if Path(source).name=='.gitignore':
    target=str(Path(source).with_name('.npmignore'));rename={'from':source,'to':target,'member':seen[source]}
    assert contract is not None and rename in contract['renames'],'UNREVIEWED_INSTALLER_RENAME'
    assert target not in out,'INSTALLER_RENAME_COLLISION'
    out[target]=out.pop(source);renames.append(rename)
  assert renames==(contract['renames']if contract is not None else[]),'MISSING_OR_REORDERED_INSTALLER_RENAMES'
  if duplicates or renames:
   archiveDiagnostics['normalizations'].append({'mode':mode,'package':package,'archiveSha256':archiveSha,'integrity':integrity,'duplicates':duplicates,'renames':renames})
   emit('dependency-archive-verification.json',archiveDiagnostics)
  return out
 except BaseException as e:
  archiveDiagnostics['status']='FAIL_ARCHIVE_MEMBER_VERIFICATION';archiveDiagnostics['failure']={'mode':mode,'package':package,'archiveSha256':archiveSha,'category':type(e).__name__,'reason':str(e)if isinstance(e,AssertionError)else'ARCHIVE_PARSE_OR_READ_FAILED'}
  emit('dependency-archive-verification.json',archiveDiagnostics);raise

try:
 assert os.environ['PRIVATE']=='false'and os.environ['ENVIRONMENT']=='github-hosted'and os.environ['GITHUB_EVENT_NAME']in {'workflow_dispatch','push'}
 if os.environ['GITHUB_EVENT_NAME']=='push':
  assert subprocess.check_output(['git','rev-parse','HEAD^'],cwd=REPO,text=True).strip()=='53b68d46317a16bd0220d7e2ac794d7580b493d2'
  assert os.environ['GITHUB_REF']=='refs/heads/preparation/sqlite-static-typecheck-db201993-4054-20261114'
 assert os.environ['GITHUB_SHA']==os.environ['EXPECTED_HEAD']==subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()
 node=Path(shutil.which('node')).resolve();assert sha(node.read_bytes())=='ccacb2d6d87ba6d118b2bffc1ae33747a05cc5fc6b1f1ec4fc1d420b687e952d';assert subprocess.check_output([str(node),'--version'],text=True).strip()=='v22.18.0'
 assert shutil.disk_usage(ROOT).free>=8*1024**3
 # Aggregate all current host prerequisites before any project acquisition.
 command('host-qualification',['/usr/bin/python3',str(HERE/'qualify-host.py'),str(EV/'host-qualification.json')],REPO,{'PATH':os.environ['PATH'],'ImageOS':os.environ.get('ImageOS',''),'ImageVersion':os.environ.get('ImageVersion','')},30)
 command('security-preparation',['/usr/bin/python3',str(HERE/'prepare-security.py'),str(EV),os.environ['GITHUB_RUN_ID']],REPO,{'PATH':'/usr/bin:/bin','RUNNER_TEMP':os.environ['RUNNER_TEMP']},170)
 security=json.loads((EV/'security-preparation.json').read_text());assert security['status']=='AUTHENTICATED_STAGED_NOT_RUNTIME_PASS'and security['rootKeyScopeAbsent']and not security['forced'];bwrap=Path(security['binary']);assert sha(bwrap.read_bytes())=='e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71'
 # Same actual supervisor/root/net/capability path, empty disposable roots only.
 probe=ROOT/'probe-app';probe.mkdir();(probe/'node_modules').mkdir();probeDeps=ROOT/'probe-deps';probeDeps.mkdir();(probeDeps/'.vite-temp').mkdir();probeBrowser=ROOT/'probe-browser';probeBrowser.mkdir();(probe/'RUNTIME-MATERIALIZATION-REVIEWED.json').write_text('{}')
 command('environment-probe',['sudo','-n','/usr/bin/python3',str(HERE/'supervisor.py'),'--phase','preflight','--app',str(probe),'--deps',str(probeDeps),'--browser',str(probeBrowser),'--review-dir',str(HERE),'--node-root',str(node.parents[1]),'--bwrap',str(bwrap),'--cgroup-parent','/sys/fs/cgroup','--cgroup-tag',os.environ['GITHUB_RUN_ID'],'--memory-bytes',str(3*1024**3),'--wall-seconds','180','--evidence',str(EV/'environment-probe')],REPO,{'PATH':'/usr/bin:/bin'},200)

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
 # Exact reviewed correction overlay AFTER immutable failed-source verification.
 correctionRaw=(HERE/'runtime-browser-composition.json').read_bytes();assert sha(correctionRaw)=='12718cedc387b979cc83b6e6ea025179723f934d3fefa1c8ae8798230daf8599'
 correction=json.loads(correctionRaw);assert correction['basePublishedParent']=='c2a1c7fd3316027bf45c318d78144111717951d8'and len(correction['files'])==7
 for r in correction['files']:
  p=app/r['path'];b=(HERE/'runtime-browser-overlay'/r['path']).read_bytes();assert(sha(p.read_bytes())if p.exists()else None)==r['beforeSha256'];assert len(b)==r['bytes']and sha(b)==r['afterSha256'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
 corrected={str(p.relative_to(app)):sha(p.read_bytes())for p in app.rglob('*')if p.is_file()};assert corrected==correction['finalProductFiles']
 # Exact admitted diagnostic overlay after prior corrected identity verification.
 diagnosticRaw=(HERE/'finite-diagnostics-composition.json').read_bytes();assert sha(diagnosticRaw)=='21eb825b2aecb5292674e739fb2010693e45d74c38051ef84f277586fa250757'
 diagnostic=json.loads(diagnosticRaw);assert diagnostic['basePublishedParent']=='4ca45ac90eac1e3b57b34067de161551a075893c'and len(diagnostic['files'])==3
 for r in diagnostic['files']:
  p=app/r['path'];b=(HERE/'finite-diagnostics-overlay'/r['path']).read_bytes();assert sha(p.read_bytes())==r['beforeSha256'];assert len(b)==r['bytes']and sha(b)==r['afterSha256'];p.write_bytes(b)
 diagnosticActual={str(p.relative_to(app)):sha(p.read_bytes())for p in app.rglob('*')if p.is_file()};assert diagnosticActual==diagnostic['finalProductFiles']
 # Accepted fixed continuum source overlay after exact diagnostics identity.
 continuumRaw=(HERE/'continuum-composition.json').read_bytes();assert sha(continuumRaw)=='cbcd4b64bd9901d629ef54c45a074a40391fe33d8f73170297fe7f8a391836f9'
 continuum=json.loads(continuumRaw);assert continuum['basePublishedParent']=='39be237722acdf70547d0888ac6d5b417f29022b'and len(continuum['files'])==11
 for r in continuum['files']:
  p=app/r['path'];b=(HERE/'continuum-overlay'/r['path']).read_bytes();assert(sha(p.read_bytes())if p.exists()else None)==r['beforeSha256'];assert len(b)==r['bytes']and sha(b)==r['afterSha256'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
 continuumActual={str(p.relative_to(app)):sha(p.read_bytes())for p in app.rglob('*')if p.is_file()};assert continuumActual==continuum['finalProductFiles']
 # Source-fixed bounded diagnostic layer; historical prior manifests immutable.
 boundaryRaw=(HERE/'runtime-boundary-composition.json').read_bytes();assert sha(boundaryRaw)=='281cafb64b90f7ed100a685f0b9725274605da4b00ed2a71fc34cfb821bc4fe7'
 boundary=json.loads(boundaryRaw);assert boundary['basePublishedParent']=='dbc5809e6dcf7ee9f3fee0eb6d147c297ee8761e'and len(boundary['files'])==4
 for r in boundary['files']:
  p=app/r['path'];b=(HERE/'runtime-boundary-overlay'/r['path']).read_bytes();assert sha(p.read_bytes())==r['beforeSha256'];assert len(b)==r['bytes']and sha(b)==r['afterSha256'];p.write_bytes(b)
 boundaryActual={str(p.relative_to(app)):sha(p.read_bytes())for p in app.rglob('*')if p.is_file()};assert boundaryActual==boundary['finalProductFiles']
 # Exact terminal Redis ownership overlay; historical layers immutable.
 redisRaw=(HERE/'redis-terminal-composition.json').read_bytes();assert sha(redisRaw)=='605628b62a49b3c3dce38f8e154638c6be9294f2470ed30ef8a25ee14f1c00ec'
 redisComposition=json.loads(redisRaw);assert redisComposition['basePublishedParent']=='822be2f3b219459cc2b24d860118dbac52a49ff3'and len(redisComposition['files'])==1
 for r in redisComposition['files']:
  p=app/r['path'];b=(HERE/'redis-terminal-overlay'/r['path']).read_bytes();assert sha(p.read_bytes())==r['beforeSha256'];assert len(b)==r['bytes']and sha(b)==r['afterSha256'];p.write_bytes(b)
 redisActual={str(p.relative_to(app)):sha(p.read_bytes())for p in app.rglob('*')if p.is_file()};assert redisActual==redisComposition['finalProductFiles']
 generationRaw=(HERE/'generation-borrow-composition.json').read_bytes();assert sha(generationRaw)=='0c567fa373d8d6f88de8452a447c800345166710992b7a9f6893c7d32b7e308b'
 generation=json.loads(generationRaw);assert generation['priorComposition']==sha(redisRaw)and len(generation['files'])==1
 for r in generation['files']:
  p=app/r['path'];b=(HERE/'generation-borrow-overlay'/r['path']).read_bytes();assert sha(p.read_bytes())==r['beforeSha256'];assert len(b)==r['bytes']and sha(b)==r['afterSha256'];p.write_bytes(b)
 assert {str(p.relative_to(app)):sha(p.read_bytes())for p in app.rglob('*')if p.is_file()}==generation['finalProductFiles']
 lateRaw=(HERE/'latehandle-diagnostic-composition.json').read_bytes();assert sha(lateRaw)=='63326507938259a3deb68e2768cbaed8519f3c21990e962a4f74bb646b08af2f'
 late=json.loads(lateRaw);assert late['priorComposition']==sha(generationRaw)and len(late['files'])==1
 for r in late['files']:
  p=app/r['path'];b=(HERE/'latehandle-diagnostic-overlay'/r['path']).read_bytes();assert sha(p.read_bytes())==r['beforeSha256'];assert len(b)==r['bytes']and sha(b)==r['afterSha256'];p.write_bytes(b)
 assert {str(p.relative_to(app)):sha(p.read_bytes())for p in app.rglob('*')if p.is_file()}==late['finalProductFiles']
 functionalRaw=(HERE/'functional-auth-composition.json').read_bytes();assert sha(functionalRaw)=='25f49a318b3c98f0959621d89deaf9c11d9075844112efb610669b6d50183cda'
 functional=json.loads(functionalRaw);assert functional['priorComposition']==sha(lateRaw)and len(functional['files'])==5
 for r in functional['files']:
  p=app/r['path'];b=(HERE/'functional-auth-overlay'/r['path']).read_bytes();assert sha(p.read_bytes())==r['beforeSha256'];assert len(b)==r['bytes']and sha(b)==r['afterSha256'];p.write_bytes(b)
 assert {str(p.relative_to(app)):sha(p.read_bytes())for p in app.rglob('*')if p.is_file()}==functional['finalProductFiles']
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
 public=fetch('https://codeload.github.com/whiskeysockets/libsignal-node/tar.gz/1c30d7d7e76a3b0aa120b04dc6a26f5a12dccf67',1024**2);assert sha(public)=='a9e14823efa911474aaa9e8f6bfb88759f869a3bc25116e969be943b84bef318';lp=json.loads(members(public,mode='raw-libsignal-source')['package.json']);assert not lp.get('scripts')and not lp.get('workspaces')
 npm=Path(shutil.which('npm')).resolve();npmRoot=npm.parents[1]
 installerHashes={'package.json': 'b5bd3f6aae88de512aaa0fa6feda155c971ad20040d03962443b5523b0393f4f', 'node_modules/pacote/package.json': '51c6b58827f0eb9c6aa35253f86c460a02324509c05bfcd4e37fbf4bea54bdfa', 'node_modules/pacote/lib/fetcher.js': '1a385341f75d6c77496d30e7751012ad91489bb8c4e4e4db5e4568d2b9432a79', 'node_modules/tar/package.json': '89bd6d32c9e56eab63f3f62b96080aa43afa530675701610d74793d4719d1137', 'node_modules/tar/lib/unpack.js': '665c35a372a9021781ba5611cb269b91f20ccc1ef6182ef47ad284d2fb8a3adf', 'node_modules/tar/lib/path-reservations.js': '99c5c411dd9597070aa2cbba6b0cc18834f0c2550fe5c9bb14daa2a6a0869299'}
 assert npm.name=='npm-cli.js'and npm.parent.name=='bin'and npmRoot.name=='npm','SELECTED_NPM_LAYOUT_MISMATCH'
 assert all(sha((npmRoot/name).read_bytes())==digest for name,digest in installerHashes.items()),'BUNDLED_INSTALLER_SOURCE_IDENTITY_MISMATCH'
 archiveDiagnostics['verifiedInstallerSourceHashes']=installerHashes;emit('dependency-archive-verification.json',archiveDiagnostics)
 command('npm-config-preflight',[str(node),str(npm),'config','list','--json'],acquisition,env,10);conf=json.loads((EV/'npm-config-preflight.log').read_text());assert conf['ignore-scripts']is True and conf['audit']is False and conf['fund']is False and conf['fetch-retries']==0 and conf['userconfig']==str(empty)and conf['globalconfig']==str(globalempty)
 command('dependency-acquisition',[str(node),str(npm),'ci','--ignore-scripts','--no-audit','--no-fund'],acquisition,env,300);assert sha((acquisition/'package-lock.json').read_bytes())==LOCK
 deps=acquisition/'node_modules';lock=json.loads((acquisition/'package-lock.json').read_text());proof=[];missing=[]
 # ALL installed registry package members compared to lock-SRI cached archives.
 for rel,row in lock['packages'].items():
  if not rel:continue
  root=acquisition/rel
  if not root.exists():assert row.get('optional');missing.append(rel);continue
  if rel=='node_modules/libsignal':
   b=fetch('https://codeload.github.com/whiskeysockets/libsignal-node/tar.gz/1c30d7d7e76a3b0aa120b04dc6a26f5a12dccf67',1024**2);assert sha(b)=='a9e14823efa911474aaa9e8f6bfb88759f869a3bc25116e969be943b84bef318';expected=members(b,mode='raw-libsignal-source');packed=json.loads((HERE/'libsignal-packed-files.json').read_text());expected={k:expected[k]for k in packed};assert {k:sha(v)for k,v in expected.items()}==packed
  else:
   alg,sri=row['integrity'].split('-',1);digest=base64.b64decode(sri);h=digest.hex();cp=cache/'_cacache/content-v2'/alg/h[:2]/h[2:4]/h[4:];assert cp.is_file(),'MISSING_CACHED_SRI:'+rel;b=cp.read_bytes();assert hashlib.new(alg,b).digest()==digest;expected=members(b,mode='installed-registry',package=rel,integrity=row['integrity'])
  for name,b in expected.items():
   path=root/name;assert path.is_file()and not path.is_symlink()and path.read_bytes()==b,'DEPENDENCY_MEMBER_MISMATCH:'+rel+'/'+name
  own={str(p.relative_to(root))for p in root.rglob('*')if p.is_file()and 'node_modules'not in p.relative_to(root).parts};assert own=={k for k in expected if 'node_modules'not in Path(k).parts},'EXTRA_PACKAGE_FILES:'+rel
  proof.append({'path':rel,'version':row.get('version'),'files':len(expected),'sourceIntegrity':row.get('integrity','exactlibsignalcommit')})
 archiveDiagnostics['status']='ALL_INSTALLED_ARCHIVE_MEMBERS_VERIFIED_NOT_PRODUCT_PASS';emit('dependency-archive-verification.json',archiveDiagnostics)
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
 phaseFailures=[]
 for phase in ['runtime-prerequisites','ui-build','continuum-regressions','redis-regressions','server-build','runtime']:
  # New finite phase admitted only with its full235s outer slot AND both
  # remaining235s server/runtime slots inside1020s, including recovery. Remaining180s of20min
  # belongs to cleanup/export, never new tests. Refusal is FAIL, no extension.
  if phase=='redis-regressions':assert time.monotonic()-START+705<1020,'REDIS_PHASE_AND_REMAINING_SLOTS_RESERVE'
  try:command(phase,['sudo','-n',str(shutil.which('python3')),str(HERE/'supervisor.py'),'--bwrap',str(bwrap),'--phase',phase,'--app',str(app),'--deps',str(deps),'--browser',str(browser),'--review-dir',str(HERE),'--node-root',str(nodeRoot),'--cgroup-parent','/sys/fs/cgroup','--cgroup-tag',os.environ['GITHUB_RUN_ID'],'--memory-bytes',str(3*1024**3),'--wall-seconds','180','--evidence',str(EV/phase)],REPO,{'PATH':os.environ['PATH']},200)
  except AssertionError:
   # Only clean natural ui-build code1 diagnostic failures can continue. Any
   # supervisor/cgroup/output/identity/cap/timeout defect remains hard failure.
   if phase in ['ui-build','continuum-regressions','redis-regressions']:
    outer=json.loads((EV/(phase+'-receipt.json')).read_text())
    assert outer['code']==1 and outer['failure']is None and outer['forced']is False,'NATURAL_OUTER_COMMAND_RECEIPT_REQUIRED'
   if phase=='redis-regressions':
    sr=json.loads((EV/phase/'supervisor.json').read_text());fr=json.loads((EV/phase/'redis-validation.json').read_text())
    assert sr['code']==1 and sr['failure']is None and not sr['events']and not sr['remainingPids']and sr['cgroupRemoved']is True
    assert fr['phase']==phase and fr['status']=='FAIL_OR_INCOMPLETE_NOT_PRODUCT_PASS'and fr['allModesAccounted']is True and fr['fatal']is False
    from importlib.util import spec_from_file_location,module_from_spec
    spec=spec_from_file_location('redis_phase_schema',HERE/'redis-receipt-schema.py');rs=module_from_spec(spec);spec.loader.exec_module(rs)
    receipts={m:json.loads((EV/phase/('redis-mode-'+m+'.json')).read_text())for m in rs.MODES}
    rs.summary_receipt(fr,receipts)
    # Natural assertionred is retained in exactreceipts, not expectedFAILgreen.
    # All8must be accounted with actualphysicalcontainment; no timeout bypass.
    phaseFailures.append({'phase':phase,'code':1,'source':'redis-validation.json','meaning':'REAL_REDIS_ASSERTIONS_AND_ORIGINAL_FAILURES_RETAINED_NOT_PRODUCT_PASS'})
    continue
   if phase=='continuum-regressions':
    sr=json.loads((EV/phase/'supervisor.json').read_text());fr=json.loads((EV/phase/'continuum-validation.json').read_text())
    assert sr['code']==1 and sr['failure']is None and not sr['events']and not sr['remainingPids']and sr['cgroupRemoved']is True
    assert fr['phase']==phase and fr['status']=='FAIL_OR_INCOMPLETE_NOT_PRODUCT_PASS'and fr['allModesAccounted']is True and fr['fatal']is False
    modes=['constructors','identity-existing','saturated-replay','schema-and-write-failure','power-check','timer-armed','timer-fired','threshold']
    assert [r['mode']for r in fr['rows']]==modes
    for r in fr['rows']:
     assert r['code']==0 and r['timeout']is False and r['failure']is None and r['forcedOrGroupRemained']is False and r['receipt']is True and r['assertionsComplete']is True
     assert len(r['cleanup'])==2 and all(x in ['fulfilled','rejected']for x in r['cleanup'])
     assert r['productVerdict']in ['FAIL_RETAINED_ORIGINAL_EVIDENCE','INCOMPLETE_FRONTIER']
    phaseFailures.append({'phase':phase,'code':1,'source':'continuum-validation.json','meaning':'ACTUAL_ASSERTIONS_COMPLETED_ORIGINAL_PRODUCT_FAILURES_OR_FRONTIER_RETAINED'})
    continue
   if phase!='ui-build':raise
   sr=json.loads((EV/phase/'supervisor.json').read_text());fr=json.loads((EV/phase/'finite-validation.json').read_text());br=json.loads((EV/phase/'emitted-bootstrap-inspection.json').read_text())
   assert sr['code']==1 and sr['failure']is None and not sr['events']and not sr['remainingPids']and sr['cgroupRemoved']is True
   assert fr['status']=='FAIL'and any(r.get('code')not in [0,None]or r.get('timeout')for r in fr['rows'])
   assert all(not r.get('timeout')for r in fr['rows']),'NO_TIMEOUT_DIAGNOSTIC_CONTINUATION'
   assert br['status']=='EMITTED_STATIC_BOUNDARY_INSPECTED_NOT_BROWSER_EVALUATION'and(app/'dist/index.html').is_file()
   phaseFailures.append({'phase':phase,'code':1,'source':'finite-validation.json','meaning':'ORDINARY_FINITE_CHECK_FAILED_AGGREGATE_FAIL'})
 emit('result.json',{'status':'FAIL_FINITE_VALIDATION_WITH_ACTUAL_RUNTIME_DIAGNOSTICS'if phaseFailures else'INTEGRATED_PHASES_EXITED','retainedPhaseFailures':phaseFailures,'providers':'off','localInference':False,'AIProven':False,'authenticatedChatStorageProven':False,'rootBComplete':False,'global':'INCOMPLETE'})
 if phaseFailures:raise AssertionError('FINITE_VALIDATION_FAILURE_RETAINED_AFTER_ACTUAL_RUNTIME_DIAGNOSTICS')
except BaseException as e:
 emit('failure.json',{'type':type(e).__name__,'message':str(e),'global':'INCOMPLETE','forcedOrMissingEvidenceNeverPass':True});raise
