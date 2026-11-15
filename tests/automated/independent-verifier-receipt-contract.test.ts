/** Authored contract examples only. No real failure, generated repair, trusted
 * verifier or application is demonstrated by any structurally matching object. */
import { expect, it } from 'vitest';
import { inspectIndependentVerifierReceipt, type VerifierExpectation, type IndependentVerifierReceipt } from '../../services/selfdev/independentVerifierReceipt';
const expected: VerifierExpectation = {
    cycleId: 'authored-cycle', proposalMemoryId: 'authored-memory', incidentId: 'authored-episode',
    failureExperienceIds: ['incident:authored-episode', ...Array.from({ length: 4 }, (_, i) => `incident:authored-episode-${i}`)], source: 'continuum-promote',
    baselineTreeSha256: 'a'.repeat(64), candidateTreeSha256: 'b'.repeat(64), oracleSha256: 'c'.repeat(64),
    allowedPaths: ['services/continuumMemory.ts', 'services/memoryTransitions.ts']
};
const fixture = (): IndependentVerifierReceipt => ({ ...structuredClone(expected), version: 1,
    baseline: { result: 'FAIL', evidenceSha256: 'd'.repeat(64), naturalExit: true, unhandledErrors: 0 },
    candidate: { result: 'PASS', evidenceSha256: 'e'.repeat(64), naturalExit: true, unhandledErrors: 0 },
    cleanup: { complete: true, residualResources: 0, forcedKills: 0 }, actualChangedPaths: ['services/continuumMemory.ts'] });
it('even matching authored receipts cannot supply authority or open execution', () => {
    expect(inspectIndependentVerifierReceipt(fixture(), expected)).toMatchObject({ structure: 'MATCH', authority: 'UNESTABLISHED', executionPermitted: false, applied: false });
});
it('rejects changed oracle, identities, scope, empty diff, false result and cleanup claims', () => {
    for (const change of [ { oracleSha256: 'f'.repeat(64) }, { cycleId: 'other' }, { failureExperienceIds: [] },
        { actualChangedPaths: ['security/policy.ts'] }, { actualChangedPaths: [] },
        { cleanup: { complete: true, residualResources: 1, forcedKills: 0 } },
        { candidate: { ...fixture().candidate, naturalExit: false } }, { baseline: { ...fixture().baseline, result: 'PASS' } } ]) {
        expect(inspectIndependentVerifierReceipt({ ...fixture(), ...change }, expected)).toMatchObject({ structure: 'INVALID', executionPermitted: false, applied: false });
    }
});
it('self-described approval or signature never creates a trusted verifier', () => {
    expect(inspectIndependentVerifierReceipt({ ...fixture(), authority: 'APPROVED', signature: 'self-authored' }, expected).authority).toBe('UNESTABLISHED');
    expect(inspectIndependentVerifierReceipt(null, expected).structure).toBe('INVALID');
});
