"""CI PREPARATION ONLY. Reads locked installed dependencies, compiles source, no product evaluation."""
import pathlib,json,hashlib,shutil,subprocess,sysconfig,re,os,stat
R=pathlib.Path.cwd();O=R/'hydration-gates-capsule-review';A=O/'app';A.mkdir(parents=True,exist_ok=False)
C=json.loads((R/'tests/hydration-gates-capsule/PREPARATION-CONTRACT.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
node=pathlib.Path(shutil.which('node')).resolve()
actual_node=pathlib.Path(subprocess.check_output([str(node),'-p','process.execPath'],text=True,env={}).strip()).resolve()
assert actual_node==node,'NODE_EXECUTABLE_IDENTITY'
# Only core introspection, with an empty environment. No package/native import.
selection_dir=R/'tests/hydration-gates-capsule'
pins=json.loads((selection_dir/'native-selection-pins.json').read_text())
core=json.loads(subprocess.check_output([str(node),str(selection_dir/'native-selection-guard.cjs'),'--inspect'],text=True,env={}))
assert core['nodeSha256']==sha(node),'NATIVE_CORE_NODE_HASH'
for k in C['environment']:
 assert k not in ['NODE_OPTIONS','NODE_PATH','LIBC','npm_config_arch','npm_config_platform','PREBUILDS_ONLY','ARM_VERSION','ELECTRON_RUN_AS_NODE','npm_config_libc','npm_config_arm_version','LD_LIBRARY_PATH','LD_PRELOAD','LD_AUDIT','NODE_BINDINGS_ARROW','NODE_BINDINGS_COMPILED_DIR'] and not k.endswith('_PREBUILD'),'NATIVE_ENV_OVERRIDE'
lock=json.loads((R/'package-lock.json').read_text())['packages']
for pkg in pins['packages']:
 meta=lock[pkg.get('path','node_modules/'+pkg['name'])]
 assert (meta['version'],meta['resolved'],meta['integrity'])==(pkg['version'],pkg['url'],pkg['lockIntegrity']),'NATIVE_LOCK_DRIFT'
# Exactly these five paths, never a filename/libc/SONAME pattern exemption.
review_paths={
 'node_modules/@lancedb/lancedb-linux-x64-musl/lancedb.linux-x64-musl.node',
 'node_modules/@msgpackr-extract/msgpackr-extract-linux-x64/node.napi.musl.node',
 'node_modules/@msgpackr-extract/msgpackr-extract-linux-x64/node.abi115.musl.node',
 'node_modules/onnxruntime-node/bin/napi-v3/linux/arm64/onnxruntime_binding.node',
 'node_modules/usearch/prebuilds/linux-arm64/usearch.node',
}
assert {x['path'] for x in pins['reviewOnly']}==review_paths,'NATIVE_REVIEW_SET_DRIFT'
for rel,digest in pins['files'].items():
 file=R/rel
 assert not file.is_symlink() and file.is_file() and sha(file)==digest,'NATIVE_SOURCE_PIN_'+rel
subprocess.run([str(node),str(selection_dir/'native-selection-guard.cjs'),'--verify-installed',str(R),str(selection_dir/'native-selection-pins.json')],check=True,env={})

recipe=r'''
const fs=require('fs'),path=require('path'),crypto=require('crypto');const tsPath=path.resolve('node_modules/typescript/lib/typescript.js');const ts=require(tsPath);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const plan=JSON.parse(fs.readFileSync('tests/hydration-gates-capsule/PREPARATION-CONTRACT.json'));const rows=[];
for(const file of plan.fixedSourceGraph){
 const text=fs.readFileSync(file,'utf8');const ast=ts.createSourceFile(file,text,ts.ScriptTarget.ES2022,true);
 const replacements=[];
 function visit(n){if(ts.isStringLiteral(n)&&n.text.startsWith('.')){const par=n.parent;const isStaticDecl=par&&(ts.isImportDeclaration(par)||ts.isExportDeclaration(par)||(ts.isCallExpression(par)&&par.expression&&par.expression.text==='require'));const isDyn=par&&ts.isCallExpression(par)&&par.expression.kind===ts.SyntaxKind.ImportKeyword;if(isStaticDecl||isDyn){
  const resolved=path.resolve(path.dirname(file),n.text);let target;
  for(const candidate of [resolved,resolved+'.ts',resolved+'.js',path.join(resolved,'index.ts')])if(fs.existsSync(candidate)&&fs.statSync(candidate).isFile()){target=candidate;break;}
  if(!target)throw Error('UNRESOLVED_RELATIVE_'+file+':'+n.text);
  let rel=path.relative(path.dirname(path.resolve(file)),target).replaceAll(path.sep,'/').replace(/\.ts$/,'.js');if(!rel.startsWith('.'))rel='./'+rel;
  replacements.push({start:n.getStart(ast),end:n.end,value:JSON.stringify(rel),original:n.text});
 }}ts.forEachChild(n,visit);}visit(ast);
 let mapped=text;for(const r of replacements.sort((a,b)=>b.start-a.start))mapped=mapped.slice(0,r.start)+r.value+mapped.slice(r.end);
 const o=ts.transpileModule(mapped,{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,esModuleInterop:true,useDefineForClassFields:false}});
 if(o.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('TRANSPILE');
 const dest=path.join('hydration-gates-capsule-review/app',file.replace(/\.ts$/,'.js'));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,o.outputText);
 rows.push({source:file,sourceSha256:hash(text),emitted:dest,emittedSha256:hash(o.outputText),relativeMappings:replacements.map(({original,value})=>({original,target:JSON.parse(value)}))});
}
const emitted=new Set(rows.map(r=>path.resolve(r.emitted)));const omittedDynamic=[];
for(const row of rows){const source=fs.readFileSync(row.emitted,'utf8'),ast=ts.createSourceFile(row.emitted,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
 function verify(n){if(ts.isStringLiteral(n)&&n.text.startsWith('.')){const par=n.parent;const isReq=par&&ts.isCallExpression(par)&&par.expression&&par.expression.text==='require';if(par&&(ts.isImportDeclaration(par)||ts.isExportDeclaration(par)||isReq||(ts.isCallExpression(par)&&par.expression.kind===ts.SyntaxKind.ImportKeyword))){
  const target=path.resolve(path.dirname(row.emitted),n.text),dynamic=ts.isCallExpression(par)&&par.expression.kind===ts.SyntaxKind.ImportKeyword;
  if(!emitted.has(target)){if(!dynamic)throw Error('STATIC_CLOSURE_MISSING_'+target);omittedDynamic.push({from:row.source,target:n.text,notMounted:true});}
 }}ts.forEachChild(n,verify);}verify(ast);
}
const builtins=new Set(require('module').builtinModules.concat(require('module').builtinModules.map(m=>'node:'+m)));
const bareRoots=new Set();const bareUses=[];
for(const row of rows){const source=fs.readFileSync(row.emitted,'utf8'),ast=ts.createSourceFile(row.emitted,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
 function bare(n){if(ts.isStringLiteral(n)&&!n.text.startsWith('.')){const par=n.parent;const isSpec=ts.isImportDeclaration(par)||ts.isExportDeclaration(par)||(ts.isCallExpression(par)&&(par.expression.kind===ts.SyntaxKind.ImportKeyword||(par.expression&&par.expression.text==='require')));if(isSpec&&!builtins.has(n.text)){const root=n.text.split('/').slice(0,n.text.startsWith('@')?2:1).join('/');bareRoots.add(root);const kind=(ts.isImportDeclaration(par)||ts.isExportDeclaration(par))?'static':(par.expression.kind===ts.SyntaxKind.ImportKeyword?'dynamic':'require');bareUses.push({from:row.source,specifier:n.text,root,kind});}}
 ts.forEachChild(n,bare);}bare(ast);}
fs.writeFileSync('hydration-gates-capsule-review/EMITTED.json',JSON.stringify({node:process.version,nodeExecPath:process.execPath,nodeSha256:hash(fs.readFileSync(process.execPath)),compiler:ts.version,compilerSha256:hash(fs.readFileSync(tsPath)),packageLockSha256:hash(fs.readFileSync('package-lock.json')),module:'ESNext',productEvaluated:false,omittedDynamic,bareRoots:[...bareRoots].sort(),bareUses,files:rows},null,2));
'''
subprocess.run([str(node),'-e',recipe],check=True)
(A/'package.json').write_text('{"type":"module","private":true}')
for name in ['hydration-gates-entry.cjs','inside-supervisor.py','fixture-config.json','launch-capsule.py','native-selection-guard.cjs']:
 shutil.copy2(R/'tests/hydration-gates-capsule'/name,A/name)
(A/'runtime-env.json').write_text(json.dumps(C['environment']))
(A/'native-selection.json').write_text(json.dumps({'pins':pins,'preparationCore':core,'scope':'Conditional static loader selection. Core measured in preparation, no binding loaded, runtime guard must revalidate before product.'},indent=2)+'\n')
for p in (R/'db/migrations/sqlite').glob('*.sql'):
 dest=A/'db/migrations/sqlite'/p.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest)
# Resolve real npm dependency graph in place; preserve nested paths, no flattening or replacement.
def resolve(name,parent):
 p=parent
 while p==R or R in p.parents:
  q=p/'node_modules'/name/'package.json'
  if q.is_file():return q.parent
  if p==R:break
  p=p.parent
 raise FileNotFoundError(name)
seen=set();queue=[resolve(n,R) for n in C['npmRuntimeRoots']]
try:queue.append(resolve('pino',R))
except FileNotFoundError:pass # Existing actual logger fallback, not a test shim.
# Roots the product itself tolerates absent (dynamic import with its own
# try/catch): mounted when installed, recorded when not. Never fabricated.
absentTolerated=[]
for n in C.get('absentToleratedRoots',[]):
 try:queue.append(resolve(n,R))
 except FileNotFoundError:absentTolerated.append(n)
while queue:
 pkg=queue.pop();pkg=pkg.resolve()
 if pkg in seen:continue
 assert R in pkg.parents,'NPM_ESCAPE';seen.add(pkg);meta=json.loads((pkg/'package.json').read_text())
 for n in meta.get('dependencies',{}):queue.append(resolve(n,pkg))
 for n in meta.get('optionalDependencies',{}):
  try:queue.append(resolve(n,pkg))
  except FileNotFoundError:pass
 for p in pkg.rglob('*'):
  rel=p.relative_to(pkg)
  if 'node_modules' in rel.parts or any(x in rel.parts for x in ['test','tests','example','examples','.git']):continue
  if not p.is_file() or p.suffix not in ['.js','.cjs','.mjs','.json','.node','.lua']:continue
  assert not p.is_symlink() and p.name not in ['.env','.env.local'],'PACKAGE_UNSAFE_FILE'
  dst=A/p.relative_to(R);dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dst)
# Only these two reviewed vendor DSOs, preserving original relative paths.
# Not a broad .so suffix expansion or SONAME search across packages/host.
assert {v['path'] for v in pins['vendorElf']}=={
 'node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime.so.1.14.0',
 'node_modules/@xenova/transformers/node_modules/sharp/vendor/8.14.5/linux-x64/lib/libvips-cpp.so.42'},'VENDOR_SET_DRIFT'
for vendor in pins['vendorElf']:
 if 'expectedIntegrity' in vendor:
  meta=json.loads((R/'node_modules/@xenova/transformers/node_modules/sharp/package.json').read_text())
  assert vendor['expectedIntegrity']==vendor['computedIntegrity']==meta['config']['integrity']['linux-x64'],'SHARP_RELEASE_INTEGRITY_EVIDENCE_DRIFT'
 rel=vendor['path'];src=R/rel
 assert src.is_file() and sha(src)==pins['files'][rel],'VENDOR_INSTALLED_DRIFT_'+rel
 for parent in [src,*src.parents]:
  if parent==R:break
  assert not parent.is_symlink(),'VENDOR_SYMLINK'
 dst=A/rel;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
 assert sha(dst)==pins['files'][rel],'VENDOR_COPY_DRIFT_'+rel
copiedNames={json.loads((pkg/'package.json').read_text()).get('name') for pkg in seen}
emitted_doc=json.loads((O/'EMITTED.json').read_text())
# Absent-tolerated roots: the exception can never widen silently. The
# exception list is exactly {'dockerode'}: the resolver-exemption set and the
# guarded-use set must be that same single root, so no root is exempted
# without its guard and no second exception can appear without editing this
# assert. EVERY use of the root in the emitted closure must be the exact
# specifier from the declared module with the declared kind, at the declared
# count; a static import/export/require, a require() value use, a subpath
# specifier, a new caller or a changed count fails preparation, whether or
# not the package happens to be installed.
assert set(C.get('absentToleratedRoots',[]))==set(C.get('absentToleratedUses',{}).keys())=={'dockerode'},'ABSENT_TOLERATED_SET_DRIFT'
for n,decl in C.get('absentToleratedUses',{}).items():
 actual=[u for u in emitted_doc['bareUses'] if u['root']==n]
 bad=[u for u in actual if not (u['kind']==decl['kind'] and u['from']==decl['from'] and u['specifier']==n)]
 assert not bad,'ABSENT_TOLERATED_UNAUTHORIZED_USE_'+n+'_'+json.dumps(bad)
 assert len(actual)==decl['count'],'ABSENT_TOLERATED_USE_COUNT_'+n+'_expected'+str(decl['count'])+'_got'+str(len(actual))
missing_roots=[r for r in emitted_doc['bareRoots'] if r not in copiedNames and r not in absentTolerated]
assert not missing_roots,'BARE_ROOT_NOT_MOUNTED_'+','.join(sorted(missing_roots))
for p in A.rglob('*'):
 if p.suffix in ['.js','.mjs','.cjs'] and 'node_modules' not in p.parts:subprocess.run([str(node),'--check',str(p)],check=True)
# Verify COPIED bytes, not merely installed originals. Review-only binaries
# stay in the artifact under their original paths but get no mount target.
for rel,digest in pins['files'].items():assert sha(A/rel)==digest,'NATIVE_COPY_PIN_'+rel
review_sources={'app/'+rel for rel in review_paths}
# Capture runtime files and recursively inspect ELF NEEDED, without executing binary/ldd.
runtime={node,pathlib.Path(shutil.which('python3')),pathlib.Path(shutil.which('ip'))}
stdlib=pathlib.Path(sysconfig.get_path('stdlib'))
for p in stdlib.rglob('*'):
 if any(x in p.relative_to(stdlib).parts for x in ['site-packages','dist-packages','test','tests','__pycache__','ensurepip','idlelib','tkinter']):continue
 if p.is_file() and p.suffix in ['.py','.so']:runtime.add(p)
lookup={}
for line in subprocess.check_output(['/sbin/ldconfig','-p'],text=True).splitlines():
 m=re.search(r'^\s*(\S+) .*=> (\S+)$',line)
 if m and 'x86-64' in line and pathlib.Path(m[2]).is_file():
  q=pathlib.Path(m[2]);assert str(q).startswith(('/lib/','/lib64/','/usr/lib/','/usr/lib64/')),'SYSTEM_CACHE_ESCAPE'
  lookup.setdefault(m[1],set()).add(q)
def elf_origin(p):
 if A in p.parents:
  for parent in p.parents:
   if parent==A:break
   package=parent/'package.json'
   if package.is_file():
    meta=json.loads(package.read_text())
    return {'name':meta.get('name'),'version':meta.get('version'),'packageJsonSha256':sha(package),'loaderSelection':'unknown unless explicitly pinned in native-selection.json'}
 return {'runtimePath':str(p),'loaderSelection':'system runtime ELF'}
# Load only our reviewed static resolver, never a package or native loader.
import runpy
resolver=runpy.run_path(str(selection_dir/'elf-closure.py'))
elf_missing,review_elf,elf_edges=resolver['scan'](A,runtime|set(A.rglob('*.node'))|{A/v['path'] for v in pins['vendorElf']},runtime,lookup,pins,review_sources,elf_origin)
# No runtime copy/upload on an incomplete selected ELF closure. Unknowns
# accumulate in a deterministic order instead of one CI run per binding.
if elf_missing:
 print('ELF_MISSING_SET '+json.dumps(elf_missing,sort_keys=True),flush=True)
 raise AssertionError('ELF_CLOSURE_INCOMPLETE')
manifest=[]
for p in sorted(runtime):
 dest=O/'runtime'/str(p).lstrip('/');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest)
 manifest.append({'source':str(dest.relative_to(O)),'target':'/usr/bin/node' if p==node else str(p),'sha256':sha(dest),'bytes':dest.stat().st_size,'mode':format(stat.S_IMODE(dest.stat().st_mode),'o'),'disposition':'mountable'})
for p in sorted(A.rglob('*')):
 if p.is_file():
  review=str(p.relative_to(O)) in review_sources
  manifest.append({'source':str(p.relative_to(O)),'target':None if review else '/app/'+str(p.relative_to(A)),'sha256':sha(p),'bytes':p.stat().st_size,'mode':format(stat.S_IMODE(p.stat().st_mode),'o'),'disposition':'review-only' if review else 'mountable'})
inventory={'files':len(manifest),'bytes':sum(r['bytes'] for r in manifest),'byDisposition':{d:{'files':sum(r['disposition']==d for r in manifest),'bytes':sum(r['bytes'] for r in manifest if r['disposition']==d)} for d in ['mountable','review-only']},'largest':sorted(manifest,key=lambda r:(-r['bytes'],r['source']))[:20]}
print('FINITE_CAPSULE_INVENTORY '+json.dumps(inventory,sort_keys=True),flush=True)
assert len(manifest)<=4000 and inventory['bytes']<=400*1024**2,'FINITE_CAPSULE_BUDGET'
(O/'ALLOWLIST.json').write_text(json.dumps(manifest,indent=2));(O/'PREPARATION-CONTRACT.json').write_text(json.dumps(C,indent=2))
(O/'PACKAGE-VERSIONS.txt').write_text(subprocess.check_output(['dpkg-query','-W','bubblewrap','iproute2','python3','util-linux'],text=True))
# Public artifact audit is fail-closed and excludes operational/internal/auth material.
allowedTop={'app','runtime','ALLOWLIST.json','PREPARATION-CONTRACT.json','PACKAGE-VERSIONS.txt','EMITTED.json','PUBLIC-ARTIFACT-AUDIT.json'}
assert all(p.name in allowedTop for p in O.iterdir()),'ARTIFACT_TOPLEVEL'
for p in O.rglob('*'):
 if not p.is_file():continue
 assert not p.is_symlink(),'ARTIFACT_SYMLINK'
 assert p.name not in ['.env','.env.local','.npmrc','.gitconfig','credentials','password','PLAN.md','REVIEW.md'],'ARTIFACT_PRIVATE_FILE'
 assert not any(x in p.relative_to(O).parts for x in ['.git','.ssh','.vault','__pycache__']),'ARTIFACT_PRIVATE_PATH'
 if p.suffix in ['.js','.mjs','.cjs','.json','.py','.lua','.txt']:
  text=p.read_text(errors='strict')
  for pattern in [r'gh[pousr]_[A-Za-z0-9]{20,}',r'github_pat_[A-Za-z0-9_]{20,}',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY',r'https?://[^\s/:]+:[^\s/@]+@']:
   assert not re.search(pattern,text),'ARTIFACT_CREDENTIAL_MARKER'
audit={'nativeSelection':{'core':core,'reviewOnlyElf':review_elf,'vendorProvenance':pins['vendorElf'],'postinstallBindingProvenance':pins['postinstallBindingProvenance'],'elfEdges':elf_edges,'resolverScope':'Explicit reviewed per-file RPATH/RUNPATH and exact vendor edges, no inherited RPATH approximation; unsupported search path/ambiguous system cache fails','bindingLoadObserved':False,'scope':'Conditional reviewed selection; review-only ELF is NOT resolved or mounted'},'copiedSuffixes':['.js','.cjs','.mjs','.json','.node','.lua'],'resourceCaveat':'package resources with other suffixes (wasm, data files, images) are NOT copied; execution may honestly fail on them. Never replace, shim or drop modules to force green; if a missing resource breaks a case, the capsule fails and the cause is reported.','absentToleratedRoots':absentTolerated,'absentToleratedUses':{n:[u for u in emitted_doc['bareUses'] if u['root']==n] for n in absentTolerated},'absentToleratedBasis':'declared in the contract; each is dynamically imported by the product behind its own try/catch and is absent from the installed tree (checked against package-lock); recorded, never shimmed','audience':'existing public repository artifact, retained2days','source':'only explicit emitted source/npm locked package runtime/dpkg runtime/Python stdlib, not checkout entire tree','heuristicOnly':True,'noProductExecution':True,'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'npmPackages':[{'path':str(p.relative_to(R)),'packageJsonSha256':sha(p/'package.json'),'name':json.loads((p/'package.json').read_text()).get('name'),'version':json.loads((p/'package.json').read_text()).get('version')} for p in sorted(seen)],'files':[{'path':str(p.relative_to(O)),'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(O.rglob('*')) if p.is_file()]}
(O/'PUBLIC-ARTIFACT-AUDIT.json').write_text(json.dumps(audit,indent=2))
digests={
 'allowlistSha256':sha(O/'ALLOWLIST.json'),
 'emittedSha256':sha(O/'EMITTED.json'),
 'entrySha256':sha(A/'hydration-gates-entry.cjs'),
 'supervisorSha256':sha(R/'tests/hydration-gates-capsule/inside-supervisor.py'),
 'fixtureSha256':sha(A/'fixture-config.json'),
 'nativeSelectionSha256':sha(A/'native-selection.json'),
 'nativeGuardSha256':sha(A/'native-selection-guard.cjs'),
 'launcherSha256':sha(R/'tests/hydration-gates-capsule/launch-capsule.py'),
}
assert sha(A/'inside-supervisor.py')==digests['supervisorSha256'],'SUPERVISOR_COPY_DIVERGES'
(R/'tests/hydration-gates-capsule/EXPECTED-DIGESTS.json').write_text(json.dumps(digests,indent=2)+'\n')
print('FINITE_CAPSULE_PREPARED_FOR_REVIEW_ONLY',len(manifest),sum(r['bytes'] for r in manifest))
