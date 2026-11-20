// No taskEvidence import: proves dependency-neutral fallback, without installed server hook.
import test from 'node:test';import assert from 'node:assert/strict';import {assertModelPayload} from '../../services/usageObservation.ts';
test('model fallback never invokes accessor or toJSON and keeps ordinary private prompts usable',()=>{
 let reads=0;for(const value of [{get text(){reads++;return 'unsafe';}},{toJSON(){reads++;return {};}}])assert.throws(()=>assertModelPayload(value),/DATA_FLOW_DENIED/);
 assert.equal(reads,0);assert.doesNotThrow(()=>assertModelPayload([{role:'user',content:'authored private prompt fixture@example.invalid'}]));
});
