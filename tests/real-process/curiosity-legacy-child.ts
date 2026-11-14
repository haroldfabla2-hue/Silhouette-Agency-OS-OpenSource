import { bootstrapStandaloneFixture } from './standalone-fixture-bootstrap';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Original abrupt probe semantics remain. Bootstrap is not closure evidence.
bootstrapStandaloneFixture();
await import('../../server/config/runtimeCredentials');
const mode=process.argv[2];const file='data/curiosity_gaps.json';
fs.mkdirSync('data',{recursive:true});
const original={gaps:[{topic:'original-legacy',question:'original retained question',priority:0.5,detectedAt:Date.now()-100,attempts:0,status:'PENDING'}],savedAt:1};
if(mode==='legacy'){
 fs.writeFileSync(file,JSON.stringify(original));const bytes=fs.readFileSync(file);
 const {curiosity}=await import('../../services/curiosityService');
 await curiosity.waitForPersistence();
 assert.equal(curiosity.getGaps()[0].question,'original retained question');
 assert.deepEqual(fs.readFileSync(file),bytes,'restore alone must not rewrite a legacy snapshot');
 assert.equal(curiosity.getStatus().storage.state,'ready-legacy');
 await curiosity.addGap('new-topic','new authored question');
 const backups=fs.readdirSync('data').filter(n=>n.startsWith('curiosity_gaps.json.legacy-'));
 assert.equal(backups.length,1);assert.deepEqual(fs.readFileSync('data/'+backups[0]),bytes);
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).gaps.length,2);
 console.log(JSON.stringify({mode,original_legacy_payload_retained:true,restore_read_only:true,backup_before_upgrade:true}));
}else if(mode==='corrupt'){
 fs.writeFileSync(file,'{original corrupt bytes');const bytes=fs.readFileSync(file);
 const {curiosity}=await import('../../services/curiosityService');
 await assert.rejects(curiosity.waitForPersistence());
 assert.equal(curiosity.getStatus().storage.state,'blocked');
 assert.equal(curiosity.getStatus().storage.mutationsAllowed,false);
 await assert.rejects(curiosity.addGap('must-not-overwrite','original is retained'));
 assert.deepEqual(fs.readFileSync(file),bytes);
 console.log(JSON.stringify({mode,observable_blocked_status:true,original_preserved:true}));
}else throw new Error('explicit mode required');
process.exit(0);
