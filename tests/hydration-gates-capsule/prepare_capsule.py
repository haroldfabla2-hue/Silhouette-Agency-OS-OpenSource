"""CI PREPARATION ONLY. Reads locked installed dependencies, compiles source, no product evaluation."""
import pathlib,json,hashlib,shutil,subprocess,sysconfig,re,os,stat
R=pathlib.Path.cwd();O=R/'hydration-gates-capsule-review';A=O/'app';A.mkdir(parents=True,exist_ok=False)
C=json.loads((R/'tests/hydration-gates-capsule/PREPARATION-CONTRACT.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
node=pathlib.Path(shutil.which('node')).resolve()
actual_node=pathlib.Path(subprocess.check_output([str(node),'-p','process.execPath'],text=True).strip()).resolve()
assert actual_node==node,'NODE_EXECUTABLE_IDENTITY'
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
const bareRoots=new Set();
for(const row of rows){const source=fs.readFileSync(row.emitted,'utf8'),ast=ts.createSourceFile(row.emitted,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
 function bare(n){if(ts.isStringLiteral(n)&&!n.text.startsWith('.')){const par=n.parent;const isSpec=ts.isImportDeclaration(par)||ts.isExportDeclaration(par)||(ts.isCallExpression(par)&&(par.expression.kind===ts.SyntaxKind.ImportKeyword||(par.expression&&par.expression.text==='require')));if(isSpec&&!builtins.has(n.text))bareRoots.add(n.text.split('/').slice(0,n.text.startsWith('@')?2:1).join('/'));}
 ts.forEachChild(n,bare);}bare(ast);}
fs.writeFileSync('hydration-gates-capsule-review/EMITTED.json',JSON.stringify({node:process.version,nodeExecPath:process.execPath,nodeSha256:hash(fs.readFileSync(process.execPath)),compiler:ts.version,compilerSha256:hash(fs.readFileSync(tsPath)),packageLockSha256:hash(fs.readFileSync('package-lock.json')),module:'ESNext',productEvaluated:false,omittedDynamic,bareRoots:[...bareRoots].sort(),files:rows},null,2));
'''
subprocess.run([str(node),'-e',recipe],check=True)
(A/'package.json').write_text('{"type":"module","private":true}')
for name in ['hydration-gates-entry.cjs','inside-supervisor.py','fixture-config.json','launch-capsule.py']:
 shutil.copy2(R/'tests/hydration-gates-capsule'/name,A/name)
(A/'runtime-env.json').write_text(json.dumps(C['environment']))
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
copiedNames={json.loads((pkg/'package.json').read_text()).get('name') for pkg in seen}
emitted_doc=json.loads((O/'EMITTED.json').read_text())
missing_roots=[r for r in emitted_doc['bareRoots'] if r not in copiedNames]
assert not missing_roots,'BARE_ROOT_NOT_MOUNTED_'+','.join(sorted(missing_roots))
for p in A.rglob('*'):
 if p.suffix in ['.js','.mjs','.cjs'] and 'node_modules' not in p.parts:subprocess.run([str(node),'--check',str(p)],check=True)
# Capture runtime files and recursively inspect ELF NEEDED, without executing binary/ldd.
runtime={node,pathlib.Path(shutil.which('python3')),pathlib.Path(shutil.which('ip'))}
stdlib=pathlib.Path(sysconfig.get_path('stdlib'))
for p in stdlib.rglob('*'):
 if any(x in p.relative_to(stdlib).parts for x in ['site-packages','dist-packages','test','tests','__pycache__','ensurepip','idlelib','tkinter']):continue
 if p.is_file() and p.suffix in ['.py','.so']:runtime.add(p)
lookup={}
for line in subprocess.check_output(['/sbin/ldconfig','-p'],text=True).splitlines():
 m=re.search(r'^\s*(\S+) .*=> (\S+)$',line)
 if m and pathlib.Path(m[2]).is_file():lookup.setdefault(m[1],pathlib.Path(m[2]))
queue=list(runtime)+list(A.rglob('*.node'));scanned=set()
while queue:
 p=queue.pop()
 if p in scanned:continue
 scanned.add(p)
 with p.open('rb') as f:magic=f.read(4)
 if magic!=b'\x7fELF':continue
 text=subprocess.check_output(['readelf','-d',str(p)],text=True)
 for soname in re.findall(r'\(NEEDED\).*\[(.*?)\]',text):
  assert soname in lookup,'ELF_MISSING_'+soname;q=lookup[soname]
  if q not in runtime:runtime.add(q);queue.append(q)
 # Dynamic interpreter is not necessarily a NEEDED line.
 text=subprocess.check_output(['readelf','-l',str(p)],text=True)
 for interp in re.findall(r'Requesting program interpreter: (.*?)\]',text):runtime.add(pathlib.Path(interp))
manifest=[]
for p in sorted(runtime):
 dest=O/'runtime'/str(p).lstrip('/');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest)
 manifest.append({'source':str(dest.relative_to(O)),'target':'/usr/bin/node' if p==node else str(p),'sha256':sha(dest),'bytes':dest.stat().st_size,'mode':format(stat.S_IMODE(dest.stat().st_mode),'o')})
for p in sorted(A.rglob('*')):
 if p.is_file():manifest.append({'source':str(p.relative_to(O)),'target':'/app/'+str(p.relative_to(A)),'sha256':sha(p),'bytes':p.stat().st_size,'mode':format(stat.S_IMODE(p.stat().st_mode),'o')})
assert len(manifest)<=4000 and sum(r['bytes'] for r in manifest)<=400*1024**2,'FINITE_CAPSULE_BUDGET'
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
audit={'copiedSuffixes':['.js','.cjs','.mjs','.json','.node','.lua'],'resourceCaveat':'package resources with other suffixes (wasm, data files, images) are NOT copied; execution may honestly fail on them. Never replace, shim or drop modules to force green; if a missing resource breaks a case, the capsule fails and the cause is reported.','audience':'existing public repository artifact, retained2days','source':'only explicit emitted source/npm locked package runtime/dpkg runtime/Python stdlib, not checkout entire tree','heuristicOnly':True,'noProductExecution':True,'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'npmPackages':[{'path':str(p.relative_to(R)),'packageJsonSha256':sha(p/'package.json'),'name':json.loads((p/'package.json').read_text()).get('name'),'version':json.loads((p/'package.json').read_text()).get('version')} for p in sorted(seen)],'files':[{'path':str(p.relative_to(O)),'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(O.rglob('*')) if p.is_file()]}
(O/'PUBLIC-ARTIFACT-AUDIT.json').write_text(json.dumps(audit,indent=2))
digests={
 'allowlistSha256':sha(O/'ALLOWLIST.json'),
 'emittedSha256':sha(O/'EMITTED.json'),
 'entrySha256':sha(A/'hydration-gates-entry.cjs'),
 'supervisorSha256':sha(R/'tests/hydration-gates-capsule/inside-supervisor.py'),
 'fixtureSha256':sha(A/'fixture-config.json'),
 'launcherSha256':sha(R/'tests/hydration-gates-capsule/launch-capsule.py'),
}
assert sha(A/'inside-supervisor.py')==digests['supervisorSha256'],'SUPERVISOR_COPY_DIVERGES'
(R/'tests/hydration-gates-capsule/EXPECTED-DIGESTS.json').write_text(json.dumps(digests,indent=2)+'\n')
print('FINITE_CAPSULE_PREPARED_FOR_REVIEW_ONLY',len(manifest),sum(r['bytes'] for r in manifest))
