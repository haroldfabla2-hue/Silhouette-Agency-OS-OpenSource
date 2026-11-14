'use strict';
// Source-only AST audit. Parses files, NEVER loads/evaluates product modules.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const ts=require(process.argv[2]),beforePath=process.argv[3],afterPath=process.argv[4],output=process.argv[5];
assert.equal(ts.version,'5.8.3');
function inspect(p){
 const text=fs.readFileSync(p,'utf8'),ast=ts.createSourceFile(p,text,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);assert.equal(ast.parseDiagnostics.length,0);
 const fetchCalls=[],bodyOperations=[],custodyCalls=[];
 function receipt(n){const start=n.getStart(ast),end=n.getEnd(),loc=ast.getLineAndCharacterOfPosition(start);return {start,end,line:loc.line+1,column:loc.character+1,text:n.getText(ast)};}
 function visit(n){
  if(ts.isCallExpression(n)){
   if(ts.isIdentifier(n.expression)&&n.expression.text==='fetch')fetchCalls.push(receipt(n));
   if(ts.isIdentifier(n.expression)&&n.expression.text==='withHttpResponseCustody')custodyCalls.push(receipt(n));
   if(ts.isPropertyAccessExpression(n.expression)&&['json','text','arrayBuffer','blob','formData','bytes','cancel','getReader','pipeTo','pipeThrough','tee'].includes(n.expression.name.text)){
    // Include every such receiver in the module, not just expressions called res.
    bodyOperations.push({...receipt(n),receiver:n.expression.expression.getText(ast),method:n.expression.name.text});
   }
  }
  ts.forEachChild(n,visit);
 }
 visit(ast);return {sha256:crypto.createHash('sha256').update(text).digest('hex'),fetchCalls,bodyOperations,custodyCalls};
}
const before=inspect(beforePath),after=inspect(afterPath);assert.equal(before.fetchCalls.length,3);assert.equal(after.fetchCalls.length,3);assert.deepEqual(before.fetchCalls.map(x=>x.text),after.fetchCalls.map(x=>x.text));
assert.equal(after.custodyCalls.length,3);assert.equal(before.bodyOperations.length,1);assert.equal(before.bodyOperations[0].text,'res.json()');assert.equal(after.bodyOperations.length,0);
const row={schemaVersion:1,scope:'SOURCE_AST_ONLY_NO_PRODUCT_EVALUATION',typescriptVersion:ts.version,before,after,threeFetchCallExpressionsByteExact:true,noOtherBodyReadOrCancelCallsInTelephonyModule:true,productEvaluated:false,typecheckExecutedByThisAudit:false};
fs.writeFileSync(output,JSON.stringify(row,null,2)+'\n',{flag:'wx',mode:0o600});
