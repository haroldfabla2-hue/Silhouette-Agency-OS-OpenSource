// REVIEW ONLY. Real authored inputs, offline. Not a product-oracle replacement.
const {createRequire}=require('module');const path=require('path');const fs=require('fs');
const req=createRequire(path.join(process.cwd(),'package.json'));
(async()=>{
 const result={};const DB=req('better-sqlite3');const db=new DB(':memory:');try{db.exec('CREATE TABLE smoke (n INTEGER)');db.prepare('INSERT INTO smoke VALUES (?)').run(7);if(db.prepare('SELECT n FROM smoke').get().n!==7)throw Error('sqlite mismatch');}finally{db.close()}result.sqlite='PASS';
 for(const id of ['sharp','@xenova/transformers/node_modules/sharp']){const sharp=req(id);const b=await sharp(Buffer.from([1,2,3]),{raw:{width:1,height:1,channels:3}}).png().toBuffer();if(b.length<8||b.subarray(1,4).toString()!=='PNG')throw Error('png mismatch');result[id]='PASS'}
 const pack=req('msgpackr');if(pack.unpack(pack.pack({n:7})).n!==7)throw Error('msgpack mismatch');result.msgpackr='PASS';
 const usearch=req('usearch');const index=new usearch.Index({dimensions:2,metric:'l2sq'});index.add(1n,new Float32Array([1,0]));const found=index.search(new Float32Array([1,0]),1);if(!found.keys||found.keys[0]!==1n)throw Error('ANN mismatch');result.usearch='PASS';
 const lance=req('@lancedb/lancedb');const conn=await lance.connect('/tmp/lance-smoke');const table=await conn.createTable('smoke',[{id:1,vector:[1,0]}]);if(await table.countRows()!==1)throw Error('Lance mismatch');if(typeof table.close==='function')await table.close();if(typeof conn.close==='function')await conn.close();result.lance='PASS';
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1});
