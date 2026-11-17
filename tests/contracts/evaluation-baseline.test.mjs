import test from 'node:test';import assert from 'node:assert/strict';
import {compareBaseline,oracleDigest,evaluationScopeFailure} from '../../services/selfdev/evaluationGate.ts';
test('baseline comparison distinguishes preservation, improvement, regression, changed oracle',()=>{
 const baseline={version:1,target:'tests/fixed.test.ts',oracleSha256:oracleDigest('authored oracle'),baselineExit:0,baselineTests:1,closureSha256:'authoredClosure',verdict:'pending'};
 assert.equal(compareBaseline(baseline,'authored oracle',0).verdict,'preserved');
 assert.equal(compareBaseline({...baseline,baselineExit:1},'authored oracle',0).verdict,'improved');
 assert.equal(compareBaseline(baseline,'authored oracle',1).verdict,'regression');
 assert.equal(compareBaseline(baseline,'weakened oracle',0).verdict,'oracle-changed');
 assert.throws(()=>compareBaseline(baseline,'authored oracle',NaN),/meaningful baseline/);
});
test('candidate cannot change acceptance, runner scripts, dependency lock or config',()=>{
 for(const p of ['tests/fixed.test.ts','tests/other.test.ts','./tests/fixed.test.ts','services/../tests/fixed.test.ts','services/nested.fixture.test.ts','server/fixtures/input.json','package.json','package-lock.json','vitest.config.ts','scripts/verify.sh','.github/workflows/ci.yml'])
  assert.match(evaluationScopeFailure([p],'tests/fixed.test.ts'),/EVALUATION_ORACLE_SCOPE/);
 assert.equal(evaluationScopeFailure(['services/existing.ts'],'tests/fixed.test.ts'),undefined);
});
