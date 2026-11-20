'use strict';
/* Preparation compiler only. Never imports or evaluates a product module. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const [repository,destination,compilerFile]=process.argv.slice(2);
const ts=require(compilerFile);
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const selected=new Set(['services/ingestionService.ts']);
function resolve(from,specifier){
 const origin=path.resolve(repository,path.dirname(from),specifier);
 for(const candidate of [origin,origin.replace(/\.js$/,'.ts'),origin+'.ts',origin+'.js',path.join(origin,'index.ts')]){
  if(fs.existsSync(candidate)&&fs.statSync(candidate).isFile()){
   const relative=path.relative(repository,candidate).split(path.sep).join('/');
   assert.ok(!relative.startsWith('../')&&!path.isAbsolute(relative));return relative;
  }
 }
 throw Error('UNRESOLVED_RELATIVE_IMPORT');
}
function imports(file,text){
 const tree=ts.createSourceFile(file,text,ts.ScriptTarget.ES2022,true,file.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
 assert.equal(tree.parseDiagnostics.length,0);
 const list=[];
 function walk(n){
  if(ts.isStringLiteral(n)){
   const p=n.parent;const dynamic=ts.isCallExpression(p)&&p.expression.kind===ts.SyntaxKind.ImportKeyword;
   const requireCall=ts.isCallExpression(p)&&ts.isIdentifier(p.expression)&&p.expression.text==='require';
   if(ts.isImportDeclaration(p)||ts.isExportDeclaration(p)||requireCall||dynamic){
    // Type-only declarations vanish; they cannot introduce a runtime requirement.
    if((ts.isImportDeclaration(p)&&p.importClause?.isTypeOnly)||(ts.isExportDeclaration(p)&&p.isTypeOnly))return;
    list.push({node:n,specifier:n.text,dynamic});
   }
  }
  ts.forEachChild(n,walk);
 }
 walk(tree);return {tree,list};
}
// Close every static relative edge. Dynamic literal imports not selected are
// retained and listed, not replaced. A reached missing dynamic import FAILS.
let changed=true;
while(changed){
 changed=false;
 for(const file of [...selected]){
  const text=fs.readFileSync(path.join(repository,file),'utf8');
  for(const item of imports(file,text).list)if(item.specifier.startsWith('.')&&!item.dynamic){
   const target=resolve(file,item.specifier);if(!selected.has(target)){selected.add(target);changed=true;}
  }
 }
}
const builtins=new Set(require('node:module').builtinModules.flatMap(name=>[name,'node:'+name]));
const rows=[],bareUses=[],omittedDynamic=[];
for(const file of [...selected].sort()){
 const text=fs.readFileSync(path.join(repository,file),'utf8');const {tree,list}=imports(file,text);const replacements=[];
 for(const item of list){
  if(item.specifier.startsWith('.')){
   const target=resolve(file,item.specifier);
   if(!selected.has(target)){assert.ok(item.dynamic);omittedDynamic.push({from:file,target,notMounted:true});}
   let relative=path.posix.relative(path.posix.dirname(file),target.replace(/\.ts$/,'.js'));
   if(!relative.startsWith('.'))relative='./'+relative;
   replacements.push({start:item.node.getStart(tree),end:item.node.end,value:JSON.stringify(relative)});
  }else if(!builtins.has(item.specifier)){
   bareUses.push({from:file,specifier:item.specifier,root:item.specifier.split('/').slice(0,item.specifier.startsWith('@')?2:1).join('/'),dynamic:item.dynamic});
  }
 }
 let mapped=text;
 for(const row of replacements.sort((a,b)=>b.start-a.start))mapped=mapped.slice(0,row.start)+row.value+mapped.slice(row.end);
 const result=ts.transpileModule(mapped,{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.ESNext,
  target:ts.ScriptTarget.ES2022,esModuleInterop:true,useDefineForClassFields:false}});
 assert.ok(!result.diagnostics?.some(value=>value.category===ts.DiagnosticCategory.Error));
 const target=file.replace(/\.ts$/,'.js');const output=path.join(destination,target);
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,result.outputText);
 rows.push({source:file,sourceSha256:sha(text),target:'/app/'+target,emittedSha256:sha(result.outputText)});
}
fs.writeFileSync(path.join(destination,'INGESTION-EMITTED.json'),JSON.stringify({kind:'STATIC_SOURCE_EMISSION_NOT_PRODUCT_EVALUATION',
 compiler:ts.version,compilerSha256:sha(fs.readFileSync(compilerFile)),compilerHostNodeSha256:sha(fs.readFileSync(process.execPath)),
 packageLockSha256:sha(fs.readFileSync(path.join(repository,'package-lock.json'))),files:rows,bareUses,omittedDynamic},null,2)+'\n');
