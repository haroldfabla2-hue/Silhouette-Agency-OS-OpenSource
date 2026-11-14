'use strict';
// Integrity loader, no fake resource implementation or method replacement.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
module.exports=function installFactoryIntegrityLoader(root,manifest) {
  const depRoot=fs.realpathSync(path.join(root,'node_modules'));
  const allowed=new Map(manifest.moduleEvaluationAllowlist.map(x=>[path.join(depRoot,x.path.slice('node_modules/'.length)),x.sha256]));
  const observed=[];
  for(const ext of ['.js','.json','.node']){
    const original=Module._extensions[ext];
    Module._extensions[ext]=function exactDependencyBody(module,filename){
      const actual=fs.realpathSync(filename);
      if(actual.startsWith(depRoot+path.sep)){
        const expected=allowed.get(actual);
        if(!expected||crypto.createHash('sha256').update(fs.readFileSync(actual)).digest('hex')!==expected)throw Error('NATIVE_CONTRACT:UNREVIEWED_DEPENDENCY_EVALUATION');
        observed.push({path:'node_modules/'+path.relative(depRoot,actual),sha256:expected});
        if(observed.length>300)throw Error('NATIVE_CONTRACT:IMPORT_RECEIPT_CAP');
      } else { throw Error('NATIVE_CONTRACT:UNREVIEWED_EXTERNAL_FILE_EVALUATION'); }
      return original(module,filename);
    };
  }
  return function importedReceipts(){return observed.slice();};
};
