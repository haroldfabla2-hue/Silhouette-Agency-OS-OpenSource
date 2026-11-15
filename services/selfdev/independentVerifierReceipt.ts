/** Contract preparation only. No caller may turn this result into execution,
 * application credit or approval. Source control and a matching hash are not
 * verifier authority. No keys, signing infrastructure or self-signed trust. */
export interface VerifierExpectation {
    cycleId: string;
    proposalMemoryId: string;
    incidentId: string;
    failureExperienceIds: string[];
    source: 'continuum-promote';
    baselineTreeSha256: string;
    candidateTreeSha256: string;
    oracleSha256: string;
    allowedPaths: string[];
}
export interface IndependentVerifierReceipt extends VerifierExpectation {
    version: 1;
    baseline: { result: 'FAIL'; evidenceSha256: string; naturalExit: true; unhandledErrors: 0 };
    candidate: { result: 'PASS'; evidenceSha256: string; naturalExit: true; unhandledErrors: 0 };
    cleanup: { complete: true; residualResources: 0; forcedKills: 0 };
    actualChangedPaths: string[];
}
export interface ReceiptInspection {
    structure: 'MATCH' | 'INVALID';
    authority: 'UNESTABLISHED';
    executionPermitted: false;
    applied: false;
    detail: string;
}
/** Expectations must later be independently pinned outside the editable clone.
 * This helper checks consistency only. It does NOT read authentic evidence,
 * prove containment/real failure, load trusted keys or authorize any cycle.
 * Deliberately no positive authority branch until a reviewed trusted verifier
 * integration establishes custody of oracle, source and actual result bytes. */
export function inspectIndependentVerifierReceipt(input: unknown, expected: VerifierExpectation): ReceiptInspection {
    const result = (structure: 'MATCH' | 'INVALID', detail: string): ReceiptInspection =>
        ({ structure, authority: 'UNESTABLISHED', executionPermitted: false, applied: false, detail });
    try {
        if (!input || typeof input !== 'object') throw new Error('Receipt object required');
        const r = input as IndependentVerifierReceipt;
        const digest = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
        const strings = (a: unknown): a is string[] => Array.isArray(a) && a.length > 0 && a.length <= 100
            && a.every(v => typeof v === 'string' && v.length > 0) && new Set(a).size === a.length;
        const equalSet = (a: unknown, b: unknown) => strings(a) && strings(b)
            && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
        if (r.version !== 1 || expected.source !== 'continuum-promote' || r.source !== expected.source) throw new Error('Unmapped receipt');
        for (const key of ['cycleId', 'proposalMemoryId', 'incidentId'] as const) {
            if (typeof expected[key] !== 'string' || !expected[key] || r[key] !== expected[key]) throw new Error('Identity mismatch');
        }
        if (!equalSet(r.failureExperienceIds, expected.failureExperienceIds) || r.failureExperienceIds.length < 5
            || !r.failureExperienceIds.includes(`incident:${r.incidentId}`)) throw new Error('Failure provenance mismatch');
        for (const key of ['baselineTreeSha256', 'candidateTreeSha256', 'oracleSha256'] as const) {
            if (!digest(expected[key]) || r[key] !== expected[key]) throw new Error('Pinned source/oracle mismatch');
        }
        if (r.baselineTreeSha256 === r.candidateTreeSha256) throw new Error('No candidate change');
        const permitted = ['services/continuumMemory.ts', 'services/memoryTransitions.ts'];
        if (!equalSet(r.allowedPaths, expected.allowedPaths) || r.allowedPaths.some(p => !permitted.includes(p))
            || !strings(r.actualChangedPaths) || r.actualChangedPaths.some(p => !r.allowedPaths.includes(p))) {
            throw new Error('Out-of-scope or empty changes');
        }
        if (r.baseline?.result !== 'FAIL' || r.candidate?.result !== 'PASS'
            || !digest(r.baseline.evidenceSha256) || !digest(r.candidate.evidenceSha256)
            || r.baseline.evidenceSha256 === r.candidate.evidenceSha256
            || r.baseline.naturalExit !== true || r.candidate.naturalExit !== true
            || r.baseline.unhandledErrors !== 0 || r.candidate.unhandledErrors !== 0
            || r.cleanup?.complete !== true || r.cleanup.residualResources !== 0 || r.cleanup.forcedKills !== 0) {
            throw new Error('Incomplete natural-result/cleanup evidence');
        }
        return result('MATCH', 'Consistency only: verifier authority and underlying evidence custody unestablished; gates remain closed');
    } catch (error: unknown) {
        return result('INVALID', error instanceof Error ? error.message : 'Invalid receipt');
    }
}
