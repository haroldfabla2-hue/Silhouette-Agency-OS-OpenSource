// Read-only preflight only. Does NOT import app/config/native/services.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');const {spawnSync}=require('node:child_process');
const moduleUrl=require('node:url').pathToFileURL(path.resolve(__dirname,'../../server/desktop/existingRoot.js')).href;
function run(mode){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-selected-root-'));try{
 fs.mkdirSync(path.join(dir,'db'));fs.writeFileSync(path.join(dir,'silhouette.config.json'),'{}');fs.writeFileSync(path.join(dir,'db','fixture.db'),'not a SQLite acceptance fixture');
 const source=`import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {verifyExistingSelection} from ${JSON.stringify(moduleUrl)};
 const hash=x=>createHash('sha256').update(x).digest('hex');const cwd=process.cwd(),st=fs.statSync(cwd);
 const item=(name,kind)=>{const p=path.join(cwd,name),s=fs.statSync(p);return {path:p,kind,dev:String(s.dev),ino:String(s.ino),...(kind==='file'?{sha256:hash(fs.readFileSync(p))}:{})};};
 const d={database:item('db/fixture.db','database'),cwd,dev:String(st.dev),ino:String(st.ino),environmentSha256:hash(JSON.stringify(Object.keys(process.env).sort().map(k=>[k,process.env[k]]))),existing:[item('db','directory'),item('silhouette.config.json','file')]};
 const mode=${JSON.stringify(mode)};
 if(mode==='kind')d.existing[1].kind='anything';
 if(mode==='config-directory')d.existing[1].kind='directory';
 if(mode==='null-item')d.existing[0]=null;
 if(mode==='bad-fields')d.dev=7;
 const digest=hash(JSON.stringify(d));
 if(mode==='env')process.env.UNSELECTED_FIXTURE='changed';if(mode==='content')fs.writeFileSync('silhouette.config.json','{"changed":true}');
 if(mode==='missing')fs.rmSync('db',{recursive:true});
 let accepted=true;try{verifyExistingSelection(d,digest);}catch{accepted=false;}
 if(accepted!==(mode==='valid'))process.exitCode=1;
 if(mode==='missing'&&fs.existsSync('db'))process.exitCode=2;`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',source],{cwd:dir,env:{PATH:process.env.PATH},encoding:'utf8',timeout:2000,maxBuffer:65536});assert.equal(r.status,0,r.stderr);assert.equal(r.signal,null);assert.equal(r.stdout,'');
 }finally{fs.rmSync(dir,{recursive:true,force:true});assert.ok(!fs.existsSync(dir));}}
for(const mode of ['valid','env','content','missing','kind','config-directory','null-item','bad-fields'])test('actual readonly selection '+mode,()=>run(mode));
