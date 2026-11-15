#!/usr/bin/env python3
"""Exact-lock acquisition only. No product imports or lifecycle scripts. SOURCE PROPOSAL."""
from pathlib import Path
import os,sys,json,hashlib,base64,tarfile,io,subprocess,urllib.request,shutil
# Diagnostic only. Fixed endpoint under root-owned parent; no messages/paths/argv.
DIAGNOSTIC='/mnt/silhouette-genuine-vitest/diagnostic/acquire.json'
PHASE='PAYLOAD_INIT'
def diagnostic(event,exc=None,role='NONE'):
 try:
  classes={'AssertionError','OSError','PermissionError','FileNotFoundError','FileExistsError','TimeoutError','CalledProcessError','TimeoutExpired','ValueError','KeyError','JSONDecodeError','HTTPError','URLError'}
  kind=type(exc).__name__ if exc is not None else'NONE'
  row={'version':1,'origin':'ACQUIRE','stage':PHASE,'event':event,'exception':kind if kind in classes or kind=='NONE'else'OTHER','errno':'UNKNOWN','role':role,'subprocessExit':'UNKNOWN'}
  if isinstance(exc,OSError)and exc.errno in {1,2,5,7,8,12,13,20,21,22,24,27,28,30,31,32,38,95,110,111}:row['errno']=exc.errno
  if isinstance(exc,subprocess.CalledProcessError)and type(exc.returncode)is int and -128<=exc.returncode<=255:row['subprocessExit']=exc.returncode
  b=json.dumps(row,separators=(',',':')).encode();assert len(b)<=1024
  fd=os.open(DIAGNOSTIC,os.O_WRONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:
   os.ftruncate(fd,0);assert os.write(fd,b)==len(b)
  finally:os.close(fd)
 except BaseException:pass
ROLE='NONE'
def acquisition_exception(kind,value,traceback):
 diagnostic('UNCAUGHT_EXCEPTION',value,ROLE)
 # Default Python unhandled-exception exit remains1; no raw exception formatting.
sys.excepthook=acquisition_exception
diagnostic('ENTERED')
HERE=Path(sys.argv[1]);ROOT=Path(sys.argv[2]);EV=ROOT/'acquisition-evidence';EV.mkdir(exist_ok=False)
LOCK='039ce85293514e83584ca047d0d8b53eb7bce71bb3b3fe75fc6f96e928a0299c'
def sha(b):return hashlib.sha256(b).hexdigest()
def emit(n,o):
 b=(json.dumps(o,indent=2)+'\n').encode();assert len(b)<=8*1024**2;(EV/n).write_bytes(b)
def fetch(url,cap):
 assert url.startswith(('https://registry.npmjs.org/','https://codeload.github.com/whiskeysockets/libsignal-node/'))
 with urllib.request.urlopen(url,timeout=30)as r:
  assert r.url.startswith(('https://registry.npmjs.org/','https://codeload.github.com/whiskeysockets/libsignal-node/'));b=r.read(cap+1)
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

PHASE='SOURCE_COPY'
app=ROOT/'candidate';acquisition=ROOT/'acquisition';acquisition.mkdir()
for n in ['package.json','package-lock.json']:shutil.copyfile(app/n,acquisition/n)
assert sha((acquisition/'package-lock.json').read_bytes())==LOCK
cache=ROOT/'npm-cache';cache.mkdir();home=ROOT/'npm-home';home.mkdir();empty=ROOT/'empty-npmrc';empty.write_text('');globalempty=ROOT/'empty-globalnpmrc';globalempty.write_text('')
guard=ROOT/'git-guard';guard.mkdir();g=guard/'git';g.write_text('#!/bin/sh\ncase "$*" in --version|version) exec /usr/bin/git "$@" ;; *) printf "GIT_FALLBACK_DENIED\\n" >&2; exit 97 ;; esac\n');g.chmod(0o700)
env={'PATH':str(guard)+':'+os.environ['PATH'],'HOME':str(home),'NPM_CONFIG_USERCONFIG':str(empty),'NPM_CONFIG_GLOBALCONFIG':str(globalempty),'NPM_CONFIG_CACHE':str(cache),'NPM_CONFIG_IGNORE_SCRIPTS':'true','NPM_CONFIG_AUDIT':'false','NPM_CONFIG_FUND':'false','NPM_CONFIG_FETCH_RETRIES':'0','PUPPETEER_SKIP_DOWNLOAD':'true','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD':'true','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':str(empty),'GIT_CONFIG_COUNT':'2','GIT_CONFIG_KEY_0':'url.https://github.com/whiskeysockets/libsignal-node.git.insteadOf','GIT_CONFIG_VALUE_0':'ssh://git@github.com/whiskeysockets/libsignal-node.git','GIT_CONFIG_KEY_1':'credential.helper','GIT_CONFIG_VALUE_1':'','GIT_TERMINAL_PROMPT':'0','GIT_ASKPASS':'/bin/false','GIT_SSH_COMMAND':'/bin/false'}
PHASE='PUBLIC_SOURCE_FETCH'
public=fetch('https://codeload.github.com/whiskeysockets/libsignal-node/tar.gz/1c30d7d7e76a3b0aa120b04dc6a26f5a12dccf67',1024**2);assert sha(public)=='a9e14823efa911474aaa9e8f6bfb88759f869a3bc25116e969be943b84bef318';lp=json.loads(members(public,mode='raw-libsignal-source')['package.json']);assert not lp.get('scripts')and not lp.get('workspaces')
PHASE='INSTALLER_IDENTITY'
node=Path(shutil.which('node')).resolve();assert sha(node.read_bytes())=='ccacb2d6d87ba6d118b2bffc1ae33747a05cc5fc6b1f1ec4fc1d420b687e952d'
assert subprocess.check_output([str(node),'--version'],text=True).strip()=='v22.18.0'
npm=Path(shutil.which('npm')).resolve();npmRoot=npm.parents[1]
installerHashes={'package.json':'b5bd3f6aae88de512aaa0fa6feda155c971ad20040d03962443b5523b0393f4f','node_modules/pacote/package.json':'51c6b58827f0eb9c6aa35253f86c460a02324509c05bfcd4e37fbf4bea54bdfa','node_modules/pacote/lib/fetcher.js':'1a385341f75d6c77496d30e7751012ad91489bb8c4e4e4db5e4568d2b9432a79','node_modules/tar/package.json':'89bd6d32c9e56eab63f3f62b96080aa43afa530675701610d74793d4719d1137','node_modules/tar/lib/unpack.js':'665c35a372a9021781ba5611cb269b91f20ccc1ef6182ef47ad284d2fb8a3adf','node_modules/tar/lib/path-reservations.js':'99c5c411dd9597070aa2cbba6b0cc18834f0c2550fe5c9bb14daa2a6a0869299'}
assert all(sha((npmRoot/n).read_bytes())==v for n,v in installerHashes.items()),'PINNED_INSTALLER_MISMATCH'
PHASE='NPM_CONFIG';ROLE='NPM_CONFIG'
conf=json.loads(subprocess.check_output([str(node),str(npm),'config','list','--json'],cwd=acquisition,env=env,text=True,timeout=10))
ROLE='NONE'
assert conf['ignore-scripts']is True and conf['audit']is False and conf['fund']is False and conf['fetch-retries']==0 and conf['userconfig']==str(empty)and conf['globalconfig']==str(globalempty),'INSTALLER_CONFIG_MISMATCH'
PHASE='NPM_CI';ROLE='NPM_CI'
subprocess.run([str(node),str(npm),'ci','--ignore-scripts','--no-audit','--no-fund'],cwd=acquisition,env=env,check=True,timeout=480)
ROLE='NONE';PHASE='LOCK_VERIFY'
assert sha((acquisition/'package-lock.json').read_bytes())==LOCK
proof=[];missing=[];admittedFiles=set()
PHASE='ARCHIVE_VERIFY'
for rel,row in json.loads((acquisition/'package-lock.json').read_text())['packages'].items():
 if not rel:continue
 PHASE='ARCHIVE_VERIFY'
 root=acquisition/rel
 if not root.exists():assert row.get('optional');missing.append(rel);continue
 if rel=='node_modules/libsignal':
  expected=members(public,mode='raw-libsignal-source');packedRaw=(HERE/'libsignal-packed-files.json').read_bytes();assert sha(packedRaw)=='20367cd35272db599ff1f7ebfb93409fc61bff9c635b3e01dc544c7cb0029763';packed=json.loads(packedRaw);expected={k:expected[k]for k in packed};assert {k:sha(v)for k,v in expected.items()}==packed
 else:
  alg,sri=row['integrity'].split('-',1);digest=base64.b64decode(sri);h=digest.hex();cp=cache/'_cacache/content-v2'/alg/h[:2]/h[2:4]/h[4:];assert cp.is_file(),'MISSING_CACHED_SRI:'+rel;b=cp.read_bytes();assert hashlib.new(alg,b).digest()==digest;expected=members(b,mode='installed-registry',package=rel,integrity=row['integrity'])
 PHASE='MEMBER_VERIFY'
 for name,b in expected.items():
  admittedFiles.add(str(Path(rel)/name))
  f=root/name;assert f.is_file()and not f.is_symlink()and f.read_bytes()==b,'MEMBER_MISMATCH:'+rel+'/'+name
 own={str(p.relative_to(root))for p in root.rglob('*')if p.is_file()and 'node_modules'not in p.relative_to(root).parts};assert own=={k for k in expected if 'node_modules'not in Path(k).parts},'EXTRA_PACKAGE_MEMBERS:'+rel
 proof.append({'path':rel,'version':row.get('version'),'integrity':row.get('integrity','exact-libsignal-commit'),'members':len(expected)})
# Generated npm bookkeeping is not archive source. It is never used at runtime.
deps=acquisition/'node_modules'
for p in list(deps.rglob('*')):
 if p.is_symlink():
  assert '.bin'in p.relative_to(deps).parts,'UNREVIEWED_INSTALLED_SYMLINK'
  target=p.resolve(strict=True);assert target.is_relative_to(deps.resolve()),'BIN_TARGET_OUTSIDE_DEPS'
  assert str(target.relative_to(acquisition))in admittedFiles,'BIN_TARGET_NOT_VERIFIED_MEMBER'
  p.unlink()
for p in list(deps.rglob('.package-lock.json')):
 assert p.parent.name=='node_modules';p.unlink()
actual={str(p.relative_to(acquisition))for p in deps.rglob('*')if p.is_file()}
assert actual==admittedFiles,'UNREVIEWED_EXTRA_INSTALLED_FILE'
PHASE='NATIVE_PROVENANCE'
archive=HERE/'native-provenance/better-sqlite3-v12.5.0-node-v127-linux-x64.tar.gz';assert sha(archive.read_bytes())=='42451490221883f4edb84fc3453a2fce9b7489ce655192cd5531b5955a8faa4b'
with tarfile.open(archive)as t:
 ms=t.getmembers();assert len(ms)==1 and ms[0].name=='build/Release/better_sqlite3.node'and ms[0].isfile();b=t.extractfile(ms[0]).read();f=acquisition/'node_modules/better-sqlite3'/ms[0].name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b)
emit('complete.json',{'lock':LOCK,'verified':proof,'optionalAbsent':missing,'scriptsExecuted':False,'nativeTarSha256':sha(archive.read_bytes()),'productImported':False})

PHASE='COMPLETE'
diagnostic('COMPLETED')
